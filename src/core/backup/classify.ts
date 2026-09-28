import type { RunEnvelopeV1, RunEnvelopeV2 } from '../envelope/types';
import {
  decideRouting,
  getAllRuns,
  initialSyncRecord,
  parseIngestCandidate,
  type N200Database,
  type RunRecord,
} from '../storage';
import type { BackupFile } from './manifest';

/**
 * The six preview buckets this round's UI reports counts for. `duplicate` and `added` are both
 * "would commit as a new run" outcomes — `duplicate` is the brief's "different run_id sharing
 * the same source-file hash → permitted duplicate, with a warning" refinement, layered on top
 * of `decideRouting`'s plain `add_new` (never a separate routing rule — see below). `rejected`
 * covers everything `ingestEnvelopeBytes` would quarantine (malformed JSON, schema-invalid,
 * failed replay, or an unsupported-schema entry with no usable `run_id`).
 */
export const BACKUP_ENTRY_CATEGORIES = [
  'added',
  'already_present',
  'duplicate',
  'conflict',
  'unsupported',
  'rejected',
] as const;
export type BackupEntryCategory = (typeof BACKUP_ENTRY_CATEGORIES)[number];

export interface BackupEntryPreview {
  index: number;
  runId: string | undefined;
  category: BackupEntryCategory;
}

export interface BackupPreview {
  counts: Record<BackupEntryCategory, number>;
  entries: BackupEntryPreview[];
}

function sourceHashesOf(envelope: RunEnvelopeV1 | RunEnvelopeV2): string[] {
  return envelope.schema_version === '1'
    ? [envelope.original_file_sha256]
    : envelope.source_files.map((sf) => sf.original_file_sha256);
}

/**
 * Read-only preview classification: for each entry in an already-parsed backup file, decides
 * which of the six categories it would fall into on confirmed import, using the exact same
 * `parseIngestCandidate`/`decideRouting` rules `ingestEnvelopeBytes` itself uses — never a
 * second, independently-maintained copy of the routing logic. This reads current storage state
 * but performs **no writes at all**, including no `quarantine_items` writes for an entry that
 * would be rejected — those only happen once the user confirms and `commitBackupImport` runs.
 * Like every other duplicate-hash preview in this app, this read is advisory: a concurrent
 * change between preview and confirm can make the real, atomic commit-time decision differ from
 * what was previewed — the commit step is what's authoritative, not this one.
 *
 * Loads the canonical run set exactly once (`getAllRuns`) and builds an in-memory run_id and
 * source-hash lookup from it, rather than the run_id-count and hash-count full-store scans this
 * previously issued per entry. It also tracks, entry by entry, what run_id slots this same
 * preview's own earlier "added"/"unsupported" entries would occupy once actually committed
 * (`commitBackupImport` processes entries sequentially through the same `ingestEnvelopeBytes`
 * used elsewhere) — so a backup file containing two entries for the same run_id previews the
 * second one exactly as sequential commit would resolve it (identical envelope →
 * already_present; divergent envelope → conflict/variant), instead of both previewing as
 * "added".
 */
export async function previewBackupImport(
  db: N200Database,
  file: BackupFile,
): Promise<BackupPreview> {
  const counts: Record<BackupEntryCategory, number> = {
    added: 0,
    already_present: 0,
    duplicate: 0,
    conflict: 0,
    unsupported: 0,
    rejected: 0,
  };
  const entries: BackupEntryPreview[] = [];

  const canonicalRuns = await getAllRuns(db);
  const runsById = new Map<string, RunRecord>(canonicalRuns.map((r) => [r.run_id, r]));
  const runIdsByHash = new Map<string, Set<string>>();
  const indexHash = (hash: string, runId: string): void => {
    const set = runIdsByHash.get(hash);
    if (set) set.add(runId);
    else runIdsByHash.set(hash, new Set([runId]));
  };
  for (const r of canonicalRuns) {
    for (const hash of recordSourceHashesOf(r.envelope)) indexHash(hash, r.run_id);
  }

  for (const [index, envelope] of file.runs.entries()) {
    const bytes = new TextEncoder().encode(JSON.stringify(envelope));
    const candidate = await parseIngestCandidate(bytes);

    let category: BackupEntryCategory;
    let runId: string | undefined;

    if (candidate.status === 'parse_failed' || candidate.status === 'quarantined') {
      category = 'rejected';
    } else if (candidate.status === 'unsupported_schema') {
      runId = candidate.envelope.run_id;
      const decision = decideRouting(candidate, runsById.get(runId));
      category = decision.action === 'quarantine_run_id_occupied' ? 'rejected' : 'unsupported';
      if (decision.action === 'add_unsupported') {
        runsById.set(runId, {
          run_id: runId,
          envelope: candidate.envelope,
          sync: initialSyncRecord('unsupported_schema'),
        });
      }
    } else {
      runId = candidate.envelope.run_id;
      const decision = decideRouting(candidate, runsById.get(runId));
      if (decision.action === 'already_present') {
        category = 'already_present';
      } else if (decision.action === 'add_variant_and_conflict') {
        category = 'conflict';
      } else {
        // 'add_new': refine into 'duplicate' when any of this entry's own source-file hashes
        // already belongs to a currently-stored (or, within this same file, already
        // "added"-by-an-earlier-entry) run — brief: "permitted duplicate, with a warning" —
        // still added on confirm, just counted/labelled distinctly here.
        const hashes = sourceHashesOf(candidate.envelope);
        const isDuplicate = hashes.some((h) => (runIdsByHash.get(h)?.size ?? 0) > 0);
        category = isDuplicate ? 'duplicate' : 'added';

        runsById.set(runId, {
          run_id: runId,
          envelope: candidate.envelope,
          sync: initialSyncRecord('pending'),
        });
        for (const h of hashes) indexHash(h, runId);
      }
    }

    counts[category] += 1;
    entries.push({ index, runId, category });
  }

  return { counts, entries };
}

function recordSourceHashesOf(envelope: RunRecord['envelope']): string[] {
  if (envelope.schema_version !== '1' && envelope.schema_version !== '2') return [];
  return sourceHashesOf(envelope as RunEnvelopeV1 | RunEnvelopeV2);
}
