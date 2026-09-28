import { isSupportedEnvelope, type RunRecord } from '../storage';

interface SortableDates {
  effectiveDate: string;
  importedAt: string;
}

/** `undefined` for a run whose envelope isn't a known, supported schema (no `effective_date`/
 * `imported_at` exist to sort by) — those runs still appear in the list (for status visibility),
 * ordered among themselves, and after every supported run, by `run_id` alone. */
function sortableDates(envelope: RunRecord['envelope']): SortableDates | undefined {
  if (!isSupportedEnvelope(envelope)) return undefined;
  return { effectiveDate: envelope.effective_date, importedAt: envelope.imported_at };
}

/**
 * Views §1's deterministic default run-history order: `effective_date` descending, then
 * `imported_at` descending, then `run_id` as the final tiebreaker. Both fields are ISO 8601 /
 * RFC 3339 UTC strings, so plain string comparison is already chronologically correct — no date
 * parsing needed. Every run remains separately identifiable, including multiple runs sharing an
 * `effective_date` and even an `imported_at` (extremely unlikely, but `run_id` still resolves it
 * deterministically).
 */
export function compareRunsForHistory(a: RunRecord, b: RunRecord): number {
  const ad = sortableDates(a.envelope);
  const bd = sortableDates(b.envelope);
  if (ad === undefined || bd === undefined) {
    if ((ad === undefined) !== (bd === undefined)) return ad === undefined ? 1 : -1;
  } else {
    if (ad.effectiveDate !== bd.effectiveDate) return ad.effectiveDate > bd.effectiveDate ? -1 : 1;
    if (ad.importedAt !== bd.importedAt) return ad.importedAt > bd.importedAt ? -1 : 1;
  }
  return a.run_id < b.run_id ? -1 : a.run_id > b.run_id ? 1 : 0;
}

export function sortRunsForHistory(runs: readonly RunRecord[]): RunRecord[] {
  return [...runs].sort(compareRunsForHistory);
}
