import { describe, expect, it } from 'vitest';
import { canonicalize, jcsSha256Hex } from '../../src/core/envelope/canonicalHash';
import { sha256Hex } from '../../src/core/envelope/hash';

describe('sha256Hex', () => {
  it('matches known SHA-256 test vectors', async () => {
    expect(await sha256Hex(new TextEncoder().encode(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is lowercase 64-character hex', async () => {
    const hex = await sha256Hex(new TextEncoder().encode('Nifty 200'));
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('canonicalize / jcsSha256Hex (RFC 8785 JCS)', () => {
  it('is stable across different key insertion orders', () => {
    const a = { b: 1, a: 2, c: { z: 1, y: 2 } };
    const b = { a: 2, c: { y: 2, z: 1 }, b: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('sorts object keys lexicographically by UTF-16 code unit', () => {
    expect(canonicalize({ b: 1, a: 2, ab: 3, A: 4 })).toBe('{"A":4,"a":2,"ab":3,"b":1}');
  });

  it('matches the RFC 8785 Appendix B "French" example', () => {
    const input = { peach: 'This sorts', péché: 'Thisisnot', 1: 'Number one', 10: 'Number ten' };
    expect(canonicalize(input)).toBe(
      '{"1":"Number one","10":"Number ten","peach":"This sorts","péché":"Thisisnot"}',
    );
  });

  it('any change to the object changes the hash', async () => {
    const base = { a: 1, b: { c: 2 } };
    const changed = { a: 1, b: { c: 3 } };
    expect(await jcsSha256Hex(base)).not.toBe(await jcsSha256Hex(changed));
  });

  it('produces the same hash regardless of key insertion order', async () => {
    const a = { run_id: '1', schema_version: '1', headers: ['x', 'y'] };
    const b = { schema_version: '1', headers: ['x', 'y'], run_id: '1' };
    expect(await jcsSha256Hex(a)).toBe(await jcsSha256Hex(b));
  });

  it('golden vector: jcsSha256Hex({b:"x",a:1}) equals SHA-256 of the literal string \'{"a":1,"b":"x"}\'', async () => {
    // Independently computed (Node crypto over the literal JCS string, not via canonicalize/
    // jcsSha256Hex), so this catches a bug that corrupts the whole pipeline consistently — e.g.
    // extra bytes hashed, wrong text encoding — which a build/validate self-consistency check
    // cannot catch (both sides would still agree with each other while being equally wrong).
    expect(await jcsSha256Hex({ b: 'x', a: 1 })).toBe(
      'ecf9e98ec0641e23113ff3ce8bdc78d0ddd249886517fd4a7f68cc83d4e65667',
    );
  });
});
