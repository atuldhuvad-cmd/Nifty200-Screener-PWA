<script lang="ts">
  import { onMount } from 'svelte';
  import type { N200Database } from '../core/storage';
  import { getSyncController } from './syncBrowser';
  import type { SyncViewState } from './syncController';
  import { describeMessage, describeOutcome, STATUS_LABELS } from './syncMessages';

  interface Props {
    db: N200Database;
  }

  const { db }: Props = $props();
  // The database connection is opened once per page load and never replaced.
  // svelte-ignore state_referenced_locally
  const controller = getSyncController(db);

  let view = $state<SyncViewState>(controller.getState());
  let chosenFolder = $state<string | undefined>(undefined);

  onMount(() => {
    const unsubscribe = controller.subscribe((next) => {
      view = next;
    });
    void controller.refresh();
    return unsubscribe;
  });

  const connected = $derived(view.oauth === 'connected');
  const busy = $derived(view.busy !== 'idle');
  const canSync = $derived(connected && !busy && view.locksAvailable);

  function shortId(id: string): string {
    return id.slice(0, 8);
  }
</script>

<section aria-labelledby="sync-heading">
  <h2 id="sync-heading">Google Drive sync</h2>
  <p>
    Sync is optional and only runs when you press <strong>Sync now</strong>. It copies your runs to
    a folder in your own Google Drive, and can restore them on another device. The files are
    readable, unencrypted JSON, protected only by your Google account. The app can only see files it
    created itself.
  </p>

  {#if !view.configured}
    <p role="status" class="n200-badge n200-badge--warning">
      {describeMessage('NOT_CONFIGURED')}
    </p>
  {/if}

  {#if !view.locksAvailable}
    <p role="alert" class="n200-badge n200-badge--warning">
      {describeOutcome('locks_unavailable', null)}
    </p>
  {/if}

  <p role="status" aria-label="Connection status">
    Status: <strong>{STATUS_LABELS[view.oauth]}</strong>
  </p>

  <div class="actions">
    {#if view.oauth === 'reconnect_required'}
      <button
        type="button"
        disabled={busy || !view.configured}
        onclick={() => void controller.connect()}>Reconnect Google Drive</button
      >
    {:else if view.oauth !== 'connected'}
      <button
        type="button"
        disabled={busy || !view.configured}
        onclick={() => void controller.connect()}>Connect Google Drive</button
      >
    {/if}
    <button type="button" disabled={!canSync} onclick={() => void controller.syncNow()}
      >Sync now</button
    >
    {#if view.oauth === 'connected' || view.oauth === 'reconnect_required'}
      <button type="button" disabled={busy} onclick={() => void controller.disconnect()}
        >Disconnect</button
      >
    {/if}
  </div>

  {#if view.busy !== 'idle'}
    <p role="status">Working&hellip;</p>
  {/if}

  {#if view.message}
    <p
      role={view.message.kind === 'error' ? 'alert' : 'status'}
      class="n200-badge n200-badge--{view.message.kind === 'error' ? 'error' : 'success'}"
    >
      {describeMessage(view.message.code)}
    </p>
  {/if}

  {#if view.outcome && view.outcome !== 'locks_unavailable'}
    <div
      role={view.outcome === 'ok' || view.outcome === 'busy' || view.outcome === 'cancelled'
        ? 'status'
        : 'alert'}
      aria-label="Last sync result"
      class="n200-result"
    >
      <p>{describeOutcome(view.outcome, view.failureCode)}</p>
      {#if view.summary}
        {#if view.summaryStale}
          <p>
            This summary is from the last Sync now and may be out of date. Run Sync now to refresh
            it.
          </p>
        {/if}
        <ul class="stat-grid">
          <li>
            <span class="stat-label">Files checked in Drive<span class="stat-colon">:</span></span>
            <span class="stat-value">{view.summary.checked}</span>
          </li>
          <li>
            <span class="stat-label">Unchanged<span class="stat-colon">:</span></span>
            <span class="stat-value">{view.summary.unchanged}</span>
          </li>
          <li>
            <span class="stat-label"
              >Skipped, already on this device<span class="stat-colon">:</span></span
            >
            <span class="stat-value">{view.summary.alreadyPresent}</span>
          </li>
          <li>
            <span class="stat-label"
              >Skipped, unsupported version<span class="stat-colon">:</span></span
            >
            <span class="stat-value">{view.summary.unsupported}</span>
          </li>
          <li>
            <span class="stat-label">Skipped, duplicate copy<span class="stat-colon">:</span></span>
            <span class="stat-value">{view.summary.duplicate}</span>
          </li>
          <li>
            <span class="stat-label">Skipped, too large<span class="stat-colon">:</span></span>
            <span class="stat-value">{view.summary.tooLarge}</span>
          </li>
          <li>
            <span class="stat-label"
              >Skipped, already in Drive's Trash<span class="stat-colon">:</span></span
            >
            <span class="stat-value">{view.summary.trashedListed}</span>
          </li>
          <li>
            <span class="stat-label"
              >Updated link to Drive copy<span class="stat-colon">:</span></span
            >
            <span class="stat-value">{view.summary.refreshed}</span>
          </li>
          <li>
            <span class="stat-label"
              >Could not be checked just now (still synced)<span class="stat-colon">:</span></span
            >
            <span class="stat-value">{view.summary.unverified}</span>
          </li>
          <li>
            <span class="stat-label">Uploaded<span class="stat-colon">:</span></span>
            <span class="stat-value">{view.summary.uploaded}</span>
          </li>
          <li>
            <span class="stat-label">Restored from Drive<span class="stat-colon">:</span></span>
            <span class="stat-value">{view.summary.restored}</span>
          </li>
          <li>
            <span class="stat-label"
              >Conflicts kept for review<span class="stat-colon">:</span></span
            >
            <span class="stat-value">{view.summary.conflicts}</span>
          </li>
          <li>
            <span class="stat-label">Quarantined files<span class="stat-colon">:</span></span>
            <span class="stat-value">{view.summary.quarantined}</span>
          </li>
          <li>
            <span class="stat-label">Missing from Drive<span class="stat-colon">:</span></span>
            <span class="stat-value">{view.summary.missing}</span>
          </li>
          <li>
            <span class="stat-label">Held back<span class="stat-colon">:</span></span>
            <span class="stat-value">{view.summary.blocked}</span>
          </li>
          <li>
            <span class="stat-label">Failed<span class="stat-colon">:</span></span>
            <span class="stat-value">{view.summary.failed}</span>
          </li>
        </ul>
      {/if}
    </div>
  {/if}

  {#if view.folders.length > 0}
    <form
      onsubmit={(e) => {
        e.preventDefault();
        if (chosenFolder !== undefined) void controller.chooseFolder(chosenFolder);
      }}
    >
      <fieldset>
        <legend>Several Drive folders for this app exist. Choose the one to use.</legend>
        <p>
          Nothing has been merged, moved or deleted. Runs from every folder are still read; uploads
          wait until you choose.
        </p>
        {#each view.folders as folder (folder.id)}
          <div>
            <input
              id={`folder-${folder.id}`}
              type="radio"
              name="active-folder"
              value={folder.id}
              checked={chosenFolder === folder.id}
              onchange={() => {
                chosenFolder = folder.id;
              }}
            />
            <label for={`folder-${folder.id}`}>{folder.name} ({shortId(folder.id)})</label>
          </div>
        {/each}
        <button type="submit" disabled={chosenFolder === undefined}>Use this folder</button>
      </fieldset>
    </form>
  {/if}

  {#if view.missingRuns.length > 0}
    <section aria-labelledby="missing-heading">
      <h3 id="missing-heading">Runs missing from Drive ({view.missingRuns.length})</h3>
      <p>
        These runs were synced from this device, but their Drive file is gone or in the trash. Each
        choice is yours; nothing is re-uploaded automatically.
      </p>
      <table>
        <caption class="visually-hidden">Runs missing from Drive</caption>
        <thead>
          <tr>
            <th scope="col">Effective date</th>
            <th scope="col">Run</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each view.missingRuns as run (run.runId)}
            <tr>
              <td>{run.effectiveDate}</td>
              <td>{shortId(run.runId)}</td>
              <td>
                <button
                  type="button"
                  disabled={!canSync}
                  aria-label={`Restore run ${run.effectiveDate} (${shortId(run.runId)}) to Drive`}
                  onclick={() => void controller.restoreRun(run.runId)}>Restore to Drive</button
                >
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Keep run ${run.effectiveDate} (${shortId(run.runId)}) on this device only`}
                  onclick={() => void controller.keepLocalOnly(run.runId)}>Keep local only</button
                >
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/if}
</section>

<style>
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-block: 0.75rem;
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
