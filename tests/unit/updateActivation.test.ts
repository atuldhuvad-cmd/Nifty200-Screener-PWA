import { describe, expect, it } from 'vitest';
import {
  activateWaitingWorker,
  type LockManagerLike,
  type WorkerLike,
} from '../../src/lib/updateActivation';

/** A tiny FIFO Web Locks model: exclusive requests wait for all holders; shared requests
 * coexist but queue behind an earlier pending exclusive one. */
class FakeLocks implements LockManagerLike {
  private shared = 0;
  private exclusive = false;
  private readonly queue: { mode: 'shared' | 'exclusive'; go: () => void }[] = [];

  held(): number {
    return this.shared + (this.exclusive ? 1 : 0);
  }

  private pump(): void {
    for (;;) {
      const next = this.queue[0];
      if (next === undefined) return;
      const ok = next.mode === 'shared' ? !this.exclusive : !this.exclusive && this.shared === 0;
      if (!ok) return;
      this.queue.shift();
      if (next.mode === 'shared') this.shared += 1;
      else this.exclusive = true;
      next.go();
    }
  }

  acquire(mode: 'shared' | 'exclusive'): Promise<() => void> {
    return new Promise((resolve) => {
      this.queue.push({
        mode,
        go: () =>
          resolve(() => {
            if (mode === 'shared') this.shared -= 1;
            else this.exclusive = false;
            this.pump();
          }),
      });
      this.pump();
    });
  }

