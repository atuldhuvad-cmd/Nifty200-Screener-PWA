import { describe, expect, it } from 'vitest';
import { analyzeCsvBytes } from '../src/core/csv/analyze';
import { buildEnvelope } from '../src/core/envelope/build';
import { validateEnvelope } from '../src/core/envelope/validate';
import validateSchema from '../src/core/envelope/schema/generated/validateEnvelopeV1';
import { sampleExists, verifiedSample } from './helpers';

// REAL Trendlyne exports, hash-verified against DECISIONS.md before use (see tests/helpers.ts).
const P1 = 'Nifty200 All_September 27, 2026.csv';
const P2 = 'Nifty200 All_September 27, 2026 (1).csv';
const S4 = 'Nifty200 All_September 27, 2026 (2).csv';

const available = [P1, P2, S4].every(sampleExists);

async function buildFromReal(name: string) {
  const bytes = verifiedSample(name);
  const analysis = analyzeCsvBytes(bytes);
  if (!analysis.ok || !analysis.canConfirm)
    throw new Error(`real sample failed to analyze: ${name}`);
  const result = await buildEnvelope({
    originalBytes: bytes,
    analysis,
    originalFilename: name,
    originalFileMimeType: 'text/csv',
    effectiveDate: '2026-09-27',
  });
  if (!result.ok) throw new Error(`build failed for ${name}`);
  return result.envelope;
}

describe.skipIf(!available)('REAL samples: envelope build + validate (local only)', () => {
  it.each([P1, P2, S4])('%s builds a schema-valid envelope', async (name) => {
    const envelope = await buildFromReal(name);
    expect(validateSchema(envelope)).toBe(true);
  });

  it.each([P1, P2, S4])('%s: deterministic replay reports valid', async (name) => {
    const envelope = await buildFromReal(name);
    expect(await validateEnvelope(envelope)).toEqual({ status: 'valid' });
  });

  it('the 200-row two-page export preserves stock_count and metric counts', async () => {
    for (const name of [P1, P2]) {
      const envelope = await buildFromReal(name);
      expect(envelope.stock_count).toBe(100);
      expect(envelope.rows).toHaveLength(100);
      expect(envelope.computed_metrics.volume_ratio_v1).toHaveLength(100);
      expect(envelope.computed_metrics.volume_ratio_v1.every((m) => m.status === 'valid')).toBe(
        true,
      );
    }
  });

  it('the 7-row run (sample 4) reproduces the recorded app values inside the envelope', async () => {
    const envelope = await buildFromReal(S4);
    const nseIndex = envelope.headers.indexOf('NSE Code');
    const byCode = Object.fromEntries(
      envelope.rows.map((row, i) => [
        row[nseIndex],
        envelope.computed_metrics.volume_ratio_v1[i]?.status === 'valid'
          ? (envelope.computed_metrics.volume_ratio_v1[i] as { value: string }).value
          : null,
      ]),
    );
    expect(byCode).toEqual({
      LGEINDIA: '1.450',
      APOLLOHOSP: '1.420',
      MCX: '1.164',
      OBEROIRLTY: '1.150',
      ENRIN: '1.129',
      JUBLFOOD: '1.046',
      BLUESTARCO: '1.021',
    });
  });

  it('tampering with a real envelope after the fact is detected', async () => {
    const envelope = await buildFromReal(S4);
    const tampered = { ...envelope, effective_date: '2026-09-28' };
    expect(await validateEnvelope(tampered)).toMatchObject({
      status: 'quarantined',
      reasons: ['ENVELOPE_HASH_MISMATCH'],
    });
  });
});
