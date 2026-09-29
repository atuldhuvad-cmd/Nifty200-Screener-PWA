import { ACTIVITY_LOCK_NAME } from '../core/storage/locks';

export type UpdateErrorCode =
  'WEB_LOCKS_UNAVAILABLE' | 'ABORTED' | 'ACTIVATION_FAILED' | 'ACTIVATION_TIMEOUT';

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
  worker: WorkerLike;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Called once the exclusive lock is held, just before activation is requested. */
  onLockAcquired?: () => void;
}

function activateNow(worker: WorkerLike, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
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
  const { locks, worker, timeoutMs, signal, onLockAcquired } = options;
  if (locks === null) throw new UpdateError('WEB_LOCKS_UNAVAILABLE');
  try {
    await locks.request(
      ACTIVITY_LOCK_NAME,
      signal === undefined ? { mode: 'exclusive' } : { mode: 'exclusive', signal },
      () => {
        onLockAcquired?.();
        return activateNow(worker, timeoutMs);
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
