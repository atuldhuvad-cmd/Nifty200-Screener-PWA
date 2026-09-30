import type { RunRecord } from '../storage';
import {
  applyTransition,
  ensureDriveFileId,
  ensureSyncProfile,
  getRun,
  ingestEnvelopeBytes,
  isSupportedEnvelope,
  replaceDriveFileId,
  setDriveMetadata,
  updateSyncProfile,
  type N200Database,
} from '../storage';
import { runProperties, folderProperties, folderQuery, FOLDER_NAME } from './appProperties';
import type { DriveClient, DriveFile } from './driveClient';
import { DriveError } from './errors';
import { md5Hex } from './md5';

export interface SyncContext {
  db: N200Database;
  client: DriveClient;
  signal?: AbortSignal;
}

export type UploadOutcome =
  | { status: 'uploaded'; fileId: string }
  | { status: 'skipped'; reason: string }
  | { status: 'conflict' }
  | { status: 'blocked'; reason: 'FOLDER_CONFLICT' }
  | { status: 'interrupted' }
  | { status: 'cancelled' }
  | { status: 'reconnect_required' }
  | { status: 'failed'; code: string; retryable: boolean };

/** The exact bytes uploaded to Drive: the stored envelope, serialized (never the CSV filename). */
export function serializeEnvelope(envelope: RunRecord['envelope']): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(envelope));
}

/**
 * Which runs may be uploaded automatically. `conflict`, `quarantined` and `unsupported_schema`
 * runs never are (brief: excluded from automatic upload until resolved); `local_only` only when
 * the user explicitly asks; `remote_missing` only through `restoreToDrive`; `synced`/`syncing`
 * have nothing to upload. An `error` run whose failure was permanent waits for the user.
 */
export function isUploadEligible(
  run: RunRecord,
  options: { explicit?: boolean } = {},
): { eligible: true } | { eligible: false; reason: string } {
  if (!isSupportedEnvelope(run.envelope)) return { eligible: false, reason: 'UNSUPPORTED_SCHEMA' };
  const { state, diagnostics } = run.sync;
  if (state === 'pending') return { eligible: true };
  if (state === 'error') {
    return diagnostics.retryable === false && options.explicit !== true
      ? { eligible: false, reason: 'ERROR_NOT_RETRYABLE' }
      : { eligible: true };
  }
  if (state === 'local_only' && options.explicit === true) return { eligible: true };
  return { eligible: false, reason: `STATE_${state.toUpperCase()}` };
}

export type FolderResult =
  { kind: 'ready'; folderId: string } | { kind: 'conflict'; folders: DriveFile[] };

/**
 * The folder uploads go to. Uses the profile's active folder; otherwise looks for existing tagged
 * folders (adopting exactly one, surfacing several as a conflict without merging or choosing),
 * and only if there are none creates one. Creation is idempotent: the folder ID is generated and
 * persisted BEFORE the first create call, so a timed-out attempt retried later reuses it (a 409
 * means it exists: it is verified and adopted, never duplicated).
 */
export async function ensureAppFolder(ctx: SyncContext): Promise<FolderResult> {
  const signal = ctx.signal === undefined ? {} : { signal: ctx.signal };
  const profile = await ensureSyncProfile(ctx.db);
  if (profile.active_folder_id !== null) {
    return { kind: 'ready', folderId: profile.active_folder_id };
  }

  const existing = await ctx.client.listFiles({ q: folderQuery(), ...signal });
  await updateSyncProfile(ctx.db, (p) => ({
    ...p,
    known_folder_ids: [...new Set([...p.known_folder_ids, ...existing.map((f) => f.id)])],
  }));
  if (existing.length > 1) return { kind: 'conflict', folders: existing };
  if (existing.length === 1 && existing[0] !== undefined) {
    const only = existing[0].id;
    await updateSyncProfile(ctx.db, (p) => ({
      ...p,
      active_folder_id: only,
      pending_folder_id: null,
    }));
    return { kind: 'ready', folderId: only };
  }

  // The folder ID is generated and persisted BEFORE the first create call, so a retry after a
  // timeout reuses it. If two tabs race, the first persisted ID wins for both.
  let pending = profile.pending_folder_id;
  if (pending === null) {
    const [generated] = await ctx.client.generateIds(1, signal);
    if (generated === undefined) throw new DriveError('protocol');
    const saved = await updateSyncProfile(ctx.db, (p) => ({
      ...p,
      pending_folder_id: p.pending_folder_id ?? generated,
    }));
    pending = saved.pending_folder_id ?? generated;
  }

  try {
    await ctx.client.createFolder({
      id: pending,
      name: FOLDER_NAME,
      appProperties: folderProperties(),
      ...signal,
    });
  } catch (error) {
    if (!(error instanceof DriveError) || error.kind !== 'conflict') throw error;
    // The ID already exists (a previous attempt succeeded but its response was lost): verify it
    // really is our tagged folder, then adopt it.
    const probe = await ctx.client.probeFile(pending, signal);
    const tagged = probe.file?.appProperties?.['n200_kind'] === 'folder';
    if (probe.state !== 'present' || !tagged) throw error;
  }
  const folderId = pending;
  await updateSyncProfile(ctx.db, (p) => ({
    ...p,
    active_folder_id: folderId,
    pending_folder_id: null,
    known_folder_ids: [...new Set([...p.known_folder_ids, folderId])],
  }));
  return { kind: 'ready', folderId };
}

