// The one approved Content-Security-Policy and the external hosts it (and the bundle) may name.
// Step 10 loosens the original policy ONLY for the exact Google Identity Services and Drive
// hosts the connect flow needs. The Nifty Indices host is allowed only for the read-only Nifty
// 200 constituents CSV. Anything else (a new host, a wildcard, inline script or eval) fails `npm
// run scan:dist`.

/** @type {Record<string, string[]>} */
export const APPROVED_CSP = {
  'default-src': ["'self'"],
  'script-src': ["'self'", 'https://accounts.google.com/gsi/client'],
  // The hash allows exactly one inline style block that Google's sign-in script inserts.
  'style-src': [
    "'self'",
    'https://accounts.google.com/gsi/style',
    "'sha256-RU4sU0AaS8IBGZx8XrGt/pa9A5SLA3dQszGeqT5L3Kw='",
  ],
  'img-src': ["'self'", 'data:'],
  'connect-src': [
    "'self'",
    'https://www.googleapis.com',
    'https://accounts.google.com/gsi/',
    // Token revocation on Disconnect: the one URL, not the whole OAuth host.
    'https://oauth2.googleapis.com/revoke',
    'https://www.niftyindices.com/IndexConstituent/ind_nifty200list.csv',
  ],
  'frame-src': ['https://accounts.google.com/gsi/'],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
};

/** Google hostnames the shipped bundle may mention (client IDs are handled separately). */
export const APPROVED_GOOGLE_HOSTS = [
  'accounts.google.com',
  'www.googleapis.com',
  'oauth2.googleapis.com',
];

export const APPROVED_NSE_HOSTS = ['www.niftyindices.com'];

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
