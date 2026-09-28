import { describe, expect, it } from 'vitest';
import { normalizeForDisplay } from '../../src/core/display/normalizeForDisplay';
import { projectRunRows } from '../../src/core/display/runRows';
import { buildTestEnvelope, buildTestMultipartEnvelope } from '../storage-helpers';
import { buildCsv } from '../helpers';

describe('projectRunRows: v1', () => {
  it('projects every header positionally, in order, with no S3 normalization applied to raw cells', async () => {
    const envelope = await buildTestEnvelope({ fixture: 'SYNTHETIC_crlf_final_newline.csv' });
    const projection = projectRunRows(envelope);

    expect(projection.multipart).toBe(false);
    // Labels are S3-normalized for display (e.g. trailing-space headers trimmed); the raw
    // header strings themselves are asserted untouched in the "never mutates" test below.
    expect(projection.columns.map((c) => c.label)).toEqual(
      envelope.headers.map((h) => normalizeForDisplay(h)),
    );
    expect(projection.rows).toHaveLength(envelope.rows.length);

    projection.rows.forEach((row, i) => {
      expect(row.position).toBe(i);
      expect(row.sourceIndex).toBe(0);
      expect(row.sourceRowNumber).toBe(i + 1);
      expect(row.sourceFilename).toBe(envelope.original_filename);
      // Every raw cell is preserved exactly, never mutated or re-normalized.
      expect(row.cells).toEqual(envelope.rows[i]);
    });
  });

  it('recomputes identity and volume_ratio_v1 from the raw cells (never read back from the envelope, since v1 stores neither)', async () => {
    const envelope = await buildTestEnvelope({ fixture: 'SYNTHETIC_crlf_final_newline.csv' });
    const projection = projectRunRows(envelope);
    // SYNTHETIC_crlf_final_newline.csv: Alpha 1500/1000=1.500, Beta 1000/2000=0.500, Gamma 1000/500=2.000
    expect(
      projection.rows.map((r) => (r.volumeRatio.status === 'valid' ? r.volumeRatio.value : null)),
    ).toEqual(['1.500', '0.500', '2.000']);
    for (const row of projection.rows) {
      expect(row.identity.match_method).toBe('isin');
    }
  });

  it('never merges the provider VolumeRatio column into the computed metric', async () => {
    const envelope = await buildTestEnvelope({ fixture: 'SYNTHETIC_provider_mismatch.csv' });
    const projection = projectRunRows(envelope);
    const mismatchRow = projection.rows[1]; // "Synthetic Mismatch": provider 3.06, app-computed differs
    expect(mismatchRow?.providerVolumeRatioRaw).toBe('3.06');
    expect(mismatchRow?.volumeRatio.status === 'valid' ? mismatchRow.volumeRatio.value : null).toBe(
      '0.991',
    );
  });

  it('keeps a row excluded from comparison (no usable identifier) visible in the projection', async () => {
    const envelope = await buildTestEnvelope({ fixture: 'SYNTHETIC_missing_identifiers.csv' });
    const projection = projectRunRows(envelope);
    // Row index 2 ("Synthetic No Ids"): both ISIN and NSE Code blank.
    const excluded = projection.rows[2];
    expect(excluded?.identity.match_method).toBeNull();
    expect(excluded?.cells[1]).toBe('Synthetic No Ids');
  });

  it('does not merge duplicate raw headers into one column', async () => {
    const envelope = await buildTestEnvelope({ fixture: 'SYNTHETIC_duplicate_blank_headers.csv' });
    const projection = projectRunRows(envelope);
    // Headers: Sl No, Stock, "Stock " (duplicate, normalizes the same as Stock), "" (blank), ...
    expect(projection.columns).toHaveLength(envelope.headers.length);
    expect(projection.rows[0]?.cells).toEqual(envelope.rows[0]);
  });

  it('never mutates the envelope it reads from', async () => {
    const envelope = await buildTestEnvelope({ fixture: 'SYNTHETIC_crlf_final_newline.csv' });
    const before = JSON.parse(JSON.stringify(envelope)) as unknown;
    projectRunRows(envelope);
    expect(envelope).toEqual(before);
  });
});

