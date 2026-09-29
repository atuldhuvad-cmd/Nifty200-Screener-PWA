// Production-output privacy gate (brief: "Verify the FINAL production output"). Scans a build
// directory for source maps, credential-shaped strings, private sample references, real-looking
// ISIN data and private file types. Findings name the rule and file only — never the matched
// text — so a leaked secret is never copied into logs or reports.
//
// Usage: node scripts/scan-dist.mjs [dir]   (default: dist; exit 1 on any finding)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Content rules: [rule id, pattern]. Deliberately specific to keep false positives near zero. */
/** @type {[string, RegExp][]} */
const CONTENT_RULES = [
  ['SOURCE_MAP_REFERENCE', /\/\/[#@]\s*sourceMappingURL=/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['GOOGLE_ACCESS_TOKEN', /\bya29\.[A-Za-z0-9_-]{20,}/],
  ['GOOGLE_API_KEY', /\bAIza[A-Za-z0-9_-]{35}\b/],
  ['OAUTH_CLIENT_SECRET', /\bGOCSPX-[A-Za-z0-9_-]{16,}/],
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
  ['PRIVATE_FILE_TYPE', /\.(csv|sqlite|db)$|(^|[\\/])n200-backup-v[^\\/]*\.json$|(^|[\\/])\.env/i],
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

/**
 * @param {string} dir
 * @returns {{ rule: string, file: string }[]}
 */
export function scanDist(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`scan-dist: build output directory not found (run the build first): ${dir}`);
  }
  /** @type {{ rule: string, file: string }[]} */
  const findings = [];
  for (const path of listFiles(dir)) {
    const file = relative(dir, path).split(sep).join('/');
    for (const [rule, pattern] of FILE_RULES) {
      if (pattern.test(file)) findings.push({ rule, file });
    }
    const text = readFileSync(path, 'latin1');
    for (const [rule, pattern] of CONTENT_RULES) {
      if (pattern.test(text)) findings.push({ rule, file });
    }
  }
  return findings;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = process.argv[2] ?? 'dist';
  try {
    const findings = scanDist(dir);
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
