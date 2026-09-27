import { describe, expect, it } from 'vitest';
import { analyzeCsvBytes } from '../../src/core/csv/analyze';
import { FIELD_DEFINITIONS, mapColumns, normalizeHeaderKey } from '../../src/core/csv/headers';
import { buildCsv, NBSP, synthetic, TAB } from '../helpers';

describe('normalizeHeaderKey (D3)', () => {
  it('trims and collapses space, tab and NBSP runs to one ASCII space', () => {
    expect(normalizeHeaderKey('Day Vol ')).toBe('day vol');
    expect(normalizeHeaderKey('ROE Ann  %')).toBe('roe ann %');
    expect(normalizeHeaderKey(`${NBSP}${TAB} A${NBSP}${TAB}B  C ${NBSP}`)).toBe('a b c');
  });

  it('folds ASCII letters only; other characters compare exactly', () => {
    const aUmlaut = String.fromCharCode(0xc4);
    expect(normalizeHeaderKey(`${aUmlaut}BC`)).toBe(`${aUmlaut}bc`);
    const fullwidthA = String.fromCharCode(0xff21);
    expect(normalizeHeaderKey(fullwidthA)).toBe(fullwidthA);
  });

  it('does not collapse other whitespace characters', () => {
    const emSpace = String.fromCharCode(0x2003);
    expect(normalizeHeaderKey(`A${emSpace}B`)).toBe(`a${emSpace}b`);
    expect(normalizeHeaderKey('A\nB')).toBe('a\nb');
  });

  it('never modifies the input string', () => {
    const raw = ' Consolidated end of day Vol ';
    normalizeHeaderKey(raw);
    expect(raw).toBe(' Consolidated end of day Vol ');
  });
});

