import { ACTIVITY_LOCK_NAME } from '../core/storage/locks';

export type UpdateErrorCode =
  | 'WEB_LOCKS_UNAVAILABLE'
  | 'ABORTED'
  | 'ACTIVATION_FAILED'
  | 'ACTIVATION_TIMEOUT'
  | 'NO_WAITING_WORKER';

export class UpdateError extends Error {
  readonly code: UpdateErrorCode;
  constructor(code: UpdateErrorCode) {
    super(code);
    this.name = 'UpdateError';
    this.code = code;
  }
}

/** The slice of `ServiceWorker` this module uses (so tests can substitute a fake). */
export interface WorkerLike {
  state: string;
  postMessage(message: unknown): void;
  addEventListener(type: 'statechange', listener: () => void): void;
  removeEventListener(type: 'statechange', listener: () => void): void;
}

/** The slice of `LockManager` this module uses. */
export interface LockManagerLike {
  request<T>(
    name: string,
    options: { mode: 'shared' | 'exclusive'; signal?: AbortSignal },
    callback: () => Promise<T>,
  ): Promise<T>;
}

export interface ActivateOptions {
  locks: LockManagerLike | null;
  /** The candidate captured when the user accepted. */
  worker: WorkerLike;
  /**
   * Re-reads the current waiting worker; called once the lock is held. A release deployed while
   * the update was queued replaces the captured candidate (which becomes `redundant`), so the
   * worker to activate is decided only after the lock is held. Returns null when none remains.
   */
  resolveWorker?: () => WorkerLike | null;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Called once the exclusive lock is held, just before activation is requested. */
  onLockAcquired?: () => void;
}

function activateNow(worker: WorkerLike, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // A redundant worker will never change state again: fail now rather than at the timeout.
    if (worker.state === 'redundant') {
      reject(new UpdateError('NO_WAITING_WORKER'));
      return;
    }
    const timer = setTimeout(() => {
      finish(() => {
        reject(new UpdateError('ACTIVATION_TIMEOUT'));
      });
    }, timeoutMs);

    function finish(settle: () => void): void {
      clearTimeout(timer);
      worker.removeEventListener('statechange', onChange);
      settle();
    }

    function onChange(): void {
      if (worker.state === 'activated') finish(resolve);
      else if (worker.state === 'redundant') {
        finish(() => {
          reject(new UpdateError('ACTIVATION_FAILED'));
        });
      }
    }

    worker.addEventListener('statechange', onChange);
    worker.postMessage({ type: 'SKIP_WAITING' });
  });
}

/**
 * Activates a waiting service worker only while holding the origin-wide activity lock
 * exclusively. Every import (shared), schema migration and backup restore (exclusive) in every
 * open tab holds the same lock, so this waits for all of them to finish, and nothing new can
 * start until the worker is active: checking for running operations and activating are one
 * atomic step (no check-then-activate race). Fails closed, never posting, without Web Locks.
 */
export async function activateWaitingWorker(options: ActivateOptions): Promise<void> {
  const { locks, worker, resolveWorker, timeoutMs, signal, onLockAcquired } = options;
  if (locks === null) throw new UpdateError('WEB_LOCKS_UNAVAILABLE');
  try {
    await locks.request(
      ACTIVITY_LOCK_NAME,
      signal === undefined ? { mode: 'exclusive' } : { mode: 'exclusive', signal },
      () => {
        const target = resolveWorker === undefined ? worker : resolveWorker();
        if (target === null) return Promise.reject(new UpdateError('NO_WAITING_WORKER'));
        onLockAcquired?.();
        return activateNow(target, timeoutMs);
      },
    );
  } catch (error) {
    if (error instanceof UpdateError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new UpdateError('ABORTED');
    }
    throw new UpdateError('ACTIVATION_FAILED');
  }
}
