import { describe, expect, it } from 'vitest';
import { analyzeMultipartParts, type MultipartPartInput } from '../../src/core/csv/multipart';
import { buildMultipartEnvelope } from '../../src/core/envelope/buildMultipart';
import { validateEnvelope } from '../../src/core/envelope/validate';
import { buildCsv, SYNTHETIC_HEADER } from '../helpers';

function part(bytes: Uint8Array, filename: string): MultipartPartInput {
  return { bytes, filename, mimeType: 'text/csv' };
}

const rowWith = (sl: string, name: string, isin: string, nse: string): string[] => [
  sl,
  name,
  '',
  '1500',
  '1000',
  nse,
  isin,
];

async function goodMultipartEnvelope() {
  const a = buildCsv([SYNTHETIC_HEADER, rowWith('1', 'Alpha', 'ZZSYNTH00015', 'AAA')]);
  const b = buildCsv([SYNTHETIC_HEADER, rowWith('1', 'Beta', 'ZZSYNTH00023', 'BBB')]);
  const analysis = analyzeMultipartParts([part(a, 'a.csv'), part(b, 'b.csv')]);
  if (!analysis.ok || !analysis.canConfirm) throw new Error('fixture did not analyze cleanly');
  const result = await buildMultipartEnvelope({
    analysis,
    fileMimeTypes: ['text/csv', 'text/csv'],
    effectiveDate: '2026-09-27',
  });
  if (!result.ok) throw new Error('build failed');
  return result.envelope;
}

describe('buildMultipartEnvelope: happy path', () => {
  it('builds a schema-v2 envelope with two source files and two combined rows', async () => {
    const envelope = await goodMultipartEnvelope();
    expect(envelope.schema_version).toBe('2');
    expect(envelope.source_files).toHaveLength(2);
    expect(envelope.combined_row_refs).toEqual([
      { source_index: 0, source_row_index: 0 },
      { source_index: 1, source_row_index: 0 },
    ]);
    expect(envelope.stock_count).toBe(2);
    expect(envelope.unique_stock_count).toBe(2);
    expect(envelope.computed_metrics.volume_ratio_v1).toHaveLength(2);
  });

  it('preserves each source file independently (filename, mime, byte length, sha256, base64, headers, rows)', async () => {
    const envelope = await goodMultipartEnvelope();
    const [sf0, sf1] = envelope.source_files;
    expect(sf0?.original_filename).toBe('a.csv');
    expect(sf1?.original_filename).toBe('b.csv');
    expect(sf0?.headers).toEqual(SYNTHETIC_HEADER);
    expect(sf0?.rows).toEqual([rowWith('1', 'Alpha', 'ZZSYNTH00015', 'AAA')]);
    expect(sf0?.original_file_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sf0?.original_file_base64.length).toBeGreaterThan(0);
  });

  it('validates as `valid` through validateEnvelope', async () => {
    const envelope = await goodMultipartEnvelope();
    expect(await validateEnvelope(envelope)).toEqual({ status: 'valid' });
  });

  it('produces a stable hash: rebuilding from the same inputs with the same run_id/imported_at gives the same envelope_sha256', async () => {
    const a = buildCsv([SYNTHETIC_HEADER, rowWith('1', 'Alpha', 'ZZSYNTH00015', 'AAA')]);
    const b = buildCsv([SYNTHETIC_HEADER, rowWith('1', 'Beta', 'ZZSYNTH00023', 'BBB')]);
    const analysis = analyzeMultipartParts([part(a, 'a.csv'), part(b, 'b.csv')]);
    if (!analysis.ok || !analysis.canConfirm) throw new Error('unexpected');
    const importedAt = new Date('2026-09-27T12:00:00.000Z');
    const runId = '11111111-1111-4111-8111-111111111111';
    const first = await buildMultipartEnvelope({
      analysis,
      fileMimeTypes: ['text/csv', 'text/csv'],
      effectiveDate: '2026-09-27',
      importedAt,
      runId,
    });
    const second = await buildMultipartEnvelope({
      analysis,
      fileMimeTypes: ['text/csv', 'text/csv'],
      effectiveDate: '2026-09-27',
      importedAt,
      runId,
    });
    if (!first.ok || !second.ok) throw new Error('build failed');
    expect(first.envelope.envelope_sha256).toBe(second.envelope.envelope_sha256);
  });

  it('detects tampering: changing a source row after the fact changes the hash and fails validation', async () => {
    const envelope = await goodMultipartEnvelope();
    const [sf0, sf1] = envelope.source_files;
    if (!sf0 || !sf1) throw new Error('fixture assumption changed');
    const tampered = {
      ...envelope,
      source_files: [{ ...sf0, rows: [rowWith('1', 'Tampered', 'ZZSYNTH00015', 'AAA')] }, sf1],
    };
    const outcome = await validateEnvelope(tampered);
    expect(outcome.status).toBe('quarantined');
  });
});

