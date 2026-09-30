// The one approved Content-Security-Policy and the Google hosts it (and the bundle) may name.
// Step 10 loosens the original policy ONLY for the exact Google Identity Services and Drive
// hosts the connect flow needs. Anything else (a new host, a wildcard, inline or eval) fails
// `npm run scan:dist`.

/** @type {Record<string, string[]>} */
export const APPROVED_CSP = {
  'default-src': ["'self'"],
  'script-src': ["'self'", 'https://accounts.google.com/gsi/client'],
  'style-src': ["'self'", 'https://accounts.google.com/gsi/style'],
  'img-src': ["'self'", 'data:'],
  'connect-src': ["'self'", 'https://www.googleapis.com', 'https://accounts.google.com/gsi/'],
  'frame-src': ['https://accounts.google.com/gsi/'],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
};

/** Google hostnames the shipped bundle may mention (client IDs are handled separately). */
export const APPROVED_GOOGLE_HOSTS = ['accounts.google.com', 'www.googleapis.com'];

/**
 * @param {string} content
 * @returns {Record<string, string[]>}
 */
export function parseCsp(content) {
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const part of content.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name !== undefined && name !== '') out[name] = values;
  }
  return out;
}

/**
 * @param {string} html
 * @returns {boolean} whether the page's CSP meta tag is exactly the approved policy
 */
export function pageCspIsApproved(html) {
  const match = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html);
  if (match?.[1] === undefined) return false;
  const actual = parseCsp(match[1]);
  const names = Object.keys(APPROVED_CSP);
  if (Object.keys(actual).length !== names.length) return false;
  return names.every((name) => {
    const want = APPROVED_CSP[name] ?? [];
    const have = actual[name];
    return have !== undefined && have.length === want.length && want.every((v, i) => v === have[i]);
  });
}
