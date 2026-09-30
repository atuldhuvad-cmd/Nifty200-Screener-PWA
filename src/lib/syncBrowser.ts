import { isWebLocksAvailable, type N200Database } from '../core/storage';
import { createOAuthStateStore } from '../core/sync/auth';
import { createDriveClient } from '../core/sync/driveClient';
import { browserLoaderDocument, createGisLoader } from '../core/sync/gisLoader';
import { createGisTokenProvider, type GoogleOAuth2 } from '../core/sync/gisTokenProvider';
import { createSyncController, type SyncController } from './syncController';

declare global {
  interface Window {
    /** Present only after the user has clicked Connect and the Google script has loaded. */
    google?: { accounts?: { oauth2?: GoogleOAuth2 } };
  }
}

let controller: SyncController | undefined;

/**
 * The one sync controller for this page load, wired to the real browser: Google Identity
 * Services (loaded only when the user clicks Connect) and the browser's `fetch`. The Google
 * client ID is public configuration, read from the build (`VITE_GOOGLE_CLIENT_ID`); there is no
 * client secret anywhere. Without a client ID, nothing can connect.
 */
export function getSyncController(db: N200Database): SyncController {
  if (controller !== undefined) return controller;
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
  const auth = createOAuthStateStore('disconnected');
  const provider = createGisTokenProvider({
    clientId,
    auth,
    loadScript: createGisLoader({ document: browserLoaderDocument() }),
    getOAuth2: () => window.google?.accounts?.oauth2,
  });
  const client = createDriveClient({
    fetch: (input, init) => window.fetch(input, init),
    tokens: provider,
    auth,
  });
  controller = createSyncController({
    db,
    provider,
    client,
    auth,
    configured: clientId !== '',
    locksAvailable: isWebLocksAvailable,
  });
  return controller;
}
