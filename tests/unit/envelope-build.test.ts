import { describe, expect, it } from 'vitest';
import { analyzeCsvBytes } from '../../src/core/csv/analyze';
import { decodeBase64 } from '../../src/core/envelope/base64';
import { jcsSha256Hex } from '../../src/core/envelope/canonicalHash';
import { buildEnvelope } from '../../src/core/envelope/build';
import { sha256Hex } from '../../src/core/envelope/hash';
import validateSchema from '../../src/core/envelope/schema/generated/validateEnvelopeV1';
import { buildCsv, synthetic, SYNTHETIC_HEADER, withoutKey } from '../helpers';

const FIXED_RUN_ID = '11111111-1111-4111-8111-111111111111';
const FIXED_DATE = new Date('2026-09-27T12:00:00.000Z');

async function buildFrom(
  fixture: string,
  overrides: Partial<Parameters<typeof buildEnvelope>[0]> = {},
) {
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
    importedAt: FIXED_DATE,
    runId: FIXED_RUN_ID,
    ...overrides,
  });
  if (!result.ok) throw new Error(`build failed: ${result.reason}`);
  return result.envelope;
}

describe('buildEnvelope', () => {
  it('produces a schema-valid v1 envelope', async () => {
    const envelope = await buildFrom('SYNTHETIC_crlf_final_newline.csv');
    expect(validateSchema(envelope)).toBe(true);
    expect(validateSchema.errors).toBeFalsy();
  });

  it('sets fixed constants and provenance fields', async () => {
    const envelope = await buildFrom('SYNTHETIC_crlf_final_newline.csv');
    expect(envelope.schema_version).toBe('1');
    expect(envelope.universe).toBe('Nifty 200');
    expect(envelope.universe_validation).toBe('user_confirmed');
    expect(envelope.effective_date).toBe('2026-09-27');
    expect(envelope.imported_at).toBe('2026-09-27T12:00:00.000Z');
    expect(envelope.run_id).toBe(FIXED_RUN_ID);
    expect(envelope.original_filename).toBe('SYNTHETIC_crlf_final_newline.csv');
    expect(envelope.original_file_mime_type).toBe('text/csv');
    expect(envelope.envelope_hash_algorithm).toBe('sha256-jcs-rfc8785-v1');
    expect(envelope.parser).toMatchObject({ parser_id: 'csv-parse', config_id: 'n200-csv-v1' });
  });

  it('stores the selected universe label', async () => {
    const envelope = await buildFrom('SYNTHETIC_crlf_final_newline.csv', {
      universe: 'Nifty Smallcap 500',
    });
    expect(envelope.universe).toBe('Nifty Smallcap 500');
    expect(validateSchema(envelope)).toBe(true);
  });

  it('generates a random UUID v4 run_id when none is supplied', async () => {
    const buildWithoutRunId = async () => {
      const bytes = synthetic('SYNTHETIC_crlf_final_newline.csv');
      const analysis = analyzeCsvBytes(bytes);
      if (!analysis.ok || !analysis.canConfirm) throw new Error('fixture did not analyze cleanly');
      const result = await buildEnvelope({
        originalBytes: bytes,
        analysis,
        originalFilename: 'x.csv',
        originalFileMimeType: 'text/csv',
        effectiveDate: '2026-09-27',
        importedAt: FIXED_DATE,
      });
      if (!result.ok) throw new Error('build failed');
      return result.envelope;
    };
    const e1 = await buildWithoutRunId();
    const e2 = await buildWithoutRunId();
    expect(e1.run_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(e1.run_id).not.toBe(e2.run_id); // two same-date runs remain distinct (brief, run_id)
  });

  it('the Base64 round trip reproduces original_file_sha256', async () => {
    const bytes = synthetic('SYNTHETIC_non_ascii_names.csv');
    const envelope = await buildFrom('SYNTHETIC_non_ascii_names.csv');
    const decoded = decodeBase64(envelope.original_file_base64);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(Array.from(decoded.bytes)).toEqual(Array.from(bytes));
    expect(await sha256Hex(decoded.bytes)).toBe(envelope.original_file_sha256);
    expect(envelope.original_file_byte_length).toBe(bytes.length);
  });

  it('envelope_sha256 is reproducible by recomputing JCS over every field except itself', async () => {
    const envelope = await buildFrom('SYNTHETIC_crlf_final_newline.csv');
    const { envelope_sha256, ...rest } = envelope;
    expect(await jcsSha256Hex(rest)).toBe(envelope_sha256);
  });

  it('any metadata or metric change invalidates envelope_sha256', async () => {
    const base = await buildFrom('SYNTHETIC_crlf_final_newline.csv');
    const mutations: Array<(e: typeof base) => typeof base> = [
      (e) => ({ ...e, effective_date: '2026-09-28' }),
      (e) => ({ ...e, original_filename: 'renamed.csv' }),
      (e) => ({ ...e, stock_count: e.stock_count + 1 }),
      (e) => ({ ...e, headers: [...e.headers, 'Extra'] }),
      (e) => ({
        ...e,
        computed_metrics: {
          volume_ratio_v1: e.computed_metrics.volume_ratio_v1.map((m) =>
            m.status === 'valid' ? { ...m, value: '9.999' } : m,
          ),
        },
      }),
      (e) => ({ ...e, import_warnings: [...e.import_warnings, { code: 'EMPTY_RUN' as const }] }),
    ];
    for (const mutate of mutations) {
      const mutated = mutate(base);
      const rest = withoutKey(mutated, 'envelope_sha256');
      expect(await jcsSha256Hex(rest)).not.toBe(base.envelope_sha256);
    }
  });

  it('is unaffected by object key insertion order at the JS level', async () => {
    const envelope = await buildFrom('SYNTHETIC_crlf_final_newline.csv');
    const { envelope_sha256, ...rest } = envelope;
    const reordered = Object.fromEntries(Object.entries(rest).reverse());
    expect(await jcsSha256Hex(reordered)).toBe(envelope_sha256);
  });

  it('omits query_text entirely when not supplied, and includes it when supplied', async () => {
    const without = await buildFrom('SYNTHETIC_crlf_final_newline.csv');
    expect('query_text' in without).toBe(false);
    const withText = await buildFrom('SYNTHETIC_crlf_final_newline.csv', { queryText: 'RSI > 50' });
    expect(withText.query_text).toBe('RSI > 50');
  });

  it('preserves headers/rows/import_warnings/computed_metrics as recorded at import', async () => {
    const bytes = synthetic('SYNTHETIC_provider_mismatch.csv');
    const analysis = analyzeCsvBytes(bytes);
    if (!analysis.ok || !analysis.canConfirm) throw new Error('fixture failed to analyze');
    const envelope = await buildFrom('SYNTHETIC_provider_mismatch.csv');
    expect(envelope.headers).toEqual(analysis.parsed.headers);
    expect(envelope.rows).toEqual(analysis.parsed.rows);
    expect(envelope.import_warnings).toEqual(analysis.warnings);
    expect(envelope.computed_metrics.volume_ratio_v1).toEqual(
      analysis.rows.map((r) => r.volumeRatio),
    );
    expect(envelope.stock_count).toBe(analysis.rows.length);
  });

  describe('the empty-run case (§9 amendment)', () => {
    it('builds a schema-valid envelope with stock_count 0 and empty arrays', async () => {
      const bytes = buildCsv([SYNTHETIC_HEADER]);
      const analysis = analyzeCsvBytes(bytes);
      expect(analysis.ok && analysis.canConfirm).toBe(true);
      if (!analysis.ok) return;
      const result = await buildEnvelope({
        originalBytes: bytes,
        analysis,
        originalFilename: 'empty.csv',
        originalFileMimeType: 'text/csv',
        effectiveDate: '2026-09-27',
        importedAt: FIXED_DATE,
        runId: FIXED_RUN_ID,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.envelope.stock_count).toBe(0);
      expect(result.envelope.rows).toEqual([]);
      expect(result.envelope.computed_metrics.volume_ratio_v1).toEqual([]);
      expect(result.envelope.import_warnings).toContainEqual({ code: 'EMPTY_RUN' });
      expect(validateSchema(result.envelope)).toBe(true);
    });
  });

  describe('minLength:1 fields tolerate non-ASCII, including astral-plane, text', () => {
    // The schema's only user-data minLength is on original_filename (parser_id/version/
    // config_id are internal ASCII constants, never user text). Ajv is compiled with
    // `unicode: false` (UTF-16-code-unit counting, not Unicode-code-point counting) purely
    // to avoid a require()-based runtime helper (see scripts/compile-schema.mjs). For a
    // *minimum* length of 1, code-unit vs code-point counting can never disagree: every
    // non-empty string has at least 1 UTF-16 code unit, even a lone astral character (which
    // is 2 code units, a surrogate pair). These tests prove that directly, and that an
    // actually-empty filename is still correctly rejected.
    it.each([
      ['BMP non-ASCII', 'Nifty 200 – Fundamentals (सितंबर).csv'],
      ['single astral-plane code point only', String.fromCodePoint(0x1f4c8)],
      ['astral-plane surrogate pair plus extension', String.fromCodePoint(0x1f4c8) + '.csv'],
    ])('%s: %j is accepted as original_filename', async (_label, filename) => {
      const envelope = await buildFrom('SYNTHETIC_crlf_final_newline.csv', {
        originalFilename: filename,
      });
      expect(envelope.original_filename).toBe(filename);
      expect(validateSchema(envelope)).toBe(true);
    });

    it('an empty original_filename is still correctly rejected by the schema', async () => {
      const envelope = await buildFrom('SYNTHETIC_crlf_final_newline.csv');
      const outcome = { ...envelope, original_filename: '' };
      expect(validateSchema(outcome)).toBe(false);
      expect(validateSchema.errors?.some((e) => e.instancePath === '/original_filename')).toBe(
        true,
      );
    });
  });

  it('rejects building from a blocked (cannot-confirm) analysis', async () => {
    const bytes = synthetic('SYNTHETIC_missing_numerator_column.csv');
    const analysis = analyzeCsvBytes(bytes);
    expect(analysis.ok && analysis.canConfirm).toBe(false);
    if (!analysis.ok) return;
    const result = await buildEnvelope({
      originalBytes: bytes,
      analysis,
      originalFilename: 'x.csv',
      originalFileMimeType: 'text/csv',
      effectiveDate: '2026-09-27',
    });
    expect(result).toEqual({ ok: false, reason: 'cannot_confirm' });
  });
});
