import { expect, test } from '@playwright/test';
import { buildTestEnvelope } from '../storage-helpers';

const DB_NAME = 'n200-screener';

interface V1SyncDiagnostics {
  last_attempt_at: string | null;
  last_success_at: string | null;
  attempt_count: number;
  error_code: string | null;
  retryable: boolean | null;
}

interface V1SyncRecord {
  state: string;
  prior_stable_state: string | null;
  diagnostics: V1SyncDiagnostics;
}

interface MigratedRunRecord {
  run_id: string;
  sync: { diagnostics: { has_verified_remote_copy?: boolean } };
}

interface ComparisonRow {
  run_id: string;
  normalized_isin: string | null;
  normalized_nse_code: string | null;
}

interface MigrationCheckResult {
  hasNormalizedNseIndex: boolean;
  syncedRecord: MigratedRunRecord | undefined;
  errorRecord: MigratedRunRecord | undefined;
  syncedRows: ComparisonRow[];
}

/** Seeds a real, v1-shaped IndexedDB database directly (never through this app's own code),
 * matching the pre-security-review Step 3 schema: no `by_normalized_nse_code` index, and sync
 * diagnostics with no `has_verified_remote_copy` field. */
async function seedV1Database(
  page: import('@playwright/test').Page,
  runs: Array<{ run_id: string; envelope: unknown; sync: V1SyncRecord }>,
): Promise<void> {
  await page.evaluate(
    async ({ dbName, runs: seedRuns }) => {
      await new Promise<void>((resolve, reject) => {
        const del = indexedDB.deleteDatabase(dbName);
        del.onsuccess = () => resolve();
        del.onerror = () => reject(del.error as DOMException);
        del.onblocked = () => resolve();
      });

      await new Promise<void>((resolve, reject) => {
        const openReq = indexedDB.open(dbName, 1);
        openReq.onupgradeneeded = () => {
          const db = openReq.result;
          const runsStore = db.createObjectStore('runs', { keyPath: 'run_id' });
          runsStore.createIndex('by_original_file_sha256', 'envelope.original_file_sha256');
          db.createObjectStore('run_variants', { keyPath: ['run_id', 'envelope_sha256'] });
          db.createObjectStore('quarantine_items', { keyPath: 'quarantine_id' });
          const comparison = db.createObjectStore('comparison_identity', {
            keyPath: 'id',
            autoIncrement: true,
          });
          comparison.createIndex('by_run_id', 'run_id');
          comparison.createIndex('by_identity_key', 'identity_key');
        };
        openReq.onsuccess = () => {
          const db = openReq.result;
          const tx = db.transaction('runs', 'readwrite');
          const store = tx.objectStore('runs');
          for (const run of seedRuns) store.add(run);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error as DOMException);
        };
        openReq.onerror = () => reject(openReq.error as DOMException);
      });
    },
    { dbName: DB_NAME, runs },
  );
}

test('7. a real v1-shaped IndexedDB database upgrades to v2 on load', async ({ page }) => {
  const syncedEnvelope = await buildTestEnvelope({
    runId: '11111111-1111-4111-8111-111111111111',
    effectiveDate: '2026-01-01',
  });
  const errorEnvelope = await buildTestEnvelope({
    runId: '22222222-2222-4222-8222-222222222222',
    fixture: 'SYNTHETIC_non_ascii_names.csv',
    effectiveDate: '2026-01-02',
  });

  // Prevent the app's own bundle from running so the v1 seed lands before any real `openDatabase()`
  // call from this app ever touches the database.
  await page.route('**/assets/*.js', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }),
  );
  await page.goto('/');

  await seedV1Database(page, [
    {
      run_id: syncedEnvelope.run_id,
      envelope: syncedEnvelope,
      sync: {
        state: 'synced',
        prior_stable_state: null,
        diagnostics: {
          last_attempt_at: '2026-01-01T00:00:00.000Z',
          last_success_at: '2026-01-01T00:00:00.000Z',
          attempt_count: 1,
          error_code: null,
          retryable: null,
        },
      },
    },
    {
      run_id: errorEnvelope.run_id,
      envelope: errorEnvelope,
      sync: {
        state: 'error',
        prior_stable_state: null,
        diagnostics: {
          last_attempt_at: '2026-01-02T00:00:00.000Z',
          last_success_at: null,
          attempt_count: 3,
          error_code: 'NETWORK',
          retryable: true,
        },
      },
    },
  ]);

  await page.unroute('**/assets/*.js');
  await page.reload();

  // The app's real `openDatabase()` ran the v1 -> v2 migration; both runs are now visible.
  await expect(page.getByText('2026-01-01')).toBeVisible();
  await expect(page.getByText('2026-01-02')).toBeVisible();

  const result = await page.evaluate(
    async ({ dbName, syncedRunId, errorRunId }) => {
      return await new Promise<MigrationCheckResult>((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['runs', 'comparison_identity'], 'readonly');
          const comparisonStore = tx.objectStore('comparison_identity');
          const hasNormalizedNseIndex =
            comparisonStore.indexNames.contains('by_normalized_nse_code');
          const runsStore = tx.objectStore('runs');
          const syncedReq = runsStore.get(syncedRunId);
          const errorReq = runsStore.get(errorRunId);
          const syncedRowsReq = comparisonStore.index('by_run_id').getAll(syncedRunId);

          Promise.all([
            new Promise<MigratedRunRecord | undefined>((res) => {
              syncedReq.onsuccess = () => res(syncedReq.result as MigratedRunRecord | undefined);
            }),
            new Promise<MigratedRunRecord | undefined>((res) => {
              errorReq.onsuccess = () => res(errorReq.result as MigratedRunRecord | undefined);
            }),
            new Promise<ComparisonRow[]>((res) => {
              syncedRowsReq.onsuccess = () => res(syncedRowsReq.result as ComparisonRow[]);
            }),
          ])
            .then(([syncedRecord, errorRecord, syncedRows]) => {
              db.close();
              resolve({ hasNormalizedNseIndex, syncedRecord, errorRecord, syncedRows });
            })
            .catch(reject);
        };
        req.onerror = () => reject(req.error as DOMException);
      });
    },
    { dbName: DB_NAME, syncedRunId: syncedEnvelope.run_id, errorRunId: errorEnvelope.run_id },
  );

  expect(result.hasNormalizedNseIndex).toBe(true);

  if (!result.syncedRecord || !result.errorRecord) {
    throw new Error('Expected both migrated run records to exist.');
  }
  // Conservative durability flag (security review P1-B): true only for the run that was
  // actually `synced` under the old model; false for every other old state.
  expect(result.syncedRecord.sync.diagnostics.has_verified_remote_copy).toBe(true);
  expect(result.errorRecord.sync.diagnostics.has_verified_remote_copy).toBe(false);

  expect(result.syncedRows.length).toBeGreaterThan(0);
  const [firstRow] = result.syncedRows;
  if (!firstRow) throw new Error('Expected at least one rebuilt comparison row.');
  expect(firstRow.normalized_isin !== null || firstRow.normalized_nse_code !== null).toBe(true);
});