describe('buildMultipartEnvelope: rejects an unconfirmable analysis', () => {
  it('returns cannot_confirm when a blocking overlap error is present', async () => {
    const a = buildCsv([SYNTHETIC_HEADER, rowWith('1', 'Alpha', 'ZZSYNTH00015', 'AAA')]);
    const b = buildCsv([SYNTHETIC_HEADER, rowWith('1', 'Alpha dup', 'ZZSYNTH00015', 'AAA')]);
    const analysis = analyzeMultipartParts([part(a, 'a.csv'), part(b, 'b.csv')]);
    if (!analysis.ok) throw new Error('unexpected');
    expect(analysis.canConfirm).toBe(false);
    const result = await buildMultipartEnvelope({
      analysis,
      fileMimeTypes: ['text/csv', 'text/csv'],
      effectiveDate: '2026-09-27',
    });
    expect(result).toEqual({ ok: false, reason: 'cannot_confirm' });
  });
});

describe('validateEnvelope: multipart replay', () => {
  it('reproduces the combined ordered rows and computed metrics via replay for every SYNTHETIC-derived part', async () => {
    const envelope = await goodMultipartEnvelope();
    expect(await validateEnvelope(envelope)).toEqual({ status: 'valid' });
  });

  it('quarantines when combined_row_refs is reordered relative to what a fresh replay produces', async () => {
    const envelope = await goodMultipartEnvelope();
    const reordered = {
      ...envelope,
      combined_row_refs: [...envelope.combined_row_refs].reverse(),
    };
    const outcome = await validateEnvelope(reordered);
    expect(outcome).toMatchObject({ status: 'quarantined' });
    if (outcome.status === 'quarantined') {
      expect(outcome.reasons).toContain('ENVELOPE_HASH_MISMATCH');
    }
  });

  it('quarantines with COMBINED_ROW_REF_OUT_OF_RANGE when a ref points past a source file', async () => {
    const envelope = await goodMultipartEnvelope();
    const [, ref1] = envelope.combined_row_refs;
    if (!ref1) throw new Error('fixture assumption changed');
    const bad = {
      ...envelope,
      combined_row_refs: [{ source_index: 0, source_row_index: 99 }, ref1],
    };
    const outcome = await validateEnvelope(bad);
    expect(outcome).toMatchObject({ status: 'quarantined' });
    if (outcome.status === 'quarantined') {
      expect(outcome.reasons).toContain('COMBINED_ROW_REF_OUT_OF_RANGE');
    }
  });

  it('quarantines with UNIQUE_STOCK_COUNT_MISMATCH when unique_stock_count is tampered', async () => {
    const envelope = await goodMultipartEnvelope();
    const bad = { ...envelope, unique_stock_count: envelope.unique_stock_count + 1 };
    const outcome = await validateEnvelope(bad);
    expect(outcome).toMatchObject({ status: 'quarantined' });
    if (outcome.status === 'quarantined') {
      expect(outcome.reasons).toContain('UNIQUE_STOCK_COUNT_MISMATCH');
    }
  });

  it('quarantines with SOURCE_FILE_HASH_MISMATCH when a source file hash is tampered', async () => {
    const envelope = await goodMultipartEnvelope();
    const [sf0, sf1] = envelope.source_files;
    if (!sf0 || !sf1) throw new Error('fixture assumption changed');
    const bad = {
      ...envelope,
      source_files: [{ ...sf0, original_file_sha256: 'f'.repeat(64) }, sf1],
    };
    const outcome = await validateEnvelope(bad);
    expect(outcome).toMatchObject({ status: 'quarantined' });
    if (outcome.status === 'quarantined') {
      expect(outcome.reasons).toContain('SOURCE_FILE_HASH_MISMATCH');
    }
  });
});
