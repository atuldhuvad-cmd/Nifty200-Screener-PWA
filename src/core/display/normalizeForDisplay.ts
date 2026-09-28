const NBSP = ' ';
const EDGE_WHITESPACE = new RegExp(`^[ \\t${NBSP}]+|[ \\t${NBSP}]+$`, 'g');
const INNER_WHITESPACE = new RegExp(`[ \\t${NBSP}]+`, 'g');

/**
 * S3: display/sort normalization only - trim outer ASCII space/tab/NBSP and collapse internal
 * runs to one ASCII space. Unlike D3's normalizeHeaderKey, this never folds case. The raw
 * cell/header string in the analysis/envelope is never touched; this is applied only at the
 * point of rendering a value to the screen.
 */
export function normalizeForDisplay(raw: string): string {
  return raw.replace(EDGE_WHITESPACE, '').replace(INNER_WHITESPACE, ' ');
}
