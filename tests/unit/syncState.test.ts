import { describe, expect, it } from 'vitest';
import { transition, type SyncEvent, type SyncEventType } from '../../src/core/storage/syncState';
import {
  initialSyncRecord,
  SYNC_STATES,
  type SyncRecord,
  type SyncState,
} from '../../src/core/storage/types';

const EVENT_TYPES: SyncEventType[] = [
  'START_SYNC',
  'SYNC_SUCCEEDED',
  'SYNC_FAILED',
  'SYNC_CANCELLED',
  'SYNC_TIMEOUT',
  'REMOTE_MISSING_DETECTED',
  'REMOTE_CONFLICT_DETECTED',
  'KEEP_LOCAL_ONLY',
  'INGEST_CONFLICT_VARIANT',
  'QUARANTINE',
];

function eventOf(type: SyncEventType): SyncEvent {
  if (type === 'SYNC_FAILED') return { type, errorCode: 'TEST_ERROR', retryable: true };
  return { type } as SyncEvent;
}

function recordAt(state: SyncState, priorStableState: SyncState | null = null): SyncRecord {
  return { ...initialSyncRecord(state), prior_stable_state: priorStableState };
}

// The full allowed-transition table, derived independently from the brief prose (see
// DECISIONS.md for the mapping) — this is the ground truth every other test in this file
// is checked against, not a restatement of syncState.ts's own internal table.
const ALLOWED: Record<SyncEventType, readonly SyncState[]> = {
  START_SYNC: ['pending', 'synced', 'local_only', 'remote_missing', 'error'],
  SYNC_SUCCEEDED: ['syncing'],
  SYNC_FAILED: ['syncing'],
  SYNC_CANCELLED: ['syncing'],
  SYNC_TIMEOUT: ['syncing'],
  REMOTE_MISSING_DETECTED: ['synced'],
  REMOTE_CONFLICT_DETECTED: ['synced', 'syncing'],
  KEEP_LOCAL_ONLY: ['remote_missing', 'conflict'],
  INGEST_CONFLICT_VARIANT: [
    'pending',
    'syncing',
    'synced',
    'error',
    'remote_missing',
    'local_only',
    'conflict',
  ],
  QUARANTINE: ['pending', 'syncing', 'synced', 'error', 'remote_missing', 'local_only', 'conflict'],
};

describe('transition(): exhaustive table over all 9 states × 10 events', () => {
  for (const state of SYNC_STATES) {
    for (const eventType of EVENT_TYPES) {
      const allowedFrom = ALLOWED[eventType];
      const shouldAllow = allowedFrom.includes(state);

      it(`${eventType} from ${state}: ${shouldAllow ? 'allowed' : 'rejected'}`, () => {
        const from: SyncRecord =
          state === 'syncing' ? recordAt('syncing', 'pending') : recordAt(state);
        const result = transition(from, eventOf(eventType));

        if (shouldAllow) {
          expect(result.ok, JSON.stringify(result)).toBe(true);
          if (result.ok) expect(SYNC_STATES).toContain(result.record.state);
        } else {
          expect(result).toEqual({
            ok: false,
            reason: 'invalid_transition',
            from: state,
            event: eventType,
          });
        }
      });
    }
  }

  it('never assigns a state outside the declared 9-state set, across every allowed edge', () => {
    for (const [eventType, states] of Object.entries(ALLOWED) as [
      SyncEventType,
      readonly SyncState[],
    ][]) {
      for (const state of states) {
        const from = state === 'syncing' ? recordAt('syncing', 'pending') : recordAt(state);
        const result = transition(from, eventOf(eventType));
        expect(result.ok).toBe(true);
        if (result.ok) expect(SYNC_STATES).toContain(result.record.state);
      }
    }
  });
});

