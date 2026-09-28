import type { IDBPObjectStore, StoreNames } from 'idb';
import { mapColumns } from '../csv/headers';
import { buildStockIdentity } from '../csv/identifiers';
import type { RunEnvelopeV1, RunEnvelopeV2 } from '../envelope/types';
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

/** For v1: `row_index` is the position in `envelope.rows`. For v2: `row_index` is the position
 * in `envelope.combined_row_refs` (the combined ordering) — in both cases, "this run's own row
 * position," so `ComparisonIdentityRecord` needs no v2-specific field. */
function identityInputsFor(
  envelope: RunEnvelopeV1 | RunEnvelopeV2,
): { rawIsin: string; rawNse: string }[] {
  const extract = (mapping: ReturnType<typeof mapColumns>, row: string[]) => {
    const isinCol = mapping.columns.isin;
    const nseCol = mapping.columns.nseCode;
    return {
      rawIsin: isinCol !== undefined ? (row[isinCol] ?? '') : '',
      rawNse: nseCol !== undefined ? (row[nseCol] ?? '') : '',
    };
  };

  if (envelope.schema_version === '1') {
    const mapping = mapColumns(envelope.headers);
    return envelope.rows.map((row) => extract(mapping, row));
  }

  const mappingBySource = envelope.source_files.map((sf) => mapColumns(sf.headers));
  return envelope.combined_row_refs.map((ref) => {
    const mapping = mappingBySource[ref.source_index];
    const row = envelope.source_files[ref.source_index]?.rows[ref.source_row_index];
    if (mapping === undefined || row === undefined) return { rawIsin: '', rawNse: '' };
    return extract(mapping, row);
  });
}

function deriveComparisonRows(
  runId: string,
  envelope: RunEnvelopeV1 | RunEnvelopeV2,
): ComparisonIdentityRecord[] {
  const rows: ComparisonIdentityRecord[] = [];

  identityInputsFor(envelope).forEach(({ rawIsin, rawNse }, rowIndex) => {
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
  Mode extends 'readwrite' | 'versionchange' = 'readwrite',
>(
  store: IDBPObjectStore<N200DBSchema, TxStores, typeof STORE.comparisonIdentity, Mode>,
  runId: string,
  envelope: RunEnvelopeV1 | RunEnvelopeV2,
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
  // One explicit transaction spanning both stores (security review P1-C): every read below
  // sees one consistent snapshot taken when the transaction starts, so a concurrent
  // applyTransition() can never produce a "torn" result mixing rows and run states from two
  // different points in time — unlike separate db.getAllFromIndex/db.get shortcut calls, each
  // of which opens its own transaction.
  const tx = db.transaction([STORE.comparisonIdentity, STORE.runs], 'readonly');
  const rows = await tx
    .objectStore(STORE.comparisonIdentity)
    .index(COMPARISON_BY_IDENTITY_KEY)
    .getAll(identityKey);
  const eligible: ComparisonIdentityRecord[] = [];
  for (const row of rows) {
    const run = await tx.objectStore(STORE.runs).get(row.run_id);
    if (run && !EXCLUDED_FROM_COMPARISON.has(run.sync.state)) eligible.push(row);
  }
  await tx.done;
  return eligible;
}

/** One distinct stock identity (`identity_key`) and every eligible-run occurrence of it —
 * exactly the shape Step 5B's stock picker and comparison view need, built from the existing
 * derived index rather than a second identity-matching implementation. */
export interface ComparisonIdentityGroup {
  identity_key: string;
  match_method: 'isin' | 'nse_code_provisional';
  normalized_isin: string | null;
  normalized_nse_code: string | null;
  /** Every occurrence (one per row that matched this identity) across every currently-eligible
   * run, in no particular order — callers needing a specific run's occurrence look it up by
   * `run_id`. Never mutated or persisted; rebuilt fresh on every call. */
  records: ComparisonIdentityRecord[];
}

/**
 * Enumerates every distinct stock identity with at least one occurrence in a currently-eligible
 * run (Step 5B's stock picker: "build from the existing rebuildable `comparison_identity`
 * index, not from stock names"). Same eligible-run state filter, same one-transaction snapshot,
 * and the same "never delete or mutate index rows" posture as `queryComparisonIndexByIdentity`/
 * `findIdentityConflicts` — a run that later moves out of `conflict`/`quarantined`/
 * `unsupported_schema` reappears here on the next call with no rebuild, and one that moves into
 * one of those states disappears the same way.
 */
export async function listComparisonIdentityGroups(
  db: N200Database,
): Promise<ComparisonIdentityGroup[]> {
  const tx = db.transaction([STORE.comparisonIdentity, STORE.runs], 'readonly');
  const allRows = await tx.objectStore(STORE.comparisonIdentity).getAll();
  const eligible: ComparisonIdentityRecord[] = [];
  for (const row of allRows) {
    const run = await tx.objectStore(STORE.runs).get(row.run_id);
    if (run && !EXCLUDED_FROM_COMPARISON.has(run.sync.state)) eligible.push(row);
  }
  await tx.done;

  const byKey = new Map<string, ComparisonIdentityGroup>();
  for (const row of eligible) {
    const existing = byKey.get(row.identity_key);
    if (existing) {
      existing.records.push(row);
    } else {
      byKey.set(row.identity_key, {
        identity_key: row.identity_key,
        match_method: row.match_method,
        normalized_isin: row.normalized_isin,
        normalized_nse_code: row.normalized_nse_code,
        records: [row],
      });
    }
  }
  return [...byKey.values()];
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
  // Same single-transaction, same state filter as queryComparisonIndexByIdentity (security
  // review P1-C) — this feeds a "surface for review" decision, so it must never leak rows
  // belonging to a run this app isn't currently treating as active/resolvable.
  const tx = db.transaction([STORE.comparisonIdentity, STORE.runs], 'readonly');
  const allRows = await tx.objectStore(STORE.comparisonIdentity).getAll();
  const rows: ComparisonIdentityRecord[] = [];
  for (const row of allRows) {
    const run = await tx.objectStore(STORE.runs).get(row.run_id);
    if (run && !EXCLUDED_FROM_COMPARISON.has(run.sync.state)) rows.push(row);
  }
  await tx.done;

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
