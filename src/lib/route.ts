/**
 * Minimal hash-based routing for three views: the run-history list (no hash, or any hash that
 * doesn't match a more specific route), one run's detail (`#/run/<run_id>`), and the Step 5B
 * longitudinal comparison view (`#/compare`, or `#/compare/<identity_key>` once a stock is
 * selected). A real `<a href>` / `location.hash` pair, rather than a router library, so keyboard
 * navigation, the browser back button, and reload-preserves-route all work for free via native
 * browser history — no framework router was added for this.
 */
export function parseRunIdFromHash(hash: string): string | null {
  const match = /^#\/run\/([^/]+)$/.exec(hash);
  return match?.[1] === undefined ? null : decodeURIComponent(match[1]);
}

export function runDetailHash(runId: string): string {
  return `#/run/${encodeURIComponent(runId)}`;
}

const COMPARE_PATTERN = /^#\/compare(?:\/([^/]+))?$/;

/** `null` when `hash` isn't a comparison route at all; otherwise the selected identity key, or
 * `null` when on `#/compare` with no stock chosen yet (the picker-only state). */
export function parseCompareRouteFromHash(hash: string): { identityKey: string | null } | null {
  const match = COMPARE_PATTERN.exec(hash);
  if (!match) return null;
  return { identityKey: match[1] === undefined ? null : decodeURIComponent(match[1]) };
}

export function compareHash(identityKey?: string | null): string {
  return identityKey ? `#/compare/${encodeURIComponent(identityKey)}` : '#/compare';
}

export function historyHash(): string {
  return '#/';
}
