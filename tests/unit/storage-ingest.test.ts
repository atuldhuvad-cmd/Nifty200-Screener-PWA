import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalize } from '../../src/core/envelope/canonicalHash';
import type { RunEnvelopeV1 } from '../../src/core/envelope/types';
import { ingestEnvelopeBytes } from '../../src/core/storage/ingest';
import { commitNewRun, getRun } from '../../src/core/storage/runs';
import { openDatabase, STORE, type N200Database } from '../../src/core/storage/schema';
import { withoutKey } from '../helpers';
import { buildTestEnvelope, freshDbName } from '../storage-helpers';

let db: N200Database;

beforeEach(async () => {
  db = await openDatabase({ name: freshDbName() });
});

afterEach(() => {
  db.close();
});

const enc = (obj: unknown) => new TextEncoder().encode(JSON.stringify(obj));

describe('ingestEnvelopeBytes: valid envelopes', () => {
  it('a new, schema-valid envelope commits to runs as pending', async () => {
    const envelope = await buildTestEnvelope();
    const outcome = await ingestEnvelopeBytes(db, enc(envelope), 'backup_import');
    expect(outcome).toEqual({ kind: 'committed', run_id: envelope.run_id });

    const stored = await getRun(db, envelope.run_id);
    expect(stored?.sync.state).toBe('pending');
    expect(stored?.envelope).toEqual(envelope);
  });

  it('an identical existing run_id + envelope_sha256 is a no-op ("already present")', async () => {
    const envelope = await buildTestEnvelope();
    await commitNewRun(db, envelope);

    const outcome = await ingestEnvelopeBytes(db, enc(envelope), 'backup_import');
    expect(outcome).toEqual({ kind: 'already_present', run_id: envelope.run_id });

    const stored = await getRun(db, envelope.run_id);
    expect(stored?.sync.state).toBe('pending'); // unchanged — a true no-op
  });

  it('a divergent envelope under the same run_id is preserved as a variant, canonical becomes conflict, neither is overwritten', async () => {
    const canonical = await buildTestEnvelope();
    await commitNewRun(db, canonical);

    const divergent: RunEnvelopeV1 = { ...canonical, query_text: 'a different query' };
    // Recompute the hash the divergent copy would actually carry, so it's schema/hash valid.
    const { jcsSha256Hex } = await import('../../src/core/envelope/canonicalHash');
    const rest = withoutKey(divergent, 'envelope_sha256');
    const newHash = await jcsSha256Hex(rest);
    const divergentValid: RunEnvelopeV1 = { ...rest, envelope_sha256: newHash };

    const outcome = await ingestEnvelopeBytes(db, enc(divergentValid), 'backup_import');
    expect(outcome).toEqual({ kind: 'conflict', run_id: canonical.run_id });

    const stored = await getRun(db, canonical.run_id);
    expect(stored?.envelope).toEqual(canonical); // canonical untouched
    expect(stored?.sync.state).toBe('conflict');

    const variant = await db.get(STORE.runVariants, [canonical.run_id, newHash]);
    expect(variant?.envelope).toEqual(divergentValid);
    expect(variant?.source).toBe('backup_import');
  });

  it('a permitted duplicate (different run_id, same original_file_sha256) is committed independently, not merged', async () => {
    const a = await buildTestEnvelope({ runId: '11111111-1111-4111-8111-111111111111' });
    await commitNewRun(db, a);
    const b = await buildTestEnvelope({ runId: '22222222-2222-4222-8222-222222222222' });
    expect(b.original_file_sha256).toBe(a.original_file_sha256);

    const outcome = await ingestEnvelopeBytes(db, enc(b), 'backup_import');
    expect(outcome).toEqual({ kind: 'committed', run_id: b.run_id });
    expect(await getRun(db, a.run_id)).toBeDefined();
    expect(await getRun(db, b.run_id)).toBeDefined();
  });

  it('maps source drive/backup_import/manual_recovery to the variant source remote/backup_import/manual_recovery', async () => {
    const canonical = await buildTestEnvelope({ runId: '33333333-3333-4333-8333-333333333333' });
    await commitNewRun(db, canonical);
    const { jcsSha256Hex } = await import('../../src/core/envelope/canonicalHash');

    for (const [ingestSource, expectedVariantSource] of [
      ['drive', 'remote'],
      ['local_import', 'manual_recovery'],
    ] as const) {
      const divergent = { ...canonical, query_text: ingestSource };
      const rest = withoutKey(divergent, 'envelope_sha256');
      const hash = await jcsSha256Hex(rest);
      const divergentValid = { ...rest, envelope_sha256: hash };
      await ingestEnvelopeBytes(db, enc(divergentValid), ingestSource);
      const variant = await db.get(STORE.runVariants, [canonical.run_id, hash]);
      expect(variant?.source).toBe(expectedVariantSource);
    }
  });
});

