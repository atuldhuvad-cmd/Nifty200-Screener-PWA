<script lang="ts">
  import {
    isEnvelopeV1,
    isEnvelopeV2,
    isRunAtRisk,
    isRunOpenable,
    isSupportedEnvelope,
    type RunRecord,
  } from '../core/storage';
  import { sortRunsForHistory } from '../core/display';
  import { runDetailHash } from './route';

  interface Props {
    runs: RunRecord[];
  }

  const { runs }: Props = $props();

  function effectiveDate(run: RunRecord): string {
    return isSupportedEnvelope(run.envelope) ? run.envelope.effective_date : '—';
  }

  function importedAt(run: RunRecord): string {
    return isSupportedEnvelope(run.envelope) ? run.envelope.imported_at : '—';
  }

  function universe(run: RunRecord): string {
    return isSupportedEnvelope(run.envelope) ? run.envelope.universe : '—';
  }

  function stockCount(run: RunRecord): string {
    return isSupportedEnvelope(run.envelope) ? String(run.envelope.stock_count) : '—';
  }

  function sourceDescription(run: RunRecord): string {
    const { envelope } = run;
    if (isEnvelopeV1(envelope)) return '1 file';
    if (isEnvelopeV2(envelope)) return `${String(envelope.source_files.length)} parts`;
    return '—';
  }

  function shortRunId(runId: string): string {
    return runId.length <= 8 ? runId : `${runId.slice(0, 8)}…`;
  }

  function blockedReason(run: RunRecord): string | undefined {
    if (!isSupportedEnvelope(run.envelope)) return 'unsupported schema';
    if (run.sync.state === 'conflict') return 'conflict';
    if (run.sync.state === 'quarantined') return 'quarantined';
    if (run.sync.state === 'unsupported_schema') return 'unsupported schema';
    return undefined;
  }

  const sortedRuns = $derived(sortRunsForHistory(runs));
</script>

<section aria-labelledby="run-history-heading">
  <h2 id="run-history-heading">Run history</h2>
  {#if runs.length === 0}
    <p>No runs have been committed yet.</p>
  {:else}
    <p id="run-history-order">
      Runs are ordered by effective date (newest first), then import time (newest first), then run
      ID.
    </p>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="table-scroll" role="region" aria-label="Run history table" tabindex="0">
      <table aria-describedby="run-history-order">
        <caption class="visually-hidden">List of committed runs, in default order</caption>
        <thead>
          <tr>
            <th scope="col">Effective date</th>
            <th scope="col">Imported</th>
            <th scope="col">Universe</th>
            <th scope="col">Stock count</th>
            <th scope="col">Source</th>
            <th scope="col">Sync state</th>
            <th scope="col">Backup</th>
            <th scope="col">Run ID</th>
            <th scope="col">Open</th>
          </tr>
        </thead>
        <tbody>
          {#each sortedRuns as run (run.run_id)}
            <tr>
              <td>{effectiveDate(run)}</td>
              <td>{importedAt(run)}</td>
              <td>{universe(run)}</td>
              <td>{stockCount(run)}</td>
              <td>{sourceDescription(run)}</td>
              <td>{run.sync.state}</td>
              <td>
                {#if isRunAtRisk(run)}
                  <span class="n200-badge n200-badge--warning"
                    >At risk &mdash; no verified backup</span
                  >
                {:else}
                  <span class="n200-badge n200-badge--success">Backed up</span>
                {/if}
              </td>
              <td>
                <span title={run.run_id} aria-label={`Run ID ${run.run_id}`}
                  >{shortRunId(run.run_id)}</span
                >
              </td>
              <td>
                {#if isRunOpenable(run)}
                  <a href={runDetailHash(run.run_id)}
                    >Open <span class="visually-hidden"
                      >run {shortRunId(run.run_id)} ({effectiveDate(run)})</span
                    ></a
                  >
                {:else}
                  <span class="n200-badge n200-badge--warning"
                    >Not available &mdash; {blockedReason(run)}</span
                  >
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<style>
  .table-scroll {
    max-width: 100%;
    overflow-x: auto;
  }

  table {
    width: 100%;
    font-size: 0.9rem;
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