describe('transition(): specific resulting states and diagnostics', () => {
  it('START_SYNC: pending -> syncing, records prior_stable_state, bumps attempt_count', () => {
    const result = transition(recordAt('pending'), { type: 'START_SYNC' });
    expect(result.ok && result.record.state).toBe('syncing');
    expect(result.ok && result.record.prior_stable_state).toBe('pending');
    expect(result.ok && result.record.diagnostics.attempt_count).toBe(1);
    expect(result.ok && result.record.diagnostics.last_attempt_at).not.toBeNull();
  });

  it('START_SYNC: synced -> syncing, records synced as prior_stable_state (re-verification)', () => {
    const result = transition(recordAt('synced'), { type: 'START_SYNC' });
    expect(result.ok && result.record.state).toBe('syncing');
    expect(result.ok && result.record.prior_stable_state).toBe('synced');
  });

  it('SYNC_SUCCEEDED: syncing -> synced, sets last_success_at, clears prior_stable_state', () => {
    const result = transition(recordAt('syncing', 'pending'), { type: 'SYNC_SUCCEEDED' });
    expect(result.ok && result.record.state).toBe('synced');
    expect(result.ok && result.record.prior_stable_state).toBeNull();
    expect(result.ok && result.record.diagnostics.last_success_at).not.toBeNull();
  });

  it('SYNC_FAILED: syncing -> error, records error_code and retryable', () => {
    const result = transition(recordAt('syncing', 'pending'), {
      type: 'SYNC_FAILED',
      errorCode: 'RATE_LIMIT_EXCEEDED',
      retryable: true,
    });
    expect(result.ok && result.record.state).toBe('error');
    expect(result.ok && result.record.diagnostics.error_code).toBe('RATE_LIMIT_EXCEEDED');
    expect(result.ok && result.record.diagnostics.retryable).toBe(true);
  });

  it('SYNC_CANCELLED: an interrupted-but-unsynced run returns to pending, never stuck in syncing', () => {
    const result = transition(recordAt('syncing', 'pending'), { type: 'SYNC_CANCELLED' });
    expect(result).toMatchObject({
      ok: true,
      record: { state: 'pending', prior_stable_state: null },
    });
  });

  it('SYNC_CANCELLED: an already-synced run stays synced through a cancelled re-verify', () => {
    const result = transition(recordAt('syncing', 'synced'), { type: 'SYNC_CANCELLED' });
    expect(result).toMatchObject({
      ok: true,
      record: { state: 'synced', prior_stable_state: null },
    });
  });

  it('SYNC_TIMEOUT: same preserve-prior-state behaviour as cancellation, for pending and synced', () => {
    expect(transition(recordAt('syncing', 'pending'), { type: 'SYNC_TIMEOUT' })).toMatchObject({
      ok: true,
      record: { state: 'pending' },
    });
    expect(transition(recordAt('syncing', 'synced'), { type: 'SYNC_TIMEOUT' })).toMatchObject({
      ok: true,
      record: { state: 'synced' },
    });
  });

  it('SYNC_TIMEOUT never forces every timed-out operation to pending', () => {
    const result = transition(recordAt('syncing', 'local_only'), { type: 'SYNC_TIMEOUT' });
    expect(result).toMatchObject({ ok: true, record: { state: 'local_only' } });
  });

  it('a syncing record with a corrupted (non-syncing-derived) prior_stable_state is rejected, never misrouted', () => {
    const corrupted: SyncRecord = { ...recordAt('syncing'), prior_stable_state: null };
    const result = transition(corrupted, { type: 'SYNC_CANCELLED' });
    expect(result).toEqual({
      ok: false,
      reason: 'invalid_transition',
      from: 'syncing',
      event: 'SYNC_CANCELLED',
    });
  });

  it('REMOTE_MISSING_DETECTED: synced -> remote_missing', () => {
    const result = transition(recordAt('synced'), { type: 'REMOTE_MISSING_DETECTED' });
    expect(result).toMatchObject({ ok: true, record: { state: 'remote_missing' } });
  });

  it('REMOTE_CONFLICT_DETECTED: synced -> conflict, never auto-resolved', () => {
    const result = transition(recordAt('synced'), { type: 'REMOTE_CONFLICT_DETECTED' });
    expect(result).toMatchObject({ ok: true, record: { state: 'conflict' } });
  });

  it('KEEP_LOCAL_ONLY: remote_missing -> local_only, and conflict -> local_only', () => {
    expect(transition(recordAt('remote_missing'), { type: 'KEEP_LOCAL_ONLY' })).toMatchObject({
      ok: true,
      record: { state: 'local_only' },
    });
    expect(transition(recordAt('conflict'), { type: 'KEEP_LOCAL_ONLY' })).toMatchObject({
      ok: true,
      record: { state: 'local_only' },
    });
  });

  it('a "Restore to Drive" request from remote_missing re-enters the sync pipeline via START_SYNC', () => {
    const result = transition(recordAt('remote_missing'), { type: 'START_SYNC' });
    expect(result).toMatchObject({
      ok: true,
      record: { state: 'syncing', prior_stable_state: 'remote_missing' },
    });
  });

  it('re-requesting sync from local_only re-enters the pipeline via START_SYNC', () => {
    const result = transition(recordAt('local_only'), { type: 'START_SYNC' });
    expect(result).toMatchObject({
      ok: true,
      record: { state: 'syncing', prior_stable_state: 'local_only' },
    });
  });

  it('a retry from error re-enters the pipeline via START_SYNC and clears the prior error', () => {
    const errored: SyncRecord = {
      ...recordAt('error'),
      diagnostics: { ...initialSyncRecord().diagnostics, error_code: 'NETWORK', retryable: true },
    };
    const result = transition(errored, { type: 'START_SYNC' });
    expect(result.ok && result.record.state).toBe('syncing');
    expect(result.ok && result.record.diagnostics.error_code).toBeNull();
  });

  it('QUARANTINE and INGEST_CONFLICT_VARIANT are never reachable from quarantined or unsupported_schema', () => {
    for (const state of ['quarantined', 'unsupported_schema'] as const) {
      expect(transition(recordAt(state), { type: 'QUARANTINE' }).ok).toBe(false);
      expect(transition(recordAt(state), { type: 'INGEST_CONFLICT_VARIANT' }).ok).toBe(false);
    }
  });

  it('is a pure function: never mutates its input record', () => {
    const before = recordAt('pending');
    const snapshot = JSON.parse(JSON.stringify(before)) as SyncRecord;
    transition(before, { type: 'START_SYNC' });
    expect(before).toEqual(snapshot);
  });
});

