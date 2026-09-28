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
  import RunsList from './lib/RunsList.svelte';
  import StatusBar from './lib/StatusBar.svelte';

  let db = $state<N200Database | undefined>(undefined);
  let singleTabWarning = $state(false);
  let reloadNeeded = $state(false);
  let runs = $state<RunRecord[]>([]);
  let atRiskCount = $state(0);
  let persist = $state<PersistPromptResult | undefined>(undefined);
  let initError = $state<string | undefined>(undefined);

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
  {:else if db}
    <StatusBar {singleTabWarning} {persist} {atRiskCount} />
    <ImportForm
      {db}
      onCommitted={() => {
        if (db) void refresh(db);
      }}
    />
    <RunsList {runs} />
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
</style>
