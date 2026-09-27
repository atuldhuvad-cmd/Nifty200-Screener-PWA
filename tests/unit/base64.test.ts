import { describe, expect, it } from 'vitest';
import { decodeBase64, encodeBase64 } from '../../src/core/envelope/base64';

const enc = (s: string) => new TextEncoder().encode(s);
const bytesOf = (nums: number[]) => new Uint8Array(nums);

describe('encodeBase64 (canonical RFC 4648, no whitespace)', () => {
  it.each([
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ])('RFC 4648 test vector %j -> %j', (input, expected) => {
    expect(encodeBase64(enc(input))).toBe(expected);
  });

  it('encodes all 256 byte values correctly (round trip via decode)', () => {
    const bytes = bytesOf(Array.from({ length: 256 }, (_, i) => i));
    const encoded = encodeBase64(bytes);
    const decoded = decodeBase64(encoded);
    expect(decoded.ok && Array.from(decoded.bytes)).toEqual(Array.from(bytes));
  });

  it('never emits whitespace or a trailing newline', () => {
    const encoded = encodeBase64(bytesOf(Array.from({ length: 300 }, (_, i) => i % 256)));
    expect(encoded).not.toMatch(/\s/);
  });

  it('uses the standard alphabet (+ and /), never the URL-safe one (- and _)', () => {
    // Bytes chosen so the standard encoding necessarily contains '+' and '/'.
    const encoded = encodeBase64(bytesOf([0xfb, 0xff, 0xbf]));
    expect(encoded).toBe('+/+/');
  });
});

describe('decodeBase64 (strict)', () => {
  it.each([
    ['', ''],
    ['Zg==', 'f'],
    ['Zm8=', 'fo'],
    ['Zm9v', 'foo'],
    ['Zm9vYg==', 'foob'],
    ['Zm9vYmE=', 'fooba'],
    ['Zm9vYmFy', 'foobar'],
  ])('RFC 4648 test vector %j -> %j', (input, expected) => {
    const out = decodeBase64(input);
    expect(out.ok && new TextDecoder().decode(out.bytes)).toBe(expected);
  });

  it.each(['Zg', 'Zg=', 'Zg===', 'Zm 9v', 'Zm\n9v', 'Zm9v=', '=Zm9v', 'Zg--', 'Zg__', '!!!!', 'Z'])(
    'rejects malformed input %j',
    (input) => {
      expect(decodeBase64(input)).toEqual({ ok: false });
    },
  );

  it('round-trips arbitrary byte sequences, including all-zero and all-0xff', () => {
    for (const bytes of [
      bytesOf([]),
      bytesOf([0]),
      bytesOf([0, 0, 0]),
      bytesOf([255, 255, 255, 255]),
      bytesOf(Array.from({ length: 1000 }, (_, i) => (i * 37) % 256)),
    ]) {
      const decoded = decodeBase64(encodeBase64(bytes));
      expect(decoded.ok && Array.from(decoded.bytes)).toEqual(Array.from(bytes));
    }
  });
});
