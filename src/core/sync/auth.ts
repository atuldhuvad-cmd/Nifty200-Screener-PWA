/**
 * Authorization boundary for Drive sync. Access tokens exist only in memory: nothing in this
 * module (or anywhere else) writes one to IndexedDB, localStorage, Cache Storage, a log or a
 * file. The real Google Identity Services adapter is a later step; only an in-memory
 * implementation exists here.
 */
export interface TokenProvider {
  /** The current access token, or null when there is none (disconnected or expired). */
  getAccessToken(): Promise<string | null>;
}

/** Account-level OAuth state (brief: separate from every run's sync state). */
export type OAuthState = 'disconnected' | 'authorizing' | 'connected' | 'reconnect_required';

export interface OAuthStateStore {
  get(): OAuthState;
  set(state: OAuthState): void;
  subscribe(listener: (state: OAuthState) => void): () => void;
}

export function createOAuthStateStore(initial: OAuthState = 'disconnected'): OAuthStateStore {
  let current = initial;
  const listeners = new Set<(state: OAuthState) => void>();
  return {
    get: () => current,
    set(state) {
      if (state === current) return;
      current = state;
      for (const listener of [...listeners]) listener(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export interface InMemoryTokenProvider extends TokenProvider {
  setToken(token: string | null): void;
}

export function createInMemoryTokenProvider(initial: string | null = null): InMemoryTokenProvider {
  let token = initial;
  return {
    getAccessToken: () => Promise.resolve(token),
    setToken(next) {
      token = next;
    },
  };
}
