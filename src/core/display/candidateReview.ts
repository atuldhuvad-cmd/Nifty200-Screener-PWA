import { isSupportedEnvelope, isRunOpenable, type RunRecord } from '../storage';
import { projectRunRows, type ProjectedRow, type RunRowsProjection } from './runRows';

export type ReviewRunKind = 'balanced' | 'technical';

export interface CandidateReviewRun {
  kind: ReviewRunKind;
  run: RunRecord;
  projection: RunRowsProjection;
}

export interface CandidateReviewCandidate {
  key: string;
  stock: string;
  row: ProjectedRow;
  inBalanced: boolean;
  inTechnical: boolean;
  technicalChecks: {
    label: string;
    state: 'pass' | 'fail' | 'missing';
  }[];
}

export interface CandidateReviewResult {
  balanced?: CandidateReviewRun;
  technical?: CandidateReviewRun;
  overlap: CandidateReviewCandidate[];
  technicalOnly: CandidateReviewCandidate[];
  balancedOnly: CandidateReviewCandidate[];
}

function sourceNames(run: RunRecord): string[] {
  const envelope = run.envelope;
  if (!isSupportedEnvelope(envelope)) return [];
  if (envelope.schema_version === '1') return [envelope.original_filename];
  return envelope.source_files.map((part) => part.original_filename);
}

function latestRun(
  runs: readonly RunRecord[],
  kind: ReviewRunKind,
): CandidateReviewRun | undefined {
  const marker = kind === 'balanced' ? 'balanced' : 'technical';
  const matching = runs
    .filter(isRunOpenable)
    .filter((run) => sourceNames(run).some((name) => name.toLowerCase().includes(marker)))
    .sort((a, b) => {
      const ad = isSupportedEnvelope(a.envelope) ? a.envelope.effective_date : '';
      const bd = isSupportedEnvelope(b.envelope) ? b.envelope.effective_date : '';
      const ai = isSupportedEnvelope(a.envelope) ? a.envelope.imported_at : '';
      const bi = isSupportedEnvelope(b.envelope) ? b.envelope.imported_at : '';
      return bd.localeCompare(ad) || bi.localeCompare(ai);
    })
    .map((run) => {
      if (!isSupportedEnvelope(run.envelope)) return undefined;
      return { kind, run, projection: projectRunRows(run.envelope) };
    })
    .find((entry): entry is CandidateReviewRun => entry !== undefined);
  return matching;
}

function rowKey(row: ProjectedRow): string | undefined {
  return row.identity.normalized_isin ?? row.identity.normalized_nse_code ?? undefined;
}

function value(projection: RunRowsProjection, row: ProjectedRow, aliases: string[]): number | null {
  const index = projection.columns.findIndex((column) => aliases.includes(column.headerKey));
  if (index < 0) return null;
  const raw = row.cells[index];
  if (raw === undefined || raw.trim() === '') return null;
  const parsed = Number(raw.replace(/,/g, '').replace(/%$/, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function checks(
  projection: RunRowsProjection,
  row: ProjectedRow,
): CandidateReviewCandidate['technicalChecks'] {
  const ltp = value(projection, row, ['ltp', 'current price']);
  const sma20 = value(projection, row, ['day sma20']);
  const sma50 = value(projection, row, ['day sma50']);
  const sma200 = value(projection, row, ['day sma200']);
  const rsi = value(projection, row, ['day rsi']);
  const adx = value(projection, row, ['day adx']);
  const macd = value(projection, row, ['day macd']);
  const signal = value(projection, row, ['day macd signal line']);
  const momentum = value(projection, row, ['momentum score', 'trendlyne momentum score']);
  const states = (label: string, result: boolean | null) => ({
    label,
    state: result === null ? ('missing' as const) : result ? ('pass' as const) : ('fail' as const),
  });
  return [
    states('Price above SMA20', ltp === null || sma20 === null ? null : ltp > sma20),
    states('Price above SMA50', ltp === null || sma50 === null ? null : ltp > sma50),
    states('Price above SMA200', ltp === null || sma200 === null ? null : ltp > sma200),
    states('RSI 50–70', rsi === null ? null : rsi >= 50 && rsi <= 70),
    states('ADX ≥ 25', adx === null ? null : adx >= 25),
    states('MACD above signal', macd === null || signal === null ? null : macd > signal),
    states('Momentum ≥ 65', momentum === null ? null : momentum >= 65),
  ];
}

function candidates(
  run: CandidateReviewRun,
  keys: Set<string>,
): Map<string, CandidateReviewCandidate> {
  const result = new Map<string, CandidateReviewCandidate>();
  for (const row of run.projection.rows) {
    const key = rowKey(row);
    if (key === undefined || !keys.has(key)) continue;
    result.set(key, {
      key,
      stock: valueAt(run.projection, row, ['stock', 'name']) ?? 'Unnamed stock',
      row,
      inBalanced: run.kind === 'balanced',
      inTechnical: run.kind === 'technical',
      technicalChecks: checks(run.projection, row),
    });
  }
  return result;
}

function valueAt(
  projection: RunRowsProjection,
  row: ProjectedRow,
  aliases: string[],
): string | null {
  const index = projection.columns.findIndex((column) => aliases.includes(column.headerKey));
  return index < 0 ? null : (row.cells[index] ?? null);
}

export function buildCandidateReview(runs: readonly RunRecord[]): CandidateReviewResult {
  const balanced = latestRun(runs, 'balanced');
  const technical = latestRun(runs, 'technical');
  if (balanced === undefined || technical === undefined) {
    return {
      overlap: [],
      technicalOnly: [],
      balancedOnly: [],
      ...(balanced ? { balanced } : {}),
      ...(technical ? { technical } : {}),
    };
  }
  const balancedRows = new Map(balanced.projection.rows.map((row) => [rowKey(row), row]));
  const technicalRows = new Map(technical.projection.rows.map((row) => [rowKey(row), row]));
  const overlapKeys = new Set(
    [...balancedRows.keys()].filter(
      (key): key is string => key !== undefined && technicalRows.has(key),
    ),
  );
  const technicalOnlyKeys = new Set(
    [...technicalRows.keys()].filter(
      (key): key is string => key !== undefined && !balancedRows.has(key),
    ),
  );
  const balancedOnlyKeys = new Set(
    [...balancedRows.keys()].filter(
      (key): key is string => key !== undefined && !technicalRows.has(key),
    ),
  );
  return {
    balanced,
    technical,
    overlap: [...candidates(technical, overlapKeys).values()].map((candidate) => ({
      ...candidate,
      inBalanced: true,
    })),
    technicalOnly: [...candidates(technical, technicalOnlyKeys).values()],
    balancedOnly: [...candidates(balanced, balancedOnlyKeys).values()],
  };
}
