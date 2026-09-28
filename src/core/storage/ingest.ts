import { sha256Hex } from '../envelope/hash';
import type { RunEnvelopeV1 } from '../envelope/types';
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
 * Store routing, per the brief:
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
  const parsed = tryParseJson(bytes);
  if (!parsed.ok) return quarantine(db, bytes, source, ['JSON_PARSE_FAILED'], discoveryMetadata);

  const outcome = await validateEnvelope(parsed.value);

  if (outcome.status === 'unsupported_schema') {
    // validateEnvelope only returns this status once schema_version is confirmed to be a
    // recognizable-but-unsupported string; run_id's own shape is unconstrained for a future
    // schema, so it must still be checked here before this app can key a `runs` record by it.
    const runId = (parsed.value as { run_id?: unknown }).run_id;
    if (typeof runId !== 'string' || runId === '') {
      return quarantine(
        db,
        bytes,
        source,
        ['NO_USABLE_RUN_ID_FOR_UNSUPPORTED_SCHEMA'],
        discoveryMetadata,
      );
    }
    const existing = await db.get(STORE.runs, runId);
    if (existing) {
      // A run_id already occupied by something else; do not overwrite it (Data lifecycle:
      // "never overwrite either copy"). Quarantine the incoming object instead of guessing.
      return quarantine(db, bytes, source, ['RUN_ID_ALREADY_OCCUPIED'], discoveryMetadata);
    }
    const record: RunRecord = {
      run_id: runId,
      envelope: parsed.value as UnsupportedSchemaEnvelope,
      sync: initialSyncRecord('unsupported_schema'),
    };
    await db.add(STORE.runs, record);
    return { kind: 'unsupported_schema', run_id: runId };
  }

  if (outcome.status === 'quarantined') {
    return quarantine(db, bytes, source, outcome.reasons, discoveryMetadata);
  }

  // outcome.status === 'valid' — check-and-route inside one atomic transaction (Bugbot P1-1),
  // spanning every store this branch could write to, so a concurrent ingest of a different
  // divergent envelope for the same run_id, or a re-ingest of an identical one, can never
  // interleave into a lost variant or a half-applied conflict marker.
  const envelope = parsed.value as RunEnvelopeV1;
  const tx = db.transaction([STORE.runs, STORE.runVariants, STORE.comparisonIdentity], 'readwrite');
  const runStore = tx.objectStore(STORE.runs);
  const variantStore = tx.objectStore(STORE.runVariants);

  try {
    const existing = await runStore.get(envelope.run_id);

    if (!existing) {
      await runStore.add({ run_id: envelope.run_id, envelope, sync: initialSyncRecord('pending') });
      await rebuildComparisonIndexTx(
        tx.objectStore(STORE.comparisonIdentity),
        envelope.run_id,
        envelope,
      );
      await tx.done;
      return { kind: 'committed', run_id: envelope.run_id };
    }

    const existingHash =
      existing.envelope.schema_version === '1'
        ? (existing.envelope as RunEnvelopeV1).envelope_sha256
        : null;
    if (existingHash === envelope.envelope_sha256) {
      await tx.done;
      return { kind: 'already_present', run_id: envelope.run_id };
    }

    // Divergent same-run_id envelope: preserve the canonical copy untouched, store the new one
    // as a variant (idempotent — an identical variant already present is a no-op, never a
    // ConstraintError), and mark the canonical run conflict — never overwrite either.
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