/** The user's explicit choice of upload destination when several app folders exist. */
export async function selectActiveFolder(db: N200Database, folderId: string): Promise<void> {
  await updateSyncProfile(db, (p) => ({
    ...p,
    active_folder_id: folderId,
    known_folder_ids: [...new Set([...p.known_folder_ids, folderId])],
  }));
}

type Attempt =
  | { kind: 'success'; fileId: string }
  | { kind: 'conflict' }
  | { kind: 'id_occupied' }
  | { kind: 'blocked'; reason: 'FOLDER_CONFLICT' }
  | { kind: 'verify_failed' };

/**
 * Runs `body` for a run that has just been moved to `syncing`, and maps every way it can end onto
 * exactly one state-machine event, so a run is never left in `syncing`. All state changes go
 * through `applyTransition`.
 */
async function withSyncing(
  ctx: SyncContext,
  runId: string,
  body: () => Promise<Attempt>,
): Promise<UploadOutcome> {
  try {
    const attempt = await body();
    if (attempt.kind === 'success') {
      await applyTransition(ctx.db, runId, { type: 'SYNC_SUCCEEDED' });
      return { status: 'uploaded', fileId: attempt.fileId };
    }
    if (attempt.kind === 'conflict') return { status: 'conflict' };
    if (attempt.kind === 'id_occupied') {
      await applyTransition(ctx.db, runId, {
        type: 'SYNC_FAILED',
        errorCode: 'DRIVE_ID_OCCUPIED',
        retryable: false,
      });
      return { status: 'failed', code: 'DRIVE_ID_OCCUPIED', retryable: false };
    }
    if (attempt.kind === 'blocked') {
      await applyTransition(ctx.db, runId, { type: 'SYNC_CANCELLED' });
      return { status: 'blocked', reason: attempt.reason };
    }
    await applyTransition(ctx.db, runId, {
      type: 'SYNC_FAILED',
      errorCode: 'UPLOAD_VERIFY_FAILED',
      retryable: true,
    });
    return { status: 'failed', code: 'UPLOAD_VERIFY_FAILED', retryable: true };
  } catch (error) {
    if (!(error instanceof DriveError)) {
      await applyTransition(ctx.db, runId, {
        type: 'SYNC_FAILED',
        errorCode: 'SYNC_INTERNAL_ERROR',
        retryable: false,
      });
      throw error;
    }
    switch (error.kind) {
      case 'unauthorized':
        // Account-level: the client already set reconnect_required. The run returns to its
        // previous stable state with no diagnostic; nothing about the run is judged.
        await applyTransition(ctx.db, runId, { type: 'SYNC_CANCELLED' });
        return { status: 'reconnect_required' };
      case 'cancelled':
        await applyTransition(ctx.db, runId, { type: 'SYNC_CANCELLED' });
        return { status: 'cancelled' };
      case 'timeout':
      case 'network':
        await applyTransition(ctx.db, runId, { type: 'SYNC_TIMEOUT' });
        return { status: 'interrupted' };
      default:
        await applyTransition(ctx.db, runId, {
          type: 'SYNC_FAILED',
          errorCode: error.code,
          retryable: error.retryable,
        });
        return { status: 'failed', code: error.code, retryable: error.retryable };
    }
  }
}

