import Big from 'big.js';
import { describe, expect, it } from 'vitest';
import { analyzeCsvBytes } from '../../src/core/csv/analyze';
import { parseNumericCell } from '../../src/core/csv/numeric';
import { computeVolumeRatio, type VolumeRatioMetric } from '../../src/core/csv/volumeRatio';
import { synthetic } from '../helpers';

const V = (value: string): VolumeRatioMetric => ({
  status: 'valid',
  value,
  scale: 3,
  metric_version: 'volume_ratio_v1',
});
const X = (reason: string, detail?: string) => ({
  status: 'invalid',
  value: null,
  reason,
  ...(detail ? { detail } : {}),
  metric_version: 'volume_ratio_v1',
});

function metricsOf(fixture: string): VolumeRatioMetric[] {
  const a = analyzeCsvBytes(synthetic(fixture));
  if (!a.ok || !a.canConfirm) throw new Error(`fixture did not analyze cleanly: ${fixture}`);
  return a.rows.map((r) => r.volumeRatio);
}

describe('numeric grammar (A3, frozen by G1)', () => {
  it.each(['0', '-0', '-0.00', '1', '10', '123.45', '-3.41', '0.001', '442582817.9'])(
    'accepts %j',
    (raw) => expect(parseNumericCell(raw).kind).toBe('valid'),
  );

  it.each([
    '007',
    '00',
    '.5',
    '5.',
    '+1',
    ' 1',
    '1 ',
    '1e3',
    '0x10',
    '1.2.3',
    '-',
    '--1',
    'NA',
    'Infinity',
    '١٢',
  ])('rejects %j without a detail', (raw) =>
    expect(parseNumericCell(raw)).toEqual({ kind: 'invalid' }),
  );

  it.each(['1,234', '1,234,567', '12,34,567', '-1,234.5', '1,00,000'])(
    'rejects grouping comma %j with detail "grouping_comma"',
    (raw) => expect(parseNumericCell(raw)).toEqual({ kind: 'invalid', detail: 'grouping_comma' }),
  );

  it.each(['1,5', '1,23', ',123', '123,'])('rejects non-grouping comma %j without detail', (raw) =>
    expect(parseNumericCell(raw)).toEqual({ kind: 'invalid' }),
  );

  it('treats only the empty string as missing', () => {
    expect(parseNumericCell('')).toEqual({ kind: 'missing' });
  });

  it('treats -0 and -0.00 as zero, not negative', () => {
    expect(parseNumericCell('-0')).toEqual({
      kind: 'valid',
      text: '-0',
      isZero: true,
      isNegative: false,
    });
    expect(parseNumericCell('-0.00')).toMatchObject({ isZero: true, isNegative: false });
    expect(parseNumericCell('-0.01')).toMatchObject({ isZero: false, isNegative: true });
  });
});

describe('volume_ratio_v1 (SYNTHETIC fixtures)', () => {
  it('rounds HALF_UP at scale 3, including 1.2344 / 1.2345 / 1.2346', () => {
    expect(metricsOf('SYNTHETIC_rounding_boundaries.csv').map((m) => m.value)).toEqual([
      '1.234', // 12344 / 10000
      '1.235', // 12345 / 10000 (half-step)
      '1.235', // 12346 / 10000
      '1.235', // 1.2345 / 1
      '1.235', // 24690 / 20000
      '0.667', // 2 / 3
      '0.333', // 1 / 3
      '1.001', // 1.0005 / 1 (binary floating point would give 1.000)
      '1.005', // 1.0045 / 1
      '1.000', // 9999995 / 10000000
      '0.001', // 1 / 2000 (0.0005)
      '0.000', // 1 / 2001 (0.00049975...)
    ]);
  });

  it('handles zero and negative inputs per the brief, never crashing or guessing', () => {
    expect(metricsOf('SYNTHETIC_zero_and_negative_volume.csv')).toEqual([
      V('0.000'), // 0 / 1000
      V('0.000'), // -0 / 1000 (numeric zero, not "-0.000")
      V('0.000'), // -0.00 / 1000
      X('NON_POSITIVE_DENOMINATOR'), // 1000 / 0
      X('NON_POSITIVE_DENOMINATOR'), // 1000 / -0
      X('NEGATIVE_NUMERATOR'), // -5 / 1000
      X('NON_POSITIVE_DENOMINATOR'), // 1000 / -100
      X('NEGATIVE_NUMERATOR'), // -5 / -100: numerator sign checked first
      X('NON_POSITIVE_DENOMINATOR'), // 0 / 0
    ]);
  });

  it('uses MISSING_* for empty cells and INVALID_* for whitespace or placeholders', () => {
    expect(metricsOf('SYNTHETIC_blank_numerics.csv')).toEqual([
      X('MISSING_NUMERATOR'),
      X('MISSING_DENOMINATOR'),
      X('MISSING_NUMERATOR'),
      X('INVALID_NUMERATOR'),
      X('INVALID_NUMERATOR'),
      X('INVALID_DENOMINATOR'),
    ]);
  });

  it('reports grouping commas as INVALID_* with detail "grouping_comma" and no new reason codes', () => {
    const metrics = metricsOf('SYNTHETIC_grouping_commas.csv');
    expect(metrics).toEqual([
      X('INVALID_NUMERATOR', 'grouping_comma'),
      X('INVALID_NUMERATOR', 'grouping_comma'),
      X('INVALID_DENOMINATOR', 'grouping_comma'),
      X('INVALID_NUMERATOR'),
      X('INVALID_NUMERATOR'),
      X('INVALID_NUMERATOR'),
      X('INVALID_NUMERATOR'),
      X('INVALID_NUMERATOR'),
      X('INVALID_NUMERATOR'),
    ]);
    for (const m of metrics.slice(3)) expect('detail' in m).toBe(false);
  });

  it('checks numerator syntax before denominator syntax', () => {
    expect(computeVolumeRatio('', '')).toEqual(X('MISSING_NUMERATOR'));
    expect(computeVolumeRatio('x', '')).toEqual(X('INVALID_NUMERATOR'));
    expect(computeVolumeRatio('-5', 'x')).toEqual(X('INVALID_DENOMINATOR'));
  });

  it('emits exactly the agreed metric structure, with value as a string', () => {
    const valid = computeVolumeRatio('1500', '1000');
    expect(Object.keys(valid).sort()).toEqual(['metric_version', 'scale', 'status', 'value']);
    expect(valid).toEqual(V('1.500'));
    const invalid = computeVolumeRatio('', '1');
    expect(Object.keys(invalid).sort()).toEqual(['metric_version', 'reason', 'status', 'value']);
  });

  it('is unaffected by global big.js settings', () => {
    const dp = Big.DP;
    const rm = Big.RM;
    try {
      Big.DP = 0;
      Big.RM = Big.roundDown;
      expect(computeVolumeRatio('12345', '10000')).toEqual(V('1.235'));
    } finally {
      Big.DP = dp;
      Big.RM = rm;
    }
  });

  it('computes large real-magnitude values exactly', () => {
    expect(computeVolumeRatio('330779007', '442582817.9')).toEqual(V('0.747'));
  });
});
