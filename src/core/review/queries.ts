import {
  STORE,
  type N200Database,
  type QuarantineItemRecord,
  type RunRecord,
  type RunVariantRecord,
} from '../storage';

export interface RunWithVariants {
  run: RunRecord;
  variants: RunVariantRecord[];
}

export interface ReviewData {
  /** Canonical runs currently in `conflict`, each with every preserved divergent variant. */
  conflicts: RunWithVariants[];
  /** Runs no longer in `conflict` (e.g. after "Keep local only") that still hold variants. */
  resolved: RunWithVariants[];
  /** Malformed/untrusted inputs preserved with their original bytes. */
  quarantine: QuarantineItemRecord[];
  /** Canonical runs in `unsupported_schema` or `quarantined` state — excluded from active views. */
  blockedRuns: RunRecord[];
}

/**
 * Read-only: everything the "Needs review" view shows, read inside ONE readonly transaction over
 * all three stores so the lists can never reflect two different points in time. Writes nothing.
 */
export async function loadReviewData(db: N200Database): Promise<ReviewData> {
  const tx = db.transaction([STORE.runs, STORE.runVariants, STORE.quarantineItems], 'readonly');
  const [runs, variants, quarantine] = await Promise.all([
    tx.objectStore(STORE.runs).getAll(),
    tx.objectStore(STORE.runVariants).getAll(),
    tx.objectStore(STORE.quarantineItems).getAll(),
  ]);
  await tx.done;

  const variantsByRun = new Map<string, RunVariantRecord[]>();
  for (const v of variants) {
    const list = variantsByRun.get(v.run_id);
    if (list) list.push(v);
    else variantsByRun.set(v.run_id, [v]);
  }

  const conflicts: RunWithVariants[] = [];
  const resolved: RunWithVariants[] = [];
  const blockedRuns: RunRecord[] = [];
  for (const run of runs) {
    const runVariants = variantsByRun.get(run.run_id) ?? [];
    if (run.sync.state === 'conflict') conflicts.push({ run, variants: runVariants });
    else if (runVariants.length > 0) resolved.push({ run, variants: runVariants });
    if (run.sync.state === 'unsupported_schema' || run.sync.state === 'quarantined') {
      blockedRuns.push(run);
    }
  }
  return { conflicts, resolved, quarantine, blockedRuns };
}
