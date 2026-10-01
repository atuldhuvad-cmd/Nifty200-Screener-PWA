<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    envelopeInspectionExport,
    keepLocalOnly,
    loadReviewData,
    quarantineBytesExport,
    summarizeEnvelope,
    type ReviewData,
    type RunWithVariants,
  } from '../core/review';
  import type { N200Database, QuarantineItemRecord, RunRecord } from '../core/storage';
  import { downloadPayload } from './download';

  interface Props {
    db: N200Database;
    onChanged: () => void;
  }

  const { db, onChanged }: Props = $props();

  let data = $state<ReviewData | undefined>(undefined);
  let loadError = $state<string | undefined>(undefined);
  let actionError = $state<string | undefined>(undefined);
  let statusMessage = $state<string | undefined>(undefined);
  let headingEl: HTMLHeadingElement | undefined = $state();

  let dialogEl: HTMLDialogElement | undefined = $state();
  let dialogRunId = $state<string | undefined>(undefined);
  let dialogBusy = $state(false);
  let triggerEl: HTMLElement | null = null;

  async function load(): Promise<void> {
    try {
      data = await loadReviewData(db);
      loadError = undefined;
    } catch {
      loadError = 'Something went wrong while loading this view. Please reload and try again.';
    }
  }

  onMount(() => {
    void load();
  });

  function exportEnvelope(envelope: RunRecord['envelope'], role: 'canonical' | 'variant'): void {
    downloadPayload(envelopeInspectionExport(envelope, role));
  }

  function exportQuarantine(item: QuarantineItemRecord): void {
    downloadPayload(quarantineBytesExport(item));
  }

  function openDialog(runId: string, event: Event): void {
    triggerEl = event.currentTarget as HTMLElement;
    dialogRunId = runId;
    actionError = undefined;
    statusMessage = undefined;
    dialogEl?.showModal();
  }

  /** Runs for every way the dialog can close (Cancel, Escape, or after Confirm) so focus always
   * returns somewhere sensible: the trigger if it still exists, otherwise the view heading. */
  async function onDialogClose(): Promise<void> {
    dialogRunId = undefined;
    await tick();
    if (triggerEl?.isConnected === true) triggerEl.focus();
    else headingEl?.focus();
    triggerEl = null;
  }

  /** A native modal `<dialog>` makes the page inert but still lets Tab leave the document for
   * the browser UI; wrap Tab / Shift+Tab explicitly so focus stays inside the dialog. */
  function trapTab(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || dialogEl === undefined) return;
    const focusable = Array.from(dialogEl.querySelectorAll<HTMLElement>('button:not(:disabled)'));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialogEl.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialogEl.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  async function confirmKeepLocal(): Promise<void> {
    if (dialogRunId === undefined) return;
    const runId = dialogRunId;
    dialogBusy = true;
    try {
      const result = await keepLocalOnly(db, runId);
      if (result.ok) {
        statusMessage = `Run ${runId} is now local only. It is available in run history and comparison again; its preserved variants stay listed below.`;
        await load();
        onChanged();
      } else {
        actionError = `This run could not be kept local only (${result.reason}). Its state was not changed.`;
        await load();
      }
    } catch {
      actionError = 'Something went wrong. The run was not changed.';
    } finally {
      dialogBusy = false;
      dialogEl?.close();
    }
  }

  function byteLength(item: QuarantineItemRecord): string {
    return String(item.original_bytes.byteLength);
  }

  function context(item: QuarantineItemRecord): string {
    const m = item.discovery_metadata;
    if (!m) return '—';
    const parts: string[] = [];
    if (m.detection_context !== undefined) parts.push(m.detection_context);
    if (m.backup_entry_index !== undefined) parts.push(`entry ${String(m.backup_entry_index)}`);
    return parts.length > 0 ? parts.join(', ') : '—';
  }

  function total(items: RunWithVariants[]): string {
    return String(items.length);
  }
</script>

