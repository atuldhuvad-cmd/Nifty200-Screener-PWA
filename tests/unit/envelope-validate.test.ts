import { describe, expect, it } from 'vitest';
import { analyzeCsvBytes } from '../../src/core/csv/analyze';
import { buildEnvelope } from '../../src/core/envelope/build';
import { validateEnvelope } from '../../src/core/envelope/validate';
import type { RunEnvelopeV1 } from '../../src/core/envelope/types';
import { buildCsv, synthetic, SYNTHETIC_HEADER, withoutKey } from '../helpers';

async function goodEnvelope(fixture = 'SYNTHETIC_crlf_final_newline.csv'): Promise<RunEnvelopeV1> {
  const bytes = synthetic(fixture);
  const analysis = analyzeCsvBytes(bytes);
  if (!analysis.ok || !analysis.canConfirm) throw new Error('fixture did not analyze cleanly');
  const result = await buildEnvelope({
    originalBytes: bytes,
    analysis,
    originalFilename: fixture,
    originalFileMimeType: 'text/csv',
    effectiveDate: '2026-09-27',
  });
  if (!result.ok) throw new Error('build failed');
  return result.envelope;
}

describe('validateEnvelope: happy path', () => {
  it('reports a freshly built envelope as valid', async () => {
    const envelope = await goodEnvelope();
    expect(await validateEnvelope(envelope)).toEqual({ status: 'valid' });
  });

  it('reports a freshly built empty-run envelope as valid', async () => {
    const bytes = buildCsv([SYNTHETIC_HEADER]);
    const analysis = analyzeCsvBytes(bytes);
    if (!analysis.ok || !analysis.canConfirm) throw new Error('unexpected');
    const result = await buildEnvelope({
      originalBytes: bytes,
      analysis,
      originalFilename: 'empty.csv',
      originalFileMimeType: 'text/csv',
      effectiveDate: '2026-09-27',
    });
    if (!result.ok) throw new Error('build failed');
    expect(await validateEnvelope(result.envelope)).toEqual({ status: 'valid' });
  });
});

describe('validateEnvelope: schema_version handling', () => {
  it('reports a future/unrecognized schema_version as unsupported_schema, not quarantined', async () => {
    const envelope = await goodEnvelope();
    const future = { ...envelope, schema_version: '3' };
    expect(await validateEnvelope(future)).toEqual({ status: 'unsupported_schema' });
  });

  it('never forces an unsupported version through the v1 schema (a structurally-invalid v3 object still reports unsupported_schema)', async () => {
    const wildlyDifferent = { schema_version: '3', anything: 'goes', nested: { a: 1 } };
    expect(await validateEnvelope(wildlyDifferent)).toEqual({ status: 'unsupported_schema' });
  });

  it.each([null, undefined, 1, {}, [], 'not-an-object', { no_version_field: true }])(
    'quarantines a malformed object with no usable schema_version: %j',
    async (raw) => {
      const outcome = await validateEnvelope(raw);
      expect(outcome).toEqual({ status: 'quarantined', reasons: ['SCHEMA_INVALID'] });
    },
  );
});

describe('validateEnvelope: schema-invalid v1 envelopes are quarantined', () => {
  it('quarantines with SCHEMA_INVALID when a required field is removed', async () => {
    const envelope = await goodEnvelope();
    const broken = withoutKey(envelope, 'run_id');
    const outcome = await validateEnvelope({ ...broken, schema_version: '1' });
    expect(outcome.status).toBe('quarantined');
    if (outcome.status === 'quarantined') {
      expect(outcome.reasons).toEqual(['SCHEMA_INVALID']);
      expect(outcome.schemaIssues?.length).toBeGreaterThan(0);
      // Structural only: never leaks any cell value or filename into the diagnostic.
      expect(JSON.stringify(outcome.schemaIssues)).not.toMatch(/Synthetic|csv/i);
    }
  });

  it('quarantines an out-of-pattern run_id', async () => {
    const envelope = await goodEnvelope();
    const outcome = await validateEnvelope({ ...envelope, run_id: 'not-a-uuid' });
    expect(outcome).toMatchObject({ status: 'quarantined', reasons: ['SCHEMA_INVALID'] });
  });

  it('quarantines an unknown top-level property (additionalProperties: false)', async () => {
    const envelope = await goodEnvelope();
    const outcome = await validateEnvelope({ ...envelope, unexpected_field: 1 });
    expect(outcome).toMatchObject({ status: 'quarantined', reasons: ['SCHEMA_INVALID'] });
  });
});