describe('mapColumns (D3 / V1 / V2)', () => {
  const realLayout = [
    'Sl No',
    'Stock',
    'VolumeRatio',
    'Day Vol ',
    'Consolidated 30D average end of day Vol ',
    'Day RSI',
    'NSE+BSE Vol ',
    'Consolidated end of day Vol ',
    'NSE Code',
    'BSE Code',
    'ISIN',
  ];

  it('maps the V1 numerator to "Consolidated end of day Vol", never "Day Vol" or "NSE+BSE Vol"', () => {
    const m = mapColumns(realLayout);
    expect(m.errors).toEqual([]);
    expect(m.columns).toEqual({
      volumeNumerator: 7,
      volumeDenominator: 4,
      isin: 10,
      nseCode: 8,
      providerVolumeRatio: 2,
      serialNumber: 0,
    });
  });

  it('has disjoint alias sets so one column can never satisfy two fields', () => {
    const all = Object.values(FIELD_DEFINITIONS).flatMap((d) => d.aliases);
    expect(new Set(all).size).toBe(all.length);
  });

  it('blocks when the numerator is missing, even if Day Vol and NSE+BSE Vol exist (V2)', () => {
    const a = analyzeCsvBytes(synthetic('SYNTHETIC_missing_numerator_column.csv'));
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.canConfirm).toBe(false);
    expect(a.blockingErrors).toEqual([
      { code: 'REQUIRED_COLUMN_MISSING', field: 'volumeNumerator' },
    ]);
    expect(a.rows).toEqual([]);
  });

  it('blocks when two headers normalize to the numerator', () => {
    const a = analyzeCsvBytes(synthetic('SYNTHETIC_ambiguous_numerator.csv'));
    expect(a.ok && a.canConfirm).toBe(false);
    if (!a.ok) return;
    expect(a.blockingErrors).toEqual([
      { code: 'REQUIRED_COLUMN_AMBIGUOUS', field: 'volumeNumerator', columns: [1, 2] },
    ]);
  });

  it('blocks on each missing required field, plus the joint identifier-columns error', () => {
    const m = mapColumns(['Stock']);
    expect(m.errors).toEqual([
      { code: 'REQUIRED_COLUMN_MISSING', field: 'volumeNumerator' },
      { code: 'REQUIRED_COLUMN_MISSING', field: 'volumeDenominator' },
      { code: 'IDENTIFIER_COLUMNS_BOTH_MISSING' },
    ]);
  });

  describe('§9 V2 amendment: identifier columns block only when BOTH are missing', () => {
    const withVolumeCols = [
      'Consolidated end of day Vol',
      'Consolidated 30D average end of day Vol',
    ];

    it('blocks with IDENTIFIER_COLUMNS_BOTH_MISSING when both ISIN and NSE Code are absent', () => {
      const m = mapColumns(withVolumeCols);
      expect(m.errors).toEqual([{ code: 'IDENTIFIER_COLUMNS_BOTH_MISSING' }]);
    });

    it('allows import with a non-blocking warning when only NSE Code is present', () => {
      const m = mapColumns([...withVolumeCols, 'NSE Code']);
      expect(m.errors).toEqual([]);
      expect(m.columns.isin).toBeUndefined();
      expect(m.columns.nseCode).toBe(2);
      expect(m.warnings).toContainEqual({ code: 'IDENTIFIER_COLUMN_MISSING', field: 'isin' });
    });

    it('allows import with a non-blocking warning when only ISIN is present', () => {
      const m = mapColumns([...withVolumeCols, 'ISIN']);
      expect(m.errors).toEqual([]);
      expect(m.columns.nseCode).toBeUndefined();
      expect(m.columns.isin).toBe(2);
      expect(m.warnings).toContainEqual({ code: 'IDENTIFIER_COLUMN_MISSING', field: 'nseCode' });
    });

    it('does not warn when both identifier columns are present', () => {
      const m = mapColumns([...withVolumeCols, 'ISIN', 'NSE Code']);
      expect(m.errors).toEqual([]);
      expect(m.warnings.map((w) => w.code)).not.toContain('IDENTIFIER_COLUMN_MISSING');
    });

    it('still blocks on ambiguity for an identifier column, even though "missing" is relaxed', () => {
      const m = mapColumns([...withVolumeCols, 'ISIN', 'isin ', 'NSE Code']);
      expect(m.errors).toEqual([
        { code: 'REQUIRED_COLUMN_AMBIGUOUS', field: 'isin', columns: [2, 3] },
      ]);
    });

    it('matches using whichever identifier is present, under the existing identity rules', () => {
      const a = analyzeCsvBytes(
        buildCsv([
          [...withVolumeCols, 'NSE Code'],
          ['1500', '1000', 'SYNA'],
        ]),
      );
      expect(a.ok && a.canConfirm).toBe(true);
      if (!a.ok) return;
      expect(a.rows[0]?.identity).toMatchObject({
        raw_isin: '',
        isin_validation: 'missing',
        normalized_nse_code: 'SYNA',
        nse_code_validation: 'valid',
        match_method: 'nse_code_provisional',
      });
    });
  });

  it('warns but does not block on an ambiguous optional column, leaving it unmapped', () => {
    const m = mapColumns([
      'Consolidated end of day Vol',
      'Consolidated 30D average end of day Vol',
      'NSE Code',
      'ISIN',
      'VolumeRatio',
      'volumeratio ',
    ]);
    expect(m.errors).toEqual([]);
    expect(m.columns.providerVolumeRatio).toBeUndefined();
    expect(m.warnings).toContainEqual({
      code: 'OPTIONAL_COLUMN_AMBIGUOUS',
      field: 'providerVolumeRatio',
      columns: [4, 5],
    });
  });

  it('warns on duplicate and blank headers while preserving them', () => {
    const a = analyzeCsvBytes(synthetic('SYNTHETIC_duplicate_blank_headers.csv'));
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.canConfirm).toBe(true);
    expect(a.warnings).toEqual(
      expect.arrayContaining([
        { code: 'BLANK_HEADER', columns: [3] },
        { code: 'DUPLICATE_HEADER', columns: [1, 2] },
      ]),
    );
    expect(a.parsed.headers[2]).toBe('Stock ');
    expect(a.parsed.headers[3]).toBe('');
  });

  it('matches header whitespace/case variants and preserves the raw strings', () => {
    const a = analyzeCsvBytes(synthetic('SYNTHETIC_non_ascii_names.csv'));
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.mapping.columns).toMatchObject({
      volumeNumerator: 2,
      volumeDenominator: 3,
      nseCode: 4,
      isin: 5,
    });
    expect(a.parsed.headers[2]).toBe(`CONSOLIDATED${NBSP}end of  day${TAB}Vol `);
    expect(a.parsed.headers[3]).toBe('  Consolidated 30D Average End Of Day Vol');
  });
});
