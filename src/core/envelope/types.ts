import type { ImportWarning } from '../csv/types';
import type { VolumeRatioMetric } from '../csv/volumeRatio';
import type { RunUniverse } from './universe';

export const SCHEMA_VERSION_V1 = '1';
export const SCHEMA_VERSION_V2 = '2';
export const ENVELOPE_HASH_ALGORITHM = 'sha256-jcs-rfc8785-v1';

export interface ParserProvenanceV1 {
  parser_id: string;
  parser_version: string;
  config_id: string;
  encoding: 'utf-8';
  bom_present: boolean;
  delimiter: ',';
  quote: '"';
  escape: '"';
  newline: 'LF' | 'CRLF' | 'mixed' | 'none';
  final_newline: boolean;
}

export interface ComputedMetricsV1 {
  /** Index-aligned with `rows`. */
  volume_ratio_v1: VolumeRatioMetric[];
}

/**
 * The immutable run envelope, schema v1. Per the brief, this is the sole persisted unit:
 * raw bytes (losslessly, as Base64) + raw parsed cells + computed metrics, kept separate.
 * Per-row stock identity (ISIN/NSE Code classification) is intentionally NOT stored here —
 * it is a disposable, rebuildable index recomputed from the raw cells (Engineering Standards:
 * "Derived indexes ... must never become the sole copy of any information"), not frozen at
 * import time the way parser config and volume_ratio_v1 are.
 */
export interface RunEnvelopeV1 {
  schema_version: typeof SCHEMA_VERSION_V1;
  run_id: string;
  universe: RunUniverse;
  universe_validation: 'user_confirmed';
  /** ISO YYYY-MM-DD, user-confirmed at import. */
  effective_date: string;
  /** RFC 3339, UTC, ending in Z. */
  imported_at: string;
  original_filename: string;
  original_file_byte_length: number;
  /** Provenance only; never trusted for validation (brief, "MIME type handling"). */
  original_file_mime_type: string;
  /** Lowercase 64-char hex. */
  original_file_sha256: string;
  /** Canonical RFC 4648 Base64 of the original CSV bytes, no whitespace. */
  original_file_base64: string;
  parser: ParserProvenanceV1;
  /** Header strings exactly as decoded, in file order. Never mutated. */
  headers: string[];
  /** Data rows as ordered cell arrays, each the same width as `headers`. Never mutated. */
  rows: string[][];
  /** Snapshot of the warnings shown to the user at import time. Structural only. */
  import_warnings: ImportWarning[];
  /** Equals `rows.length`. */
  stock_count: number;
  query_text?: string;
  computed_metrics: ComputedMetricsV1;
  envelope_hash_algorithm: typeof ENVELOPE_HASH_ALGORITHM;
  /** Lowercase 64-char hex, RFC 8785 JCS over every other top-level field. */
  envelope_sha256: string;
}

/**
 * One source CSV file within a multipart run (Step 4A: a Trendlyne export split across several
 * 100-row pagination pages, imported together as one run). Mirrors the fields v1 kept at the
 * envelope's top level, since v2 can have more than one — every source file is preserved
 * independently and losslessly, exactly as a v1 envelope preserves its single file.
 */
export interface SourceFileV2 {
  original_filename: string;
  original_file_byte_length: number;
  /** Provenance only; never trusted for validation (brief, "MIME type handling"). */
  original_file_mime_type: string;
  /** Lowercase 64-char hex. */
  original_file_sha256: string;
  /** Canonical RFC 4648 Base64 of this source file's bytes, no whitespace. */
  original_file_base64: string;
  parser: ParserProvenanceV1;
  /** Header strings exactly as decoded, in file order. Never mutated. */
  headers: string[];
  /** Data rows as ordered cell arrays, each the same width as `headers`. Never mutated. */
  rows: string[][];
  /** This source file's own warnings from its independent analysis (e.g. M1 page-size). */
  import_warnings: ImportWarning[];
}

/** Identifies which source file and which row within it produced one combined row. */
export interface CombinedRowRefV2 {
  /** Index into `source_files`. */
  source_index: number;
  /** Index into `source_files[source_index].rows`. */
  source_row_index: number;
}

export interface ComputedMetricsV2 {
  /** Index-aligned with `combined_row_refs`. */
  volume_ratio_v1: VolumeRatioMetric[];
}

/** Combined-level warning codes: structural facts about the combined run, distinct from any
 * single source file's own `ImportWarningCode`s (which stay per-part in `source_files[i]`). */
export const COMBINED_IMPORT_WARNING_CODES = [
  /** Non-blocking; requires explicit confirmation when a selected universe has a known count and
   * the combined unique count differs. */
  'COMBINED_COUNT_NOT_200',
] as const;
export type CombinedImportWarningCode = (typeof COMBINED_IMPORT_WARNING_CODES)[number];

export interface CombinedImportWarning {
  code: CombinedImportWarningCode;
  unique_stock_count: number;
}

/**
 * Multipart run envelope, schema v2 (Step 4A). Amends the M1 "one CSV = one run" decision:
 * Trendlyne limits exports to 100 rows, so a run may now be built from two or more explicitly
 * selected pagination parts of the same result, combined in user-selected file order followed
 * by row order within each file. Backward-compatible with v1: this is a new, additive schema
 * version, never an in-place change to `RunEnvelopeV1` — a v1 single-file run remains fully
 * valid and is never migrated or reinterpreted as v2.
 */
export interface RunEnvelopeV2 {
  schema_version: typeof SCHEMA_VERSION_V2;
  run_id: string;
  universe: RunUniverse;
  universe_validation: 'user_confirmed';
  /** ISO YYYY-MM-DD, user-confirmed at import; one shared date for the whole combined run. */
  effective_date: string;
  /** RFC 3339, UTC, ending in Z. */
  imported_at: string;
  /** Every source file, independently preserved, in user-selected order. */
  source_files: SourceFileV2[];
  /** The combined row ordering: source order, then row order within each source. Index-aligned
   * with `computed_metrics.volume_ratio_v1`. */
  combined_row_refs: CombinedRowRefV2[];
  /** Combined-level warnings only (e.g. "combined count differs"); each source file's own
   * warnings live in `source_files[i].import_warnings`. */
  import_warnings: CombinedImportWarning[];
  /** Equals `combined_row_refs.length` — total combined row count (mirrors v1's `stock_count`
   * meaning: total rows, not deduplicated). */
  stock_count: number;
  /** Distinct-identity count across the combined rows (ISIN when valid, else provisional NSE
   * Code) — what the brief calls the "combined unique-stock count". */
  unique_stock_count: number;
  query_text?: string;
  computed_metrics: ComputedMetricsV2;
  envelope_hash_algorithm: typeof ENVELOPE_HASH_ALGORITHM;
  /** Lowercase 64-char hex, RFC 8785 JCS over every other top-level field. */
  envelope_sha256: string;
}

/** Any object with only a schema_version read from it; used before full validation. */
export interface UnknownEnvelopeLike {
  schema_version?: unknown;
}
