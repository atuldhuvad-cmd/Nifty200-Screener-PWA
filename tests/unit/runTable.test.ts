import { describe, expect, it } from 'vitest';
import {
  buildRunTableColumns,
  identityDisplayText,
  rawCellDisplayText,
} from '../../src/core/display/runTable';
import { projectRunRows } from '../../src/core/display/runRows';
import { sortByColumn } from '../../src/core/display/sorting';
import { buildTestEnvelope, buildTestMultipartEnvelope } from '../storage-helpers';
import { buildCsv } from '../helpers';

describe('buildRunTableColumns: v1', () => {
  it('has no source-provenance columns for a single-file run', async () => {
    const envelope = await buildTestEnvelope({ fixture: 'SYNTHETIC_crlf_final_newline.csv' });
    const columns = buildRunTableColumns(projectRunRows(envelope));
    expect(columns.some((c) => c.role.role === 'sourceFile')).toBe(false);
    expect(columns.some((c) => c.role.role === 'sourceRow')).toBe(false);
  });

  it('every column is sortable (has a getSortValue function) and the computed ratio column is always last', async () => {
    const envelope = await buildTestEnvelope({ fixture: 'SYNTHETIC_crlf_final_newline.csv' });
    const columns = buildRunTableColumns(projectRunRows(envelope));
    for (const col of columns) expect(typeof col.getSortValue).toBe('function');
    expect(columns.at(-1)?.role.role).toBe('appVolumeRatio');
  });

  it('detects the numeric raw columns and marks the provider VolumeRatio column distinctly from the app-computed one', async () => {
    const envelope = await buildTestEnvelope({ fixture: 'SYNTHETIC_provider_mismatch.csv' });
    const columns = buildRunTableColumns(projectRunRows(envelope));
    const provider = columns.find((c) => c.isProviderVolumeRatio);
    expect(provider?.label).toBe('VolumeRatio');
    expect(provider?.kind).toBe('text'); // this fixture's provider column includes "n/a"
    const appRatio = columns.find((c) => c.role.role === 'appVolumeRatio');
    expect(appRatio?.isProviderVolumeRatio).toBe(false);
    expect(appRatio).not.toBe(provider);
  });

  it('sorts the app-computed Volume Ratio column numerically by decimal value', async () => {
    const envelope = await buildTestEnvelope({ fixture: 'SYNTHETIC_crlf_final_newline.csv' });
    const projection = projectRunRows(envelope);
    const columns = buildRunTableColumns(projection);
    const ratioColumn = columns.find((c) => c.role.role === 'appVolumeRatio');
    if (!ratioColumn) throw new Error('expected an appVolumeRatio column');
    const sorted = sortByColumn(
      projection.rows,
      ratioColumn.getSortValue,
      (r) => r.position,
      'asc',
    );
    expect(
      sorted.map((r) => (r.volumeRatio.status === 'valid' ? r.volumeRatio.value : null)),
    ).toEqual(['0.500', '1.500', '2.000']);
  });

  it('an invalid computed metric sorts last and still exposes a value for display via the row itself', async () => {
    const envelope = await buildTestEnvelope({ fixture: 'SYNTHETIC_zero_and_negative_volume.csv' });
    const projection = projectRunRows(envelope);
    const columns = buildRunTableColumns(projection);
    const ratioColumn = columns.find((c) => c.role.role === 'appVolumeRatio');
    if (!ratioColumn) throw new Error('expected an appVolumeRatio column');
    const sorted = sortByColumn(
      projection.rows,
      ratioColumn.getSortValue,
      (r) => r.position,
      'asc',
    );
    // Row 0 ("Synthetic Zero Num"): numerator 0, positive denominator -> valid "0.000", sorts first.
    expect(sorted[0]?.volumeRatio.status).toBe('valid');
    // The last rows are all `status: 'invalid'` (never blank/guessed) and sort after every valid one.
    const lastStatuses = sorted.slice(-2).map((r) => r.volumeRatio.status);
    expect(lastStatuses).toEqual(['invalid', 'invalid']);
  });
});

