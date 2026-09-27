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
    if (identity.match_method === 'isin' && identity.normalized_isin !== null) {
      rows.push({
        run_id: runId,
        row_index: rowIndex,
        match_method: 'isin',
        identity_key: identityKeyFor('isin', identity.normalized_isin),
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

export async function queryComparisonIndexByIdentity(
  db: N200Database,
  identityKey: string,
): Promise<ComparisonIdentityRecord[]> {
  return db.getAllFromIndex(STORE.comparisonIdentity, COMPARISON_BY_IDENTITY_KEY, identityKey);
}

export function isinIdentityKey(normalizedIsin: string): string {
  return identityKeyFor('isin', normalizedIsin);
}

export function nseIdentityKey(normalizedNseCode: string): string {
  return identityKeyFor('nse_code_provisional', normalizedNseCode);
}
