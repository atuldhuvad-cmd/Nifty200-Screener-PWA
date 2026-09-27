import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { withMigrationLock } from './locks';
import type {
  ComparisonIdentityRecord,
  QuarantineItemRecord,
  RunRecord,
  RunVariantRecord,
} from './types';

export const DB_NAME = 'n200-screener';
export const DB_VERSION = 1;

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
  /** Whether the schema migration actually ran under a real, cross-tab-coordinating Web Lock. */
  usedLock: boolean;
  /** `!usedLock` — Web Locks were unavailable, so only this tab's activity is coordinated.
   * A future sync layer must check this and refuse to start concurrent sync while it's true. */
  singleTabWarning: boolean;
}

export async function openDatabase(options: OpenDatabaseOptions = {}): Promise<OpenDatabaseResult> {
  // Holder populated once open, so the `blocking` handler below (which can only ever fire on
  // an already-open connection) always closes the right instance. A boxed field, not a `let`,
  // since only the box's contents change — the box itself is never reassigned.
  const holder: { db: N200Database | undefined } = { db: undefined };

  const { usedLock, result } = await withMigrationLock('n200-schema-migration', () =>
    openDB<N200DBSchema>(options.name ?? DB_NAME, DB_VERSION, {
      upgrade(database) {
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
      },
      blocked() {
        options.onBlocked?.();
      },
      blocking() {
        holder.db?.close();
        options.onReloadNeeded?.();
      },
    }),
  );
  holder.db = result;
  if (!usedLock) options.onSingleTabFallback?.();
  return { db: result, usedLock, singleTabWarning: !usedLock };
}
