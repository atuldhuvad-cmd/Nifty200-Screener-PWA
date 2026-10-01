<script lang="ts">
  import { onMount } from 'svelte';
  import {
    countAtRiskRuns,
    getAllRuns,
    requestPersistentStorage,
    type N200Database,
    type PersistPromptResult,
    type RunRecord,
  } from './core/storage';
  import Backup from './lib/Backup.svelte';
  import { getDatabase } from './lib/db';
  import ImportForm from './lib/ImportForm.svelte';
  import MultipartImportForm from './lib/MultipartImportForm.svelte';
  import Notices from './lib/Notices.svelte';
  import UpdateNotice from './lib/UpdateNotice.svelte';
  import RunComparison from './lib/RunComparison.svelte';
  import RunDetail from './lib/RunDetail.svelte';
  import Review from './lib/Review.svelte';
  import RunHistory from './lib/RunHistory.svelte';
  import {
    backupHash,
    compareHash,
    isBackupRoute,
    isReviewRoute,
    isSyncRoute,
    parseCompareRouteFromHash,
    parseRunIdFromHash,
    reviewHash,
    syncHash,
  } from './lib/route';
  import StatusBar from './lib/StatusBar.svelte';
  import Sync from './lib/Sync.svelte';

  type ImportMode = 'single' | 'multipart';
  let importMode = $state<ImportMode>('single');

  let db = $state<N200Database | undefined>(undefined);
  let singleTabWarning = $state(false);
  let reloadNeeded = $state(false);
  let runs = $state<RunRecord[]>([]);
  let atRiskCount = $state(0);
  let persist = $state<PersistPromptResult | undefined>(undefined);
  let initError = $state<string | undefined>(undefined);
  let selectedRunId = $state<string | null>(
    typeof location === 'undefined' ? null : parseRunIdFromHash(location.hash),
  );
  let compareRoute = $state<{ identityKey: string | null } | null>(
    typeof location === 'undefined' ? null : parseCompareRouteFromHash(location.hash),
  );
  let onBackupRoute = $state(
    typeof location === 'undefined' ? false : isBackupRoute(location.hash),
  );
  let onSyncRoute = $state(typeof location === 'undefined' ? false : isSyncRoute(location.hash));
  let onReviewRoute = $state(
    typeof location === 'undefined' ? false : isReviewRoute(location.hash),
  );

  const onHome = $derived(
    !onBackupRoute && !onSyncRoute && !onReviewRoute && compareRoute === null,
  );

  async function refresh(database: N200Database): Promise<void> {
    runs = await getAllRuns(database);
    atRiskCount = await countAtRiskRuns(database);
  }

  onMount(() => {
    void (async () => {
      try {
        const opened = await getDatabase({
          onReloadNeeded: () => {
            reloadNeeded = true;
          },
        });
        db = opened.db;
        singleTabWarning = opened.singleTabWarning;
        await refresh(opened.db);
        persist = await requestPersistentStorage();
      } catch (e) {
        initError = e instanceof Error ? e.message : 'Failed to open local storage.';
      }
    })();

    const onHashChange = (): void => {
      selectedRunId = parseRunIdFromHash(location.hash);
      compareRoute = parseCompareRouteFromHash(location.hash);
      onBackupRoute = isBackupRoute(location.hash);
      onReviewRoute = isReviewRoute(location.hash);
      onSyncRoute = isSyncRoute(location.hash);
      // A sync (or restore) changes stored runs while the user is on another view.
      if (db) void refresh(db);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
  });
</script>

<header class="app-header">
  <div class="app-header__inner">
    <h1>Nifty 200 Screener</h1>
    {#if db && !initError}
      <nav class="app-nav" aria-label="Main">
        <a href="#/" aria-current={onHome ? 'page' : undefined}>Run history</a>
        <a href={compareHash()} aria-current={compareRoute !== null ? 'page' : undefined}
          >Compare stocks</a
        >
        <a href={backupHash()} aria-current={onBackupRoute ? 'page' : undefined}>Backup</a>
        <a href={reviewHash()} aria-current={onReviewRoute ? 'page' : undefined}>Needs review</a>
        <a href={syncHash()} aria-current={onSyncRoute ? 'page' : undefined}>Sync</a>
      </nav>
    {/if}
  </div>
</header>

<main class="app-main">
  <Notices />

  <UpdateNotice />

  {#if reloadNeeded}
    <p role="alert" class="n200-badge n200-badge--warning">
      This app was updated in another tab. Reload this page before continuing.
    </p>
  {/if}

  {#if initError}
    <p role="alert" class="n200-badge n200-badge--error">{initError}</p>
  {:else if db}
    {#if onBackupRoute}
      <Backup
        {db}
        onImported={() => {
          if (db) void refresh(db);
        }}
      />
    {:else if onSyncRoute}
      <Sync {db} />
    {:else if onReviewRoute}
      <Review
        {db}
        onChanged={() => {
          if (db) void refresh(db);
        }}
      />
    {:else if compareRoute !== null}
      <RunComparison {db} identityKey={compareRoute.identityKey} />
    {:else if selectedRunId !== null}
      <RunDetail {db} runId={selectedRunId} />
    {:else}
      <StatusBar {singleTabWarning} {persist} {atRiskCount} />

      <fieldset>
        <legend>Import type</legend>
        <div>
          <input
            id="import-mode-single"
            type="radio"
            name="import-mode"
            value="single"
            checked={importMode === 'single'}
            onchange={() => {
              importMode = 'single';
            }}
          />
          <label for="import-mode-single">Single file</label>
        </div>
        <div>
          <input
            id="import-mode-multipart"
            type="radio"
            name="import-mode"
            value="multipart"
            checked={importMode === 'multipart'}
            onchange={() => {
              importMode = 'multipart';
            }}
          />
          <label for="import-mode-multipart">Multipart export</label>
        </div>
      </fieldset>

      {#if importMode === 'single'}
        <ImportForm
          {db}
          onCommitted={() => {
            if (db) void refresh(db);
          }}
        />
      {:else}
        <MultipartImportForm
          {db}
          onCommitted={() => {
            if (db) void refresh(db);
          }}
        />
      {/if}

      <RunHistory {runs} />
    {/if}
  {:else}
    <p>Opening local storage&hellip;</p>
  {/if}
</main>

<style>
  fieldset {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1.5rem;
    align-items: center;
  }

  fieldset div {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  fieldset label {
    margin: 0;
  }
</style>
