import { describe, expect, it } from 'vitest';
import { analyzeMultipartParts, type MultipartPartInput } from '../../src/core/csv/multipart';
import { buildCsv, SYNTHETIC_HEADER, synthetic } from '../helpers';
import { verifiedSample, sampleExists } from '../helpers';

const P1 = 'Nifty200 All_September 27, 2026.csv';
const P2 = 'Nifty200 All_September 27, 2026 (1).csv';
const realSamplesAvailable = sampleExists(P1) && sampleExists(P2);

function part(bytes: Uint8Array, filename: string): MultipartPartInput {
  return { bytes, filename, mimeType: 'text/csv' };
}

describe.skipIf(!realSamplesAvailable)('analyzeMultipartParts: real disjoint 100-row pages', () => {
  it('combines two disjoint 100-row pages into one 200 unique-stock run, source order then row order', () => {
    const result = analyzeMultipartParts([
      part(verifiedSample(P1), P1),
      part(verifiedSample(P2), P2),
    ]);
    if (!result.ok) throw new Error('expected ok: true');
    expect(result.canConfirm).toBe(true);
    expect(result.overlapErrors).toEqual([]);
    expect(result.uniqueStockCount).toBe(200);
    expect(result.combinedRows).toHaveLength(200);
    expect(result.warnings).toEqual([]);

    // Source order, then row order within each source: first 100 rows are all sourceIndex 0.
    expect(result.combinedRows.slice(0, 100).every((r) => r.sourceIndex === 0)).toBe(true);
    expect(result.combinedRows.slice(100).every((r) => r.sourceIndex === 1)).toBe(true);
    expect(result.combinedRows.slice(0, 100).map((r) => r.sourceRowIndex)).toEqual(
      Array.from({ length: 100 }, (_, i) => i),
    );
  });

  it('reversed selection order flips which part is sourceIndex 0, but stays disjoint/200/unblocked', () => {
    const result = analyzeMultipartParts([
      part(verifiedSample(P2), P2),
      part(verifiedSample(P1), P1),
    ]);
    if (!result.ok) throw new Error('expected ok: true');
    expect(result.canConfirm).toBe(true);
    expect(result.uniqueStockCount).toBe(200);
    expect(result.combinedRows.slice(0, 100).every((r) => r.sourceIndex === 0)).toBe(true);
  });
});

describe('analyzeMultipartParts: one blocked part rejects the whole preview', () => {
  it('a per-part blocking error (missing numerator) makes the whole multipart analysis ok: false', () => {
    const good = buildCsv([
      SYNTHETIC_HEADER,
      ['1', 'A', '', '1500', '1000', 'AAA', 'ZZSYNTH00015'],
    ]);
    const badFixture = synthetic('SYNTHETIC_missing_numerator_column.csv');
    const result = analyzeMultipartParts([part(good, 'good.csv'), part(badFixture, 'bad.csv')]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.parts[0]?.analysis.ok).toBe(true);
      expect(result.parts[1]?.analysis.ok).toBe(true);
      if (result.parts[1]?.analysis.ok) expect(result.parts[1].analysis.canConfirm).toBe(false);
    }
  });

  it('a parse-level failure in one part also rejects the whole preview', () => {
    const good = buildCsv([
      SYNTHETIC_HEADER,
      ['1', 'A', '', '1500', '1000', 'AAA', 'ZZSYNTH00015'],
    ]);
    const empty = new Uint8Array(0);
    const result = analyzeMultipartParts([part(good, 'good.csv'), part(empty, 'empty.csv')]);
    expect(result.ok).toBe(false);
  });
});

describe('analyzeMultipartParts: differing headers across parts', () => {
  it('each part maps its own headers independently even when column order differs', () => {
    // Same field names, different physical column order, both individually valid.
    const headerA = SYNTHETIC_HEADER;
    const headerB = [
      'ISIN',
      'NSE Code',
      'Consolidated 30D average end of day Vol ',
      'Consolidated end of day Vol ',
      'VolumeRatio',
      'Stock',
      'Sl No',
    ];
    const rowsA = buildCsv([headerA, ['1', 'Alpha', '', '1500', '1000', 'AAA', 'ZZSYNTH00015']]);
    const rowsB = buildCsv([headerB, ['ZZSYNTH00023', 'BBB', '1000', '1500', '', 'Beta', '2']]);
    const result = analyzeMultipartParts([part(rowsA, 'a.csv'), part(rowsB, 'b.csv')]);
    if (!result.ok) throw new Error('expected ok: true');
    expect(result.canConfirm).toBe(true);
    expect(result.combinedRows).toHaveLength(2);
    expect(result.combinedRows.every((r) => r.identity.match_method === 'isin')).toBe(true);
  });
});

