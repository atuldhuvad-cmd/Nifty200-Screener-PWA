import {
  applyTransition,
  getAllRuns,
  getRun,
  isSupportedEnvelope,
  withRequiredActivity,
  WebLocksUnavailableError,
  type N200Database,
} from '../core/storage';
import type { OAuthState, OAuthStateStore } from '../core/sync/auth';
import type { DriveClient } from '../core/sync/driveClient';
import { syncNow, type SyncReport } from '../core/sync/engine';
import type { ConnectResult, GisTokenProvider } from '../core/sync/gisTokenProvider';
import { restoreToDrive, selectActiveFolder, type UploadOutcome } from '../core/sync/upload';

export interface SyncControllerDeps {
  db: N200Database;
  provider: GisTokenProvider;
  client: DriveClient;
  auth: OAuthStateStore;
  /** Whether a Google client ID is configured. Without one, nothing can connect. */
  configured: boolean;
  locksAvailable: () => boolean;
}

export interface FolderChoice {
  id: string;
  name: string;
}

export interface MissingRun {
  runId: string;
  effectiveDate: string;
}

export interface SyncSummary {
  uploaded: number;
  restored: number;
  conflicts: number;
  quarantined: number;
  missing: number;
  /** Uploads held back (for example while several app folders exist). */
  blocked: number;
  failed: number;
}

export type SyncOutcome =
  | 'ok'
  | 'busy'
  | 'blocked_account'
  | 'reconnect_required'
  | 'cancelled'
  | 'failed'
  | 'locks_unavailable';

export interface ViewMessage {
  kind: 'info' | 'error';
  /** A stable code; the view turns it into plain-language text. */
  code: string;
}

export interface SyncViewState {
  configured: boolean;
  oauth: OAuthState;
  busy: 'idle' | 'connecting' | 'disconnecting' | 'syncing' | 'restoring';
  locksAvailable: boolean;
  summary: SyncSummary | null;
  outcome: SyncOutcome | null;
  failureCode: string | null;
  folders: FolderChoice[];
  missingRuns: MissingRun[];
  message: ViewMessage | null;
}

export interface SyncController {
  getState(): SyncViewState;
  subscribe(listener: (state: SyncViewState) => void): () => void;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  syncNow(): Promise<void>;
  chooseFolder(folderId: string): Promise<void>;
  restoreRun(runId: string): Promise<void>;
  keepLocalOnly(runId: string): Promise<void>;
  refresh(): Promise<void>;
}

const CONNECT_CODES: Record<Exclude<ConnectResult['status'], 'connected'>, string> = {
  cancelled: 'CONNECT_CANCELLED',
  popup_blocked: 'POPUP_BLOCKED',
  denied: 'ACCESS_DENIED',
  scope_missing: 'SCOPE_MISSING',
  script_failed: 'SCRIPT_FAILED',
  error: 'CONNECT_ERROR',
};

function summarize(report: Extract<SyncReport, { status: 'ok' }>): SyncSummary {
  const files = report.discovery.files;
  const count = (results: string[]): number =>
    files.filter((f) => results.includes(f.result)).length;
  const uploads = (status: UploadOutcome['status']): number =>
    report.uploads.filter((u) => u.outcome.status === status).length;
  return {
    uploaded: uploads('uploaded'),
    restored: count(['committed', 'linked', 'recovered']),
    conflicts: count(['conflict']) + uploads('conflict'),
    quarantined: count(['quarantined']),
    missing: report.discovery.missing.length,
    blocked: uploads('blocked'),
    failed: uploads('failed'),
  };
}

/**
 * The logic behind the Sync view, kept apart from Svelte so it can be tested directly. Every
 * action is user-initiated; nothing here runs in the background. One action runs at a time.
 * The state it exposes holds only counts, codes, folder names and run ids: never a token, a
 * session URL or an email.
 */
