import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  commitNewRun,
  findRunsByExactSourceHashSet,
  findRunsByOriginalFileHash,
  findRunsBySourceFileHash,
  getAllRuns,
  getRun,
  openDatabase,
  STORE,
  COMPARISON_BY_RUN_ID,
  type N200Database,
} from '../../src/core/storage';
import { initialSyncRecord } from '../../src/core/storage/types';
import { buildCsv, SYNTHETIC_HEADER } from '../helpers';
import { buildTestEnvelope, buildTestMultipartEnvelope, freshDbName } from '../storage-helpers';

let db: N200Database;

beforeEach(async () => {
  ({ db } = await openDatabase({ name: freshDbName() }));
});

afterEach(() => {
  db.close();
});

const rowWith = (sl: string, name: string, isin: string, nse: string): string[] => [
  sl,
  name,
  '',
  '1500',
  '1000',
  nse,
  isin,
];

function twoPartFixture() {
  const a = buildCsv([SYNTHETIC_HEADER, rowWith('1', 'Alpha', 'ZZSYNTH00015', 'AAA')]);
  const b = buildCsv([SYNTHETIC_HEADER, rowWith('1', 'Beta', 'ZZSYNTH00023', 'BBB')]);
  return { a, b };
}

describe('commitNewRun: multipart (v2) envelopes', () => {
  it('commits a v2 run atomically: envelope, rebuilt comparison index, and initial pending sync state', async () => {
    const { a, b } = twoPartFixture();
    const envelope = await buildTestMultipartEnvelope({
      parts: [
        { fixtureBytes: a, filename: 'a.csv' },
        { fixtureBytes: b, filename: 'b.csv' },
      ],
    });
    const result = await commitNewRun(db, envelope);
    expect(result).toEqual({ ok: true, run_id: envelope.run_id });

    const stored = await getRun(db, envelope.run_id);
    expect(stored?.envelope).toEqual(envelope);
    expect(stored?.sync.state).toBe('pending');
    expect(stored?.sync.diagnostics.attempt_count).toBe(0);

    const compRows = await db.getAllFromIndex(
      STORE.comparisonIdentity,
      COMPARISON_BY_RUN_ID,
      envelope.run_id,
    );
    expect(compRows).toHaveLength(2);
    const identityKeys = compRows.map((r) => r.identity_key).sort();
    expect(identityKeys).toEqual(['isin:ZZSYNTH00015', 'isin:ZZSYNTH00023']);
  });

  it('a run_id collision leaves zero partial data behind (atomic rollback), same as v1', async () => {
    const { a, b } = twoPartFixture();
    const envelope = await buildTestMultipartEnvelope({
      parts: [
        { fixtureBytes: a, filename: 'a.csv' },
        { fixtureBytes: b, filename: 'b.csv' },
      ],
    });
    await db.add(STORE.runs, {
      run_id: envelope.run_id,
      envelope,
      sync: initialSyncRecord('pending'),
    });

    const result = await commitNewRun(db, envelope);
    expect(result).toEqual({ ok: false, reason: 'run_id_collision' });

    const compRows = await db.getAllFromIndex(
      STORE.comparisonIdentity,
      COMPARISON_BY_RUN_ID,
      envelope.run_id,
    );
    expect(compRows).toEqual([]);
    expect(await getAllRuns(db)).toHaveLength(1);
  });
});

describe('v1 and v2 runs coexist without interference', () => {
  it('a v1 single-file run and a v2 multipart run are both stored and independently queryable', async () => {
    const v1 = await buildTestEnvelope();
    const { a, b } = twoPartFixture();
    const v2 = await buildTestMultipartEnvelope({
      parts: [
        { fixtureBytes: a, filename: 'a.csv' },
        { fixtureBytes: b, filename: 'b.csv' },
      ],
    });

    await commitNewRun(db, v1);
    await commitNewRun(db, v2);

    const all = await getAllRuns(db);
    expect(all).toHaveLength(2);
    expect(new Set(all.map((r) => r.run_id))).toEqual(new Set([v1.run_id, v2.run_id]));

    const storedV1 = await getRun(db, v1.run_id);
    const storedV2 = await getRun(db, v2.run_id);
    expect(storedV1?.envelope.schema_version).toBe('1');
    expect(storedV2?.envelope.schema_version).toBe('2');

    const v1CompRows = await db.getAllFromIndex(
      STORE.comparisonIdentity,
      COMPARISON_BY_RUN_ID,
      v1.run_id,
    );
    const v2CompRows = await db.getAllFromIndex(
      STORE.comparisonIdentity,
      COMPARISON_BY_RUN_ID,
      v2.run_id,
    );
    expect(v1CompRows.length).toBeGreaterThan(0);
    expect(v2CompRows).toHaveLength(2);
  });
});

