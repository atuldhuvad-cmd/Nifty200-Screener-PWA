import { sha256Hex } from '../envelope/hash';
import type { RunEnvelopeV1, RunEnvelopeV2 } from '../envelope/types';
import { validateEnvelope } from '../envelope/validate';
import { rebuildComparisonIndexTx } from './comparisonIndex';
import { sanitizeQuarantineDiscoveryMetadata } from './sanitizeDiscoveryMetadata';
import { STORE, type N200Database } from './schema';
import { transition } from './syncState';
import { safeAbort } from './txUtils';
import {
  initialSyncRecord,
  type QuarantineSource,
  type RunRecord,
  type UnsupportedSchemaEnvelope,
  type VariantSource,
} from './types';

export type IngestOutcome =
  | { kind: 'committed'; run_id: string }
  | { kind: 'already_present'; run_id: string }
  | { kind: 'conflict'; run_id: string }
  | { kind: 'unsupported_schema'; run_id: string }
  | { kind: 'quarantined'; quarantine_id: string; reasons: string[] };

function generateId(): string {
  return crypto.randomUUID();
}

async function quarantine(
  db: N200Database,
  bytes: Uint8Array,
  source: QuarantineSource,
  reasons: string[],
  discoveryMetadata: unknown,
): Promise<IngestOutcome> {
  const quarantine_id = generateId();
  // Sanitized at this storage boundary (security review P2-B) — never trust the caller to
  // have already validated/bounded it; see sanitizeDiscoveryMetadata.ts.
  const sanitized = sanitizeQuarantineDiscoveryMetadata(discoveryMetadata);
  await db.add(STORE.quarantineItems, {
    quarantine_id,
    original_bytes: bytes,
    source,
    observed_sha256: await sha256Hex(bytes),
    validation_errors: reasons,
    discovered_at: new Date().toISOString(),
    ...(sanitized !== undefined ? { discovery_metadata: sanitized } : {}),
  });
  return { kind: 'quarantined', quarantine_id, reasons };
}

