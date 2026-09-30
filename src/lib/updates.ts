import { activateWaitingWorker, UpdateError, type LockManagerLike } from './updateActivation';

export type UpdateState =
  | { kind: 'none' }
  | { kind: 'available' }
  | { kind: 'waiting' }
  | { kind: 'updating' }
  | { kind: 'failed'; code: string }
  | { kind: 'elsewhere' };

export interface UpdateController {
  /** The user accepted the update: wait for all running operations, then activate and reload. */
  accept(): Promise<void>;
  /** Stop waiting for operations; the current release keeps running. */
  cancel(): void;
  reloadNow(): void;
  dispose(): void;
}

const ACTIVATION_TIMEOUT_MS = 15_000;

function getLocks(): LockManagerLike | null {
  const locks = (navigator as { locks?: unknown }).locks;
  return locks === undefined || locks === null ? null : (locks as LockManagerLike);
}

/**
 * Registers the service worker (production builds only) and reports update availability. A new
 * release is never activated automatically: `accept()` is called only from an explicit user
 * action. Returns null when service workers are unsupported or this is not a production build.
 */
export function startUpdates(onState: (state: UpdateState) => void): UpdateController | null {
  if (
    !import.meta.env.PROD ||
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator)
  ) {
    return null;
  }
  const container = navigator.serviceWorker;
  let registration: ServiceWorkerRegistration | undefined;
  let pending: AbortController | undefined;
  let initiatedHere = false;
  const controlledAtStart = container.controller !== null;

  const announceIfWaiting = (): void => {
    // While this tab's own accepted update is in progress the notice must keep showing it; a
    // newer candidate arriving meanwhile is picked up when the lock is held (`resolveWorker`).
    if (pending !== undefined) return;
    if (registration?.waiting != null && container.controller !== null) {
      onState({ kind: 'available' });
    }
  };

  const onControllerChange = (): void => {
    // A reload is already under way when this tab started the update itself.
    if (!initiatedHere && controlledAtStart) onState({ kind: 'elsewhere' });
  };
  container.addEventListener('controllerchange', onControllerChange);

  container
    .register(new URL('sw.js', document.baseURI).href)
    .then((reg) => {
      registration = reg;
      announceIfWaiting();
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed') announceIfWaiting();
        });
      });
    })
    .catch(() => {
      // Registration can fail (private mode, unsupported context). The app simply keeps
      // working online-only; nothing is logged.
    });

  return {
    async accept() {
      const waiting = registration?.waiting;
      if (waiting == null) {
        onState({ kind: 'none' });
        return;
      }
      initiatedHere = true;
      pending = new AbortController();
      onState({ kind: 'waiting' });
      try {
        await activateWaitingWorker({
          locks: getLocks(),
          worker: waiting,
          resolveWorker: () => registration?.waiting ?? null,
          timeoutMs: ACTIVATION_TIMEOUT_MS,
          signal: pending.signal,
          onLockAcquired: () => {
            onState({ kind: 'updating' });
          },
        });
        location.reload();
      } catch (error) {
        initiatedHere = false;
        if (error instanceof UpdateError && error.code === 'ABORTED') {
          onState({ kind: 'available' });
        } else {
          onState({ kind: 'failed', code: error instanceof UpdateError ? error.code : 'UNKNOWN' });
        }
      } finally {
        pending = undefined;
      }
    },
    cancel() {
      pending?.abort();
    },
    reloadNow() {
      location.reload();
    },
    dispose() {
      pending?.abort();
      container.removeEventListener('controllerchange', onControllerChange);
    },
  };
}
