import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServiceWorker } from '../../scripts/build-sw.mjs';
import { scanDist } from '../../scripts/scan-dist.mjs';

const APPROVED_CSP_CONTENT =
  "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' https://accounts.google.com/gsi/style 'sha256-RU4sU0AaS8IBGZx8XrGt/pa9A5SLA3dQszGeqT5L3Kw='; img-src 'self' data:; connect-src 'self' https://www.googleapis.com https://accounts.google.com/gsi/ https://oauth2.googleapis.com/revoke; frame-src https://accounts.google.com/gsi/; object-src 'none'; base-uri 'self'; form-action 'self'";

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
  'index.html': `<!doctype html><meta http-equiv="Content-Security-Policy" content="${APPROVED_CSP_CONTENT}"><script type="module" src="/assets/index-aaa.js"></script>`,
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

  it.each([
    ['the Drive API host', 'fetch("https://www.googleapis.com/drive/v3/files")'],
    ['the Google sign-in script host', 'load("https://accounts.google.com/gsi/client")'],
    ['an OAuth client ID', 'const id = "1234567890-abcdefghijk.apps.googleusercontent.com";'],
    ['a test client ID', 'const id = "n200-test-client.apps.googleusercontent.com";'],
  ])('allows %s in the production bundle (approved for Step 10)', (_n, code) => {
    const dir = makeBuiltDist({ 'assets/index-aaa.js': code });
    expect(rules(dir)).not.toContain('GOOGLE_HOSTNAME');
  });

  it('allows the bundle to name the approved revoke host', () => {
    const dir = makeBuiltDist({
      'assets/index-aaa.js': 'x="https://oauth2.googleapis.com/revoke"',
    });
    expect(rules(dir)).not.toContain('GOOGLE_HOSTNAME');
  });

  it.each([
    ['the Google API loader', 'load("https://apis.google.com/js/api.js")'],
    ['a Google static host', 'src="https://www.gstatic.com/x.js"'],
    ['another googleapis host', 'fetch("https://drive.googleapis.com/x")'],
    ['a Google user-content host', 'img("https://lh3.googleusercontent.com/a")'],
    ['www.google.com', 'fetch("https://www.google.com/x")'],
  ])('fails when the production bundle names %s (not approved)', (_n, code) => {
    const dir = makeBuiltDist({ 'assets/index-aaa.js': code });
    expect(rules(dir)).toContain('GOOGLE_HOSTNAME');
  });

  it('passes the approved page CSP and fails any change to it', () => {
    expect(rules(makeBuiltDist())).not.toContain('CSP_POLICY');
    const bad = (csp: string): string[] =>
      rules(
        makeBuiltDist({
          'index.html': `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}">`,
        }),
      );
    expect(
      bad(
        APPROVED_CSP_CONTENT.replace(
          "'self' https://accounts.google.com/gsi/client",
          "'self' https://apis.google.com",
        ),
      ),
    ).toContain('CSP_POLICY');
    expect(bad(APPROVED_CSP_CONTENT + "; script-src-elem 'unsafe-inline'")).toContain('CSP_POLICY');
    expect(bad(APPROVED_CSP_CONTENT + "; style-src-elem 'unsafe-inline'")).toContain('CSP_POLICY');
    expect(bad(APPROVED_CSP_CONTENT + "; style-src-attr 'unsafe-inline'")).toContain('CSP_POLICY');
    expect(bad(APPROVED_CSP_CONTENT.replace(/'sha256-[^']*'/, "'unsafe-inline'"))).toContain(
      'CSP_POLICY',
    );
    expect(bad(APPROVED_CSP_CONTENT.replace(/ 'sha256-[^']*'/, ''))).toContain('CSP_POLICY');
    expect(bad(APPROVED_CSP_CONTENT.replace("connect-src 'self'", 'connect-src *'))).toContain(
      'CSP_POLICY',
    );
    // The whole OAuth host, or any path but /revoke, is not approved.
    expect(
      bad(
        APPROVED_CSP_CONTENT.replace(
          'https://oauth2.googleapis.com/revoke',
          'https://oauth2.googleapis.com',
        ),
      ),
    ).toContain('CSP_POLICY');
    expect(
      bad(
        APPROVED_CSP_CONTENT.replace(
          'https://oauth2.googleapis.com/revoke',
          'https://oauth2.googleapis.com/token',
        ),
      ),
    ).toContain('CSP_POLICY');
    // A different inline-style hash is not approved either.
    expect(
      bad(
        APPROVED_CSP_CONTENT.replace(
          /'sha256-[^']*'/,
          "'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='",
        ),
      ),
    ).toContain('CSP_POLICY');
  });

  it('fails a build whose index.html has no CSP at all', () => {
    const dir = makeBuiltDist({ 'index.html': '<!doctype html><title>x</title>' });
    expect(rules(dir)).toContain('CSP_POLICY');
  });

  it('does not run text rules over PNG icons', () => {
    const dir = makeBuiltDist({ 'icons/icon-192.png': 'binary INE324D01010 payload' });
    expect(rules(dir)).toEqual([]);
  });
});
