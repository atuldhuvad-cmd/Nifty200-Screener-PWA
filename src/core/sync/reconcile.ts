import {
  applyTransition,
  ensureDriveFileId,
  getAllRuns,
  getRun,
  ingestEnvelopeBytes,
  parseIngestCandidate,
  quarantineBytes,
  setDriveMetadata,
  updateSyncProfile,
  type RunRecord,
} from '../storage';
import { folderQuery, propertiesMatchEnvelope, runFileQuery } from './appProperties';
import type { DriveFile } from './driveClient';
import { DriveError } from './errors';
import { md5Hex } from './md5';
import { checkActiveFolder, type ActiveFolderAction, type SyncContext } from './upload';

/** A remote run file larger than this is not downloaded: it cannot be a valid run envelope. */
const MAX_REMOTE_BYTES = 64 * 1024 * 1024;

export type FileResult =
  | 'unchanged'
  | 'committed'
  | 'linked'
  | 'already_present'
  | 'refreshed'
  /** A `remote_missing` run whose saved file reappeared and validated: synced again. */
  | 'recovered'
  | 'conflict'
  | 'quarantined'
  | 'unsupported_schema'
  | 'duplicate_remote'
  | 'too_large'
  /** The listing itself says the file is in Drive's Trash (a lagging search index): not read. */
  | 'trashed';

export interface FileOutcome {
  fileId: string;
  /** The run id from the file's own validated content; null when it could not be validated. */
  runId: string | null;
  /** A diagnostic attribute (not a sync state): the file sits outside every known app folder. */
  orphaned: boolean;
  result: FileResult;
}

export interface DiscoveryReport {
  folders: DriveFile[];
  /** More than one app folder exists: surfaced for the user, never merged or resolved here. */
  folderConflict: boolean;
  files: FileOutcome[];
  /** What was done about a saved active folder that discovery did not find. */
  activeFolderAction: ActiveFolderAction;
  /** Run ids newly marked `remote_missing` by this pass. */
  missing: string[];
  /** Synced runs whose Drive file could not be checked this pass (a transient failure). */
  unverified: number;
}

/** Records a verified remote copy for a run: Drive metadata, then syncing -> synced. */
async function linkRemote(
  ctx: SyncContext,
  runId: string,
  file: DriveFile,
  knownFolders: Set<string>,
): Promise<void> {
  await ensureDriveFileId(ctx.db, runId, () => Promise.resolve(file.id));
  const folder = (file.parents ?? []).find((p) => knownFolders.has(p)) ?? file.parents?.[0] ?? null;
  await setDriveMetadata(ctx.db, runId, {
    folder_id: folder,
    version: file.version ?? null,
    md5_checksum: file.md5Checksum ?? null,
  });
  const started = await applyTransition(ctx.db, runId, { type: 'START_SYNC' });
  if (started.ok) await applyTransition(ctx.db, runId, { type: 'SYNC_SUCCEEDED' });
}

async function reconcileFile(
  ctx: SyncContext,
  file: DriveFile,
  runsByFileId: Map<string, RunRecord>,
  knownFolders: Set<string>,
): Promise<FileOutcome> {
  const signal = ctx.signal === undefined ? {} : { signal: ctx.signal };
  const orphaned = !(file.parents ?? []).some((p) => knownFolders.has(p));
  const outcome = (result: FileResult, runId: string | null): FileOutcome => ({
    fileId: file.id,
    runId,
    orphaned,
    result,
  });

  if (file.size !== undefined && Number(file.size) > MAX_REMOTE_BYTES) {
    return outcome('too_large', null);
  }

  // A file we already know, unchanged in version and checksum, needs no download. ANY change to
  // either forces a full re-download and validation, whatever local state says.
  const known = runsByFileId.get(file.id);
  const drive = known?.sync.drive;
  // (A `remote_missing` run is never "unchanged": its file coming back must be validated.)
  if (
    known !== undefined &&
    known.sync.state !== 'remote_missing' &&
    drive?.version === (file.version ?? null) &&
    drive?.md5_checksum === (file.md5Checksum ?? null)
  ) {
    return outcome('unchanged', known.run_id);
  }

  const bytes = await ctx.client.downloadFile(file.id, signal);
  if (file.md5Checksum !== undefined && md5Hex(bytes) !== file.md5Checksum) {
    throw new DriveError('protocol', { reason: 'downloadChecksumMismatch' });
  }

  const meta = {
    drive_file_id: file.id,
    ...(file.appProperties !== undefined ? { drive_app_properties: file.appProperties } : {}),
    detection_context: orphaned ? 'drive_global_search' : 'drive_folder_scan',
  };

  // appProperties are discovery hints. Once the content itself validates, the tags must agree
  // with it, or the file is quarantined rather than trusted or reclassified.
  const candidate = await parseIngestCandidate(bytes);
  if (
    (candidate.status === 'valid' || candidate.status === 'unsupported_schema') &&
    !propertiesMatchEnvelope(file.appProperties, candidate.envelope)
  ) {
    await quarantineBytes(ctx.db, bytes, 'drive', ['APP_PROPERTIES_MISMATCH'], meta);
    return outcome('quarantined', null);
  }

  const ingested = await ingestEnvelopeBytes(ctx.db, bytes, 'drive', meta);
  switch (ingested.kind) {
    case 'quarantined':
      return outcome('quarantined', null);
    case 'unsupported_schema':
      return outcome('unsupported_schema', ingested.run_id);
    case 'conflict':
      return outcome('conflict', ingested.run_id);
    case 'committed':
      await linkRemote(ctx, ingested.run_id, file, knownFolders);
      return outcome('committed', ingested.run_id);
    case 'already_present': {
      const local = await getRun(ctx.db, ingested.run_id);
      const linked = local?.sync.drive?.file_id;
      if (local === undefined) return outcome('already_present', ingested.run_id);
      if (linked === file.id) {
        if (local.sync.state === 'remote_missing') {
          // The saved file reappeared and its content validated as this very run.
          await linkRemote(ctx, ingested.run_id, file, knownFolders);
          return outcome('recovered', ingested.run_id);
        }
        await setDriveMetadata(ctx.db, ingested.run_id, {
          version: file.version ?? null,
          md5_checksum: file.md5Checksum ?? null,
        });
        return outcome('refreshed', ingested.run_id);
      }
      if (linked !== undefined) return outcome('duplicate_remote', ingested.run_id);
      const linkable = ['pending', 'error', 'local_only', 'remote_missing'].includes(
        local.sync.state,
      );
      if (linkable) {
        await linkRemote(ctx, ingested.run_id, file, knownFolders);
        return outcome('linked', ingested.run_id);
      }
      return outcome('already_present', ingested.run_id);
    }
  }
}

