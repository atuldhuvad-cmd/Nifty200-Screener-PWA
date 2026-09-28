import { describe, expect, it } from 'vitest';
import { parseRunIdFromHash, runDetailHash } from '../../src/lib/route';

describe('route: hash <-> run id', () => {
  it('round-trips a UUID run id', () => {
    const runId = '11111111-1111-4111-8111-111111111111';
    expect(parseRunIdFromHash(runDetailHash(runId))).toBe(runId);
  });

  it('returns null for the list route (empty hash)', () => {
    expect(parseRunIdFromHash('')).toBeNull();
    expect(parseRunIdFromHash('#')).toBeNull();
  });

  it('returns null for an unrelated hash', () => {
    expect(parseRunIdFromHash('#/something-else')).toBeNull();
  });

  it('decodes a percent-encoded run id', () => {
    expect(parseRunIdFromHash('#/run/abc%2Fdef')).toBe('abc/def');
  });
});
