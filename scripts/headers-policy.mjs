// Parses and validates the host response-headers file (`public/_headers`, shipped as
// `dist/_headers`). The page CSP stays the meta tag in index.html; this file may only add
// protections a meta tag cannot express. Anything that would loosen the site fails the scan.

/** Headers every page response must carry, with the exact value required. */
export const REQUIRED_GLOBAL_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "frame-ancestors 'none'",
  // Not `same-origin`: Google's sign-in popup must be able to message the opener.
  'cross-origin-opener-policy': 'same-origin-allow-popups',
};

/** The only headers the file may set. */
const ALLOWED_HEADERS = new Set([
  ...Object.keys(REQUIRED_GLOBAL_HEADERS),
  'permissions-policy',
  'cache-control',
]);

/**
 * @param {string} content
 * @returns {{ path: string, headers: Record<string, string> }[]}
 */
export function parseHeadersFile(content) {
  /** @type {{ path: string, headers: Record<string, string> }[]} */
  const blocks = [];
  for (const raw of content.split(/\r?\n/)) {
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      blocks.push({ path: raw.trim(), headers: {} });
      continue;
    }
    const block = blocks[blocks.length - 1];
    const at = raw.indexOf(':');
    if (block === undefined || at < 0) throw new Error('headers: malformed line');
    block.headers[raw.slice(0, at).trim().toLowerCase()] = raw.slice(at + 1).trim();
  }
  return blocks;
}

/**
 * @param {string | null} content the file's text, or null if it is missing
 * @returns {string[]} rule names; empty when the file is acceptable
 */
export function checkHeadersFile(content) {
  if (content === null) return ['HEADERS_MISSING'];
  /** @type {string[]} */
  const problems = [];
  let blocks;
  try {
    blocks = parseHeadersFile(content);
  } catch {
    return ['HEADERS_MALFORMED'];
  }
  const global = blocks.find((b) => b.path === '/*');
  for (const [name, value] of Object.entries(REQUIRED_GLOBAL_HEADERS)) {
    if (global?.headers[name] !== value) problems.push(`HEADERS_REQUIRED:${name}`);
  }
  for (const block of blocks) {
    if (/\bhttps?:\/\//i.test(block.path)) problems.push('HEADERS_PATH_NAMES_ORIGIN');
    for (const [name, value] of Object.entries(block.headers)) {
      if (!ALLOWED_HEADERS.has(name)) problems.push(`HEADERS_UNAPPROVED:${name}`);
      if (/\*/.test(value) && name !== 'cache-control') problems.push(`HEADERS_WILDCARD:${name}`);
      if (/unsafe-|https?:\/\//i.test(value)) problems.push(`HEADERS_LOOSE_VALUE:${name}`);
    }
  }
  // Long-lived caching is only for content-hashed assets.
  for (const block of blocks) {
    if (/immutable/.test(block.headers['cache-control'] ?? '') && block.path !== '/assets/*') {
      problems.push('HEADERS_IMMUTABLE_OUTSIDE_ASSETS');
    }
  }
  return [...new Set(problems)];
}

/**
 * The `/*` headers as a plain object, for serving the preview build under the same headers.
 * @param {string} content
 * @returns {Record<string, string>}
 */
export function globalHeaders(content) {
  return parseHeadersFile(content).find((b) => b.path === '/*')?.headers ?? {};
}

/**
 * The headers a host applies to one request path: every matching block, in file order. A `*` in a
 * block's path matches any run of characters (Cloudflare Pages "splat"). When several blocks set
 * the same header, the values are joined with ", " (Cloudflare's documented behaviour), not
 * replaced. The preview server uses this so local runs see the same headers as production would.
 * @param {string} content
 * @param {string} pathname
 * @returns {Record<string, string>}
 */
export function headersForPath(content, pathname) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const block of parseHeadersFile(content)) {
    const escaped = block.path.replace(/[.+?^${}()|[\]\\]/g, String.raw`\$&`);
    const pattern = new RegExp(`^${escaped.replace(/\*/g, '.*')}$`);
    if (!pattern.test(pathname)) continue;
    for (const [name, value] of Object.entries(block.headers)) {
      out[name] = out[name] === undefined ? value : `${out[name]}, ${value}`;
    }
  }
  return out;
}
