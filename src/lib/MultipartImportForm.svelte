<script lang="ts">
  import { analyzeMultipartParts, type MultipartAnalysis } from '../core/csv';
  import {
    buildMultipartEnvelope,
    expectedUniverseCount,
    sha256Hex,
    type RunUniverse,
  } from '../core/envelope';
  import {
    buildSwingChecklistFromCells,
    describeSwingChecklist,
    type DisplayColumn,
  } from '../core/display';
  import {
    commitNewRun,
    findRunsByExactSourceHashSet,
    findRunsBySourceFileHash,
    withActivity,
    type N200Database,
  } from '../core/storage';
  import {
    describeImportError,
    describeImportWarning,
    describeVolumeRatio,
  } from './importMessages';

  interface Props {
    db: N200Database;
    universe: RunUniverse;
    universeValid: boolean;
    onCommitted: () => void;
  }

  const { db, universe, universeValid, onCommitted }: Props = $props();

  let fileInputEl: HTMLInputElement | undefined = $state();
  let files: File[] = $state([]);
  let analysis = $state<MultipartAnalysis | undefined>(undefined);
  let checkingDuplicates = $state(false);
  let anyPartPreviouslyImported = $state(false);
  let exactSetPreviouslyImported = $state(false);

  let effectiveDate = $state('');
  let attestationChecked = $state(false);
  let priorImportAck = $state(false);
  let combinedCountAck = $state(false);
  let queryText = $state('');

  let committing = $state(false);
  let commitError = $state<string | undefined>(undefined);
  let successMessage = $state<string | undefined>(undefined);

  const okAnalysis = $derived(analysis !== undefined && analysis.ok ? analysis : undefined);
  const canPreview = $derived(okAnalysis !== undefined && okAnalysis.canConfirm);
  const previewAnalysis = $derived(
    canPreview && okAnalysis !== undefined && okAnalysis.canConfirm ? okAnalysis : undefined,
  );
  const expectedCount = $derived(expectedUniverseCount(universe));
  const isNon200 = $derived(
    previewAnalysis !== undefined &&
      expectedCount !== undefined &&
      previewAnalysis.uniqueStockCount !== expectedCount,
  );
  const isPriorImport = $derived(anyPartPreviouslyImported || exactSetPreviouslyImported);
  const effectiveDateValid = $derived(/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate));
  const canConfirmCommit = $derived(
    previewAnalysis !== undefined &&
      effectiveDateValid &&
      attestationChecked &&
      universeValid &&
      (!isPriorImport || priorImportAck) &&
      (!isNon200 || combinedCountAck) &&
      !committing &&
      !checkingDuplicates,
  );

  function previewColumns(headers: readonly string[]): DisplayColumn[] {
    return headers.map((h, i) => ({
      key: String(i),
      headerKey: h
        .replace(/^[ \t\u00A0]+|[ \t\u00A0]+$/g, '')
        .replace(/[ \t\u00A0]+/g, ' ')
        .replace(/[A-Z]/g, (c) => c.toLowerCase()),
      label: h.trim() === '' ? '(blank header)' : h.trim(),
    }));
  }

  function swingChecklistText(row: {
    sourceIndex: number;
    sourceRowIndex: number;
    volumeRatio: Parameters<typeof describeVolumeRatio>[0];
  }): string {
    const part = previewAnalysis?.parts[row.sourceIndex];
    if (part === undefined || !part.analysis.ok) return '';
    const rawRow = part.analysis.parsed.rows[row.sourceRowIndex];
    if (rawRow === undefined) return '';
    return describeSwingChecklist(
      buildSwingChecklistFromCells(
        previewColumns(part.analysis.parsed.headers),
        rawRow,
        row.volumeRatio,
      ),
    );
  }

  async function handleFileChange(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const list = input.files;
    if (!list || list.length === 0) return;
    await loadFiles(Array.from(list));
  }

  async function loadFiles(selected: File[]): Promise<void> {
    resetFormFields();
    files = selected;
    const inputs = await Promise.all(
      selected.map(async (file) => ({
        bytes: new Uint8Array(await file.arrayBuffer()),
        filename: file.name,
        mimeType: file.type,
      })),
    );
    const expected = expectedUniverseCount(universe);
    analysis = analyzeMultipartParts(
      inputs,
      expected === undefined ? {} : { expectedUniqueStockCount: expected },
    );

    if (analysis.ok && analysis.canConfirm) {
      checkingDuplicates = true;
      try {
        const hashes = await Promise.all(inputs.map((i) => sha256Hex(i.bytes)));
        const perFileMatches = await Promise.all(
          hashes.map((h) => findRunsBySourceFileHash(db, h)),
        );
        anyPartPreviouslyImported = perFileMatches.some((m) => m.length > 0);
        const exactMatches = await findRunsByExactSourceHashSet(db, hashes);
        exactSetPreviouslyImported = exactMatches.length > 0;
      } finally {
        checkingDuplicates = false;
      }
    }
  }

  function resetFormFields(): void {
    effectiveDate = '';
    attestationChecked = false;
    priorImportAck = false;
    combinedCountAck = false;
    queryText = '';
    anyPartPreviouslyImported = false;
    exactSetPreviouslyImported = false;
    commitError = undefined;
    successMessage = undefined;
  }

  function cancel(): void {
    files = [];
    analysis = undefined;
    resetFormFields();
    if (fileInputEl) fileInputEl.value = '';
  }

  /** The whole confirm-and-commit runs holding the shared activity lock, so an app update
   * accepted in any open tab waits for it to finish. */
  function confirm(): Promise<void> {
    return withActivity(confirmCommit);
  }

  async function confirmCommit(): Promise<void> {
    if (!canConfirmCommit || previewAnalysis === undefined || files.length === 0) return;

    committing = true;
    commitError = undefined;
    try {
      // $state.snapshot strips Svelte's reactive proxy wrapper — without it, IndexedDB's
      // structured-clone algorithm cannot clone the analysis/file data (see Step 4's ImportForm
      // for the DataCloneError this was discovered from).
      const capturedAnalysis = $state.snapshot(previewAnalysis);
      const capturedMimeTypes = files.map((f) => f.type);
      const trimmedQuery = queryText.trim();

      let attempt = 0;
      let committedRunId: string | undefined;
      let committedEffectiveDate = '';
      let committedStockCount = 0;
      let lastReason: 'run_id_collision' | undefined;

      while (attempt < 5) {
        const built = await buildMultipartEnvelope({
          analysis: capturedAnalysis,
          fileMimeTypes: capturedMimeTypes,
          effectiveDate,
          universe,
          ...(trimmedQuery !== '' ? { queryText: trimmedQuery } : {}),
        });
        if (!built.ok) {
          commitError = 'These files could not be confirmed for import.';
          return;
        }
        const result = await commitNewRun(db, built.envelope);
        if (result.ok) {
          committedRunId = result.run_id;
          committedEffectiveDate = built.envelope.effective_date;
          committedStockCount = built.envelope.stock_count;
          break;
        }
        lastReason = result.reason;
        attempt += 1;
      }

      if (committedRunId !== undefined) {
        const message = `Committed multipart run for ${committedEffectiveDate} (${String(committedStockCount)} stock${committedStockCount === 1 ? '' : 's'}).`;
        onCommitted();
        cancel();
        successMessage = message;
      } else if (lastReason === 'run_id_collision') {
        commitError =
          'Could not generate a unique run ID after several attempts. Please try again.';
      }
    } catch {
      commitError = 'Something went wrong while committing this run. Please try again.';
    } finally {
      committing = false;
    }
  }