<section aria-labelledby="review-heading">
  <h2 id="review-heading" tabindex="-1" bind:this={headingEl}>Needs review</h2>
  <p>
    Runs and inputs that are excluded from run detail and comparison, or preserved for inspection.
    Exports contain your real run data as readable, unencrypted JSON (or the original bytes of a
    rejected input) — keep them private.
  </p>

  {#if loadError}
    <p role="alert" class="n200-badge n200-badge--error">{loadError}</p>
  {/if}
  {#if actionError}
    <p role="alert" class="n200-badge n200-badge--error">{actionError}</p>
  {/if}
  {#if statusMessage}
    <p role="status" class="n200-badge n200-badge--success">{statusMessage}</p>
  {/if}

  {#if data === undefined}
    {#if !loadError}<p role="status">Loading&hellip;</p>{/if}
  {:else}
    <section aria-labelledby="review-conflicts">
      <h3 id="review-conflicts">Conflicts ({total(data.conflicts)})</h3>
      {#if data.conflicts.length === 0}
        <p>No conflicts.</p>
      {/if}
      {#each data.conflicts as item (item.run.run_id)}
        {@const canonical = summarizeEnvelope(item.run.envelope)}
        <article aria-label={`Conflict: run ${item.run.run_id}`}>
          <h4>Run {canonical.runId}</h4>
          <p>
            Two different copies of this run exist. Neither has been overwritten. The canonical copy
            is excluded from run detail and comparison until you resolve this.
          </p>
          {@render copiesTable(item)}
          <p>
            <button
              type="button"
              aria-label={`Keep local only for run ${item.run.run_id}`}
              onclick={(e) => {
                openDialog(item.run.run_id, e);
              }}>Keep local only</button
            >
          </p>
        </article>
      {/each}
    </section>

    <section aria-labelledby="review-resolved">
      <h3 id="review-resolved">Preserved variants ({total(data.resolved)})</h3>
      {#if data.resolved.length === 0}
        <p>None.</p>
      {/if}
      {#each data.resolved as item (item.run.run_id)}
        <article aria-label={`Preserved variants: run ${item.run.run_id}`}>
          <h4>Run {item.run.run_id}</h4>
          <p>Current state: {item.run.sync.state}. The preserved variants below are read-only.</p>
          {@render copiesTable(item)}
        </article>
      {/each}
    </section>

    <section aria-labelledby="review-quarantine">
      <h3 id="review-quarantine">Quarantined inputs ({String(data.quarantine.length)})</h3>
      {#if data.quarantine.length === 0}
        <p>No quarantined inputs.</p>
      {:else}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div class="scroll" role="region" aria-label="Quarantined inputs" tabindex="0">
          <table>
            <caption class="visually-hidden">Quarantined inputs</caption>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Source</th>
                <th scope="col">Found</th>
                <th scope="col">Bytes</th>
                <th scope="col">Observed SHA-256</th>
                <th scope="col">Reasons</th>
                <th scope="col">Context</th>
                <th scope="col">Export</th>
              </tr>
            </thead>
            <tbody>
              {#each data.quarantine as item (item.quarantine_id)}
                <tr>
                  <th scope="row">{item.quarantine_id}</th>
                  <td>{item.source}</td>
                  <td>{item.discovered_at}</td>
                  <td>{byteLength(item)}</td>
                  <td class="mono">{item.observed_sha256}</td>
                  <td>{item.validation_errors.join(', ')}</td>
                  <td>{context(item)}</td>
                  <td>
                    <button
                      type="button"
                      aria-label={`Export original bytes of quarantine item ${item.quarantine_id}`}
                      onclick={() => {
                        exportQuarantine(item);
                      }}>Export bytes</button
                    >
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>

    <section aria-labelledby="review-blocked">
      <h3 id="review-blocked">
        Unsupported or quarantined runs ({String(data.blockedRuns.length)})
      </h3>
      {#if data.blockedRuns.length === 0}
        <p>None.</p>
      {:else}
        <ul>
          {#each data.blockedRuns as run (run.run_id)}
            {@const s = summarizeEnvelope(run.envelope)}
            <li>
              Run {s.runId} — state {run.sync.state}, schema {s.schemaVersion}.
              <button
                type="button"
                aria-label={`Export canonical copy of run ${run.run_id}`}
                onclick={() => {
                  exportEnvelope(run.envelope, 'canonical');
                }}>Export</button
              >
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}

  <dialog
    bind:this={dialogEl}
    aria-labelledby="keep-local-title"
    onclose={() => void onDialogClose()}
    onkeydown={trapTab}
  >
    <h3 id="keep-local-title">Keep this run local only?</h3>
    <p>
      Run {dialogRunId ?? ''} will stay on this device and its current copy will return to run history
      and comparison. The other copies stay preserved and are never overwritten or deleted. This app does
      not delete runs.
    </p>
    <div>
      <button type="button" onclick={() => void confirmKeepLocal()} disabled={dialogBusy}
        >Confirm keep local only</button
      >
      <button
        type="button"
        disabled={dialogBusy}
        onclick={() => {
          dialogEl?.close();
        }}>Cancel</button
      >
    </div>
  </dialog>
</section>

{#snippet copiesTable(item: RunWithVariants)}
  {@const c = summarizeEnvelope(item.run.envelope)}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="scroll" role="region" aria-label={`Copies of run ${item.run.run_id}`} tabindex="0">
    <table>
      <caption class="visually-hidden">Copies of run {item.run.run_id}</caption>
      <thead>
        <tr>
          <th scope="col">Copy</th>
          <th scope="col">Envelope SHA-256</th>
          <th scope="col">Effective date</th>
          <th scope="col">Imported at</th>
          <th scope="col">Stocks</th>
          <th scope="col">Schema</th>
          <th scope="col">Source</th>
          <th scope="col">Export</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">Canonical (kept)</th>
          <td class="mono">{c.envelopeSha256}</td>
          <td>{c.effectiveDate}</td>
          <td>{c.importedAt}</td>
          <td>{c.stockCount}</td>
          <td>{c.schemaVersion}</td>
          <td>local</td>
          <td>
            <button
              type="button"
              aria-label={`Export canonical copy of run ${item.run.run_id}`}
              onclick={() => {
                exportEnvelope(item.run.envelope, 'canonical');
              }}>Export</button
            >
          </td>
        </tr>
        {#each item.variants as variant, i (variant.envelope_sha256)}
          {@const v = summarizeEnvelope(variant.envelope)}
          <tr>
            <th scope="row">Variant {i + 1}</th>
            <td class="mono">{v.envelopeSha256}</td>
            <td>{v.effectiveDate}</td>
            <td>{v.importedAt}</td>
            <td>{v.stockCount}</td>
            <td>{v.schemaVersion}</td>
            <td>{variant.source}</td>
            <td>
              <button
                type="button"
                aria-label={`Export variant ${String(i + 1)} of run ${item.run.run_id}`}
                onclick={() => {
                  exportEnvelope(variant.envelope, 'variant');
                }}>Export</button
              >
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/snippet}

<style>
  .mono {
    font-family: ui-monospace, Consolas, monospace;
    word-break: break-all;
    font-size: 0.85em;
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
