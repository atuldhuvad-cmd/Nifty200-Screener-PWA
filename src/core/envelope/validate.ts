import { analyzeCsvBytes } from '../csv/analyze';
import { PARSER_VERSION } from '../csv/parse';
import { decodeBase64 } from './base64';
import { canonicalize, jcsSha256Hex } from './canonicalHash';
import validateSchema, { type AjvValidationError } from './schema/generated/validateEnvelopeV1';
import { sha256Hex } from './hash';
import { SCHEMA_VERSION_V1, type RunEnvelopeV1, type UnknownEnvelopeLike } from './types';

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
  if (versionField !== SCHEMA_VERSION_V1) {
    return { status: 'unsupported_schema' };
  }

  if (!validateSchema(raw)) {
    return {
      status: 'quarantined',
      reasons: ['SCHEMA_INVALID'],
      schemaIssues: toSchemaIssues(validateSchema.errors),
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
