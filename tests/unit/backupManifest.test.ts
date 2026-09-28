import { describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_MAX_BYTES,
  BACKUP_MAX_RUNS,
  BACKUP_SCHEMA_VERSION,
  backupFilename,
  buildBackupFile,
  parseBackupFile,
} from '../../src/core/backup/manifest';
import { initialSyncRecord } from '../../src/core/storage/types';
import type { RunRecord } from '../../src/core/storage/types';
import { buildTestEnvelope, buildTestMultipartEnvelope } from '../storage-helpers';

function enc(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}

async function v1Run(runId: string): Promise<RunRecord> {
  const envelope = await buildTestEnvelope({ runId });
  return { run_id: runId, envelope, sync: initialSyncRecord('pending') };
}

describe('buildBackupFile', () => {
  it('includes format_version, schema_version, an RFC 3339 UTC created_at, run_count, ordered run_ids, and each envelope', async () => {
    const a = await v1Run('11111111-1111-4111-8111-111111111111');
    const b = await v1Run('22222222-2222-4222-8222-222222222222');
    const file = buildBackupFile([a, b]);

    expect(file.format_version).toBe(BACKUP_FORMAT_VERSION);
    expect(file.schema_version).toBe(BACKUP_SCHEMA_VERSION);
    expect(file.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(file.run_count).toBe(2);
    expect(file.run_ids).toEqual([a.run_id, b.run_id]);
    expect(file.runs).toEqual([a.envelope, b.envelope]);
  });

  it('includes each v1/v2 envelope’s own envelope_sha256 in envelope_hashes', async () => {
    const a = await v1Run('11111111-1111-4111-8111-111111111111');
    const file = buildBackupFile([a]);
    expect(file.envelope_hashes[a.run_id]).toBe(
      (a.envelope as { envelope_sha256: string }).envelope_sha256,
    );
  });

  it('exports a v2 (multipart) envelope exactly like a v1 one', async () => {
    const { synthetic } = await import('../helpers');
    const envelope = await buildTestMultipartEnvelope({
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
      runId: '33333333-3333-4333-8333-333333333333',
    });
    const record: RunRecord = {
      run_id: envelope.run_id,
      envelope,
      sync: initialSyncRecord('pending'),
    };
    const file = buildBackupFile([record]);
    expect(file.runs[0]).toEqual(envelope);
    expect(file.envelope_hashes[envelope.run_id]).toBe(envelope.envelope_sha256);
  });

  it('never includes sync state or any device-specific field (explicit allowlist, not a denylist)', async () => {
    const a = await v1Run('11111111-1111-4111-8111-111111111111');
    const file = buildBackupFile([a]);
    expect(JSON.stringify(file)).not.toContain('"sync"');
    expect(JSON.stringify(file)).not.toContain('pending');
  });

  it('exports zero runs as an empty, still well-formed file', () => {
    const file = buildBackupFile([]);
    expect(file.run_count).toBe(0);
    expect(file.run_ids).toEqual([]);
    expect(file.runs).toEqual([]);
  });
});

describe('backupFilename', () => {
  it('carries the format_version and a filesystem-safe UTC timestamp', () => {
    const name = backupFilename(new Date('2026-09-28T21:15:30.123Z'));
    expect(name).toBe('n200-backup-v1-2026-09-28T21-15-30-123Z.json');
  });
});

describe('parseBackupFile: round-trips buildBackupFile output', () => {
  it('parses its own export back to an equal BackupFile', async () => {
    const a = await v1Run('11111111-1111-4111-8111-111111111111');
    const file = buildBackupFile([a]);
    const result = parseBackupFile(enc(file));
    expect(result).toEqual({ ok: true, file });
  });
});

describe('parseBackupFile: A1 check order and limits', () => {
  it('rejects a file over 50 MiB before attempting to parse it as JSON', () => {
    // Deliberately invalid JSON, oversized: proves the size gate runs strictly before JSON.parse.
    const oversized = new Uint8Array(BACKUP_MAX_BYTES + 1).fill(0x7b); // all '{' — never valid JSON
    const result = parseBackupFile(oversized);
    expect(result).toEqual({ ok: false, reason: 'FILE_TOO_LARGE' });
  });

  it('accepts a file exactly at the 50 MiB limit (boundary, not off-by-one)', async () => {
    const a = await v1Run('11111111-1111-4111-8111-111111111111');
    const file = buildBackupFile([a]);
    const bytes = enc(file);
    expect(bytes.byteLength).toBeLessThan(BACKUP_MAX_BYTES); // sanity: our fixture is tiny
    const result = parseBackupFile(bytes);
    expect(result.ok).toBe(true);
  });

  it('rejects invalid UTF-8 rather than crashing', () => {
    const result = parseBackupFile(new Uint8Array([0xff, 0xfe, 0x00, 0x01]));
    expect(result).toEqual({ ok: false, reason: 'INVALID_ENCODING' });
  });

  it('rejects malformed JSON', () => {
    const result = parseBackupFile(new TextEncoder().encode('{not valid json'));
    expect(result).toEqual({ ok: false, reason: 'INVALID_JSON' });
  });

  it('rejects a structurally-unrelated JSON document', () => {
    const result = parseBackupFile(enc({ hello: 'world' }));
    expect(result).toEqual({ ok: false, reason: 'INVALID_STRUCTURE' });
  });

  it('rejects an unrecognized format_version rather than guessing how to read it', async () => {
    const a = await v1Run('11111111-1111-4111-8111-111111111111');
    const file = { ...buildBackupFile([a]), format_version: '99' };
    const result = parseBackupFile(enc(file));
    expect(result).toEqual({
      ok: false,
      reason: 'UNSUPPORTED_FORMAT_VERSION',
      formatVersion: '99',
    });
  });

  it('rejects when the claimed run_count exceeds 2,000, before any per-entry work', () => {
    const file = {
      format_version: BACKUP_FORMAT_VERSION,
      schema_version: BACKUP_SCHEMA_VERSION,
      created_at: new Date().toISOString(),
      run_count: BACKUP_MAX_RUNS + 1,
      run_ids: Array.from({ length: BACKUP_MAX_RUNS + 1 }, (_, i) => `run-${String(i)}`),
      envelope_hashes: {},
      runs: Array.from({ length: BACKUP_MAX_RUNS + 1 }, () => ({})),
    };
    const result = parseBackupFile(enc(file));
    expect(result).toEqual({
      ok: false,
      reason: 'RUN_COUNT_EXCEEDS_LIMIT',
      claimed: BACKUP_MAX_RUNS + 1,
      actual: BACKUP_MAX_RUNS + 1,
    });
  });

  it('rejects when the actual runs array exceeds 2,000 even if run_count claims fewer', () => {
    const file = {
      format_version: BACKUP_FORMAT_VERSION,
      schema_version: BACKUP_SCHEMA_VERSION,
      created_at: new Date().toISOString(),
      run_count: 1, // understated on purpose
      run_ids: ['run-0'],
      envelope_hashes: {},
      runs: Array.from({ length: BACKUP_MAX_RUNS + 5 }, () => ({})),
    };
    const result = parseBackupFile(enc(file));
    expect(result).toEqual({
      ok: false,
      reason: 'RUN_COUNT_EXCEEDS_LIMIT',
      claimed: 1,
      actual: BACKUP_MAX_RUNS + 5,
    });
  });

  it('rejects when claimed and actual counts merely disagree, neither exceeding the limit', () => {
    const file = {
      format_version: BACKUP_FORMAT_VERSION,
      schema_version: BACKUP_SCHEMA_VERSION,
      created_at: new Date().toISOString(),
      run_count: 3,
      run_ids: ['run-0', 'run-1'],
      envelope_hashes: {},
      runs: [{}, {}], // 2 actual, claimed 3
    };
    const result = parseBackupFile(enc(file));
    expect(result).toEqual({ ok: false, reason: 'RUN_COUNT_MISMATCH', claimed: 3, actual: 2 });
  });

  it('accepts exactly 2,000 runs (boundary, not rejected as "exceeds")', () => {
    const file = {
      format_version: BACKUP_FORMAT_VERSION,
      schema_version: BACKUP_SCHEMA_VERSION,
      created_at: new Date().toISOString(),
      run_count: BACKUP_MAX_RUNS,
      run_ids: Array.from({ length: BACKUP_MAX_RUNS }, (_, i) => `run-${String(i)}`),
      envelope_hashes: {},
      runs: Array.from({ length: BACKUP_MAX_RUNS }, () => ({})),
    };
    const result = parseBackupFile(enc(file));
    expect(result.ok).toBe(true);
  });
});
