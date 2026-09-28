import { describe, expect, it } from 'vitest';
import {
  dateSortValue,
  decimalStringSortValue,
  detectColumnKind,
  numericSortValue,
  sortByColumn,
  textSortValue,
} from '../../src/core/display/sorting';

interface Row {
  position: number;
  value: string | undefined;
}

function row(position: number, value: string | undefined): Row {
  return { position, value };
}

function sortText(rows: Row[], direction: 'asc' | 'desc'): (string | undefined)[] {
  return sortByColumn(
    rows,
    (r) => textSortValue(r.value),
    (r) => r.position,
    direction,
  ).map((r) => r.value);
}

function sortNumeric(rows: Row[], direction: 'asc' | 'desc'): (string | undefined)[] {
  return sortByColumn(
    rows,
    (r) => numericSortValue(r.value),
    (r) => r.position,
    direction,
  ).map((r) => r.value);
}

function sortDecimal(rows: Row[], direction: 'asc' | 'desc'): (string | undefined)[] {
  return sortByColumn(
    rows,
    (r) => (r.value === undefined ? { kind: 'missing' } : decimalStringSortValue(r.value)),
    (r) => r.position,
    direction,
  ).map((r) => r.value);
}

describe('sortByColumn: numeric, never lexicographic', () => {
  it('orders "2.000" < "9.000" < "10.000" ascending, never lexicographically', () => {
    const rows = [row(0, '10.000'), row(1, '2.000'), row(2, '9.000')];
    expect(sortDecimal(rows, 'asc')).toEqual(['2.000', '9.000', '10.000']);
  });

  it('reverses cleanly descending', () => {
    const rows = [row(0, '10.000'), row(1, '2.000'), row(2, '9.000')];
    expect(sortDecimal(rows, 'desc')).toEqual(['10.000', '9.000', '2.000']);
  });

  it('does not use native binary floating point: string-unequal, numerically-equal values compare equal', () => {
    // "1.10" and "1.1" would already be equal under both float and decimal comparison, so
    // instead prove decimal correctness where naive string comparison would get it wrong:
    // "1.9" is lexicographically before "1.10" ("1" < "9" at the second char), but numerically
    // 1.10 < 1.9. Only a real decimal comparator (Big.js, not string or float trickery) gets
    // this right.
    const rows = [row(0, '1.9'), row(1, '1.10'), row(2, '1.2')];
    expect(sortNumeric(rows, 'asc')).toEqual(['1.10', '1.2', '1.9']);
  });

  it('treats provider text under the A3/G1 grammar: grammar-invalid text sorts as missing (last)', () => {
    const rows = [row(0, '3.06'), row(1, 'n/a'), row(2, '1.25')];
    expect(sortNumeric(rows, 'asc')).toEqual(['1.25', '3.06', 'n/a']);
    expect(sortNumeric(rows, 'desc')).toEqual(['3.06', '1.25', 'n/a']);
  });

  it('rejects grouping commas exactly like the frozen numeric grammar (not numeric, sorts last)', () => {
    const rows = [row(0, '1,234,567'), row(1, '999')];
    expect(sortNumeric(rows, 'asc')).toEqual(['999', '1,234,567']);
  });
});

describe('sortByColumn: text, case-insensitive, S3-normalized', () => {
  it('sorts case-insensitively', () => {
    const rows = [row(0, 'zebra'), row(1, 'Apple'), row(2, 'banana')];
    expect(sortText(rows, 'asc')).toEqual(['Apple', 'banana', 'zebra']);
  });

  it('normalizes whitespace before comparing (S3)', () => {
    const rows = [row(0, '  Beta   Corp  '), row(1, 'Alpha Corp')];
    expect(sortText(rows, 'asc')).toEqual(['Alpha Corp', '  Beta   Corp  ']);
  });
});

