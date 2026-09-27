import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeCsvBytes } from '../../src/core/csv/decode';
import {
  detectNewlineStyle,
  parseCsvBytes,
  PARSER_VERSION,
  utf8ByteLength,
} from '../../src/core/csv/parse';
import { IMPORT_LIMITS } from '../../src/core/csv/types';
import { buildCsv, ROOT, synthetic } from '../helpers';

const enc = (s: string) => new TextEncoder().encode(s);

function expectParseError(bytes: Uint8Array, code: string) {
  const out = parseCsvBytes(bytes);
  expect(out.ok).toBe(false);
  if (!out.ok) expect(out.errors.map((e) => e.code)).toContain(code);
}

describe('decode (SYNTHETIC inputs)', () => {
  it('strips a UTF-8 BOM and records its presence', () => {
    const out = decodeCsvBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]));
    expect(out).toEqual({ ok: true, value: { text: 'a', bomPresent: true, encoding: 'utf-8' } });
  });

  it('keeps a second BOM as data rather than silently dropping it', () => {
    const out = decodeCsvBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x61]));
    expect(out.ok && out.value.text).toBe(String.fromCharCode(0xfeff) + 'a');
  });

  it('records BOM absence', () => {
    const out = decodeCsvBytes(enc('a'));
    expect(out.ok && out.value.bomPresent).toBe(false);
  });

  it('rejects empty input and BOM-only input', () => {
    expect(decodeCsvBytes(new Uint8Array())).toEqual({ ok: false, error: { code: 'EMPTY_FILE' } });
    expect(decodeCsvBytes(new Uint8Array([0xef, 0xbb, 0xbf]))).toEqual({
      ok: false,
      error: { code: 'EMPTY_FILE' },
    });
  });

  it('rejects invalid UTF-8 instead of replacing bytes', () => {
    expect(decodeCsvBytes(synthetic('SYNTHETIC_invalid_utf8.csv'))).toEqual({
      ok: false,
      error: { code: 'INVALID_UTF8' },
    });
  });

  it('rejects UTF-16 input', () => {
    expect(decodeCsvBytes(synthetic('SYNTHETIC_utf16le_bom.csv'))).toEqual({
      ok: false,
      error: { code: 'UNSUPPORTED_ENCODING' },
    });
  });

  it('rejects NUL characters', () => {
    expect(decodeCsvBytes(new Uint8Array([0x61, 0x00, 0x62]))).toEqual({
      ok: false,
      error: { code: 'CONTAINS_NUL' },
    });
  });

  it('accepts exactly 2 MiB and rejects 2 MiB + 1 byte before decoding', () => {
    const exact = new Uint8Array(IMPORT_LIMITS.maxFileBytes).fill(0x61);
    expect(decodeCsvBytes(exact).ok).toBe(true);
    const over = new Uint8Array(IMPORT_LIMITS.maxFileBytes + 1).fill(0x61);
    expect(decodeCsvBytes(over)).toEqual({ ok: false, error: { code: 'FILE_TOO_LARGE' } });
  });
});

