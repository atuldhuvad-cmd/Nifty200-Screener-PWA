import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commitBackupImport } from '../../src/core/backup/commit';
import { previewBackupImport } from '../../src/core/backup/classify';
import { buildBackupFile, type BackupFile } from '../../src/core/backup/manifest';
import { commitNewRun, getAllRuns, getRun } from '../../src/core/storage/runs';
import { openDatabase, STORE, type N200Database } from '../../src/core/storage/schema';
import { initialSyncRecord } from '../../src/core/storage/types';
import { withoutKey } from '../helpers';
import { buildTestEnvelope, buildTestMultipartEnvelope, freshDbName } from '../storage-helpers';

let db: N200Database;

beforeEach(async () => {
  ({ db } = await openDatabase({ name: freshDbName() }));
});

afterEach(() => {
  db.close();
});

async function storeCounts(): Promise<{ runs: number; variants: number; quarantine: number }> {
  return {
    runs: (await db.getAll(STORE.runs)).length,
    variants: (await db.getAll(STORE.runVariants)).length,
    quarantine: (await db.getAll(STORE.quarantineItems)).length,
  };
}

describe('previewBackupImport: read-only, zero writes', () => {
  it('performs no storage writes at all, including no quarantine writes for a corrupt entry', async () => {
    const good = await buildTestEnvelope({ runId: '11111111-1111-4111-8111-111111111111' });
    const before = await storeCounts();

    const file: BackupFile = buildBackupFile([
      { run_id: good.run_id, envelope: good, sync: initialSyncRecord('pending') },
    ]);
    // Splice in a corrupt entry directly (not schema-valid), same as a hand-edited backup file.
    file.runs.push({ not: 'an envelope' } as unknown as BackupFile['runs'][number]);
    file.run_ids.push('unparseable');
    file.run_count = 2;

    const preview = await previewBackupImport(db, file);
    expect(preview.counts.added).toBe(1);
    expect(preview.counts.rejected).toBe(1);

    expect(await storeCounts()).toEqual(before);
  });
});

describe('previewBackupImport + commitBackupImport: the six preview categories', () => {
  it('classifies and then commits a new envelope as "added" / committed', async () => {
    const envelope = await buildTestEnvelope({ runId: '11111111-1111-4111-8111-111111111111' });
    const file = buildBackupFile([
      { run_id: envelope.run_id, envelope, sync: initialSyncRecord('pending') },
    ]);

    const preview = await previewBackupImport(db, file);
    expect(preview.entries[0]?.category).toBe('added');

    const results = await commitBackupImport(db, file);
    expect(results).toEqual([
      { index: 0, outcome: { kind: 'committed', run_id: envelope.run_id } },
    ]);
    expect((await getRun(db, envelope.run_id))?.sync.state).toBe('pending');
  });

  it('classifies and then commits an identical existing envelope as "already_present" / no-op', async () => {
    const envelope = await buildTestEnvelope({ runId: '11111111-1111-4111-8111-111111111111' });
    await commitNewRun(db, envelope);
    const file = buildBackupFile([
      { run_id: envelope.run_id, envelope, sync: initialSyncRecord('pending') },
    ]);

    const preview = await previewBackupImport(db, file);
    expect(preview.entries[0]?.category).toBe('already_present');

    const results = await commitBackupImport(db, file);
    expect(results[0]?.outcome).toEqual({ kind: 'already_present', run_id: envelope.run_id });
  });

  it('classifies and then commits a divergent same-run_id envelope as "conflict", preserving the canonical run untouched', async () => {
    const canonical = await buildTestEnvelope({ runId: '11111111-1111-4111-8111-111111111111' });
    await commitNewRun(db, canonical);

    const { jcsSha256Hex } = await import('../../src/core/envelope/canonicalHash');
    const rest = withoutKey({ ...canonical, query_text: 'a different query' }, 'envelope_sha256');
    const divergent = { ...rest, envelope_sha256: await jcsSha256Hex(rest) };
    const file = buildBackupFile([
      { run_id: divergent.run_id, envelope: divergent, sync: initialSyncRecord('pending') },
    ]);

    const preview = await previewBackupImport(db, file);
    expect(preview.entries[0]?.category).toBe('conflict');

    const results = await commitBackupImport(db, file);
    expect(results[0]?.outcome).toEqual({ kind: 'conflict', run_id: canonical.run_id });

    const stored = await getRun(db, canonical.run_id);
    expect(stored?.envelope).toEqual(canonical); // canonical preserved, never overwritten
    expect(stored?.sync.state).toBe('conflict');

    const variant = await db.get(STORE.runVariants, [canonical.run_id, divergent.envelope_sha256]);
    expect(variant?.envelope).toEqual(divergent);
    expect(variant?.source).toBe('backup_import');
  });

  it('classifies a different run_id sharing the same source-file hash as "duplicate" (permitted, still added)', async () => {
    const a = await buildTestEnvelope({ runId: '11111111-1111-4111-8111-111111111111' });
    await commitNewRun(db, a);
    const b = await buildTestEnvelope({ runId: '22222222-2222-4222-8222-222222222222' });
    expect(b.original_file_sha256).toBe(a.original_file_sha256);

    const file = buildBackupFile([
      { run_id: b.run_id, envelope: b, sync: initialSyncRecord('pending') },
    ]);
    const preview = await previewBackupImport(db, file);
    expect(preview.entries[0]?.category).toBe('duplicate');

    const results = await commitBackupImport(db, file);
    expect(results[0]?.outcome).toEqual({ kind: 'committed', run_id: b.run_id });
    expect(await getRun(db, a.run_id)).toBeDefined();
    expect(await getRun(db, b.run_id)).toBeDefined();
  });

  it('classifies and then commits an unsupported schema_version as "unsupported"', async () => {
    const future = { run_id: '99999999-9999-4999-8999-999999999999', schema_version: '3' };
    const file: BackupFile = {
      format_version: '1',
      schema_version: '1',
      created_at: new Date().toISOString(),
      run_count: 1,
      run_ids: [future.run_id],
      envelope_hashes: {},
      runs: [future],
    };

    const preview = await previewBackupImport(db, file);
    expect(preview.entries[0]?.category).toBe('unsupported');

    const results = await commitBackupImport(db, file);
    expect(results[0]?.outcome).toEqual({ kind: 'unsupported_schema', run_id: future.run_id });
    expect((await getRun(db, future.run_id))?.sync.state).toBe('unsupported_schema');
  });

  it('classifies and then commits a corrupt entry as "rejected" / quarantined, without touching runs', async () => {
    const file: BackupFile = {
      format_version: '1',
      schema_version: '1',
      created_at: new Date().toISOString(),
      run_count: 1,
      run_ids: ['whatever'],
      envelope_hashes: {},
      runs: [{ garbage: true } as unknown as BackupFile['runs'][number]],
    };

    const preview = await previewBackupImport(db, file);
    expect(preview.entries[0]?.category).toBe('rejected');

    const results = await commitBackupImport(db, file);
    expect(results[0]?.outcome.kind).toBe('quarantined');
    expect(await getAllRuns(db)).toEqual([]);
    expect((await db.getAll(STORE.quarantineItems)).length).toBe(1);
  });
});

