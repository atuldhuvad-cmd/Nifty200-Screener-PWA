import { analyzeCsvBytes } from '../src/core/csv/analyze';
import { buildEnvelope } from '../src/core/envelope/build';
import type { RunEnvelopeV1 } from '../src/core/envelope/types';
import { synthetic } from './helpers';

let counter = 0;

/** A fresh, unique database name per call, so tests never see another test's data. */
export function freshDbName(): string {
  counter += 1;
  return `n200-test-${Date.now()}-${counter}-${Math.random().toString(36).slice(2)}`;
}

export interface TestEnvelopeOptions {
  fixture?: string;
  runId?: string;
  effectiveDate?: string;
  importedAt?: Date;
}

/** Builds a real, schema-valid envelope from a SYNTHETIC fixture, for storage-layer tests. */
export async function buildTestEnvelope(options: TestEnvelopeOptions = {}): Promise<RunEnvelopeV1> {
  const fixture = options.fixture ?? 'SYNTHETIC_crlf_final_newline.csv';
  const bytes = synthetic(fixture);
  const analysis = analyzeCsvBytes(bytes);
  if (!analysis.ok || !analysis.canConfirm)
    throw new Error(`fixture did not analyze cleanly: ${fixture}`);
  const result = await buildEnvelope({
    originalBytes: bytes,
    analysis,
    originalFilename: fixture,
    originalFileMimeType: 'text/csv',
    effectiveDate: options.effectiveDate ?? '2026-09-27',
    ...(options.importedAt !== undefined ? { importedAt: options.importedAt } : {}),
    ...(options.runId !== undefined ? { runId: options.runId } : {}),
  });
  if (!result.ok) throw new Error(`build failed: ${result.reason}`);
  return result.envelope;
}
