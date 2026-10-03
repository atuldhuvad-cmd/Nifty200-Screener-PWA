<script lang="ts">
  import type { RowAnalysis } from '../core/csv/analyze';
  import {
    buildSwingChecklistFromCells,
    describeSwingChecklist,
    normalizeForDisplay,
    type DisplayColumn,
  } from '../core/display';
  import type { RunUniverse } from '../core/envelope';
  import { describeVolumeRatio } from './importMessages';

  interface Props {
    headers: string[];
    rows: string[][];
    rowAnalyses: RowAnalysis[];
    providerColumnIndex: number | undefined;
    universe: RunUniverse;
  }

  const { headers, rows, rowAnalyses, providerColumnIndex, universe }: Props = $props();

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

  const displayColumns = $derived<DisplayColumn[]>(
    headers.map((h, i) => ({
      key: String(i),
      headerKey: h
        .replace(/^[ \t\u00A0]+|[ \t\u00A0]+$/g, '')
        .replace(/[ \t\u00A0]+/g, ' ')
        .replace(/[A-Z]/g, (c) => c.toLowerCase()),
      label: headerLabel(h),
    })),
  );

  function rowSwingChecklistText(r: number): string {
    const analysis = rowAnalyses[r];
    const row = rows[r];
    if (analysis === undefined || row === undefined) return '';
    return describeSwingChecklist(
      buildSwingChecklistFromCells(displayColumns, row, analysis.volumeRatio),
    );
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="table-scroll" role="region" aria-label="CSV preview table" tabindex="0">
  <p class="n200-badge n200-badge--gold">
    Swing checklist is informational only. It does not say Buy, Sell, or Avoid. It does not score
    stocks, filter automatically, or verify whether the CSV is truly current {universe} beyond what the
    imported file says.
  </p>
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
        <th scope="col">Swing checklist (not a score)</th>
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
          <td>{rowSwingChecklistText(r)}</td>
          <td>{rowVolumeRatioText(r)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

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
