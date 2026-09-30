/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public Google OAuth client ID (no secret). From an untracked .env.local; empty = not set up. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}
