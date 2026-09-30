export type DriveErrorKind =
  | 'bad_request'
  | 'invalid_page_token'
  | 'unauthorized'
  | 'quota_or_rate_limited'
  | 'quota_exhausted'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'server_error'
  | 'timeout'
  | 'network'
  | 'cancelled'
  | 'protocol';

const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded']);

/** Retrying cannot help: the account's storage or daily allowance is used up. */
const EXHAUSTED_REASONS = new Set(['storageQuotaExceeded', 'dailyLimitExceeded']);

/**
 * A Drive failure reduced to a stable, non-sensitive shape. It deliberately carries no response
 * body, URL, header or token: only the class of failure, the HTTP status and Google's short
 * `reason` code, so it can be stored or shown without leaking anything.
 */
export class DriveError extends Error {
  readonly kind: DriveErrorKind;
  readonly status: number | null;
  readonly reason: string | null;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;

  constructor(
    kind: DriveErrorKind,
    options: { status?: number | null; reason?: string | null; retryAfterMs?: number | null } = {},
  ) {
    super(`DRIVE_${kind.toUpperCase()}`);
    this.name = 'DriveError';
    this.kind = kind;
    this.status = options.status ?? null;
    this.reason = options.reason ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.retryable =
      kind === 'quota_or_rate_limited' ||
      kind === 'server_error' ||
      kind === 'network' ||
      kind === 'timeout';
  }

  /** A stable code for storing in a run's sync diagnostics. */
  get code(): string {
    return this.reason === null ? this.message : `${this.message}:${this.reason}`;
  }
}

/** Maps an HTTP error response to the exact error class the brief's policy requires. */
export function classifyHttpError(
  status: number,
  reason: string | null,
  context: { hasPageToken?: boolean } = {},
): DriveErrorKind {
  if (status === 400) return context.hasPageToken === true ? 'invalid_page_token' : 'bad_request';
  if (status === 401) return 'unauthorized';
  if (status === 403) {
    if (reason !== null && RATE_LIMIT_REASONS.has(reason)) return 'quota_or_rate_limited';
    if (reason !== null && EXHAUSTED_REASONS.has(reason)) return 'quota_exhausted';
    return 'forbidden';
  }
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'quota_or_rate_limited';
  if (status >= 500 && status <= 599) return 'server_error';
  return 'protocol';
}
