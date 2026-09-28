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
  import { getDatabase } from './lib/db';
  import ImportForm from './lib/ImportForm.svelte';
  import MultipartImportForm from './lib/MultipartImportForm.svelte';
  import RunDetail from './lib/RunDetail.svelte';
  import RunHistory from './lib/RunHistory.svelte';
  import { parseRunIdFromHash } from './lib/route';
  import StatusBar from './lib/StatusBar.svelte';

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
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
  });
</script>

<main>
  <h1>Nifty 200 Screener</h1>

  {#if reloadNeeded}
    <p role="alert" class="n200-badge n200-badge--warning">
      This app was updated in another tab. Reload this page before continuing.
    </p>
  {/if}

  {#if initError}
    <p role="alert" class="n200-badge n200-badge--error">{initError}</p>
  {:else if db && selectedRunId !== null}
    <RunDetail {db} runId={selectedRunId} />
  {:else if db}
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
  {:else}
    <p>Opening local storage&hellip;</p>
  {/if}
</main>

<style>
  main {
    max-width: 60rem;
    margin: 2rem auto;
    padding: 0 1rem 4rem;
  }

  h1 {
    color: var(--color-gold);
  }

  fieldset {
    display: flex;
    gap: 1.5rem;
    align-items: center;
    padding: 0.75rem 1rem;
    margin-block: 1rem;
  }

  fieldset div {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  legend {
    font-weight: 600;
    padding-inline: 0.25rem;
  }
</style>
