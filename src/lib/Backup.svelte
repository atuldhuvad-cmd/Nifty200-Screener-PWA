<script lang="ts">
  import {
    backupFilename,
    buildBackupFile,
    commitBackupImport,
    parseBackupFile,
    previewBackupImport,
    type BackupEntryCategory,
    type BackupFile,
    type BackupImportEntryResult,
    type BackupPreview,
    type ParseBackupResult,
  } from '../core/backup';
  import { getAllRuns, WebLocksUnavailableError, type N200Database } from '../core/storage';

  interface Props {
    db: N200Database;
    onImported: () => void;
  }

  const { db, onImported }: Props = $props();

  let exportBusy = $state(false);
  let exportMessage = $state<string | undefined>(undefined);
  let exportError = $state<string | undefined>(undefined);

  let fileInputEl: HTMLInputElement | undefined = $state();
  let parseError = $state<Exclude<ParseBackupResult, { ok: true }> | undefined>(undefined);
  let backupFile = $state<BackupFile | undefined>(undefined);
  let previewBusy = $state(false);
  let preview = $state<BackupPreview | undefined>(undefined);
  let previewError = $state<string | undefined>(undefined);

  /** Guards against a stale, still-in-flight file selection overwriting a later one's result —
   * see `handleFileChange`. */
  let previewRequestId = 0;

  let importBusy = $state(false);
  let importResults = $state<BackupImportEntryResult[] | undefined>(undefined);
  let importError = $state<string | undefined>(undefined);

  const CATEGORY_LABELS: Record<BackupEntryCategory, string> = {
    added: 'Added',
    already_present: 'Already present',
    duplicate: 'Permitted duplicate',
    conflict: 'Conflict',
    unsupported: 'Unsupported schema',
    rejected: 'Rejected',
  };

  const PARSE_ERROR_MESSAGES: Record<Exclude<ParseBackupResult, { ok: true }>['reason'], string> = {
    FILE_TOO_LARGE: 'This file is larger than the 50 MiB backup limit.',
    INVALID_ENCODING: 'This file is not UTF-8 encoded text.',
    INVALID_JSON: 'This file could not be parsed as JSON.',
    INVALID_STRUCTURE: 'This file is not shaped like a Nifty 200 Screener backup.',
    UNSUPPORTED_FORMAT_VERSION: 'This backup was made by an unsupported format version.',
    RUN_COUNT_EXCEEDS_LIMIT: 'This backup has more than the 2,000-run limit.',
    RUN_COUNT_MISMATCH: "This backup's claimed run count does not match its actual contents.",
  };

  async function handleExport(): Promise<void> {
    exportBusy = true;
    exportError = undefined;
    exportMessage = undefined;
    try {
      const runs = await getAllRuns(db);
      const file = buildBackupFile(runs);
      const json = JSON.stringify(file, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = backupFilename();
        a.click();
      } finally {
        URL.revokeObjectURL(url);
      }
      exportMessage = `Backup exported (${String(file.run_count)} run${file.run_count === 1 ? '' : 's'}).`;
    } catch {
      exportError = 'Something went wrong while exporting this backup. Please try again.';
    } finally {
      exportBusy = false;
    }
  }

  function resetImportState(): void {
    previewRequestId += 1; // abandon any in-flight preview for a prior selection
    parseError = undefined;
    backupFile = undefined;
    preview = undefined;
    previewError = undefined;
    previewBusy = false;
    importResults = undefined;
    importError = undefined;
    if (fileInputEl) fileInputEl.value = '';
  }

  /**
   * Selecting a file starts an async read-and-preview that can still be running when the user
   * picks a *different* file before it resolves. Each call captures its own `requestId`; if a
   * later call has since bumped `previewRequestId`, this call's remaining work is abandoned
   * rather than allowed to overwrite `backupFile`/`preview` with stale data (Bugbot). The file
   * input is disabled for the whole duration (`previewBusy`, set before the first await) so a
   * second selection can only happen via this same guarded path, never mid-render.
   */
  async function handleFileChange(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    previewRequestId += 1;
    const requestId = previewRequestId;
    parseError = undefined;
    backupFile = undefined;
    preview = undefined;
    previewError = undefined;
    importResults = undefined;
    previewBusy = true;

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (requestId !== previewRequestId) return; // superseded by a later selection

      const result = parseBackupFile(bytes);
      if (requestId !== previewRequestId) return;
      if (!result.ok) {
        parseError = result;
        return;
      }

      backupFile = result.file;
      const computed = await previewBackupImport(db, result.file);
      if (requestId !== previewRequestId) return;
      preview = computed;
    } catch {
      if (requestId === previewRequestId) {
        previewError = 'Something went wrong while checking this backup. Please try again.';
      }
    } finally {
      if (requestId === previewRequestId) previewBusy = false;
    }
  }

  function cancel(): void {
    resetImportState();
  }

  async function confirm(): Promise<void> {
    if (backupFile === undefined) return;
    importBusy = true;
    importError = undefined;
    try {
      importResults = await commitBackupImport(db, backupFile);
      onImported();
    } catch (e) {
      importError =
        e instanceof WebLocksUnavailableError
          ? 'This browser cannot coordinate imports across tabs (Web Locks are unavailable), so the import was not started and nothing was changed. Use a browser that supports Web Locks, with a single tab open.'
          : 'Something went wrong while importing this backup. Entries already processed stay saved; please check run history and try again.';
    } finally {
      importBusy = false;
    }
  }

  function importSummaryCounts(results: BackupImportEntryResult[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const r of results) {
      counts[r.outcome.kind] = (counts[r.outcome.kind] ?? 0) + 1;
    }
    return counts;
  }
