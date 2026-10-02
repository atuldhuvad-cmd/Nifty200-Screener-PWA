<script lang="ts">
  import {
    buildRunTableColumns,
    identityDisplayText,
    identityKeyForIdentity,
    projectRunRows,
    rawCellDisplayText,
    sortByColumn,
    buildSwingChecklist,
    describeSwingChecklist,
    type SortDirection,
  } from '../core/display';
  import type { RunEnvelopeV1, RunEnvelopeV2 } from '../core/envelope';
  import {
    fetchNifty200Constituents,
    verifyRowsAgainstNifty200,
    type Nifty200Verification,
  } from '../core/universe';
  import {
    getRun,
    isEnvelopeV1,
    isEnvelopeV2,
    isRunAtRisk,
    isRunOpenable,
    type N200Database,
    type RunRecord,
  } from '../core/storage';
  import { describeVolumeRatio } from './importMessages';
  import { compareHash } from './route';

  interface Props {
    db: N200Database;
    runId: string;
  }

  const { db, runId }: Props = $props();

  let run = $state<RunRecord | undefined>(undefined);
  let loaded = $state(false);
  let sortKey = $state<string | null>(null);
  let sortDirection = $state<SortDirection>('asc');
  let verifyingNifty200 = $state(false);
  let nifty200Verification = $state<Nifty200Verification | undefined>(undefined);
  let nifty200VerificationError = $state<string | undefined>(undefined);

  $effect(() => {
    const targetRunId = runId;
    loaded = false;
    run = undefined;
    void (async () => {
      const found = await getRun(db, targetRunId);
      if (targetRunId !== runId) return; // a newer navigation started; discard this result
      run = found;
      loaded = true;
      nifty200Verification = undefined;
      nifty200VerificationError = undefined;
    })();
  });

  const openable = $derived(run !== undefined && isRunOpenable(run));
  const envelope = $derived(
    run !== undefined && openable ? (run.envelope as RunEnvelopeV1 | RunEnvelopeV2) : undefined,
  );
  const projection = $derived(envelope !== undefined ? projectRunRows(envelope) : undefined);
  const columns = $derived(projection !== undefined ? buildRunTableColumns(projection) : []);

  const sortedRows = $derived.by(() => {
    if (projection === undefined) return [];
    if (sortKey === null) return projection.rows;
    const column = columns.find((c) => c.key === sortKey);
    if (!column) return projection.rows;
    return sortByColumn(projection.rows, column.getSortValue, (r) => r.position, sortDirection);
  });

  function toggleSort(key: string): void {
    if (sortKey !== key) {
      sortKey = key;
      sortDirection = 'asc';
    } else {
      sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    }
  }

  function ariaSortFor(key: string): 'ascending' | 'descending' | 'none' {
    if (sortKey !== key) return 'none';
    return sortDirection === 'asc' ? 'ascending' : 'descending';
  }

  function sourceFilenames(e: RunEnvelopeV1 | RunEnvelopeV2): string[] {
    return isEnvelopeV1(e)
      ? [e.original_filename]
      : e.source_files.map((sf: RunEnvelopeV2['source_files'][number]) => sf.original_filename);
  }

  function blockedMessage(r: RunRecord): string {
    const state = r.sync.state;
    if (state === 'conflict' || state === 'quarantined' || state === 'unsupported_schema') {
      return `This run cannot be opened: it is currently ${state.replace('_', ' ')}.`;
    }
    return 'This run cannot be opened: its schema version is not supported by this app version.';
  }

  async function verifyNifty200Universe(): Promise<void> {
    if (projection === undefined) return;
    verifyingNifty200 = true;
    nifty200Verification = undefined;
    nifty200VerificationError = undefined;
    const list = await fetchNifty200Constituents();
    if (!list.ok) {
      nifty200VerificationError = list.message;
      verifyingNifty200 = false;
      return;
    }
    nifty200Verification = verifyRowsAgainstNifty200(projection.rows, list.constituents);
    verifyingNifty200 = false;
  }
</script>