describe('validateEnvelope: hash checks detect tampering', () => {
  it('quarantines with ORIGINAL_FILE_HASH_MISMATCH (and ENVELOPE_HASH_MISMATCH, since original_file_sha256 is itself covered by the envelope hash) when it is tampered', async () => {
    const envelope = await goodEnvelope();
    const outcome = await validateEnvelope({ ...envelope, original_file_sha256: 'f'.repeat(64) });
    expect(outcome).toMatchObject({
      status: 'quarantined',
      reasons: ['ORIGINAL_FILE_HASH_MISMATCH', 'ENVELOPE_HASH_MISMATCH'],
    });
  });

  it('quarantines with ENVELOPE_HASH_MISMATCH when a metadata field is tampered', async () => {
    const envelope = await goodEnvelope();
    const outcome = await validateEnvelope({ ...envelope, effective_date: '2026-09-28' });
    expect(outcome).toMatchObject({ status: 'quarantined', reasons: ['ENVELOPE_HASH_MISMATCH'] });
  });

  it('quarantines with ENVELOPE_HASH_MISMATCH and REPLAY_METRICS_MISMATCH when a computed metric is tampered', async () => {
    const envelope = await goodEnvelope();
    const metrics = envelope.computed_metrics.volume_ratio_v1;
    const first = metrics[0];
    if (!first || first.status !== 'valid') throw new Error('fixture assumption changed');
    const tampered = {
      ...envelope,
      computed_metrics: { volume_ratio_v1: [{ ...first, value: '9.999' }, ...metrics.slice(1)] },
    };
    expect(await validateEnvelope(tampered)).toMatchObject({
      status: 'quarantined',
      reasons: ['ENVELOPE_HASH_MISMATCH', 'REPLAY_METRICS_MISMATCH'],
    });
  });

  it('quarantines with both hash reasons when both the raw bytes and metadata are tampered independently', async () => {
    const envelope = await goodEnvelope();
    const outcome = await validateEnvelope({
      ...envelope,
      original_file_sha256: 'f'.repeat(64),
      effective_date: '2026-09-28',
    });
    expect(outcome).toMatchObject({ status: 'quarantined' });
    if (outcome.status === 'quarantined') {
      expect(outcome.reasons).toEqual(
        expect.arrayContaining(['ORIGINAL_FILE_HASH_MISMATCH', 'ENVELOPE_HASH_MISMATCH']),
      );
    }
  });

  it('quarantines with SCHEMA_INVALID when original_file_base64 fails the schema pattern', async () => {
    // The schema's own pattern already rejects non-canonical Base64, so this never reaches
    // the decode step; BASE64_DECODE_FAILED exists as defence-in-depth for a schema-valid
    // string decodeBase64 nonetheless rejects (e.g. a future looser schema pattern).
    const envelope = await goodEnvelope();
    const outcome = await validateEnvelope({
      ...envelope,
      original_file_base64: 'not-valid-base64!!!',
    });
    expect(outcome).toMatchObject({ status: 'quarantined', reasons: ['SCHEMA_INVALID'] });
  });
});

describe('validateEnvelope: semantic cross-field invariants (not expressible in JSON Schema alone)', () => {
  it('quarantines with ROW_WIDTH_INCONSISTENT when a row width no longer matches headers', async () => {
    const envelope = await goodEnvelope();
    const badRows = [[...(envelope.rows[0] ?? []), 'extra'], ...envelope.rows.slice(1)];
    const outcome = await validateEnvelope({ ...envelope, rows: badRows });
    expect(outcome.status).toBe('quarantined');
    if (outcome.status === 'quarantined')
      expect(outcome.reasons).toContain('ROW_WIDTH_INCONSISTENT');
  });

  it('quarantines with STOCK_COUNT_MISMATCH when stock_count disagrees with rows.length', async () => {
    const envelope = await goodEnvelope();
    const outcome = await validateEnvelope({ ...envelope, stock_count: envelope.stock_count + 1 });
    expect(outcome.status).toBe('quarantined');
    if (outcome.status === 'quarantined') expect(outcome.reasons).toContain('STOCK_COUNT_MISMATCH');
  });

  it('quarantines with METRICS_COUNT_MISMATCH when metrics count disagrees with rows.length', async () => {
    const envelope = await goodEnvelope();
    const outcome = await validateEnvelope({
      ...envelope,
      computed_metrics: { volume_ratio_v1: envelope.computed_metrics.volume_ratio_v1.slice(1) },
    });
    expect(outcome.status).toBe('quarantined');
    if (outcome.status === 'quarantined')
      expect(outcome.reasons).toContain('METRICS_COUNT_MISMATCH');
  });
});

describe('validateEnvelope: parser version and deterministic replay', () => {
  it('quarantines with UNKNOWN_PARSER_VERSION when the recorded parser_version is not one this app can replay', async () => {
    const envelope = await goodEnvelope();
    const outcome = await validateEnvelope({
      ...envelope,
      parser: { ...envelope.parser, parser_version: '0.0.1' },
    });
    expect(outcome).toMatchObject({
      status: 'quarantined',
      reasons: ['ENVELOPE_HASH_MISMATCH', 'UNKNOWN_PARSER_VERSION'],
    });
  });

  it('replay passes for every SYNTHETIC format fixture used elsewhere', async () => {
    for (const fixture of [
      'SYNTHETIC_crlf_final_newline.csv',
      'SYNTHETIC_escaped_quotes_embedded.csv',
      'SYNTHETIC_unquoted_final_newline.csv',
      'SYNTHETIC_non_ascii_names.csv',
      'SYNTHETIC_provider_mismatch.csv',
      'SYNTHETIC_duplicate_blank_headers.csv',
    ]) {
      const envelope = await goodEnvelope(fixture);
      expect(await validateEnvelope(envelope), fixture).toEqual({ status: 'valid' });
    }
  });
});