</script>

<section aria-labelledby="backup-heading">
  <h2 id="backup-heading">Backup</h2>

  <section aria-labelledby="backup-export-heading">
    <h3 id="backup-export-heading">Export</h3>
    <p>
      Downloads every committed run as one portable JSON file. Never includes sync state, Drive
      identifiers, or any other device-specific data.
    </p>
    <button type="button" onclick={() => void handleExport()} disabled={exportBusy}>
      {exportBusy ? 'Exporting…' : 'Export backup'}
    </button>
    {#if exportMessage}
      <p role="status" class="n200-badge n200-badge--success">{exportMessage}</p>
    {/if}
    {#if exportError}
      <p role="alert" class="n200-badge n200-badge--error">{exportError}</p>
    {/if}
  </section>

  <section aria-labelledby="backup-import-heading">
    <h3 id="backup-import-heading">Import</h3>
    <div>
      <label for="backup-file">Choose a backup file</label>
      <input
        bind:this={fileInputEl}
        id="backup-file"
        type="file"
        accept=".json,application/json"
        onchange={(e) => void handleFileChange(e)}
        disabled={previewBusy || importBusy}
      />
    </div>

    {#if parseError}
      <p role="alert" class="n200-badge n200-badge--error">
        {PARSE_ERROR_MESSAGES[parseError.reason]}
      </p>
    {/if}

    {#if previewError}
      <p role="alert" class="n200-badge n200-badge--error">
        {previewError}
      </p>
    {/if}

    {#if importError}
      <p role="alert" class="n200-badge n200-badge--error">{importError}</p>
    {/if}

    {#if previewBusy}
      <p role="status">Checking this backup&hellip;</p>
    {/if}

    {#if preview !== undefined && importResults === undefined}
      <div role="status">
        <h4>Preview</h4>
        <table>
          <caption class="visually-hidden">Backup import preview counts</caption>
          <thead>
            <tr>
              <th scope="col">Outcome</th>
              <th scope="col">Count</th>
            </tr>
          </thead>
          <tbody>
            {#each Object.entries(preview.counts) as [category, count] (category)}
              <tr>
                <th scope="row">{CATEGORY_LABELS[category as BackupEntryCategory]}</th>
                <td>{count}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <div>
        <button type="button" onclick={() => void confirm()} disabled={importBusy}>
          {importBusy ? 'Importing…' : 'Confirm import'}
        </button>
        <button type="button" onclick={cancel} disabled={importBusy}>Cancel</button>
      </div>
    {/if}

    {#if importResults !== undefined}
      <div role="status" class="n200-badge n200-badge--success">
        <h4>Import complete</h4>
        <ul>
          {#each Object.entries(importSummaryCounts(importResults)) as [kind, count] (kind)}
            <li>{kind}: {count}</li>
          {/each}
        </ul>
      </div>
      <button type="button" onclick={resetImportState}>Import another backup</button>
    {/if}
  </section>
</section>

<style>
  section > section {
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

  button {
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 0.5rem 1rem;
    background: var(--color-bg);
    cursor: pointer;
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.6;
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