describe('Bugbot P2-4: SYNC_TIMEOUT records a stable error diagnostic; SYNC_CANCELLED does not', () => {
  it('SYNC_TIMEOUT restores the prior state AND records a stable timeout error code with retryable: true', () => {
    const result = transition(recordAt('syncing', 'pending'), { type: 'SYNC_TIMEOUT' });
    expect(result.ok && result.record.state).toBe('pending');
    expect(result.ok && result.record.diagnostics.error_code).toBe('SYNC_TIMEOUT');
    expect(result.ok && result.record.diagnostics.retryable).toBe(true);
  });

  it('SYNC_CANCELLED restores the prior state with NO error diagnostic (user-initiated, not a failure)', () => {
    const result = transition(recordAt('syncing', 'pending'), { type: 'SYNC_CANCELLED' });
    expect(result.ok && result.record.state).toBe('pending');
    expect(result.ok && result.record.diagnostics.error_code).toBeNull();
    expect(result.ok && result.record.diagnostics.retryable).toBeNull();
  });

  it('the timeout error code is distinguishable from a SYNC_FAILED error code', () => {
    const timedOut = transition(recordAt('syncing', 'synced'), { type: 'SYNC_TIMEOUT' });
    const failed = transition(recordAt('syncing', 'synced'), {
      type: 'SYNC_FAILED',
      errorCode: 'NETWORK',
      retryable: true,
    });
    expect(timedOut.ok && timedOut.record.diagnostics.error_code).not.toBe(
      failed.ok && failed.record.diagnostics.error_code,
    );
  });
});

describe('Bugbot P2-3: has_verified_remote_copy is tracked explicitly', () => {
  it('starts false on a brand-new sync record', () => {
    expect(initialSyncRecord().diagnostics.has_verified_remote_copy).toBe(false);
  });

  it('becomes true only on SYNC_SUCCEEDED', () => {
    const result = transition(recordAt('syncing', 'pending'), { type: 'SYNC_SUCCEEDED' });
    expect(result.ok && result.record.diagnostics.has_verified_remote_copy).toBe(true);
  });

  it('becomes false again when the remote copy is found missing', () => {
    const synced: SyncRecord = {
      ...recordAt('synced'),
      diagnostics: { ...initialSyncRecord().diagnostics, has_verified_remote_copy: true },
    };
    const result = transition(synced, { type: 'REMOTE_MISSING_DETECTED' });
    expect(result.ok && result.record.diagnostics.has_verified_remote_copy).toBe(false);
  });

  it('becomes false when a divergent variant is discovered (conflict) even though it was previously synced', () => {
    const synced: SyncRecord = {
      ...recordAt('synced'),
      diagnostics: { ...initialSyncRecord().diagnostics, has_verified_remote_copy: true },
    };
    const result = transition(synced, { type: 'INGEST_CONFLICT_VARIANT' });
    expect(result.ok && result.record.diagnostics.has_verified_remote_copy).toBe(false);
  });

  it('is unaffected by a failed sync attempt (a prior verified copy still exists from before the failure)', () => {
    const previouslySynced: SyncRecord = {
      ...recordAt('syncing', 'synced'),
      diagnostics: { ...initialSyncRecord().diagnostics, has_verified_remote_copy: true },
    };
    const result = transition(previouslySynced, {
      type: 'SYNC_FAILED',
      errorCode: 'NETWORK',
      retryable: true,
    });
    expect(result.ok && result.record.diagnostics.has_verified_remote_copy).toBe(true);
  });
});
