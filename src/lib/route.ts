/**
 * Minimal hash-based routing for three views: the run-history list (no hash, or any hash that
 * doesn't match a more specific route), one run's detail (`#/run/<run_id>`), and the Step 5B
 * longitudinal comparison view (`#/compare`, or `#/compare/<identity_key>` once a stock is
 * selected). A real `<a href>` / `location.hash` pair, rather than a router library, so keyboard
 * navigation, the browser back button, and reload-preserves-route all work for free via native
 * browser history — no framework router was added for this.
 */

/**
 * `decodeURIComponent` throws `URIError` on malformed percent-encoding (e.g. a lone `%`, `%2`,
 * or `%GG`) rather than returning a best-effort result. A hash is user-facing, bookmarkable,
 * shareable text — it must never be trusted to be well-formed. `null` here means exactly "this
 * segment cannot be safely decoded," never a partial/repaired/guessed value; every caller in
 * this module treats that the same as "not a match for this route," falling back to the plain
 * run-history view rather than crashing with an uncaught exception on load or on a same-document
 * hash change.
 */
function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function parseRunIdFromHash(hash: string): string | null {
  const match = /^#\/run\/([^/]+)$/.exec(hash);
  if (match?.[1] === undefined) return null;
  return safeDecodeURIComponent(match[1]);
}

export function runDetailHash(runId: string): string {
  return `#/run/${encodeURIComponent(runId)}`;
}

const COMPARE_PATTERN = /^#\/compare(?:\/([^/]+))?$/;

/** `null` when `hash` isn't a comparison route at all, *or* when it looks like one but its
 * identity-key segment can't be safely decoded (treated identically — never a partial/guessed
 * value). Otherwise the selected identity key, or `null` when on `#/compare` with no stock
 * chosen yet (the picker-only state). */
export function parseCompareRouteFromHash(hash: string): { identityKey: string | null } | null {
  const match = COMPARE_PATTERN.exec(hash);
  if (!match) return null;
  if (match[1] === undefined) return { identityKey: null };
  const decoded = safeDecodeURIComponent(match[1]);
  return decoded === null ? null : { identityKey: decoded };
}

export function compareHash(identityKey?: string | null): string {
  return identityKey ? `#/compare/${encodeURIComponent(identityKey)}` : '#/compare';
}

export function historyHash(): string {
  return '#/';
}

/** Step 6: the backup export/import view. No dynamic segment — a plain, static route. */
export function backupHash(): string {
  return '#/backup';
}

export function isBackupRoute(hash: string): boolean {
  return hash === '#/backup';
}

/** Step 6B: the conflict/quarantine review view. A plain, static route. */
export function reviewHash(): string {
  return '#/review';
}

export function isReviewRoute(hash: string): boolean {
  return hash === '#/review';
}
