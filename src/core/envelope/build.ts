import type { CsvAnalysis } from '../csv/analyze';
import { encodeBase64 } from './base64';
import { jcsSha256Hex } from './canonicalHash';
import { sha256Hex } from './hash';
import { createRunId } from './runId';
import {
  ENVELOPE_HASH_ALGORITHM,
  SCHEMA_VERSION_V1,
  type ComputedMetricsV1,
  type ParserProvenanceV1,
  type RunEnvelopeV1,
} from './types';
import { DEFAULT_RUN_UNIVERSE, type RunUniverse } from './universe';

// `canConfirm` is a plain `boolean` field on the single `ok: true` variant of CsvAnalysis
// (not a discriminant with its own literal-typed variants), so it cannot be narrowed via
// `Extract` at the type level; `buildEnvelope` checks it at runtime instead.
type OkAnalysis = Extract<CsvAnalysis, { ok: true }>;

export interface BuildEnvelopeInput {
  originalBytes: Uint8Array;
  /** The analysis of `originalBytes` (from `analyzeCsvBytes`); must have `canConfirm: true`. */
  analysis: OkAnalysis;
  originalFilename: string;
  /** Browser-supplied MIME type, provenance only — never validated (brief: "MIME type handling"). */
  originalFileMimeType: string;
  /** ISO YYYY-MM-DD; the caller must already have the user's confirmation for this date. */
  effectiveDate: string;
  /** Defaults to `new Date()`. Injectable for deterministic tests. */
  importedAt?: Date;
  queryText?: string;
  universe?: RunUniverse;
  /** Defaults to `crypto.randomUUID()`. Injectable for deterministic tests. */
  runId?: string;
}

export type BuildEnvelopeResult =
  | { ok: true; envelope: RunEnvelopeV1 }
  /** The caller passed an analysis that was blocked; there is nothing to commit. */
  | { ok: false; reason: 'cannot_confirm' };

function toParserProvenance(config: OkAnalysis['parsed']['config']): ParserProvenanceV1 {
  return {
    parser_id: config.parserId,
    parser_version: config.parserVersion,
    config_id: config.configId,
    encoding: config.encoding,
    bom_present: config.bomPresent,
    delimiter: config.delimiter,
    quote: config.quote,
    escape: config.escape,
    newline: config.newline,
    final_newline: config.finalNewline,
  };
}

export async function buildEnvelope(input: BuildEnvelopeInput): Promise<BuildEnvelopeResult> {
  if (!input.analysis.canConfirm) return { ok: false, reason: 'cannot_confirm' };

  const { originalBytes, analysis } = input;
  const [originalFileSha256, originalFileBase64] = await Promise.all([
    sha256Hex(originalBytes),
    Promise.resolve(encodeBase64(originalBytes)),
  ]);

  const computedMetrics: ComputedMetricsV1 = {
    volume_ratio_v1: analysis.rows.map((r) => r.volumeRatio),
  };

  const withoutHash: Omit<RunEnvelopeV1, 'envelope_sha256'> = {
    schema_version: SCHEMA_VERSION_V1,
    run_id: input.runId ?? createRunId(),
    universe: input.universe ?? DEFAULT_RUN_UNIVERSE,
    universe_validation: 'user_confirmed',
    effective_date: input.effectiveDate,
    imported_at: (input.importedAt ?? new Date()).toISOString(),
    original_filename: input.originalFilename,
    original_file_byte_length: originalBytes.length,
    original_file_mime_type: input.originalFileMimeType,
    original_file_sha256: originalFileSha256,
    original_file_base64: originalFileBase64,
    parser: toParserProvenance(analysis.parsed.config),
    headers: [...analysis.parsed.headers],
    rows: analysis.parsed.rows.map((row) => [...row]),
    import_warnings: analysis.warnings,
    stock_count: analysis.rows.length,
    ...(input.queryText !== undefined ? { query_text: input.queryText } : {}),
    computed_metrics: computedMetrics,
    envelope_hash_algorithm: ENVELOPE_HASH_ALGORITHM,
  };

  const envelope_sha256 = await jcsSha256Hex(withoutHash);
  return { ok: true, envelope: { ...withoutHash, envelope_sha256 } };
}
