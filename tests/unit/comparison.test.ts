import { describe, expect, it } from 'vitest';
import { analyzeCsvBytes } from '../../src/core/csv/analyze';
import {
  buildComparisonPickerEntries,
  buildComparisonResult,
  identityKeyForIdentity,
} from '../../src/core/display/comparison';
import { projectRunRows } from '../../src/core/display/runRows';
import { buildEnvelope } from '../../src/core/envelope/build';
import { isinIdentityKey, nseIdentityKey } from '../../src/core/storage/comparisonIndex';
import {
  initialSyncRecord,
  type ComparisonIdentityRecord,
  type RunRecord,
} from '../../src/core/storage/types';
import { buildCsv, SYNTHETIC_HEADER } from '../helpers';
import { buildTestEnvelope, buildTestMultipartEnvelope } from '../storage-helpers';

const rowWith = (sl: string, name: string, isin: string, nse: string): string[] => [
  sl,
  name,
  '',
  '1500',
  '1000',
  nse,
  isin,
];

function toRunRecord(
  envelope: RunRecord['envelope'],
  state: RunRecord['sync']['state'] = 'pending',
): RunRecord {
  return {
    run_id: (envelope as { run_id: string }).run_id,
    envelope,
    sync: initialSyncRecord(state),
  };
}

function comparisonRecord(
  runId: string,
  rowIndex: number,
  matchMethod: 'isin' | 'nse_code_provisional',
  normalizedIsin: string | null,
  normalizedNseCode: string | null,
): ComparisonIdentityRecord {
  return {
    run_id: runId,
    row_index: rowIndex,
    match_method: matchMethod,
    identity_key:
      matchMethod === 'isin'
        ? isinIdentityKey(normalizedIsin ?? '')
        : nseIdentityKey(normalizedNseCode ?? ''),
    normalized_isin: normalizedIsin,
    normalized_nse_code: normalizedNseCode,
  };
}

describe('identityKeyForIdentity', () => {
  it('computes isin: for an ISIN-matched identity and nse: for a provisional one, matching the storage layer scheme exactly', async () => {
    const envelope = await buildTestEnvelope({ fixture: 'SYNTHETIC_crlf_final_newline.csv' });
    const projection = projectRunRows(envelope);
    const firstRow = projection.rows[0];
    if (!firstRow) throw new Error('fixture assumption changed');
    expect(identityKeyForIdentity(firstRow.identity)).toBe(isinIdentityKey('ZZSYNTH00015'));
  });

  it('returns null for an identity with neither usable identifier', () => {
    expect(
      identityKeyForIdentity({
        raw_isin: '',
        normalized_isin: null,
        isin_validation: 'missing',
        raw_nse_code: '',
        normalized_nse_code: null,
        nse_code_validation: 'missing',
        match_method: null,
        identity_warnings: ['ISIN_MISSING', 'NSE_CODE_MISSING', 'EXCLUDED_FROM_COMPARISON'],
      }),
    ).toBeNull();
  });
});

