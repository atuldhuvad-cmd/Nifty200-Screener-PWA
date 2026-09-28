import { mapColumns, normalizeHeaderKey, type ColumnMapping } from '../csv/headers';
import { buildStockIdentity, type StockIdentity } from '../csv/identifiers';
import type { VolumeRatioMetric } from '../csv/volumeRatio';
import type { RunEnvelopeV1, RunEnvelopeV2 } from '../envelope/types';
import { normalizeForDisplay } from './normalizeForDisplay';

export interface DisplayColumn {
  /** Unique identity for this column within its table (Svelte keyed-each, sort-state tracking).
   * For a v1 run, the column's 0-based position (duplicate/blank raw headers are never merged —
   * every physical column stays addressable, per the brief's "Duplicate/blank CSV headers"
   * rule). For a v2 run, the D3-normalized header key shared by every part that has a matching
   * column (see `projectRunRows`) — inherently unique there since `unionColumns` dedupes by it. */
  key: string;
  /** The D3-normalized header key regardless of `key`'s uniqueness scheme — always the real
   * normalized header, used to recognize a specific field (e.g. the provider VolumeRatio
   * column) by its alias, the same way `mapColumns` does for import-time field mapping. */
  headerKey: string;
  /** S3-normalized display label. Never the raw header itself once shown on screen; the raw
   * string in the envelope is untouched. */
  label: string;
}

export interface ProjectedRow {
  /** 0-based position in this run's combined/raw row order — the stable sort tiebreaker. */
  position: number;
  sourceFilename: string;
  /** 0-based index into the run's source file list; always 0 for a v1 run. */
  sourceIndex: number;
  /** 1-based row number within that source file, for display. */
  sourceRowNumber: number;
  /** Raw cell text aligned to the projection's `columns`. `undefined` means this row's own
   * source file has no column for that position/key — never guessed, never blended with a
   * genuinely blank cell (`''`). */
  cells: readonly (string | undefined)[];
  identity: StockIdentity;
  /** The app's historical Volume Ratio, read verbatim from the envelope's own
   * `computed_metrics.volume_ratio_v1` at commit time — never recomputed for display. */
  volumeRatio: VolumeRatioMetric;
  /** Raw text of the provider's own VolumeRatio column for this row, when mapped; kept
   * separate from `volumeRatio` (S2: never merged with or substituted for the app's own). */
  providerVolumeRatioRaw: string | undefined;
}

export interface RunRowsProjection {
  columns: DisplayColumn[];
  rows: ProjectedRow[];
  /** True for a v2 (multipart) envelope; the UI shows source filename/row columns only then. */
  multipart: boolean;
}

function cellAt(row: readonly string[], index: number | undefined): string {
  return index === undefined ? '' : (row[index] ?? '');
}

/**
 * Identity is a rebuildable derived index (never persisted — see `RunEnvelopeV1`'s doc comment)
 * and so is legitimately recomputed from the raw ISIN/NSE Code cells here, same as the
 * comparison-identity index. The provider's own `VolumeRatio` is likewise a raw cell, read
 * verbatim (never computed). Neither touches `volume_ratio_v1`, which — unlike identity — *is*
 * persisted on the envelope and must be read from there; see `historicalVolumeRatio` below.
 */
function identityAndProvider(
  mapping: ColumnMapping,
  row: readonly string[],
): {
  identity: StockIdentity;
  providerVolumeRatioRaw: string | undefined;
} {
  const identity = buildStockIdentity(
    cellAt(row, mapping.columns.isin),
    cellAt(row, mapping.columns.nseCode),
  );
  const providerVolumeRatioRaw =
    mapping.columns.providerVolumeRatio === undefined
      ? undefined
      : cellAt(row, mapping.columns.providerVolumeRatio);
  return { identity, providerVolumeRatioRaw };
}

/**
 * Reads the app-computed Volume Ratio for one combined row from the envelope's own persisted
 * `computed_metrics.volume_ratio_v1` — never recomputed. `volume_ratio_v1` is index-aligned
 * with `rows` (v1) or `combined_row_refs` (v2) by construction (`buildEnvelope`/
 * `buildMultipartEnvelope`) and re-checked by `validateEnvelope`'s `METRICS_COUNT_MISMATCH`/
 * replay checks before a run is ever committed, so a missing entry here can only mean this
 * function was called with the wrong index or on data that bypassed validation — either way a
 * bug, not a case to paper over by recomputing a possibly-different value from raw cells for
 * what is, by definition, historical data.
 */
