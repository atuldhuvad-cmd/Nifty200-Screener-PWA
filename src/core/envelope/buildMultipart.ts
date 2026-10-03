import type { MultipartAnalysis } from '../csv/multipart';
import type { ParseConfig } from '../csv/parse';
import { encodeBase64 } from './base64';
import { jcsSha256Hex } from './canonicalHash';
import { sha256Hex } from './hash';
import {
  ENVELOPE_HASH_ALGORITHM,
  SCHEMA_VERSION_V2,
  type CombinedImportWarning,
  type CombinedRowRefV2,
  type ComputedMetricsV2,
  type ParserProvenanceV1,
  type RunEnvelopeV2,
  type SourceFileV2,
} from './types';
import { DEFAULT_RUN_UNIVERSE, type RunUniverse } from './universe';

type OkMultipartAnalysis = Extract<MultipartAnalysis, { ok: true }>;

export interface BuildMultipartEnvelopeInput {
  /** Must have `canConfirm: true` (no blocking per-part errors, no blocking overlap errors). */
  analysis: OkMultipartAnalysis;
  /** Browser-supplied MIME type per file, in the same order as the files were selected;
   * provenance only — never validated. */
  fileMimeTypes: string[];
  effectiveDate: string;
  importedAt?: Date;
  queryText?: string;
  universe?: RunUniverse;
  runId?: string;
}

export type BuildMultipartEnvelopeResult =
  { ok: true; envelope: RunEnvelopeV2 } | { ok: false; reason: 'cannot_confirm' };

function toParserProvenance(config: ParseConfig): ParserProvenanceV1 {
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

export async function buildMultipartEnvelope(
  input: BuildMultipartEnvelopeInput,
): Promise<BuildMultipartEnvelopeResult> {
  const { analysis } = input;
  if (!analysis.canConfirm) return { ok: false, reason: 'cannot_confirm' };

  const sourceFiles: SourceFileV2[] = await Promise.all(
    analysis.parts.map(async (part, i) => {
      if (!part.analysis.ok || !part.analysis.canConfirm) {
        // Unreachable: analysis.canConfirm === true implies every part already confirmed.
        throw new Error('inconsistent multipart analysis: an unconfirmed part reached build');
      }
      const [sha256, base64] = await Promise.all([
        sha256Hex(part.bytes),
        Promise.resolve(encodeBase64(part.bytes)),
      ]);
      return {
        original_filename: part.filename,
        original_file_byte_length: part.bytes.length,
        original_file_mime_type: input.fileMimeTypes[i] ?? '',
        original_file_sha256: sha256,
        original_file_base64: base64,
        parser: toParserProvenance(part.analysis.parsed.config),
        headers: [...part.analysis.parsed.headers],
        rows: part.analysis.parsed.rows.map((row) => [...row]),
        import_warnings: part.analysis.warnings,
      };
    }),
  );

  const combined_row_refs: CombinedRowRefV2[] = analysis.combinedRows.map((r) => ({
    source_index: r.sourceIndex,
    source_row_index: r.sourceRowIndex,
  }));

  const computed_metrics: ComputedMetricsV2 = {
    volume_ratio_v1: analysis.combinedRows.map((r) => r.volumeRatio),
  };

  const import_warnings: CombinedImportWarning[] = analysis.warnings.map((w) => ({
    code: w.code,
    unique_stock_count: w.uniqueStockCount,
  }));

  const withoutHash: Omit<RunEnvelopeV2, 'envelope_sha256'> = {
    schema_version: SCHEMA_VERSION_V2,
    run_id: input.runId ?? crypto.randomUUID(),
    universe: input.universe ?? DEFAULT_RUN_UNIVERSE,
    universe_validation: 'user_confirmed',
    effective_date: input.effectiveDate,
    imported_at: (input.importedAt ?? new Date()).toISOString(),
    source_files: sourceFiles,
    combined_row_refs,
    import_warnings,
    stock_count: combined_row_refs.length,
    unique_stock_count: analysis.uniqueStockCount,
    ...(input.queryText !== undefined ? { query_text: input.queryText } : {}),
    computed_metrics,
    envelope_hash_algorithm: ENVELOPE_HASH_ALGORITHM,
  };

  const envelope_sha256 = await jcsSha256Hex(withoutHash);
  return { ok: true, envelope: { ...withoutHash, envelope_sha256 } };
}
