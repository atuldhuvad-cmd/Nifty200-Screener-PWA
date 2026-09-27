import { CsvError, parse, type Options } from 'csv-parse/browser/esm/sync';
import { decodeCsvBytes } from './decode';
import { IMPORT_LIMITS, type ImportError, type ImportWarning } from './types';

export const PARSER_ID = 'csv-parse';
/** Must equal the exact pinned csv-parse version (asserted by a test). */
export const PARSER_VERSION = '7.0.3';
/** Identifies this app's frozen parse configuration (G1) for deterministic replay. */
export const PARSE_CONFIG_ID = 'n200-csv-v1';

export type NewlineStyle = 'LF' | 'CRLF' | 'mixed' | 'none';

export interface ParseConfig {
  parserId: typeof PARSER_ID;
  parserVersion: typeof PARSER_VERSION;
  configId: typeof PARSE_CONFIG_ID;
  encoding: 'utf-8';
  bomPresent: boolean;
  delimiter: ',';
  quote: '"';
  escape: '"';
  newline: NewlineStyle;
  finalNewline: boolean;
}

export interface ParsedCsv {
  /** Header strings exactly as decoded, in file order. */
  headers: string[];
  /** Data rows as ordered cell arrays, each the same width as `headers`. */
  rows: string[][];
  config: ParseConfig;
}

export type ParseOutcome =
  { ok: true; value: ParsedCsv; warnings: ImportWarning[] } | { ok: false; errors: ImportError[] };

const CSV_OPTIONS: Options = {
  delimiter: ',',
  delimiter_auto: false,
  quote: '"',
  escape: '"',
  record_delimiter: ['\r\n', '\n'],
  bom: false,
  columns: false,
  cast: false,
  cast_date: false,
  comment: null,
  trim: false,
  ltrim: false,
  rtrim: false,
  relax_quotes: false,
  relax_column_count: false,
  relax_column_count_less: false,
  relax_column_count_more: false,
  skip_empty_lines: false,
  skip_records_with_empty_values: false,
  skip_records_with_error: false,
  // Our own per-cell/per-file limits are authoritative; the parser must not cut in earlier.
  max_record_size: IMPORT_LIMITS.maxFileBytes,
};

/** Classifies record separators outside quoted fields; used for provenance, not tokenizing. */
export function detectNewlineStyle(text: string): { style: NewlineStyle; finalNewline: boolean } {
  let inQuotes = false;
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === '\n') {
      if (i > 0 && text[i - 1] === '\r') crlf++;
      else lf++;
    }
  }
  const style: NewlineStyle =
    crlf === 0 && lf === 0 ? 'none' : crlf > 0 && lf > 0 ? 'mixed' : crlf > 0 ? 'CRLF' : 'LF';
  return { style, finalNewline: text.endsWith('\n') };
}

export function utf8ByteLength(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

function mapCsvError(e: unknown): ImportError {
  if (e instanceof CsvError) {
    const line = typeof e['lines'] === 'number' ? e['lines'] : undefined;
    const code =
      e.code === 'CSV_RECORD_INCONSISTENT_FIELDS_LENGTH' ? 'ROW_WIDTH_MISMATCH' : 'CSV_SYNTAX';
    return line === undefined ? { code } : { code, line };
  }
  return { code: 'CSV_SYNTAX' };
}

export function parseCsvBytes(bytes: Uint8Array): ParseOutcome {
  const decoded = decodeCsvBytes(bytes);
  if (!decoded.ok) return { ok: false, errors: [decoded.error] };
  const { text, bomPresent } = decoded.value;

  let records: string[][];
  try {
    records = parse(text, CSV_OPTIONS);
  } catch (e) {
    return { ok: false, errors: [mapCsvError(e)] };
  }

  const [headers, ...rows] = records;
  if (!headers) return { ok: false, errors: [{ code: 'EMPTY_FILE' }] };

  const errors: ImportError[] = [];
  if (headers.length > IMPORT_LIMITS.maxColumns) errors.push({ code: 'TOO_MANY_COLUMNS' });
  if (rows.length > IMPORT_LIMITS.maxDataRows) errors.push({ code: 'TOO_MANY_ROWS' });
  if (rows.length === 0) errors.push({ code: 'NO_DATA_ROWS' });

  const tooLarge = findOversizedCell(records);
  if (tooLarge) {
    errors.push({ code: 'CELL_TOO_LARGE', record: tooLarge.record + 1, column: tooLarge.column });
  }

  if (errors.length > 0) return { ok: false, errors };

  const { style, finalNewline } = detectNewlineStyle(text);
  const warnings: ImportWarning[] = style === 'mixed' ? [{ code: 'MIXED_LINE_ENDINGS' }] : [];

  return {
    ok: true,
    warnings,
    value: {
      headers,
      rows,
      config: {
        parserId: PARSER_ID,
        parserVersion: PARSER_VERSION,
        configId: PARSE_CONFIG_ID,
        encoding: 'utf-8',
        bomPresent,
        delimiter: ',',
        quote: '"',
        escape: '"',
        newline: style,
        finalNewline,
      },
    },
  };
}

function findOversizedCell(records: string[][]): { record: number; column: number } | null {
  for (let r = 0; r < records.length; r++) {
    const record = records[r] ?? [];
    for (let c = 0; c < record.length; c++) {
      if (utf8ByteLength(record[c] ?? '') > IMPORT_LIMITS.maxCellBytes)
        return { record: r, column: c };
    }
  }
  return null;
}
