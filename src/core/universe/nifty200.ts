import { normalizeHeaderKey } from '../csv/headers';
import { parseCsvBytes } from '../csv/parse';
import type { ProjectedRow } from '../display/runRows';

export const NIFTY_200_CONSTITUENTS_URL =
  'https://www.niftyindices.com/IndexConstituent/ind_nifty200list.csv';

export interface Nifty200Constituent {
  symbol: string;
  isin: string;
}

export type Nifty200ListResult =
  { ok: true; constituents: Nifty200Constituent[] } | { ok: false; message: string };

export interface FetchNifty200ConstituentsOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export interface Nifty200Verification {
  sourceUrl: string;
  checkedAt: string;
  constituentCount: number;
  runRows: number;
  matchedRows: number;
  missingRows: {
    position: number;
    identity: string;
  }[];
  unverifiedRows: {
    position: number;
    reason: string;
  }[];
}

function columnIndex(headers: readonly string[], aliases: readonly string[]): number | null {
  const normalized = headers.map(normalizeHeaderKey);
  for (const alias of aliases) {
    const index = normalized.indexOf(alias);
    if (index >= 0) return index;
  }
  return null;
}

export function parseNifty200Constituents(bytes: Uint8Array): Nifty200ListResult {
  const parsed = parseCsvBytes(bytes);
  if (!parsed.ok) return { ok: false, message: 'The NSE Nifty 200 list could not be parsed.' };
  const csv = parsed.value;
  const symbolIndex = columnIndex(csv.headers, ['symbol']);
  const isinIndex = columnIndex(csv.headers, ['isin code', 'isin']);
  if (symbolIndex === null || isinIndex === null) {
    return { ok: false, message: 'The NSE Nifty 200 list did not contain Symbol and ISIN Code.' };
  }
  const constituents = csv.rows.flatMap((row) => {
    const symbol = row[symbolIndex]?.trim().toUpperCase() ?? '';
    const isin = row[isinIndex]?.trim().toUpperCase() ?? '';
    return symbol !== '' || isin !== '' ? [{ symbol, isin }] : [];
  });
  return { ok: true, constituents };
}

export async function fetchNifty200Constituents(
  options: FetchNifty200ConstituentsOptions = {},
): Promise<Nifty200ListResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15000;
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchFn(NIFTY_200_CONSTITUENTS_URL, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        ok: false,
        message: `The NSE Nifty 200 list returned HTTP ${String(response.status)}.`,
      };
    }
    return parseNifty200Constituents(new Uint8Array(await response.arrayBuffer()));
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      return {
        ok: false,
        message: 'The NSE Nifty 200 list did not respond in time. Try again later.',
      };
    }
    return {
      ok: false,
      message: 'The NSE Nifty 200 list could not be fetched. Check the network and try again.',
    };
  } finally {
    clearTimeout(timeout);
  }
}

function rowIdentity(row: ProjectedRow): string {
  if (row.identity.normalized_isin !== null) return `ISIN ${row.identity.normalized_isin}`;
  if (row.identity.normalized_nse_code !== null) return `NSE ${row.identity.normalized_nse_code}`;
  return 'No ISIN/NSE code';
}

export function verifyRowsAgainstNifty200(
  rows: readonly ProjectedRow[],
  constituents: readonly Nifty200Constituent[],
  checkedAt = new Date().toISOString(),
): Nifty200Verification {
  const isins = new Set(constituents.map((c) => c.isin).filter((v) => v !== ''));
  const symbols = new Set(constituents.map((c) => c.symbol).filter((v) => v !== ''));
  const missingRows: Nifty200Verification['missingRows'] = [];
  const unverifiedRows: Nifty200Verification['unverifiedRows'] = [];
  let matchedRows = 0;

  rows.forEach((row) => {
    const isin = row.identity.normalized_isin;
    const nse = row.identity.normalized_nse_code;
    if (isin !== null && isins.has(isin)) {
      matchedRows += 1;
      return;
    }
    if (nse !== null && symbols.has(nse)) {
      matchedRows += 1;
      return;
    }
    if (isin === null && nse === null) {
      unverifiedRows.push({
        position: row.position + 1,
        reason: 'No valid ISIN or NSE Code in this row.',
      });
      return;
    }
    missingRows.push({ position: row.position + 1, identity: rowIdentity(row) });
  });

  return {
    sourceUrl: NIFTY_200_CONSTITUENTS_URL,
    checkedAt,
    constituentCount: constituents.length,
    runRows: rows.length,
    matchedRows,
    missingRows,
    unverifiedRows,
  };
}
