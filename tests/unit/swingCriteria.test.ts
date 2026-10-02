import { describe, expect, it } from 'vitest';
import {
  buildSwingChecklistFromCells,
  describeSwingChecklist,
  type DisplayColumn,
} from '../../src/core/display';

const COLUMNS: DisplayColumn[] = [
  { key: '0', headerKey: 'ltp', label: 'LTP' },
  { key: '1', headerKey: 'day sma20', label: 'Day SMA20' },
  { key: '2', headerKey: 'day sma50', label: 'Day SMA50' },
  { key: '3', headerKey: 'day rsi', label: 'Day RSI' },
  { key: '4', headerKey: 'day adx', label: 'Day ADX' },
  { key: '5', headerKey: 'roe ann %', label: 'ROE Ann %' },
  { key: '6', headerKey: 'roce ann %', label: 'ROCE Ann %' },
  {
    key: '7',
    headerKey: 'interest coverage ratio ann',
    label: 'Interest Coverage Ratio Ann',
  },
  { key: '8', headerKey: 'piotroski score', label: 'Piotroski Score' },
  { key: '9', headerKey: 'altman zscore', label: 'Altman Zscore' },
  { key: '10', headerKey: 'lt debt to equity ann', label: 'LT Debt To Equity Ann' },
];

describe('swing checklist', () => {
  it('is a non-advisory checklist, not a score', () => {
    const checklist = buildSwingChecklistFromCells(
      COLUMNS,
      ['105', '100', '90', '55', '25', '10', '12', '3', '7', '2.5', '0.4'],
      {
        status: 'valid',
        value: '1.600',
        scale: 3,
        metric_version: 'volume_ratio_v1',
      },
    );

    expect(checklist).toMatchObject({ passed: 11, failed: 0, missing: 0, total: 11 });
    expect(describeSwingChecklist(checklist)).toContain('Met: Volume ratio ≥ 1.5');
    expect(describeSwingChecklist(checklist)).not.toMatch(/\d+\/\d+ met/);
  });

  it('keeps missing CSV parameters explicit', () => {
    const checklist = buildSwingChecklistFromCells(
      COLUMNS,
      ['', '', '', '', '', '', '', '', '', '', ''],
      {
        status: 'invalid',
        value: null,
        reason: 'MISSING_NUMERATOR',
        metric_version: 'volume_ratio_v1',
      },
    );

    expect(checklist).toMatchObject({ passed: 0, failed: 0, missing: 11, total: 11 });
    expect(describeSwingChecklist(checklist)).toBe('No checklist data');
  });
});
