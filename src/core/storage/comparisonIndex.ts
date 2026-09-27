import type { IDBPObjectStore, StoreNames } from 'idb';
import { mapColumns } from '../csv/headers';
import { buildStockIdentity } from '../csv/identifiers';
import type { RunEnvelopeV1 } from '../envelope/types';
import {
  COMPARISON_BY_IDENTITY_KEY,
  COMPARISON_BY_RUN_ID,
  STORE,
  type N200Database,
  type N200DBSchema,
} from './schema';
import type { ComparisonIdentityRecord } from './types';

function identityKeyFor(
  matchMethod: 'isin' | 'nse_code_provisional',
  normalizedId: string,
): string {
  return matchMethod === 'isin' ? `isin:${normalizedId}` : `nse:${normalizedId}`;
}

function deriveComparisonRows(runId: string, envelope: RunEnvelopeV1): ComparisonIdentityRecord[] {
  const mapping = mapColumns(envelope.headers);
  const isinCol = mapping.columns.isin;
  const nseCol = mapping.columns.nseCode;
  const rows: ComparisonIdentityRecord[] = [];

  envelope.rows.forEach((row, rowIndex) => {
    const rawIsin = isinCol !== undefined ? (row[isinCol] ?? '') : '';
    const rawNse = nseCol !== undefined ? (row[nseCol] ?? '') : '';
    const identity = buildStockIdentity(rawIsin, rawNse);
    // Both normalized identifiers are stored on every indexed row, regardless of which one
    // `match_method` is keyed on (Bugbot P2-2) — needed so a "same NSE Code, different ISIN"
    // conflict (brief: "conflict; do not auto-merge, surface for review") can be detected by
    // scanning the index, without re-deriving identity from every envelope each time.
    if (identity.match_method === 'isin' && identity.normalized_isin !== null) {
      rows.push({
        run_id: runId,
        row_index: rowIndex,
        match_method: 'isin',
        identity_key: identityKeyFor('isin', identity.normalized_isin),
        normalized_isin: identity.normalized_isin,
        normalized_nse_code: identity.normalized_nse_code,
      });
    } else if (
      identity.match_method === 'nse_code_provisional' &&
      identity.normalized_nse_code !== null
    ) {
      rows.push({
        run_id: runId,
        row_index: rowIndex,
        match_method: 'nse_code_provisional',
        identity_key: identityKeyFor('nse_code_provisional', identity.normalized_nse_code),
        normalized_isin: identity.normalized_isin,
        normalized_nse_code: identity.normalized_nse_code,
      });
    }
    // match_method === null (neither identifier usable) is excluded from the index, matching
    // the brief: such a row is preserved in the raw run but excluded from longitudinal comparison.
  });

  return rows;
}

/**
 * Deletes this run's existing comparison-identity rows (if any) and inserts freshly derived
 * ones, using the `comparison_identity` store handle from the caller's already-open
 * transaction — so it composes into the same atomic transaction as a run commit (whatever
 * other stores that transaction also spans, expressed via the `TxStores` type parameter, is
 * irrelevant here), or runs standalone for a later rebuild. Awaited fully by the caller
 * before that transaction's `.done` resolves. A disposable cache: safe to call repeatedly,
 * never the source of truth.
 */
export async function rebuildComparisonIndexTx<
  TxStores extends readonly StoreNames<N200DBSchema>[],
>(
  store: IDBPObjectStore<N200DBSchema, TxStores, typeof STORE.comparisonIdentity, 'readwrite'>,
  runId: string,
  envelope: RunEnvelopeV1,
): Promise<void> {
  const existingKeys = await store.index(COMPARISON_BY_RUN_ID).getAllKeys(runId);
  for (const key of existingKeys) await store.delete(key);
  const rows = deriveComparisonRows(runId, envelope);
  for (const row of rows) await store.add(row);
}

/** States whose runs are excluded from active comparison views (brief: "Runs in conflict,
 * quarantined, or unsupported_schema state must not participate in comparison views"). */
const EXCLUDED_FROM_COMPARISON = new Set(['conflict', 'quarantined', 'unsupported_schema']);

/**
 * Finds comparison-index rows by identity key, filtered against each matched row's canonical
 * run's *current* sync state (Bugbot P1-2) — never by deleting or mutating index rows, which
 * stay physically present so nothing needs rebuilding when a run is later restored to an
 * eligible state. A run whose current record can't be found (should not happen; defensive
 * only) is excluded rather than surfaced with stale data.
 */
export async function queryComparisonIndexByIdentity(
  db: N200Database,
  identityKey: string,
): Promise<ComparisonIdentityRecord[]> {
  const rows = await db.getAllFromIndex(
    STORE.comparisonIdentity,
    COMPARISON_BY_IDENTITY_KEY,
    identityKey,
  );
  const eligible: ComparisonIdentityRecord[] = [];
  for (const row of rows) {
    const run = await db.get(STORE.runs, row.run_id);
    if (run && !EXCLUDED_FROM_COMPARISON.has(run.sync.state)) eligible.push(row);
  }
  return eligible;
}

export function isinIdentityKey(normalizedIsin: string): string {
  return identityKeyFor('isin', normalizedIsin);
}

export function nseIdentityKey(normalizedNseCode: string): string {
  return identityKeyFor('nse_code_provisional', normalizedNseCode);
}

export interface IdentityConflictEntry {
  run_id: string;
  row_index: number;
  normalized_isin: string | null;
}

export interface IdentityConflictGroup {
  normalized_nse_code: string;
  entries: IdentityConflictEntry[];
}

/**
 * Detects the brief's "Same NSE Code, different ISIN → conflict; do not auto-merge, surface
 * for review" rule (Bugbot P2-2), by scanning the whole comparison-identity index. A group is
 * reported only when the same `normalized_nse_code` co-occurs with two or more *distinct*
 * non-null `normalized_isin` values — the same stock's same ISIN recurring across runs, or a
 * lone NSE-only-matched row with no ISIN at all, is never a conflict by itself. Read-only:
 * detection only, never auto-merges or mutates anything.
 */
export async function findIdentityConflicts(db: N200Database): Promise<IdentityConflictGroup[]> {
  const rows = await db.getAll(STORE.comparisonIdentity);
  const byNseCode = new Map<string, ComparisonIdentityRecord[]>();
  for (const row of rows) {
    if (row.normalized_nse_code === null) continue;
    const group = byNseCode.get(row.normalized_nse_code) ?? [];
    group.push(row);
    byNseCode.set(row.normalized_nse_code, group);
  }

  const conflicts: IdentityConflictGroup[] = [];
  for (const [normalizedNseCode, group] of byNseCode) {
    const distinctIsins = new Set(
      group.map((r) => r.normalized_isin).filter((v): v is string => v !== null),
    );
    if (distinctIsins.size >= 2) {
      conflicts.push({
        normalized_nse_code: normalizedNseCode,
        entries: group.map((r) => ({
          run_id: r.run_id,
          row_index: r.row_index,
          normalized_isin: r.normalized_isin,
        })),
      });
    }
  }
  return conflicts;
}
