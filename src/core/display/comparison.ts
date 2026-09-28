import type { MatchMethod, StockIdentity } from '../csv/identifiers';
import {
  isSupportedEnvelope,
  isinIdentityKey,
  nseIdentityKey,
  type ComparisonIdentityGroup,
  type RunRecord,
} from '../storage';
import { normalizeForDisplay } from './normalizeForDisplay';
import { compareRunsChronologically } from './runOrder';
import { projectRunRows, type ProjectedRow } from './runRows';

/** Step 5B: pure longitudinal-comparison logic — identity selection, eligible-run projection,
 * absence expansion, and deterministic ordering — with zero Svelte/DOM dependency, per the
 * round's "do not create a second identity-matching implementation in Svelte" instruction.
 * Every function here only reads already-fetched `RunRecord`s and `ComparisonIdentityGroup`s
 * (both sourced from the storage layer's existing, unmodified queries); nothing here touches
 * IndexedDB, mutates an envelope, or recomputes a historical metric. */

/** The same `isin:<x>` / `nse:<x>` scheme `comparisonIndex.ts` uses, computed here from an
 * already-derived `StockIdentity` (e.g. a `ProjectedRow.identity`) so a UI can link from a row
 * straight to that identity's comparison view without re-deriving matching rules itself. */
export function identityKeyForIdentity(identity: StockIdentity): string | null {
  if (identity.match_method === 'isin' && identity.normalized_isin !== null) {
    return isinIdentityKey(identity.normalized_isin);
  }
  if (identity.match_method === 'nse_code_provisional' && identity.normalized_nse_code !== null) {
    return nseIdentityKey(identity.normalized_nse_code);
  }
  return null;
}

export interface ComparisonPickerEntry {
  identityKey: string;
  matchMethod: MatchMethod;
  normalizedIsin: string | null;
  normalizedNseCode: string | null;
  /** A representative raw stock name for display only (S3-normalized) — never the selection
   * key itself, which is always `identityKey`. `undefined` when no eligible run's projection
   * has a recognizable "Stock"-like column for any occurrence of this identity. */
  sampleStockName: string | undefined;
  /** Distinct eligible runs (not occurrences) this identity appears in at least once. */
  eligibleRunCount: number;
}

function findStockNameColumn(projection: ReturnType<typeof projectRunRows>): number {
  return projection.columns.findIndex((c) => c.headerKey === 'stock');
}

/**
 * Builds the stock picker from `listComparisonIdentityGroups`'s output — the persisted,
 * rebuildable `comparison_identity` index — never from raw stock-name text. `runsById` supplies
 * only a representative display label per entry (picked from whichever eligible occurrence's
 * run has a "Stock" column, first found), purely cosmetic; the actual selectable identity is
 * always `identityKey`. Entries sort by sample name (case-insensitive), then by `identityKey`,
 * so the picker itself is deterministic even before the user searches/selects.
 */
export function buildComparisonPickerEntries(
  groups: readonly ComparisonIdentityGroup[],
  runsById: ReadonlyMap<string, RunRecord>,
): ComparisonPickerEntry[] {
  const entries = groups.map((group): ComparisonPickerEntry => {
    let sampleStockName: string | undefined;
    for (const record of group.records) {
      const run = runsById.get(record.run_id);
      if (run === undefined || !isSupportedEnvelope(run.envelope)) continue;
      const projection = projectRunRows(run.envelope);
      const stockColumnIndex = findStockNameColumn(projection);
      if (stockColumnIndex === -1) continue;
      const row = projection.rows[record.row_index];
      const cell = row?.cells[stockColumnIndex];
      if (cell !== undefined) {
        sampleStockName = normalizeForDisplay(cell);
        break;
      }
    }
    return {
      identityKey: group.identity_key,
      matchMethod: group.match_method,
      normalizedIsin: group.normalized_isin,
      normalizedNseCode: group.normalized_nse_code,
      sampleStockName,
      eligibleRunCount: new Set(group.records.map((r) => r.run_id)).size,
    };
  });

  return entries.sort((a, b) => {
    const an = (a.sampleStockName ?? '').toLowerCase();
    const bn = (b.sampleStockName ?? '').toLowerCase();
    if (an !== bn) return an < bn ? -1 : 1;
    return a.identityKey < b.identityKey ? -1 : a.identityKey > b.identityKey ? 1 : 0;
  });
}

export type ComparisonCell =
  | { status: 'absent'; runId: string }
  | { status: 'present'; runId: string; row: ProjectedRow; stockName: string | undefined };

export interface ComparisonRunColumn {
  run: RunRecord;
  runId: string;
  effectiveDate: string;
  importedAt: string;
}

export interface ComparisonResult {
  identityKey: string;
  matchMethod: MatchMethod;
  normalizedIsin: string | null;
  normalizedNseCode: string | null;
  /** Chronological (oldest first), per Views §1's amended Step 5B default. */
  runs: ComparisonRunColumn[];
  /** Index-aligned with `runs`. */
  cells: ComparisonCell[];
}

/**
 * Builds one identity's longitudinal comparison across exactly the given `runs` (the caller
 * decides which eligible runs participate — default "all eligible" is a caller-side concern,
 * not this function's), in deterministic chronological order. A run with no occurrence of this
 * identity is `absent` — explicit, never blank/zero/an error. Only the *first* occurrence (by
 * ascending `row_index`) is used for a run with more than one matching row for the same
 * identity (an already-flagged within-run duplicate, per Step 4's `DUPLICATE_ISIN_IN_RUN`/
 * `DUPLICATE_NSE_CODE_IN_RUN` warnings) — every row is still preserved in that run's own detail
 * view; this table shows one column per run.
 */
export function buildComparisonResult(
  group: Pick<
    ComparisonIdentityGroup,
    'identity_key' | 'match_method' | 'normalized_isin' | 'normalized_nse_code' | 'records'
  >,
  runs: readonly RunRecord[],
): ComparisonResult {
  const ordered = [...runs].sort(compareRunsChronologically);

  const firstRecordByRun = new Map<string, (typeof group.records)[number]>();
  for (const record of group.records) {
    const existing = firstRecordByRun.get(record.run_id);
    if (existing === undefined || record.row_index < existing.row_index) {
      firstRecordByRun.set(record.run_id, record);
    }
  }

  const cells: ComparisonCell[] = ordered.map((run) => {
    const record = firstRecordByRun.get(run.run_id);
    if (record === undefined || !isSupportedEnvelope(run.envelope)) {
      return { status: 'absent', runId: run.run_id };
    }
    const projection = projectRunRows(run.envelope);
    const row = projection.rows[record.row_index];
    if (row === undefined) return { status: 'absent', runId: run.run_id }; // defensive only
    const stockColumnIndex = findStockNameColumn(projection);
    const rawStockCell = stockColumnIndex === -1 ? undefined : row.cells[stockColumnIndex];
    return {
      status: 'present',
      runId: run.run_id,
      row,
      stockName: rawStockCell === undefined ? undefined : normalizeForDisplay(rawStockCell),
    };
  });

  const runColumns: ComparisonRunColumn[] = ordered.map((run) => ({
    run,
    runId: run.run_id,
    effectiveDate: isSupportedEnvelope(run.envelope) ? run.envelope.effective_date : '—',
    importedAt: isSupportedEnvelope(run.envelope) ? run.envelope.imported_at : '—',
  }));

  return {
    identityKey: group.identity_key,
    matchMethod: group.match_method,
    normalizedIsin: group.normalized_isin,
    normalizedNseCode: group.normalized_nse_code,
    runs: runColumns,
    cells,
  };
}
