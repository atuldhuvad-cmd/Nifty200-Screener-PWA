<script lang="ts">
  import { analyzeCsvBytes, type CsvAnalysis } from '../core/csv';
  import { buildEnvelope, sha256Hex } from '../core/envelope';
  import { commitNewRun, findRunsByOriginalFileHash, type N200Database } from '../core/storage';
  import { describeImportError, describeImportWarning } from './importMessages';
  import PreviewTable from './PreviewTable.svelte';

  interface Props {
    db: N200Database;
    onCommitted: () => void;
  }

  const { db, onCommitted }: Props = $props();

  let fileInputEl: HTMLInputElement | undefined = $state();
  let fileName = $state<string | undefined>(undefined);
  let fileMimeType = $state('');
  let fileBytes = $state<Uint8Array | undefined>(undefined);
  let analysis = $state<CsvAnalysis | undefined>(undefined);
  let checkingDuplicate = $state(false);
  let duplicateRunIds = $state<string[]>([]);

  let effectiveDate = $state('');
  let attestationChecked = $state(false);
  let duplicateAck = $state(false);
  let emptyRunAck = $state(false);
  let queryText = $state('');

  let committing = $state(false);
  let commitError = $state<string | undefined>(undefined);
  let successMessage = $state<string | undefined>(undefined);

  const okAnalysis = $derived(analysis !== undefined && analysis.ok ? analysis : undefined);
  const canPreview = $derived(okAnalysis !== undefined && okAnalysis.canConfirm);
  const previewAnalysis = $derived(
    canPreview && okAnalysis !== undefined && okAnalysis.canConfirm ? okAnalysis : undefined,
  );
  const parseErrors = $derived(analysis !== undefined && !analysis.ok ? analysis.errors : []);
  const blockingMappingErrors = $derived(
    okAnalysis !== undefined && !okAnalysis.canConfirm ? okAnalysis.blockingErrors : [],
  );
  const isEmptyRun = $derived(
    previewAnalysis !== undefined && previewAnalysis.warnings.some((w) => w.code === 'EMPTY_RUN'),
  );
  const isDuplicate = $derived(duplicateRunIds.length > 0);
  const effectiveDateValid = $derived(/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate));
  const canConfirmCommit = $derived(
    previewAnalysis !== undefined &&
      effectiveDateValid &&
      attestationChecked &&
      (!isDuplicate || duplicateAck) &&
      (!isEmptyRun || emptyRunAck) &&
      !committing &&
      !checkingDuplicate,
  );

  async function handleFileChange(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    await loadFile(file);
  }

  async function loadFile(file: File): Promise<void> {
    resetFormFields();
    fileName = file.name;
    fileMimeType = file.type;
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    fileBytes = bytes;
    analysis = analyzeCsvBytes(bytes);

    if (analysis.ok && analysis.canConfirm) {
      checkingDuplicate = true;
      try {
        const hash = await sha256Hex(bytes);
        duplicateRunIds = await findRunsByOriginalFileHash(db, hash);
      } finally {
        checkingDuplicate = false;
      }
    }
  }

  function resetFormFields(): void {
    effectiveDate = '';
    attestationChecked = false;
    duplicateAck = false;
    emptyRunAck = false;
    queryText = '';
    duplicateRunIds = [];
    commitError = undefined;
    successMessage = undefined;
  }

  function cancel(): void {
    fileName = undefined;
    fileMimeType = '';
    fileBytes = undefined;
    analysis = undefined;
    resetFormFields();
    if (fileInputEl) fileInputEl.value = '';
  }

  async function confirm(): Promise<void> {
    if (
      !canConfirmCommit ||
      previewAnalysis === undefined ||
      fileBytes === undefined ||
      fileName === undefined
    ) {
      return;
    }

    committing = true;
    commitError = undefined;
    try {
      // $state.snapshot strips Svelte's reactive proxy wrapper: without it, the analysis object
      // (and its nested arrays/objects) is a Proxy that IndexedDB's structured-clone algorithm
      // cannot clone, and the commit fails with a DataCloneError.
      const capturedAnalysis = $state.snapshot(previewAnalysis);
      const capturedBytes = $state.snapshot(fileBytes);
      const capturedName = fileName;
      const capturedMime = fileMimeType || 'text/csv';
      const trimmedQuery = queryText.trim();

      let attempt = 0;
      let committedRunId: string | undefined;
      let committedEffectiveDate = '';
      let committedStockCount = 0;
      let lastReason: 'run_id_collision' | undefined;

      while (attempt < 5) {
        const built = await buildEnvelope({
          originalBytes: capturedBytes,
          analysis: capturedAnalysis,
          originalFilename: capturedName,
          originalFileMimeType: capturedMime,
          effectiveDate,
          ...(trimmedQuery !== '' ? { queryText: trimmedQuery } : {}),
        });
        if (!built.ok) {
          commitError = 'The file could not be confirmed for import.';
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
        const message = `Committed run for ${committedEffectiveDate} (${String(committedStockCount)} stock${committedStockCount === 1 ? '' : 's'}).`;
        onCommitted();
        // cancel() clears the form, including successMessage — set it after, not before.
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

<section aria-labelledby="import-heading">
  <h2 id="import-heading">Import a CSV</h2>

  <div>
    <label for="csv-file">Choose a Nifty 200 CSV file</label>
    <input
      bind:this={fileInputEl}
      id="csv-file"
      type="file"
      accept=".csv,text/csv"
      aria-describedby={parseErrors.length > 0 || blockingMappingErrors.length > 0
        ? 'csv-file-errors'
        : undefined}
      onchange={handleFileChange}
    />
  </div>

  {#if parseErrors.length > 0}
    <div id="csv-file-errors" role="alert">
      <p class="n200-badge n200-badge--error">This file cannot be imported:</p>
      <ul>
        {#each parseErrors as e, i (i)}
          <li>{describeImportError(e)}</li>
        {/each}
      </ul>
    </div>
  {:else if blockingMappingErrors.length > 0}
    <div id="csv-file-errors" role="alert">
      <p class="n200-badge n200-badge--error">This file cannot be imported:</p>
      <ul>
        {#each blockingMappingErrors as e, i (i)}
          <li>{describeImportError(e)}</li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if previewAnalysis !== undefined}
    <div>
      <h3>Parsed headers ({previewAnalysis.parsed.headers.length})</h3>
      <p>{previewAnalysis.parsed.headers.join(', ')}</p>

      <p>
        Data rows: {previewAnalysis.parsed.rows.length}
      </p>

      {#if previewAnalysis.warnings.length > 0}
        <div role="status">
          <p class="n200-badge n200-badge--warning">
            Warnings ({previewAnalysis.warnings.length}):
          </p>
          <ul>
            {#each previewAnalysis.warnings as w, i (i)}
              <li>{describeImportWarning(w)}</li>
            {/each}
          </ul>
        </div>
      {/if}

      <PreviewTable
        headers={previewAnalysis.parsed.headers}
        rows={previewAnalysis.parsed.rows}
        rowAnalyses={previewAnalysis.rows}
        providerColumnIndex={previewAnalysis.mapping.columns.providerVolumeRatio}
      />

      <form
        onsubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        <div>
          <label for="effective-date">Effective date (required)</label>
          <input
            id="effective-date"
            type="date"
            required
            bind:value={effectiveDate}
            aria-describedby="effective-date-help"
          />
          <p id="effective-date-help">
            You must choose the date this data applies to; it is never inferred from the filename.
          </p>
        </div>

        <div>
          <label for="query-text">Query text (optional)</label>
          <input id="query-text" type="text" bind:value={queryText} />
        </div>

        <div>
          <input id="attestation" type="checkbox" bind:checked={attestationChecked} required />
          <label for="attestation">I confirm this file is a Nifty 200 export.</label>
        </div>

        {#if isDuplicate}
          <div role="status">
            <p class="n200-badge n200-badge--warning">
              This file's contents match {duplicateRunIds.length} already-committed run{duplicateRunIds.length ===
              1
                ? ''
                : 's'}.
            </p>
            <input id="duplicate-ack" type="checkbox" bind:checked={duplicateAck} required />
            <label for="duplicate-ack">I confirm I want to import this duplicate anyway.</label>
          </div>
        {/if}

        {#if isEmptyRun}
          <div role="status">
            <p class="n200-badge n200-badge--warning">
              This file has no data rows. Importing it will commit an empty run (stock count 0).
            </p>
            <input id="empty-run-ack" type="checkbox" bind:checked={emptyRunAck} required />
            <label for="empty-run-ack">I confirm I want to commit this empty run.</label>
          </div>
        {/if}

        {#if commitError}
          <p role="alert" class="n200-badge n200-badge--error">{commitError}</p>
        {/if}

        <div>
          <button type="submit" disabled={!canConfirmCommit}>
            {committing ? 'Committing…' : 'Confirm import'}
          </button>
          <button type="button" onclick={cancel} disabled={committing}>Cancel</button>
        </div>
      </form>
    </div>
  {/if}

  {#if successMessage}
    <p role="status" class="n200-badge n200-badge--success">{successMessage}</p>
  {/if}
</section>

<style>
  section {
    margin-block: 1.5rem;
  }

  div {
    margin-block: 0.5rem;
  }

  label {
    display: inline-block;
    font-weight: 600;
    margin-bottom: 0.25rem;
  }

  input[type='date'],
  input[type='text'] {
    display: block;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 0.4rem;
  }

  button {
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 0.5rem 1rem;
    background: var(--color-bg);
    cursor: pointer;
  }

  button[type='submit']:not(:disabled) {
    border-color: var(--color-gold);
    color: var(--color-gold);
    font-weight: 600;
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
</style>
