import { STORE, type N200Database } from './schema';
import { safeAbort } from './txUtils';
import type { DriveMetadata } from './types';

/**
 * Drive bookkeeping on a run's sync record. These functions write `sync.drive` ONLY: a run's
 * sync `state` and diagnostics still change exclusively through `applyTransition`.
 */

/**
 * Returns the run's pre-generated Drive file ID, generating and persisting one first if there is
 * none. The ID is durable in IndexedDB before this resolves, so an upload retry after any crash
 * or reload reuses it, and a retry can never mint a second Drive file for the same run. The
 * generator (a network call) runs outside the transaction; if two callers race, the first write
 * wins and both return that same ID.
 */
export async function ensureDriveFileId(
  db: N200Database,
  runId: string,
  generate: () => Promise<string>,
): Promise<string> {
  const existing = (await db.get(STORE.runs, runId))?.sync.drive?.file_id;
  if (existing !== undefined) return existing;

  const candidate = await generate();
  const tx = db.transaction(STORE.runs, 'readwrite');
  try {
    const store = tx.objectStore(STORE.runs);
    const record = await store.get(runId);
    if (!record) throw new Error('DRIVE_METADATA_RUN_NOT_FOUND');
    const current = record.sync.drive?.file_id;
    if (current !== undefined) {
      await tx.done;
      return current;
    }
    const drive: DriveMetadata = {
      file_id: candidate,
      folder_id: null,
      version: null,
      md5_checksum: null,
    };
    await store.put({ ...record, sync: { ...record.sync, drive } });
    await tx.done;
    return candidate;
  } catch (e) {
    safeAbort(tx);
    throw e;
  }
}

/** Merges fields into `sync.drive` (which must already exist). Returns false if the run or its
 * Drive record does not exist. Never touches sync state. */
export async function setDriveMetadata(
  db: N200Database,
  runId: string,
  patch: Partial<Omit<DriveMetadata, 'file_id'>>,
): Promise<boolean> {
  const tx = db.transaction(STORE.runs, 'readwrite');
  try {
    const store = tx.objectStore(STORE.runs);
    const record = await store.get(runId);
    if (!record?.sync.drive) {
      safeAbort(tx);
      return false;
    }
    await store.put({
      ...record,
      sync: { ...record.sync, drive: { ...record.sync.drive, ...patch } },
    });
    await tx.done;
    return true;
  } catch (e) {
    safeAbort(tx);
    throw e;
  }
}

/**
 * Records a NEW Drive identity for a run whose previous file was permanently deleted (a recovery
 * operation, not a retry). The stale version and checksum belong to the old file and are cleared.
 * The run's `run_id` and immutable envelope are untouched.
 */
export async function replaceDriveFileId(
  db: N200Database,
  runId: string,
  newFileId: string,
): Promise<void> {
  const tx = db.transaction(STORE.runs, 'readwrite');
  try {
    const store = tx.objectStore(STORE.runs);
    const record = await store.get(runId);
    if (!record) throw new Error('DRIVE_METADATA_RUN_NOT_FOUND');
    const drive: DriveMetadata = {
      file_id: newFileId,
      folder_id: record.sync.drive?.folder_id ?? null,
      version: null,
      md5_checksum: null,
    };
    await store.put({ ...record, sync: { ...record.sync, drive } });
    await tx.done;
  } catch (e) {
    safeAbort(tx);
    throw e;
  }
}
