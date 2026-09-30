import {
  acquireSyncLease,
  bindPermission,
  getAllRuns,
  releaseSyncLease,
  renewSyncLease,
  withRequiredActivity,
  type N200Database,
} from '../storage';
import type { DriveClient } from './driveClient';
import { DriveError } from './errors';
import { discoverAndReconcile, type DiscoveryReport } from './reconcile';
import { isUploadEligible, uploadRun, type UploadOutcome } from './upload';

export interface SyncParams {
  db: N200Database;
  client: DriveClient;
  signal?: AbortSignal;
  now?: () => number;
  leaseTtlMs?: number;
  holderId?: string;
}

export type SyncReport =
  | {
      status: 'ok';
      discovery: DiscoveryReport;
      uploads: { runId: string; outcome: UploadOutcome }[];
    }
  /** The signed-in Drive account differs from the one this profile is bound to: nothing was read or written. */
  | { status: 'blocked'; reason: 'ACCOUNT_MISMATCH' }
  /** Another tab holds the sync leader lease. */
  | { status: 'busy' }
  /** Account-level: authorization expired. No run state was changed. */
  | { status: 'reconnect_required' }
  | { status: 'cancelled' }
  | { status: 'failed'; code: string; retryable: boolean };

const DEFAULT_LEASE_TTL_MS = 60_000;

/**
 * One user-initiated sync pass: verify the account, reconcile with Drive, then upload the runs
 * that are eligible. Coordination without nesting locks: the pass holds the SHARED activity lock
 * (so an app update waits for it, and it fails closed without Web Locks), and a single-leader
 * lease in IndexedDB decides which tab actually drains the queue. Never runs in the background.
 */
export function syncNow(params: SyncParams): Promise<SyncReport> {
  return withRequiredActivity(() => runSync(params));
}

async function runSync(params: SyncParams): Promise<SyncReport> {
  const { db, client } = params;
  const now = params.now ?? Date.now;
  const ttlMs = params.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  const holderId = params.holderId ?? crypto.randomUUID();
  const ctx = { db, client, ...(params.signal !== undefined ? { signal: params.signal } : {}) };

  try {
    const user = await client.aboutUser(
      params.signal === undefined ? {} : { signal: params.signal },
    );
    const bound = await bindPermission(db, user.permissionId);
    if (bound.status === 'mismatch') return { status: 'blocked', reason: 'ACCOUNT_MISMATCH' };
  } catch (error) {
    return mapFailure(error);
  }

  const lease = await acquireSyncLease(db, { holderId, nowMs: now(), ttlMs });
  if (!lease.ok) return { status: 'busy' };

  // Renew the lease before EVERY Drive request (retries and every chunk of a resumable upload
  // included), so no upload can outlive it. If the lease was lost anyway, stop: another tab now
  // leads, and continuing could race it.
  client.setActivityHook(async () => {
    if (!(await renewSyncLease(db, { holderId, nowMs: now(), ttlMs }))) {
      throw new DriveError('cancelled', { reason: 'leaseLost' });
    }
  });

  try {
    const discovery = await discoverAndReconcile(ctx);
    const uploads: { runId: string; outcome: UploadOutcome }[] = [];
    for (const run of await getAllRuns(db)) {
      if (params.signal?.aborted === true) return { status: 'cancelled' };
      if (!isUploadEligible(run).eligible) continue;
      await renewSyncLease(db, { holderId, nowMs: now(), ttlMs });
      const outcome = await uploadRun(ctx, run.run_id);
      uploads.push({ runId: run.run_id, outcome });
      if (outcome.status === 'reconnect_required') return { status: 'reconnect_required' };
      if (outcome.status === 'cancelled') return { status: 'cancelled' };
    }
    return { status: 'ok', discovery, uploads };
  } catch (error) {
    return mapFailure(error);
  } finally {
    client.setActivityHook(null);
    await releaseSyncLease(db, holderId);
  }
}

function mapFailure(error: unknown): SyncReport {
  if (error instanceof DriveError) {
    if (error.kind === 'unauthorized') return { status: 'reconnect_required' };
    if (error.kind === 'cancelled') return { status: 'cancelled' };
    return { status: 'failed', code: error.code, retryable: error.retryable };
  }
  throw error;
}
