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

/** The only files outside src/core/sync that may import it (Step 10): the wiring of the Sync view. */
const ALLOWED_IMPORTERS = [
  'src/lib/syncBrowser.ts',
  'src/lib/syncController.ts',
  'src/lib/syncMessages.ts',
];

describe('Step 10 boundary: the sync engine is reachable only through the Sync view wiring', () => {
  it('only the sync controller, its messages and its browser wiring import the engine', () => {
    const offenders = listSource(SRC)
      .filter((file) => !relative(SRC, file).split(sep).join('/').startsWith('core/sync/'))
      .filter((file) =>
        /from\s+['"]\.{1,2}\/[^'"]*sync(\/[^'"]*)?['"]/.test(readFileSync(file, 'utf8')),
      )
      .map((file) => relative(ROOT, file).split(sep).join('/'))
      .filter((file) => !ALLOWED_IMPORTERS.includes(file));
    expect(offenders).toEqual([]);
  });

  it('no file outside src/core/sync names a Google host or loads a Google script', () => {
    const hosts = /googleapis\.com|accounts\.google\.com|apis\.google\.com|gstatic\.com/;
    const offenders = listSource(SRC)
      .filter((file) => !relative(SRC, file).split(sep).join('/').startsWith('core/sync/'))
      .filter((file) => hosts.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file).split(sep).join('/'));
    expect(offenders).toEqual([]);
  });

  it('the only Google URLs inside src/core/sync are the Drive API base, the one sign-in script and the drive.file scope name', () => {
    const hosts = /https?:\/\/[a-z0-9.-]*(googleapis|google|gstatic)\.com[^'"`\s]*/g;
    const found = new Set<string>();
    for (const file of listSource(join(SRC, 'core', 'sync'))) {
      for (const match of readFileSync(file, 'utf8').matchAll(hosts)) found.add(match[0]);
    }
    expect([...found].sort()).toEqual([
      'https://accounts.google.com/gsi/client',
      'https://www.googleapis.com',
      'https://www.googleapis.com/auth/drive.file', // the OAuth scope identifier, not a request
    ]);
  });

  it('nothing in src/ reads a client secret, and the client ID comes only from the build environment', () => {
    const sources = listSource(SRC)
      .map((file) => readFileSync(file, 'utf8'))
      .join(' ');
    expect(sources).not.toMatch(/client[_-]?secret/i);
    expect(sources.match(/import\.meta\.env\.VITE_[A-Z_]+/g)).toEqual([
      'import.meta.env.VITE_GOOGLE_CLIENT_ID',
    ]);
  });
});
