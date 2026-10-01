import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkHeadersFile,
  globalHeaders,
  headersForPath,
  parseHeadersFile,
  REQUIRED_GLOBAL_HEADERS,
} from '../../scripts/headers-policy.mjs';

const REAL = readFileSync('public/_headers', 'utf8');

describe('host response headers (public/_headers)', () => {
  it('the shipped file passes the policy', () => {
    expect(checkHeadersFile(REAL)).toEqual([]);
  });

  it('applies every required header to all paths', () => {
    expect(globalHeaders(REAL)).toMatchObject(REQUIRED_GLOBAL_HEADERS);
  });

  it('names no origin, so it needs no production value', () => {
    expect(REAL).not.toMatch(/https?:\/\//i);
    expect(REAL).not.toMatch(/pages\.dev/i);
  });

  it('fails when the file is missing or unparsable', () => {
    expect(checkHeadersFile(null)).toEqual(['HEADERS_MISSING']);
    expect(checkHeadersFile('/*\nnot indented and no colon\n  bad line')).toContain(
      'HEADERS_MALFORMED',
    );
  });

  it.each(Object.keys(REQUIRED_GLOBAL_HEADERS))('fails when %s is removed', (name) => {
    const without = REAL.split('\n')
      .filter((l) => !l.trim().toLowerCase().startsWith(`${name}:`))
      .join('\n');
    expect(checkHeadersFile(without)).toContain(`HEADERS_REQUIRED:${name}`);
  });

  it('fails when COOP is tightened to same-origin (it would break the Google popup)', () => {
    const bad = REAL.replace('same-origin-allow-popups', 'same-origin');
    expect(checkHeadersFile(bad)).toContain('HEADERS_REQUIRED:cross-origin-opener-policy');
  });

  it('fails on loosening: unsafe-*, wildcard or origin values, unapproved headers, stray immutable', () => {
    const extra = (line: string): string[] => checkHeadersFile(`${REAL}\n/x\n  ${line}\n`);
    expect(extra("Content-Security-Policy: script-src 'unsafe-inline'")).toContain(
      'HEADERS_LOOSE_VALUE:content-security-policy',
    );
    expect(extra('Access-Control-Allow-Origin: *')).toEqual(
      expect.arrayContaining(['HEADERS_UNAPPROVED:access-control-allow-origin']),
    );
    expect(extra('Permissions-Policy: camera=*')).toContain('HEADERS_WILDCARD:permissions-policy');
    expect(extra('Referrer-Policy: https://example.test')).toContain(
      'HEADERS_LOOSE_VALUE:referrer-policy',
    );
    expect(extra('Cache-Control: public, max-age=1, immutable')).toContain(
      'HEADERS_IMMUTABLE_OUTSIDE_ASSETS',
    );
  });

  it('a path that names an origin is rejected', () => {
    expect(
      checkHeadersFile(`${REAL}\nhttps://example.test/*\n  Cache-Control: no-cache\n`),
    ).toContain('HEADERS_PATH_NAMES_ORIGIN');
  });

  it('parses blocks with their paths', () => {
    expect(parseHeadersFile(REAL).map((b) => b.path)).toEqual([
      '/*',
      '/',
      '/index.html',
      '/sw.js',
      '/manifest.webmanifest',
      '/assets/*',
    ]);
  });

  describe('path matching (what the host, and the preview server, apply per request)', () => {
    it('applies the global block to every path', () => {
      for (const p of ['/', '/index.html', '/sw.js', '/assets/a-1.js', '/icons/i.png']) {
        expect(headersForPath(REAL, p)).toMatchObject(REQUIRED_GLOBAL_HEADERS);
      }
    });

    it('revalidates the shell and the service worker; only hashed assets are immutable', () => {
      const cache = (p: string): string | undefined => headersForPath(REAL, p)['cache-control'];
      expect(cache('/')).toBe('no-cache');
      expect(cache('/index.html')).toBe('no-cache');
      expect(cache('/sw.js')).toBe('no-cache');
      expect(cache('/manifest.webmanifest')).toBe('no-cache');
      expect(cache('/assets/index-abc123.js')).toBe('public, max-age=31536000, immutable');
      expect(cache('/assets/index-abc123.css')).toBe('public, max-age=31536000, immutable');
      expect(cache('/icons/icon-192.png')).toBeUndefined();
    });

    it('joins, rather than replaces, a header set by two matching blocks (Cloudflare behaviour)', () => {
      const two = [
        '/*',
        '  Cache-Control: no-cache',
        '/assets/*',
        '  Cache-Control: immutable',
        '',
      ].join(String.fromCharCode(10));
      expect(headersForPath(two, '/assets/x.js')['cache-control']).toBe('no-cache, immutable');
    });
  });
});
