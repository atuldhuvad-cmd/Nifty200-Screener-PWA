import type {
  ImportError,
  ImportErrorCode,
  ImportWarning,
  ImportWarningCode,
  VolumeRatioMetric,
  VolumeRatioReason,
} from '../core/csv';

const ERROR_MESSAGES: Record<ImportErrorCode, string> = {
  EMPTY_FILE: 'The file is empty.',
  FILE_TOO_LARGE: 'The file is larger than the 2 MB limit.',
  UNSUPPORTED_ENCODING: 'The file is not UTF-8 encoded text.',
  INVALID_UTF8: 'The file contains invalid UTF-8 byte sequences.',
  CONTAINS_NUL: 'The file contains a NUL byte, which is not allowed.',
  CSV_SYNTAX: 'The file could not be parsed as CSV.',
  ROW_WIDTH_MISMATCH: 'A row has a different number of columns than the header row.',
  TOO_MANY_ROWS: 'The file has more than the 1,000-row limit.',
  TOO_MANY_COLUMNS: 'The file has more than the 200-column limit.',
  CELL_TOO_LARGE: 'A cell exceeds the 4,096-byte limit.',
  REQUIRED_COLUMN_MISSING: 'A required column is missing.',
  REQUIRED_COLUMN_AMBIGUOUS: 'A required column name matches more than one header.',
  IDENTIFIER_COLUMNS_BOTH_MISSING: 'Both the ISIN and NSE Code columns are missing.',
};

const WARNING_MESSAGES: Record<ImportWarningCode, string> = {
  BLANK_HEADER: 'One or more column headers are blank.',
  DUPLICATE_HEADER: 'Two or more columns share the same header name.',
  OPTIONAL_COLUMN_AMBIGUOUS: 'An optional column name matches more than one header.',
  MIXED_LINE_ENDINGS: 'The file mixes CRLF and LF line endings.',
  POSSIBLE_PARTIAL_PAGE: 'This looks like it may be one page of a larger multi-page export.',
  PROVIDER_VOLUME_RATIO_MISMATCH:
    "The provider's VolumeRatio column differs from this app's computed Volume Ratio for one or more rows.",
  DUPLICATE_ISIN_IN_RUN: 'The same ISIN appears on more than one row.',
  DUPLICATE_NSE_CODE_IN_RUN: 'The same NSE Code appears on more than one row.',
  ROWS_EXCLUDED_FROM_COMPARISON:
    'One or more rows have no usable identifier and are excluded from comparison.',
  IDENTIFIER_COLUMN_MISSING:
    'One identifier column (ISIN or NSE Code) is missing; matching uses the other.',
  EMPTY_RUN: 'This file has a header row but no data rows.',
};

function withField(message: string, field?: string): string {
  return field ? `${message} (field: ${field})` : message;
}

export function describeImportError(e: ImportError): string {
  return withField(ERROR_MESSAGES[e.code], e.field);
}

export function describeImportWarning(w: ImportWarning): string {
  return withField(WARNING_MESSAGES[w.code], w.field);
}

const VOLUME_RATIO_REASON_MESSAGES: Record<VolumeRatioReason, string> = {
  MISSING_NUMERATOR: 'no numerator value',
  MISSING_DENOMINATOR: 'no denominator value',
  INVALID_NUMERATOR: 'numerator is not a valid number',
  INVALID_DENOMINATOR: 'denominator is not a valid number',
  NEGATIVE_NUMERATOR: 'numerator is negative',
  NON_POSITIVE_DENOMINATOR: 'denominator is zero or negative',
};

/** Never color-only: always returns text describing the value or the reason it is unavailable. */
export function describeVolumeRatio(metric: VolumeRatioMetric): string {
  return metric.status === 'valid'
    ? metric.value
    : `n/a (${VOLUME_RATIO_REASON_MESSAGES[metric.reason]})`;
}
