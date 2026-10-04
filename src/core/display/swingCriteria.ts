import Big from 'big.js';
import { parseNumericCell } from '../csv/numeric';
import type { VolumeRatioMetric } from '../csv/volumeRatio';
import type { DisplayColumn, ProjectedRow } from './runRows';

export interface SwingCsvParameter {
  key: string;
  label: string;
  aliases: readonly string[];
}

export const SWING_CSV_PARAMETERS: readonly SwingCsvParameter[] = [
  { key: 'ltp', label: 'LTP / Current Price', aliases: ['ltp', 'current price'] },
  { key: 'daySma20', label: 'Day SMA20', aliases: ['day sma20'] },
  { key: 'daySma50', label: 'Day SMA50', aliases: ['day sma50'] },
  { key: 'daySma200', label: 'Day SMA200', aliases: ['day sma200'] },
  { key: 'dayRsi', label: 'Day RSI', aliases: ['day rsi'] },
  { key: 'dayAdx', label: 'Day ADX', aliases: ['day adx'] },
  { key: 'dayMacd', label: 'Day MACD', aliases: ['day macd'] },
  { key: 'dayMacdSignalLine', label: 'Day MACD Signal Line', aliases: ['day macd signal line'] },
  {
    key: 'trendlyneMomentumScore',
    label: 'Trendlyne Momentum Score',
    aliases: ['trendlyne momentum score'],
  },
  { key: 'roeAnnPct', label: 'ROE Ann %', aliases: ['roe ann %', 'roe annual %'] },
  { key: 'roceAnnPct', label: 'ROCE Ann %', aliases: ['roce ann %', 'roce annual %'] },
  {
    key: 'interestCoverageAnn',
    label: 'Interest Coverage Ratio Ann',
    aliases: ['interest coverage ratio ann', 'interest coverage ratio annual'],
  },
  { key: 'piotroskiScore', label: 'Piotroski Score', aliases: ['piotroski score'] },
  { key: 'altmanZscore', label: 'Altman Zscore', aliases: ['altman zscore'] },
  {
    key: 'ltDebtToEquityAnn',
    label: 'LT Debt To Equity Ann',
    aliases: ['lt debt to equity ann', 'long term debt to equity annual'],
  },
];

export type SwingCriterionState = 'pass' | 'fail' | 'missing';

export interface SwingCriterionResult {
  label: string;
  state: SwingCriterionState;
}

export interface SwingChecklist {
  passed: number;
  failed: number;
  missing: number;
  total: number;
  results: SwingCriterionResult[];
}

const Compare = Big();

function byHeaderKey(columns: readonly DisplayColumn[]): Map<string, number> {
  const out = new Map<string, number>();
  columns.forEach((col, index) => {
    if (!out.has(col.headerKey)) out.set(col.headerKey, index);
  });
  return out;
}

function textAt(
  lookup: Map<string, number>,
  cells: readonly (string | undefined)[],
  parameter: SwingCsvParameter,
): string | undefined {
  for (const alias of parameter.aliases) {
    const index = lookup.get(alias);
    if (index !== undefined) return cells[index];
  }
  return undefined;
}

function validNumber(raw: string | undefined): Big | null {
  if (raw === undefined) return null;
  const parsed = parseNumericCell(raw);
  if (parsed.kind !== 'valid') return null;
  return new Compare(parsed.text);
}

function stateFromNumber(
  raw: string | undefined,
  predicate: (value: Big) => boolean,
): SwingCriterionState {
  const value = validNumber(raw);
  if (value === null) return 'missing';
  return predicate(value) ? 'pass' : 'fail';
}

function stateFromMetric(
  metric: VolumeRatioMetric,
  predicate: (value: Big) => boolean,
): SwingCriterionState {
  if (metric.status !== 'valid') return 'missing';
  return predicate(new Compare(metric.value)) ? 'pass' : 'fail';
}

function criterion(label: string, state: SwingCriterionState): SwingCriterionResult {
  return { label, state };
}

function param(key: string): SwingCsvParameter {
  const found = SWING_CSV_PARAMETERS.find((p) => p.key === key);
  if (found === undefined) throw new Error(`Unknown swing CSV parameter: ${key}`);
  return found;
}

