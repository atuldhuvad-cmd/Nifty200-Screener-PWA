import { createDriveClient, type DriveClient } from '../../src/core/sync/driveClient';
import {
  createInMemoryTokenProvider,
  createOAuthStateStore,
  type OAuthStateStore,
} from '../../src/core/sync/auth';
import { commitNewRun } from '../../src/core/storage/runs';
import { openDatabase, type N200Database } from '../../src/core/storage/schema';
import { buildTestEnvelope, freshDbName } from '../storage-helpers';
import { FakeDrive } from './fakeDrive';

export interface Harness {
  drive: FakeDrive;
  token: string;
  tokens: ReturnType<typeof createInMemoryTokenProvider>;
  auth: OAuthStateStore;
  sleeps: number[];
  client: DriveClient;
}

/** A Drive client wired to a fresh fake Drive, with sleeping recorded rather than performed. */
export function makeHarness(
  options: { timeoutMs?: number; maxAttempts?: number; random?: () => number } = {},
): Harness {
  const drive = new FakeDrive();
  const token = drive.issueToken();
  const tokens = createInMemoryTokenProvider(token);
  const auth = createOAuthStateStore('connected');
  const sleeps: number[] = [];
  const client = createDriveClient({
    fetch: drive.fetch,
    tokens,
    auth,
    timeoutMs: options.timeoutMs ?? 2000,
    maxAttempts: options.maxAttempts ?? 3,
    baseDelayMs: 100,
    maxDelayMs: 1000,
    random: options.random ?? (() => 0.5),
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
  return { drive, token, tokens, auth, sleeps, client };
}

export interface SyncHarness extends Harness {
  db: N200Database;
  ctx: { db: N200Database; client: DriveClient };
  close: () => void;
  /** A second client (fresh in-memory upload sessions) sharing this harness's drive and database. */
  newClient: (options?: { maxAttempts?: number }) => DriveClient;
}

const open: N200Database[] = [];

export async function makeSyncHarness(
  options: { timeoutMs?: number; maxAttempts?: number } = {},
): Promise<SyncHarness> {
  const base = makeHarness(options);
  const { db } = await openDatabase({ name: freshDbName() });
  open.push(db);
  return {
    ...base,
    db,
    ctx: { db, client: base.client },
    close: () => {
      db.close();
    },
    newClient: (o = {}) =>
      createDriveClient({
        fetch: base.drive.fetch,
        tokens: base.tokens,
        auth: base.auth,
        timeoutMs: options.timeoutMs ?? 2000,
        maxAttempts: o.maxAttempts ?? options.maxAttempts ?? 3,
        baseDelayMs: 100,
        maxDelayMs: 1000,
        random: () => 0.5,
        sleep: (ms) => {
          base.sleeps.push(ms);
          return Promise.resolve();
        },
      }),
  };
}

export function closeAllDatabases(): void {
  for (const db of open.splice(0)) db.close();
}

/** Commits a synthetic run and returns its id. */
export async function addRun(db: N200Database, runId: string, fixture?: string): Promise<string> {
  await commitNewRun(
    db,
    await buildTestEnvelope({ runId, ...(fixture !== undefined ? { fixture } : {}) }),
  );
  return runId;
}

/** A second device: its own database and client, sharing the SAME fake Drive and account. */
export async function secondDevice(first: SyncHarness): Promise<SyncHarness> {
  const { db } = await openDatabase({ name: freshDbName() });
  open.push(db);
  const client = createDriveClient({
    fetch: first.drive.fetch,
    tokens: first.tokens,
    auth: first.auth,
    timeoutMs: 2000,
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 1000,
    random: () => 0.5,
    sleep: (ms) => {
      first.sleeps.push(ms);
      return Promise.resolve();
    },
  });
  return {
    ...first,
    db,
    client,
    ctx: { db, client },
    close: () => {
      db.close();
    },
  };
}
