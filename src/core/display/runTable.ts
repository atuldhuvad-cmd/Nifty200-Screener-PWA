import { FIELD_DEFINITIONS } from '../csv/headers';
import type { StockIdentity } from '../csv/identifiers';
import { normalizeForDisplay } from './normalizeForDisplay';
import type { ProjectedRow, RunRowsProjection } from './runRows';
import { buildSwingChecklist, describeSwingChecklist } from './swingCriteria';
import {
  decimalStringSortValue,
  detectColumnKind,
  numericSortValue,
  textSortValue,
  type ColumnKind,
  type SortValue,
} from './sorting';

export type RunTableColumnRole =
  | { role: 'sourceFile' }
  | { role: 'sourceRow' }
  | { role: 'identity' }
  | { role: 'raw'; columnIndex: number }
  | { role: 'swingChecklist' }
  | { role: 'appVolumeRatio' };

export interface RunTableColumn {
  /** Unique across a table's columns; used as sort-state's key, never for display. */
  key: string;
  label: string;
  role: RunTableColumnRole;
  kind: ColumnKind;
  /** True for the raw column that D3 maps as the provider's own VolumeRatio (never the same
   * column as `appVolumeRatio` — S2: the two are always shown separately). */
  isProviderVolumeRatio: boolean;
  getSortValue: (row: ProjectedRow) => SortValue;
}

export function identityDisplayText(identity: StockIdentity): string {
  if (identity.match_method === 'isin') return `ISIN ${identity.normalized_isin ?? ''}`;
  if (identity.match_method === 'nse_code_provisional') {
    return `NSE Code ${identity.normalized_nse_code ?? ''} (provisional)`;
  }
  return 'Not comparable';
}

/** `undefined` (column absent for this row's own source part) renders as an em dash — distinct
 * from a genuinely blank cell (`''`), which S3-normalizes to an empty string, same as always. */
export function rawCellDisplayText(row: ProjectedRow, columnIndex: number): string {
  const cell = row.cells[columnIndex];
  return cell === undefined ? '—' : normalizeForDisplay(cell);
}

/**
 * Builds the sortable stock-table column set for one run's projected rows: source
 * filename/row provenance columns (multipart runs only), the identity column, every raw
 * projected column (with its sort type auto-detected from its own values — brief: "provider
 * numeric columns matching the decided numeric grammar sort numerically for sorting only"),
 * and the app-computed `volume_ratio_v1` column, always last and always separate from
 * whichever raw column happens to be the provider's own VolumeRatio (`isProviderVolumeRatio`).
 * Every column returned here is sortable — nothing in the visible table is left unsortable.
 */
export function buildRunTableColumns(projection: RunRowsProjection): RunTableColumn[] {
  const columns: RunTableColumn[] = [];

  if (projection.multipart) {
    columns.push({
      key: '__source_file__',
      label: 'Source file',
      role: { role: 'sourceFile' },
      kind: 'text',
      isProviderVolumeRatio: false,
      getSortValue: (row) => textSortValue(row.sourceFilename),
    });
    columns.push({
      key: '__source_row__',
      label: 'Source row',
      role: { role: 'sourceRow' },
      kind: 'numeric',
      isProviderVolumeRatio: false,
      getSortValue: (row) => numericSortValue(String(row.sourceRowNumber)),
    });
  }

  columns.push({
    key: '__identity__',
    label: 'Identity',
    role: { role: 'identity' },
    kind: 'text',
    isProviderVolumeRatio: false,
    getSortValue: (row) => textSortValue(identityDisplayText(row.identity)),
  });

  projection.columns.forEach((col, columnIndex) => {
    const kind = detectColumnKind(projection.rows.map((r) => r.cells[columnIndex]));
    columns.push({
      key: `raw:${col.key}`,
      label: col.label,
      role: { role: 'raw', columnIndex },
      kind,
      isProviderVolumeRatio: FIELD_DEFINITIONS.providerVolumeRatio.aliases.includes(col.headerKey),
      getSortValue: (row) =>
        kind === 'numeric'
          ? numericSortValue(row.cells[columnIndex])
          : textSortValue(row.cells[columnIndex]),
    });
  });

  columns.push({
    key: '__swing_checklist__',
    label: 'Swing checklist (not a score)',
    role: { role: 'swingChecklist' },
    kind: 'text',
    isProviderVolumeRatio: false,
    getSortValue: (row) =>
      textSortValue(describeSwingChecklist(buildSwingChecklist(row, projection.columns))),
  });

  columns.push({
    key: '__app_volume_ratio__',
    label: 'App Volume Ratio (computed)',
    role: { role: 'appVolumeRatio' },
    kind: 'numeric',
    isProviderVolumeRatio: false,
    getSortValue: (row) =>
      row.volumeRatio.status === 'valid'
        ? decimalStringSortValue(row.volumeRatio.value)
        : { kind: 'missing' },
  });

  return columns;
}
