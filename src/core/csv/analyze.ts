import Big from 'big.js';
import { mapColumns, type ColumnMapping } from './headers';
import { buildStockIdentity, type StockIdentity } from './identifiers';
import { parseNumericCell } from './numeric';
import { parseCsvBytes, type ParsedCsv } from './parse';
import type { FieldKey, ImportError, ImportWarning, PartialPageReason } from './types';
import { computeVolumeRatio, volumeRatioAtScale2, type VolumeRatioMetric } from './volumeRatio';

/** M1: typical Trendlyne page sizes that suggest a single page of a larger result. */
export const PAGE_SIZE_ROW_COUNTS: readonly number[] = [25, 50, 100];

export interface RowAnalysis {
  identity: StockIdentity;
  volumeRatio: VolumeRatioMetric;
}

export type CsvAnalysis =
  | { ok: false; errors: ImportError[] }
  | {
      ok: true;
      parsed: ParsedCsv;
      mapping: ColumnMapping;
      /** Empty when `blockingErrors` is non-empty. Index-aligned with `parsed.rows` otherwise. */
      rows: RowAnalysis[];
      warnings: ImportWarning[];
      blockingErrors: ImportError[];
      canConfirm: boolean;
    };

export function analyzeCsvBytes(bytes: Uint8Array): CsvAnalysis {
  const parsed = parseCsvBytes(bytes);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const csv = parsed.value;
  const mapping = mapColumns(csv.headers);
  const warnings: ImportWarning[] = [...parsed.warnings, ...mapping.warnings];

  const partial = partialPageReasons(csv, mapping);
  if (partial.length > 0) warnings.push({ code: 'POSSIBLE_PARTIAL_PAGE', reasons: partial });

  if (mapping.errors.length > 0) {
    return {
      ok: true,
      parsed: csv,
      mapping,
      rows: [],
      warnings,
      blockingErrors: mapping.errors,
      canConfirm: false,
    };
  }

  const cell = (row: string[], field: FieldKey): string => {
    const i = mapping.columns[field];
    return i === undefined ? '' : (row[i] ?? '');
  };

  const rows: RowAnalysis[] = csv.rows.map((row) => ({
    identity: buildStockIdentity(cell(row, 'isin'), cell(row, 'nseCode')),
    volumeRatio: computeVolumeRatio(cell(row, 'volumeNumerator'), cell(row, 'volumeDenominator')),
  }));

  warnings.push(...identityWarnings(rows));

  if (mapping.columns.providerVolumeRatio !== undefined) {
    const mismatched = csv.rows.flatMap((row, i) =>
      providerMismatch(
        cell(row, 'volumeNumerator'),
        cell(row, 'volumeDenominator'),
        cell(row, 'providerVolumeRatio'),
      )
        ? [i]
        : [],
    );
    if (mismatched.length > 0) {
      warnings.push({ code: 'PROVIDER_VOLUME_RATIO_MISMATCH', rows: mismatched });
    }
  }

  return { ok: true, parsed: csv, mapping, rows, warnings, blockingErrors: [], canConfirm: true };
}

function partialPageReasons(csv: ParsedCsv, mapping: ColumnMapping): PartialPageReason[] {
  const reasons: PartialPageReason[] = [];
  if (PAGE_SIZE_ROW_COUNTS.includes(csv.rows.length)) reasons.push('row_count_page_size');
  const slCol = mapping.columns.serialNumber;
  const first = csv.rows[0];
  if (slCol !== undefined && first !== undefined) {
    const sl = parseNumericCell(first[slCol] ?? '');
    if (sl.kind !== 'valid' || !new Big(sl.text).eq(1)) {
      reasons.push('serial_number_not_starting_at_1');
    }
  }
  return reasons;
}

/** S2: non-blocking; true only when both values are comparable and differ at 2 dp. */
function providerMismatch(numerator: string, denominator: string, provider: string): boolean {
  const app = volumeRatioAtScale2(numerator, denominator);
  const p = parseNumericCell(provider);
  if (app === null || p.kind !== 'valid') return false;
  return !app.eq(new Big(p.text));
}

function identityWarnings(rows: RowAnalysis[]): ImportWarning[] {
  const out: ImportWarning[] = [];
  const dupes = (key: (r: RowAnalysis) => string | null): number[] => {
    const seen = new Map<string, number[]>();
    rows.forEach((r, i) => {
      const k = key(r);
      if (k !== null) seen.set(k, [...(seen.get(k) ?? []), i]);
    });
    return [...seen.values()].filter((v) => v.length > 1).flat();
  };

  const dupIsin = dupes((r) =>
    r.identity.isin_validation === 'valid' ? r.identity.normalized_isin : null,
  );
  if (dupIsin.length > 0) out.push({ code: 'DUPLICATE_ISIN_IN_RUN', rows: dupIsin });

  const dupNse = dupes((r) =>
    r.identity.nse_code_validation === 'valid' ? r.identity.normalized_nse_code : null,
  );
  if (dupNse.length > 0) out.push({ code: 'DUPLICATE_NSE_CODE_IN_RUN', rows: dupNse });

  const excluded = rows.flatMap((r, i) => (r.identity.match_method === null ? [i] : []));
  if (excluded.length > 0) out.push({ code: 'ROWS_EXCLUDED_FROM_COMPARISON', rows: excluded });

  return out;
}
