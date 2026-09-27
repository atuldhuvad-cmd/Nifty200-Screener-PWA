import { sha256Hex } from '../envelope/hash';
import type { RunEnvelopeV1 } from '../envelope/types';
import { validateEnvelope } from '../envelope/validate';
import { rebuildComparisonIndexTx } from './comparisonIndex';
import { STORE, type N200Database } from './schema';
import { applyTransition } from './runs';
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
): Promise<IngestOutcome> {
  const quarantine_id = generateId();
  await db.add(STORE.quarantineItems, {
    quarantine_id,
    original_bytes: bytes,
    source,
    observed_sha256: await sha256Hex(bytes),
    validation_errors: reasons,
    discovered_at: new Date().toISOString(),
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

/**
 * Ingests one candidate envelope's serialized bytes (from a backup file, a Drive download, or
 * any other future restore path — none of which exist yet, but the routing rules do not
 * depend on the source). Store routing, per the brief:
 * - schema-valid, new run_id → `runs`, state `pending`.
 * - schema-valid, existing run_id, identical `envelope_sha256` → no-op ("already present").
 * - schema-valid, existing run_id, different `envelope_sha256` → canonical envelope in `runs`
 *   is preserved untouched; the divergent one goes to `run_variants`; canonical run → `conflict`.
 * - `unsupported_schema` → preserved in `runs` under its own `run_id` if it has a usable one
 *   (state `unsupported_schema`, excluded from active queries), else `quarantine_items` (it
 *   cannot "supply a validated run_id").
 * - anything else (malformed JSON, schema-invalid, undecodable) → `quarantine_items`.
 */
export async function ingestEnvelopeBytes(
  db: N200Database,
  bytes: Uint8Array,
  source: QuarantineSource,
): Promise<IngestOutcome> {
  const parsed = tryParseJson(bytes);
  if (!parsed.ok) return quarantine(db, bytes, source, ['JSON_PARSE_FAILED']);

  const outcome = await validateEnvelope(parsed.value);

  if (outcome.status === 'unsupported_schema') {
    // validateEnvelope only returns this status once schema_version is confirmed to be a
    // recognizable-but-unsupported string; run_id's own shape is unconstrained for a future
    // schema, so it must still be checked here before this app can key a `runs` record by it.
    const runId = (parsed.value as { run_id?: unknown }).run_id;
    if (typeof runId !== 'string' || runId === '') {
      return quarantine(db, bytes, source, ['NO_USABLE_RUN_ID_FOR_UNSUPPORTED_SCHEMA']);
    }
    const existing = await db.get(STORE.runs, runId);
    if (existing) {
      // A run_id already occupied by something else; do not overwrite it (Data lifecycle:
      // "never overwrite either copy"). Quarantine the incoming object instead of guessing.
      return quarantine(db, bytes, source, ['RUN_ID_ALREADY_OCCUPIED']);
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
    return quarantine(db, bytes, source, outcome.reasons);
  }

  // outcome.status === 'valid'
  const envelope = parsed.value as RunEnvelopeV1;
  const variantSource: VariantSource =
    source === 'drive'
      ? 'remote'
      : source === 'backup_import'
        ? 'backup_import'
        : 'manual_recovery';

  const existing = await db.get(STORE.runs, envelope.run_id);
  if (!existing) {
    const tx = db.transaction([STORE.runs, STORE.comparisonIdentity], 'readwrite');
    await tx.objectStore(STORE.runs).add({
      run_id: envelope.run_id,
      envelope,
      sync: initialSyncRecord('pending'),
    });
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
    return { kind: 'already_present', run_id: envelope.run_id };
  }

  // Divergent same-run_id envelope: preserve the canonical copy untouched, store the new one
  // as a variant, and mark the canonical run conflict — never overwrite either.
  await db.add(STORE.runVariants, {
    run_id: envelope.run_id,
    envelope_sha256: envelope.envelope_sha256,
    envelope,
    source: variantSource,
    discovered_at: new Date().toISOString(),
  });
  await applyTransition(db, envelope.run_id, { type: 'INGEST_CONFLICT_VARIANT' });
  return { kind: 'conflict', run_id: envelope.run_id };
}
