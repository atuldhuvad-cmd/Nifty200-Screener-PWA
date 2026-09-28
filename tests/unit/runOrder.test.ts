import { describe, expect, it } from 'vitest';
import { compareRunsForHistory, sortRunsForHistory } from '../../src/core/display/runOrder';
import { initialSyncRecord } from '../../src/core/storage/types';
import type { RunRecord } from '../../src/core/storage/types';
import { buildTestEnvelope } from '../storage-helpers';

async function run(options: {
  runId: string;
  effectiveDate: string;
  importedAt: string;
}): Promise<RunRecord> {
  const envelope = await buildTestEnvelope({
    runId: options.runId,
    effectiveDate: options.effectiveDate,
    importedAt: new Date(options.importedAt),
  });
  return { run_id: envelope.run_id, envelope, sync: initialSyncRecord('pending') };
}

function unsupported(runId: string): RunRecord {
  return {
    run_id: runId,
    envelope: { run_id: runId, schema_version: '99' },
    sync: initialSyncRecord('unsupported_schema'),
  };
}

describe('compareRunsForHistory / sortRunsForHistory (Views §1 default order)', () => {
  it('orders by effective_date descending first', async () => {
    const older = await run({
      runId: '11111111-1111-4111-8111-111111111111',
      effectiveDate: '2026-01-01',
      importedAt: '2026-01-01T00:00:00.000Z',
    });
    const newer = await run({
      runId: '22222222-2222-4222-8222-222222222222',
      effectiveDate: '2026-02-01',
      importedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(sortRunsForHistory([older, newer]).map((r) => r.run_id)).toEqual([
      newer.run_id,
      older.run_id,
    ]);
  });

  it('falls back to imported_at descending when effective_date ties', async () => {
    const earlyImport = await run({
      runId: '11111111-1111-4111-8111-111111111111',
      effectiveDate: '2026-01-01',
      importedAt: '2026-01-01T08:00:00.000Z',
    });
    const lateImport = await run({
      runId: '22222222-2222-4222-8222-222222222222',
      effectiveDate: '2026-01-01',
      importedAt: '2026-01-01T09:00:00.000Z',
    });
    expect(sortRunsForHistory([earlyImport, lateImport]).map((r) => r.run_id)).toEqual([
      lateImport.run_id,
      earlyImport.run_id,
    ]);
  });

  it('falls back to run_id as the final tiebreaker when both dates tie, keeping every run separately identifiable', async () => {
    const sameInstant = '2026-01-01T09:00:00.000Z';
    const a = await run({
      runId: 'bbbbbbbb-1111-4111-8111-111111111111',
      effectiveDate: '2026-01-01',
      importedAt: sameInstant,
    });
    const b = await run({
      runId: 'aaaaaaaa-2222-4222-8222-222222222222',
      effectiveDate: '2026-01-01',
      importedAt: sameInstant,
    });
    // Both same-date runs remain distinct entries, deterministically ordered by run_id.
    const sorted = sortRunsForHistory([a, b]);
    expect(sorted.map((r) => r.run_id)).toEqual([b.run_id, a.run_id]);
    expect(new Set(sorted.map((r) => r.run_id)).size).toBe(2);
  });

  it('is deterministic and idempotent regardless of input order', async () => {
    const r1 = await run({
      runId: '11111111-1111-4111-8111-111111111111',
      effectiveDate: '2026-01-01',
      importedAt: '2026-01-01T00:00:00.000Z',
    });
    const r2 = await run({
      runId: '22222222-2222-4222-8222-222222222222',
      effectiveDate: '2026-02-01',
      importedAt: '2026-01-01T00:00:00.000Z',
    });
    const r3 = await run({
      runId: '33333333-3333-4333-8333-333333333333',
      effectiveDate: '2026-01-15',
      importedAt: '2026-01-01T00:00:00.000Z',
    });
    const forward = sortRunsForHistory([r1, r2, r3]).map((r) => r.run_id);
    const backward = sortRunsForHistory([r3, r2, r1]).map((r) => r.run_id);
    expect(forward).toEqual([r2.run_id, r3.run_id, r1.run_id]);
    expect(backward).toEqual(forward);
  });

  it('sorts a run with an unsupported schema after every supported run, ordered by run_id among themselves', async () => {
    const supported = await run({
      runId: '11111111-1111-4111-8111-111111111111',
      effectiveDate: '2020-01-01', // deliberately the earliest date, to prove it still sorts first
      importedAt: '2020-01-01T00:00:00.000Z',
    });
    const unsupportedB = unsupported('bbbbbbbb-0000-4000-8000-000000000000');
    const unsupportedA = unsupported('aaaaaaaa-0000-4000-8000-000000000000');
    expect(
      sortRunsForHistory([unsupportedB, supported, unsupportedA]).map((r) => r.run_id),
    ).toEqual([supported.run_id, unsupportedA.run_id, unsupportedB.run_id]);
  });

  it('compareRunsForHistory alone reproduces the same order as Array.prototype.sort', async () => {
    const a = await run({
      runId: '11111111-1111-4111-8111-111111111111',
      effectiveDate: '2026-01-01',
      importedAt: '2026-01-01T00:00:00.000Z',
    });
    const b = await run({
      runId: '22222222-2222-4222-8222-222222222222',
      effectiveDate: '2026-02-01',
      importedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(compareRunsForHistory(a, b) > 0).toBe(true);
    expect(compareRunsForHistory(b, a) < 0).toBe(true);
    expect(compareRunsForHistory(a, a)).toBe(0);
  });
});
