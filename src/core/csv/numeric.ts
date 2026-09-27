/** A3 grammar, frozen by G1. Raw strings are never rewritten. */
export const NUMERIC_GRAMMAR = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;

const WESTERN_GROUPED = /^-?[0-9]{1,3}(,[0-9]{3})+(\.[0-9]+)?$/;
const INDIAN_GROUPED = /^-?[0-9]{1,2}(,[0-9]{2})*,[0-9]{3}(\.[0-9]+)?$/;
const ZERO = /^-?0(\.0+)?$/;

export type NumericDetail = 'grouping_comma';

export type NumericCell =
  | { kind: 'missing' }
  | { kind: 'invalid'; detail?: NumericDetail }
  | { kind: 'valid'; text: string; isZero: boolean; isNegative: boolean };

export function parseNumericCell(raw: string): NumericCell {
  if (raw === '') return { kind: 'missing' };
  if (NUMERIC_GRAMMAR.test(raw)) {
    const isZero = ZERO.test(raw);
    // "-0" is numeric zero, not negative (A3).
    return { kind: 'valid', text: raw, isZero, isNegative: raw.startsWith('-') && !isZero };
  }
  if (WESTERN_GROUPED.test(raw) || INDIAN_GROUPED.test(raw)) {
    return { kind: 'invalid', detail: 'grouping_comma' };
  }
  return { kind: 'invalid' };
}
