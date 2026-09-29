import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { commitBackupImport } from '../../src/core/backup/commit';
import { previewBackupImport } from '../../src/core/backup/classify';
import { buildBackupFile, parseBackupFile } from '../../src/core/backup/manifest';
import { analyzeCsvBytes } from '../../src/core/csv/analyze';
import { validateEnvelope } from '../../src/core/envelope/validate';
import { ingestEnvelopeBytes } from '../../src/core/storage/ingest';
import { openDatabase, STORE, type N200Database } from '../../src/core/storage/schema';
import { initialSyncRecord } from '../../src/core/storage/types';
import { synthetic } from '../helpers';
import { buildTestEnvelope, freshDbName } from '../storage-helpers';

/** Fixed seed so a failure is reproducible; the failing counterexample is printed by fast-check. */
const SEED = 20260929;
const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

const openDbs: N200Database[] = [];
async function freshDb(): Promise<N200Database> {
  const { db } = await openDatabase({ name: freshDbName() });
  openDbs.push(db);
  return db;
}
afterEach(() => {
  for (const db of openDbs.splice(0)) db.close();
});

async function storeCounts(db: N200Database) {
  return {
    runs: (await db.getAll(STORE.runs)).length,
    variants: (await db.getAll(STORE.runVariants)).length,
    quarantine: (await db.getAll(STORE.quarantineItems)).length,
  };
}

interface ByteEdit {
  kind: 'flip' | 'insert' | 'delete' | 'truncate';
  at: number;
  value: number;
}
const byteEdit = fc.record<ByteEdit>({
  kind: fc.constantFrom('flip', 'insert', 'delete', 'truncate'),
  at: fc.nat(),
  value: fc.integer({ min: 0, max: 255 }),
});

function applyEdits(source: Uint8Array, edits: ByteEdit[]): Uint8Array {
  let bytes = Array.from(source);
  for (const e of edits) {
    if (bytes.length === 0) break;
    const at = e.at % bytes.length;
    if (e.kind === 'flip') bytes[at] = e.value;
    else if (e.kind === 'insert') bytes.splice(at, 0, e.value);
    else if (e.kind === 'delete') bytes.splice(at, 1);
    else bytes = bytes.slice(0, at);
  }
  return Uint8Array.from(bytes);
}

describe('fuzz: malformed CSV input', () => {
  it('arbitrary bytes never throw and always yield a well-formed analysis', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 4000 }), (bytes) => {
        const result = analyzeCsvBytes(bytes);
        expect(typeof result.ok).toBe('boolean');
        if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
      }),
      { seed: SEED, numRuns: 400 },
    );
  });

  it('randomly corrupted valid CSVs never throw', () => {
    const base = synthetic('SYNTHETIC_crlf_final_newline.csv');
    fc.assert(
      fc.property(fc.array(byteEdit, { maxLength: 12 }), (edits) => {
        const result = analyzeCsvBytes(applyEdits(base, edits));
        expect(typeof result.ok).toBe('boolean');
      }),
      { seed: SEED, numRuns: 400 },
    );
  });
});

