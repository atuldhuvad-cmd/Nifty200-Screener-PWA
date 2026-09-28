import { ingestEnvelopeBytes, type IngestOutcome, type N200Database } from '../storage';
import type { BackupFile } from './manifest';

/** `IngestOutcome` plus one kind this module alone can produce: a genuinely unexpected failure
 * (e.g. a storage-quota error) distinct from an ordinary data-quality `quarantined` outcome —
 * no `quarantine_items` row exists for this entry, unlike a real quarantine. */
export type BackupEntryOutcome = IngestOutcome | { kind: 'error'; message: string };

export interface BackupImportEntryResult {
  index: number;
  outcome: BackupEntryOutcome;
}

/**
 * The confirmed-import step: only called after the user has seen `previewBackupImport`'s
 * counts and explicitly confirmed. Processes every entry **independently** through the
 * existing, unmodified `ingestEnvelopeBytes` (re-serialized back to bytes and re-parsed and
 * re-validated from scratch — nothing is trusted just because it was already parsed once
 * during preview) — each call is already fully atomic and self-contained per entry (Bugbot
 * P1-1), so one corrupt or divergent entry quarantines/conflicts on its own without aborting
 * any other entry in the same backup file. Never throws: a genuinely unexpected failure for one
 * entry (e.g. a storage-quota error, not a data-quality one) is recorded as its own outcome
 * rather than stopping the batch, so "process entries independently" holds even for failures
 * `ingestEnvelopeBytes` itself doesn't normally produce.
 */
export async function commitBackupImport(
  db: N200Database,
  file: BackupFile,
): Promise<BackupImportEntryResult[]> {
  const results: BackupImportEntryResult[] = [];

  for (const [index, envelope] of file.runs.entries()) {
    const bytes = new TextEncoder().encode(JSON.stringify(envelope));
    try {
      const outcome = await ingestEnvelopeBytes(db, bytes, 'backup_import', {
        detection_context: 'backup_import_scan',
        backup_entry_index: index,
      });
      results.push({ index, outcome });
    } catch (e) {
      results.push({
        index,
        outcome: { kind: 'error', message: e instanceof Error ? e.message : 'UNKNOWN_ERROR' },
      });
    }
  }

  return results;
}
