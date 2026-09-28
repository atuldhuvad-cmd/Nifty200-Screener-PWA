import {
  SCHEMA_VERSION_V1,
  SCHEMA_VERSION_V2,
  type RunEnvelopeV1,
  type RunEnvelopeV2,
} from '../envelope/types';
import type { RunRecord } from './types';

export function isEnvelopeV1(envelope: RunRecord['envelope']): envelope is RunEnvelopeV1 {
  return envelope.schema_version === SCHEMA_VERSION_V1;
}

export function isEnvelopeV2(envelope: RunRecord['envelope']): envelope is RunEnvelopeV2 {
  return envelope.schema_version === SCHEMA_VERSION_V2;
}

export function isSupportedEnvelope(
  envelope: RunRecord['envelope'],
): envelope is RunEnvelopeV1 | RunEnvelopeV2 {
  return isEnvelopeV1(envelope) || isEnvelopeV2(envelope);
}

/**
 * No verified Drive copy right now (security review P1-A: `has_verified_remote_copy` is the
 * sole authoritative signal). The single source of truth for this predicate — `countAtRiskRuns`
 * (persistence.ts) and the run-history view (Step 5A) both call this rather than each keeping
 * their own copy of the rule.
 */
export function isRunAtRisk(run: RunRecord): boolean {
  const { state, diagnostics } = run.sync;
  if (state === 'quarantined' || state === 'unsupported_schema') return false;
  return !diagnostics.has_verified_remote_copy;
}

const NOT_OPENABLE_STATES = new Set(['conflict', 'quarantined', 'unsupported_schema']);

/**
 * A run may enter run-detail (Step 5A) only when its envelope is a known, supported schema and
 * its current sync state isn't one the brief excludes from active views/comparisons ("Runs in
 * `conflict`, `quarantined`, or `unsupported_schema` state must not participate in comparison
 * views ... until resolved"). Re-evaluated against the run's *current* sync state on every call
 * — never cached — so a run that resolves out of one of these states becomes openable
 * immediately with no separate migration step.
 */
export function isRunOpenable(run: RunRecord): boolean {
  return isSupportedEnvelope(run.envelope) && !NOT_OPENABLE_STATES.has(run.sync.state);
}