describe('commitBackupImport: multi-entry continuation after corruption', () => {
  it('one corrupt entry is quarantined without aborting the valid entries around it', async () => {
    const a = await buildTestEnvelope({ runId: '11111111-1111-4111-8111-111111111111' });
    const b = await buildTestEnvelope({
      runId: '22222222-2222-4222-8222-222222222222',
      fixture: 'SYNTHETIC_provider_mismatch.csv',
    });

    const file: BackupFile = {
      format_version: '1',
      schema_version: '1',
      created_at: new Date().toISOString(),
      run_count: 3,
      run_ids: [a.run_id, 'corrupt', b.run_id],
      envelope_hashes: {},
      runs: [a, { corrupt: true } as unknown as BackupFile['runs'][number], b],
    };

    const results = await commitBackupImport(db, file);
    expect(results).toHaveLength(3);
    expect(results[0]?.outcome).toEqual({ kind: 'committed', run_id: a.run_id });
    expect(results[1]?.outcome.kind).toBe('quarantined');
    expect(results[2]?.outcome).toEqual({ kind: 'committed', run_id: b.run_id });

    expect(await getRun(db, a.run_id)).toBeDefined();
    expect(await getRun(db, b.run_id)).toBeDefined();
    expect((await db.getAll(STORE.quarantineItems)).length).toBe(1);
  });
});

describe('export -> import round trip', () => {
  it('re-importing an unmodified export of the current runs is a no-op for every entry, hashes byte-for-byte unchanged', async () => {
    const a = await buildTestEnvelope({ runId: '11111111-1111-4111-8111-111111111111' });
    const { synthetic } = await import('../helpers');
    const b = await buildTestMultipartEnvelope({
      // Disjoint by ISIN (Step 5A's fixture pair) — most SYNTHETIC_* fixtures reuse the same
      // small ZZSYNTH ISIN pool and would otherwise trip a cross-part duplicate-ISIN block.
      parts: [
        {
          fixtureBytes: synthetic('SYNTHETIC_run_history_multipart_1.csv'),
          filename: 'part-a.csv',
        },
        {
          fixtureBytes: synthetic('SYNTHETIC_run_history_multipart_2.csv'),
          filename: 'part-b.csv',
        },
      ],
      runId: '22222222-2222-4222-8222-222222222222',
    });
    await commitNewRun(db, a);
    await commitNewRun(db, b);

    const exported = buildBackupFile(await getAllRuns(db));
    expect(exported.run_count).toBe(2);

    const results = await commitBackupImport(db, exported);
    expect(results.every((r) => r.outcome.kind === 'already_present')).toBe(true);

    const storedA = await getRun(db, a.run_id);
    const storedB = await getRun(db, b.run_id);
    expect((storedA?.envelope as { envelope_sha256: string }).envelope_sha256).toBe(
      a.envelope_sha256,
    );
    expect((storedB?.envelope as { envelope_sha256: string }).envelope_sha256).toBe(
      b.envelope_sha256,
    );
    expect(storedA?.envelope).toEqual(a);
    expect(storedB?.envelope).toEqual(b);
  });

  it('restoring an export into a fresh, empty database reproduces the same runs with unchanged hashes', async () => {
    const a = await buildTestEnvelope({ runId: '11111111-1111-4111-8111-111111111111' });
    await commitNewRun(db, a);
    const exported = buildBackupFile(await getAllRuns(db));

    const { db: freshDb } = await openDatabase({ name: freshDbName() });
    try {
      const results = await commitBackupImport(freshDb, exported);
      expect(results[0]?.outcome).toEqual({ kind: 'committed', run_id: a.run_id });
      const restored = await getRun(freshDb, a.run_id);
      expect(restored?.envelope).toEqual(a);
      expect((restored?.envelope as { original_file_sha256: string }).original_file_sha256).toBe(
        a.original_file_sha256,
      );
    } finally {
      freshDb.close();
    }
  });
});
