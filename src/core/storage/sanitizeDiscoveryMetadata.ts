import {
  QUARANTINE_DETECTION_CONTEXTS,
  type QuarantineDetectionContext,
  type QuarantineDiscoveryMetadata,
} from './types';

export const REDACTED = '[REDACTED]';

const MAX_DRIVE_FILE_ID_LENGTH = 200;
const MAX_BACKUP_ENTRY_NAME_LENGTH = 255;
const MAX_APP_PROPERTY_KEY_LENGTH = 60;
const MAX_APP_PROPERTY_VALUE_LENGTH = 124; // matches Drive's own per-property limit
const MAX_APP_PROPERTIES_COUNT = 30; // matches Drive's own per-app property count limit
const MAX_BACKUP_ENTRY_INDEX = 1_000_000;

// A value shaped like an Authorization header, a JWT, or a URL carrying a query string or
// embedded userinfo credentials is never legitimate discovery metadata — it is redacted
// unconditionally, regardless of length.
const BEARER_OR_BASIC_AUTH = /^(?:bearer|basic)\s+\S+/i;
const JWT_LIKE = /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/;
const URL_WITH_QUERY_STRING = /^[a-z][a-z0-9+.-]*:\/\/(?:[^\s@/]+@)?[^\s?]+\?\S+$/i;
const URL_WITH_USERINFO = /^[a-z][a-z0-9+.-]*:\/\/[^\s@/]+@\S+$/i;
// A long run of opaque token-ish characters is only suspicious where it isn't the field's
// normal shape — a Drive file ID legitimately looks exactly like this.
const LONG_OPAQUE_TOKEN = /^[A-Za-z0-9_-]{40,}$/;

function looksCredentialShaped(value: string, allowLongOpaqueToken: boolean): boolean {
  if (BEARER_OR_BASIC_AUTH.test(value)) return true;
  if (JWT_LIKE.test(value)) return true;
  if (URL_WITH_QUERY_STRING.test(value)) return true;
  if (URL_WITH_USERINFO.test(value)) return true;
  if (!allowLongOpaqueToken && LONG_OPAQUE_TOKEN.test(value)) return true;
  return false;
}

/**
 * Bounds one string field: non-strings are dropped (`undefined`); a credential-shaped value is
 * redacted unconditionally (truncating a secret still leaves a sensitive prefix, so redaction
 * — never truncation — is used for those); an oversized-but-otherwise-ordinary value is
 * truncated rather than dropped outright, since length alone isn't a security signal.
 */
function sanitizeString(
  value: unknown,
  maxLength: number,
  { allowLongOpaqueToken = false }: { allowLongOpaqueToken?: boolean } = {},
): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  if (looksCredentialShaped(value, allowLongOpaqueToken)) return REDACTED;
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function sanitizeAppProperties(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const cleaned: Record<string, string> = {};
  const entries = Object.entries(value as Record<string, unknown>).slice(
    0,
    MAX_APP_PROPERTIES_COUNT,
  );
  for (const [key, raw] of entries) {
    if (key.length === 0 || key.length > MAX_APP_PROPERTY_KEY_LENGTH) continue;
    const sanitized = sanitizeString(raw, MAX_APP_PROPERTY_VALUE_LENGTH);
    if (sanitized !== undefined) cleaned[key] = sanitized;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

function sanitizeDetectionContext(value: unknown): QuarantineDetectionContext | undefined {
  if (typeof value !== 'string') return undefined;
  return (QUARANTINE_DETECTION_CONTEXTS as readonly string[]).includes(value)
    ? (value as QuarantineDetectionContext)
    : undefined;
}

function sanitizeBackupEntryIndex(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
  return value >= 0 && value <= MAX_BACKUP_ENTRY_INDEX ? value : undefined;
}

/**
 * Validates and bounds quarantine discovery metadata at the storage boundary (security review
 * P2-B), before anything reaches `QuarantineItemRecord`: **known keys only** (an unrecognized
 * key is silently dropped, never stored, never causes the whole object to be rejected — a
 * malformed/hostile caller cannot smuggle arbitrary extra data through this path); every known
 * string field is length-bounded; `backup_entry_index` must be a bounded non-negative integer;
 * `detection_context` must be one of `QUARANTINE_DETECTION_CONTEXTS` (a stable code, never free
 * text); and any value that looks credential-shaped is replaced with `'[REDACTED]'`. Returns
 * `undefined` if nothing valid survives, so the caller can omit the field entirely rather than
 * store an empty object.
 */
export function sanitizeQuarantineDiscoveryMetadata(
  input: unknown,
): QuarantineDiscoveryMetadata | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  const record = input as Record<string, unknown>;
  const out: QuarantineDiscoveryMetadata = {};

  const driveFileId = sanitizeString(record['drive_file_id'], MAX_DRIVE_FILE_ID_LENGTH, {
    allowLongOpaqueToken: true,
  });
  if (driveFileId !== undefined) out.drive_file_id = driveFileId;

  const backupEntryName = sanitizeString(record['backup_entry_name'], MAX_BACKUP_ENTRY_NAME_LENGTH);
  if (backupEntryName !== undefined) out.backup_entry_name = backupEntryName;

  const detectionContext = sanitizeDetectionContext(record['detection_context']);
  if (detectionContext !== undefined) out.detection_context = detectionContext;

  const backupEntryIndex = sanitizeBackupEntryIndex(record['backup_entry_index']);
  if (backupEntryIndex !== undefined) out.backup_entry_index = backupEntryIndex;

  const appProperties = sanitizeAppProperties(record['drive_app_properties']);
  if (appProperties !== undefined) out.drive_app_properties = appProperties;

  return Object.keys(out).length > 0 ? out : undefined;
}