export function createSyncController(deps: SyncControllerDeps): SyncController {
  const listeners = new Set<(state: SyncViewState) => void>();
  let state: SyncViewState = {
    configured: deps.configured,
    oauth: deps.auth.get(),
    busy: 'idle',
    locksAvailable: deps.locksAvailable(),
    summary: null,
    outcome: null,
    failureCode: null,
    folders: [],
    missingRuns: [],
    message: null,
  };

  function set(patch: Partial<SyncViewState>): void {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener(state);
  }

  deps.auth.subscribe((oauth) => {
    set({ oauth });
  });

  async function refresh(): Promise<void> {
    const runs = await getAllRuns(deps.db);
    const missingRuns = runs
      .filter((r) => r.sync.state === 'remote_missing' && isSupportedEnvelope(r.envelope))
      .map((r) => ({
        runId: r.run_id,
        effectiveDate: isSupportedEnvelope(r.envelope) ? r.envelope.effective_date : '',
      }));
    set({ missingRuns, locksAvailable: deps.locksAvailable() });
  }

  function mapReport(report: SyncReport): Partial<SyncViewState> {
    switch (report.status) {
      case 'ok':
        return {
          outcome: 'ok',
          summary: summarize(report),
          folders: report.discovery.folderConflict
            ? report.discovery.folders.map((f) => ({ id: f.id, name: f.name ?? f.id }))
            : [],
          failureCode: null,
        };
      case 'busy':
        return { outcome: 'busy' };
      case 'blocked':
        return { outcome: 'blocked_account' };
      case 'reconnect_required':
        return { outcome: 'reconnect_required' };
      case 'cancelled':
        return { outcome: 'cancelled' };
      case 'failed':
        return { outcome: 'failed', failureCode: report.code };
    }
  }

  /** Common gate for actions that talk to Drive. Returns false (with a message) if not allowed. */
  function canRunDriveAction(): boolean {
    if (state.busy !== 'idle') {
      set({ message: { kind: 'error', code: 'ALREADY_RUNNING' } });
      return false;
    }
    if (!state.configured || state.oauth !== 'connected') {
      set({ message: { kind: 'error', code: 'NOT_CONNECTED' } });
      return false;
    }
    if (!deps.locksAvailable()) {
      set({ locksAvailable: false, outcome: 'locks_unavailable', message: null });
      return false;
    }
    return true;
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,

    async connect() {
      if (!state.configured) {
        set({ message: { kind: 'error', code: 'NOT_CONFIGURED' } });
        return;
      }
      if (state.busy !== 'idle') return;
      set({ busy: 'connecting', message: null });
      try {
        const result = await deps.provider.connect();
        set({
          message:
            result.status === 'connected'
              ? { kind: 'info', code: 'CONNECTED' }
              : { kind: 'error', code: CONNECT_CODES[result.status] },
          ...(result.status === 'connected' ? { outcome: null } : {}),
        });
      } finally {
        set({ busy: 'idle' });
      }
    },

    async disconnect() {
      if (state.busy !== 'idle') return;
      set({ busy: 'disconnecting', message: null });
      try {
        const result = await deps.provider.disconnect();
        set({
          summary: null,
          outcome: null,
          failureCode: null,
          folders: [],
          message: {
            kind: 'info',
            code: result.status === 'unconfirmed' ? 'DISCONNECTED_UNCONFIRMED' : 'DISCONNECTED',
          },
        });
      } finally {
        set({ busy: 'idle' });
      }
    },

    async syncNow() {
      if (!canRunDriveAction()) return;
      set({ busy: 'syncing', message: null, outcome: null });
      try {
        const report = await syncNow({ db: deps.db, client: deps.client });
        set(mapReport(report));
      } catch (error) {
        if (error instanceof WebLocksUnavailableError) {
          set({ outcome: 'locks_unavailable', locksAvailable: false });
        } else {
          set({ outcome: 'failed', failureCode: 'UNEXPECTED' });
        }
      } finally {
        set({ busy: 'idle' });
        await refresh();
      }
    },

    async chooseFolder(folderId) {
      await selectActiveFolder(deps.db, folderId);
      set({ folders: [], message: { kind: 'info', code: 'FOLDER_CHOSEN' } });
    },

    async restoreRun(runId) {
      if (!canRunDriveAction()) return;
      set({ busy: 'restoring', message: null });
      try {
        const outcome = await withRequiredActivity(() =>
          restoreToDrive({ db: deps.db, client: deps.client }, runId),
        );
        if (outcome.status === 'uploaded') set({ message: { kind: 'info', code: 'RESTORED' } });
        else if (outcome.status === 'reconnect_required') set({ outcome: 'reconnect_required' });
        else set({ message: { kind: 'error', code: 'RESTORE_FAILED' } });
      } catch (error) {
        if (error instanceof WebLocksUnavailableError) {
          set({ outcome: 'locks_unavailable', locksAvailable: false });
        } else {
          set({ message: { kind: 'error', code: 'RESTORE_FAILED' } });
        }
      } finally {
        set({ busy: 'idle' });
        await refresh();
      }
    },

    async keepLocalOnly(runId) {
      const run = await getRun(deps.db, runId);
      if (run?.sync.state !== 'remote_missing') return;
      const moved = await applyTransition(deps.db, runId, { type: 'KEEP_LOCAL_ONLY' });
      if (moved.ok) set({ message: { kind: 'info', code: 'KEPT_LOCAL_ONLY' } });
      await refresh();
    },
  };
}
