import type { QuarantineItemRecord, RunRecord } from '../storage';

export interface DownloadPayload {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

/** Keep only filename-safe characters; anything else (separators, dots, control chars) is dropped. */
function safeSegment(value: unknown, maxLength: number, fallback: string): string {
  const cleaned = typeof value === 'string' ? value.replace(/[^A-Za-z0-9-]/g, '') : '';
  const cut = cleaned.slice(0, maxLength);
  return cut.length > 0 ? cut : fallback;
}

/**
 * Inspection export of one stored envelope (canonical, or a preserved variant). The envelope is
 * serialized as stored — every field, including `envelope_sha256`, is preserved, so the file
 * re-validates to the same hash; original whitespace is not preserved. The filename is built from
 * `run_id`, role and hash prefix only — never from the original CSV filename — and only from
 * filename-safe characters, since an unsupported envelope's fields are untrusted.
 */
export function envelopeInspectionExport(
  envelope: RunRecord['envelope'],
  role: 'canonical' | 'variant',
): DownloadPayload {
  const runId = safeSegment(envelope.run_id, 64, 'unknown');
  const hash = safeSegment(envelope['envelope_sha256'], 8, 'nohash');
  return {
    filename: `n200-inspect-${runId}-${role}-${hash}.json`,
    mimeType: 'application/json',
    bytes: new TextEncoder().encode(JSON.stringify(envelope, null, 2)),
  };
}

/** Original bytes exactly as preserved, under a neutral name and a non-renderable MIME type. */
export function quarantineBytesExport(item: QuarantineItemRecord): DownloadPayload {
  return {
    filename: `n200-quarantine-${safeSegment(item.quarantine_id, 64, 'unknown')}.bin`,
    mimeType: 'application/octet-stream',
    bytes: item.original_bytes,
  };
}

export interface EnvelopeSummary {
  runId: string;
  schemaVersion: string;
  effectiveDate: string;
  importedAt: string;
  stockCount: string;
  envelopeSha256: string;
}

const PLACEHOLDER = '—';
const DISPLAY_MAX = 100;

function display(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string' || value.length === 0) return PLACEHOLDER;
  return value.length > DISPLAY_MAX ? `${value.slice(0, DISPLAY_MAX)}…` : value;
}

/** Display-safe metadata for an envelope of any (including unknown) schema: strings/numbers
 * only, truncated, with a placeholder for anything absent or of an unexpected type. */
export function summarizeEnvelope(envelope: RunRecord['envelope']): EnvelopeSummary {
  return {
    runId: display(envelope.run_id),
    schemaVersion: display(envelope.schema_version),
    effectiveDate: display(envelope['effective_date']),
    importedAt: display(envelope['imported_at']),
    stockCount: display(envelope['stock_count']),
    envelopeSha256: display(envelope['envelope_sha256']),
  };
}