function historicalVolumeRatio(
  envelope: RunEnvelopeV1 | RunEnvelopeV2,
  index: number,
): VolumeRatioMetric {
  const metric = envelope.computed_metrics.volume_ratio_v1[index];
  if (metric === undefined) {
    throw new Error(`projectRunRows: no stored volume_ratio_v1 at index ${String(index)}`);
  }
  return metric;
}

function projectV1(envelope: RunEnvelopeV1): RunRowsProjection {
  const mapping = mapColumns(envelope.headers);
  const columns: DisplayColumn[] = envelope.headers.map((h, i) => ({
    key: String(i),
    headerKey: normalizeHeaderKey(h),
    label: normalizeForDisplay(h),
  }));
  const rows: ProjectedRow[] = envelope.rows.map((row, i) => ({
    position: i,
    sourceFilename: envelope.original_filename,
    sourceIndex: 0,
    sourceRowNumber: i + 1,
    cells: row,
    ...identityAndProvider(mapping, row),
    volumeRatio: historicalVolumeRatio(envelope, i),
  }));
  return { columns, rows, multipart: false };
}

interface PartHeaderMap {
  mapping: ColumnMapping;
  /** D3-normalized key -> column index within this part's own headers. When a part has a
   * duplicate normalized header (never observed in real data; possible only in a synthetic
   * fixture), only the first occurrence is addressable in the v2 union view — every row is
   * still shown, only that rare second column isn't independently reachable there. */
  keyToColumn: Map<string, number>;
}

function buildPartMap(headers: readonly string[]): PartHeaderMap {
  const keyToColumn = new Map<string, number>();
  headers.forEach((h, i) => {
    const key = normalizeHeaderKey(h);
    if (key !== '' && !keyToColumn.has(key)) keyToColumn.set(key, i);
  });
  return { mapping: mapColumns(headers), keyToColumn };
}

function unionColumns(headerSets: readonly (readonly string[])[]): DisplayColumn[] {
  const columns: DisplayColumn[] = [];
  const seen = new Set<string>();
  for (const headers of headerSets) {
    for (const h of headers) {
      const key = normalizeHeaderKey(h);
      if (key === '' || seen.has(key)) continue;
      seen.add(key);
      columns.push({ key, headerKey: key, label: normalizeForDisplay(h) });
    }
  }
  return columns;
}

function projectV2(envelope: RunEnvelopeV2): RunRowsProjection {
  const parts = envelope.source_files.map((sf) => buildPartMap(sf.headers));
  const columns = unionColumns(envelope.source_files.map((sf) => sf.headers));

  const rows: ProjectedRow[] = envelope.combined_row_refs.map((ref, i) => {
    const part = parts[ref.source_index];
    const sourceFile = envelope.source_files[ref.source_index];
    const row = sourceFile?.rows[ref.source_row_index];
    if (part === undefined || sourceFile === undefined || row === undefined) {
      // Unreachable for any run the UI ever opens: `isRunOpenable` excludes `quarantined`
      // runs, and a non-quarantined v2 run's refs were already range-checked by `validateV2`
      // (or, for one just built and not yet validated, by `buildMultipartEnvelope` itself).
      throw new Error('projectRunRows: combined_row_refs entry out of range');
    }
    return {
      position: i,
      sourceFilename: sourceFile.original_filename,
      sourceIndex: ref.source_index,
      sourceRowNumber: ref.source_row_index + 1,
      cells: columns.map((col) => {
        const idx = part.keyToColumn.get(col.key);
        return idx === undefined ? undefined : (row[idx] ?? '');
      }),
      ...identityAndProvider(part.mapping, row),
      volumeRatio: historicalVolumeRatio(envelope, i),
    };
  });

  return { columns, rows, multipart: true };
}

/**
 * Projects an immutable run envelope (v1 or v2) into a flat, sortable table: every raw header
 * and cell preserved exactly as stored (never mutated — S3 normalization is applied only to
 * `DisplayColumn.label`, never to a cell), per-row identity recomputed from the raw ISIN/NSE
 * Code cells (a rebuildable derived index, never persisted — see `RunEnvelopeV1`'s doc comment),
 * per-row `volume_ratio_v1` read verbatim from the envelope's own `computed_metrics` (this *is*
 * persisted, index-aligned with `rows`/`combined_row_refs` — historical data, never
 * recomputed), and, for v2, rows walked in `combined_row_refs` order using each referenced
 * part's own header mapping (Step 4A's parts are not guaranteed to share column order). The
 * result is a disposable view, rebuildable at any time from the stored envelope alone — never
 * itself persisted.
 */
export function projectRunRows(envelope: RunEnvelopeV1 | RunEnvelopeV2): RunRowsProjection {
  return envelope.schema_version === '1' ? projectV1(envelope) : projectV2(envelope);
}
