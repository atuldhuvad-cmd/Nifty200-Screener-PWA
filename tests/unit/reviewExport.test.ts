import { describe, expect, it } from 'vitest';
import { jcsSha256Hex } from '../../src/core/envelope/canonicalHash';
import { validateEnvelope } from '../../src/core/envelope/validate';
import {
  envelopeInspectionExport,
  quarantineBytesExport,
  summarizeEnvelope,
} from '../../src/core/review/export';
import type { QuarantineItemRecord } from '../../src/core/storage/types';
import { withoutKey } from '../helpers';
import { buildTestEnvelope } from '../storage-helpers';

const RUN_A = '11111111-1111-4111-8111-111111111111';

describe('envelopeInspectionExport', () => {
  it('preserves stored content and hash: re-parsed, re-validated, same envelope_sha256', async () => {
    const envelope = await buildTestEnvelope({ runId: RUN_A });
    const out = envelopeInspectionExport(envelope, 'canonical');
    const parsed = JSON.parse(new TextDecoder().decode(out.bytes)) as typeof envelope;
    expect(parsed).toEqual(envelope);
    const verdict = await validateEnvelope(parsed);
    expect(verdict.status).toBe('valid');
    expect(await jcsSha256Hex(withoutKey(parsed, 'envelope_sha256'))).toBe(
      envelope.envelope_sha256,
    );
    expect(out.mimeType).toBe('application/json');
  });

  it('names files from run_id/role/hash only, never the original CSV filename', async () => {
    const envelope = await buildTestEnvelope({ runId: RUN_A });
    const out = envelopeInspectionExport(envelope, 'variant');
    expect(out.filename).toBe(
      `n200-inspect-${RUN_A}-variant-${envelope.envelope_sha256.slice(0, 8)}.json`,
    );
    expect(out.filename).not.toContain(envelope.original_filename);
  });

  it('neutralizes a hostile run_id/hash in an unsupported envelope filename', () => {
    const hostile = {
      run_id: '../../evil\\name<>',
      schema_version: '99',
      envelope_sha256: 'x/../y',
    };
    const out = envelopeInspectionExport(hostile, 'canonical');
    expect(out.filename).toMatch(
      /^n200-inspect-[A-Za-z0-9-]{1,64}-canonical-[A-Za-z0-9]{1,8}\.json$/,
    );
  });
});

describe('quarantineBytesExport', () => {
  it('preserves original bytes exactly, including non-UTF-8 and NUL bytes', () => {
    const original = new Uint8Array([0xff, 0xfe, 0x00, 0x7b, 0x0d, 0x0a, 0x80]);
    const item: QuarantineItemRecord = {
      quarantine_id: '33333333-3333-4333-8333-333333333333',
      original_bytes: original,
      source: 'backup_import',
      observed_sha256: 'a'.repeat(64),
      validation_errors: ['X'],
      discovered_at: '2026-09-29T00:00:00Z',
    };
    const out = quarantineBytesExport(item);
    expect(Array.from(out.bytes)).toEqual(Array.from(original));
    expect(out.mimeType).toBe('application/octet-stream');
    expect(out.filename).toBe('n200-quarantine-33333333-3333-4333-8333-333333333333.bin');
  });
});

describe('summarizeEnvelope', () => {
  it('returns typed display strings for a known envelope', async () => {
    const envelope = await buildTestEnvelope({ runId: RUN_A, effectiveDate: '2026-09-27' });
    const s = summarizeEnvelope(envelope);
    expect(s.runId).toBe(RUN_A);
    expect(s.effectiveDate).toBe('2026-09-27');
    expect(s.envelopeSha256).toBe(envelope.envelope_sha256);
    expect(s.stockCount).toBe(String(envelope.stock_count));
    expect(s.schemaVersion).toBe('1');
  });

  it('shows a placeholder and truncates for untrusted/unsupported content', () => {
    const s = summarizeEnvelope({
      run_id: 'r'.repeat(500),
      schema_version: { not: 'a string' },
    } as never);
    expect(s.runId.length).toBeLessThanOrEqual(101);
    expect(s.effectiveDate).toBe('—');
    expect(s.schemaVersion).toBe('—');
  });
});
