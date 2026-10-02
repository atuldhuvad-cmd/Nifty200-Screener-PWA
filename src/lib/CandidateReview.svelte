<script lang="ts">
  import { buildCandidateReview, type CandidateReviewCandidate } from '../core/display';
  import { isSupportedEnvelope, type RunRecord } from '../core/storage';

  interface Props {
    runs: RunRecord[];
  }

  const { runs }: Props = $props();
  const review = $derived(buildCandidateReview(runs));

  type TradeStatus = 'buy' | 'waitlist';
  type TradePlan = {
    status: TradeStatus;
    entryLow: string;
    entryHigh: string;
    stopLoss: string;
  };

  let plans = $state<Record<string, TradePlan>>({});

  $effect(() => {
    const candidates = [...review.overlap, ...review.technicalOnly];
    for (const candidate of candidates) {
      if (plans[candidate.key] === undefined) {
        plans[candidate.key] = { status: 'waitlist', entryLow: '', entryHigh: '', stopLoss: '' };
      }
    }
  });

  function updatePlan(key: string, field: keyof TradePlan, event: Event): void {
    const value = (event.currentTarget as HTMLInputElement | HTMLSelectElement).value;
    plans[key] = {
      ...(plans[key] ?? { status: 'waitlist', entryLow: '', entryHigh: '', stopLoss: '' }),
      [field]: value,
    };
  }

  function tradeNumbers(candidate: CandidateReviewCandidate): {
    quantity: number;
    riskAmount: number;
    target: number;
  } | null {
    const plan = plans[candidate.key];
    if (plan === undefined) return null;
    const entry = Number(plan.entryHigh);
    const stop = Number(plan.stopLoss);
    if (!Number.isFinite(entry) || !Number.isFinite(stop) || entry <= stop || entry <= 0)
      return null;
    const riskBudget = 50000 * 0.01;
    const quantity = Math.max(
      0,
      Math.min(Math.floor(50000 / entry), Math.floor(riskBudget / (entry - stop))),
    );
    const riskAmount = quantity * (entry - stop);
    return { quantity, riskAmount, target: entry + (entry - stop) * 2 };
  }

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
    Informational only. This view does not score stocks or place trades. Buy candidate and Waitlist
    are your planning labels. It compares your latest two imported screens and calculates position
    size only after you enter an entry range and stop loss.
  </p>
  <section class="trade-assumptions" aria-labelledby="trade-assumptions-heading">
    <h3 id="trade-assumptions-heading">Trade-plan assumptions</h3>
    <p>Capital: ₹50,000 · Default risk budget: 1% (₹500) · Default reward-to-risk: 2:1</p>
    <p>
      Enter prices from your own plan. Quantity is limited by both the ₹50,000 capital and ₹500 risk
      budget.
    </p>
  </section>

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
            {@const plan = plans[candidate.key]}
            {@const numbers = tradeNumbers(candidate)}
            <article class="candidate-card">
              <h4>{candidate.stock}</h4>
              <div class="trade-plan">
                <label
                  >Status <select
                    value={plan?.status ?? 'waitlist'}
                    onchange={(event) => updatePlan(candidate.key, 'status', event)}
                    ><option value="waitlist">Waitlist</option><option value="buy"
                      >Buy candidate</option
                    ></select
                  ></label
                >
                <label
                  >Entry low <input
                    inputmode="decimal"
                    value={plan?.entryLow ?? ''}
                    onchange={(event) => updatePlan(candidate.key, 'entryLow', event)}
                  /></label
                >
                <label
                  >Entry high <input
                    inputmode="decimal"
                    value={plan?.entryHigh ?? ''}
                    onchange={(event) => updatePlan(candidate.key, 'entryHigh', event)}
                  /></label
                >
                <label
                  >Stop loss <input
                    inputmode="decimal"
                    value={plan?.stopLoss ?? ''}
                    onchange={(event) => updatePlan(candidate.key, 'stopLoss', event)}
                  /></label
                >
                {#if numbers}
                  <p class="trade-plan-result">
                    Quantity: <strong>{numbers.quantity}</strong> · Max loss:
                    <strong>₹{numbers.riskAmount.toFixed(2)}</strong>
                    · 2:1 target: <strong>₹{numbers.target.toFixed(2)}</strong>
                  </p>
                {/if}
              </div>
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
            {@const plan = plans[candidate.key]}
            {@const numbers = tradeNumbers(candidate)}
            <article class="candidate-card">
              <h4>{candidate.stock}</h4>
              <div class="trade-plan">
                <label
                  >Status <select
                    value={plan?.status ?? 'waitlist'}
                    onchange={(event) => updatePlan(candidate.key, 'status', event)}
                    ><option value="waitlist">Waitlist</option><option value="buy"
                      >Buy candidate</option
                    ></select
                  ></label
                >
                <label
                  >Entry low <input
                    inputmode="decimal"
                    value={plan?.entryLow ?? ''}
                    onchange={(event) => updatePlan(candidate.key, 'entryLow', event)}
                  /></label
                >
                <label
                  >Entry high <input
                    inputmode="decimal"
                    value={plan?.entryHigh ?? ''}
                    onchange={(event) => updatePlan(candidate.key, 'entryHigh', event)}
                  /></label
                >
                <label
                  >Stop loss <input
                    inputmode="decimal"
                    value={plan?.stopLoss ?? ''}
                    onchange={(event) => updatePlan(candidate.key, 'stopLoss', event)}
                  /></label
                >
                {#if numbers}
                  <p class="trade-plan-result">
                    Quantity: <strong>{numbers.quantity}</strong> · Max loss:
                    <strong>₹{numbers.riskAmount.toFixed(2)}</strong>
                    · 2:1 target: <strong>₹{numbers.target.toFixed(2)}</strong>
                  </p>
                {/if}
              </div>
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
