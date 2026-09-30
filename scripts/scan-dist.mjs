// Production-output privacy gate (brief: "Verify the FINAL production output"). Scans a build
// directory for source maps, credential-shaped strings, private sample references, real-looking
// ISIN data and private file types. Findings name the rule and file only — never the matched
// text — so a leaked secret is never copied into logs or reports.
//
// Usage: node scripts/scan-dist.mjs [dir]   (default: dist; exit 1 on any finding)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { SHELL_FILE } from './build-sw.mjs';
import { APPROVED_GOOGLE_HOSTS, pageCspIsApproved } from './csp-policy.mjs';

/** Content rules: [rule id, pattern]. Deliberately specific to keep false positives near zero. */
/** @type {[string, RegExp][]} */
const CONTENT_RULES = [
  ['SOURCE_MAP_REFERENCE', /\/\/[#@]\s*sourceMappingURL=/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['GOOGLE_ACCESS_TOKEN', /\bya29\.[A-Za-z0-9_-]{20,}/],
  ['GOOGLE_API_KEY', /\bAIza[A-Za-z0-9_-]{35}\b/],
  ['OAUTH_CLIENT_SECRET', /\bGOCSPX-[A-Za-z0-9_-]{16,}/],
  ['GITHUB_TOKEN', /\bgh[pousr]_[A-Za-z0-9]{36}\b/],
  ['BEARER_TOKEN', /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/],
  ['PRIVATE_KEY', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  // Private research inputs must never ship: sample paths/names and real-looking ISINs.
  ['SAMPLE_REFERENCE', /samples[\\/]|Nifty200 All_|Nifty 200 with Fundamentals_/],
  ['ISIN_DATA', /\bINE[0-9A-Z]{8}[0-9]\b/],
];

/** File-name rules, applied to every file in the output. */
/** @type {[string, RegExp][]} */
const FILE_RULES = [
  ['SOURCE_MAP', /\.map$/i],
  [
    'PRIVATE_FILE_TYPE',
    /\.(csv|sqlite|db|pem|p12|pfx)$|(^|[\\/])n200-backup-v[^\\/]*\.json$|(^|[\\/])\.env(\.[^\\/]*)?$/i,
  ],
];

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listFiles(dir) {
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...listFiles(path));
    else out.push(path);
  }
  return out;
}

/** Tokens the service worker must still contain: the request guards that keep user data,
 * credential-bearing and cross-origin traffic out of its reach. */
const WORKER_GUARDS = ['authorization', "'GET'", 'url.origin', 'url.search'];

/**
 * @param {string} source
 * @returns {number} count of `console` identifiers, found by parsing (comments and strings ignored)
 */
function countConsoleIdentifiers(source) {
  const file = ts.createSourceFile('sw.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let count = 0;
  /** @param {ts.Node} node */
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === 'console') count += 1;
    ts.forEachChild(node, visit);
  };
  visit(file);
  return count;
}

/**
 * @param {string} dir
 * @param {string[]} files build files, relative with forward slashes
 * @param {boolean} required
 * @returns {{ rule: string, file: string }[]}
 */