describe('buildRunTableColumns: v2 (multipart)', () => {
  const partA = buildCsv([
    [
      'Sl No',
      'Stock',
      'Consolidated end of day Vol ',
      'Consolidated 30D average end of day Vol ',
      'NSE Code',
      'ISIN',
    ],
    ['1', 'Synthetic Multipart Alpha', '2000', '1000', 'SYNMA', 'ZZSYNTH00015'],
  ]);
  const partB = buildCsv([
    [
      'NSE Code',
      'ISIN',
      'Sl No',
      'Stock',
      'Consolidated 30D average end of day Vol ',
      'Consolidated end of day Vol ',
    ],
    ['SYNMC', 'ZZSYNTH00031', '1', 'Synthetic Multipart Gamma', '1000', '9000'],
  ]);

  it('adds source file/row provenance columns, sortable, only for multipart runs', async () => {
    const envelope = await buildTestMultipartEnvelope({
      parts: [
        { fixtureBytes: partA, filename: 'part-a.csv' },
        { fixtureBytes: partB, filename: 'part-b.csv' },
      ],
    });
    const projection = projectRunRows(envelope);
    const columns = buildRunTableColumns(projection);
    const sourceFileCol = columns.find((c) => c.role.role === 'sourceFile');
    const sourceRowCol = columns.find((c) => c.role.role === 'sourceRow');
    expect(sourceRowCol).toBeDefined();
    if (!sourceFileCol) throw new Error('expected a sourceFile column');

    const byFilenameDesc = sortByColumn(
      projection.rows,
      sourceFileCol.getSortValue,
      (r) => r.position,
      'desc',
    );
    expect(byFilenameDesc.map((r) => r.sourceFilename)).toEqual(['part-b.csv', 'part-a.csv']);
  });
});

describe('identityDisplayText', () => {
  it('describes an ISIN match, a provisional NSE match, and a non-comparable row distinctly', () => {
    expect(
      identityDisplayText({
        raw_isin: 'ZZSYNTH00015',
        normalized_isin: 'ZZSYNTH00015',
        isin_validation: 'valid',
        raw_nse_code: 'SYNA',
        normalized_nse_code: 'SYNA',
        nse_code_validation: 'valid',
        match_method: 'isin',
        identity_warnings: [],
      }),
    ).toBe('ISIN ZZSYNTH00015');

    expect(
      identityDisplayText({
        raw_isin: '',
        normalized_isin: null,
        isin_validation: 'missing',
        raw_nse_code: 'SYNA',
        normalized_nse_code: 'SYNA',
        nse_code_validation: 'valid',
        match_method: 'nse_code_provisional',
        identity_warnings: ['ISIN_MISSING'],
      }),
    ).toBe('NSE Code SYNA (provisional)');

    expect(
      identityDisplayText({
        raw_isin: '',
        normalized_isin: null,
        isin_validation: 'missing',
        raw_nse_code: '',
        normalized_nse_code: null,
        nse_code_validation: 'missing',
        match_method: null,
        identity_warnings: ['ISIN_MISSING', 'NSE_CODE_MISSING', 'EXCLUDED_FROM_COMPARISON'],
      }),
    ).toBe('Not comparable');
  });
});

describe('rawCellDisplayText', () => {
  it('shows an em dash for a column absent from this row’s own source, distinct from a genuinely blank cell', () => {
    const presentBlank = {
      position: 0,
      sourceFilename: 'f.csv',
      sourceIndex: 0,
      sourceRowNumber: 1,
      cells: [''] as const,
      identity: {
        raw_isin: '',
        normalized_isin: null,
        isin_validation: 'missing' as const,
        raw_nse_code: '',
        normalized_nse_code: null,
        nse_code_validation: 'missing' as const,
        match_method: null,
        identity_warnings: [],
      },
      volumeRatio: {
        status: 'invalid' as const,
        value: null,
        reason: 'MISSING_NUMERATOR' as const,
        metric_version: 'volume_ratio_v1' as const,
      },
      providerVolumeRatioRaw: undefined,
    };
    const absent = { ...presentBlank, cells: [undefined] as const };
    expect(rawCellDisplayText(presentBlank, 0)).toBe('');
    expect(rawCellDisplayText(absent, 0)).toBe('—');
  });
});
