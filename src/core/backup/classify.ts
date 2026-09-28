import type { RunEnvelopeV1, RunEnvelopeV2 } from '../envelope/types';
import {
  decideRouting,
  findRunsBySourceFileHash,
  getRun,
  parseIngestCandidate,
  type N200Database,
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
 * (`getRun`, `findRunsBySourceFileHash`) but performs **no writes at all**, including no
 * `quarantine_items` writes for an entry that would be rejected — those only happen once the
 * user confirms and `commitBackupImport` runs. Like every other duplicate-hash preview in this
 * app, this read is advisory: a concurrent change between preview and confirm can make the
 * real, atomic commit-time decision differ from what was previewed — the commit step is what's
 * authoritative, not this one.
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

  for (const [index, envelope] of file.runs.entries()) {
    const bytes = new TextEncoder().encode(JSON.stringify(envelope));
    const candidate = await parseIngestCandidate(bytes);

    let category: BackupEntryCategory;
    let runId: string | undefined;

    if (candidate.status === 'parse_failed' || candidate.status === 'quarantined') {
      category = 'rejected';
    } else if (candidate.status === 'unsupported_schema') {
      runId = candidate.envelope.run_id;
      const existing = await getRun(db, runId);
      const decision = decideRouting(candidate, existing);
      category = decision.action === 'quarantine_run_id_occupied' ? 'rejected' : 'unsupported';
    } else {
      runId = candidate.envelope.run_id;
      const existing = await getRun(db, runId);
      const decision = decideRouting(candidate, existing);
      if (decision.action === 'already_present') {
        category = 'already_present';
      } else if (decision.action === 'add_variant_and_conflict') {
        category = 'conflict';
      } else {
        // 'add_new': refine into 'duplicate' when any of this entry's own source-file hashes
        // already belongs to a currently-stored run (brief: "permitted duplicate, with a
        // warning" — still added on confirm, just counted/labelled distinctly here).
        const hashes = sourceHashesOf(candidate.envelope);
        let isDuplicate = false;
        for (const hash of hashes) {
          if ((await findRunsBySourceFileHash(db, hash)).length > 0) {
            isDuplicate = true;
            break;
          }
        }
        category = isDuplicate ? 'duplicate' : 'added';
      }
    }

    counts[category] += 1;
    entries.push({ index, runId, category });
  }

  return { counts, entries };
}
