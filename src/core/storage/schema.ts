import {
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  type StoreNames,
} from 'idb';
import { rebuildComparisonIndexTx } from './comparisonIndex';
import type { RunEnvelopeV1 } from '../envelope/types';
import {
  ACTIVITY_LOCK_NAME,
  isWebLocksAvailable,
  WebLocksUnavailableError,
  withMigrationLock,
} from './locks';
import type {
  ComparisonIdentityRecord,
  QuarantineItemRecord,
  RunRecord,
  RunVariantRecord,
} from './types';

export const DB_NAME = 'n200-screener';
/**
 * v1 (original Step 3 shape): comparison_identity had only `by_run_id`/`by_identity_key`, its
 * rows carried no `normalized_isin`/`normalized_nse_code`, and sync diagnostics had no
 * `has_verified_remote_copy`. v2 (security review P1-B) adds all three, migrated in place for
 * any existing v1 database — see `upgrade()` below.
 */
export const DB_VERSION = 2;

export const STORE = {
  runs: 'runs',
  runVariants: 'run_variants',
  quarantineItems: 'quarantine_items',
  comparisonIdentity: 'comparison_identity',
} as const;

export const RUNS_BY_ORIGINAL_FILE_SHA256 = 'by_original_file_sha256';
export const COMPARISON_BY_RUN_ID = 'by_run_id';
export const COMPARISON_BY_IDENTITY_KEY = 'by_identity_key';
export const COMPARISON_BY_NORMALIZED_NSE_CODE = 'by_normalized_nse_code';

export interface N200DBSchema extends DBSchema {
  [STORE.runs]: {
    key: string; // run_id
    value: RunRecord;
    indexes: { [RUNS_BY_ORIGINAL_FILE_SHA256]: string };
  };
  [STORE.runVariants]: {
    key: [string, string]; // [run_id, envelope_sha256]
    value: RunVariantRecord;
  };
  [STORE.quarantineItems]: {
    key: string; // quarantine_id
    value: QuarantineItemRecord;
  };
  [STORE.comparisonIdentity]: {
    key: number; // autoIncrement
    value: ComparisonIdentityRecord;
    indexes: {
      [COMPARISON_BY_RUN_ID]: string;
      [COMPARISON_BY_IDENTITY_KEY]: string;
      [COMPARISON_BY_NORMALIZED_NSE_CODE]: string;
    };
  };
}

export type N200Database = IDBPDatabase<N200DBSchema>;

export interface OpenDatabaseOptions {
  name?: string;
  /**
   * Fired when another tab is opening a newer database version while this connection is still
   * open ("versionchange"). We close our connection immediately (so the other tab is never
   * blocked indefinitely) and hand the app a signal to prompt the user to reload — this
   * connection must not be used again afterwards.
   */
  onReloadNeeded?: () => void;
  /** Fired when *this* open attempt is itself blocked by another tab's still-open older connection. */
  onBlocked?: () => void;
  /**
   * Fired when Web Locks were unavailable for this open, so the migration ran via the
   * single-tab fallback (Bugbot P2-1) — never silently. The caller must disable any
   * sync-triggering action (there is no such caller yet, since Drive sync doesn't exist in
   * this app yet) and surface a single-active-tab warning to the user; see `singleTabWarning`
   * on the result, which carries the same fact for callers that don't need a callback.
   */
  onSingleTabFallback?: () => void;
}

export interface OpenDatabaseResult {
  db: N200Database;
  /**
   * Whether this tab can coordinate with other tabs through Web Locks.
   * - When a schema migration ran, it is whether that migration ran under the exclusive activity
   *   lock (a migration never runs uncoordinated: without Web Locks the open fails closed).
   * - When the database was already at the current version, no migration ran and no lock was
   *   taken (a plain open must never queue behind a long restore in another tab); the value then
   *   just reports whether Web Locks are available, so `singleTabWarning` still tells a future
   *   sync layer that cross-tab coordination is impossible.
   */
  usedLock: boolean;
  /** `!usedLock` — Web Locks were unavailable, so only this tab's activity is coordinated.
   * A future sync layer must check this and refuse to start concurrent sync while it's true. */
  singleTabWarning: boolean;
}

/**
 * v1 -> v2 (security review P1-B): adds the `by_normalized_nse_code` index, rebuilds every
 * run's comparison-identity rows from its *validated, stored* envelope (never trusting the
 * stale v1 rows, which lack the normalized fields entirely), and conservatively initializes
 * `has_verified_remote_copy` for every pre-existing run: `true` only for a run that was
 * actually `synced` under the old model — the only old state that could ever prove a verified
 * copy currently exists — `false` for every other state (old data alone can't prove a
 * currently-valid remote copy for anything else, e.g. a stale `last_success_at` on a run now
 * in `error`). Runs entirely inside the versionchange transaction, before this database is
 * exposed to any caller.
 */
async function migrateV1ToV2(
  transaction: IDBPTransaction<N200DBSchema, StoreNames<N200DBSchema>[], 'versionchange'>,
): Promise<void> {
  const comparisonStore = transaction.objectStore(STORE.comparisonIdentity);
  if (!comparisonStore.indexNames.contains(COMPARISON_BY_NORMALIZED_NSE_CODE)) {
    comparisonStore.createIndex(COMPARISON_BY_NORMALIZED_NSE_CODE, 'normalized_nse_code');
  }

  const runStore = transaction.objectStore(STORE.runs);
  const allRuns = await runStore.getAll();
  for (const record of allRuns) {
    if (record.envelope.schema_version === '1') {
      await rebuildComparisonIndexTx(
        comparisonStore,
        record.run_id,
        record.envelope as RunEnvelopeV1,
      );
    }

    const diagnostics = record.sync.diagnostics as unknown as Record<string, unknown>;
    if (diagnostics['has_verified_remote_copy'] === undefined) {
      diagnostics['has_verified_remote_copy'] = record.sync.state === 'synced';
      await runStore.put(record);
    }
  }
}

