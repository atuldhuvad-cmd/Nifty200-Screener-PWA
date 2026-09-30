# Step 11 manual smoke test (localhost, dedicated test Google account)

Status: **not yet run.** Every row is NOT TESTED until the owner records a result. Automated tests never
contact Google. Use the throwaway test account and synthetic runs only. Do not paste any token, secret or ID
into chat or a commit. Setup is unchanged from `SMOKE_TEST_STEP10.md`.

| #   | Check                                                                                                                                  | Result     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 11a | F3: trash the run's file in Drive, then click Sync now at once (no wait). "Missing from Drive: 1" appears and the missing table lists the run | NOT TESTED |
| 11b | F1: with nothing new, Sync now shows "Files checked in Drive" and "Unchanged" above zero, not all zeros                                | NOT TESTED |
| 11c | F2: after Restore to Drive or Keep local only, the old summary shows "may be out of date"; the next Sync now removes that line         | NOT TESTED |
| 8   | Revoke the app at myaccount.google.com/permissions, Sync now: "Reconnect required"; Reconnect works                                     | NOT TESTED |
| 9   | Connect a second test-user account: sync is blocked with the mismatch message                                                          | NOT TESTED |
| 11  | DevTools Application: no token, session URL or email in localStorage, sessionStorage, IndexedDB, Cache Storage                         | NOT TESTED |
| 12  | Keyboard-only and screen-reader pass of the Sync view (Narrator or NVDA)                                                               | NOT TESTED |

Record PASS / FAIL with date and notes. A FAIL is a finding; do not edit Drive JSON by hand.

The summary now also lists "Skipped, already in Drive's Trash" and "Could not be checked just now (still synced)". In 11a, note whether the trashed file was reported under "Missing from Drive" on the first click, and whether either of those two lines was non-zero.