function tryParseJson(bytes: Uint8Array): { ok: true; value: unknown } | { ok: false } {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

function variantSourceFor(source: QuarantineSource): VariantSource {
  if (source === 'drive') return 'remote';
  if (source === 'backup_import') return 'backup_import';
  return 'manual_recovery';
}

/**
 * The pure, parse-and-validate half of ingestion: JSON-decode the bytes and run schema +
 * semantic + replay validation. Never touches the database, never throws for malformed input —
 * every failure is a normal return value. Shared by `ingestEnvelopeBytes` (below) and Step 6's
 * read-only backup-import preview (`src/core/backup/classify.ts`), so there is exactly one
 * place that decides "is this envelope usable at all," not two independently-maintained copies.
 */
export type ParsedCandidate =
  | { status: 'parse_failed' }
  | { status: 'quarantined'; reasons: string[] }
  | { status: 'unsupported_schema'; envelope: UnsupportedSchemaEnvelope }
  | { status: 'valid'; envelope: RunEnvelopeV1 | RunEnvelopeV2 };

export async function parseIngestCandidate(bytes: Uint8Array): Promise<ParsedCandidate> {
  const parsed = tryParseJson(bytes);
  if (!parsed.ok) return { status: 'parse_failed' };

  const outcome = await validateEnvelope(parsed.value);

  if (outcome.status === 'unsupported_schema') {
    const runId = (parsed.value as { run_id?: unknown }).run_id;
    if (typeof runId !== 'string' || runId === '') {
      return { status: 'quarantined', reasons: ['NO_USABLE_RUN_ID_FOR_UNSUPPORTED_SCHEMA'] };
    }
    return { status: 'unsupported_schema', envelope: parsed.value as UnsupportedSchemaEnvelope };
  }

  if (outcome.status === 'quarantined') {
    return { status: 'quarantined', reasons: outcome.reasons };
  }

  return { status: 'valid', envelope: parsed.value as RunEnvelopeV1 | RunEnvelopeV2 };
}

/**
 * The pure collision-routing decision: given a validated candidate and what (if anything)
 * already occupies its `run_id`/variant slot, decide what should happen — never performs any
 * I/O itself. `ingestEnvelopeBytes` supplies these inputs from **inside** its atomic
 * transaction (so the real commit stays race-free, exactly as before this refactor); Step 6's
 * preview supplies them from a plain, non-atomic read (the same advisory-only relationship
 * `findRunsByOriginalFileHash` already has to the real commit elsewhere in this codebase — the
 * preview can go stale between reading and confirming, but the actual commit re-decides fresh
 * and atomically regardless of what the preview said). One rule set, two call sites — never two
 * rule sets that could drift apart.
 */
export type RoutingDecision =
  | { action: 'add_unsupported' }
  | { action: 'quarantine_run_id_occupied' }
  | { action: 'add_new' }
  | { action: 'already_present' }
  | { action: 'add_variant_and_conflict' };

export function decideRouting(
  candidate: Extract<ParsedCandidate, { status: 'unsupported_schema' | 'valid' }>,
  existingRun: RunRecord | undefined,
): RoutingDecision {
  if (candidate.status === 'unsupported_schema') {
    // A run_id already occupied by something else; do not overwrite it (Data lifecycle:
    // "never overwrite either copy"). Quarantine the incoming object instead of guessing.
    return existingRun ? { action: 'quarantine_run_id_occupied' } : { action: 'add_unsupported' };
  }

  if (!existingRun) return { action: 'add_new' };

  const existingHash =
    existingRun.envelope.schema_version === '1' || existingRun.envelope.schema_version === '2'
      ? (existingRun.envelope as RunEnvelopeV1 | RunEnvelopeV2).envelope_sha256
      : null;
  return existingHash === candidate.envelope.envelope_sha256
    ? { action: 'already_present' }
    : { action: 'add_variant_and_conflict' };
}

/**
 * Ingests one candidate envelope's serialized bytes (from a backup file, a Drive download, or
 * any other future restore path — none of which exist yet, but the routing rules do not
 * depend on the source). `discoveryMetadata` is structured, **non-authoritative** provenance
 * (Bugbot P2-5) — like the brief's treatment of Drive `appProperties`, it is recorded for
 * human diagnosis only and never influences routing, validation, or trust decisions.
 *
 * **Scope boundary (§9/§12 review):** this only ever handles envelope-level bytes (a Drive
 * file, a backup-archive entry, or an internally built envelope). A user-selected CSV that
 * fails preview validation is rejected at the preview step and never reaches this function or
 * `quarantine_items` at all.
 *
 * Store routing, per the brief (decision made by the shared `decideRouting`, above):
 * - schema-valid, new run_id → `runs`, state `pending`.
 * - schema-valid, existing run_id, identical `envelope_sha256` → no-op ("already present").
 * - schema-valid, existing run_id, different `envelope_sha256` → canonical envelope in `runs`
 *   is preserved untouched; the divergent one goes to `run_variants`; canonical run → `conflict`
 *   — all three checked and written in **one atomic transaction** (Bugbot P1-1), so two
 *   concurrent divergent ingests can never lose a variant, and re-ingesting an already-stored
 *   variant is an idempotent no-op rather than a `ConstraintError`.
 * - `unsupported_schema` → preserved in `runs` under its own `run_id` if it has a usable one
 *   (state `unsupported_schema`, excluded from active queries), else `quarantine_items` (it
 *   cannot "supply a validated run_id").
 * - anything else (malformed JSON, schema-invalid, undecodable) → `quarantine_items`.
 */
export async function ingestEnvelopeBytes(
  db: N200Database,
  bytes: Uint8Array,
  source: QuarantineSource,
  /** Untyped on purpose (security review P2-B): sanitized/bounded internally before storage,
   * never trusted as already-valid just because a caller typed it as `QuarantineDiscoveryMetadata`. */
  discoveryMetadata?: unknown,
): Promise<IngestOutcome> {
  const candidate = await parseIngestCandidate(bytes);

  if (candidate.status === 'parse_failed') {
    return quarantine(db, bytes, source, ['JSON_PARSE_FAILED'], discoveryMetadata);
  }
  if (candidate.status === 'quarantined') {
    return quarantine(db, bytes, source, candidate.reasons, discoveryMetadata);
  }

  if (candidate.status === 'unsupported_schema') {
    const runId = candidate.envelope.run_id;
    const existing = await db.get(STORE.runs, runId);
    const decision = decideRouting(candidate, existing);
    if (decision.action === 'quarantine_run_id_occupied') {
      return quarantine(db, bytes, source, ['RUN_ID_ALREADY_OCCUPIED'], discoveryMetadata);
    }
    const record: RunRecord = {
      run_id: runId,
      envelope: candidate.envelope,
      sync: initialSyncRecord('unsupported_schema'),
    };
    await db.add(STORE.runs, record);
    return { kind: 'unsupported_schema', run_id: runId };
  }

  // candidate.status === 'valid' — check-and-route inside one atomic transaction (Bugbot P1-1),
  // spanning every store this branch could write to, so a concurrent ingest of a different
  // divergent envelope for the same run_id, or a re-ingest of an identical one, can never
  // interleave into a lost variant or a half-applied conflict marker.
  const envelope = candidate.envelope;
  const tx = db.transaction([STORE.runs, STORE.runVariants, STORE.comparisonIdentity], 'readwrite');
  const runStore = tx.objectStore(STORE.runs);
  const variantStore = tx.objectStore(STORE.runVariants);

  try {
    const existing = await runStore.get(envelope.run_id);
    const decision = decideRouting(candidate, existing);

    if (decision.action === 'add_new') {
      await runStore.add({ run_id: envelope.run_id, envelope, sync: initialSyncRecord('pending') });
      await rebuildComparisonIndexTx(
        tx.objectStore(STORE.comparisonIdentity),
        envelope.run_id,
        envelope,
      );
      await tx.done;
      return { kind: 'committed', run_id: envelope.run_id };
    }

    if (decision.action === 'already_present') {
      await tx.done;
      return { kind: 'already_present', run_id: envelope.run_id };
    }

    // 'add_variant_and_conflict': preserve the canonical copy untouched, store the new one as a
    // variant (idempotent — an identical variant already present is a no-op, never a
    // ConstraintError), and mark the canonical run conflict — never overwrite either.
    if (existing === undefined) {
      // Unreachable: decideRouting only returns this action when `existingRun` was supplied.
      throw new Error('ingestEnvelopeBytes: add_variant_and_conflict with no existing run');
    }
    const variantKey: [string, string] = [envelope.run_id, envelope.envelope_sha256];
    const existingVariant = await variantStore.get(variantKey);
    if (!existingVariant) {
      await variantStore.add({
        run_id: envelope.run_id,
        envelope_sha256: envelope.envelope_sha256,
        envelope,
        source: variantSourceFor(source),
        discovered_at: new Date().toISOString(),
      });
    }

    const transitionResult = transition(existing.sync, { type: 'INGEST_CONFLICT_VARIANT' });
    if (transitionResult.ok) {
      await runStore.put({ ...existing, sync: transitionResult.record });
    }
    // An invalid transition (canonical already quarantined/unsupported_schema) intentionally
    // leaves the canonical run's state untouched — the variant is still preserved either way.

    await tx.done;
    return { kind: 'conflict', run_id: envelope.run_id };
  } catch (e) {
    // A failed request auto-aborts the native transaction per spec; a plain JS error thrown
    // *between* requests would not (the already-issued requests would otherwise simply commit
    // when the transaction naturally completes) — so this abort is explicit, not redundant.
    safeAbort(tx);
    throw e;
  }
}
