<script lang="ts">
  import { buildCandidateReview, type CandidateReviewCandidate } from '../core/display';
  import { isSupportedEnvelope, type RunRecord } from '../core/storage';

  interface Props {
    runs: RunRecord[];
  }

  const { runs }: Props = $props();
  const review = $derived(buildCandidateReview(runs));

  function runDate(kind: 'balanced' | 'technical'): string {
    const run = kind === 'balanced' ? review.balanced?.run : review.technical?.run;
    if (run === undefined || !isSupportedEnvelope(run.envelope)) return 'not found';
    return run.envelope.effective_date;
  }

  function stateText(state: CandidateReviewCandidate['technicalChecks'][number]['state']): string {
    return state === 'pass' ? 'Pass' : state === 'fail' ? 'Review' : 'Missing';
  }

  function stateClass(state: CandidateReviewCandidate['technicalChecks'][number]['state']): string {
    return state === 'pass'
      ? 'n200-badge--success'
      : state === 'fail'
        ? 'n200-badge--warning'
        : 'n200-badge--gold';
  }
</script>

<section aria-labelledby="candidate-review-heading" class="screen candidate-review">
  <div class="screen-heading">
    <div>
      <p class="eyebrow">Swing checklist</p>
      <h2 id="candidate-review-heading">Candidate review</h2>
    </div>
  </div>
  <p class="n200-badge n200-badge--info">
    Informational only. This view does not score stocks or say Buy, Sell, or Avoid. It compares your
    latest two imported screens and points out which technical checks need your attention.
  </p>

  {#if review.balanced === undefined || review.technical === undefined}
    <p class="n200-badge n200-badge--warning">
      Import files whose names include <strong>Balanced</strong> and <strong>Technical Only</strong>
      before using this review.
    </p>
  {:else}
    <p>
      Comparing Balanced ({runDate('balanced')}) with Technical Only ({runDate('technical')}):
      <strong>{review.overlap.length}</strong> overlap{review.overlap.length === 1 ? '' : 's'} and
      <strong>{review.technicalOnly.length}</strong> technical-only addition{review.technicalOnly
        .length === 1
        ? ''
        : 's'}.
    </p>

    <section class="review-group" aria-labelledby="overlap-heading">
      <div class="data-panel__head">
        <div>
          <p class="eyebrow">Start here</p>
          <h3 id="overlap-heading">In both screens</h3>
        </div>
      </div>
      {#if review.overlap.length === 0}
        <p>No overlap was found.</p>
      {:else}
        <div class="candidate-list">
          {#each review.overlap as candidate (candidate.key)}
            <article class="candidate-card">
              <h4>{candidate.stock}</h4>
              <p>Technical checks from the Technical Only run:</p>
              <ul class="candidate-checks">
                {#each candidate.technicalChecks as check (check.label)}
                  <li>
                    <span class={`n200-badge ${stateClass(check.state)}`}
                      >{stateText(check.state)}</span
                    >
                    {check.label}
                  </li>
                {/each}
              </ul>
            </article>
          {/each}
        </div>
      {/if}
    </section>

    <section class="review-group" aria-labelledby="technical-only-heading">
      <div class="data-panel__head">
        <div>
          <p class="eyebrow">Separate review</p>
          <h3 id="technical-only-heading">Technical Only additions</h3>
        </div>
      </div>
      {#if review.technicalOnly.length === 0}
        <p>No additional Technical Only candidates were found.</p>
      {:else}
        <div class="candidate-list">
          {#each review.technicalOnly as candidate (candidate.key)}
            <article class="candidate-card">
              <h4>{candidate.stock}</h4>
              <p>These stocks passed the Technical Only screen but not the Balanced screen.</p>
              <ul class="candidate-checks">
                {#each candidate.technicalChecks as check (check.label)}
                  <li>
                    <span class={`n200-badge ${stateClass(check.state)}`}
                      >{stateText(check.state)}</span
                    >
                    {check.label}
                  </li>
                {/each}
              </ul>
            </article>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</section>