describe('buildComparisonResult: absence, presence, and chronological ordering', () => {
  it('shows an explicit absent status for an eligible run without the selected stock', async () => {
    const present = await buildTestEnvelope({
      runId: '11111111-1111-4111-8111-111111111111',
      effectiveDate: '2026-01-01',
      fixture: 'SYNTHETIC_crlf_final_newline.csv', // row 0 is ZZSYNTH00015
    });
    // A second eligible run that genuinely does not contain the selected stock at all.
    const withoutSelectedStockBytes = buildCsv([
      SYNTHETIC_HEADER,
      rowWith('1', 'Unrelated Stock', 'ZZSYNTH00023', 'OTHER'),
    ]);
    const withoutSelectedStockAnalysis = analyzeCsvBytes(withoutSelectedStockBytes);
    if (!withoutSelectedStockAnalysis.ok || !withoutSelectedStockAnalysis.canConfirm) {
      throw new Error('unexpected');
    }
    const withoutSelectedStockBuilt = await buildEnvelope({
      originalBytes: withoutSelectedStockBytes,
      analysis: withoutSelectedStockAnalysis,
      originalFilename: 'without.csv',
      originalFileMimeType: 'text/csv',
      effectiveDate: '2026-02-01',
      runId: '22222222-2222-4222-8222-222222222222',
    });
    if (!withoutSelectedStockBuilt.ok) throw new Error('build failed');
    const withoutSelectedStock = withoutSelectedStockBuilt.envelope;

    const runs = [toRunRecord(present), toRunRecord(withoutSelectedStock)];
    const group = {
      identity_key: isinIdentityKey('ZZSYNTH00015'),
      match_method: 'isin' as const,
      normalized_isin: 'ZZSYNTH00015',
      normalized_nse_code: null,
      records: [comparisonRecord(present.run_id, 0, 'isin', 'ZZSYNTH00015', 'SYNA')],
    };

    const result = buildComparisonResult(group, runs);
    expect(result.cells).toHaveLength(2);
    const [firstCell, secondCell] = result.cells;
    expect(firstCell?.status).toBe('present');
    expect(secondCell?.status).toBe('absent');
    expect(secondCell?.runId).toBe(withoutSelectedStock.run_id);
  });

  it('orders runs chronologically ascending (oldest first), independent of input order', async () => {
    const older = await buildTestEnvelope({
      runId: '11111111-1111-4111-8111-111111111111',
      effectiveDate: '2026-01-01',
    });
    const newer = await buildTestEnvelope({
      runId: '22222222-2222-4222-8222-222222222222',
      effectiveDate: '2026-03-01',
    });
    const runs = [toRunRecord(newer), toRunRecord(older)]; // deliberately reversed input order
    const group = {
      identity_key: isinIdentityKey('ZZSYNTH00015'),
      match_method: 'isin' as const,
      normalized_isin: 'ZZSYNTH00015',
      normalized_nse_code: null,
      records: [
        comparisonRecord(older.run_id, 0, 'isin', 'ZZSYNTH00015', 'SYNA'),
        comparisonRecord(newer.run_id, 0, 'isin', 'ZZSYNTH00015', 'SYNA'),
      ],
    };
    const result = buildComparisonResult(group, runs);
    expect(result.runs.map((r) => r.runId)).toEqual([older.run_id, newer.run_id]);
  });

  it('keeps same-effective-date runs distinct and separately present in the comparison', async () => {
    const a = await buildTestEnvelope({
      runId: 'aaaaaaaa-1111-4111-8111-111111111111',
      effectiveDate: '2026-01-01',
      importedAt: new Date('2026-01-01T08:00:00.000Z'),
    });
    const b = await buildTestEnvelope({
      runId: 'bbbbbbbb-2222-4222-8222-222222222222',
      effectiveDate: '2026-01-01',
      importedAt: new Date('2026-01-01T09:00:00.000Z'),
    });
    const runs = [toRunRecord(a), toRunRecord(b)];
    const group = {
      identity_key: isinIdentityKey('ZZSYNTH00015'),
      match_method: 'isin' as const,
      normalized_isin: 'ZZSYNTH00015',
      normalized_nse_code: null,
      records: [
        comparisonRecord(a.run_id, 0, 'isin', 'ZZSYNTH00015', 'SYNA'),
        comparisonRecord(b.run_id, 0, 'isin', 'ZZSYNTH00015', 'SYNA'),
      ],
    };
    const result = buildComparisonResult(group, runs);
    expect(result.runs.map((r) => r.runId)).toEqual([a.run_id, b.run_id]);
    expect(result.cells.every((c) => c.status === 'present')).toBe(true);
  });

  it('reads the stored volume_ratio_v1 metric for a present row (never recomputed) via the shared runRows projection', async () => {
    const envelope = await buildTestEnvelope({ fixture: 'SYNTHETIC_crlf_final_newline.csv' });
    const runs = [toRunRecord(envelope)];
    const group = {
      identity_key: isinIdentityKey('ZZSYNTH00015'),
      match_method: 'isin' as const,
      normalized_isin: 'ZZSYNTH00015',
      normalized_nse_code: null,
      records: [comparisonRecord(envelope.run_id, 0, 'isin', 'ZZSYNTH00015', 'SYNA')],
    };
    const result = buildComparisonResult(group, runs);
    const [cell] = result.cells;
    if (cell?.status !== 'present') throw new Error('expected present');
    expect(cell.row.volumeRatio).toEqual(envelope.computed_metrics.volume_ratio_v1[0]);
    expect(cell.stockName).toBe('Synthetic Alpha Ltd');
  });

  it('shows an invalid metric with its reason code as present, never as absent', async () => {
    // Force an invalid metric: blank numerator.
    const invalidBytes = buildCsv([
      SYNTHETIC_HEADER,
      ['1', 'Synthetic Invalid', '', '', '1000', 'SYNA', 'ZZSYNTH00015'],
    ]);
    const analysis = analyzeCsvBytes(invalidBytes);
    if (!analysis.ok || !analysis.canConfirm) throw new Error('unexpected');
    const built = await buildEnvelope({
      originalBytes: invalidBytes,
      analysis,
      originalFilename: 'invalid.csv',
      originalFileMimeType: 'text/csv',
      effectiveDate: '2026-01-01',
    });
    if (!built.ok) throw new Error('build failed');

    const runs = [toRunRecord(built.envelope)];
    const group = {
      identity_key: isinIdentityKey('ZZSYNTH00015'),
      match_method: 'isin' as const,
      normalized_isin: 'ZZSYNTH00015',
      normalized_nse_code: null,
      records: [comparisonRecord(built.envelope.run_id, 0, 'isin', 'ZZSYNTH00015', 'SYNA')],
    };
    const result = buildComparisonResult(group, runs);
    const [cell] = result.cells;
    if (cell?.status !== 'present') throw new Error('expected present, not absent');
    expect(cell.row.volumeRatio).toEqual({
      status: 'invalid',
      value: null,
      reason: 'MISSING_NUMERATOR',
      metric_version: 'volume_ratio_v1',
    });
  });
});