<section aria-labelledby="run-detail-heading" class="screen screen--run-detail">
  <div class="screen-toolbar">
    <a class="back-link" href="#/">&larr; Back to run history</a>
  </div>

  {#if !loaded}
    <p>Loading run&hellip;</p>
  {:else if run === undefined}
    <p role="alert" class="n200-badge n200-badge--error">No run was found for this ID.</p>
  {:else if !openable}
    <h2 id="run-detail-heading">Run not available</h2>
    <p role="alert" class="n200-badge n200-badge--warning">{blockedMessage(run)}</p>
  {:else if envelope !== undefined && projection !== undefined}
    <div class="run-hero">
      <div>
        <p class="eyebrow">Run detail</p>
        <h2 id="run-detail-heading">Run for {envelope.effective_date}</h2>
      </div>
      <div class="run-hero__status">
        {#if isRunAtRisk(run)}
          <span class="n200-badge n200-badge--warning">At risk &mdash; no verified backup</span>
        {:else}
          <span class="n200-badge n200-badge--success">Backed up</span>
        {/if}
      </div>
    </div>

    <dl class="summary-grid">
      <div class="summary-card">
        <dt>Effective date</dt>
        <dd>{envelope.effective_date}</dd>
      </div>
      <div class="summary-card">
        <dt>Stock count</dt>
        <dd>
          {envelope.stock_count}
          {#if isEnvelopeV2(envelope)}
            <span>({envelope.unique_stock_count} unique)</span>
          {/if}
        </dd>
      </div>
      <div class="summary-card">
        <dt>Sync state</dt>
        <dd>{run.sync.state}</dd>
      </div>
      <div class="summary-card">
        <dt>Universe</dt>
        <dd>{envelope.universe}</dd>
      </div>
      <div class="summary-card summary-card--wide">
        <dt>Imported</dt>
        <dd>{envelope.imported_at}</dd>
      </div>
      <div class="summary-card summary-card--wide">
        <dt>Source</dt>
        <dd>
          {#each sourceFilenames(envelope) as filename (filename)}
            <div>{filename}</div>
          {/each}
        </dd>
      </div>
      <div class="summary-card summary-card--wide">
        <dt>Run ID</dt>
        <dd>{run.run_id}</dd>
      </div>
    </dl>

    {#if envelope.query_text}
      <p>Screener query: {envelope.query_text}</p>
    {/if}

    <section class="data-panel" aria-labelledby="nifty200-verify-heading">
      <div class="data-panel__head">
        <div>
          <p class="eyebrow">Universe check</p>
          <h3 id="nifty200-verify-heading">Current Nifty 200 membership</h3>
        </div>
        <button
          type="button"
          class="secondary-button"
          disabled={verifyingNifty200 || projection.rows.length === 0}
          onclick={() => {
            void verifyNifty200Universe();
          }}
        >
          {verifyingNifty200 ? 'Checking…' : 'Fetch NSE list and verify'}
        </button>
      </div>
      <p>
        This fetches the official Nifty 200 constituents CSV from NSE/Nifty Indices and compares
        this run by ISIN or NSE Code. Until this check passes, the app only knows what the imported
        file says.
      </p>
      {#if nifty200VerificationError}
        <p role="alert" class="n200-badge n200-badge--warning">{nifty200VerificationError}</p>
      {:else if nifty200Verification !== undefined}
        <p
          role="status"
          class="n200-badge {nifty200Verification.missingRows.length === 0 &&
          nifty200Verification.unverifiedRows.length === 0
            ? 'n200-badge--success'
            : 'n200-badge--warning'}"
        >
          {nifty200Verification.matchedRows}/{nifty200Verification.runRows} rows matched the current official
          list. Official list rows: {nifty200Verification.constituentCount}. Checked: {nifty200Verification.checkedAt}.
        </p>
        {#if nifty200Verification.missingRows.length > 0}
          <p>Rows not found in the official list:</p>
          <ul>
            {#each nifty200Verification.missingRows as row (row.position)}
              <li>Row {row.position}: {row.identity}</li>
            {/each}
          </ul>
        {/if}
        {#if nifty200Verification.unverifiedRows.length > 0}
          <p>Rows that could not be verified:</p>
          <ul>
            {#each nifty200Verification.unverifiedRows as row (row.position)}
              <li>Row {row.position}: {row.reason}</li>
            {/each}
          </ul>
        {/if}
        <p>
          Source:
          <a href={nifty200Verification.sourceUrl} rel="noreferrer" target="_blank"
            >NSE/Nifty Indices Nifty 200 constituents CSV</a
          >
        </p>
      {/if}
    </section>

    {#if projection.rows.length === 0}
      <p role="status" class="n200-badge n200-badge--warning">
        This run has zero stocks. It was committed as an explicitly acknowledged empty run.
      </p>
    {:else}
      <section class="data-panel" aria-labelledby="run-table-heading">
        <div class="data-panel__head">
          <div>
            <p class="eyebrow">Data grid</p>
            <h3 id="run-table-heading">Stocks in this run</h3>
          </div>
          <p>{projection.rows.length} row{projection.rows.length === 1 ? '' : 's'}</p>
        </div>
        <p class="n200-badge n200-badge--gold">
          Swing checklist is informational only. It does not say Buy, Sell, or Avoid. It does not
          score stocks, filter automatically, or verify whether the CSV is truly current Nifty 200
          beyond what the imported file says.
        </p>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div class="table-scroll" role="region" aria-label="Run stock table" tabindex="0">
          <table>
            <caption class="visually-hidden">
              Full stock table for the run effective {envelope.effective_date}, {projection.rows
                .length} rows. Column headers are sortable.
            </caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                {#each columns as col (col.key)}
                  <th scope="col" aria-sort={ariaSortFor(col.key)}>
                    <button type="button" onclick={() => toggleSort(col.key)}>
                      {col.label}
                      {#if sortKey === col.key}
                        <span aria-hidden="true">{sortDirection === 'asc' ? '▲' : '▼'}</span>
                      {/if}
                    </button>
                    {#if col.isProviderVolumeRatio}
                      <span class="n200-badge n200-badge--gold"
                        >provider-reported, not the app ratio</span
                      >
                    {/if}
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each sortedRows as row, i (row.position)}
                <tr>
                  <th scope="row">{i + 1}</th>
                  {#each columns as col (col.key)}
                    <td>
                      {#if col.role.role === 'sourceFile'}
                        {row.sourceFilename}
                      {:else if col.role.role === 'sourceRow'}
                        {row.sourceRowNumber}
                      {:else if col.role.role === 'identity'}
                        {#if identityKeyForIdentity(row.identity) !== null}
                          <a href={compareHash(identityKeyForIdentity(row.identity))}
                            >{identityDisplayText(row.identity)}
                            <span class="visually-hidden">(compare across runs)</span></a
                          >
                        {:else}
                          {identityDisplayText(row.identity)}
                        {/if}
                      {:else if col.role.role === 'appVolumeRatio'}
                        {describeVolumeRatio(row.volumeRatio)}
                      {:else if col.role.role === 'swingChecklist'}
                        {describeSwingChecklist(buildSwingChecklist(row, projection.columns))}
                      {:else}
                        {rawCellDisplayText(row, col.role.columnIndex)}
                      {/if}
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}
  {/if}
</section>

<style>
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
