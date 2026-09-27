import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyzeCsvBytes } from '../../src/core/csv/analyze';
import { buildEnvelope } from '../../src/core/envelope/build';
import {
  isinIdentityKey,
  nseIdentityKey,
  queryComparisonIndexByIdentity,
} from '../../src/core/storage/comparisonIndex';
import { commitNewRun, rebuildComparisonIndexForRun } from '../../src/core/storage/runs';
import {
  COMPARISON_BY_RUN_ID,
  openDatabase,
  STORE,
  type N200Database,
} from '../../src/core/storage/schema';
import { synthetic } from '../helpers';
import { freshDbName } from '../storage-helpers';

let db: N200Database;

beforeEach(async () => {
  db = await openDatabase({ name: freshDbName() });
});

afterEach(() => {
  db.close();
});

async function buildFrom(fixture: string, runId: string) {
  const bytes = synthetic(fixture);
  const analysis = analyzeCsvBytes(bytes);
  if (!analysis.ok || !analysis.canConfirm)
    throw new Error(`fixture did not analyze cleanly: ${fixture}`);
  const result = await buildEnvelope({
    originalBytes: bytes,
    analysis,
    originalFilename: fixture,
    originalFileMimeType: 'text/csv',
    effectiveDate: '2026-09-27',
    runId,
  });
  if (!result.ok) throw new Error('build failed');
  return result.envelope;
}

describe('comparison-identity index: derived from envelopes on commit', () => {
  it('indexes ISIN-matched rows under isin: and NSE-only rows under nse:', async () => {
    const envelope = await buildFrom(
      'SYNTHETIC_missing_identifiers.csv',
      '11111111-1111-4111-8111-111111111111',
    );
    await commitNewRun(db, envelope);

    const rows = await db.getAllFromIndex(
      STORE.comparisonIdentity,
      COMPARISON_BY_RUN_ID,
      envelope.run_id,
    );
    // Fixture row 1 (index 0) "Synthetic No ISIN" has no ISIN but a valid NSE Code "SYNA".
    const nseRow = rows.find((r) => r.row_index === 0);
    expect(nseRow).toMatchObject({
      match_method: 'nse_code_provisional',
      identity_key: nseIdentityKey('SYNA'),
    });

    // Fixture row 5 (index 4) "Synthetic Needs Norm" has a normalizable ISIN "ZZSYNTH00056".
    const isinRow = rows.find((r) => r.row_index === 4);
    expect(isinRow).toMatchObject({
      match_method: 'isin',
      identity_key: isinIdentityKey('ZZSYNTH00056'),
    });
  });

  it('excludes rows with neither usable identifier from the index (row 3 and row 7 of the fixture)', async () => {
    const envelope = await buildFrom(
      'SYNTHETIC_missing_identifiers.csv',
      '22222222-2222-4222-8222-222222222222',
    );
    await commitNewRun(db, envelope);
    const rows = await db.getAllFromIndex(
      STORE.comparisonIdentity,
      COMPARISON_BY_RUN_ID,
      envelope.run_id,
    );
    const indices = rows.map((r) => r.row_index);
    expect(indices).not.toContain(2);
    expect(indices).not.toContain(6);
  });

  it('queryComparisonIndexByIdentity finds a stock across multiple runs by the same ISIN', async () => {
    const run1 = await buildFrom(
      'SYNTHETIC_crlf_final_newline.csv',
      '33333333-3333-4333-8333-333333333333',
    );
    const run2 = await buildFrom(
      'SYNTHETIC_crlf_final_newline.csv',
      '44444444-4444-4444-8444-444444444444',
    );
    await commitNewRun(db, run1);
    await commitNewRun(db, run2);

    // Both runs share the same fixture content, so row 0's ISIN (ZZSYNTH00015) appears in both.
    const matches = await queryComparisonIndexByIdentity(db, isinIdentityKey('ZZSYNTH00015'));
    const runIds = matches.map((m) => m.run_id).sort();
    expect(runIds).toEqual([run1.run_id, run2.run_id].sort());
  });

  it('is rebuildable from the stored envelope alone (a disposable cache, not the source of truth)', async () => {
    const envelope = await buildFrom(
      'SYNTHETIC_missing_identifiers.csv',
      '55555555-5555-4555-8555-555555555555',
    );
    await commitNewRun(db, envelope);
    const before = await db.getAllFromIndex(
      STORE.comparisonIdentity,
      COMPARISON_BY_RUN_ID,
      envelope.run_id,
    );

    // Simulate a corrupted/stale index by wiping it, then rebuild from the (untouched) envelope.
    const tx = db.transaction(STORE.comparisonIdentity, 'readwrite');
    for (const row of before) if (row.id !== undefined) await tx.store.delete(row.id);
    await tx.done;
    expect(
      await db.getAllFromIndex(STORE.comparisonIdentity, COMPARISON_BY_RUN_ID, envelope.run_id),
    ).toEqual([]);

    await rebuildComparisonIndexForRun(db, envelope.run_id);
    const after = await db.getAllFromIndex(
      STORE.comparisonIdentity,
      COMPARISON_BY_RUN_ID,
      envelope.run_id,
    );
    expect(
      after
        .map((r) => ({
          row_index: r.row_index,
          match_method: r.match_method,
          identity_key: r.identity_key,
        }))
        .sort((a, b) => a.row_index - b.row_index),
    ).toEqual(
      before
        .map((r) => ({
          row_index: r.row_index,
          match_method: r.match_method,
          identity_key: r.identity_key,
        }))
        .sort((a, b) => a.row_index - b.row_index),
    );
  });
});