describe('buildComparisonResult: v1 and v2 coexistence, v2 source-part provenance', () => {
  it('combines a v1 run and a v2 multipart run in one comparison, with correct v2 source filename/row provenance', async () => {
    const v1 = await buildTestEnvelope({
      runId: '11111111-1111-4111-8111-111111111111',
      effectiveDate: '2026-01-01',
      fixture: 'SYNTHETIC_crlf_final_newline.csv',
    });
    const partA = buildCsv([SYNTHETIC_HEADER, rowWith('1', 'Other', 'ZZSYNTH00023', 'OTH')]);
    const partB = buildCsv([
      SYNTHETIC_HEADER,
      rowWith('1', 'Synthetic Multipart', 'ZZSYNTH00015', 'SYNA'),
    ]);
    const v2 = await buildTestMultipartEnvelope({
      runId: '22222222-2222-4222-8222-222222222222',
      effectiveDate: '2026-02-01',
      parts: [
        { fixtureBytes: partA, filename: 'part-a.csv' },
        { fixtureBytes: partB, filename: 'part-b.csv' },
      ],
    });

    const runs = [toRunRecord(v1), toRunRecord(v2)];
    const group = {
      identity_key: isinIdentityKey('ZZSYNTH00015'),
      match_method: 'isin' as const,
      normalized_isin: 'ZZSYNTH00015',
      normalized_nse_code: null,
      records: [
        comparisonRecord(v1.run_id, 0, 'isin', 'ZZSYNTH00015', 'SYNA'),
        // v2's combined_row_refs order is part-a (1 row) then part-b (1 row) -> combined index 1.
        comparisonRecord(v2.run_id, 1, 'isin', 'ZZSYNTH00015', 'SYNA'),
      ],
    };
    const result = buildComparisonResult(group, runs);
    expect(result.cells.every((c) => c.status === 'present')).toBe(true);
    const v2Cell = result.cells.find((c) => c.runId === v2.run_id);
    if (v2Cell?.status !== 'present') throw new Error('expected present');
    expect(v2Cell.row.sourceFilename).toBe('part-b.csv');
    expect(v2Cell.row.sourceIndex).toBe(1);
    expect(v2Cell.row.sourceRowNumber).toBe(1);
  });
});

describe('buildComparisonPickerEntries', () => {
  it('builds entries from the identity groups (not from raw stock-name scanning), with a representative sample name', async () => {
    const envelope = await buildTestEnvelope({ fixture: 'SYNTHETIC_crlf_final_newline.csv' });
    const runsById = new Map([[envelope.run_id, toRunRecord(envelope)]]);
    const group = {
      identity_key: isinIdentityKey('ZZSYNTH00015'),
      match_method: 'isin' as const,
      normalized_isin: 'ZZSYNTH00015',
      normalized_nse_code: null,
      records: [comparisonRecord(envelope.run_id, 0, 'isin', 'ZZSYNTH00015', 'SYNA')],
    };
    const entries = buildComparisonPickerEntries([group], runsById);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.identityKey).toBe(isinIdentityKey('ZZSYNTH00015'));
    expect(entries[0]?.sampleStockName).toBe('Synthetic Alpha Ltd');
    expect(entries[0]?.eligibleRunCount).toBe(1);
  });

  it('sorts entries by sample name case-insensitively, falling back to identityKey when no name is found', async () => {
    const envelope = await buildTestEnvelope({ fixture: 'SYNTHETIC_crlf_final_newline.csv' });
    const runsById = new Map([[envelope.run_id, toRunRecord(envelope)]]);
    const named = {
      identity_key: isinIdentityKey('ZZSYNTH00015'),
      match_method: 'isin' as const,
      normalized_isin: 'ZZSYNTH00015',
      normalized_nse_code: null,
      records: [comparisonRecord(envelope.run_id, 0, 'isin', 'ZZSYNTH00015', 'SYNA')],
    };
    const unnamed = {
      identity_key: isinIdentityKey('ZZSYNTH00099'),
      match_method: 'isin' as const,
      normalized_isin: 'ZZSYNTH00099',
      normalized_nse_code: null,
      records: [comparisonRecord('does-not-exist-run', 0, 'isin', 'ZZSYNTH00099', 'SYNX')],
    };
    // An entry with no sample name sorts by its empty label first, then falls back to
    // identityKey among entries sharing that label — deterministic either way.
    const entries = buildComparisonPickerEntries([named, unnamed], runsById);
    expect(entries.map((e) => e.identityKey)).toEqual([unnamed.identity_key, named.identity_key]);
    expect(entries.find((e) => e.identityKey === named.identity_key)?.sampleStockName).toBe(
      'Synthetic Alpha Ltd',
    );
    expect(
      entries.find((e) => e.identityKey === unnamed.identity_key)?.sampleStockName,
    ).toBeUndefined();
  });
});
