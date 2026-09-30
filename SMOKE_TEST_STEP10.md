# Step 10 manual smoke test (localhost, dedicated test Google account)

Status: **run 2026-09-30 on localhost by the owner, then stopped by owner decision.** PASS: 1-5, 7, 10. NOT TESTED (manual, covered by automated tests): 6. NOT TESTED: 8, 9, 11, 12. Automated tests never contact Google. Use a throwaway Google
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
| 1   | Before clicking Connect, DevTools Network shows no request to any Google host                                    | PASS (2026-09-30): only localhost app files |
| 2   | Connect opens the Google popup; consent lists only Drive file access, no email/profile | PASS (2026-09-30): popup and sign-in worked; Google Account permissions list only "See, edit, create, and delete only the specific Google Drive files you use with this app" (drive.file, no email/profile) |
| 3   | Status shows Connected; no CSP errors in the console | PASS 2026-09-30 (retest): Connected; no CSP errors and no CSPV lines after the `style-src` hash fix. First run had failed on Google's inline style block. Only remaining red message: COOP `window.closed` warning from Google's popup polling (not CSP, no functional effect) |
| 4a  | (found) First Drive call after Connect | RESOLVED 2026-09-30: cause was the Drive API not enabled in the client's project; after correcting the project, Sync now finished successfully (no further 403) |
| 4   | Import a synthetic run; Sync now uploads it; a file appears in an app-created Drive folder | PASS 2026-09-30: synthetic run; Uploaded 1 (all other counts 0); Run history sync state `synced`, Backup column `Backed up`; `run-*.json` file present in Drive |
| 5   | A second browser profile: Connect with the same account, Sync now restores the run | PASS 2026-09-30, Edge as the second device, same test account: Restored from Drive 1, Uploaded 0, all other counts 0. A non-test-user account was correctly blocked by Google first. An earlier second window reported all zeros because it was not a fresh store (the run was already local: `unchanged`, which the summary does not count; see finding below). Edge Run history: run listed, sync state `synced`, Backup `Backed up`. Drive still holds exactly one `run-*.json` (no duplicate upload) |
| 6   | Edit the Drive file's content, Sync now: conflict kept for review | NOT TESTED (manual) 2026-09-30, owner decision: not hand-editing Drive JSON during smoke. Covered by automated tests: `tests/e2e/sync.spec.ts` "a divergent remote copy is kept as a conflict for review" (Chromium and Edge, mock Drive) and the Step 9 reconcile unit tests |
| 7   | Delete the Drive file, Sync now: missing-run actions appear; both Restore and Keep local only behave | PASS 2026-09-30 (Edge): detection (trash -> Sync now -> Missing 1); recovery via Drive's own Trash restore (Restored 1, Missing 0, same file); Restore to Drive button ("The run was restored to Google Drive.", table gone, one `run-*.json` outside Trash; by Step 9 design a trashed file is untrashed under its existing ID); Keep local only ("The run will stay on this device only.", Run history `local_only` after F5). One retest: a Sync now right after trashing showed Missing 0; about 1 minute later it showed Missing 1 (see F3) |
| 8   | Revoke the app at myaccount.google.com/permissions, Sync now: "Reconnect required"; Reconnect works | NOT TESTED (smoke stopped by owner decision, 2026-09-30). Reconnect after a 401 is covered by `tests/e2e/sync.spec.ts` against the mock |
| 9   | Connect with a different Google account: sync is blocked with the mismatch message | NOT TESTED (smoke stopped by owner decision, 2026-09-30). A non-test-user account was blocked by Google in Testing mode during Check 5, before reaching the app. Account mismatch is covered by `tests/e2e/sync.spec.ts` against the mock |
| 10  | Disconnect: no CSP error for the revoke call (watch for `oauth2.googleapis.com`); status Disconnected | PASS 2026-09-30 (retest): Disconnect -> Connect -> Disconnect with no CSP errors; revoke to `https://oauth2.googleapis.com/revoke` allowed. First run had failed on `connect-src` |
| 11  | DevTools Application: no token, session URL or email in localStorage, sessionStorage, IndexedDB, Cache Storage | NOT TESTED (smoke stopped by owner decision, 2026-09-30). Covered by the `tests/e2e/sync.spec.ts` storage leak test against the mock |
| 12  | Keyboard-only and screen-reader pass of the Sync view | NOT TESTED (smoke stopped by owner decision, 2026-09-30). Keyboard-only flow and axe are covered by `tests/e2e/sync.spec.ts`; screen-reader pass not done |

## Findings

- **F1 (low, UX):** the sync summary does not count `unchanged`, `already_present`, `unsupported_schema`, `duplicate_remote` or `too_large` files, so a sync can show all zeros while files were checked. Suggest a "Files checked in Drive" count and a line for skipped/unsupported files. Not a blocker; no data risk.
- **F2 (low, UX):** after Restore to Drive, the previous Sync now summary ("Missing from Drive: 1") stays on screen under the success message until the next Sync now, which reads as contradictory. Suggest clearing or marking the summary as stale after a restore or keep-local action. Not a blocker; no data risk.
- **F3 (low, real-Drive behaviour):** a Sync now made immediately after trashing a file can still see it as present (Drive search is briefly eventually consistent); a retry about 1 minute later detected it. No data risk: the run is only reported missing later. Possible follow-up: confirm the saved file with a direct metadata get before treating it as present.