describe('projectRunRows: v2 (multipart)', () => {
  const partAHeaders = [
    'Sl No',
    'Stock',
    'Consolidated end of day Vol ',
    'Consolidated 30D average end of day Vol ',
    'NSE Code',
    'ISIN',
  ];
  const partABytes = buildCsv([
    partAHeaders,
    ['1', 'Synthetic Multipart Alpha', '2000', '1000', 'SYNMA', 'ZZSYNTH00015'],
    ['2', 'Synthetic Multipart Beta', '900', '1000', 'SYNMB', 'ZZSYNTH00023'],
  ]);

  // Deliberately reordered headers, proving each part is read using its OWN header mapping.
  const partBHeaders = [
    'NSE Code',
    'ISIN',
    'Sl No',
    'Stock',
    'Consolidated 30D average end of day Vol ',
    'Consolidated end of day Vol ',
  ];
  const partBBytes = buildCsv([
    partBHeaders,
    ['SYNMC', 'ZZSYNTH00031', '1', 'Synthetic Multipart Gamma', '1000', '9000'],
    ['SYNMD', 'ZZSYNTH00049', '2', 'Synthetic Multipart Epsilon', '1000', '10000'],
  ]);

  it('reconstructs rows in combined_row_refs order (source order, then row order within each source)', async () => {
    const envelope = await buildTestMultipartEnvelope({
      parts: [
        { fixtureBytes: partABytes, filename: 'part-a.csv' },
        { fixtureBytes: partBBytes, filename: 'part-b.csv' },
      ],
    });
    const projection = projectRunRows(envelope);
    expect(projection.multipart).toBe(true);
    expect(
      projection.rows.map((r) => [r.sourceIndex, r.sourceRowNumber, r.sourceFilename]),
    ).toEqual([
      [0, 1, 'part-a.csv'],
      [0, 2, 'part-a.csv'],
      [1, 1, 'part-b.csv'],
      [1, 2, 'part-b.csv'],
    ]);
    expect(projection.rows.map((r) => r.position)).toEqual([0, 1, 2, 3]);
  });

  it('reads each row using its own part header mapping, even when parts reorder columns differently', async () => {
    const envelope = await buildTestMultipartEnvelope({
      parts: [
        { fixtureBytes: partABytes, filename: 'part-a.csv' },
        { fixtureBytes: partBBytes, filename: 'part-b.csv' },
      ],
    });
    const projection = projectRunRows(envelope);
    // Numerically: Alpha 2000/1000=2.000, Beta 900/1000=0.900, Gamma 9000/1000=9.000,
    // Epsilon 10000/1000=10.000 — proves 2 < 9 < 10 end-to-end through real per-part mapping,
    // not just the sorting module in isolation.
    expect(
      projection.rows.map((r) => (r.volumeRatio.status === 'valid' ? r.volumeRatio.value : null)),
    ).toEqual(['2.000', '0.900', '9.000', '10.000']);

    const identityKeys = projection.rows.map((r) => r.identity.normalized_isin);
    expect(identityKeys).toEqual(['ZZSYNTH00015', 'ZZSYNTH00023', 'ZZSYNTH00031', 'ZZSYNTH00049']);
  });

  it('unions columns by normalized header key across parts, in first-seen order', async () => {
    const envelope = await buildTestMultipartEnvelope({
      parts: [
        { fixtureBytes: partABytes, filename: 'part-a.csv' },
        { fixtureBytes: partBBytes, filename: 'part-b.csv' },
      ],
    });
    const projection = projectRunRows(envelope);
    // Part A's order wins for the union (first-seen); Part B introduces no new columns here.
    expect(projection.columns.map((c) => c.label)).toEqual(partAHeaders.map((h) => h.trim()));
  });

  it('aligns each row to the shared column set via its own part, not raw position', async () => {
    const envelope = await buildTestMultipartEnvelope({
      parts: [
        { fixtureBytes: partABytes, filename: 'part-a.csv' },
        { fixtureBytes: partBBytes, filename: 'part-b.csv' },
      ],
    });
    const projection = projectRunRows(envelope);
    const stockColumnIndex = projection.columns.findIndex((c) => c.key === 'stock');
    const gammaRow = projection.rows[2]; // first row from the reordered part B
    expect(gammaRow?.cells[stockColumnIndex]).toBe('Synthetic Multipart Gamma');
  });

  it('never mutates the envelope it reads from', async () => {
    const envelope = await buildTestMultipartEnvelope({
      parts: [
        { fixtureBytes: partABytes, filename: 'part-a.csv' },
        { fixtureBytes: partBBytes, filename: 'part-b.csv' },
      ],
    });
    const before = JSON.parse(JSON.stringify(envelope)) as unknown;
    projectRunRows(envelope);
    expect(envelope).toEqual(before);
  });
});