describe('sortByColumn: dates, chronological', () => {
  function sortDates(
    values: (string | undefined)[],
    direction: 'asc' | 'desc',
  ): (string | undefined)[] {
    const rows = values.map((v, i) => row(i, v));
    return sortByColumn(
      rows,
      (r) => dateSortValue(r.value),
      (r) => r.position,
      direction,
    ).map((r) => r.value);
  }

  it('orders ISO dates chronologically, not lexicographically equivalent-but-different formats', () => {
    expect(sortDates(['2026-03-01', '2026-01-15', '2026-02-20'], 'asc')).toEqual([
      '2026-01-15',
      '2026-02-20',
      '2026-03-01',
    ]);
  });

  it('orders RFC 3339 timestamps chronologically', () => {
    expect(sortDates(['2026-01-01T09:00:00.000Z', '2026-01-01T08:00:00.000Z'], 'asc')).toEqual([
      '2026-01-01T08:00:00.000Z',
      '2026-01-01T09:00:00.000Z',
    ]);
  });
});

describe('sortByColumn: missing/invalid always sort last, both directions', () => {
  it('numeric: blank and undefined cells sort last ascending and descending', () => {
    const rows = [row(0, '5'), row(1, undefined), row(2, '1'), row(3, '')];
    expect(sortNumeric(rows, 'asc')).toEqual(['1', '5', undefined, '']);
    expect(sortNumeric(rows, 'desc')).toEqual(['5', '1', undefined, '']);
  });

  it('an invalid computed metric (SortValue kind "missing") sorts last both directions', () => {
    const rows: { position: number; big: string | null }[] = [
      { position: 0, big: '1.500' },
      { position: 1, big: null },
      { position: 2, big: '0.500' },
    ];
    const sort = (direction: 'asc' | 'desc') =>
      sortByColumn(
        rows,
        (r) => (r.big === null ? { kind: 'missing' } : decimalStringSortValue(r.big)),
        (r) => r.position,
        direction,
      ).map((r) => r.big);
    expect(sort('asc')).toEqual(['0.500', '1.500', null]);
    expect(sort('desc')).toEqual(['1.500', '0.500', null]);
  });
});

describe('sortByColumn: stable, deterministic row-position tiebreak', () => {
  it('preserves original relative order for equal keys, regardless of input order', () => {
    const rows = [row(0, 'same'), row(1, 'same'), row(2, 'same')];
    const sorted = sortByColumn(
      rows,
      (r) => textSortValue(r.value),
      (r) => r.position,
      'asc',
    );
    expect(sorted.map((r) => r.position)).toEqual([0, 1, 2]);
  });

  it('ties between multiple missing values also fall back to row position', () => {
    const rows = [row(0, undefined), row(1, undefined), row(2, undefined)];
    const sorted = sortByColumn(
      rows,
      (r) => textSortValue(r.value),
      (r) => r.position,
      'desc',
    );
    expect(sorted.map((r) => r.position)).toEqual([0, 1, 2]);
  });

  it('never mutates the input array', () => {
    const rows = [row(0, 'b'), row(1, 'a')];
    const original = [...rows];
    sortByColumn(
      rows,
      (r) => textSortValue(r.value),
      (r) => r.position,
      'asc',
    );
    expect(rows).toEqual(original);
  });
});

describe('detectColumnKind', () => {
  it('is numeric when every present, non-blank cell matches the frozen grammar', () => {
    expect(detectColumnKind(['1500', '', undefined, '2386852'])).toBe('numeric');
  });

  it('is text when any present, non-blank cell fails the grammar', () => {
    expect(detectColumnKind(['1500', 'Reliance', '2000'])).toBe('text');
  });

  it('is text when every cell is blank or absent (nothing to prove numeric)', () => {
    expect(detectColumnKind(['', undefined, ''])).toBe('text');
  });

  it('grouping commas make a column text, not numeric, matching the frozen A3/G1 grammar', () => {
    expect(detectColumnKind(['1,234,567', '999'])).toBe('text');
  });
});
