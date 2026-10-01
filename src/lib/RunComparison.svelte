<script lang="ts">
  import type { MatchMethod } from '../core/csv';
  import {
    buildComparisonPickerEntries,
    buildComparisonResult,
    sortRunsChronologically,
    type ComparisonResult,
  } from '../core/display';
  import {
    findIdentityConflicts,
    getAllRuns,
    isRunOpenable,
    listComparisonIdentityGroups,
    type ComparisonIdentityGroup,
    type IdentityConflictGroup,
    type N200Database,
    type RunRecord,
  } from '../core/storage';
  import { describeVolumeRatio } from './importMessages';
  import { compareHash } from './route';

  interface Props {
    db: N200Database;
    /** `null` means the picker-only state — no stock chosen yet. */
    identityKey: string | null;
  }

  const { db, identityKey }: Props = $props();

  let runs = $state<RunRecord[]>([]);
  let groups = $state<ComparisonIdentityGroup[]>([]);
  let conflicts = $state<IdentityConflictGroup[]>([]);
  let loaded = $state(false);
  let selectedRunIds = $state<Record<string, boolean>>({});

  // Re-runs on every identityKey change: a fresh query each time, re-checking every run's
  // *current* sync state (never cached) — a run that moved into/out of an excluded state
  // disappears/reappears here without any index rebuild. Default run selection ("all eligible")
  // resets alongside it, per the round's "defaulting to all eligible runs" instruction.
  $effect(() => {
    const requestedKey = identityKey;
    loaded = false;
    void (async () => {
      const [allRuns, allGroups, allConflicts] = await Promise.all([
        getAllRuns(db),
        listComparisonIdentityGroups(db),
        findIdentityConflicts(db),
      ]);
      if (requestedKey !== identityKey) return; // a newer selection started; discard this result
      runs = allRuns;
      groups = allGroups;
      conflicts = allConflicts;
      selectedRunIds = Object.fromEntries(
        allRuns.filter(isRunOpenable).map((r) => [r.run_id, true as const]),
      );
      loaded = true;
    })();
  });

  const runsById = $derived(new Map(runs.map((r) => [r.run_id, r])));
  const eligibleRuns = $derived(sortRunsChronologically(runs.filter(isRunOpenable)));
  const pickerEntries = $derived(buildComparisonPickerEntries(groups, runsById));
  const selectedGroup = $derived(groups.find((g) => g.identity_key === identityKey));

  const runsToCompare = $derived(eligibleRuns.filter((r) => selectedRunIds[r.run_id] === true));
  const comparisonResult: ComparisonResult | undefined = $derived(
    selectedGroup !== undefined ? buildComparisonResult(selectedGroup, runsToCompare) : undefined,
  );

  const relatedConflict = $derived.by(() => {
    const isin = selectedGroup?.normalized_isin;
    if (isin === null || isin === undefined) return undefined;
    return conflicts.find((c) => c.entries.some((e) => e.normalized_isin === isin));
  });

  function onPickerChange(event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value;
    location.hash = compareHash(value === '' ? null : value);
  }

  function toggleRun(runId: string): void {
    selectedRunIds = { ...selectedRunIds, [runId]: selectedRunIds[runId] !== true };
  }

  function shortRunId(runId: string): string {
    return runId.length <= 8 ? runId : `${runId.slice(0, 8)}…`;
  }

  function matchMethodText(method: MatchMethod): string {
    return method === 'isin' ? 'ISIN' : 'nse_code_provisional';
  }

  function pickerLabel(entry: (typeof pickerEntries)[number]): string {
    const idLabel = entry.normalizedIsin ?? entry.normalizedNseCode ?? entry.identityKey;
    const namePart = entry.sampleStockName ? `${entry.sampleStockName} — ` : '';
    const provisional = entry.matchMethod === 'nse_code_provisional' ? ' (provisional)' : '';
    return `${namePart}${idLabel}${provisional} (${String(entry.eligibleRunCount)} run${entry.eligibleRunCount === 1 ? '' : 's'})`;
  }
</script>