function scanServiceWorker(dir, files, required) {
  /** @type {{ rule: string, file: string }[]} */
  const findings = [];
  const fileSet = new Set(files);

  if (fileSet.has('manifest.webmanifest') || required) {
    let valid;
    try {
      const manifest = JSON.parse(readFileSync(join(dir, 'manifest.webmanifest'), 'utf8'));
      const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
      const hasIcon = (/** @type {string} */ sizes) =>
        icons.some(
          (/** @type {{ sizes?: unknown, src?: unknown }} */ icon) =>
            icon.sizes === sizes && typeof icon.src === 'string' && fileSet.has(icon.src),
        );
      valid =
        typeof manifest.name === 'string' &&
        manifest.name.length > 0 &&
        typeof manifest.start_url === 'string' &&
        !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(manifest.start_url) &&
        hasIcon('192x192') &&
        hasIcon('512x512');
    } catch {
      valid = false;
    }
    if (!valid) findings.push({ rule: 'MANIFEST_INVALID', file: 'manifest.webmanifest' });
  }

  if (!fileSet.has('sw.js')) {
    if (required) findings.push({ rule: 'SERVICE_WORKER_MISSING', file: 'sw.js' });
    return findings;
  }
  const source = readFileSync(join(dir, 'sw.js'), 'utf8');
  if (countConsoleIdentifiers(source) > 0) findings.push({ rule: 'SW_CONSOLE', file: 'sw.js' });
  if (WORKER_GUARDS.some((token) => !source.includes(token))) {
    findings.push({ rule: 'SW_UNGUARDED', file: 'sw.js' });
  }
  const list = /JSON\.parse\('(\[[^']*\])'\)/.exec(source)?.[1];
  /** @type {unknown} */
  let precache;
  try {
    precache = list === undefined ? null : JSON.parse(list);
  } catch {
    precache = null;
  }
  if (!Array.isArray(precache)) {
    findings.push({ rule: 'SW_PRECACHE_UNSAFE', file: 'sw.js' });
  } else {
    for (const entry of precache) {
      if (typeof entry !== 'string' || !SHELL_FILE.test(entry)) {
        findings.push({ rule: 'SW_PRECACHE_UNSAFE', file: 'sw.js' });
      } else if (!fileSet.has(entry)) {
        findings.push({ rule: 'SW_PRECACHE_MISSING_FILE', file: 'sw.js' });
      }
    }
  }
  return findings;
}

/** Any Google hostname; each one found must be on the approved list (see csp-policy.mjs). */
const GOOGLE_HOST_PATTERN =
  /\b(?:[a-z0-9-]+\.)*(?:googleapis|google|gstatic|googleusercontent|googleadservices)\.com\b/gi;
/** OAuth client IDs embed `apps.googleusercontent.com`; they are public configuration, not hosts. */
const CLIENT_ID_PATTERN = /[A-Za-z0-9_-]+\.apps\.googleusercontent\.com/g;

/**
 * @param {string} text
 * @returns {boolean} whether the text names a Google host that is not approved
 */
function namesUnapprovedGoogleHost(text) {
  const hosts = text.replace(CLIENT_ID_PATTERN, '').match(GOOGLE_HOST_PATTERN) ?? [];
  return hosts.some((host) => !APPROVED_GOOGLE_HOSTS.includes(host.toLowerCase()));
}

/**
 * @param {string} dir
 * @param {{ requireServiceWorker?: boolean }} [options]
 * @returns {{ rule: string, file: string }[]}
 */
export function scanDist(dir, options = {}) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`scan-dist: build output directory not found (run the build first): ${dir}`);
  }
  /** @type {{ rule: string, file: string }[]} */
  const findings = [];
  /** @type {string[]} */
  const files = [];
  for (const path of listFiles(dir)) {
    const file = relative(dir, path).split(sep).join('/');
    files.push(file);
    for (const [rule, pattern] of FILE_RULES) {
      if (pattern.test(file)) findings.push({ rule, file });
    }
    if (file.endsWith('.png')) continue; // binary: text rules do not apply
    const text = readFileSync(path, 'latin1');
    for (const [rule, pattern] of CONTENT_RULES) {
      if (pattern.test(text)) findings.push({ rule, file });
    }
    if (namesUnapprovedGoogleHost(text)) findings.push({ rule: 'GOOGLE_HOSTNAME', file });
  }
  findings.push(...scanServiceWorker(dir, files, options.requireServiceWorker === true));
  if (options.requireServiceWorker === true) {
    // Production mode: the page must ship exactly the approved CSP.
    const indexPath = join(dir, 'index.html');
    if (!existsSync(indexPath) || !pageCspIsApproved(readFileSync(indexPath, 'utf8'))) {
      findings.push({ rule: 'CSP_POLICY', file: 'index.html' });
    }
  }
  return findings;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = process.argv[2] ?? 'dist';
  try {
    const findings = scanDist(dir, { requireServiceWorker: true });
    if (findings.length > 0) {
      console.error(`scan-dist: FAIL — ${String(findings.length)} finding(s) in ${dir}/`);
      for (const f of findings) console.error(`  ${f.rule}  ${f.file}`);
      process.exit(1);
    }
    console.log(`scan-dist: PASS — no findings in ${dir}/`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : 'scan-dist: unexpected error');
    process.exit(1);
  }
}
