import { describe, expect, it } from 'vitest';
import { projectRunRows } from '../../src/core/display';
import {
  fetchNifty200Constituents,
  parseNifty200Constituents,
  verifyRowsAgainstNifty200,
} from '../../src/core/universe';
import { buildTestEnvelope } from '../storage-helpers';

const enc = new TextEncoder();

describe('Nifty 200 universe verification', () => {
  it('parses the official NSE/Nifty Indices constituents CSV shape', () => {
    const parsed = parseNifty200Constituents(
      enc.encode(
        [
          'Company Name,Industry,Symbol,Series,ISIN Code',
          'Alpha Ltd.,Capital Goods,ALPHA,EQ,INE000A01010',
          'Beta Ltd.,Financial Services,BETA,EQ,INE000B01010',
        ].join('\n'),
      ),
    );
    expect(parsed).toEqual({
      ok: true,
      constituents: [
        { symbol: 'ALPHA', isin: 'INE000A01010' },
        { symbol: 'BETA', isin: 'INE000B01010' },
      ],
    });
  });

  it('compares a run against constituents by ISIN first and then NSE symbol', async () => {
    const envelope = await buildTestEnvelope({ fixture: 'SYNTHETIC_crlf_final_newline.csv' });
    const projection = projectRunRows(envelope);
    const result = verifyRowsAgainstNifty200(
      projection.rows,
      [
        { symbol: 'IGNORED', isin: 'ZZSYNTH00015' },
        { symbol: 'SYNB', isin: '' },
      ],
      '2026-10-02T12:00:00.000Z',
    );

    expect(result).toMatchObject({
      checkedAt: '2026-10-02T12:00:00.000Z',
      constituentCount: 2,
      runRows: 3,
      matchedRows: 2,
      missingRows: [{ position: 3, identity: 'ISIN ZZSYNTH00031' }],
      unverifiedRows: [],
    });
  });

  it('times out instead of leaving the membership fetch pending forever', async () => {
    const neverFetches: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    await expect(
      fetchNifty200Constituents({ fetchFn: neverFetches, timeoutMs: 1 }),
    ).resolves.toEqual({
      ok: false,
      message: 'The NSE Nifty 200 list did not respond in time. Try again later.',
    });
  });
});
