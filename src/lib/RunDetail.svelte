<script lang="ts">
  import {
    buildRunTableColumns,
    identityDisplayText,
    identityKeyForIdentity,
    projectRunRows,
    rawCellDisplayText,
    sortByColumn,
    type SortDirection,
  } from '../core/display';
  import type { RunEnvelopeV1, RunEnvelopeV2 } from '../core/envelope';
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

  $effect(() => {
    const targetRunId = runId;
    loaded = false;
    run = undefined;
    void (async () => {
      const found = await getRun(db, targetRunId);
      if (targetRunId !== runId) return; // a newer navigation started; discard this result
      run = found;
      loaded = true;
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
</script>

<section aria-labelledby="run-detail-heading">
  <p><a href="#/">&larr; Back to run history</a></p>

  {#if !loaded}
    <p>Loading run&hellip;</p>
  {:else if run === undefined}
    <p role="alert" class="n200-badge n200-badge--error">No run was found for this ID.</p>
  {:else if !openable}
    <h2 id="run-detail-heading">Run not available</h2>
    <p role="alert" class="n200-badge n200-badge--warning">{blockedMessage(run)}</p>
  {:else if envelope !== undefined && projection !== undefined}
    <h2 id="run-detail-heading">Run for {envelope.effective_date}</h2>
    <dl>
      <div>
        <dt>Effective date</dt>
        <dd>{envelope.effective_date}</dd>
      </div>
      <div>
        <dt>Imported</dt>
        <dd>{envelope.imported_at}</dd>
      </div>
      <div>
        <dt>Universe</dt>
        <dd>{envelope.universe}</dd>
      </div>
      <div>
        <dt>Stock count</dt>
        <dd>
          {envelope.stock_count}
          {#if isEnvelopeV2(envelope)}
            <span>({envelope.unique_stock_count} unique)</span>
          {/if}
        </dd>
      </div>
      <div>
        <dt>Source</dt>
        <dd>
          {#each sourceFilenames(envelope) as filename (filename)}
            <div>{filename}</div>
          {/each}
        </dd>
      </div>
      <div>
        <dt>Sync state</dt>
        <dd>{run.sync.state}</dd>
      </div>
      <div>
        <dt>Backup</dt>
        <dd>
          {#if isRunAtRisk(run)}
            <span class="n200-badge n200-badge--warning">At risk &mdash; no verified backup</span>
          {:else}
            <span class="n200-badge n200-badge--success">Backed up</span>
          {/if}
        </dd>
      </div>
      <div>
        <dt>Run ID</dt>
        <dd>{run.run_id}</dd>
      </div>
    </dl>

    {#if envelope.query_text}
      <p>Screener query: {envelope.query_text}</p>
    {/if}

    {#if projection.rows.length === 0}
      <p role="status" class="n200-badge n200-badge--warning">
        This run has zero stocks. It was committed as an explicitly acknowledged empty run.
      </p>
    {:else}
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
    {/if}
  {/if}
</section>

<style>
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.25rem 1rem;
    margin-block: 1rem;
  }

  dl > div {
    display: contents;
  }

  dt {
    font-weight: 600;
  }

  dd {
    margin: 0;
  }

  .table-scroll {
    max-width: 100%;
    overflow-x: auto;
  }

  table {
    width: 100%;
    font-size: 0.9rem;
  }

  th button {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    font: inherit;
    font-weight: 600;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }

  th button:hover {
    text-decoration: underline;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
