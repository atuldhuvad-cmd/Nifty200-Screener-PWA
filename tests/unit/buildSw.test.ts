import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServiceWorker, listShellFiles } from '../../scripts/build-sw.mjs';

const dirs: string[] = [];
function makeDist(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'n200-sw-'));
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

const SHELL: Record<string, string> = {
  'index.html': '<!doctype html>',
  'manifest.webmanifest': '{"name":"x"}',
  'icons/icon-192.png': 'png192',
  'icons/icon-512.png': 'png512',
  'assets/index-aaa.js': 'js',
  'assets/index-aaa.css': 'css',
};

describe('buildServiceWorker', () => {
  it('writes sw.js with a sorted, shell-only precache list and a content-derived version', () => {
    const dir = makeDist(SHELL);
    const { version, precache } = buildServiceWorker(dir);
    expect(precache).toEqual([
      'assets/index-aaa.css',
      'assets/index-aaa.js',
      'icons/icon-192.png',
      'icons/icon-512.png',
      'index.html',
      'manifest.webmanifest',
    ]);
    const source = readFileSync(join(dir, 'sw.js'), 'utf8');
    expect(source).toContain(version);
    expect(source).not.toContain('__N200_');
    expect(precache).not.toContain('sw.js');
  });

  it('is reproducible: same content gives the same version; changed content changes it', () => {
    const a = buildServiceWorker(makeDist(SHELL));
    const b = buildServiceWorker(makeDist(SHELL));
    expect(a.version).toBe(b.version);
    const changed = buildServiceWorker(makeDist({ ...SHELL, 'assets/index-aaa.js': 'js2' }));
    expect(changed.version).not.toBe(a.version);
  });

  it('regenerating over an existing sw.js does not include sw.js itself', () => {
    const dir = makeDist({ ...SHELL, 'sw.js': 'old worker' });
    expect(buildServiceWorker(dir).precache).not.toContain('sw.js');
  });

  it.each([
    'assets/index-aaa.js.map',
    'data.csv',
    'n200-backup-v1-x.json',
    'assets/leak.json',
    'samples/x.txt',
    '.env',
  ])('fails closed on an unexpected file in the build output: %s', (name) => {
    const dir = makeDist({ ...SHELL, [name]: 'x' });
    expect(() => listShellFiles(dir)).toThrow(/unexpected/i);
    expect(() => buildServiceWorker(dir)).toThrow(/unexpected/i);
  });

  it('fails when index.html or the manifest is missing', () => {
    const withoutIndex = { ...SHELL };
    delete withoutIndex['index.html'];
    expect(() => buildServiceWorker(makeDist(withoutIndex))).toThrow(/index\.html/);
    const withoutManifest = { ...SHELL };
    delete withoutManifest['manifest.webmanifest'];
    expect(() => buildServiceWorker(makeDist(withoutManifest))).toThrow(/manifest/);
  });
});
