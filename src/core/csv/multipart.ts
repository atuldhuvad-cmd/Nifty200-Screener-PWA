import { analyzeCsvBytes, type CsvAnalysis } from './analyze';
import type { StockIdentity } from './identifiers';
import type { VolumeRatioMetric } from './volumeRatio';

/** Step 4A: Trendlyne caps a single export at 100 rows, so a run may now be built from two or
 * more explicitly selected pagination parts of the same result (amending the M1 "one CSV = one
 * run" decision). This module combines and cross-validates those parts; it never touches
 * storage or the envelope shape. */

export interface MultipartPartInput {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
}

export interface MultipartPartResult {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  analysis: CsvAnalysis;
}

export const MULTIPART_OVERLAP_CODES = [
  /** The same valid ISIN appears in more than one part — parts overlap; the user must reselect. */
  'DUPLICATE_ISIN_ACROSS_PARTS',
  /** The same NSE Code is associated with two or more distinct valid ISINs. */
  'SAME_NSE_CODE_DIFFERENT_ISIN',
  /** The same NSE Code is each row's *only* usable identifier, in more than one part — treated
   * as ambiguous rather than silently deduplicated. */
  'AMBIGUOUS_NSE_CODE_ACROSS_PARTS',
] as const;
export type MultipartOverlapCode = (typeof MULTIPART_OVERLAP_CODES)[number];

/** Blocking: any of these prevents confirmation, same as a per-part blocking error. */
export interface MultipartOverlapError {
  code: MultipartOverlapCode;
  /** Positions in `combinedRows` involved in this conflict. */
  rows: number[];
}

export const MULTIPART_WARNING_CODES = [
  /** Non-blocking; requires explicit confirmation. Index constituents can legitimately differ
   * from 200 temporarily, so this never blocks by itself. */
  'COMBINED_COUNT_NOT_200',
] as const;
export type MultipartWarningCode = (typeof MULTIPART_WARNING_CODES)[number];

export interface MultipartWarning {
  code: MultipartWarningCode;
  uniqueStockCount: number;
}

export interface MultipartAnalysisOptions {
  expectedUniqueStockCount?: number;
}

export interface CombinedRowAnalysis {
  sourceIndex: number;
  sourceRowIndex: number;
  identity: StockIdentity;
  volumeRatio: VolumeRatioMetric;
}

export type MultipartAnalysis =
  /** At least one part failed to parse or has a blocking header/mapping error: the whole
   * multipart preview is rejected and nothing downstream (combination, overlap checks) runs. */
  | { ok: false; parts: MultipartPartResult[] }
  | {
      ok: true;
      parts: MultipartPartResult[];
      /** Source order, then row order within each source — never reordered or deduplicated. */
      combinedRows: CombinedRowAnalysis[];
      uniqueStockCount: number;
      overlapErrors: MultipartOverlapError[];
      warnings: MultipartWarning[];
      /** `overlapErrors.length === 0`. Every individual part already satisfied its own
       * `canConfirm` for `ok: true` to be reachable at all. */
      canConfirm: boolean;
    };

interface FlatRow extends CombinedRowAnalysis {
  index: number;
}

function groupBy<T, K>(items: T[], key: (item: T) => K | null): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === null) continue;
    const group = map.get(k);
    if (group) group.push(item);
    else map.set(k, [item]);
  }
  return map;
}

export function analyzeMultipartParts(
  inputs: MultipartPartInput[],
  options: MultipartAnalysisOptions = {},
): MultipartAnalysis {
  const parts: MultipartPartResult[] = inputs.map((input) => ({
    filename: input.filename,
    mimeType: input.mimeType,
    bytes: input.bytes,
    analysis: analyzeCsvBytes(input.bytes),
  }));

  const allConfirmable = parts.every((p) => p.analysis.ok && p.analysis.canConfirm);
  if (!allConfirmable) return { ok: false, parts };

  const combined: FlatRow[] = [];
  parts.forEach((part, sourceIndex) => {
    if (!part.analysis.ok || !part.analysis.canConfirm) return; // re-narrows for TS; already checked above
    part.analysis.rows.forEach((r, sourceRowIndex) => {
      combined.push({
        index: combined.length,
        sourceIndex,
        sourceRowIndex,
        identity: r.identity,
        volumeRatio: r.volumeRatio,
      });
    });
  });

  const overlapErrors: MultipartOverlapError[] = [];

  const byValidIsin = groupBy(combined, (r) =>
    r.identity.isin_validation === 'valid' ? r.identity.normalized_isin : null,
  );
  for (const group of byValidIsin.values()) {
    const distinctParts = new Set(group.map((r) => r.sourceIndex));
    if (distinctParts.size >= 2) {
      overlapErrors.push({ code: 'DUPLICATE_ISIN_ACROSS_PARTS', rows: group.map((r) => r.index) });
    }
  }

  const byNseCode = groupBy(combined, (r) => r.identity.normalized_nse_code);
  for (const group of byNseCode.values()) {
    const distinctValidIsins = new Set(
      group
        .filter((r) => r.identity.isin_validation === 'valid')
        .map((r) => r.identity.normalized_isin),
    );
    if (distinctValidIsins.size >= 2) {
      overlapErrors.push({
        code: 'SAME_NSE_CODE_DIFFERENT_ISIN',
        rows: group.map((r) => r.index),
      });
    }
  }

  const byProvisionalNseCode = groupBy(
    combined.filter((r) => r.identity.match_method === 'nse_code_provisional'),
    (r) => r.identity.normalized_nse_code,
  );
  for (const group of byProvisionalNseCode.values()) {
    const distinctParts = new Set(group.map((r) => r.sourceIndex));
    if (distinctParts.size >= 2) {
      overlapErrors.push({
        code: 'AMBIGUOUS_NSE_CODE_ACROSS_PARTS',
        rows: group.map((r) => r.index),
      });
    }
  }

  const identityKeys = new Set<string>();
  for (const r of combined) {
    if (r.identity.match_method === 'isin' && r.identity.normalized_isin !== null) {
      identityKeys.add(`isin:${r.identity.normalized_isin}`);
    } else if (
      r.identity.match_method === 'nse_code_provisional' &&
      r.identity.normalized_nse_code !== null
    ) {
      identityKeys.add(`nse:${r.identity.normalized_nse_code}`);
    }
  }
  const uniqueStockCount = identityKeys.size;

  const warnings: MultipartWarning[] = [];
  if (
    options.expectedUniqueStockCount !== undefined &&
    uniqueStockCount !== options.expectedUniqueStockCount
  ) {
    warnings.push({ code: 'COMBINED_COUNT_NOT_200', uniqueStockCount });
  }

  const combinedRows: CombinedRowAnalysis[] = combined.map(
    ({ sourceIndex, sourceRowIndex, identity, volumeRatio }) => ({
      sourceIndex,
      sourceRowIndex,
      identity,
      volumeRatio,
    }),
  );

  return {
    ok: true,
    parts,
    combinedRows,
    uniqueStockCount,
    overlapErrors,
    warnings,
    canConfirm: overlapErrors.length === 0,
  };
}