describe('parse: format variants (SYNTHETIC fixtures)', () => {
  it('parses CRLF with BOM and a final newline without producing an extra record', () => {
    const out = parseCsvBytes(synthetic('SYNTHETIC_crlf_final_newline.csv'));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.rows).toHaveLength(3);
    expect(out.value.config).toEqual({
      parserId: 'csv-parse',
      parserVersion: PARSER_VERSION,
      configId: 'n200-csv-v1',
      encoding: 'utf-8',
      bomPresent: true,
      delimiter: ',',
      quote: '"',
      escape: '"',
      newline: 'CRLF',
      finalNewline: true,
    });
  });

  it('decodes escaped quotes, embedded commas and embedded newlines into logical values', () => {
    const out = parseCsvBytes(synthetic('SYNTHETIC_escaped_quotes_embedded.csv'));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.rows.map((r) => r[1])).toEqual([
      'Synthetic "Quoted" Co',
      'Synthetic, Comma Ltd',
      'Synthetic\nMultiline Ltd',
      'Synthetic\r\nCRLF Inside Ltd',
    ]);
    expect(out.value.config.newline).toBe('LF');
    expect(out.value.config.finalNewline).toBe(false);
  });

  it('parses unquoted fields with a final LF', () => {
    const out = parseCsvBytes(synthetic('SYNTHETIC_unquoted_final_newline.csv'));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.rows).toEqual([
      ['1', 'Synthetic Alpha Ltd', '1500', '1000', 'SYNA', 'ZZSYNTH00015'],
      ['2', 'Synthetic Beta Ltd', '1000', '2000', 'SYNB', 'ZZSYNTH00023'],
    ]);
    expect(out.value.config).toMatchObject({
      bomPresent: false,
      newline: 'LF',
      finalNewline: true,
    });
  });

  it('accepts mixed line endings with a warning', () => {
    const out = parseCsvBytes(synthetic('SYNTHETIC_mixed_line_endings.csv'));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.rows).toHaveLength(2);
    expect(out.value.config.newline).toBe('mixed');
    expect(out.warnings).toEqual([{ code: 'MIXED_LINE_ENDINGS' }]);
  });

  it('keeps headers as an ordered array and rows as ordered cell arrays, including blanks and duplicates', () => {
    const out = parseCsvBytes(synthetic('SYNTHETIC_duplicate_blank_headers.csv'));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.headers).toEqual([
      'Sl No',
      'Stock',
      'Stock ',
      '',
      'Consolidated end of day Vol',
      'Consolidated 30D average end of day Vol',
      'NSE Code',
      'ISIN',
    ]);
    expect(out.value.rows[0]?.slice(1, 4)).toEqual([
      'Synthetic First',
      'Synthetic Second',
      'Synthetic Blank Col',
    ]);
  });

  it('does not trim or cast cell values', () => {
    const out = parseCsvBytes(
      buildCsv([
        ['h1', 'h2'],
        [' 007 ', '1e3'],
      ]),
    );
    expect(out.ok && out.value.rows).toEqual([[' 007 ', '1e3']]);
  });
});

describe('parse: syntax errors (SYNTHETIC fixtures)', () => {
  it('rejects an unclosed quote', () => {
    expectParseError(synthetic('SYNTHETIC_unclosed_quote.csv'), 'CSV_SYNTAX');
  });
  it('rejects ragged rows', () => {
    expectParseError(synthetic('SYNTHETIC_ragged_rows.csv'), 'ROW_WIDTH_MISMATCH');
  });
  it('rejects bare CR record separators (not auto-detected)', () => {
    expectParseError(synthetic('SYNTHETIC_bare_cr_line_endings.csv'), 'CSV_SYNTAX');
  });
  it('does not auto-detect semicolon or tab delimiters', () => {
    const out = parseCsvBytes(enc('a;b;c\n1;2;3'));
    expect(out.ok && out.value.headers).toEqual(['a;b;c']);
    const tab = parseCsvBytes(enc('a\tb\n1\t2'));
    expect(tab.ok && tab.value.headers).toEqual(['a\tb']);
  });
  it('rejects a stray quote inside an unquoted field', () => {
    expectParseError(enc('a,b\n1,x"y'), 'CSV_SYNTAX');
  });
  it('rejects an empty line in the middle (width mismatch)', () => {
    expectParseError(enc('a,b\n1,2\n\n3,4'), 'ROW_WIDTH_MISMATCH');
  });
  it('maps CSV errors without echoing cell content', () => {
    const out = parseCsvBytes(enc('a,b\n"SECRETVALUE,2'));
    expect(out.ok).toBe(false);
    expect(JSON.stringify(out)).not.toContain('SECRETVALUE');
  });
});

