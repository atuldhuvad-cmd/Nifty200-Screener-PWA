import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Brief: "No sync state is ever assigned outside the single state-machine function". This is the
// structural check that test-by-behaviour cannot give: it reads the source.

const STATE_NAMES = [
  'pending',
  'syncing',
  'synced',
  'error',
  'remote_missing',
  'local_only',
  'conflict',
  'quarantined',
  'unsupported_schema',
];
/** The state machine, and the type declarations that define the set. */
const OWNERS = new Set(['src/core/storage/syncState.ts', 'src/core/storage/types.ts']);
/** The only sanctioned way to create a record outside the machine: a new run starts `pending`. */
const INITIAL_ALLOWED = [
  'src/core/backup/classify.ts',
  'src/core/storage/ingest.ts',
  'src/core/storage/runs.ts',
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|svelte)$/.test(name) && !name.endsWith('.d.ts')
      ? [path.split(String.fromCharCode(92)).join('/')]
      : [];
  });
}

const files = sourceFiles('src').filter((f) => !OWNERS.has(f));

describe('sync state is only assigned by the state machine', () => {
  it('scans a non-trivial set of files', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it('no file outside the machine assigns or constructs a sync state directly', () => {
    const offenders: string[] = [];
    const names = STATE_NAMES.join('|');
    const assignment = new RegExp(String.raw`\.state\s*=(?!=)|\bstate\s*:\s*['"](?:${names})['"]`);
    for (const file of files) {
      if (assignment.test(readFileSync(file, 'utf8'))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('a new record is born only as pending, or unsupported_schema for a future envelope version, and only where a run is first stored', () => {
    const callers: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const calls = [...text.matchAll(/initialSyncRecord\(([^)]*)\)/g)];
      if (calls.length > 0) callers.push(file);
      for (const call of calls) expect(["'pending'", "'unsupported_schema'"]).toContain(call[1]);
    }
    expect(callers.sort()).toEqual(INITIAL_ALLOWED);
  });

  it('every state change elsewhere goes through applyTransition', () => {
    const mutators = files.filter((f) => /\bapplyTransition\(/.test(readFileSync(f, 'utf8')));
    expect(mutators.length).toBeGreaterThan(0);
    for (const f of mutators) expect(f).toMatch(/^src\/(core|lib)\//);
  });
});
