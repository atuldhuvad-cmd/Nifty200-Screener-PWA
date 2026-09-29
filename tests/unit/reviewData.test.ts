import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jcsSha256Hex } from '../../src/core/envelope/canonicalHash';
import { loadReviewData } from '../../src/core/review/queries';
import { keepLocalOnly } from '../../src/core/review/resolve';
import { listComparisonIdentityGroups } from '../../src/core/storage/comparisonIndex';
import { ingestEnvelopeBytes } from '../../src/core/storage/ingest';
import { applyTransition, commitNewRun, getRun } from '../../src/core/storage/runs';
import { isRunOpenable } from '../../src/core/storage/runStatus';
import { openDatabase, STORE, type N200Database } from '../../src/core/storage/schema';
import { withoutKey } from '../helpers';
import { buildTestEnvelope, freshDbName } from '../storage-helpers';

const RUN_A = '11111111-1111-4111-8111-111111111111';
const RUN_B = '22222222-2222-4222-8222-222222222222';

let db: N200Database;

beforeEach(async () => {
  ({ db } = await openDatabase({ name: freshDbName() }));
});

afterEach(() => {
  db.close();
});

async function divergent(runId: string, query: string) {
  const base = await buildTestEnvelope({ runId });
  const rest = withoutKey({ ...base, query_text: query }, 'envelope_sha256');
  return { ...rest, envelope_sha256: await jcsSha256Hex(rest) };
}

function bytesOf(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

async function makeConflict(runId: string, variantQueries: string[]): Promise<void> {
  await commitNewRun(db, await buildTestEnvelope({ runId }));
  for (const q of variantQueries) {
    const out = await ingestEnvelopeBytes(db, bytesOf(await divergent(runId, q)), 'backup_import');
    expect(out.kind).toBe('conflict');
  }
}

async function snapshotAll(): Promise<unknown> {
  return {
    runs: await db.getAll(STORE.runs),
    variants: await db.getAll(STORE.runVariants),
    quarantine: await db.getAll(STORE.quarantineItems),
    comparison: await db.getAll(STORE.comparisonIdentity),
  };
}

describe('loadReviewData', () => {
  it('groups each conflict run with its canonical envelope and every variant', async () => {
    await makeConflict(RUN_A, ['variant one', 'variant two']);
    await commitNewRun(db, await buildTestEnvelope({ runId: RUN_B }));

    const data = await loadReviewData(db);
    expect(data.conflicts).toHaveLength(1);
    const c = data.conflicts[0];
    expect(c?.run.run_id).toBe(RUN_A);
    expect(c?.variants).toHaveLength(2);
    expect(new Set(c?.variants.map((v) => v.source))).toEqual(new Set(['backup_import']));
    expect(data.resolved).toHaveLength(0);
    expect(data.quarantine).toHaveLength(0);
    expect(data.blockedRuns).toHaveLength(0);
  });

  it('lists quarantine items and unsupported/quarantined runs', async () => {
    await ingestEnvelopeBytes(db, bytesOf({ not: 'an envelope' }), 'backup_import');
    const future = { run_id: RUN_B, schema_version: '99', payload: 'opaque' };
    await ingestEnvelopeBytes(db, bytesOf(future), 'backup_import');

    const data = await loadReviewData(db);
    expect(data.quarantine).toHaveLength(1);
    expect(data.blockedRuns.map((r) => [r.run_id, r.sync.state])).toEqual([
      [RUN_B, 'unsupported_schema'],
    ]);
  });

  it('performs no writes', async () => {
    await makeConflict(RUN_A, ['variant one']);
    await ingestEnvelopeBytes(db, new TextEncoder().encode('garbage'), 'backup_import');
    const before = await snapshotAll();
    await loadReviewData(db);
    expect(await snapshotAll()).toEqual(before);
  });

  it('reads all three stores in one readonly transaction (no torn read)', async () => {
    await makeConflict(RUN_A, ['variant one']);
    const spy = vi.spyOn(db, 'transaction');
    await loadReviewData(db);
    expect(spy).toHaveBeenCalledTimes(1);
    const [stores, mode] = spy.mock.calls[0] ?? [];
    expect(mode).toBe('readonly');
    expect(new Set(stores as string[])).toEqual(
      new Set([STORE.runs, STORE.runVariants, STORE.quarantineItems]),
    );
  });
});

describe('keepLocalOnly', () => {
  it('moves a conflict run to local_only, preserving canonical envelope and variants', async () => {
    await makeConflict(RUN_A, ['variant one']);
    const before = await getRun(db, RUN_A);
    const variantsBefore = await db.getAll(STORE.runVariants);

    expect(await keepLocalOnly(db, RUN_A)).toEqual({ ok: true, state: 'local_only' });

    const after = await getRun(db, RUN_A);
    expect(after?.sync.state).toBe('local_only');
    expect(after?.envelope).toEqual(before?.envelope);
    expect(await db.getAll(STORE.runVariants)).toEqual(variantsBefore);

    const data = await loadReviewData(db);
    expect(data.conflicts).toHaveLength(0);
    expect(data.resolved.map((r) => [r.run.run_id, r.variants.length])).toEqual([[RUN_A, 1]]);
  });

  it('makes the run eligible for active views and comparison again', async () => {
    await makeConflict(RUN_A, ['variant one']);
    const conflicted = await getRun(db, RUN_A);
    expect(conflicted && isRunOpenable(conflicted)).toBe(false);
    expect(await listComparisonIdentityGroups(db)).toHaveLength(0);

    await keepLocalOnly(db, RUN_A);
    const resolved = await getRun(db, RUN_A);
    expect(resolved && isRunOpenable(resolved)).toBe(true);
    expect((await listComparisonIdentityGroups(db)).length).toBeGreaterThan(0);
  });

  it.each(['pending', 'remote_missing'] as const)(
    'rejects a %s run and changes nothing',
    async (state) => {
      await commitNewRun(db, await buildTestEnvelope({ runId: RUN_A }));
      if (state === 'remote_missing') {
        await applyTransition(db, RUN_A, { type: 'START_SYNC' });
        await applyTransition(db, RUN_A, { type: 'SYNC_SUCCEEDED' });
        await applyTransition(db, RUN_A, { type: 'REMOTE_MISSING_DETECTED' });
      }
      const before = await snapshotAll();
      expect(await keepLocalOnly(db, RUN_A)).toEqual({ ok: false, reason: 'not_in_conflict' });
      expect(await snapshotAll()).toEqual(before);
    },
  );

  it('reports run_not_found for an unknown run', async () => {
    expect(await keepLocalOnly(db, RUN_A)).toEqual({ ok: false, reason: 'run_not_found' });
  });

  it('a later divergent copy returns a local_only run to conflict', async () => {
    await makeConflict(RUN_A, ['variant one']);
    await keepLocalOnly(db, RUN_A);
    await ingestEnvelopeBytes(db, bytesOf(await divergent(RUN_A, 'variant two')), 'backup_import');
    expect((await getRun(db, RUN_A))?.sync.state).toBe('conflict');
    const data = await loadReviewData(db);
    expect(data.conflicts[0]?.variants).toHaveLength(2);
  });
});
