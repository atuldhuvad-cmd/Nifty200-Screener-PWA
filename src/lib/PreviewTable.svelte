<script lang="ts">
  import type { RowAnalysis } from '../core/csv/analyze';
  import { normalizeForDisplay } from '../core/display/normalizeForDisplay';
  import { describeVolumeRatio } from './importMessages';

  interface Props {
    headers: string[];
    rows: string[][];
    rowAnalyses: RowAnalysis[];
    providerColumnIndex: number | undefined;
  }

  const { headers, rows, rowAnalyses, providerColumnIndex }: Props = $props();

  function cell(row: string[], c: number): string {
    return normalizeForDisplay(row[c] ?? '');
  }

  function headerLabel(h: string): string {
    const normalized = normalizeForDisplay(h);
    return normalized === '' ? '(blank header)' : normalized;
  }

  function rowVolumeRatioText(r: number): string {
    const analysis = rowAnalyses[r];
    return analysis === undefined ? '' : describeVolumeRatio(analysis.volumeRatio);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="table-scroll" role="region" aria-label="CSV preview table" tabindex="0">
  <table>
    <caption class="visually-hidden">
      Preview of the parsed CSV: {rows.length} data row{rows.length === 1 ? '' : 's'}.
    </caption>
    <thead>
      <tr>
        <th scope="col">#</th>
        {#each headers as h, i (i)}
          <th scope="col">
            {headerLabel(h)}
            {#if i === providerColumnIndex}
              <span class="n200-badge n200-badge--gold">provider-reported, not the app ratio</span>
            {/if}
          </th>
        {/each}
        <th scope="col">App Volume Ratio (computed)</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row, r (r)}
        <tr>
          <th scope="row">{r + 1}</th>
          {#each headers as header, c (header + String(c))}
            <td>{cell(row, c)}</td>
          {/each}
          <td>{rowVolumeRatioText(r)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

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
