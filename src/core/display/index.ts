export { normalizeForDisplay } from './normalizeForDisplay';
export { compareRunsForHistory, sortRunsForHistory } from './runOrder';
export { projectRunRows } from './runRows';
export type { DisplayColumn, ProjectedRow, RunRowsProjection } from './runRows';
export { buildRunTableColumns, identityDisplayText, rawCellDisplayText } from './runTable';
export type { RunTableColumn, RunTableColumnRole } from './runTable';
export {
  dateSortValue,
  decimalStringSortValue,
  detectColumnKind,
  numericSortValue,
  sortByColumn,
  textSortValue,
} from './sorting';
export type { ColumnKind, SortDirection, SortValue } from './sorting';
