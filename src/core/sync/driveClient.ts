import type { OAuthStateStore, TokenProvider } from './auth';
import { classifyHttpError, DriveError } from './errors';

/** The subset of a Drive file resource this app reads. */
export interface DriveFile {
  id: string;
  name?: string;
  mimeType?: string;
  parents?: string[];
  appProperties?: Record<string, string>;
  trashed?: boolean;
  version?: string;
  md5Checksum?: string;
  size?: string;
}

export type RemoteState = 'present' | 'trashed' | 'missing' | 'inaccessible';

export interface DriveClientOptions {
  fetch: typeof fetch;
  tokens: TokenProvider;
  auth: OAuthStateStore;
  baseUrl?: string;
  /** Per-attempt timeout, enforced with an AbortController. */
  timeoutMs?: number;
  /** Total attempts for an idempotent request (first try included). */
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Uniform [0, 1) source; injectable so backoff is testable. */
  random?: () => number;
}

interface RequestSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  /** A path under the base URL, or an absolute URL (a resumable session URL). */
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
  /**
   * Whether repeating this exact request is safe. Only idempotent requests are ever retried
   * automatically (a persisted pre-generated ID, an existing file ID, or a resumable session).
   */
  idempotent: boolean;
  signal?: AbortSignal;
  /** Session URLs are capability URLs: they are used as-is, without an Authorization header. */
  authenticated?: boolean;
  /** Extra non-2xx statuses that are a normal answer (308 Resume Incomplete). */
  acceptStatuses?: number[];
}

const FILE_FIELDS = 'id,name,mimeType,parents,appProperties,trashed,version,md5Checksum,size';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export interface DriveClient {
  request(spec: RequestSpec): Promise<Response>;
  aboutUser(options?: { signal?: AbortSignal }): Promise<{ permissionId: string }>;
  generateIds(count: number, options?: { signal?: AbortSignal }): Promise<string[]>;
  listFiles(params: { q: string; pageSize?: number; signal?: AbortSignal }): Promise<DriveFile[]>;
  getFile(fileId: string, options?: { signal?: AbortSignal }): Promise<DriveFile>;
  probeFile(
    fileId: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ state: RemoteState; file?: DriveFile }>;
  downloadFile(fileId: string, options?: { signal?: AbortSignal }): Promise<Uint8Array>;
  createFolder(params: {
    id: string;
    name: string;
    appProperties: Record<string, string>;
    signal?: AbortSignal;
  }): Promise<DriveFile>;
  untrash(fileId: string, options?: { signal?: AbortSignal }): Promise<DriveFile>;
  uploadFileResumable(params: {
    id: string;
    name: string;
    parents: string[];
    appProperties: Record<string, string>;
    bytes: Uint8Array;
    /** Keys the in-memory session so an interrupted upload can resume it. */
    sessionKey: string;
    signal?: AbortSignal;
  }): Promise<DriveFile>;
  /**
   * Runs before EVERY HTTP attempt (retries included) for as long as it is set. The sync engine
   * uses it to renew its leader lease, so a long upload can never outlive the lease. A hook that
   * throws aborts the request.
   */
  setActivityHook(hook: (() => Promise<void>) | null): void;
  /** Resumable session URLs live only here, in memory (never persisted). */
  hasSession(sessionKey: string): boolean;
  discardSession(sessionKey: string): void;
}

function reasonOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return null;
  const errors = (error as { errors?: unknown }).errors;
  if (Array.isArray(errors)) {
    const first: unknown = errors[0];
    if (typeof first === 'object' && first !== null) {
      const reason = (first as { reason?: unknown }).reason;
      if (typeof reason === 'string') return reason;
    }
  }
  return null;
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function parseRetryAfterMs(header: string | null): number | null {
  if (header === null) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

export function createDriveClient(options: DriveClientOptions): DriveClient {
  const baseUrl = options.baseUrl ?? 'https://www.googleapis.com';
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxAttempts = options.maxAttempts ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 16_000;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  const sessions = new Map<string, string>();
  let activityHook: (() => Promise<void>) | null = null;

  function backoffMs(attempt: number, error: DriveError): number {
    if (error.retryAfterMs !== null) return Math.min(maxDelayMs, error.retryAfterMs);
    const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
    return Math.round(ceiling * (0.5 + random() * 0.5));
  }

  async function attemptOnce(spec: RequestSpec): Promise<Response> {
    if (spec.signal?.aborted === true) throw new DriveError('cancelled');
    if (activityHook !== null) await activityHook();

    const headers: Record<string, string> = { ...(spec.headers ?? {}) };
    if (spec.authenticated !== false) {
      const token = await options.tokens.getAccessToken();
      if (token === null) {
        options.auth.set('reconnect_required');
        throw new DriveError('unauthorized', { status: 401, reason: 'noToken' });
      }
      headers['authorization'] = `Bearer ${token}`;
    }

    let url: URL;
    if (spec.path.startsWith('https://')) url = new URL(spec.path);
    else url = new URL(spec.path, baseUrl);
    for (const [key, value] of Object.entries(spec.query ?? {})) url.searchParams.set(key, value);

    let body: BodyInit | undefined;
    if (spec.body instanceof Uint8Array) {
      body = spec.body as unknown as BodyInit;
    } else if (spec.body !== undefined) {
      body = JSON.stringify(spec.body);
      headers['content-type'] ??= 'application/json; charset=UTF-8';
    }

    const controller = new AbortController();
    const flags = { timedOut: false };
    const timer = setTimeout(() => {
      flags.timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = (): void => {
      controller.abort();
    };
    spec.signal?.addEventListener('abort', onAbort);

    try {
      let response: Response;
      try {
        response = await options.fetch(url.toString(), {
          method: spec.method,
          headers,
          ...(body !== undefined ? { body } : {}),
          signal: controller.signal,
        });
      } catch {
        if (isAborted(spec.signal)) throw new DriveError('cancelled');
        if (flags.timedOut) throw new DriveError('timeout');
        throw new DriveError('network');
      }

      if (response.ok || spec.acceptStatuses?.includes(response.status) === true) return response;

      let reason: string | null = null;
      try {
        reason = reasonOf(await response.json());
      } catch {
        reason = null;
      }
      const kind = classifyHttpError(response.status, reason, {
        hasPageToken: spec.query?.['pageToken'] !== undefined,
      });
      if (kind === 'unauthorized') options.auth.set('reconnect_required');
      throw new DriveError(kind, {
        status: response.status,
        reason,
        retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
      });
    } finally {
      clearTimeout(timer);
      spec.signal?.removeEventListener('abort', onAbort);
    }
  }

  async function request(spec: RequestSpec): Promise<Response> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await attemptOnce(spec);
      } catch (error) {
        if (!(error instanceof DriveError)) throw error;
        if (!spec.idempotent || !error.retryable || attempt >= maxAttempts) throw error;
        await sleep(backoffMs(attempt, error));
      }
    }
  }

  async function json<T>(spec: RequestSpec): Promise<T> {
    const response = await request(spec);
    try {
      return (await response.json()) as T;
    } catch {
      throw new DriveError('protocol', { status: response.status });
    }
  }

  const signalOf = (o?: { signal?: AbortSignal }): { signal?: AbortSignal } =>
    o?.signal === undefined ? {} : { signal: o.signal };

  async function listOnce(q: string, pageSize: number, signal?: AbortSignal): Promise<DriveFile[]> {
    const all: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const page = await json<{ files?: DriveFile[]; nextPageToken?: string }>({
        method: 'GET',
        path: '/drive/v3/files',
        query: {
          q,
          pageSize: String(pageSize),
          fields: `nextPageToken,files(${FILE_FIELDS})`,
          ...(pageToken !== undefined ? { pageToken } : {}),
        },
        idempotent: true,
        ...(signal !== undefined ? { signal } : {}),
      });
      all.push(...(page.files ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken !== undefined);
    return all;
  }

  async function uploadFileResumable(params: {
    id: string;
    name: string;
    parents: string[];
    appProperties: Record<string, string>;
    bytes: Uint8Array;
    sessionKey: string;
    signal?: AbortSignal;
  }): Promise<DriveFile> {
    const total = params.bytes.byteLength;
    const signal = params.signal === undefined ? {} : { signal: params.signal };

    const initiate = async (): Promise<string> => {
      const response = await request({
        method: 'POST',
        path: '/upload/drive/v3/files',
        query: { uploadType: 'resumable', fields: FILE_FIELDS },
        body: {
          id: params.id,
          name: params.name,
          mimeType: 'application/json',
          parents: params.parents,
          appProperties: params.appProperties,
        },
        headers: {
          'x-upload-content-type': 'application/json',
          'x-upload-content-length': String(total),
        },
        // Safe to repeat: the file ID is pre-generated and persisted, so a second initiation for
        // the same ID can never create a second file.
        idempotent: true,
        ...signal,
      });
      const location = response.headers.get('location');
      if (location === null || !location.startsWith('https://')) {
        throw new DriveError('protocol', { status: response.status });
      }
      sessions.set(params.sessionKey, location);
      return location;
    };

    let restarts = 0;
    let sessionUrl = sessions.get(params.sessionKey) ?? (await initiate());
    let offset = 0;

    for (let round = 0; round <= maxAttempts * 2; round += 1) {
      try {
        const response = await request({
          method: 'PUT',
          path: sessionUrl,
          body: params.bytes.slice(offset),
          headers:
            offset === 0
              ? {}
              : {
                  'content-range': `bytes ${String(offset)}-${String(total - 1)}/${String(total)}`,
                },
          // Not retried blindly: after any interruption the session is asked how much arrived.
          idempotent: false,
          authenticated: false,
          acceptStatuses: [308],
          ...signal,
        });
        if (response.status !== 308) {
          sessions.delete(params.sessionKey);
          return (await response.json()) as DriveFile;
        }
        offset = readRangeEnd(response) ?? offset;
      } catch (error) {
        if (!(error instanceof DriveError)) throw error;
        if (error.kind === 'cancelled' || error.kind === 'unauthorized') throw error;
        if (!error.retryable && error.kind !== 'not_found') throw error;
        // Ask the session what it has. 404 means the session expired: start over (the ID is the
        // same, so a repeated initiation can never duplicate the file).
        try {
          const status = await request({
            method: 'PUT',
            path: sessionUrl,
            headers: { 'content-range': `bytes */${String(total)}` },
            idempotent: true,
            authenticated: false,
            acceptStatuses: [308],
            ...signal,
          });
          if (status.status !== 308) {
            sessions.delete(params.sessionKey);
            return (await status.json()) as DriveFile;
          }
          offset = readRangeEnd(status) ?? 0;
        } catch (statusError) {
          if (statusError instanceof DriveError && statusError.kind === 'not_found') {
            sessions.delete(params.sessionKey);
            restarts += 1;
            if (restarts > 2) throw statusError;
            sessionUrl = await initiate();
            offset = 0;
            continue;
          }
          throw statusError;
        }
      }
    }
    throw new DriveError('protocol');
  }

  return {
    request,
    async aboutUser(o) {
      const about = await json<{ user?: { permissionId?: string } }>({
        method: 'GET',
        path: '/drive/v3/about',
        query: { fields: 'user(permissionId)' },
        idempotent: true,
        ...signalOf(o),
      });
      const permissionId = about.user?.permissionId;
      if (typeof permissionId !== 'string' || permissionId === '') {
        throw new DriveError('protocol');
      }
      return { permissionId };
    },
    async generateIds(count, o) {
      const result = await json<{ ids?: string[] }>({
        method: 'GET',
        path: '/drive/v3/files/generateIds',
        query: { count: String(count), space: 'drive' },
        idempotent: true,
        ...signalOf(o),
      });
      if (!Array.isArray(result.ids) || result.ids.length !== count) {
        throw new DriveError('protocol');
      }
      return result.ids;
    },
    async listFiles({ q, pageSize = 100, signal }) {
      try {
        return await listOnce(q, pageSize, signal);
      } catch (error) {
        if (error instanceof DriveError && error.kind === 'invalid_page_token') {
          // A rejected page token: discard it and restart from the first page, once.
          return listOnce(q, pageSize, signal);
        }
        throw error;
      }
    },
    getFile: (fileId, o) =>
      json<DriveFile>({
        method: 'GET',
        path: `/drive/v3/files/${encodeURIComponent(fileId)}`,
        query: { fields: FILE_FIELDS },
        idempotent: true,
        ...signalOf(o),
      }),
    async probeFile(fileId, o) {
      try {
        const file = await json<DriveFile>({
          method: 'GET',
          path: `/drive/v3/files/${encodeURIComponent(fileId)}`,
          query: { fields: FILE_FIELDS },
          idempotent: true,
          ...signalOf(o),
        });
        return { state: file.trashed === true ? 'trashed' : 'present', file };
      } catch (error) {
        if (error instanceof DriveError) {
          if (error.kind === 'not_found') return { state: 'missing' };
          if (error.kind === 'forbidden') return { state: 'inaccessible' };
        }
        throw error;
      }
    },
    async downloadFile(fileId, o) {
      const response = await request({
        method: 'GET',
        path: `/drive/v3/files/${encodeURIComponent(fileId)}`,
        query: { alt: 'media' },
        idempotent: true,
        ...signalOf(o),
      });
      return new Uint8Array(await response.arrayBuffer());
    },
    createFolder: ({ id, name, appProperties, signal }) =>
      json<DriveFile>({
        method: 'POST',
        path: '/drive/v3/files',
        query: { fields: FILE_FIELDS },
        body: { id, name, mimeType: FOLDER_MIME, appProperties },
        // Safe to repeat: the ID is pre-generated and persisted before the first attempt.
        idempotent: true,
        ...(signal !== undefined ? { signal } : {}),
      }),
    untrash: (fileId, o) =>
      json<DriveFile>({
        method: 'PATCH',
        path: `/drive/v3/files/${encodeURIComponent(fileId)}`,
        query: { fields: FILE_FIELDS },
        body: { trashed: false },
        idempotent: true,
        ...signalOf(o),
      }),
    uploadFileResumable,
    setActivityHook(hook) {
      activityHook = hook;
    },
    hasSession: (key) => sessions.has(key),
    discardSession(key) {
      sessions.delete(key);
    },
  };
}

function readRangeEnd(response: Response): number | null {
  const range = response.headers.get('range');
  const match = range === null ? null : /^bytes=0-(\d+)$/.exec(range);
  return match?.[1] === undefined ? null : Number(match[1]) + 1;
}
