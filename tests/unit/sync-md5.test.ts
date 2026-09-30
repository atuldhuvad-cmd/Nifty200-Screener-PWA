import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { md5Hex } from '../../src/core/sync/md5';

describe('md5Hex', () => {
  it.each([
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['a', '0cc175b9c0f1b6a831c399e269772661'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
    [
      '12345678901234567890123456789012345678901234567890123456789012345678901234567890',
      '57edf4a22be3c955ac49da2e2107b67a',
    ],
  ])('matches the RFC 1321 vector for %j', (input, expected) => {
    expect(md5Hex(new TextEncoder().encode(input))).toBe(expected);
  });

  it('matches Node crypto for assorted lengths around the 64-byte block boundary', () => {
    for (const length of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 4097]) {
      const bytes = Uint8Array.from({ length }, (_v, i) => (i * 31 + 7) % 256);
      expect(md5Hex(bytes)).toBe(createHash('md5').update(bytes).digest('hex'));
    }
  });
});
