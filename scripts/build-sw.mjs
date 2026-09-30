// Post-build step: generates dist/sw.js from scripts/sw.template.js. The precache list is the
// build's shell files only, and the cache version is a hash of their contents, so the worker
// changes exactly when the shell does. Fails closed if the build output contains anything that
// is not part of the shell (source maps, CSV/backup files, stray data).
//
// Usage: node scripts/build-sw.mjs [dir]   (default: dist)
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The complete set of files that may exist in a production build (besides sw.js itself). */
export const SHELL_FILE =
  /^(index\.html|manifest\.webmanifest|icons\/[A-Za-z0-9._-]+\.png|assets\/[A-Za-z0-9._-]+\.(?:js|css))$/;

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

/**
 * @param {string} dir
 * @returns {string[]} sorted shell file paths, relative to `dir` with forward slashes
 */
export function listShellFiles(dir) {
  const files = walk(dir)
    .map((path) => relative(dir, path).split(sep).join('/'))
    // `_headers` configures the host; it is not served to the browser and is never precached.
    .filter((path) => path !== 'sw.js' && path !== '_headers');
  const unexpected = files.filter((path) => !SHELL_FILE.test(path));
  if (unexpected.length > 0) {
    throw new Error(`build-sw: unexpected file(s) in build output: ${unexpected.join(', ')}`);
  }
  if (!files.includes('index.html')) throw new Error('build-sw: index.html is missing');
  if (!files.includes('manifest.webmanifest')) {
    throw new Error('build-sw: manifest.webmanifest is missing');
  }
  return files.sort();
}

/**
 * @param {string} template
 * @param {string} version
 * @param {string[]} precache
 * @returns {string}
 */
export function renderServiceWorker(template, version, precache) {
  for (const entry of precache) {
    if (!SHELL_FILE.test(entry)) throw new Error(`build-sw: not a shell path: ${entry}`);
  }
  if (!/^[0-9a-z]+$/.test(version)) throw new Error('build-sw: invalid version');
  if (!template.includes('__N200_VERSION__') || !template.includes('__N200_PRECACHE__')) {
    throw new Error('build-sw: template placeholders are missing');
  }
  return template
    .replace('__N200_VERSION__', version)
    .replace('__N200_PRECACHE__', JSON.stringify(precache));
}

/**
 * @param {string} dir
 * @returns {{ version: string, precache: string[] }}
 */
export function buildServiceWorker(dir) {
  const precache = listShellFiles(dir);
  const digest = createHash('sha256');
  for (const path of precache) {
    const fileHash = createHash('sha256')
      .update(readFileSync(join(dir, path)))
      .digest('hex');
    digest.update(`${path}\0${fileHash}\n`);
  }
  const version = digest.digest('hex').slice(0, 16);
  const template = readFileSync(join(HERE, 'sw.template.js'), 'utf8');
  writeFileSync(join(dir, 'sw.js'), renderServiceWorker(template, version, precache));
  return { version, precache };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = process.argv[2] ?? 'dist';
  try {
    if (!existsSync(dir)) throw new Error(`build-sw: build output not found: ${dir}`);
    const { version, precache } = buildServiceWorker(dir);
    process.stdout.write(
      `build-sw: wrote ${dir}/sw.js (version ${version}, ${String(precache.length)} shell files)\n`,
    );
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : 'build-sw: unexpected error'}\n`);
    process.exit(1);
  }
}
