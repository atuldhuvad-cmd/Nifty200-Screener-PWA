export const IMPORT_LIMITS = {
  maxFileBytes: 2 * 1024 * 1024,
  maxDataRows: 1000,
  maxColumns: 200,
  maxCellBytes: 4096,
} as const;

/**
 * Single source of truth for the error codes: also read by the envelope JSON Schema
 * generator (scripts/compile-schema.mjs) and asserted equal to the schema's enum by a test,
 * so the two can never silently drift apart.
 */
export const IMPORT_ERROR_CODES = [
  'EMPTY_FILE',
  'FILE_TOO_LARGE',
  'UNSUPPORTED_ENCODING',
  'INVALID_UTF8',
  'CONTAINS_NUL',
  'CSV_SYNTAX',
  'ROW_WIDTH_MISMATCH',
  'TOO_MANY_ROWS',
  'TOO_MANY_COLUMNS',
  'CELL_TOO_LARGE',
  'REQUIRED_COLUMN_MISSING',
  'REQUIRED_COLUMN_AMBIGUOUS',
  // Both ISIN and NSE Code columns are missing (§9 V2 amendment: blocks only in this joint case).
  'IDENTIFIER_COLUMNS_BOTH_MISSING',
] as const;
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

export const FIELD_KEYS = [
  'volumeNumerator',
  'volumeDenominator',
  'isin',
  'nseCode',
  'providerVolumeRatio',
  'serialNumber',
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

/** Structural only: never carries cell values, so it is safe to log. */
export interface ImportError {
  code: ImportErrorCode;
  /** 1-based physical line in the decoded text. */
  line?: number;
  /** 1-based CSV record number; the header is record 1. */
  record?: number;
  /** 0-based column index. */
  column?: number;
  field?: FieldKey;
  columns?: number[];
}

export const IMPORT_WARNING_CODES = [
  'BLANK_HEADER',
  'DUPLICATE_HEADER',
  'OPTIONAL_COLUMN_AMBIGUOUS',
  'MIXED_LINE_ENDINGS',
  'POSSIBLE_PARTIAL_PAGE',
  'PROVIDER_VOLUME_RATIO_MISMATCH',
  'DUPLICATE_ISIN_IN_RUN',
  'DUPLICATE_NSE_CODE_IN_RUN',
  'ROWS_EXCLUDED_FROM_COMPARISON',
  // Exactly one of ISIN / NSE Code is present; matching falls back to whichever exists.
  'IDENTIFIER_COLUMN_MISSING',
  // §9 empty-run amendment: header-only CSV, allowed after explicit user confirmation.
  'EMPTY_RUN',
] as const;
export type ImportWarningCode = (typeof IMPORT_WARNING_CODES)[number];

export const PARTIAL_PAGE_REASONS = [
  'row_count_page_size',
  'serial_number_not_starting_at_1',
] as const;
export type PartialPageReason = (typeof PARTIAL_PAGE_REASONS)[number];

/** Structural only: never carries cell values, so it is safe to log. */
export interface ImportWarning {
  code: ImportWarningCode;
  columns?: number[];
  /** 0-based data-row indices. */
  rows?: number[];
  field?: FieldKey;
  reasons?: PartialPageReason[];
}