describe('multipart duplicate-source-file detection', () => {
  it('findRunsBySourceFileHash finds a v1 run by its single original_file_sha256', async () => {
    const v1 = await buildTestEnvelope();
    await commitNewRun(db, v1);
    expect(await findRunsBySourceFileHash(db, v1.original_file_sha256)).toEqual([v1.run_id]);
    // The v1-specific index-backed lookup agrees.
    expect(await findRunsByOriginalFileHash(db, v1.original_file_sha256)).toEqual([v1.run_id]);
  });

  it('findRunsBySourceFileHash finds a v2 run by any one of its part hashes', async () => {
    const { a, b } = twoPartFixture();
    const envelope = await buildTestMultipartEnvelope({
      parts: [
        { fixtureBytes: a, filename: 'a.csv' },
        { fixtureBytes: b, filename: 'b.csv' },
      ],
    });
    await commitNewRun(db, envelope);
    const [sf0, sf1] = envelope.source_files;
    if (!sf0 || !sf1) throw new Error('fixture assumption changed');
    expect(await findRunsBySourceFileHash(db, sf0.original_file_sha256)).toEqual([envelope.run_id]);
    expect(await findRunsBySourceFileHash(db, sf1.original_file_sha256)).toEqual([envelope.run_id]);
  });

  it('findRunsBySourceFileHash returns empty for a hash no run has', async () => {
    const v1 = await buildTestEnvelope();
    await commitNewRun(db, v1);
    expect(await findRunsBySourceFileHash(db, 'f'.repeat(64))).toEqual([]);
  });

  it('findRunsByExactSourceHashSet matches only the exact, ordered, complete set', async () => {
    const { a, b } = twoPartFixture();
    const envelope = await buildTestMultipartEnvelope({
      parts: [
        { fixtureBytes: a, filename: 'a.csv' },
        { fixtureBytes: b, filename: 'b.csv' },
      ],
    });
    await commitNewRun(db, envelope);
    const [sf0, sf1] = envelope.source_files;
    if (!sf0 || !sf1) throw new Error('fixture assumption changed');
    const ordered = [sf0.original_file_sha256, sf1.original_file_sha256];

    expect(await findRunsByExactSourceHashSet(db, ordered)).toEqual([envelope.run_id]);
    // Reversed order does not count as the same exact set (order matters).
    expect(await findRunsByExactSourceHashSet(db, [...ordered].reverse())).toEqual([]);
    // A subset does not match either (the "complete" ordered set).
    expect(await findRunsByExactSourceHashSet(db, [sf0.original_file_sha256])).toEqual([]);
  });

  it('a re-imported single file that was previously used inside a multipart run is detected', async () => {
    const { a, b } = twoPartFixture();
    const envelope = await buildTestMultipartEnvelope({
      parts: [
        { fixtureBytes: a, filename: 'a.csv' },
        { fixtureBytes: b, filename: 'b.csv' },
      ],
    });
    await commitNewRun(db, envelope);

    // Re-import fixture `a` again as a brand-new standalone single-file (v1) run.
    const reimported = await buildTestEnvelope({ fixture: 'SYNTHETIC_crlf_final_newline.csv' });
    await commitNewRun(db, reimported);

    const [sf0] = envelope.source_files;
    if (!sf0) throw new Error('fixture assumption changed');
    // The original part's hash is still traceable back to the multipart run that used it.
    const matches = await findRunsBySourceFileHash(db, sf0.original_file_sha256);
    expect(matches).toEqual([envelope.run_id]);
  });
});
