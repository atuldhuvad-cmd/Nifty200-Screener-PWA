import { describe, expect, it } from 'vitest';
import { normalizeForDisplay } from '../../src/core/display/normalizeForDisplay';

const NBSP = ' ';
const TAB = '\t';

describe('normalizeForDisplay (S3)', () => {
  it('trims leading/trailing ASCII space, tab, and NBSP', () => {
    expect(normalizeForDisplay(`  ${TAB}${NBSP}Reliance${NBSP}${TAB}  `)).toBe('Reliance');
  });

  it('collapses internal runs of space/tab/NBSP to a single ASCII space', () => {
    expect(normalizeForDisplay(`Multi${TAB}${NBSP} Commodity   Exchange`)).toBe(
      'Multi Commodity Exchange',
    );
  });

  it('leaves an already-clean string unchanged', () => {
    expect(normalizeForDisplay('Apollo Hospitals')).toBe('Apollo Hospitals');
  });

  it('does not alter case', () => {
    expect(normalizeForDisplay('  MiXeD CaSe  ')).toBe('MiXeD CaSe');
  });

  it('reduces a whitespace-only string to empty', () => {
    expect(normalizeForDisplay(`  ${TAB}${NBSP} `)).toBe('');
  });

  it('never mutates the input string (raw cells stay untouched elsewhere)', () => {
    const raw = '  Bharat Electronics  ';
    const result = normalizeForDisplay(raw);
    expect(raw).toBe('  Bharat Electronics  ');
    expect(result).toBe('Bharat Electronics');
  });
});
