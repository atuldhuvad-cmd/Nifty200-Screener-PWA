import { analyzeCsvBytes, type CsvAnalysis } from '../csv/analyze';
import { PARSER_VERSION } from '../csv/parse';
import { decodeBase64 } from './base64';
import { canonicalize, jcsSha256Hex } from './canonicalHash';
import validateSchemaV1, { type AjvValidationError } from './schema/generated/validateEnvelopeV1';
import validateSchemaV2 from './schema/generated/validateEnvelopeV2';
import { sha256Hex } from './hash';
import {
  SCHEMA_VERSION_V1,
  SCHEMA_VERSION_V2,
  type RunEnvelopeV1,
  type RunEnvelopeV2,
  type UnknownEnvelopeLike,
} from './types';

export const QUARANTINE_REASONS = [
  'SCHEMA_INVALID',
  'BASE64_DECODE_FAILED',
  'ORIGINAL_FILE_HASH_MISMATCH',
  'ENVELOPE_HASH_MISMATCH',
  'ROW_WIDTH_INCONSISTENT',
  'STOCK_COUNT_MISMATCH',
  'METRICS_COUNT_MISMATCH',
  'UNKNOWN_PARSER_VERSION',
  'REPLAY_PARSE_FAILED',
  'REPLAY_MAPPING_CHANGED',
  'REPLAY_HEADERS_MISMATCH',
  'REPLAY_ROWS_MISMATCH',
  'REPLAY_METRICS_MISMATCH',
  // v2 (multipart) only, from here down.
  'SOURCE_FILE_HASH_MISMATCH',
  'COMBINED_ROW_REF_OUT_OF_RANGE',
  'UNIQUE_STOCK_COUNT_MISMATCH',
] as const;
export type QuarantineReason = (typeof QUARANTINE_REASONS)[number];

/** Structural only (instancePath/schemaPath/keyword) — Ajv does not include the data value here. */
export interface SchemaIssue {
  instancePath: string;
  schemaPath: string;
  keyword: string;
}

export type ValidationOutcome =
  | { status: 'valid' }
  | { status: 'unsupported_schema' }
  | { status: 'quarantined'; reasons: QuarantineReason[]; schemaIssues?: SchemaIssue[] };

