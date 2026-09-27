/**
 * Aborts `tx` if it is still active, and observes its `.done` rejection either way — so an
 * intentional or error-driven abort never surfaces as an unhandled promise rejection. Safe to
 * call on a transaction IndexedDB has already auto-aborted itself (a failed *request* does
 * this on its own), and necessary when a plain JS error is thrown *between* requests — which
 * does not auto-abort the native transaction, so without this the already-issued requests in
 * that transaction would simply commit when it naturally completes.
 */
export function safeAbort(tx: { abort(): void; done: Promise<void> }): void {
  try {
    tx.abort();
  } catch {
    // Already inactive/aborted.
  }
  tx.done.catch(() => {
    // Expected: aborting rejects `.done`.
  });
}