</script>

<section aria-labelledby="multipart-import-heading">
  <h2 id="multipart-import-heading">Import a multipart export</h2>
  <p>
    Select two or more CSV files that together make up one Trendlyne result (each export is limited
    to 100 rows).
  </p>

  <div>
    <label for="multipart-files">Choose CSV files (two or more)</label>
    <input
      bind:this={fileInputEl}
      id="multipart-files"
      type="file"
      accept=".csv,text/csv"
      multiple
      aria-describedby={analysis !== undefined && !analysis.ok
        ? 'multipart-file-errors'
        : undefined}
      onchange={handleFileChange}
    />
  </div>

  {#if files.length > 0 && files.length < 2}
    <p role="alert" class="n200-badge n200-badge--error">
      Select at least two files for a multipart import.
    </p>
  {/if}

  {#if analysis !== undefined}
    <h3>Selected files ({analysis.parts.length})</h3>
    <ol>
      {#each analysis.parts as part, i (i)}
        <li>
          <strong>{part.filename}</strong>
          {#if part.analysis.ok}
            &mdash; {part.analysis.parsed.rows.length} data row{part.analysis.parsed.rows.length ===
            1
              ? ''
              : 's'}
            {#if part.analysis.warnings.length > 0}
              <ul>
                {#each part.analysis.warnings as w, wi (wi)}
                  <li>{describeImportWarning(w)}</li>
                {/each}
              </ul>
            {/if}
            {#if !part.analysis.canConfirm}
              <ul>
                {#each part.analysis.blockingErrors as e, ei (ei)}
                  <li class="n200-badge n200-badge--error">{describeImportError(e)}</li>
                {/each}
              </ul>
            {/if}
          {:else}
            <ul>
              {#each part.analysis.errors as e, ei (ei)}
                <li class="n200-badge n200-badge--error">{describeImportError(e)}</li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}

  {#if analysis !== undefined && !analysis.ok}
    <div id="multipart-file-errors" role="alert">
      <p class="n200-badge n200-badge--error">
        This multipart import cannot proceed: at least one file failed to parse or has a blocking
        error above. Nothing will be written.
      </p>
    </div>
  {/if}

  {#if okAnalysis !== undefined}
    {#if okAnalysis.overlapErrors.length > 0}
      <div role="alert">
        <p class="n200-badge n200-badge--error">This combination of files cannot be confirmed:</p>
        <p>
          Multipart import is only for page 1/page 2/page 3 of the same Trendlyne result. If these
          are different screeners, import them one at a time.
        </p>
        <ul>
          {#each okAnalysis.overlapErrors as e, i (i)}
            <li>
              {#if e.code === 'DUPLICATE_ISIN_ACROSS_PARTS'}
                The same ISIN appears in more than one selected file.
              {:else if e.code === 'SAME_NSE_CODE_DIFFERENT_ISIN'}
                The same NSE Code is associated with two different ISINs.
              {:else}
                The same NSE Code is the only usable identifier in more than one selected file
                (ambiguous — not automatically deduplicated).
              {/if}
              (rows: {e.rows.map((r) => r + 1).join(', ')})
            </li>
          {/each}
        </ul>
      </div>
    {:else}
      <div>
        <h3>Combined preview</h3>
        <p>
          Combined rows: {okAnalysis.combinedRows.length}. Combined unique stock count: {okAnalysis.uniqueStockCount}.
        </p>

        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div class="table-scroll" role="region" aria-label="Combined preview table" tabindex="0">
          <p class="n200-badge n200-badge--gold">
            Swing checklist is informational only. It does not say Buy, Sell, or Avoid. It does not
            score stocks, filter automatically, or verify whether the CSV is truly current {universe}
            beyond what the imported file says.
          </p>
          <table>
            <caption class="visually-hidden">Combined multipart preview</caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Source file</th>
                <th scope="col">Source row</th>
                <th scope="col">Identity</th>
                <th scope="col">Swing checklist (not a score)</th>
                <th scope="col">App Volume Ratio (computed)</th>
              </tr>
            </thead>
            <tbody>
              {#each okAnalysis.combinedRows as row, i (i)}
                <tr>
                  <th scope="row">{i + 1}</th>
                  <td>{okAnalysis.parts[row.sourceIndex]?.filename ?? ''}</td>
                  <td>{row.sourceRowIndex + 1}</td>
                  <td>
                    {row.identity.match_method === 'isin'
                      ? `ISIN ${row.identity.normalized_isin ?? ''}`
                      : row.identity.match_method === 'nse_code_provisional'
                        ? `NSE Code ${row.identity.normalized_nse_code ?? ''} (provisional)`
                        : 'Not comparable'}
                  </td>
                  <td>{swingChecklistText(row)}</td>
                  <td>{describeVolumeRatio(row.volumeRatio)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <form
          onsubmit={(e) => {
            e.preventDefault();
            void confirm();
          }}
        >
          <div>
            <label for="multipart-effective-date">Effective date (required)</label>
            <input
              id="multipart-effective-date"
              type="date"
              required
              bind:value={effectiveDate}
              aria-describedby="multipart-effective-date-help"
            />
            <p id="multipart-effective-date-help">
              One shared date for the whole combined run; never inferred from a filename.
            </p>
          </div>

          <div>
            <label for="multipart-query-text">Query text (optional)</label>
            <input id="multipart-query-text" type="text" bind:value={queryText} />
          </div>

          <div>
            <input
              id="multipart-attestation"
              type="checkbox"
              bind:checked={attestationChecked}
              required
            />
            <label for="multipart-attestation">
              I confirm these files together are a {universe} export.
            </label>
          </div>

          {#if isPriorImport}
            <div role="status">
              <p class="n200-badge n200-badge--warning">
                {#if exactSetPreviouslyImported}
                  This exact combination of files was already imported as another run.
                {:else}
                  One or more of these files were used in a previous import.
                {/if}
              </p>
              <input
                id="multipart-prior-import-ack"
                type="checkbox"
                bind:checked={priorImportAck}
                required
              />
              <label for="multipart-prior-import-ack">
                I confirm I want to import these files anyway.
              </label>
            </div>
          {/if}

          {#if isNon200}
            <div role="status">
              <p class="n200-badge n200-badge--warning">
                The combined unique stock count is {okAnalysis.uniqueStockCount}, not {expectedCount}.
                Index constituents can legitimately differ temporarily.
              </p>
              <input
                id="multipart-count-ack"
                type="checkbox"
                bind:checked={combinedCountAck}
                required
              />
              <label for="multipart-count-ack">
                I confirm I want to commit this run with {okAnalysis.uniqueStockCount} unique stocks.
              </label>
            </div>
          {/if}

          {#if commitError}
            <p role="alert" class="n200-badge n200-badge--error">{commitError}</p>
          {/if}

          <div>
            <button type="submit" disabled={!canConfirmCommit}>
              {committing ? 'Committing…' : 'Confirm multipart import'}
            </button>
            <button type="button" onclick={cancel} disabled={committing}>Cancel</button>
          </div>
        </form>
      </div>
    {/if}
  {/if}

  {#if successMessage}
    <p role="status" class="n200-badge n200-badge--success">{successMessage}</p>
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
