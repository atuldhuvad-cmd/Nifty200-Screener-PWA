import { describe, expect, it } from 'vitest';
import { createRunId } from '../../src/core/envelope/runId';

describe('createRunId', () => {
  it('creates distinct UUID v4 IDs without relying on crypto.randomUUID', () => {
    const originalRandomUUID = crypto.randomUUID;
    // @ts-expect-error exercise the getRandomValues path in browsers without randomUUID.
    crypto.randomUUID = undefined;
    try {
      const ids = new Set(Array.from({ length: 20 }, () => createRunId()));
      expect(ids.size).toBe(20);
      for (const id of ids) {
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      }
    } finally {
      crypto.randomUUID = originalRandomUUID;
    }
  });
});
