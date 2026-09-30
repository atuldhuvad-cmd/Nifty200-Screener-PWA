import type { OAuthState, OAuthStateStore, TokenProvider } from './auth';

/** The only scope this app ever requests: files the app itself creates. No email or profile. */
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** The slice of Google Identity Services' token-model API this app uses. */
export interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
}

export interface GoogleTokenClientConfig {
  client_id: string;
  scope: string;
  callback: (response: GoogleTokenResponse) => void;
  error_callback?: (error: { type: string }) => void;
}

export interface GoogleOAuth2 {
  initTokenClient(config: GoogleTokenClientConfig): { requestAccessToken(): void };
  revoke(accessToken: string, done?: (response: { successful?: boolean }) => void): void;
}

export type ConnectResult =
  | { status: 'connected' }
  | { status: 'cancelled' }
  | { status: 'popup_blocked' }
  | { status: 'denied' }
  | { status: 'scope_missing' }
  | { status: 'script_failed' }
  | { status: 'error'; code: string };

export type DisconnectResult =
  { status: 'revoked' } | { status: 'unconfirmed' } | { status: 'nothing_to_revoke' };

export interface GisTokenProvider extends TokenProvider {
  /** Loads the Google script if needed and asks the user for access. Call only from a click. */
  connect(): Promise<ConnectResult>;
  /** Revokes and discards the token. The local token is discarded even if revoke is unconfirmed. */
  disconnect(): Promise<DisconnectResult>;
  hasToken(): boolean;
}

export interface GisTokenProviderOptions {
  clientId: string;
  auth: OAuthStateStore;
  loadScript: () => Promise<void>;
  getOAuth2: () => GoogleOAuth2 | undefined;
  now?: () => number;
  revokeTimeoutMs?: number;
}

/** A token is treated as expired this long before Google says it is. */
const SAFETY_MARGIN_MS = 60_000;

/**
 * Token provider over Google Identity Services' browser token model. The access token exists
 * only in this closure's memory: it is never written to IndexedDB, localStorage,
 * sessionStorage, a cache, a log or a file, and it is dropped on expiry, on a 401, and on
 * disconnect. There is no refresh token in this model, so an expired token means "reconnect".
 */
export function createGisTokenProvider(options: GisTokenProviderOptions): GisTokenProvider {
  const now = options.now ?? Date.now;
  const revokeTimeoutMs = options.revokeTimeoutMs ?? 5000;
  const { auth } = options;
  let token: string | null = null;
  let expiresAtMs = 0;
  let inflight: Promise<ConnectResult> | null = null;
  let scriptReady = false;

  // A 401 (the client sets reconnect_required) or a disconnect means the token is no good.
  auth.subscribe((state: OAuthState) => {
    if (state === 'reconnect_required' || state === 'disconnected') token = null;
  });

  function settleAfterFailure(prior: OAuthState): void {
    if (token !== null) auth.set('connected');
    else auth.set(prior === 'reconnect_required' ? 'reconnect_required' : 'disconnected');
  }

  async function run(): Promise<ConnectResult> {
    const prior = auth.get();
    auth.set('authorizing');
    try {
      if (!scriptReady) await options.loadScript();
      scriptReady = true;
    } catch {
      settleAfterFailure(prior);
      return { status: 'script_failed' };
    }
    const oauth2 = options.getOAuth2();
    if (oauth2 === undefined) {
      settleAfterFailure(prior);
      return { status: 'script_failed' };
    }

    return new Promise<ConnectResult>((resolve) => {
      const finish = (result: ConnectResult): void => {
        if (result.status !== 'connected') settleAfterFailure(prior);
        resolve(result);
      };
      const client = oauth2.initTokenClient({
        client_id: options.clientId,
        scope: DRIVE_FILE_SCOPE,
        callback: (response) => {
          if (response.error !== undefined) {
            finish(
              response.error === 'access_denied'
                ? { status: 'denied' }
                : { status: 'error', code: response.error },
            );
            return;
          }
          if (response.access_token === undefined || response.access_token === '') {
            finish({ status: 'error', code: 'NO_ACCESS_TOKEN' });
            return;
          }
          if (response.scope?.split(' ').includes(DRIVE_FILE_SCOPE) !== true) {
            finish({ status: 'scope_missing' });
            return;
          }
          const seconds = Number(response.expires_in ?? 3600);
          token = response.access_token;
          expiresAtMs = now() + seconds * 1000 - SAFETY_MARGIN_MS;
          auth.set('connected');
          resolve({ status: 'connected' });
        },
        error_callback: (error) => {
          if (error.type === 'popup_closed') finish({ status: 'cancelled' });
          else if (error.type === 'popup_failed_to_open') finish({ status: 'popup_blocked' });
          else finish({ status: 'error', code: error.type });
        },
      });
      client.requestAccessToken();
    });
  }

  return {
    connect() {
      inflight ??= run().finally(() => {
        inflight = null;
      });
      return inflight;
    },

    getAccessToken() {
      if (token !== null && now() >= expiresAtMs) {
        token = null;
        auth.set('reconnect_required');
      }
      return Promise.resolve(token);
    },

    hasToken: () => token !== null,

    async disconnect() {
      const held = token;
      token = null;
      if (held === null) {
        auth.set('disconnected');
        return { status: 'nothing_to_revoke' };
      }
      const oauth2 = options.getOAuth2();
      let result: DisconnectResult = { status: 'unconfirmed' };
      if (oauth2 !== undefined) {
        result = await new Promise<DisconnectResult>((resolve) => {
          const timer = setTimeout(() => {
            resolve({ status: 'unconfirmed' });
          }, revokeTimeoutMs);
          oauth2.revoke(held, () => {
            clearTimeout(timer);
            resolve({ status: 'revoked' });
          });
        });
      }
      auth.set('disconnected');
      return result;
    },
  };
}
