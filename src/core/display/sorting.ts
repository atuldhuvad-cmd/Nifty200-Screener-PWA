import Big from 'big.js';
import { NUMERIC_GRAMMAR } from '../csv/numeric';
import { normalizeForDisplay } from './normalizeForDisplay';

export type SortDirection = 'asc' | 'desc';

/**
 * A column's typed sort key. `missing` covers both "no value" and "value present but not
 * comparable under this column's type" (e.g. an invalid computed metric, or provider text that
 * doesn't match the numeric grammar) — both always sort last, in both directions (brief:
 * "Missing/invalid values sort last").
 */
export type SortValue =
  | { kind: 'missing' }
  | { kind: 'numeric'; big: Big }
  | { kind: 'text'; key: string }
  | { kind: 'date'; time: number };

// Isolated instance so DP/RM settings never leak to or from any other Big user (same pattern as
// volumeRatio.ts's Scale3/Scale2) — comparison only, no rounding is ever applied here.
const Compare = Big();

/** A raw cell parsed under the frozen A3/G1 numeric grammar — never native binary floating
 * point. Blank or grammar-invalid text is `missing`, not a comparison failure. */
export function numericSortValue(raw: string | undefined): SortValue {
  if (raw === undefined || raw === '' || !NUMERIC_GRAMMAR.test(raw)) return { kind: 'missing' };
  return { kind: 'numeric', big: new Compare(raw) };
}

/** For an already-validated decimal string (e.g. `volume_ratio_v1`'s `value`), which is always
 * grammar-valid by construction — kept separate so callers never re-run a redundant grammar
 * check against a value this app itself computed and formatted. */
export function decimalStringSortValue(value: string): SortValue {
  return { kind: 'numeric', big: new Compare(value) };
}

/** S3 display normalization (trim/collapse), then case-insensitive. Blank-after-normalization
 * is `missing`, matching how a genuinely empty cell has nothing to sort by. */
export function textSortValue(raw: string | undefined): SortValue {
  if (raw === undefined) return { kind: 'missing' };
  const normalized = normalizeForDisplay(raw);
  return normalized === '' ? { kind: 'missing' } : { kind: 'text', key: normalized.toLowerCase() };
}

/** ISO 8601 / RFC 3339 chronological ordering (`effective_date`, `imported_at`). */
export function dateSortValue(iso: string | undefined): SortValue {
  if (iso === undefined || iso === '') return { kind: 'missing' };
  const time = Date.parse(iso);
  return Number.isNaN(time) ? { kind: 'missing' } : { kind: 'date', time };
}

function compareValues(a: SortValue, b: SortValue): number {
  if (a.kind === 'numeric' && b.kind === 'numeric') return a.big.cmp(b.big);
  if (a.kind === 'text' && b.kind === 'text') return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  if (a.kind === 'date' && b.kind === 'date') return a.time - b.time;
  // Mismatched non-missing kinds never occur within one column in practice (a column's values
  // are all produced by the same extractor); treated as equal rather than throwing.
  return 0;
}

/**
 * Generic typed column sort. Missing/invalid values always sort last in both directions —
 * independent of `direction`, so flipping ascending/descending never pulls them to the top.
 * Present values compare by their typed kind; equal keys (including all-missing pairs) fall
 * back to `getPosition`, the original row position, so the sort is stable and deterministic
 * across repeated calls. Never mutates `rows` or any cell it reads from.
 */
export function sortByColumn<T>(
  rows: readonly T[],
  getValue: (row: T) => SortValue,
  getPosition: (row: T) => number,
  direction: SortDirection,
): T[] {
  return [...rows].sort((rowA, rowB) => {
    const a = getValue(rowA);
    const b = getValue(rowB);
    const aMissing = a.kind === 'missing';
    const bMissing = b.kind === 'missing';
    if (aMissing || bMissing) {
      if (aMissing && bMissing) return getPosition(rowA) - getPosition(rowB);
      return aMissing ? 1 : -1;
    }
    const cmp = compareValues(a, b);
    if (cmp !== 0) return direction === 'asc' ? cmp : -cmp;
    return getPosition(rowA) - getPosition(rowB);
  });
}

export type ColumnKind = 'numeric' | 'text';

/**
 * Whether a raw data column should sort numerically: every present, non-blank cell in it must
 * match the frozen A3/G1 numeric grammar (the same test `numericSortValue` applies). A column
 * with no present values, or any non-numeric present value, sorts as text — never a guess.
 */
export function detectColumnKind(cells: readonly (string | undefined)[]): ColumnKind {
  let sawNumeric = false;
  for (const cell of cells) {
    if (cell === undefined || cell === '') continue;
    if (!NUMERIC_GRAMMAR.test(cell)) return 'text';
    sawNumeric = true;
  }
  return sawNumeric ? 'numeric' : 'text';
}
