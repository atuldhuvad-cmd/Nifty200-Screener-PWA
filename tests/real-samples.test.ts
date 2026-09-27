import { describe, expect, it } from 'vitest';
import { analyzeCsvBytes, type CsvAnalysis } from '../src/core/csv/analyze';
import { decisionsHashFor, sampleExists, sha256Hex, verifiedSample } from './helpers';

// REAL Trendlyne exports. They are kept local only: samples/ is git-ignored, never modified,
// and every file is hash-verified against DECISIONS.md before use.
const S1 = 'Nifty 200 with Fundamentals_September 27, 2026.csv';
const S2 = 'Nifty 200 with Fundamentals_September 27, 2026 (1).csv';
const P1 = 'Nifty200 All_September 27, 2026.csv';
const P2 = 'Nifty200 All_September 27, 2026 (1).csv';
const S4 = 'Nifty200 All_September 27, 2026 (2).csv';
const ALL = [S1, S2, P1, P2, S4];

const available = ALL.every(sampleExists);

type OkAnalysis = Extract<CsvAnalysis, { ok: true }>;
const cache = new Map<string, OkAnalysis>();
/** Lazy, so collection never touches samples/ when it is absent (fresh clone). */
function analyzed(name: string): OkAnalysis {
  const hit = cache.get(name);
  if (hit) return hit;
  const a = analyzeCsvBytes(verifiedSample(name));
  if (!a.ok) throw new Error(`real sample failed to parse: ${name}`);
  cache.set(name, a);
  return a;
}

describe.skipIf(!available)('REAL samples (local only)', () => {
  it.each(ALL)('%s matches the SHA-256 recorded in DECISIONS.md', (name) => {
    expect(sha256Hex(verifiedSample(name))).toBe(decisionsHashFor(name));
  });

  describe('two-page "Nifty200 All" export (sample 3, 200 rows)', () => {
    const page1 = () => analyzed(P1);
    const pages = () => [analyzed(P1), analyzed(P2)];

    it('parses each page with the frozen format and confirms without blocking', () => {
      for (const a of pages()) {
        expect(a.canConfirm).toBe(true);
        expect(a.blockingErrors).toEqual([]);
        expect(a.parsed.headers).toHaveLength(22);
        expect(a.parsed.rows).toHaveLength(100);
        expect(a.parsed.config).toMatchObject({
          encoding: 'utf-8',
          bomPresent: true,
          delimiter: ',',
          newline: 'LF',
          finalNewline: false,
        });
      }
    });

    it('preserves header strings exactly, including trailing and double spaces', () => {
      const h = page1().parsed.headers;
      expect(h[3]).toBe('Day Vol ');
      expect(h[4]).toBe('Consolidated 30D average end of day Vol ');
      expect(h[11]).toBe('ROE Ann  %');
      expect(h[17]).toBe('NSE+BSE Vol ');
      expect(h[18]).toBe('Consolidated end of day Vol ');
    });

    it('maps the V1 numerator to column 18 and never to Day Vol (3) or NSE+BSE Vol (17)', () => {
      expect(page1().mapping.columns).toEqual({
        serialNumber: 0,
        providerVolumeRatio: 2,
        volumeDenominator: 4,
        volumeNumerator: 18,
        nseCode: 19,
        isin: 21,
      });
    });

    it('computes a valid volume_ratio_v1 for all 200 rows', () => {
      const all = pages().flatMap((a) => a.rows);
      expect(all).toHaveLength(200);
      for (const r of all) expect(r.volumeRatio.status).toBe('valid');
    });

    it('matches Trendlyne VolumeRatio at 2 dp in all 200 rows (no S2 warning)', () => {
      for (const a of pages()) {
        expect(a.warnings.map((w) => w.code)).not.toContain('PROVIDER_VOLUME_RATIO_MISMATCH');
      }
    });

    it('flags each 100-row page as a possible partial page (M1), non-blocking', () => {
      for (const a of pages()) {
        expect(a.warnings).toContainEqual({
          code: 'POSSIBLE_PARTIAL_PAGE',
          reasons: ['row_count_page_size'],
        });
      }
    });

    it('has 200 valid, disjoint ISINs across both pages, all matched by ISIN', () => {
      const isins = pages().flatMap((a) => a.rows.map((r) => r.identity.normalized_isin));
      expect(new Set(isins).size).toBe(200);
      for (const a of pages()) {
        for (const r of a.rows) {
          expect(r.identity.isin_validation).toBe('valid');
          expect(r.identity.match_method).toBe('isin');
          expect(r.identity.identity_warnings).toEqual([]);
        }
        expect(a.warnings.map((w) => w.code)).not.toContain('DUPLICATE_ISIN_IN_RUN');
      }
    });

    it('accepts real NSE symbols containing & and -', () => {
      const codes = pages().flatMap((a) => a.rows.map((r) => r.identity.normalized_nse_code));
      expect(codes).toEqual(expect.arrayContaining(['M&M', 'M&MFIN', 'GVT&D', 'BAJAJ-AUTO']));
    });

    it('preserves raw cells unchanged (trailing spaces, blank BSE Code)', () => {
      const rows = page1().parsed.rows;
      expect(rows.map((r) => r[1])).toContain('Max Financial ');
      const bse = rows.find((r) => r[19] === 'BSE');
      expect(bse?.[20]).toBe('');
    });
  });

  describe('7-row real run (sample 4)', () => {
    it('computes the recorded app values, all matching Trendlyne at 2 dp', () => {
      const a = analyzed(S4);
      expect(a.canConfirm).toBe(true);
      const byCode = Object.fromEntries(
        a.rows.map((r) => [r.identity.normalized_nse_code, r.volumeRatio.value]),
      );
      expect(byCode).toEqual({
        LGEINDIA: '1.450',
        APOLLOHOSP: '1.420',
        MCX: '1.164',
        OBEROIRLTY: '1.150',
        ENRIN: '1.129',
        JUBLFOOD: '1.046',
        BLUESTARCO: '1.021',
      });
      expect(a.warnings).toEqual([]);
    });
  });

  describe('older exports without the V1 numerator (samples 1 and 2)', () => {
    it.each([S1, S2])('%s is blocked with REQUIRED_COLUMN_MISSING (V2)', (name) => {
      const a = analyzed(name);
      expect(a.canConfirm).toBe(false);
      expect(a.blockingErrors).toEqual([
        { code: 'REQUIRED_COLUMN_MISSING', field: 'volumeNumerator' },
      ]);
      expect(a.rows).toEqual([]);
    });

    it('sample 2 (25 rows) also carries the page-size warning', () => {
      expect(analyzed(S2).warnings).toContainEqual({
        code: 'POSSIBLE_PARTIAL_PAGE',
        reasons: ['row_count_page_size'],
      });
    });
  });
});