/** Upload (or verify) this run's envelope under its persisted Drive file ID. */
async function transfer(ctx: SyncContext, run: RunRecord): Promise<Attempt> {
  const signal = ctx.signal === undefined ? {} : { signal: ctx.signal };
  if (!isSupportedEnvelope(run.envelope)) throw new DriveError('protocol');
  const envelope = run.envelope;

  const folder = await ensureAppFolder(ctx);
  if (folder.kind === 'conflict') return { kind: 'blocked', reason: 'FOLDER_CONFLICT' };

  const fileId = await ensureDriveFileId(ctx.db, run.run_id, async () => {
    const [id] = await ctx.client.generateIds(1, signal);
    if (id === undefined) throw new DriveError('protocol');
    return id;
  });

  const bytes = serializeEnvelope(envelope);
  const localMd5 = md5Hex(bytes);
  let file: DriveFile;
  try {
    file = await ctx.client.uploadFileResumable({
      id: fileId,
      name: `run-${run.run_id}.json`,
      parents: [folder.folderId],
      appProperties: runProperties(envelope),
      bytes,
      sessionKey: `run:${run.run_id}`,
      ...signal,
    });
  } catch (error) {
    if (!(error instanceof DriveError) || error.kind !== 'conflict') throw error;
    // The pre-generated ID already exists remotely. Never upload again under a new ID:
    // retrieve it and verify what it holds.
    const remoteBytes = await ctx.client.downloadFile(fileId, signal);
    if (md5Hex(remoteBytes) === localMd5) {
      file = await ctx.client.getFile(fileId, signal);
    } else {
      // Different content at our own ID: preserve it as a remote variant, mark a conflict.
      const outcome = await ingestEnvelopeBytes(ctx.db, remoteBytes, 'drive', {
        drive_file_id: fileId,
        detection_context: 'drive_folder_scan',
      });
      // Only a divergent copy of THIS run is a conflict. Anything else at our pre-assigned ID
      // (an unrelated or malformed file) is not ours to overwrite or interpret: stop, keep the
      // run pending review, and let the user decide.
      return outcome.kind === 'conflict' && outcome.run_id === run.run_id
        ? { kind: 'conflict' }
        : { kind: 'id_occupied' };
    }
  }

  const verified = file.md5Checksum === localMd5 ? file : await ctx.client.getFile(fileId, signal);
  if (verified.md5Checksum !== localMd5) return { kind: 'verify_failed' };

  await setDriveMetadata(ctx.db, run.run_id, {
    folder_id: folder.folderId,
    version: verified.version ?? null,
    md5_checksum: verified.md5Checksum ?? null,
  });
  return { kind: 'success', fileId };
}

export async function uploadRun(
  ctx: SyncContext,
  runId: string,
  options: { explicit?: boolean } = {},
): Promise<UploadOutcome> {
  const run = await getRun(ctx.db, runId);
  if (!run) return { status: 'skipped', reason: 'RUN_NOT_FOUND' };
  const eligibility = isUploadEligible(run, options);
  if (!eligibility.eligible) return { status: 'skipped', reason: eligibility.reason };

  const started = await applyTransition(ctx.db, runId, { type: 'START_SYNC' });
  if (!started.ok) return { status: 'skipped', reason: 'INVALID_TRANSITION' };
  return withSyncing(ctx, runId, () => transfer(ctx, run));
}

/**
 * "Restore to Drive" for a `remote_missing` run: a RECOVERY operation. A file that was only
 * trashed is untrashed and re-verified under its existing ID; a permanently deleted file gets a
 * NEW pre-generated ID and the same immutable envelope is uploaded under it.
 */
export async function restoreToDrive(ctx: SyncContext, runId: string): Promise<UploadOutcome> {
  const run = await getRun(ctx.db, runId);
  if (!run) return { status: 'skipped', reason: 'RUN_NOT_FOUND' };
  if (run.sync.state !== 'remote_missing' || !isSupportedEnvelope(run.envelope)) {
    return { status: 'skipped', reason: `STATE_${run.sync.state.toUpperCase()}` };
  }
  const started = await applyTransition(ctx.db, runId, { type: 'START_SYNC' });
  if (!started.ok) return { status: 'skipped', reason: 'INVALID_TRANSITION' };

  return withSyncing(ctx, runId, async () => {
    const signal = ctx.signal === undefined ? {} : { signal: ctx.signal };
    const oldId = run.sync.drive?.file_id;
    if (oldId !== undefined) {
      const probe = await ctx.client.probeFile(oldId, signal);
      if (probe.state === 'inaccessible')
        throw new DriveError('forbidden', { reason: 'inaccessible' });
      if (probe.state === 'trashed') await ctx.client.untrash(oldId, signal);
      if (probe.state === 'trashed' || probe.state === 'present') {
        const localMd5 = md5Hex(serializeEnvelope(run.envelope));
        const file = await ctx.client.getFile(oldId, signal);
        if (file.md5Checksum !== localMd5) return { kind: 'verify_failed' };
        await setDriveMetadata(ctx.db, runId, {
          version: file.version ?? null,
          md5_checksum: file.md5Checksum ?? null,
        });
        return { kind: 'success', fileId: oldId };
      }
      // Permanently deleted: a NEW identity, persisted before the upload begins.
      const [fresh] = await ctx.client.generateIds(1, signal);
      if (fresh === undefined) throw new DriveError('protocol');
      await replaceDriveFileId(ctx.db, runId, fresh);
    }
    const current = await getRun(ctx.db, runId);
    if (!current) throw new DriveError('protocol');
    return transfer(ctx, current);
  });
}