describe('ingestEnvelopeBytes: quarantine routing', () => {
  it('malformed JSON is quarantined with JSON_PARSE_FAILED, preserving the original bytes', async () => {
    const bytes = new TextEncoder().encode('{not valid json');
    const outcome = await ingestEnvelopeBytes(db, bytes, 'local_import');
    expect(outcome.kind).toBe('quarantined');
    if (outcome.kind !== 'quarantined') return;
    expect(outcome.reasons).toEqual(['JSON_PARSE_FAILED']);

    const item = await db.get(STORE.quarantineItems, outcome.quarantine_id);
    expect(item?.source).toBe('local_import');
    expect(Array.from(item?.original_bytes ?? [])).toEqual(Array.from(bytes));
    expect(item?.validation_errors).toEqual(['JSON_PARSE_FAILED']);
  });

  it('a schema-invalid v1 envelope is quarantined with the schema-validation reason', async () => {
    const envelope = await buildTestEnvelope();
    const broken = withoutKey(envelope, 'run_id');
    const outcome = await ingestEnvelopeBytes(db, enc(broken), 'local_import');
    expect(outcome).toMatchObject({ kind: 'quarantined', reasons: ['SCHEMA_INVALID'] });
  });

  it('a tampered (hash-mismatched) v1 envelope is quarantined, never silently accepted', async () => {
    const envelope = await buildTestEnvelope();
    const tampered = { ...envelope, effective_date: '2026-09-28' };
    const outcome = await ingestEnvelopeBytes(db, enc(tampered), 'local_import');
    expect(outcome).toMatchObject({ kind: 'quarantined', reasons: ['ENVELOPE_HASH_MISMATCH'] });
  });

  it('invalid UTF-8 bytes are quarantined rather than crashing', async () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0x01]);
    const outcome = await ingestEnvelopeBytes(db, bytes, 'drive');
    expect(outcome).toMatchObject({ kind: 'quarantined', reasons: ['JSON_PARSE_FAILED'] });
  });

  it('quarantine never blocks or is entered into active views: no runs/run_variants row is created', async () => {
    await ingestEnvelopeBytes(db, new TextEncoder().encode('garbage'), 'local_import');
    expect(await db.getAll(STORE.runs)).toEqual([]);
    expect(await db.getAll(STORE.runVariants)).toEqual([]);
  });
});

describe('ingestEnvelopeBytes: unsupported_schema is preserved but excluded from active queries', () => {
  it('a future schema_version with a usable run_id is preserved in runs with state unsupported_schema', async () => {
    const future = {
      run_id: '99999999-9999-4999-8999-999999999999',
      schema_version: '2',
      anything: 'goes',
    };
    const outcome = await ingestEnvelopeBytes(db, enc(future), 'drive');
    expect(outcome).toEqual({ kind: 'unsupported_schema', run_id: future.run_id });

    const stored = await getRun(db, future.run_id);
    expect(stored?.sync.state).toBe('unsupported_schema');
    expect(canonicalize(stored?.envelope)).toBe(canonicalize(future));
  });

  it('is excluded from findRunsByOriginalFileHash-style active queries (never interpreted)', async () => {
    const future = { run_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', schema_version: '2' };
    await ingestEnvelopeBytes(db, enc(future), 'drive');
    // The comparison-identity index — the "active view" this app actually queries — has no
    // rows for it, since an unsupported-schema envelope is never parsed for identity.
    const compRows = await db.getAllFromIndex(STORE.comparisonIdentity, 'by_run_id', future.run_id);
    expect(compRows).toEqual([]);
  });

  it('a future schema_version with no usable run_id is quarantined instead (cannot key runs by it)', async () => {
    const outcome = await ingestEnvelopeBytes(db, enc({ schema_version: '2' }), 'drive');
    expect(outcome).toMatchObject({
      kind: 'quarantined',
      reasons: ['NO_USABLE_RUN_ID_FOR_UNSUPPORTED_SCHEMA'],
    });
  });

  it('does not overwrite an existing run at the same run_id', async () => {
    const envelope = await buildTestEnvelope({ runId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    await commitNewRun(db, envelope);
    const future = { run_id: envelope.run_id, schema_version: '2' };
    const outcome = await ingestEnvelopeBytes(db, enc(future), 'drive');
    expect(outcome).toMatchObject({ kind: 'quarantined', reasons: ['RUN_ID_ALREADY_OCCUPIED'] });
    expect((await getRun(db, envelope.run_id))?.envelope).toEqual(envelope);
  });
});
