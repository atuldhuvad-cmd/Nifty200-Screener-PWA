import type { RunEnvelopeV1, RunEnvelopeV2 } from '../envelope/types';
import type { RunRecord, UnsupportedSchemaEnvelope } from '../storage/types';

/** This app has only ever produced format_version "1"; an unrecognized value is rejected
 * outright ("reject anything ambiguous ... never guess"), never opportunistically processed. */
export const BACKUP_FORMAT_VERSION = '1';
/** The backup manifest's own schema version — distinct from each embedded envelope's own
 * `schema_version` (v1/v2), which is unrelated and untouched by this file's version. */
export const BACKUP_SCHEMA_VERSION = '1';

/** DECISIONS.md A1: checked on the raw byte length, before any JSON parsing. */
export const BACKUP_MAX_BYTES = 50 * 1024 * 1024; // 50 MiB
/** DECISIONS.md A1: checked on both the manifest's claimed count and the actual array length,
 * before any per-entry validation, hashing, preview, or write. */
export const BACKUP_MAX_RUNS = 2000;

type ExportableEnvelope = RunEnvelopeV1 | RunEnvelopeV2 | UnsupportedSchemaEnvelope;

/**
 * A backup is one JSON file containing the manifest and the immutable run envelopes
 * (DECISIONS.md A1 — no ZIP, so no decompression-bomb/zip-slip handling applies). Deliberately
 * excludes anything device-specific: no OAuth data, Drive file IDs, resumable-session URLs,
 * sync state, `run_variants`, or `quarantine_items` — only what an envelope-allowlisted export
 * actually needs to reconstruct the same runs on any device/account.
 */
export interface BackupFile {
  format_version: typeof BACKUP_FORMAT_VERSION;
  schema_version: typeof BACKUP_SCHEMA_VERSION;
  /** RFC 3339 UTC, ending in Z. */
  created_at: string;
  run_count: number;
  /** Ordered, `=== runs.map(e => e.run_id)`. */
  run_ids: string[];
  /** `run_id -> envelope_sha256`. Redundant with each v1/v2 envelope's own `envelope_sha256`
   * field (kept in sync by construction here) — present explicitly per this round's spec. Best
   * effort for an `unsupported_schema` entry: included only if that opaque object happens to
   * carry a string `envelope_sha256` field; a future schema's actual hash field is this app's
   * business to know nothing about. */
  envelope_hashes: Record<string, string>;
  /** The immutable envelopes themselves, in the same order as `run_ids`. Sync state, and any
   * other device-specific wrapper data, is never included — only `RunRecord.envelope`. */
  runs: ExportableEnvelope[];
}

function envelopeHashOf(envelope: ExportableEnvelope): string | undefined {
  const value = (envelope as { envelope_sha256?: unknown }).envelope_sha256;
  return typeof value === 'string' ? value : undefined;
}

/**
 * Builds the export file from the current canonical runs. Every field is populated from an
 * explicit allowlist (`RunRecord.envelope` only) — never a denylist — so a future field this
 * app doesn't yet know to exclude (an eventual Drive/OAuth-adjacent one) can't leak into an
 * export just by existing on `RunRecord`.
 */
export function buildBackupFile(records: readonly RunRecord[]): BackupFile {
  const runs = records.map((r) => r.envelope);
  const run_ids = runs.map((e) => e.run_id);
  const envelope_hashes: Record<string, string> = {};
  runs.forEach((e) => {
    const hash = envelopeHashOf(e);
    if (hash !== undefined) envelope_hashes[e.run_id] = hash;
  });

  return {
    format_version: BACKUP_FORMAT_VERSION,
    schema_version: BACKUP_SCHEMA_VERSION,
    created_at: new Date().toISOString(),
    run_count: runs.length,
    run_ids,
    envelope_hashes,
    runs,
  };
}

/** `<UTC timestamp>` with `:`/`.` replaced for filesystem safety, e.g.
 * `n200-backup-v1-2026-09-28T21-15-30-123Z.json`. */
export function backupFilename(at: Date = new Date()): string {
  return `n200-backup-v${BACKUP_FORMAT_VERSION}-${at.toISOString().replace(/[:.]/g, '-')}.json`;
}

export type ParseBackupResult =
  | { ok: true; file: BackupFile }
  | { ok: false; reason: 'FILE_TOO_LARGE' }
  | { ok: false; reason: 'INVALID_ENCODING' }
  | { ok: false; reason: 'INVALID_JSON' }
  | { ok: false; reason: 'INVALID_STRUCTURE' }
  | { ok: false; reason: 'UNSUPPORTED_FORMAT_VERSION'; formatVersion: unknown }
  | { ok: false; reason: 'RUN_COUNT_EXCEEDS_LIMIT'; claimed: number; actual: number }
  | { ok: false; reason: 'RUN_COUNT_MISMATCH'; claimed: number; actual: number };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Minimal structural shape check — just enough to read `run_count` and `runs.length` for the
 * A1 count gate below. Full per-envelope schema/hash/replay validation happens later, per
 * entry, via the existing `parseIngestCandidate`/`validateEnvelope` — never duplicated here. */
function hasBackupShape(
  value: unknown,
): value is { format_version: unknown; run_count: number; run_ids: unknown; runs: unknown[] } {
  if (!isPlainObject(value)) return false;
  return (
    'format_version' in value &&
    typeof value['run_count'] === 'number' &&
    Array.isArray(value['run_ids']) &&
    Array.isArray(value['runs'])
  );
}

/**
 * Parses a candidate backup file under DECISIONS.md A1's exact check order: (1) raw byte
 * length against the 50 MiB limit, before any parsing; (2) strict UTF-8 decode + JSON parse;
 * (3) before any validation, hashing, preview, or write, reject if the claimed run count
 * exceeds 2,000, the actual `runs` array length exceeds 2,000, or the two disagree. Performs no
 * database I/O and no per-envelope validation — this function alone decides only whether the
 * file is even eligible to be previewed at all.
 */
export function parseBackupFile(bytes: Uint8Array): ParseBackupResult {
  if (bytes.byteLength > BACKUP_MAX_BYTES) return { ok: false, reason: 'FILE_TOO_LARGE' };

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, reason: 'INVALID_ENCODING' };
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'INVALID_JSON' };
  }

  if (!hasBackupShape(value)) return { ok: false, reason: 'INVALID_STRUCTURE' };
  if (value.format_version !== BACKUP_FORMAT_VERSION) {
    return { ok: false, reason: 'UNSUPPORTED_FORMAT_VERSION', formatVersion: value.format_version };
  }

  const claimed = value.run_count;
  const actual = value.runs.length;
  if (claimed > BACKUP_MAX_RUNS || actual > BACKUP_MAX_RUNS) {
    return { ok: false, reason: 'RUN_COUNT_EXCEEDS_LIMIT', claimed, actual };
  }
  if (claimed !== actual) {
    return { ok: false, reason: 'RUN_COUNT_MISMATCH', claimed, actual };
  }

  return { ok: true, file: value as unknown as BackupFile };
}
