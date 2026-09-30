import type { OAuthState } from '../core/sync/auth';
import type { SyncOutcome } from './syncController';

/** Every account state has a text label, so status is never communicated by colour alone. */
export const STATUS_LABELS: Record<OAuthState, string> = {
  disconnected: 'Disconnected',
  authorizing: 'Connecting…',
  connected: 'Connected',
  reconnect_required: 'Reconnect required',
};

const MESSAGES: Record<string, string> = {
  NOT_CONFIGURED:
    'Google Drive is not set up in this build (no Google client ID), so it cannot connect.',
  NOT_CONNECTED: 'Connect to Google Drive first.',
  ALREADY_RUNNING: 'Another action is already running. Wait for it to finish.',
  CONNECTED: 'Connected to Google Drive. Nothing has been synced yet.',
  CONNECT_CANCELLED: 'The Google sign-in window was closed. You are not connected.',
  POPUP_BLOCKED:
    'Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.',
  ACCESS_DENIED: 'Google access was not granted. You are not connected.',
  SCOPE_MISSING:
    'Google did not grant access to the files this app creates, which sync needs. You are not connected.',
  SCRIPT_FAILED: 'The Google sign-in could not be loaded. Check your connection and try again.',
  CONNECT_ERROR: 'Connecting to Google did not work. Try again.',
  DISCONNECTED: 'Disconnected. Google has been told to revoke this app’s access token.',
  DISCONNECTED_UNCONFIRMED:
    'Disconnected on this device. Google did not confirm the revoke; you can also remove access in your Google account settings.',
  FOLDER_CHOSEN: 'Folder chosen. Run Sync now to continue.',
  RESTORED: 'The run was restored to Google Drive.',
  RESTORE_FAILED: 'The run could not be restored to Google Drive. It is unchanged here.',
  KEPT_LOCAL_ONLY: 'The run will stay on this device only.',
};

export function describeMessage(code: string): string {
  return MESSAGES[code] ?? 'Something happened that this app does not recognise. Nothing was lost.';
}

export function describeOutcome(outcome: SyncOutcome, failureCode: string | null): string {
  switch (outcome) {
    case 'ok':
      return 'Sync finished.';
    case 'busy':
      return 'Another tab is syncing right now. Try again in a moment.';
    case 'blocked_account':
      return 'This Google account is different from the one this device was first connected to. Sync is blocked so the two accounts are never mixed. Switch back to the original Google account.';
    case 'reconnect_required':
      return 'Your Google authorization expired or was refused. Reconnect to continue. Nothing was lost.';
    case 'cancelled':
      return 'Sync was stopped. Your data is unchanged.';
    case 'locks_unavailable':
      return 'This browser cannot coordinate tabs (Web Locks are unavailable), so sync is turned off. Use one tab in a current Chrome or Edge.';
    case 'failed':
      return `Sync could not finish (${failureCode ?? 'UNKNOWN'}). Your data here is unchanged; try again later.`;
  }
}
