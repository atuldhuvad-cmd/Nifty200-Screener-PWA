import { describe, expect, it } from 'vitest';
import {
  compareHash,
  historyHash,
  parseCompareRouteFromHash,
  parseRunIdFromHash,
  runDetailHash,
} from '../../src/lib/route';

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

describe('route: hash <-> comparison view (Step 5B)', () => {
  it('parses the picker-only route (#/compare) with a null identityKey', () => {
    expect(parseCompareRouteFromHash('#/compare')).toEqual({ identityKey: null });
  });

  it('round-trips an identity key, including the colon separator', () => {
    const identityKey = 'isin:ZZSYNTH00015';
    expect(parseCompareRouteFromHash(compareHash(identityKey))).toEqual({ identityKey });
  });

  it('compareHash() with no argument produces the picker-only route', () => {
    expect(compareHash()).toBe('#/compare');
    expect(compareHash(null)).toBe('#/compare');
  });

  it('returns null (not a comparison route) for the history and run-detail routes', () => {
    expect(parseCompareRouteFromHash('')).toBeNull();
    expect(parseCompareRouteFromHash('#/run/abc')).toBeNull();
    expect(parseCompareRouteFromHash('#/something-else')).toBeNull();
  });

  it('never collides with the run-detail route pattern', () => {
    const runId = '11111111-1111-4111-8111-111111111111';
    expect(parseCompareRouteFromHash(runDetailHash(runId))).toBeNull();
    expect(parseRunIdFromHash(compareHash('isin:ZZSYNTH00015'))).toBeNull();
  });

  it('historyHash() is the empty-hash-equivalent list route', () => {
    expect(parseRunIdFromHash(historyHash())).toBeNull();
    expect(parseCompareRouteFromHash(historyHash())).toBeNull();
  });
});
