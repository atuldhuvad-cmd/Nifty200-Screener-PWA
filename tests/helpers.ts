import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SAMPLES_DIR = join(ROOT, 'samples');
export const SYNTHETIC_DIR = join(ROOT, 'tests', 'fixtures', 'synthetic');

export const NBSP = String.fromCharCode(0xa0);
export const TAB = String.fromCharCode(0x09);

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function synthetic(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(SYNTHETIC_DIR, name)));
}

/** Reads the reference SHA-256 recorded for `samples/<name>` in DECISIONS.md. */
export function decisionsHashFor(sampleName: string): string {
  const decisions = readFileSync(join(ROOT, 'DECISIONS.md'), 'utf8');
  const line = decisions.split('\n').find((l) => l.includes('`samples/' + sampleName + '`'));
  const hash = line?.match(/`([0-9a-f]{64})`/)?.[1];
  if (!hash) throw new Error(`No SHA-256 recorded in DECISIONS.md for sample: ${sampleName}`);
  return hash;
}

export function sampleExists(name: string): boolean {
  return existsSync(join(SAMPLES_DIR, name));
}

/** Loads a real sample only after its bytes match the hash recorded in DECISIONS.md. */
export function verifiedSample(name: string): Uint8Array {
  const bytes = new Uint8Array(readFileSync(join(SAMPLES_DIR, name)));
  const expected = decisionsHashFor(name);
  const actual = sha256Hex(bytes);
  if (actual !== expected) {
    throw new Error(`Sample hash mismatch for ${name}: expected ${expected}, got ${actual}`);
  }
  return bytes;
}

export const SYNTHETIC_HEADER = [
  'Sl No',
  'Stock',
  'VolumeRatio',
  'Consolidated end of day Vol ',
  'Consolidated 30D average end of day Vol ',
  'NSE Code',
  'ISIN',
];

/** Builds an all-quoted, LF, UTF-8 CSV in memory for generated (SYNTHETIC) cases. */
export function buildCsv(rows: string[][]): Uint8Array {
  const text = rows
    .map((r) => r.map((c) => '"' + c.replaceAll('"', '""') + '"').join(','))
    .join('\n');
  return new TextEncoder().encode(text);
}

/** SYNTHETIC rows with sequential Sl No starting at `firstSl`. */
export function syntheticRows(count: number, firstSl = 1): string[][] {
  return Array.from({ length: count }, (_, i) => [
    String(firstSl + i),
    `Synthetic Row ${i + 1}`,
    '',
    '1500',
    '1000',
    `SYN${i + 1}`,
    '',
  ]);
}
