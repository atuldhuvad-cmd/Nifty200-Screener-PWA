# Step 11 manual smoke test (localhost, dedicated test Google account)

Status: **owner smoke run completed on 2026-09-30 to 2026-10-01, localhost, dedicated Google test account.** Automated tests never
contact Google. The owner used synthetic runs only. No token, secret, Drive ID, personal email address or private CSV value is
recorded here. Setup is unchanged from `SMOKE_TEST_STEP10.md`.

| #   | Check                                                                                                                                  | Result     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 11a | F3: trash the run's file in Drive, then click Sync now at once (no wait). "Missing from Drive: 1" appears and the missing table lists the run | PASS: one trashed Drive file was detected as missing on the next Sync now; nothing was re-uploaded automatically |
| 11b | F1: with nothing new, Sync now shows "Files checked in Drive" and "Unchanged" above zero, not all zeros                                | PASS: clean repeat sync showed checked and unchanged counts above zero |
| 11c | F2: after Restore to Drive or Keep local only, the old summary shows "may be out of date"; the next Sync now removes that line         | PASS (outcomes): Restore to Drive returned to a clean two-file sync; Keep local only left one synced run checked and did not re-upload the kept-local run. The "may be out of date" line itself was not separately recorded; that wording is covered by automated tests only |
| 8   | Revoke the app at myaccount.google.com/permissions, Sync now: "Reconnect required"; Reconnect works                                     | PASS: revocation produced Reconnect required; consent again showed only app-specific Drive file access; final sync was clean |
| 9   | Connect a second test-user account: sync is blocked with the mismatch message                                                          | NOT TESTED: alternate accounts were not approved OAuth test users, so Google blocked sign-in before the app received a token |
| 11  | DevTools Application: no token, session URL or email in localStorage, sessionStorage, IndexedDB, Cache Storage                         | PASS: owner inspection found no OAuth token, Bearer token, Google session URL, email address or credential material; synthetic run data and app metadata were present as expected |
| 12  | Keyboard-only and screen-reader pass of the Sync view (Narrator or NVDA)                                                               | NOT TESTED: the owner reported the remaining live checks passed, but no specific keyboard-only or screen-reader pass was recorded, so this is not claimed. Keyboard-only flow and axe are covered by automated tests; screen reader remains NOT TESTED |

Record PASS / FAIL with date and notes. A FAIL is a finding; do not edit Drive JSON by hand.

The summary now also lists "Skipped, already in Drive's Trash" and "Could not be checked just now (still synced)". In 11a, note whether the trashed file was reported under "Missing from Drive" on the first click, and whether either of those two lines was non-zero.