export async function openDatabase(options: OpenDatabaseOptions = {}): Promise<OpenDatabaseResult> {
  // Holder populated once open, so the `blocking` handler below (which can only ever fire on
  // an already-open connection) always closes the right instance. A boxed field, not a `let`,
  // since only the box's contents change — the box itself is never reassigned.
  const holder: { db: N200Database | undefined } = { db: undefined };
  // Fail closed (security review P2-A): if a schema migration will be needed (a fresh install
  // or an old-version upgrade) and Web Locks are unavailable, refuse to run it uncoordinated
  // rather than silently falling back to single-tab execution — a real cross-tab race here
  // (two tabs both creating the database, or one migrating while another reads mid-flight)
  // cannot be detected after the fact. Opening a database already at the current version needs
  // no lock at all and is unaffected — "reads remain available."
  const locksAvailable = isWebLocksAvailable();
  // Set inside `upgrade` (below) if a migration was needed but blocked; read after `openDB`
  // rejects, and the real error is thrown from here — rather than thrown directly inside the
  // `upgrade` callback, which some IndexedDB implementations redispatch as a second, separately
  // unhandled error event alongside the request's own rejection. `transaction.abort()` is the
  // spec-sanctioned way to cancel an upgrade from inside the callback.
  const blockedMigration: { oldVersion: number | undefined } = { oldVersion: undefined };

  const handlers = {
    blocked() {
      options.onBlocked?.();
    },
    blocking() {
      holder.db?.close();
      options.onReloadNeeded?.();
    },
  };

  // Phase 1 — no lock. Try to open at the current version. If the database is already current
  // this simply succeeds: a plain open must never queue behind the activity lock, or a tab
  // opened (or reloaded) while another tab runs a long restore would sit on "Opening local
  // storage" until that restore finished. If a migration is needed, `upgrade` aborts its
  // transaction at once (rolling back, including a first-time create) and we fall through to
  // phase 2, which redoes the open under the exclusive lock.
  const probe: { migrationNeeded: boolean } = { migrationNeeded: false };
  try {
    const current = await openDB<N200DBSchema>(options.name ?? DB_NAME, DB_VERSION, {
      upgrade(_database, _oldVersion, _newVersion, transaction) {
        probe.migrationNeeded = true;
        transaction.abort();
        transaction.done.catch(() => {
          // Expected: aborting rejects `.done`.
        });
      },
      ...handlers,
    });
    holder.db = current;
    if (!locksAvailable) options.onSingleTabFallback?.();
    return { db: current, usedLock: locksAvailable, singleTabWarning: !locksAvailable };
  } catch (e) {
    if (!probe.migrationNeeded) throw e;
  }

  // Phase 2 — a migration is needed: run it under the exclusive activity lock (so it excludes
  // imports, restores and app updates in every tab). If another tab migrated in the meantime,
  // `upgrade` is not called at all and this is just a normal open.
  const openPromise = withMigrationLock(ACTIVITY_LOCK_NAME, () =>
    openDB<N200DBSchema>(options.name ?? DB_NAME, DB_VERSION, {
      // Runs under the Web Lock (see `withMigrationLock` above) and completes before this
      // function returns the database to the caller — the migration is never racing a caller
      // that already has the (post-migration) database in hand (security review P1-B).
      async upgrade(database, oldVersion, _newVersion, transaction) {
        if (!locksAvailable) {
          blockedMigration.oldVersion = oldVersion;
          transaction.abort();
          // Observe the aborted transaction's `.done` rejection right here — nothing else in
          // this call ever awaits it, so without this it surfaces as an unhandled rejection.
          transaction.done.catch(() => {
            // Expected: aborting rejects `.done`.
          });
          return;
        }
        if (oldVersion < 1) {
          // Fresh install: create every store already at the current (v2) shape directly —
          // no v1 ever existed for this database, so there is nothing to migrate.
          const runs = database.createObjectStore(STORE.runs, { keyPath: 'run_id' });
          runs.createIndex(RUNS_BY_ORIGINAL_FILE_SHA256, 'envelope.original_file_sha256');

          database.createObjectStore(STORE.runVariants, { keyPath: ['run_id', 'envelope_sha256'] });

          database.createObjectStore(STORE.quarantineItems, { keyPath: 'quarantine_id' });

          const comparison = database.createObjectStore(STORE.comparisonIdentity, {
            keyPath: 'id',
            autoIncrement: true,
          });
          comparison.createIndex(COMPARISON_BY_RUN_ID, 'run_id');
          comparison.createIndex(COMPARISON_BY_IDENTITY_KEY, 'identity_key');
          comparison.createIndex(COMPARISON_BY_NORMALIZED_NSE_CODE, 'normalized_nse_code');
          return;
        }

        if (oldVersion < 2) {
          await migrateV1ToV2(transaction);
        }
      },
      ...handlers,
    }),
  );
  let usedLock: boolean;
  let result: N200Database;
  try {
    ({ usedLock, result } = await openPromise);
  } catch (e) {
    if (blockedMigration.oldVersion !== undefined) {
      throw new WebLocksUnavailableError(
        'A schema migration is required (oldVersion ' +
          String(blockedMigration.oldVersion) +
          ' -> ' +
          String(DB_VERSION) +
          ') but Web Locks are unavailable to coordinate it safely across tabs.',
      );
    }
    throw e;
  }

  holder.db = result;
  if (!usedLock) options.onSingleTabFallback?.();
  return { db: result, usedLock, singleTabWarning: !usedLock };
}
