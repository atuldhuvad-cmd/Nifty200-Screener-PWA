import { createHash, randomUUID } from 'node:crypto';

/**
 * An in-memory fake of the small part of the Google Drive v3 REST API the sync engine uses,
 * exposed as a `fetch` function. SYNTHETIC DATA ONLY: nothing here talks to a network, holds a
 * real credential, or contains real stock data. Its behaviour follows the documented API for the
 * subset used (files.list with pagination, files.get/alt=media, files.create for folders,
 * files.update untrash, files.generateIds, resumable uploads, about.get), plus fault injection.
 */

export interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  appProperties: Record<string, string>;
  trashed: boolean;
  version: number;
  content: Uint8Array;
  createdOrder: number;
}

export interface RecordedRequest {
  method: string;
  url: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: string | null;
}

export interface Fault {
  when: (request: RecordedRequest) => boolean;
  /** How many matching requests this fault applies to (default 1). */
  times?: number;
  /** Respond with this HTTP status instead of handling the request. */
  status?: number;
  reason?: string;
  headers?: Record<string, string>;
  /** Reject the request as a network failure (offline). */
  network?: boolean;
  /** Wait this long before handling (honours abort). */
  delayMs?: number;
  /** For a resumable PUT: keep only the first `k` bytes, then fail as a network error. */
  partialBytes?: number;
  /** Handle the request normally, then lose the response (the server did the work; the client
   * sees a network failure) - the classic "timed-out create" situation. */
  dropResponse?: boolean;
}

const MIME_FOLDER = 'application/vnd.google-apps.folder';
const TOKEN_PREFIX = 'fake-token-';

export const FAKE_PERMISSION_ID = 'fake-permission-0001';
export const FAKE_EMAIL = 'fake.user@example.test';

