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

describe('route: malformed percent-encoding fails safely, never throws (review finding)', () => {
  it.each(['%', '%2', '%GG', 'abc%', 'valid-prefix%2', 'valid-prefix%zz'])(
    'parseRunIdFromHash returns null instead of throwing for #/run/%s',
    (segment) => {
      expect(() => parseRunIdFromHash(`#/run/${segment}`)).not.toThrow();
      expect(parseRunIdFromHash(`#/run/${segment}`)).toBeNull();
    },
  );

  it.each(['%', '%2', '%GG', 'abc%', 'valid-prefix%2', 'valid-prefix%zz'])(
    'parseCompareRouteFromHash returns null instead of throwing for #/compare/%s',
    (segment) => {
      expect(() => parseCompareRouteFromHash(`#/compare/${segment}`)).not.toThrow();
      expect(parseCompareRouteFromHash(`#/compare/${segment}`)).toBeNull();
    },
  );

  it('never partially decodes, repairs, or guesses a malformed value', () => {
    // A guess/repair would return something like 'valid-prefix' or 'valid-prefix%2' verbatim;
    // the only acceptable outcomes are null (route.ts) or a value that round-trips exactly.
    expect(parseRunIdFromHash('#/run/valid-prefix%2')).toBeNull();
    expect(parseCompareRouteFromHash('#/compare/valid-prefix%2')).toBeNull();
  });

  it('a well-formed value adjacent to these cases still decodes normally (no over-broad rejection)', () => {
    expect(parseRunIdFromHash('#/run/valid-prefix%2Fsuffix')).toBe('valid-prefix/suffix');
    expect(parseCompareRouteFromHash('#/compare/isin%3AZZSYNTH00015')).toEqual({
      identityKey: 'isin:ZZSYNTH00015',
    });
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

describe('Step 6B review route', () => {
  it('reviewHash / isReviewRoute round-trip and never match other routes', async () => {
    const { reviewHash, isReviewRoute } = await import('../../src/lib/route');
    expect(reviewHash()).toBe('#/review');
    expect(isReviewRoute('#/review')).toBe(true);
    for (const h of ['', '#/', '#/backup', '#/review/x', '#/compare', '#/run/abc'])
      expect(isReviewRoute(h)).toBe(false);
  });
});
