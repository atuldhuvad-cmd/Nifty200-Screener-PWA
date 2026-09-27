import { SYNC_STATES, type SyncDiagnostics, type SyncRecord, type SyncState } from './types';

/**
 * Every trigger the brief describes for a sync-state change. `transition()` is the single
 * state-machine function (Engineering Standards: "every state transition must pass through
 * one single state-machine function — UI code may never assign a sync state directly").
 * Assigning the *initial* state of a brand-new run record (at commit/ingest time) is not a
 * transition of an existing run and does not go through this function — see runs.ts/ingest.ts.
 */
export type SyncEvent =
  | { type: 'START_SYNC' }
  | { type: 'SYNC_SUCCEEDED' }
  | { type: 'SYNC_FAILED'; errorCode: string; retryable: boolean }
  | { type: 'SYNC_CANCELLED' }
  | { type: 'SYNC_TIMEOUT' }
  | { type: 'REMOTE_MISSING_DETECTED' }
  | { type: 'REMOTE_CONFLICT_DETECTED' }
  | { type: 'KEEP_LOCAL_ONLY' }
  | { type: 'INGEST_CONFLICT_VARIANT' }
  | { type: 'QUARANTINE' };

export type SyncEventType = SyncEvent['type'];

export type TransitionResult =
  | { ok: true; record: SyncRecord }
  | { ok: false; reason: 'invalid_transition'; from: SyncState; event: SyncEventType };

const ALLOWED_FROM: Record<SyncEventType, readonly SyncState[]> = {
  START_SYNC: ['pending', 'synced', 'local_only', 'remote_missing', 'error'],
  SYNC_SUCCEEDED: ['syncing'],
  SYNC_FAILED: ['syncing'],
  SYNC_CANCELLED: ['syncing'],
  SYNC_TIMEOUT: ['syncing'],
  REMOTE_MISSING_DETECTED: ['synced'],
  REMOTE_CONFLICT_DETECTED: ['synced', 'syncing'],
  KEEP_LOCAL_ONLY: ['remote_missing', 'conflict'],
  // Any resolvable run can be pre-empted by a newly discovered divergent variant or a failed
  // replay — but a run this app doesn't even interpret (quarantined, unsupported_schema) is
  // excluded, since it never entered the sync/replay pipeline that discovers these in the first place.
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

function isSyncState(x: unknown): x is SyncState {
  return typeof x === 'string' && (SYNC_STATES as readonly string[]).includes(x);
}

/**
 * Pure: computes the next SyncRecord for one event, or reports the event as invalid from the
 * current state. Never mutates its input. The 9-state set and every edge here are drawn
 * directly from the brief's "Local storage", "Sync state machine discipline", "Drive API
 * contract standards" and "Data lifecycle" sections — see DECISIONS.md for the full mapping
 * from brief prose to these event names.
 */
export function transition(current: SyncRecord, event: SyncEvent): TransitionResult {
  const from = current.state;
  const allowed = ALLOWED_FROM[event.type];
  if (!allowed.includes(from)) {
    return { ok: false, reason: 'invalid_transition', from, event: event.type };
  }

  const diagnostics = { ...current.diagnostics };
  let nextState: SyncState;
  let priorStableState = current.prior_stable_state;

  switch (event.type) {
    case 'START_SYNC': {
      nextState = 'syncing';
      priorStableState = from;
      diagnostics.last_attempt_at = nowIso();
      diagnostics.attempt_count += 1;
      diagnostics.error_code = null;
      diagnostics.retryable = null;
      break;
    }
    case 'SYNC_SUCCEEDED': {
      nextState = 'synced';
      priorStableState = null;
      diagnostics.last_success_at = nowIso();
      diagnostics.error_code = null;
      diagnostics.retryable = null;
      break;
    }
    case 'SYNC_FAILED': {
      nextState = 'error';
      priorStableState = null;
      diagnostics.error_code = event.errorCode;
      diagnostics.retryable = event.retryable;
      break;
    }
    case 'SYNC_CANCELLED':
    case 'SYNC_TIMEOUT': {
      // "Never leave a run stuck in syncing" / "Never convert every timed-out operation to
      // pending" — restore whatever stable state preceded this attempt.
      if (!isSyncState(priorStableState)) {
        // Structurally unreachable (START_SYNC always sets it before syncing is entered), but
        // guarded rather than asserted so a corrupted record can never silently misroute.
        return { ok: false, reason: 'invalid_transition', from, event: event.type };
      }
      nextState = priorStableState;
      priorStableState = null;
      break;
    }
    case 'REMOTE_MISSING_DETECTED': {
      nextState = 'remote_missing';
      priorStableState = null;
      break;
    }
    case 'REMOTE_CONFLICT_DETECTED':
    case 'INGEST_CONFLICT_VARIANT': {
      nextState = 'conflict';
      priorStableState = null;
      break;
    }
    case 'KEEP_LOCAL_ONLY': {
      nextState = 'local_only';
      priorStableState = null;
      break;
    }
    case 'QUARANTINE': {
      nextState = 'quarantined';
      priorStableState = null;
      break;
    }
  }

  return {
    ok: true,
    record: { state: nextState, prior_stable_state: priorStableState, diagnostics },
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

export type { SyncDiagnostics, SyncRecord, SyncState };
export { SYNC_STATES };
