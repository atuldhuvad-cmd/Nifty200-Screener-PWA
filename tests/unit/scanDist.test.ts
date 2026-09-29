import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanDist } from '../../scripts/scan-dist.mjs';

interface Finding {
  rule: string;
  file: string;
}

const dirs: string[] = [];
function makeDist(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'n200-dist-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const scan = (dir: string): Finding[] => scanDist(dir) as Finding[];
const rules = (dir: string): string[] => scan(dir).map((f) => f.rule);

// Fake credential shapes are assembled at runtime so this file itself never contains one.
const fakeJwt = [
  'eyJhbGciOiJIUzI1NiJ9',
  'eyJzdWIiOiJ4In0',
  'abcdefghijklmnopqrstuvwxyz012345',
].join('.');
const fakeClientSecret = ['GOCSPX', 'abcdefghijklmnop0123456789'].join('-');
const fakeGoogleToken = ['ya29', 'a0AfH6SMBfakefakefakefakefakefakefake01'].join('.');

describe('scanDist', () => {
  it('passes a clean production-shaped output', () => {
    const dir = makeDist({
      'index.html': '<!doctype html><script type="module" src="/assets/index-abc.js"></script>',
      'assets/index-abc.js': 'const a = 1; export default a;',
      'assets/index-abc.css': 'body{margin:0}',
    });
    expect(scan(dir)).toEqual([]);
  });

  it('fails on a stray source map', () => {
    const dir = makeDist({ 'assets/index.js': 'x', 'assets/index.js.map': '{}' });
    expect(rules(dir)).toContain('SOURCE_MAP');
  });

  it('fails on a sourceMappingURL reference even without a map file', () => {
    const dir = makeDist({ 'assets/index.js': 'x\n//# sourceMappingURL=index.js.map' });
    expect(rules(dir)).toContain('SOURCE_MAP_REFERENCE');
  });

  it.each([
    ['JWT', `const t = "${fakeJwt}";`, 'JWT'],
    ['Google access token', `const t = "${fakeGoogleToken}";`, 'GOOGLE_ACCESS_TOKEN'],
    [
      'bearer header',
      'headers = { Authorization: "Bearer abcdefghijklmnop0123456789" }',
      'BEARER_TOKEN',
    ],
    ['private key block', '-----BEGIN PRIVATE KEY-----\nMIIB', 'PRIVATE_KEY'],
    ['OAuth client secret', `const client_secret = "${fakeClientSecret}";`, 'OAUTH_CLIENT_SECRET'],
    ['Google API key', `const k = "AIza${'x'.repeat(35)}";`, 'GOOGLE_API_KEY'],
  ])('fails on a planted %s', (_label, content, rule) => {
    const dir = makeDist({ 'assets/index.js': content });
    expect(rules(dir)).toContain(rule);
  });

  it('fails when a private sample filename ends up in the output', () => {
    const dir = makeDist({
      'assets/index.js': 'fetch("samples/Nifty200 All_September 27, 2026.csv")',
    });
    expect(rules(dir)).toContain('SAMPLE_REFERENCE');
  });

  it('fails when real-looking ISIN data ends up in the output', () => {
    const dir = makeDist({ 'assets/data.json': '{"isin":"INE324D01010"}' });
    expect(rules(dir)).toContain('ISIN_DATA');
  });

  it('fails when a .csv or backup export is bundled', () => {
    const dir = makeDist({ 'assets/leak.csv': 'a,b', 'n200-backup-v1-x.json': '{}' });
    expect(rules(dir)).toEqual(expect.arrayContaining(['PRIVATE_FILE_TYPE']));
  });

  it('reports the offending file but never the matched secret text', () => {
    const dir = makeDist({ 'assets/index.js': `const t = "${fakeJwt}";` });
    const findings = scan(dir);
    expect(findings[0]?.file).toBe('assets/index.js');
    expect(JSON.stringify(findings)).not.toContain(fakeJwt);
  });

  it('throws a clear error when the directory does not exist', () => {
    expect(() => scanDist(join(tmpdir(), 'n200-does-not-exist-xyz'))).toThrow(/dist/i);
  });
});