describe('parse: import limits (A2), generated SYNTHETIC inputs', () => {
  const header = ['h1', 'h2'];

  it('accepts 1,000 data rows and rejects 1,001', () => {
    const rows = (n: number) => [header, ...Array.from({ length: n }, () => ['1', '2'])];
    expect(parseCsvBytes(buildCsv(rows(1000))).ok).toBe(true);
    expectParseError(buildCsv(rows(1001)), 'TOO_MANY_ROWS');
  });

  it('accepts 200 columns and rejects 201', () => {
    const wide = (n: number) => [
      Array.from({ length: n }, (_, i) => `c${i}`),
      Array.from({ length: n }, () => '1'),
    ];
    expect(parseCsvBytes(buildCsv(wide(200))).ok).toBe(true);
    expectParseError(buildCsv(wide(201)), 'TOO_MANY_COLUMNS');
  });

  it('measures cell size in UTF-8 bytes: 4,096 accepted, 4,097 rejected', () => {
    expect(parseCsvBytes(buildCsv([header, ['a'.repeat(4096), '1']])).ok).toBe(true);
    const out = parseCsvBytes(buildCsv([header, ['1', 'a'.repeat(4097)]]));
    expect(out).toEqual({ ok: false, errors: [{ code: 'CELL_TOO_LARGE', record: 2, column: 1 }] });
    const e2 = String.fromCharCode(0xe9);
    expect(parseCsvBytes(buildCsv([header, [e2.repeat(2048), '1']])).ok).toBe(true);
    expectParseError(buildCsv([header, [e2.repeat(2049), '1']]), 'CELL_TOO_LARGE');
  });

  it('applies the cell limit to headers too', () => {
    expectParseError(buildCsv([['a'.repeat(4097)], ['1']]), 'CELL_TOO_LARGE');
  });

  it('parses a maximal-width record beyond csv-parse default max_record_size', () => {
    const cols = 200;
    const rows = [
      Array.from({ length: cols }, (_, i) => `c${i}`),
      Array.from({ length: cols }, () => 'x'.repeat(4096)),
    ];
    const out = parseCsvBytes(buildCsv(rows));
    expect(out.ok).toBe(true);
  });

  it('rejects files over 2 MiB before parsing', () => {
    const big = new Uint8Array(IMPORT_LIMITS.maxFileBytes + 1).fill(0x61);
    expect(parseCsvBytes(big)).toEqual({ ok: false, errors: [{ code: 'FILE_TOO_LARGE' }] });
  });

  it('accepts a header-only file with an EMPTY_RUN warning, not an error (§9 amendment)', () => {
    const out = parseCsvBytes(enc('"a","b"\n'));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.rows).toEqual([]);
    expect(out.warnings).toEqual([{ code: 'EMPTY_RUN' }]);
  });
});

describe('parse helpers', () => {
  it('counts UTF-8 bytes including 4-byte code points and lone surrogates', () => {
    expect(utf8ByteLength('a')).toBe(1);
    expect(utf8ByteLength(String.fromCharCode(0xe9))).toBe(2);
    expect(utf8ByteLength(String.fromCharCode(0x20b9))).toBe(3);
    expect(utf8ByteLength(String.fromCodePoint(0x1f4c8))).toBe(4);
    expect(utf8ByteLength(String.fromCharCode(0xd800))).toBe(3);
    const s = 'x' + String.fromCodePoint(0x1f4c8) + String.fromCharCode(0x0939);
    expect(utf8ByteLength(s)).toBe(new TextEncoder().encode(s).length);
  });

  it('classifies newline style outside quotes only', () => {
    expect(detectNewlineStyle('a\nb')).toEqual({ style: 'LF', finalNewline: false });
    expect(detectNewlineStyle('a\r\nb\r\n')).toEqual({ style: 'CRLF', finalNewline: true });
    expect(detectNewlineStyle('"a\r\nx"\nb')).toEqual({ style: 'LF', finalNewline: false });
    expect(detectNewlineStyle('a,b')).toEqual({ style: 'none', finalNewline: false });
  });

  it('PARSER_VERSION matches the installed, exact-pinned csv-parse', () => {
    const installed = JSON.parse(
      readFileSync(join(ROOT, 'node_modules', 'csv-parse', 'package.json'), 'utf8'),
    ) as { version: string };
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(installed.version).toBe(PARSER_VERSION);
    expect(pkg.dependencies['csv-parse']).toBe(PARSER_VERSION);
  });

  it('every direct dependency is pinned to an exact version (D14)', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, version] of Object.entries(all)) {
      expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});