<section aria-labelledby="comparison-heading">
  <h2 id="comparison-heading">Compare a stock across runs</h2>
  <p><a href="#/">&larr; Back to run history</a></p>

  {#if !loaded}
    <p>Loading comparison data&hellip;</p>
  {:else}
    <div>
      <label for="stock-picker">Choose a stock to compare</label>
      {#if pickerEntries.length === 0}
        <p>No comparable stocks are available yet from any eligible run.</p>
      {:else}
        <select id="stock-picker" value={identityKey ?? ''} onchange={onPickerChange}>
          <option value="">Select a stock&hellip;</option>
          {#each pickerEntries as entry (entry.identityKey)}
            <option value={entry.identityKey}>{pickerLabel(entry)}</option>
          {/each}
        </select>
      {/if}
    </div>

    {#if conflicts.length > 0}
      <div role="status">
        <p class="n200-badge n200-badge--warning">
          {conflicts.length} identity conflict{conflicts.length === 1 ? '' : 's'} detected: the same NSE
          Code is associated with more than one valid ISIN across your runs. Conflicting identities are
          never automatically merged into one comparison.
        </p>
        <ul>
          {#each conflicts as conflict (conflict.normalized_nse_code)}
            <li>
              NSE Code {conflict.normalized_nse_code}: ISINs {[
                ...new Set(
                  conflict.entries.map((e) => e.normalized_isin).filter((v) => v !== null),
                ),
              ].join(', ')}
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if identityKey !== null && selectedGroup === undefined}
      <p role="alert" class="n200-badge n200-badge--error">
        No comparable stock was found for this identity. It may have no eligible-run occurrences, or
        the link may be out of date.
      </p>
    {:else if selectedGroup !== undefined && comparisonResult !== undefined}
      {#if relatedConflict}
        <div role="alert">
          <p class="n200-badge n200-badge--error">
            Identity conflict: NSE Code {relatedConflict.normalized_nse_code} is also associated with
            a different ISIN in your runs. This comparison shows only ISIN {selectedGroup.normalized_isin}'s
            own history — it is never automatically merged with the other ISIN.
          </p>
        </div>
      {/if}

      {#if selectedGroup.match_method === 'nse_code_provisional'}
        <p class="n200-badge n200-badge--gold">
          Provisional match by NSE Code only (no valid ISIN available). Never silently upgraded to
          an ISIN match, even if a later run supplies one.
        </p>
      {/if}

      <fieldset>
        <legend>Runs included in this comparison</legend>
        <p id="comparison-order">
          Runs are ordered by effective date (oldest first), then import time (oldest first), then
          run ID — the historical-progression reading order. All eligible runs are included by
          default; uncheck any run to exclude it.
        </p>
        {#each eligibleRuns as run (run.run_id)}
          <div>
            <input
              id={`include-run-${run.run_id}`}
              type="checkbox"
              checked={selectedRunIds[run.run_id] === true}
              onchange={() => toggleRun(run.run_id)}
            />
            <label for={`include-run-${run.run_id}`}
              >{run.envelope.schema_version === '1' || run.envelope.schema_version === '2'
                ? run.envelope.effective_date
                : '—'} — {shortRunId(run.run_id)}</label
            >
          </div>
        {/each}
      </fieldset>

      {#if comparisonResult.runs.length === 0}
        <p role="status" class="n200-badge n200-badge--warning">
          No runs are selected. Check at least one run above to see its comparison.
        </p>
      {:else}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div class="table-scroll" role="region" aria-label="Stock comparison table" tabindex="0">
          <table aria-describedby="comparison-order">
            <caption class="visually-hidden">
              Longitudinal comparison for the selected stock across {comparisonResult.runs.length}
              run{comparisonResult.runs.length === 1 ? '' : 's'}, oldest first.
            </caption>
            <thead>
              <tr>
                <th scope="col">Effective date</th>
                <th scope="col">Imported / Run ID</th>
                <th scope="col">Presence</th>
                <th scope="col">Stock name</th>
                <th scope="col">Raw ISIN</th>
                <th scope="col">Normalized ISIN</th>
                <th scope="col">Raw NSE Code</th>
                <th scope="col">Normalized NSE Code</th>
                <th scope="col">Match method</th>
                <th scope="col">App Volume Ratio</th>
                <th scope="col">Provider VolumeRatio</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {#each comparisonResult.runs as runColumn, i (runColumn.runId)}
                {@const cell = comparisonResult.cells[i]}
                <tr>
                  <th scope="row">{runColumn.effectiveDate}</th>
                  <td
                    >{runColumn.importedAt}
                    <span title={runColumn.runId}>({shortRunId(runColumn.runId)})</span></td
                  >
                  <td>
                    {#if cell?.status === 'present'}
                      <span class="n200-badge n200-badge--success">Present</span>
                    {:else}
                      <span class="n200-badge n200-badge--warning">Absent</span>
                    {/if}
                  </td>
                  {#if cell?.status === 'present'}
                    <td>{cell.stockName ?? '—'}</td>
                    <td>{cell.row.identity.raw_isin || '—'}</td>
                    <td>{cell.row.identity.normalized_isin ?? '—'}</td>
                    <td>{cell.row.identity.raw_nse_code || '—'}</td>
                    <td>{cell.row.identity.normalized_nse_code ?? '—'}</td>
                    <td
                      >{cell.row.identity.match_method === null
                        ? '—'
                        : matchMethodText(cell.row.identity.match_method)}</td
                    >
                    <td>{describeVolumeRatio(cell.row.volumeRatio)}</td>
                    <td>{cell.row.providerVolumeRatioRaw ?? '—'}</td>
                    <td>{cell.row.sourceFilename} (row {cell.row.sourceRowNumber})</td>
                  {:else}
                    <td colspan="8">Absent from this run</td>
                  {/if}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
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
