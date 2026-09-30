import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServiceWorker } from '../../scripts/build-sw.mjs';
import { scanDist } from '../../scripts/scan-dist.mjs';

const dirs: string[] = [];
const MANIFEST = JSON.stringify({
  name: 'Nifty 200 Screener',
  short_name: 'N200 Screener',
  start_url: './',
  scope: './',
  display: 'standalone',
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
  ],
});
const SHELL: Record<string, string> = {
  'index.html': '<!doctype html><script type="module" src="/assets/index-aaa.js"></script>',
  'manifest.webmanifest': MANIFEST,
  'icons/icon-192.png': 'png192',
  'icons/icon-512.png': 'png512',
  'assets/index-aaa.js': 'export default 1;',
  'assets/index-aaa.css': 'body{margin:0}',
};

function makeBuiltDist(overrides: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'n200-scansw-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries({ ...SHELL, ...overrides })) {
    const path = join(dir, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  }
  buildServiceWorker(dir);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const rules = (dir: string, requireServiceWorker = true): string[] =>
  (scanDist(dir, { requireServiceWorker }) as { rule: string }[]).map((f) => f.rule);

function editWorker(dir: string, edit: (source: string) => string): void {
  const path = join(dir, 'sw.js');
  writeFileSync(path, edit(readFileSync(path, 'utf8')));
}

describe('scanDist: service worker and manifest', () => {
  it('passes a correctly built output', () => {
    expect(rules(makeBuiltDist())).toEqual([]);
  });

  it('requires a service worker and manifest in the real build, but not in unit-style dirs', () => {
    const dir = makeBuiltDist();
    rmSync(join(dir, 'sw.js'));
    expect(rules(dir)).toContain('SERVICE_WORKER_MISSING');
    expect(rules(dir, false)).not.toContain('SERVICE_WORKER_MISSING');
    const noManifest = makeBuiltDist();
    rmSync(join(noManifest, 'manifest.webmanifest'));
    expect(rules(noManifest)).toContain('MANIFEST_INVALID');
  });

  it('fails when generated worker code references the console', () => {
    const dir = makeBuiltDist();
    editWorker(dir, (s) => `${s}\nconsole.log('cached');\n`);
    expect(rules(dir)).toContain('SW_CONSOLE');
  });

  it('does not flag the word console in worker comments or strings', () => {
    const dir = makeBuiltDist();
    editWorker(dir, (s) => `${s}\n// the console is not used here\nconst note = 'console';\n`);
    expect(rules(dir)).not.toContain('SW_CONSOLE');
  });

  it.each([
    ['a source map', 'assets/index-aaa.js.map'],
    ['a path traversal', '../secret.json'],
    ['a sample path', 'samples/export.csv'],
    ['a backup file', 'n200-backup-v1-x.json'],
    ['an absolute URL', 'https://example.com/a.js'],
  ])('fails when the precache list contains %s', (_n, entry) => {
    const dir = makeBuiltDist();
    editWorker(dir, (s) => s.replace(/JSON\.parse\('\[/, `JSON.parse('["${entry}",`));
    expect(rules(dir)).toContain('SW_PRECACHE_UNSAFE');
  });

  it('fails when the precache list names a file that is not in the build', () => {
    const dir = makeBuiltDist();
    editWorker(dir, (s) => s.replace(/JSON\.parse\('\[/, `JSON.parse('["assets/ghost-1.js",`));
    expect(rules(dir)).toContain('SW_PRECACHE_MISSING_FILE');
  });

  it.each(['authorization', "'GET'", 'url.origin', 'url.search'])(
    'fails when the worker no longer contains the %s guard',
    (token) => {
      const dir = makeBuiltDist();
      editWorker(dir, (s) => s.split(token).join('x0x'));
      expect(rules(dir)).toContain('SW_UNGUARDED');
    },
  );

  it.each([
    ['unparseable JSON', '{nope'],
    ['no icons', JSON.stringify({ name: 'x', start_url: './', icons: [] })],
    [
      'an absolute start_url',
      JSON.stringify({ ...JSON.parse(MANIFEST), start_url: 'https://example.com/' }),
    ],
    [
      'an icon file that is not in the build',
      JSON.stringify({
        ...JSON.parse(MANIFEST),
        icons: [
          { src: 'icons/missing-192.png', sizes: '192x192' },
          { src: 'icons/icon-512.png', sizes: '512x512' },
        ],
      }),
    ],
  ])('fails on a manifest with %s', (_n, manifest) => {
    expect(rules(makeBuiltDist({ 'manifest.webmanifest': manifest }))).toContain(
      'MANIFEST_INVALID',
    );
  });

  it('does not run text rules over PNG icons', () => {
    const dir = makeBuiltDist({ 'icons/icon-192.png': 'binary INE324D01010 payload' });
    expect(rules(dir)).toEqual([]);
  });
});
