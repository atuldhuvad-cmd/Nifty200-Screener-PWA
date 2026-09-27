/**
 * Canonical RFC 4648 Base64, no whitespace. Implemented directly (not via `btoa`/`Buffer`,
 * which are Node/DOM-string-oriented and not guaranteed available or byte-safe in every
 * target) and not via `Uint8Array.prototype.toBase64` (not yet available in this toolchain's
 * Node, per investigation) so behaviour is identical and fully testable in Node and the browser.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const PAD = '=';

function byteAt(bytes: Uint8Array, i: number): number {
  return bytes[i] ?? 0; // always in range by construction; the fallback only satisfies the type
}

function charAt(index: number): string {
  return ALPHABET.charAt(index); // `.charAt` (unlike `[i]`) is typed as always returning `string`
}

export function encodeBase64(bytes: Uint8Array): string {
  let out = '';
  const fullGroups = Math.floor(bytes.length / 3) * 3;

  for (let i = 0; i < fullGroups; i += 3) {
    const b0 = byteAt(bytes, i);
    const b1 = byteAt(bytes, i + 1);
    const b2 = byteAt(bytes, i + 2);
    out +=
      charAt(b0 >> 2) +
      charAt(((b0 & 0b11) << 4) | (b1 >> 4)) +
      charAt(((b1 & 0b1111) << 2) | (b2 >> 6)) +
      charAt(b2 & 0b111111);
  }

  const remainder = bytes.length - fullGroups;
  if (remainder === 1) {
    const b0 = byteAt(bytes, fullGroups);
    out += charAt(b0 >> 2) + charAt((b0 & 0b11) << 4) + PAD + PAD;
  } else if (remainder === 2) {
    const b0 = byteAt(bytes, fullGroups);
    const b1 = byteAt(bytes, fullGroups + 1);
    out +=
      charAt(b0 >> 2) + charAt(((b0 & 0b11) << 4) | (b1 >> 4)) + charAt((b1 & 0b1111) << 2) + PAD;
  }

  return out;
}

const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const DECODE_TABLE = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) {
    const code = ALPHABET.charCodeAt(i);
    if (code < table.length) table[code] = i;
  }
  return table;
})();

function decodeChar(text: string, i: number): number {
  const code = text.charCodeAt(i);
  return code < DECODE_TABLE.length ? (DECODE_TABLE[code] ?? -1) : -1;
}

export type DecodeBase64Result = { ok: true; bytes: Uint8Array } | { ok: false };

/** Strict: rejects anything that is not exactly canonical RFC 4648 Base64 (no whitespace, no URL-safe alphabet). */
export function decodeBase64(text: string): DecodeBase64Result {
  if (!CANONICAL_BASE64.test(text)) return { ok: false };
  if (text.length === 0) return { ok: true, bytes: new Uint8Array(0) };

  const padCount = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const byteLength = (text.length / 4) * 3 - padCount;
  const bytes = new Uint8Array(byteLength);
  let outIndex = 0;

  for (let i = 0; i < text.length; i += 4) {
    const c0 = decodeChar(text, i);
    const c1 = decodeChar(text, i + 1);
    const has2 = text.charAt(i + 2) !== PAD;
    const has3 = text.charAt(i + 3) !== PAD;
    const c2 = has2 ? decodeChar(text, i + 2) : 0;
    const c3 = has3 ? decodeChar(text, i + 3) : 0;

    bytes[outIndex++] = (c0 << 2) | (c1 >> 4);
    if (has2) bytes[outIndex++] = ((c1 & 0b1111) << 4) | (c2 >> 2);
    if (has3) bytes[outIndex++] = ((c2 & 0b11) << 6) | c3;
  }

  return { ok: true, bytes };
}