describe('analyzeMultipartParts: blocking cross-part identity conflicts', () => {
  const rowWith = (sl: string, name: string, isin: string, nse: string): string[] => [
    sl,
    name,
    '',
    '1500',
    '1000',
    nse,
    isin,
  ];

  it('blocks when the same valid ISIN appears in two different parts (overlapping parts)', () => {
    const a = buildCsv([SYNTHETIC_HEADER, rowWith('1', 'Alpha', 'ZZSYNTH00015', 'AAA')]);
    const b = buildCsv([SYNTHETIC_HEADER, rowWith('1', 'Alpha', 'ZZSYNTH00015', 'AAA')]);
    const result = analyzeMultipartParts([part(a, 'a.csv'), part(b, 'b.csv')], {
      expectedUniqueStockCount: 200,
    });
    if (!result.ok)
      throw new Error('expected ok: true (blocking is via overlapErrors, not per-part)');
    expect(result.canConfirm).toBe(false);
    expect(result.overlapErrors).toContainEqual(
      expect.objectContaining({ code: 'DUPLICATE_ISIN_ACROSS_PARTS' }),
    );
  });

  it('blocks "same NSE Code, different valid ISIN"', () => {
    const a = buildCsv([SYNTHETIC_HEADER, rowWith('1', 'Alpha', 'ZZSYNTH00015', 'SHARED')]);
    const b = buildCsv([SYNTHETIC_HEADER, rowWith('1', 'Beta', 'ZZSYNTH00023', 'SHARED')]);
    const result = analyzeMultipartParts([part(a, 'a.csv'), part(b, 'b.csv')], {
      expectedUniqueStockCount: 200,
    });
    if (!result.ok) throw new Error('expected ok: true');
    expect(result.canConfirm).toBe(false);
    expect(result.overlapErrors).toContainEqual(
      expect.objectContaining({ code: 'SAME_NSE_CODE_DIFFERENT_ISIN' }),
    );
  });

  it('blocks as ambiguous when NSE Code is the only usable identifier and repeats across parts', () => {
    const a = buildCsv([SYNTHETIC_HEADER, rowWith('1', 'Alpha', '', 'ONLYNSE')]);
    const b = buildCsv([SYNTHETIC_HEADER, rowWith('1', 'Beta', '', 'ONLYNSE')]);
    const result = analyzeMultipartParts([part(a, 'a.csv'), part(b, 'b.csv')], {
      expectedUniqueStockCount: 200,
    });
    if (!result.ok) throw new Error('expected ok: true');
    expect(result.canConfirm).toBe(false);
    expect(result.overlapErrors).toContainEqual(
      expect.objectContaining({ code: 'AMBIGUOUS_NSE_CODE_ACROSS_PARTS' }),
    );
  });

  it('does not block a within-part duplicate ISIN (same part twice) — only cross-part duplicates block', () => {
    const a = buildCsv([
      SYNTHETIC_HEADER,
      rowWith('1', 'Alpha', 'ZZSYNTH00015', 'AAA'),
      rowWith('2', 'Alpha again', 'ZZSYNTH00015', 'AAA'),
    ]);
    const b = buildCsv([SYNTHETIC_HEADER, rowWith('1', 'Beta', 'ZZSYNTH00023', 'BBB')]);
    const result = analyzeMultipartParts([part(a, 'a.csv'), part(b, 'b.csv')], {
      expectedUniqueStockCount: 200,
    });
    if (!result.ok) throw new Error('expected ok: true');
    expect(result.overlapErrors).toEqual([]);
    expect(result.canConfirm).toBe(true);
  });
});

describe('analyzeMultipartParts: non-200 combined count warning', () => {
  it('warns (non-blocking) when the combined unique count is not exactly 200', () => {
    const a = buildCsv([
      SYNTHETIC_HEADER,
      ['1', 'Alpha', '', '1500', '1000', 'AAA', 'ZZSYNTH00015'],
    ]);
    const b = buildCsv([
      SYNTHETIC_HEADER,
      ['1', 'Beta', '', '1500', '1000', 'BBB', 'ZZSYNTH00023'],
    ]);
    const result = analyzeMultipartParts([part(a, 'a.csv'), part(b, 'b.csv')], {
      expectedUniqueStockCount: 200,
    });
    if (!result.ok) throw new Error('expected ok: true');
    expect(result.canConfirm).toBe(true); // non-blocking
    expect(result.warnings).toContainEqual({ code: 'COMBINED_COUNT_NOT_200', uniqueStockCount: 2 });
  });
});