export function buildSwingChecklistFromCells(
  columns: readonly DisplayColumn[],
  cells: readonly (string | undefined)[],
  volumeRatio: VolumeRatioMetric,
): SwingChecklist {
  const lookup = byHeaderKey(columns);
  const ltp = textAt(lookup, cells, param('ltp'));
  const sma20 = textAt(lookup, cells, param('daySma20'));
  const sma50 = textAt(lookup, cells, param('daySma50'));
  const sma200 = textAt(lookup, cells, param('daySma200'));
  const rsi = textAt(lookup, cells, param('dayRsi'));
  const adx = textAt(lookup, cells, param('dayAdx'));
  const macd = textAt(lookup, cells, param('dayMacd'));
  const macdSignal = textAt(lookup, cells, param('dayMacdSignalLine'));
  const momentum = textAt(lookup, cells, param('trendlyneMomentumScore'));
  const roe = textAt(lookup, cells, param('roeAnnPct'));
  const roce = textAt(lookup, cells, param('roceAnnPct'));
  const interestCoverage = textAt(lookup, cells, param('interestCoverageAnn'));
  const piotroski = textAt(lookup, cells, param('piotroskiScore'));
  const altman = textAt(lookup, cells, param('altmanZscore'));
  const debtEquity = textAt(lookup, cells, param('ltDebtToEquityAnn'));

  const ltpValue = validNumber(ltp);
  const sma20Value = validNumber(sma20);
  const sma50Value = validNumber(sma50);
  const sma200Value = validNumber(sma200);
  const macdValue = validNumber(macd);
  const macdSignalValue = validNumber(macdSignal);

  const results: SwingCriterionResult[] = [
    criterion(
      'Volume ratio ≥ 1.5',
      stateFromMetric(volumeRatio, (v) => v.gte(1.5)),
    ),
    criterion(
      'Price above SMA20',
      ltpValue === null || sma20Value === null
        ? 'missing'
        : ltpValue.gt(sma20Value)
          ? 'pass'
          : 'fail',
    ),
    criterion(
      'Price above SMA50',
      ltpValue === null || sma50Value === null
        ? 'missing'
        : ltpValue.gt(sma50Value)
          ? 'pass'
          : 'fail',
    ),
    criterion(
      'Price above SMA200',
      ltpValue === null || sma200Value === null
        ? 'missing'
        : ltpValue.gt(sma200Value)
          ? 'pass'
          : 'fail',
    ),
    criterion(
      'SMA20 above SMA50',
      sma20Value === null || sma50Value === null
        ? 'missing'
        : sma20Value.gt(sma50Value)
          ? 'pass'
          : 'fail',
    ),
    criterion(
      'RSI 50–70',
      stateFromNumber(rsi, (v) => v.gte(50) && v.lte(70)),
    ),
    criterion(
      'ADX ≥ 25',
      stateFromNumber(adx, (v) => v.gte(25)),
    ),
    criterion(
      'MACD > 0',
      stateFromNumber(macd, (v) => v.gt(0)),
    ),
    criterion(
      'MACD above signal line',
      macdValue === null || macdSignalValue === null
        ? 'missing'
        : macdValue.gt(macdSignalValue)
          ? 'pass'
          : 'fail',
    ),
    criterion(
      'Trendlyne Momentum Score ≥ 65',
      stateFromNumber(momentum, (v) => v.gte(65)),
    ),
    criterion(
      'ROE positive',
      stateFromNumber(roe, (v) => v.gt(0)),
    ),
    criterion(
      'ROCE positive',
      stateFromNumber(roce, (v) => v.gt(0)),
    ),
    criterion(
      'Interest coverage > 1.5',
      stateFromNumber(interestCoverage, (v) => v.gt(1.5)),
    ),
    criterion(
      'Piotroski ≥ 5',
      stateFromNumber(piotroski, (v) => v.gte(5)),
    ),
    criterion(
      'Altman Z ≥ 1.8',
      stateFromNumber(altman, (v) => v.gte(1.8)),
    ),
    criterion(
      'LT debt/equity ≤ 1.0',
      stateFromNumber(debtEquity, (v) => v.lte(1)),
    ),
  ];

  return {
    passed: results.filter((r) => r.state === 'pass').length,
    failed: results.filter((r) => r.state === 'fail').length,
    missing: results.filter((r) => r.state === 'missing').length,
    total: results.length,
    results,
  };
}

export function buildSwingChecklist(
  row: ProjectedRow,
  columns: readonly DisplayColumn[],
): SwingChecklist {
  return buildSwingChecklistFromCells(columns, row.cells, row.volumeRatio);
}

export function describeSwingChecklist(checklist: SwingChecklist): string {
  if (checklist.passed === 0 && checklist.failed === 0) return 'No checklist data';
  const failed = checklist.results.filter((r) => r.state === 'fail').map((r) => r.label);
  const missing = checklist.results.filter((r) => r.state === 'missing').map((r) => r.label);
  const met = checklist.results.filter((r) => r.state === 'pass').map((r) => r.label);
  const parts = met.length > 0 ? [`Met: ${met.join(', ')}`] : ['Met: none'];
  if (failed.length > 0) parts.push(`Failed: ${failed.join(', ')}`);
  if (missing.length > 0) parts.push(`Missing: ${missing.join(', ')}`);
  return parts.join(' · ');
}

export function summarizeSwingChecklist(checklist: SwingChecklist): string {
  if (checklist.passed === 0 && checklist.failed === 0) return 'No checklist data';
  return `${String(checklist.passed)}/${String(checklist.total)} met; ${String(
    checklist.failed,
  )} failed; ${String(checklist.missing)} missing`;
}
