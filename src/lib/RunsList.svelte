<script lang="ts">
  import type { RunEnvelopeV1, RunEnvelopeV2 } from '../core/envelope';
  import type { RunRecord } from '../core/storage';

  interface Props {
    runs: RunRecord[];
  }

  const { runs }: Props = $props();

  function isV1(envelope: RunRecord['envelope']): envelope is RunEnvelopeV1 {
    return envelope.schema_version === '1';
  }

  function isV2(envelope: RunRecord['envelope']): envelope is RunEnvelopeV2 {
    return envelope.schema_version === '2';
  }

  function isSupportedVersion(
    envelope: RunRecord['envelope'],
  ): envelope is RunEnvelopeV1 | RunEnvelopeV2 {
    return isV1(envelope) || isV2(envelope);
  }

  function isAtRisk(run: RunRecord): boolean {
    const { state, diagnostics } = run.sync;
    if (state === 'quarantined' || state === 'unsupported_schema') return false;
    return !diagnostics.has_verified_remote_copy;
  }

  function effectiveDate(run: RunRecord): string {
    return isSupportedVersion(run.envelope) ? run.envelope.effective_date : '—';
  }

  function universe(run: RunRecord): string {
    return isSupportedVersion(run.envelope) ? run.envelope.universe : '—';
  }

  function stockCount(run: RunRecord): string {
    return isSupportedVersion(run.envelope) ? String(run.envelope.stock_count) : '—';
  }

  function sourceDescription(run: RunRecord): string {
    const envelope = run.envelope;
    if (isV1(envelope)) return '1 file';
    if (isV2(envelope)) return `${String(envelope.source_files.length)} parts`;
    return '—';
  }

  const sortedRuns = $derived(
    [...runs].sort((a, b) => effectiveDate(b).localeCompare(effectiveDate(a))),
  );
</script>

<section aria-labelledby="runs-heading">
  <h2 id="runs-heading">Committed runs</h2>
  {#if runs.length === 0}
    <p>No runs have been committed yet.</p>
  {:else}
    <table>
      <caption class="visually-hidden">List of committed runs</caption>
      <thead>
        <tr>
          <th scope="col">Effective date</th>
          <th scope="col">Universe</th>
          <th scope="col">Stock count</th>
          <th scope="col">Source</th>
          <th scope="col">Sync state</th>
          <th scope="col">Remote backup</th>
        </tr>
      </thead>
      <tbody>
        {#each sortedRuns as run (run.run_id)}
          <tr>
            <td>{effectiveDate(run)}</td>
            <td>{universe(run)}</td>
            <td>{stockCount(run)}</td>
            <td>{sourceDescription(run)}</td>
            <td>{run.sync.state}</td>
            <td>
              {#if isAtRisk(run)}
                <span class="n200-badge n200-badge--warning"
                  >At risk &mdash; no verified backup</span
                >
              {:else}
                <span class="n200-badge n200-badge--success">Backed up</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
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
