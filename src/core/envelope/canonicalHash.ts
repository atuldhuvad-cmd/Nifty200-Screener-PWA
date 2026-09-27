import canonicalize from 'canonicalize';
import { sha256Hex } from './hash';

/**
 * RFC 8785 JCS canonical serialization, then SHA-256 of the UTF-8 bytes.
 * `canonicalize` (erdtman) only returns `undefined` for a top-level `undefined` input,
 * which never happens for an envelope object — the non-null assertion documents that.
 */
export async function jcsSha256Hex(value: unknown): Promise<string> {
  const json = canonicalize(value);
  if (json === undefined) throw new Error('canonicalize: input serialized to undefined');
  return sha256Hex(new TextEncoder().encode(json));
}

export { canonicalize };