function md5Hex(bytes: Uint8Array): string {
  return createHash('md5').update(bytes).digest('hex');
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function errorResponse(status: number, reason: string, message = reason, headers = {}): Response {
  return jsonResponse(
    status,
    { error: { code: status, message, errors: [{ reason, message }] } },
    headers,
  );
}

interface Session {
  id: string;
  metadata: {
    id: string;
    name: string;
    parents?: string[];
    appProperties?: Record<string, string>;
    mimeType?: string;
  };
  totalLength: number;
  received: Uint8Array;
}

export class FakeDrive {
  readonly files = new Map<string, FakeFile>();
  readonly requests: RecordedRequest[] = [];
  /** Files the account can no longer access (Drive answers 403 appNotAuthorizedToFile). */
  readonly inaccessibleIds = new Set<string>();
  permissionId = FAKE_PERMISSION_ID;
  /** Corrupt the stored bytes of the next N completed uploads (simulates a bad transfer). */
  corruptNextUploads = 0;
  pageSizeCap = 100;
  private readonly validTokens = new Set<string>();
  private readonly faults: (Fault & { remaining: number })[] = [];
  private readonly sessions = new Map<string, Session>();
  private order = 0;
  private tokenEpoch = 0;
  private idCounter = 0;

  /** A token the fake accepts. */
  issueToken(): string {
    const token = `${TOKEN_PREFIX}${randomUUID()}`;
    this.validTokens.add(token);
    return token;
  }

  revokeToken(token: string): void {
    this.validTokens.delete(token);
  }

  clearFaults(): void {
    this.faults.length = 0;
  }

  fail(fault: Fault): void {
    this.faults.push({ ...fault, remaining: fault.times ?? 1 });
  }

  /** Makes every page token handed out so far "rejected" (as after a server-side reset). */
  invalidatePageTokens(): void {
    this.tokenEpoch += 1;
  }

  expireSessions(): void {
    this.sessions.clear();
  }

  sessionCount(): number {
    return this.sessions.size;
  }

  // ---- seeding / manipulation helpers used by tests --------------------------------------

  addFile(file: {
    id?: string;
    name: string;
    mimeType?: string;
    parents?: string[];
    appProperties?: Record<string, string>;
    trashed?: boolean;
    content?: Uint8Array | string;
  }): FakeFile {
    const content =
      typeof file.content === 'string'
        ? new TextEncoder().encode(file.content)
        : (file.content ?? new Uint8Array());
    const created: FakeFile = {
      id: file.id ?? this.newId(),
      name: file.name,
      mimeType: file.mimeType ?? 'application/json',
      parents: file.parents ?? [],
      appProperties: { ...(file.appProperties ?? {}) },
      trashed: file.trashed ?? false,
      version: 1,
      content,
      createdOrder: (this.order += 1),
    };
    this.files.set(created.id, created);
    return created;
  }

  setContent(id: string, content: Uint8Array | string): void {
    const file = this.mustGet(id);
    file.content = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    file.version += 1;
  }

  trash(id: string): void {
    const file = this.mustGet(id);
    file.trashed = true;
    file.version += 1;
  }

  deletePermanently(id: string): void {
    this.files.delete(id);
  }

  move(id: string, parents: string[]): void {
    const file = this.mustGet(id);
    file.parents = parents;
    file.version += 1;
  }

  requestsMatching(predicate: (r: RecordedRequest) => boolean): RecordedRequest[] {
    return this.requests.filter(predicate);
  }

  /** Real Drive refuses to create a file under a parent that is missing, trashed, not a
   * folder, or not accessible to the app. */
  private parentProblem(parents: string[] | undefined): Response | null {
    for (const id of parents ?? []) {
      if (this.inaccessibleIds.has(id)) {
        return errorResponse(403, 'appNotAuthorizedToFile', 'The app cannot access the parent');
      }
      const parent = this.files.get(id);
      if (!parent || parent.trashed) return errorResponse(404, 'notFound', `File not found: ${id}`);
      if (parent.mimeType !== MIME_FOLDER) {
        return errorResponse(400, 'badRequest', 'The parent is not a folder');
      }
    }
    return null;
  }

  private mustGet(id: string): FakeFile {
    const file = this.files.get(id);
    if (!file) throw new Error(`FakeDrive: no such file ${id}`);
    return file;
  }

  private newId(): string {
    this.idCounter += 1;
    return `fakeid-${String(this.idCounter).padStart(6, '0')}`;
  }

  // ---- the fetch implementation ------------------------------------------------------------

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(request ? request.url : String(input));
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    const rawHeaders = new Headers(init?.headers ?? request?.headers);
    rawHeaders.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const bodyInit = init?.body ?? null;
    const recorded: RecordedRequest = {
      method,
      url: url.toString(),
      path: url.pathname,
      query: url.searchParams,
      headers,
      body: typeof bodyInit === 'string' ? bodyInit : null,
    };
    this.requests.push(recorded);
    const signal = init?.signal ?? undefined;

    const fault = this.faults.find((f) => f.remaining > 0 && f.when(recorded));
    if (fault) {
      fault.remaining -= 1;
      if (fault.delayMs !== undefined) await this.delay(fault.delayMs, signal);
      if (fault.network === true) throw new TypeError('Failed to fetch');
      if (fault.status !== undefined) {
        return errorResponse(fault.status, fault.reason ?? 'error', fault.reason, fault.headers);
      }
      if (
        fault.partialBytes === undefined &&
        fault.delayMs === undefined &&
        fault.dropResponse !== true
      ) {
        throw new TypeError('Failed to fetch');
      }
    }

    const response = await this.route(recorded, url, method, headers, bodyInit, fault, signal);
    if (fault?.dropResponse === true) throw new TypeError('Failed to fetch');
    return response;
  };

  private async route(
    recorded: RecordedRequest,
    url: URL,
    method: string,
    headers: Record<string, string>,
    bodyInit: BodyInit | null,
    fault: (Fault & { remaining: number }) | undefined,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    // Path-based routing. Session PUTs authenticate by the unguessable session URL itself.
    if (url.pathname.startsWith('/upload/drive/v3/files') && url.searchParams.has('upload_id')) {
      return this.putSession(recorded, bodyInit, fault, signal);
    }

    if (!this.authorized(headers['authorization'])) {
      return errorResponse(401, 'authError', 'Invalid Credentials');
    }

    if (method === 'GET' && url.pathname === '/drive/v3/about') return this.about(url);
    if (method === 'GET' && url.pathname === '/drive/v3/files/generateIds') return this.genIds(url);
    if (method === 'GET' && url.pathname === '/drive/v3/files') return this.list(url);
    if (method === 'POST' && url.pathname === '/drive/v3/files')
      return this.createMetadata(recorded);
    if (method === 'POST' && url.pathname === '/upload/drive/v3/files')
      return this.initiate(recorded, url);
    const fileMatch = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (fileMatch?.[1] !== undefined) {
      const id = decodeURIComponent(fileMatch[1]);
      if (method === 'GET') return this.getFile(id, url);
      if (method === 'PATCH') return this.patchFile(id, recorded);
    }
    return errorResponse(404, 'notFound', `unhandled ${method} ${url.pathname}`);
  }

  private authorized(header: string | undefined): boolean {
    if (!header?.startsWith('Bearer ')) return false;
    return this.validTokens.has(header.slice('Bearer '.length));
  }

  private delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
  }

  private resource(file: FakeFile): Record<string, unknown> {
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      parents: file.parents,
      appProperties: file.appProperties,
      trashed: file.trashed,
      version: String(file.version),
      md5Checksum: file.mimeType === MIME_FOLDER ? undefined : md5Hex(file.content),
      size: file.mimeType === MIME_FOLDER ? undefined : String(file.content.byteLength),
    };
  }

  private about(url: URL): Response {
    const fields = url.searchParams.get('fields') ?? '';
    const user: Record<string, string> = { permissionId: this.permissionId };
    if (fields.includes('emailAddress')) user['emailAddress'] = FAKE_EMAIL;
    return jsonResponse(200, { user });
  }

  private genIds(url: URL): Response {
    const count = Number(url.searchParams.get('count') ?? '1');
    const ids = Array.from({ length: count }, () => this.newId());
    return jsonResponse(200, { ids, space: 'drive', kind: 'drive#generatedIds' });
  }

  private list(url: URL): Response {
    const q = url.searchParams.get('q') ?? '';
    const pageSize = Math.min(Number(url.searchParams.get('pageSize') ?? '100'), this.pageSizeCap);
    const token = url.searchParams.get('pageToken');
    let offset = 0;
    if (token !== null) {
      const m = /^page:(\d+):(\d+)$/.exec(token);
      if (!m || Number(m[2]) !== this.tokenEpoch) {
        return errorResponse(400, 'invalid', 'Invalid Value');
      }
      offset = Number(m[1]);
    }
    const matches = this.matchQuery(q).sort((a, b) => a.createdOrder - b.createdOrder);
    const page = matches.slice(offset, offset + pageSize);
    const next =
      offset + pageSize < matches.length
        ? `page:${String(offset + pageSize)}:${String(this.tokenEpoch)}`
        : undefined;
    return jsonResponse(200, {
      files: page.map((f) => this.resource(f)),
      ...(next !== undefined ? { nextPageToken: next } : {}),
    });
  }

  private matchQuery(q: string): FakeFile[] {
    const props: [string, string][] = [];
    let rest = q.replace(
      /appProperties has \{ key='([A-Za-z0-9_]+)' and value='([^']*)' \}/g,
      (_m, k: string, v: string) => {
        props.push([k, v]);
        return '';
      },
    );
    const mime = /mimeType\s*=\s*'([^']+)'/.exec(rest)?.[1];
    rest = rest.replace(/mimeType\s*=\s*'[^']+'/, '');
    const notTrashed = /trashed\s*=\s*false/.test(rest);
    const parent = /'([^']+)' in parents/.exec(rest)?.[1];
    return [...this.files.values()].filter((f) => {
      if (this.inaccessibleIds.has(f.id)) return false; // never listed to an app that cannot access it
      if (mime !== undefined && f.mimeType !== mime) return false;
      if (notTrashed && f.trashed) return false;
      if (parent !== undefined && !f.parents.includes(parent)) return false;
      return props.every(([k, v]) => f.appProperties[k] === v);
    });
  }

  private getFile(id: string, url: URL): Response {
    if (this.inaccessibleIds.has(id)) {
      return errorResponse(403, 'appNotAuthorizedToFile', 'The app cannot access this file');
    }
    const file = this.files.get(id);
    if (!file) return errorResponse(404, 'notFound', 'File not found');
    if (url.searchParams.get('alt') === 'media') {
      if (file.trashed) return errorResponse(403, 'downloadQuotaExceeded', 'trashed');
      return new Response(file.content as unknown as BodyInit, {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      });
    }
    return jsonResponse(200, this.resource(file));
  }

  private patchFile(id: string, recorded: RecordedRequest): Response {
    const file = this.files.get(id);
    if (!file) return errorResponse(404, 'notFound', 'File not found');
    const body = JSON.parse(recorded.body ?? '{}') as { trashed?: boolean };
    if (body.trashed !== undefined) file.trashed = body.trashed;
    file.version += 1;
    return jsonResponse(200, this.resource(file));
  }

  private createMetadata(recorded: RecordedRequest): Response {
    const body = JSON.parse(recorded.body ?? '{}') as Partial<{
      id: string;
      name: string;
      mimeType: string;
      parents: string[];
      appProperties: Record<string, string>;
    }>;
    if (body.id !== undefined && this.files.has(body.id)) {
      return errorResponse(409, 'duplicate', 'A file with that ID already exists');
    }
    const parentIssue = this.parentProblem(body.parents);
    if (parentIssue) return parentIssue;
    const file = this.addFile({
      ...(body.id !== undefined ? { id: body.id } : {}),
      name: body.name ?? 'untitled',
      mimeType: body.mimeType ?? MIME_FOLDER,
      ...(body.parents !== undefined ? { parents: body.parents } : {}),
      ...(body.appProperties !== undefined ? { appProperties: body.appProperties } : {}),
    });
    return jsonResponse(200, this.resource(file));
  }

  private initiate(recorded: RecordedRequest, url: URL): Response {
    if (url.searchParams.get('uploadType') !== 'resumable') {
      return errorResponse(400, 'badRequest', 'only resumable uploads are supported');
    }
    const metadata = JSON.parse(recorded.body ?? '{}') as Session['metadata'];
    if (metadata.id !== undefined && this.files.has(metadata.id)) {
      return errorResponse(409, 'duplicate', 'A file with that ID already exists');
    }
    const parentIssue = this.parentProblem(metadata.parents);
    if (parentIssue) return parentIssue;
    const id = randomUUID();
    this.sessions.set(id, {
      id,
      metadata,
      totalLength: Number(recorded.headers['x-upload-content-length'] ?? '0'),
      received: new Uint8Array(),
    });
    const location = `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${id}`;
    return new Response('', { status: 200, headers: { location } });
  }

  private async putSession(
    recorded: RecordedRequest,
    bodyInit: BodyInit | null,
    fault: (Fault & { remaining: number }) | undefined,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    void signal;
    const session = this.sessions.get(recorded.query.get('upload_id') ?? '');
    if (!session) return errorResponse(404, 'notFound', 'Session expired');
    const range = recorded.headers['content-range'] ?? '';
    const statusQuery = /^bytes \*\/(\d+)$/.exec(range);
    if (statusQuery) {
      if (session.received.byteLength >= session.totalLength && session.totalLength > 0) {
        return this.completeSession(session);
      }
      const headers: Record<string, string> = {};
      if (session.received.byteLength > 0) {
        headers['range'] = `bytes=0-${String(session.received.byteLength - 1)}`;
      }
      return new Response('', { status: 308, headers });
    }
    const chunk: Uint8Array = ArrayBuffer.isView(bodyInit)
      ? new Uint8Array(bodyInit.buffer, bodyInit.byteOffset, bodyInit.byteLength)
      : new Uint8Array(await new Response(bodyInit).arrayBuffer());
    const kept = fault?.partialBytes !== undefined ? chunk.slice(0, fault.partialBytes) : chunk;
    const merged = new Uint8Array(session.received.byteLength + kept.byteLength);
    merged.set(session.received, 0);
    merged.set(kept, session.received.byteLength);
    session.received = merged;
    if (fault?.partialBytes !== undefined) throw new TypeError('Failed to fetch');
    if (session.received.byteLength < session.totalLength) {
      return new Response('', {
        status: 308,
        headers: { range: `bytes=0-${String(session.received.byteLength - 1)}` },
      });
    }
    return this.completeSession(session);
  }

  private corrupt(bytes: Uint8Array): Uint8Array {
    const copy = bytes.slice();
    copy[0] = (copy[0] ?? 0) ^ 0xff;
    return copy;
  }

  private completeSession(session: Session): Response {
    const existing =
      session.metadata.id !== undefined ? this.files.get(session.metadata.id) : undefined;
    if (existing) return jsonResponse(200, this.resource(existing));
    const parentIssue = this.parentProblem(session.metadata.parents);
    if (parentIssue) return parentIssue;
    const file = this.addFile({
      ...(session.metadata.id !== undefined ? { id: session.metadata.id } : {}),
      name: session.metadata.name,
      mimeType: session.metadata.mimeType ?? 'application/json',
      ...(session.metadata.parents !== undefined ? { parents: session.metadata.parents } : {}),
      ...(session.metadata.appProperties !== undefined
        ? { appProperties: session.metadata.appProperties }
        : {}),
      content: this.corruptNextUploads > 0 ? this.corrupt(session.received) : session.received,
    });
    if (this.corruptNextUploads > 0) this.corruptNextUploads -= 1;
    return jsonResponse(200, this.resource(file));
  }
}
