import {
  ACTIVITY_LOCK_NAME,
  ingestEnvelopeBytes,
  withRequiredLock,
  type IngestOutcome,
  type N200Database,
} from '../storage';
import type { BackupFile } from './manifest';

/** A restore holds the shared activity lock name exclusively (see `ACTIVITY_LOCK_NAME`), which
 * also keeps a service-worker update from activating mid-restore. */
export const BACKUP_RESTORE_LOCK_NAME = ACTIVITY_LOCK_NAME;

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
 * any other entry in the same backup file.
 *
 * The whole restore runs under one exclusive Web Lock (`BACKUP_RESTORE_LOCK_NAME`) so two tabs
 * never restore at once, and **fails closed** — throws `WebLocksUnavailableError` before writing
 * anything — when Web Locks are unavailable. The lock serializes tabs only; it does **not** make
 * the multi-entry restore one atomic transaction. The per-entry `ingestEnvelopeBytes`
 * transactions remain the sole atomicity guarantee, so a restore interrupted midway leaves every
 * already-processed entry committed and every later one untouched.
 *
 * Apart from that lock failure, never throws: a genuinely unexpected failure for one
 * entry (e.g. a storage-quota error, not a data-quality one) is recorded as its own outcome
 * rather than stopping the batch, so "process entries independently" holds even for failures
 * `ingestEnvelopeBytes` itself doesn't normally produce.
 */
export async function commitBackupImport(
  db: N200Database,
  file: BackupFile,
): Promise<BackupImportEntryResult[]> {
  return withRequiredLock(BACKUP_RESTORE_LOCK_NAME, () => restoreEntries(db, file));
}

async function restoreEntries(
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
