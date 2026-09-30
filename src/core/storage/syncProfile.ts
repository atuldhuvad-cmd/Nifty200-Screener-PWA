import { STORE, type N200Database } from './schema';
import { safeAbort } from './txUtils';
import type { SyncProfileRecord } from './types';

const PROFILE_ID = 'default' as const;

function freshProfile(): SyncProfileRecord {
  const now = new Date().toISOString();
  return {
    profile_id: PROFILE_ID,
    bound_permission_id: null,
    active_folder_id: null,
    known_folder_ids: [],
    pending_folder_id: null,
    lease: null,
    created_at: now,
    updated_at: now,
  };
}

export function getSyncProfile(db: N200Database): Promise<SyncProfileRecord | undefined> {
  return db.get(STORE.syncProfile, PROFILE_ID);
}

/**
 * Applies `mutate` to the profile (creating it first if needed) inside one read-write
 * transaction, so concurrent callers can never interleave a read and a write.
 */
export async function updateSyncProfile(
  db: N200Database,
  mutate: (profile: SyncProfileRecord) => SyncProfileRecord,
): Promise<SyncProfileRecord> {
  const tx = db.transaction(STORE.syncProfile, 'readwrite');
  try {
    const store = tx.objectStore(STORE.syncProfile);
    const current = (await store.get(PROFILE_ID)) ?? freshProfile();
    const next = { ...mutate(current), updated_at: new Date().toISOString() };
    await store.put(next);
    await tx.done;
    return next;
  } catch (e) {
    safeAbort(tx);
    throw e;
  }
}

export async function ensureSyncProfile(db: N200Database): Promise<SyncProfileRecord> {
  const existing = await getSyncProfile(db);
  if (existing) return existing;
  return updateSyncProfile(db, (p) => p);
}

export type BindResult = { status: 'bound' } | { status: 'verified' } | { status: 'mismatch' };

/**
 * Binds this device's sync profile to one Drive account, identified only by its opaque
 * `permissionId` (never an email). The first account binds; the same account verifies; any other
 * account is a mismatch and changes nothing: a profile never mixes two Drive accounts.
 */
export async function bindPermission(db: N200Database, permissionId: string): Promise<BindResult> {
  const tx = db.transaction(STORE.syncProfile, 'readwrite');
  try {
    const store = tx.objectStore(STORE.syncProfile);
    const current = (await store.get(PROFILE_ID)) ?? freshProfile();
    if (current.bound_permission_id === null) {
      await store.put({
        ...current,
        bound_permission_id: permissionId,
        updated_at: new Date().toISOString(),
      });
      await tx.done;
      return { status: 'bound' };
    }
    await tx.done;
    return current.bound_permission_id === permissionId
      ? { status: 'verified' }
      : { status: 'mismatch' };
  } catch (e) {
    safeAbort(tx);
    throw e;
  }
}

export type LeaseResult = { ok: true } | { ok: false; heldBy: string; expiresAtMs: number };

/**
 * Compare-and-set leader lease, in one transaction. Exactly one holder wins a race; the same
 * holder may re-acquire; an expired lease is taken over, so a crashed leader never blocks sync
 * forever. Used together with the SHARED activity lock. There is deliberately no second Web
 * Lock, so no lock is ever held while acquiring another.
 */
export async function acquireSyncLease(
  db: N200Database,
  params: { holderId: string; nowMs: number; ttlMs: number },
): Promise<LeaseResult> {
  const tx = db.transaction(STORE.syncProfile, 'readwrite');
  try {
    const store = tx.objectStore(STORE.syncProfile);
    const current = (await store.get(PROFILE_ID)) ?? freshProfile();
    const lease = current.lease;
    if (
      lease !== null &&
      lease.holder_id !== params.holderId &&
      lease.expires_at_ms > params.nowMs
    ) {
      await tx.done;
      return { ok: false, heldBy: lease.holder_id, expiresAtMs: lease.expires_at_ms };
    }
    await store.put({
      ...current,
      lease: { holder_id: params.holderId, expires_at_ms: params.nowMs + params.ttlMs },
      updated_at: new Date().toISOString(),
    });
    await tx.done;
    return { ok: true };
  } catch (e) {
    safeAbort(tx);
    throw e;
  }
}

export async function renewSyncLease(
  db: N200Database,
  params: { holderId: string; nowMs: number; ttlMs: number },
): Promise<boolean> {
  const tx = db.transaction(STORE.syncProfile, 'readwrite');
  try {
    const store = tx.objectStore(STORE.syncProfile);
    const current = await store.get(PROFILE_ID);
    if (current?.lease?.holder_id !== params.holderId) {
      await tx.done;
      return false;
    }
    await store.put({
      ...current,
      lease: { holder_id: params.holderId, expires_at_ms: params.nowMs + params.ttlMs },
      updated_at: new Date().toISOString(),
    });
    await tx.done;
    return true;
  } catch (e) {
    safeAbort(tx);
    throw e;
  }
}

export async function releaseSyncLease(db: N200Database, holderId: string): Promise<void> {
  const tx = db.transaction(STORE.syncProfile, 'readwrite');
  try {
    const store = tx.objectStore(STORE.syncProfile);
    const current = await store.get(PROFILE_ID);
    if (current?.lease?.holder_id === holderId) {
      await store.put({ ...current, lease: null, updated_at: new Date().toISOString() });
    }
    await tx.done;
  } catch (e) {
    safeAbort(tx);
    throw e;
  }
}