describe('fuzz: malformed envelopes', () => {
  it('any change to a valid envelope stops it validating as valid', async () => {
    const envelope = await buildTestEnvelope({ runId: '11111111-1111-4111-8111-111111111111' });
    const original = JSON.stringify(envelope);
    const keys = Object.keys(envelope);
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...keys),
        fc.oneof(
          fc.constant<'delete'>('delete'),
          fc.jsonValue().map((v) => ({ set: v })),
        ),
        async (key, action) => {
          const mutated: Record<string, unknown> =
            action === 'delete'
              ? Object.fromEntries(Object.entries(envelope).filter(([k]) => k !== key))
              : { ...envelope, [key]: action.set };
          fc.pre(JSON.stringify(mutated) !== original);
          const verdict = await validateEnvelope(JSON.parse(JSON.stringify(mutated)));
          expect(verdict.status).not.toBe('valid');
        },
      ),
      { seed: SEED, numRuns: 200 },
    );
  });

  it('ingesting a mutated envelope never throws, never commits it, and quarantines exact bytes', async () => {
    const envelope = await buildTestEnvelope({ runId: '11111111-1111-4111-8111-111111111111' });
    const original = JSON.stringify(envelope);
    const keys = Object.keys(envelope);
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...keys), fc.jsonValue(), async (key, value) => {
        const mutated = { ...envelope, [key]: value } as Record<string, unknown>;
        fc.pre(JSON.stringify(mutated) !== original);
        const db = await freshDb();
        const bytes = encode(mutated);
        const outcome = await ingestEnvelopeBytes(db, bytes, 'backup_import');
        expect(outcome.kind).not.toBe('committed');
        const counts = await storeCounts(db);
        if (outcome.kind === 'quarantined') {
          expect(counts).toEqual({ runs: 0, variants: 0, quarantine: 1 });
          const [item] = await db.getAll(STORE.quarantineItems);
          expect(Array.from(item?.original_bytes ?? [])).toEqual(Array.from(bytes));
        } else {
          expect(counts.quarantine).toBe(0);
        }
      }),
      { seed: SEED, numRuns: 60 },
    );
  });

  it('arbitrary bytes ingest without throwing and leave no run behind', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 500 }), async (bytes) => {
        const db = await freshDb();
        const outcome = await ingestEnvelopeBytes(db, bytes, 'backup_import');
        expect(outcome.kind).toBe('quarantined');
        expect((await storeCounts(db)).runs).toBe(0);
      }),
      { seed: SEED, numRuns: 60 },
    );
  });
});

describe('fuzz: malformed backup files', () => {
  it('arbitrary bytes never throw in parseBackupFile', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 3000 }), (bytes) => {
        const result = parseBackupFile(bytes);
        expect(typeof result.ok).toBe('boolean');
      }),
      { seed: SEED, numRuns: 300 },
    );
  });

  it('corrupted backups are either rejected with a stable reason or preview/restore safely (both counted)', async () => {
    const REASONS = new Set([
      'FILE_TOO_LARGE',
      'INVALID_ENCODING',
      'INVALID_JSON',
      'INVALID_STRUCTURE',
      'UNSUPPORTED_FORMAT_VERSION',
      'RUN_COUNT_EXCEEDS_LIMIT',
      'RUN_COUNT_MISMATCH',
    ]);
    const envelope = await buildTestEnvelope({ runId: '11111111-1111-4111-8111-111111111111' });
    const good = buildBackupFile([
      { run_id: envelope.run_id, envelope, sync: initialSyncRecord('pending') },
    ]);
    const goodBytes = encode(good);
    const NUM_RUNS = 300;
    let rejected = 0;
    let accepted = 0;
    let unchanged = 0;

    await fc.assert(
      fc.asyncProperty(fc.array(byteEdit, { minLength: 1, maxLength: 6 }), async (edits) => {
        const corrupted = applyEdits(goodBytes, edits);
        if (Buffer.compare(Buffer.from(corrupted), Buffer.from(goodBytes)) === 0) unchanged += 1;
        const parsed = parseBackupFile(corrupted);
        if (!parsed.ok) {
          rejected += 1;
          expect(REASONS.has(parsed.reason)).toBe(true);
          return;
        }
        accepted += 1;
        const db = await freshDb();
        const before = await storeCounts(db);
        const preview = await previewBackupImport(db, parsed.file);
        expect(await storeCounts(db)).toEqual(before);
        expect(preview.entries).toHaveLength(parsed.file.runs.length);
        const results = await commitBackupImport(db, parsed.file);
        expect(results).toHaveLength(parsed.file.runs.length);
      }),
      { seed: SEED, numRuns: NUM_RUNS },
    );

    // Every generated case is accounted for; nothing is silently filtered away.
    expect(accepted + rejected).toBe(NUM_RUNS);
    // Guard against a vacuous property: both branches must really be exercised.
    expect(rejected).toBeGreaterThanOrEqual(NUM_RUNS / 2);
    expect(accepted).toBeGreaterThanOrEqual(5);
    // Edits that leave the file byte-identical are still valid (accepted) cases, but must be rare.
    expect(unchanged).toBeLessThan(NUM_RUNS / 10);
  });
});
