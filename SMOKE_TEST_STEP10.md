# Step 10 manual smoke test (localhost, dedicated test Google account)

Status: **MANUAL / NOT TESTED.** Automated tests never contact Google. Use a throwaway Google
account that holds no real data. Do not paste any token, secret or ID into chat or commit it.

## Setup (owner, once)

1. Create a dedicated test Google account and a Google Cloud project.
2. Enable the **Google Drive API**.
3. OAuth consent screen: **External**, status **Testing**, add the test account as a test user.
   Scope: `.../auth/drive.file` only.
4. Credentials: **OAuth client ID, Web application**. Authorized JavaScript origins:
   `http://localhost:4321` (and your dev port if used). No client secret is needed.
5. Put the client ID in `.env.local` (untracked) as `VITE_GOOGLE_CLIENT_ID=...`.
6. `npm run build && npm run preview -- --port 4321 --strictPort`, then open
   `http://localhost:4321/#/sync`.

In Testing mode Google expires authorization after 7 days; Reconnect is expected then.

## Checks (record PASS / FAIL / notes; blank until run)

| #   | Check                                                                                                            | Result |
| --- | ---------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Before clicking Connect, DevTools Network shows no request to any Google host                                    |        |
| 2   | Connect opens the Google popup; consent lists only Drive file access, no email/profile                           |        |
| 3   | Status shows Connected; no CSP errors in the console                                                             |        |
| 4   | Import a synthetic run; Sync now uploads it; a file appears in an app-created Drive folder                       |        |
| 5   | A second browser profile: Connect with the same account, Sync now restores the run                               |        |
| 6   | Edit the Drive file's content, Sync now: conflict kept for review                                                |        |
| 7   | Delete the Drive file, Sync now: missing-run actions appear; both Restore and Keep local only behave             |        |
| 8   | Revoke the app at myaccount.google.com/permissions, Sync now: "Reconnect required"; Reconnect works              |        |
| 9   | Connect with a different Google account: sync is blocked with the mismatch message                               |        |
| 10  | Disconnect: no CSP error for the revoke call (watch for `oauth2.googleapis.com`); status Disconnected            |        |
| 11  | DevTools Application: no token, session URL or email in localStorage, sessionStorage, IndexedDB, Cache Storage   |        |
| 12  | Keyboard-only and screen-reader pass of the Sync view                                                            |        |
