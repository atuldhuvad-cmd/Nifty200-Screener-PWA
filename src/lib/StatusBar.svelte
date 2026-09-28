<script lang="ts">
  import type { PersistPromptResult } from '../core/storage';

  interface Props {
    singleTabWarning: boolean;
    persist: PersistPromptResult | undefined;
    atRiskCount: number;
  }

  const { singleTabWarning, persist, atRiskCount }: Props = $props();

  function persistText(p: PersistPromptResult | undefined): string {
    if (p === undefined) return 'Checking persistent storage support…';
    if (!p.supported) return 'Persistent storage is not supported by this browser.';
    return p.granted
      ? 'Persistent storage is granted; data is protected from automatic eviction.'
      : 'Persistent storage was not granted; data may be cleared by the browser under storage pressure.';
  }
</script>

<div role="status" aria-live="polite">
  {#if singleTabWarning}
    <p class="n200-badge n200-badge--warning">
      Warning: schema migration ran without cross-tab coordination (Web Locks unavailable). Avoid
      running this app in multiple tabs at once until you reload.
    </p>
  {/if}

  <p
    class="n200-badge {persist?.supported && persist.granted
      ? 'n200-badge--success'
      : 'n200-badge--warning'}"
  >
    {persistText(persist)}
  </p>

  <p class="n200-badge {atRiskCount > 0 ? 'n200-badge--warning' : 'n200-badge--success'}">
    {atRiskCount} run{atRiskCount === 1 ? '' : 's'} without a verified remote backup.
  </p>
</div>

<style>
  div {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-block: 1rem;
  }

  p {
    margin: 0;
  }
</style>
