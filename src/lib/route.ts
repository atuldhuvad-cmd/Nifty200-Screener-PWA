/**
 * Minimal hash-based routing for two views: the run-history list (no hash, or any hash that
 * doesn't match a run route) and one run's detail (`#/run/<run_id>`). A real `<a href>` /
 * `location.hash` pair, rather than a router library, so keyboard navigation, the browser back
 * button, and reload-preserves-route all work for free via native browser history.
 */
export function parseRunIdFromHash(hash: string): string | null {
  const match = /^#\/run\/([^/]+)$/.exec(hash);
  return match?.[1] === undefined ? null : decodeURIComponent(match[1]);
}

export function runDetailHash(runId: string): string {
  return `#/run/${encodeURIComponent(runId)}`;
}
