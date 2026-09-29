<script lang="ts">
  import { onMount } from 'svelte';
  import { startUpdates, type UpdateController, type UpdateState } from './updates';

  let state = $state<UpdateState>({ kind: 'none' });
  let controller: UpdateController | null = null;

  onMount(() => {
    controller = startUpdates((next) => {
      state = next;
    });
    return () => {
      controller?.dispose();
    };
  });

  function accept(): void {
    void controller?.accept();
  }
</script>

{#if state.kind === 'failed'}
  <div role="alert" aria-label="App updates" class="n200-badge n200-badge--error update">
    <p>
      The update could not be applied ({state.code}). The version you are using keeps working, and
      nothing was changed.
    </p>
    <button type="button" onclick={accept}>Try again</button>
  </div>
{:else if state.kind !== 'none'}
  <div role="status" aria-label="App updates" class="n200-badge n200-badge--gold update">
    {#if state.kind === 'available'}
      <p>A new version of Nifty 200 Screener is ready.</p>
      <button type="button" onclick={accept}>Update now</button>
    {:else if state.kind === 'waiting'}
      <p>
        Waiting for imports, restores and migrations in all open tabs to finish before
        updating&hellip;
      </p>
      <button
        type="button"
        onclick={() => {
          controller?.cancel();
        }}>Cancel update</button
      >
    {:else if state.kind === 'updating'}
      <p>Updating&hellip; this page will reload.</p>
    {:else}
      <p>The app was updated in another tab. Reload this page when you are ready.</p>
      <button
        type="button"
        onclick={() => {
          controller?.reloadNow();
        }}>Reload now</button
      >
    {/if}
  </div>
{/if}

<style>
  .update {
    display: block;
    margin-block: 0.75rem;
    padding: 0.5rem 1rem;
  }

  p {
    margin: 0 0 0.5rem;
  }

  button {
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 0.4rem 0.9rem;
    background: var(--color-bg);
    cursor: pointer;
  }
</style>