function toSchemaIssues(errors: AjvValidationError[] | null | undefined): SchemaIssue[] {
  return (errors ?? []).map((e) => ({
    instancePath: e.instancePath,
    schemaPath: e.schemaPath,
    keyword: e.keyword,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates a stored envelope: schema (§ known-version structural + pattern checks), both
 * hashes, semantic cross-field invariants the schema cannot express, and deterministic replay
 * (reparse the preserved bytes with the recorded parser version; confirm parsed cells and
 * computed metrics still match). A genuinely unrecognized `schema_version` is reported as
 * `unsupported_schema` — preserved, never forced through this schema. Any other structural
 * defect, hash mismatch, or replay divergence is `quarantined`, never silently accepted.
 */
export async function validateEnvelope(raw: unknown): Promise<ValidationOutcome> {
  if (!isRecord(raw)) return { status: 'quarantined', reasons: ['SCHEMA_INVALID'] };

  const versionField = (raw as UnknownEnvelopeLike).schema_version;
  if (typeof versionField !== 'string') {
    return { status: 'quarantined', reasons: ['SCHEMA_INVALID'] };
  }
  if (versionField === SCHEMA_VERSION_V1) return validateV1(raw);
  if (versionField === SCHEMA_VERSION_V2) return validateV2(raw);
  return { status: 'unsupported_schema' };
}

async function validateV1(raw: Record<string, unknown>): Promise<ValidationOutcome> {
  if (!validateSchemaV1(raw)) {
    return {
      status: 'quarantined',
      reasons: ['SCHEMA_INVALID'],
      schemaIssues: toSchemaIssues(validateSchemaV1.errors),
    };
  }

  // Schema-valid, so this cast is sound for the remaining structural/semantic checks.
  const envelope = raw as unknown as RunEnvelopeV1;
  const reasons: QuarantineReason[] = [];

  const decoded = decodeBase64(envelope.original_file_base64);
  if (!decoded.ok) {
    return { status: 'quarantined', reasons: ['BASE64_DECODE_FAILED'] };
  }

  const [originalHash, envelopeHash] = await Promise.all([
    sha256Hex(decoded.bytes),
    jcsSha256Hex(withoutEnvelopeHash(envelope)),
  ]);
  if (originalHash !== envelope.original_file_sha256) reasons.push('ORIGINAL_FILE_HASH_MISMATCH');
  if (envelopeHash !== envelope.envelope_sha256) reasons.push('ENVELOPE_HASH_MISMATCH');

  if (envelope.rows.some((row) => row.length !== envelope.headers.length)) {
    reasons.push('ROW_WIDTH_INCONSISTENT');
  }
  if (envelope.stock_count !== envelope.rows.length) reasons.push('STOCK_COUNT_MISMATCH');
  if (envelope.computed_metrics.volume_ratio_v1.length !== envelope.rows.length) {
    reasons.push('METRICS_COUNT_MISMATCH');
  }

  if (envelope.parser.parser_version !== PARSER_VERSION) {
    // Only one parser version has ever been produced; anything else cannot be replayed.
    reasons.push('UNKNOWN_PARSER_VERSION');
  } else {
    reasons.push(...replayReasons(envelope, decoded.bytes));
  }

  if (reasons.length > 0) return { status: 'quarantined', reasons };
  return { status: 'valid' };
}

function withoutEnvelopeHash(envelope: RunEnvelopeV1): unknown {
  const rest: Partial<RunEnvelopeV1> = { ...envelope };
  delete rest.envelope_sha256;
  return rest;
}

function replayReasons(envelope: RunEnvelopeV1, originalBytes: Uint8Array): QuarantineReason[] {
  const replayed = analyzeCsvBytes(originalBytes);
  if (!replayed.ok) return ['REPLAY_PARSE_FAILED'];
  if (!replayed.canConfirm) return ['REPLAY_MAPPING_CHANGED'];

  const reasons: QuarantineReason[] = [];
  if (canonicalize(replayed.parsed.headers) !== canonicalize(envelope.headers)) {
    reasons.push('REPLAY_HEADERS_MISMATCH');
  }
  if (canonicalize(replayed.parsed.rows) !== canonicalize(envelope.rows)) {
    reasons.push('REPLAY_ROWS_MISMATCH');
  }
  const replayedMetrics = replayed.rows.map((r) => r.volumeRatio);
  if (canonicalize(replayedMetrics) !== canonicalize(envelope.computed_metrics.volume_ratio_v1)) {
    reasons.push('REPLAY_METRICS_MISMATCH');
  }
  return reasons;
}

function withoutEnvelopeHashV2(envelope: RunEnvelopeV2): unknown {
  const rest: Partial<RunEnvelopeV2> = { ...envelope };
  delete rest.envelope_sha256;
  return rest;
}

async function validateV2(raw: Record<string, unknown>): Promise<ValidationOutcome> {
  if (!validateSchemaV2(raw)) {
    return {
      status: 'quarantined',
      reasons: ['SCHEMA_INVALID'],
      schemaIssues: toSchemaIssues(validateSchemaV2.errors),
    };
  }

  // Schema-valid, so this cast is sound for the remaining structural/semantic checks.
  const envelope = raw as unknown as RunEnvelopeV2;
  const reasons: QuarantineReason[] = [];

  const decodedSources: Uint8Array[] = [];
  for (const sf of envelope.source_files) {
    const decoded = decodeBase64(sf.original_file_base64);
    if (!decoded.ok) return { status: 'quarantined', reasons: ['BASE64_DECODE_FAILED'] };
    decodedSources.push(decoded.bytes);
  }

  const [sourceHashes, envelopeHash] = await Promise.all([
    Promise.all(decodedSources.map((bytes) => sha256Hex(bytes))),
    jcsSha256Hex(withoutEnvelopeHashV2(envelope)),
  ]);
  const sourceHashMismatch = envelope.source_files.some(
    (sf, i) => sourceHashes[i] !== sf.original_file_sha256,
  );
  if (sourceHashMismatch) reasons.push('SOURCE_FILE_HASH_MISMATCH');
  if (envelopeHash !== envelope.envelope_sha256) reasons.push('ENVELOPE_HASH_MISMATCH');

  const rowWidthInconsistent = envelope.source_files.some((sf) =>
    sf.rows.some((row) => row.length !== sf.headers.length),
  );
  if (rowWidthInconsistent) reasons.push('ROW_WIDTH_INCONSISTENT');

  const refsInBounds = envelope.combined_row_refs.every((ref) => {
    const sf = envelope.source_files[ref.source_index];
    return sf !== undefined && ref.source_row_index >= 0 && ref.source_row_index < sf.rows.length;
  });
  if (!refsInBounds) reasons.push('COMBINED_ROW_REF_OUT_OF_RANGE');

  if (envelope.stock_count !== envelope.combined_row_refs.length) {
    reasons.push('STOCK_COUNT_MISMATCH');
  }
  if (envelope.computed_metrics.volume_ratio_v1.length !== envelope.combined_row_refs.length) {
    reasons.push('METRICS_COUNT_MISMATCH');
  }

  const unknownParserVersion = envelope.source_files.some(
    (sf) => sf.parser.parser_version !== PARSER_VERSION,
  );
  if (unknownParserVersion) {
    // Only one parser version has ever been produced; anything else cannot be replayed.
    reasons.push('UNKNOWN_PARSER_VERSION');
  } else if (refsInBounds) {
    // Replay against out-of-range refs would only produce a second, redundant failure mode.
    reasons.push(...replayReasonsV2(envelope, decodedSources));
  }

  if (reasons.length > 0) return { status: 'quarantined', reasons };
  return { status: 'valid' };
}

/** Re-parses every preserved source file and confirms the recorded combined ordering,
 * per-row computed metrics, and unique-stock count are exactly reproducible from it — the v2
 * analogue of v1's `replayReasons`, generalized across N source files. This intentionally does
 * NOT re-run the multipart overlap rules (duplicate ISIN across parts, etc.): those are a
 * commit-time UI gate, not a stored-data integrity property, and re-enforcing them here would
 * quarantine an already-legitimately-committed run if a *future* stricter rule were added. */
function replayReasonsV2(
  envelope: RunEnvelopeV2,
  decodedSources: Uint8Array[],
): QuarantineReason[] {
  const replayedParts = decodedSources.map((bytes) => analyzeCsvBytes(bytes));
  if (replayedParts.some((p) => !p.ok)) return ['REPLAY_PARSE_FAILED'];
  const okParts = replayedParts as Extract<CsvAnalysis, { ok: true }>[];
  if (okParts.some((p) => !p.canConfirm)) return ['REPLAY_MAPPING_CHANGED'];

  const reasons: QuarantineReason[] = [];
  let headersMismatch = false;
  let rowsMismatch = false;
  okParts.forEach((part, i) => {
    const sf = envelope.source_files[i];
    if (sf === undefined) return; // same length by construction; defensive only
    if (canonicalize(part.parsed.headers) !== canonicalize(sf.headers)) headersMismatch = true;
    if (canonicalize(part.parsed.rows) !== canonicalize(sf.rows)) rowsMismatch = true;
  });
  if (headersMismatch) reasons.push('REPLAY_HEADERS_MISMATCH');
  if (rowsMismatch) reasons.push('REPLAY_ROWS_MISMATCH');

  const replayedMetrics: unknown[] = [];
  const replayedIdentityKeys = new Set<string>();
  let refOutOfRange = false;
  for (const ref of envelope.combined_row_refs) {
    const part = okParts[ref.source_index];
    const row = part?.rows[ref.source_row_index];
    if (part === undefined || row === undefined) {
      refOutOfRange = true;
      continue;
    }
    replayedMetrics.push(row.volumeRatio);
    if (row.identity.match_method === 'isin' && row.identity.normalized_isin !== null) {
      replayedIdentityKeys.add(`isin:${row.identity.normalized_isin}`);
    } else if (
      row.identity.match_method === 'nse_code_provisional' &&
      row.identity.normalized_nse_code !== null
    ) {
      replayedIdentityKeys.add(`nse:${row.identity.normalized_nse_code}`);
    }
  }
  if (refOutOfRange) reasons.push('COMBINED_ROW_REF_OUT_OF_RANGE');
  if (canonicalize(replayedMetrics) !== canonicalize(envelope.computed_metrics.volume_ratio_v1)) {
    reasons.push('REPLAY_METRICS_MISMATCH');
  }
  if (replayedIdentityKeys.size !== envelope.unique_stock_count) {
    reasons.push('UNIQUE_STOCK_COUNT_MISMATCH');
  }
  return reasons;
}
