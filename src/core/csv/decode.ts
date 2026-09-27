import { IMPORT_LIMITS, type ImportError } from './types';

export interface DecodedText {
  text: string;
  bomPresent: boolean;
  encoding: 'utf-8';
}

export type DecodeOutcome = { ok: true; value: DecodedText } | { ok: false; error: ImportError };

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((b, i) => bytes[i] === b);
}

export function decodeCsvBytes(bytes: Uint8Array): DecodeOutcome {
  if (bytes.byteLength > IMPORT_LIMITS.maxFileBytes) {
    return { ok: false, error: { code: 'FILE_TOO_LARGE' } };
  }
  if (bytes.byteLength === 0) return { ok: false, error: { code: 'EMPTY_FILE' } };

  // UTF-16 BOMs (FF FE also prefixes the UTF-32 LE BOM).
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) {
    return { ok: false, error: { code: 'UNSUPPORTED_ENCODING' } };
  }

  const bomPresent = startsWith(bytes, [0xef, 0xbb, 0xbf]);
  const body = bomPresent ? bytes.subarray(3) : bytes;

  let text: string;
  try {
    // ignoreBOM: the leading BOM is stripped above; any further U+FEFF is data, not silently dropped.
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body);
  } catch {
    return { ok: false, error: { code: 'INVALID_UTF8' } };
  }

  if (text.length === 0) return { ok: false, error: { code: 'EMPTY_FILE' } };
  if (text.includes('\u0000')) return { ok: false, error: { code: 'CONTAINS_NUL' } };

  return { ok: true, value: { text, bomPresent, encoding: 'utf-8' } };
}
