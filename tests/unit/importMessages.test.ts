import { describe, expect, it } from 'vitest';
import { RUN_ID_COLLISION_MESSAGE } from '../../src/lib/importMessages';

describe('RUN_ID_COLLISION_MESSAGE', () => {
  it('tells the user the run already exists, not that ID generation failed', () => {
    expect(RUN_ID_COLLISION_MESSAGE).toBe(
      'This run already exists in this browser. Reload the app and check Run history before trying again.',
    );
    expect(RUN_ID_COLLISION_MESSAGE).not.toMatch(/Could not generate a unique run ID/);
  });
});
