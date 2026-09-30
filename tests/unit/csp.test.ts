import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../helpers';

function metaCsp(html: string): string {
  const match = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html);
  if (match?.[1] === undefined) throw new Error('no CSP meta tag');
  return match[1];
}

function directives(csp: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of csp.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name !== undefined && name !== '') out[name] = values;
  }
  return out;
}

/** Written out independently of scripts/csp-policy.mjs, so the two cannot drift together. */
const EXPECTED: Record<string, string[]> = {
  'default-src': ["'self'"],
  'script-src': ["'self'", 'https://accounts.google.com/gsi/client'],
  'style-src': ["'self'", 'https://accounts.google.com/gsi/style'],
  'img-src': ["'self'", 'data:'],
  'connect-src': ["'self'", 'https://www.googleapis.com', 'https://accounts.google.com/gsi/'],
  'frame-src': ['https://accounts.google.com/gsi/'],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
};

describe('the page CSP (Step 10): loosened only for the exact Google hosts needed', () => {
  const csp = directives(metaCsp(readFileSync(join(ROOT, 'index.html'), 'utf8')));

  it('is exactly the approved policy', () => {
    expect(csp).toEqual(EXPECTED);
  });

  it('never allows wildcards, inline or eval, or any unapproved Google host', () => {
    const all = Object.values(csp).flat();
    for (const source of all) {
      expect(source).not.toBe('*');
      expect(source).not.toContain('*');
      expect(source).not.toMatch(/unsafe-(inline|eval)/);
    }
    const hosts = all.filter((s) => s.startsWith('https://'));
    const allowed = new Set([
      'https://accounts.google.com/gsi/client',
      'https://accounts.google.com/gsi/style',
      'https://accounts.google.com/gsi/',
      'https://www.googleapis.com',
    ]);
    for (const host of hosts) expect(allowed.has(host)).toBe(true);
  });

  it('does not allow scripts from anywhere but this origin and the one Google script URL', () => {
    expect(csp['script-src']).toEqual(["'self'", 'https://accounts.google.com/gsi/client']);
  });

  it('does not open connect-src to the OAuth token or revoke hosts (not proven needed)', () => {
    expect(JSON.stringify(csp)).not.toContain('oauth2.googleapis.com');
  });
});
