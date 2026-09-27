export const IMPORT_LIMITS = {
  maxFileBytes: 2 * 1024 * 1024,
  maxDataRows: 1000,
  maxColumns: 200,
  maxCellBytes: 4096,
} as const;

export type ImportErrorCode =
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_ENCODING'
  | 'INVALID_UTF8'
  | 'CONTAINS_NUL'
  | 'CSV_SYNTAX'
  | 'ROW_WIDTH_MISMATCH'
  | 'NO_DATA_ROWS'
  | 'TOO_MANY_ROWS'
  | 'TOO_MANY_COLUMNS'
  | 'CELL_TOO_LARGE'
  | 'REQUIRED_COLUMN_MISSING'
  | 'REQUIRED_COLUMN_AMBIGUOUS';

export type FieldKey =
  | 'volumeNumerator'
  | 'volumeDenominator'
  | 'isin'
  | 'nseCode'
  | 'providerVolumeRatio'
  | 'serialNumber';

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

export type ImportWarningCode =
  | 'BLANK_HEADER'
  | 'DUPLICATE_HEADER'
  | 'OPTIONAL_COLUMN_AMBIGUOUS'
  | 'MIXED_LINE_ENDINGS'
  | 'POSSIBLE_PARTIAL_PAGE'
  | 'PROVIDER_VOLUME_RATIO_MISMATCH'
  | 'DUPLICATE_ISIN_IN_RUN'
  | 'DUPLICATE_NSE_CODE_IN_RUN'
  | 'ROWS_EXCLUDED_FROM_COMPARISON';

export type PartialPageReason = 'row_count_page_size' | 'serial_number_not_starting_at_1';

/** Structural only: never carries cell values, so it is safe to log. */
export interface ImportWarning {
  code: ImportWarningCode;
  columns?: number[];
  /** 0-based data-row indices. */
  rows?: number[];
  field?: FieldKey;
  reasons?: PartialPageReason[];
}
