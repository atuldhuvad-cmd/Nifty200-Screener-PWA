import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyzeCsvBytes } from '../../src/core/csv/analyze';
import { buildEnvelope } from '../../src/core/envelope/build';
import {
  findIdentityConflicts,
  isinIdentityKey,
  nseIdentityKey,
  queryComparisonIndexByIdentity,
} from '../../src/core/storage/comparisonIndex';
import {
  applyTransition,
  commitNewRun,
  rebuildComparisonIndexForRun,
} from '../../src/core/storage/runs';
import {
  COMPARISON_BY_RUN_ID,
  openDatabase,
  STORE,
  type N200Database,
} from '../../src/core/storage/schema';
import { buildCsv, synthetic, SYNTHETIC_HEADER } from '../helpers';
import { freshDbName } from '../storage-helpers';

let db: N200Database;

beforeEach(async () => {
  ({ db } = await openDatabase({ name: freshDbName() }));
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
      normalized_isin: null,
      normalized_nse_code: 'SYNA',
    });

    // Fixture row 5 (index 4) "Synthetic Needs Norm" has a normalizable ISIN "ZZSYNTH00056"
    // AND a normalizable NSE Code "SYNE" — both must be stored (Bugbot P2-2), even though the
    // match method is ISIN-primary.
    const isinRow = rows.find((r) => r.row_index === 4);
    expect(isinRow).toMatchObject({
      match_method: 'isin',
      identity_key: isinIdentityKey('ZZSYNTH00056'),
      normalized_isin: 'ZZSYNTH00056',
      normalized_nse_code: 'SYNE',
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

describe('Bugbot P1-2: comparison queries exclude ineligible canonical run states', () => {
  it('a run in conflict, quarantined, or unsupported_schema disappears from queries immediately, and reappears once restored to an eligible state', async () => {
    for (const [state, resolutionEvent] of [
      ['conflict', { type: 'KEEP_LOCAL_ONLY' as const }],
      ['quarantined', null],
      ['unsupported_schema', null],
    ] as const) {
      const envelope = await buildFrom('SYNTHETIC_crlf_final_newline.csv', crypto.randomUUID());
      await commitNewRun(db, envelope);
      const key = isinIdentityKey('ZZSYNTH00015');

      expect((await queryComparisonIndexByIdentity(db, key)).map((r) => r.run_id)).toContain(
        envelope.run_id,
      );

      if (state === 'unsupported_schema') {
        // unsupported_schema is an *initial* state assigned at ingest, never reached by
        // transition() from an eligible state — simulate it by writing the run record directly,
        // the same way ingest.ts would for a genuinely unrecognized schema version.
        const record = await db.get(STORE.runs, envelope.run_id);
        if (!record) throw new Error('unexpected: run not found');
        await db.put(STORE.runs, {
          ...record,
          sync: { ...record.sync, state: 'unsupported_schema' },
        });
      } else if (state === 'conflict') {
        await applyTransition(db, envelope.run_id, { type: 'INGEST_CONFLICT_VARIANT' });
      } else {
        await applyTransition(db, envelope.run_id, { type: 'QUARANTINE' });
      }

      const afterExclusion = await queryComparisonIndexByIdentity(db, key);
      expect(afterExclusion.map((r) => r.run_id)).not.toContain(envelope.run_id);

      if (resolutionEvent) {
        // conflict -> local_only is one of the brief's actual resolution paths.
        await applyTransition(db, envelope.run_id, resolutionEvent);
        const afterRestore = await queryComparisonIndexByIdentity(db, key);
        expect(afterRestore.map((r) => r.run_id)).toContain(envelope.run_id);
      }
    }
  });

  it('does not delete or modify the underlying index rows — filtering is applied at query time', async () => {
    const envelope = await buildFrom('SYNTHETIC_crlf_final_newline.csv', crypto.randomUUID());
    await commitNewRun(db, envelope);
    await applyTransition(db, envelope.run_id, { type: 'QUARANTINE' });

    const rawRows = await db.getAllFromIndex(
      STORE.comparisonIdentity,
      COMPARISON_BY_RUN_ID,
      envelope.run_id,
    );
    expect(rawRows.length).toBeGreaterThan(0); // the row is still physically there
    expect(
      (await queryComparisonIndexByIdentity(db, isinIdentityKey('ZZSYNTH00015'))).map(
        (r) => r.run_id,
      ),
    ).not.toContain(envelope.run_id); // but excluded from the query result
  });
});

describe('Bugbot P2-2: same-NSE-Code/different-ISIN is detected as an identity conflict', () => {
  it('flags two rows sharing an NSE Code but carrying different ISINs', async () => {
    const bytes = buildCsv([
      SYNTHETIC_HEADER,
      ['1', 'Synthetic A', '', '1500', '1000', 'SYNSHARED', 'ZZSYNTH00015'],
      ['2', 'Synthetic B', '', '1500', '1000', 'SYNSHARED', 'ZZSYNTH00023'],
    ]);
    const analysis = analyzeCsvBytes(bytes);
    if (!analysis.ok || !analysis.canConfirm) throw new Error('fixture did not analyze cleanly');
    const built = await buildEnvelope({
      originalBytes: bytes,
      analysis,
      originalFilename: 'conflict.csv',
      originalFileMimeType: 'text/csv',
      effectiveDate: '2026-09-27',
    });
    if (!built.ok) throw new Error('build failed');
    await commitNewRun(db, built.envelope);

    const conflicts = await findIdentityConflicts(db);
    const match = conflicts.find((c) => c.normalized_nse_code === 'SYNSHARED');
    expect(match).toBeDefined();
    expect(match?.entries.map((e) => e.normalized_isin).sort()).toEqual([
      'ZZSYNTH00015',
      'ZZSYNTH00023',
    ]);
  });

  it('does not flag rows that share an NSE Code with the SAME ISIN (e.g. the same stock across two runs)', async () => {
    const run1 = await buildFrom('SYNTHETIC_crlf_final_newline.csv', crypto.randomUUID());
    const run2 = await buildFrom('SYNTHETIC_crlf_final_newline.csv', crypto.randomUUID());
    await commitNewRun(db, run1);
    await commitNewRun(db, run2);

    const conflicts = await findIdentityConflicts(db);
    expect(conflicts.find((c) => c.normalized_nse_code === 'SYNA')).toBeUndefined();
  });

  it('does not flag rows with only one non-null ISIN sharing that NSE Code', async () => {
    const envelope = await buildFrom('SYNTHETIC_missing_identifiers.csv', crypto.randomUUID());
    await commitNewRun(db, envelope);
    // Row 0 ("Synthetic No ISIN") has NSE=SYNA and no ISIN — a lone NSE-only row must never
    // register as a conflict by itself.
    const conflicts = await findIdentityConflicts(db);
    expect(conflicts.find((c) => c.normalized_nse_code === 'SYNA')).toBeUndefined();
  });
});
