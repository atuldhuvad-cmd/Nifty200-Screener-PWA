import { describe, expect, it } from 'vitest';
import { analyzeCsvBytes } from '../../src/core/csv/analyze';
import { buildStockIdentity, isinCheckDigitValid } from '../../src/core/csv/identifiers';
import { buildCsv, NBSP, synthetic, SYNTHETIC_HEADER, syntheticRows, TAB } from '../helpers';

describe('ISIN check digit', () => {
  it('validates the ISO 6166 textbook example and fabricated ZZ codes', () => {
    expect(isinCheckDigitValid('US0378331005')).toBe(true);
    expect(isinCheckDigitValid('US0378331006')).toBe(false);
    expect(isinCheckDigitValid('ZZSYNTH00015')).toBe(true);
    expect(isinCheckDigitValid('ZZSYNTH00010')).toBe(false);
  });

  it('rejects malformed structure', () => {
    for (const bad of [
      '',
      'ZZ123',
      'zzsynth00015',
      'ZZSYNTH0001X',
      'ZZSYNTH000155',
      '1ZSYNTH00015',
    ]) {
      expect(isinCheckDigitValid(bad)).toBe(false);
    }
  });
});

describe('stock identity (SYNTHETIC fixture)', () => {
  const a = analyzeCsvBytes(synthetic('SYNTHETIC_missing_identifiers.csv'));
  if (!a.ok || !a.canConfirm) throw new Error('fixture did not analyze cleanly');
  const ids = a.rows.map((r) => r.identity);

  it('classifies match method from ISIN first, NSE Code as provisional fallback', () => {
    expect(ids.map((i) => i.match_method)).toEqual([
      'nse_code_provisional', // ISIN missing
      'isin', // NSE missing
      null, // neither
      'nse_code_provisional', // ISIN bad check digit
      'isin', // normalized
      'nse_code_provisional', // ISIN bad structure
      null, // NSE invalid chars, ISIN missing
      'isin', // duplicate ISIN
      'isin',
      'isin',
    ]);
  });

  it('keeps raw values untouched and never repairs invalid identifiers', () => {
    expect(ids[3]).toMatchObject({
      raw_isin: 'ZZSYNTH00010',
      normalized_isin: 'ZZSYNTH00010',
      isin_validation: 'invalid_check_digit',
    });
    expect(ids[3]?.identity_warnings).toContain('ISIN_INVALID_CHECK_DIGIT');
    expect(ids[5]).toMatchObject({ raw_isin: 'ZZ123', isin_validation: 'invalid_structure' });
  });

  it('normalizes trim + ASCII uppercase separately from the raw value', () => {
    expect(ids[4]).toEqual({
      raw_isin: ` zzsynth00056${TAB}`,
      normalized_isin: 'ZZSYNTH00056',
      isin_validation: 'valid',
      raw_nse_code: ` syne${NBSP}`,
      normalized_nse_code: 'SYNE',
      nse_code_validation: 'valid',
      match_method: 'isin',
      identity_warnings: ['ISIN_NORMALIZED', 'NSE_CODE_NORMALIZED'],
    });
  });

  it('accepts & and - in NSE Codes and rejects other characters', () => {
    expect(ids[8]?.normalized_nse_code).toBe('SYN&CO');
    expect(ids[9]?.normalized_nse_code).toBe('SYN-X');
    expect(ids[6]).toMatchObject({
      raw_nse_code: 'BAD CODE',
      nse_code_validation: 'invalid_characters',
    });
  });

  it('represents missing identifiers as null normalized values', () => {
    expect(ids[2]).toMatchObject({
      normalized_isin: null,
      isin_validation: 'missing',
      normalized_nse_code: null,
      nse_code_validation: 'missing',
      identity_warnings: ['ISIN_MISSING', 'NSE_CODE_MISSING', 'EXCLUDED_FROM_COMPARISON'],
    });
  });

  it('surfaces duplicates and exclusions as run warnings without blocking', () => {
    expect(a.warnings).toEqual(
      expect.arrayContaining([
        { code: 'DUPLICATE_ISIN_IN_RUN', rows: [1, 7] },
        { code: 'ROWS_EXCLUDED_FROM_COMPARISON', rows: [2, 6] },
      ]),
    );
  });

  it('does not treat non-ASCII lowercase as foldable', () => {
    const dotlessI = String.fromCharCode(0x131);
    expect(buildStockIdentity('', `sb${dotlessI}n`).normalized_nse_code).toBe(`SB${dotlessI}N`);
  });
});

describe('M1 page-size warning (generated SYNTHETIC rows)', () => {
  const warn = (count: number, firstSl = 1) => {
    const a = analyzeCsvBytes(buildCsv([SYNTHETIC_HEADER, ...syntheticRows(count, firstSl)]));
    if (!a.ok) throw new Error('parse failed');
    return a.warnings.find((w) => w.code === 'POSSIBLE_PARTIAL_PAGE');
  };

  it.each([25, 50, 100])('warns at exactly %i rows', (n) => {
    expect(warn(n)).toEqual({ code: 'POSSIBLE_PARTIAL_PAGE', reasons: ['row_count_page_size'] });
  });

  it.each([1, 7, 24, 26, 99, 101, 200])('does not warn at %i rows starting at Sl No 1', (n) => {
    expect(warn(n)).toBeUndefined();
  });

  it('warns when Sl No does not start at 1', () => {
    expect(warn(3, 26)).toEqual({
      code: 'POSSIBLE_PARTIAL_PAGE',
      reasons: ['serial_number_not_starting_at_1'],
    });
  });

  it('reports both reasons together', () => {
    expect(warn(25, 26)?.reasons).toEqual([
      'row_count_page_size',
      'serial_number_not_starting_at_1',
    ]);
  });

  it('treats a blank or non-numeric first Sl No as not starting at 1', () => {
    const [first = [], ...rest] = syntheticRows(3);
    const rows = [['', ...first.slice(1)], ...rest];
    const a = analyzeCsvBytes(buildCsv([SYNTHETIC_HEADER, ...rows]));
    expect(a.ok && a.warnings).toContainEqual({
      code: 'POSSIBLE_PARTIAL_PAGE',
      reasons: ['serial_number_not_starting_at_1'],
    });
  });

  it('never blocks confirmation', () => {
    const a = analyzeCsvBytes(buildCsv([SYNTHETIC_HEADER, ...syntheticRows(100, 101)]));
    expect(a.ok && a.canConfirm).toBe(true);
  });
});

describe('S2 provider VolumeRatio mismatch warning (SYNTHETIC fixture)', () => {
  const a = analyzeCsvBytes(synthetic('SYNTHETIC_provider_mismatch.csv'));
  if (!a.ok) throw new Error('parse failed');

  it('flags only rows where app ratio at 2 dp differs from a parseable provider value', () => {
    expect(a.warnings.filter((w) => w.code === 'PROVIDER_VOLUME_RATIO_MISMATCH')).toEqual([
      { code: 'PROVIDER_VOLUME_RATIO_MISMATCH', rows: [1] },
    ]);
  });

  it('never blocks, merges or substitutes the app metric', () => {
    expect(a.canConfirm).toBe(true);
    expect(a.rows[1]?.volumeRatio).toEqual({
      status: 'valid',
      value: '0.991',
      scale: 3,
      metric_version: 'volume_ratio_v1',
    });
  });

  it('keeps warnings free of cell values', () => {
    expect(JSON.stringify(a.warnings)).not.toMatch(/Synthetic|3\.06|0\.991/);
  });
});