  async request<T>(
    _name: string,
    options: { mode: 'shared' | 'exclusive'; signal?: AbortSignal },
    callback: () => Promise<T>,
  ): Promise<T> {
    const signal = options.signal;
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const pending = this.acquire(options.mode);
    const release = await new Promise<() => void>((resolve, reject) => {
      void pending.then(resolve);
      signal?.addEventListener('abort', () => {
        void pending.then((r) => r());
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
    try {
      return await callback();
    } finally {
      release();
    }
  }
}

class FakeWorker implements WorkerLike {
  state = 'installed';
  posted: unknown[] = [];
  private readonly listeners = new Set<() => void>();
  onPost: (() => void) | undefined;

  postMessage(message: unknown): void {
    this.posted.push(message);
    this.onPost?.();
  }
  addEventListener(_type: 'statechange', listener: () => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: 'statechange', listener: () => void): void {
    this.listeners.delete(listener);
  }
  emit(state: string): void {
    this.state = state;
    for (const l of [...this.listeners]) l();
  }
}

const tick = (ms = 15): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('activateWaitingWorker', () => {
  it('asks the worker to activate only while holding the exclusive activity lock', async () => {
    const locks = new FakeLocks();
    const worker = new FakeWorker();
    let heldWhenPosted = -1;
    worker.onPost = () => {
      heldWhenPosted = locks.held();
      queueMicrotask(() => {
        worker.emit('activated');
      });
    };
    await activateWaitingWorker({ locks, worker, timeoutMs: 1000 });
    expect(worker.posted).toEqual([{ type: 'SKIP_WAITING' }]);
    expect(heldWhenPosted).toBe(1);
    expect(locks.held()).toBe(0);
  });

  it('waits for in-flight (shared) operations to finish before activating', async () => {
    const locks = new FakeLocks();
    const worker = new FakeWorker();
    const releaseImport = await locks.acquire('shared');
    const done = activateWaitingWorker({ locks, worker, timeoutMs: 1000 });
    await tick(30);
    expect(worker.posted).toEqual([]);
    releaseImport();
    await tick();
    expect(worker.posted).toEqual([{ type: 'SKIP_WAITING' }]);
    worker.emit('activated');
    await done;
  });

  it('an operation started after the update was accepted queues behind it (no check-then-activate race)', async () => {
    const locks = new FakeLocks();
    const worker = new FakeWorker();
    const releaseFirst = await locks.acquire('shared');
    const done = activateWaitingWorker({ locks, worker, timeoutMs: 1000 });
    await tick();
    let lateSawState = '';
    const late = locks.request('n200-activity', { mode: 'shared' }, async () => {
      lateSawState = worker.state;
    });
    await tick(30);
    expect(lateSawState).toBe('');
    releaseFirst();
    await tick();
    worker.emit('activated');
    await done;
    await late;
    expect(lateSawState).toBe('activated');
  });

  it('rejects with a stable code if the worker becomes redundant', async () => {
    const locks = new FakeLocks();
    const worker = new FakeWorker();
    const p = activateWaitingWorker({ locks, worker, timeoutMs: 1000 });
    await tick();
    worker.emit('redundant');
    await expect(p).rejects.toMatchObject({ code: 'ACTIVATION_FAILED' });
  });

  it('rejects with a stable code on timeout and releases the lock', async () => {
    const locks = new FakeLocks();
    const worker = new FakeWorker();
    await expect(activateWaitingWorker({ locks, worker, timeoutMs: 20 })).rejects.toMatchObject({
      code: 'ACTIVATION_TIMEOUT',
    });
    expect(locks.held()).toBe(0);
  });

  it('can be cancelled while waiting for operations, without ever posting', async () => {
    const locks = new FakeLocks();
    const worker = new FakeWorker();
    await locks.acquire('shared');
    const controller = new AbortController();
    const p = activateWaitingWorker({
      locks,
      worker,
      timeoutMs: 1000,
      signal: controller.signal,
    });
    await tick();
    controller.abort();
    await expect(p).rejects.toMatchObject({ code: 'ABORTED' });
    expect(worker.posted).toEqual([]);
  });

  it('a waiting worker replaced while queued is re-resolved once the lock is held, without a timeout', async () => {
    const locks = new FakeLocks();
    const replaced = new FakeWorker();
    const current = new FakeWorker();
    const releaseImport = await locks.acquire('shared');
    let waiting: FakeWorker | null = replaced;
    const done = activateWaitingWorker({
      locks,
      worker: replaced,
      resolveWorker: () => waiting,
      timeoutMs: 10_000,
    });
    await tick();
    // A newer release is installed while the update waits: the old candidate is now redundant.
    replaced.state = 'redundant';
    waiting = current;
    releaseImport();
    await tick();
    expect(replaced.posted).toEqual([]);
    expect(current.posted).toEqual([{ type: 'SKIP_WAITING' }]);
    current.emit('activated');
    await done;
  });

  it('fails promptly, without posting, when no valid waiting worker remains after the lock is held', async () => {
    const locks = new FakeLocks();
    const replaced = new FakeWorker();
    const releaseImport = await locks.acquire('shared');
    let waiting: FakeWorker | null = replaced;
    const done = activateWaitingWorker({
      locks,
      worker: replaced,
      resolveWorker: () => waiting,
      timeoutMs: 10_000,
    });
    await tick();
    replaced.state = 'redundant';
    waiting = null;
    releaseImport();
    await expect(done).rejects.toMatchObject({ code: 'NO_WAITING_WORKER' });
    expect(replaced.posted).toEqual([]);
    expect(locks.held()).toBe(0);
  });

  it('a worker that is already redundant fails promptly instead of waiting for the timeout', async () => {
    const locks = new FakeLocks();
    const worker = new FakeWorker();
    worker.state = 'redundant';
    await expect(activateWaitingWorker({ locks, worker, timeoutMs: 10_000 })).rejects.toMatchObject(
      { code: 'NO_WAITING_WORKER' },
    );
    expect(worker.posted).toEqual([]);
  });

  it('fails closed without Web Locks and never posts', async () => {
    const worker = new FakeWorker();
    await expect(
      activateWaitingWorker({ locks: null, worker, timeoutMs: 100 }),
    ).rejects.toMatchObject({ code: 'WEB_LOCKS_UNAVAILABLE' });
    expect(worker.posted).toEqual([]);
  });
});
