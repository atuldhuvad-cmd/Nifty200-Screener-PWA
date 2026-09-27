import type { ImportWarning } from '../csv/types';
import type { VolumeRatioMetric } from '../csv/volumeRatio';

export const SCHEMA_VERSION_V1 = '1';
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
  universe: 'Nifty 200';
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

/** Any object with only a schema_version read from it; used before full validation. */
export interface UnknownEnvelopeLike {
  schema_version?: unknown;
}
