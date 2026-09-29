import { applyTransition, getRun, type ApplyTransitionResult, type N200Database } from '../storage';

export type KeepLocalOnlyResult = ApplyTransitionResult | { ok: false; reason: 'not_in_conflict' };

/**
 * The only resolution action v1 offers for a conflict: retain the canonical local run as
 * `local_only` (brief, "Data lifecycle"). Goes through the single state-machine entry point
 * (`applyTransition`), never touches the canonical envelope or any variant, and — unlike the raw
 * `KEEP_LOCAL_ONLY` event, which is also legal from `remote_missing` — is restricted to runs
 * currently in `conflict`.
 */
export async function keepLocalOnly(db: N200Database, runId: string): Promise<KeepLocalOnlyResult> {
  const run = await getRun(db, runId);
  if (!run) return { ok: false, reason: 'run_not_found' };
  if (run.sync.state !== 'conflict') return { ok: false, reason: 'not_in_conflict' };
  return applyTransition(db, runId, { type: 'KEEP_LOCAL_ONLY' });
}