/**
 * Discovery and reconciliation against Drive. Two fully paginated searches (every tagged app
 * folder; every tagged run file regardless of parent), then each file is downloaded, validated
 * and merged by `run_id` through the same ingestion rules used for backups. Never overwrites a
 * local envelope; never deletes, moves or merges a folder. Runs previously synced from this
 * device whose file has vanished become `remote_missing` (never auto re-uploaded).
 */
export async function discoverAndReconcile(ctx: SyncContext): Promise<DiscoveryReport> {
  const signal = ctx.signal === undefined ? {} : { signal: ctx.signal };

  const folders = await ctx.client.listFiles({ q: folderQuery(), ...signal });
  const activeFolderAction = await checkActiveFolder(
    ctx,
    folders.map((f) => f.id),
  );
  const profile = await updateSyncProfile(ctx.db, (p) => {
    const onlyFolder = folders.length === 1 ? (folders[0]?.id ?? null) : null;
    const active = p.active_folder_id ?? onlyFolder;
    return {
      ...p,
      known_folder_ids: [...new Set([...p.known_folder_ids, ...folders.map((f) => f.id)])],
      active_folder_id: active,
      pending_folder_id: p.pending_folder_id === active ? null : p.pending_folder_id,
    };
  });
  const knownFolders = new Set(profile.known_folder_ids);

  const files = await ctx.client.listFiles({ q: runFileQuery(), ...signal });
  const runs = await getAllRuns(ctx.db);
  const runsByFileId = new Map<string, RunRecord>();
  for (const run of runs) {
    const fileId = run.sync.drive?.file_id;
    if (fileId !== undefined) runsByFileId.set(fileId, run);
  }

  const outcomes: FileOutcome[] = [];
  for (const file of files) {
    if (file.trashed === true) {
      // A trashed file cannot be downloaded. The per-run probe below decides what it means.
      outcomes.push({
        fileId: file.id,
        runId: runsByFileId.get(file.id)?.run_id ?? null,
        orphaned: false,
        result: 'trashed',
      });
      continue;
    }
    outcomes.push(await reconcileFile(ctx, file, runsByFileId, knownFolders));
  }

  // Drive's search index can lag behind a trash: a trashed file may still be listed. So every
  // synced run's file is probed directly by ID, whether or not the search listed it. Probing
  // only reads; a run can only become `remote_missing`, never be deleted or re-uploaded.
  const missing: string[] = [];
  let unverified = 0;
  for (const run of runs) {
    const fileId = run.sync.drive?.file_id;
    if (fileId === undefined) continue;
    const current = await getRun(ctx.db, run.run_id);
    if (current?.sync.state !== 'synced') continue;
    if (ctx.signal?.aborted === true) throw new DriveError('cancelled');
    let probe: Awaited<ReturnType<typeof ctx.client.probeFile>>;
    try {
      probe = await ctx.client.probeFile(fileId, signal);
    } catch (error) {
      // Only an expired authorization or a cancellation ends the pass. Any other failure means
      // this one file could not be checked right now: the run stays `synced` (nothing proves it
      // is missing), it is counted, and the rest of the sync carries on.
      if (
        error instanceof DriveError &&
        error.kind !== 'unauthorized' &&
        error.kind !== 'cancelled'
      ) {
        unverified += 1;
        continue;
      }
      throw error;
    }
    if (probe.state === 'missing' || probe.state === 'trashed') {
      const moved = await applyTransition(ctx.db, run.run_id, { type: 'REMOTE_MISSING_DETECTED' });
      if (moved.ok) missing.push(run.run_id);
    }
  }

  return {
    folders,
    folderConflict: folders.length > 1,
    files: outcomes,
    activeFolderAction,
    missing,
    unverified,
  };
}
