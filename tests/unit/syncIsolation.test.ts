import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../helpers';

const SRC = join(ROOT, 'src');

function listSource(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...listSource(path));
    else if (/\.(ts|svelte)$/.test(name)) out.push(path);
  }
  return out;
}

describe('Step 9 boundary: the Drive sync engine is not wired into the app', () => {
  it('no source file outside src/core/sync imports the sync engine (no UI, no bundle reach)', () => {
    const offenders = listSource(SRC)
      .filter((file) => !relative(SRC, file).split(sep).join('/').startsWith('core/sync/'))
      .filter((file) =>
        /from\s+['"]\.{1,2}\/[^'"]*\bsync(\/[^'"]*)?['"]/.test(readFileSync(file, 'utf8')),
      )
      .map((file) => relative(ROOT, file).split(sep).join('/'));
    expect(offenders).toEqual([]);
  });

  it('nothing in src/ names a Google host or loads a Google script', () => {
    const hosts = /googleapis\.com|accounts\.google\.com|apis\.google\.com|gstatic\.com/;
    const offenders = listSource(SRC)
      .filter((file) => !relative(SRC, file).split(sep).join('/').startsWith('core/sync/'))
      .filter((file) => hosts.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file).split(sep).join('/'));
    expect(offenders).toEqual([]);
  });

  it('the only Google host inside src/core/sync is the Drive API base URL constant', () => {
    const hosts = /https?:\/\/[a-z0-9.-]*(googleapis|google|gstatic)\.com[^'"`\s]*/g;
    const found = new Set<string>();
    for (const file of listSource(join(SRC, 'core', 'sync'))) {
      for (const match of readFileSync(file, 'utf8').matchAll(hosts)) found.add(match[0]);
    }
    expect([...found]).toEqual(['https://www.googleapis.com']);
  });
});
