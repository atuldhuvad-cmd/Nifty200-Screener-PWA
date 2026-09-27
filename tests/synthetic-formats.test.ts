import { describe, expect, it } from 'vitest';
import { analyzeCsvBytes } from '../src/core/csv/analyze';
import { synthetic } from './helpers';

describe('end-to-end analysis of SYNTHETIC format fixtures', () => {
  it('CRLF + BOM + final newline analyzes cleanly', () => {
    const a = analyzeCsvBytes(synthetic('SYNTHETIC_crlf_final_newline.csv'));
    expect(a.ok && a.canConfirm).toBe(true);
    if (!a.ok) return;
    expect(a.rows.map((r) => r.volumeRatio.value)).toEqual(['1.500', '0.500', '2.000']);
    expect(a.warnings).toEqual([]);
  });

  it('preserves non-ASCII names exactly and computes metrics', () => {
    const a = analyzeCsvBytes(synthetic('SYNTHETIC_non_ascii_names.csv'));
    expect(a.ok && a.canConfirm).toBe(true);
    if (!a.ok) return;
    expect(a.parsed.rows.map((r) => r[1])).toEqual([
      'Synth' + String.fromCharCode(0xe9) + 'tique ' + String.fromCharCode(0xc9) + 'nergie Ltd',
      String.fromCharCode(0x0938, 0x093f, 0x0902, 0x0925, 0x0947, 0x091f, 0x093f, 0x0915) +
        ' ' +
        String.fromCharCode(0x0932, 0x093f, 0x092e, 0x093f, 0x091f, 0x0947, 0x0921),
      'Synthetic ' + String.fromCharCode(0x20b9) + ' Rupee Co',
      'Synthetic ' + String.fromCodePoint(0x1f4c8) + ' Chart Co',
    ]);
    expect(a.rows.map((r) => r.volumeRatio.value)).toEqual(['1.500', '1.000', '0.500', '0.250']);
  });

  it.each([
    ['SYNTHETIC_unclosed_quote.csv', 'CSV_SYNTAX'],
    ['SYNTHETIC_ragged_rows.csv', 'ROW_WIDTH_MISMATCH'],
    ['SYNTHETIC_bare_cr_line_endings.csv', 'CSV_SYNTAX'],
    ['SYNTHETIC_invalid_utf8.csv', 'INVALID_UTF8'],
    ['SYNTHETIC_utf16le_bom.csv', 'UNSUPPORTED_ENCODING'],
  ])('%s is rejected with %s', (file, code) => {
    const a = analyzeCsvBytes(synthetic(file));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.errors[0]?.code).toBe(code);
  });
});
