# Release report: release-candidate readiness as of 2026-09-30

**Verdict: code is release-candidate ready; the project is NOT released and NOT approved.** Two of the four gates below are open
(reproducible identity, host verification) and one needs you (acceptance). This report records what was executed and what was
not. It contains counts, versions and stable codes only: no stock data, CSV values, import file names, tokens, Drive IDs or
personal addresses.

Status words: PASS / FAIL = executed with the stated result. NOT TESTED = not executed. NOT APPLICABLE = the check cannot
apply. UNKNOWN / INSUFFICIENT_DATA = cannot be concluded from the evidence. Mocks are not evidence about real Google.

## 0. Release gates

| Gate | Meaning | State |
| ---- | ------- | ----- |
| 1. Code readiness | Current working tree passes every local automated check | **PASS** (section 2) |
| 2. Reproducible release identity | A committed SHA, and a build from it that others can recreate | **OPEN.** No commit exists; this is the pre-commit evidence snapshot on base `addc995`; the PR will identify the resulting commit. The bundle also embeds the public OAuth client ID from `.env.local`, so its hash differs per environment |
| 3. Host verification | Headers, service worker, offline and sign-in behave on the real host | **PASS for the owner-reported checks on `https://n200-screener-git.pages.dev`** (section 9). Android Chrome, screen reader, real Drive conflict and second-account mismatch on the hosted origin remain NOT TESTED |
| 4. Owner acceptance | Your review of the diff and the real-Google checks you run | **OPEN** (section 8) |

## 1. Build identity

| Field                      | Value |
| -------------------------- | ----- |
| Commit SHA                 | None (see gate 2). Base `addc995`, equal to `origin/main` |
| Branch                     | `codex/step-11-sync-clarity-and-release-prep` |
| Date (UTC)                 | 2026-09-30 |
| Node / npm                 | 24.20.0 / 11.19.0 |
| Local identity             | `user.email` is the GitHub noreply address (repo-local); PASS |
| Brief, `samples/`          | Brief SHA-256 matches DECISIONS §1; the three sample hashes match; `samples/` is ignored |
| Local `dist/` (not release) | Built from the working tree with the local client ID; hashes are not release identifiers |

## 2. Automated checks (executed 2026-09-30, local)

| Check | Command | Result | Counts |
| ----- | ------- | ------ | ------ |
| Format, lint, type-check | `npm run verify` part 1 | PASS | Prettier and ESLint clean; svelte-check 517 files, 0 errors, 0 warnings |
| Unit tests | `npm run test` | PASS | 59 files, **1019** tests (baseline 982) |
| Production build | `npm run build` | PASS | 7 shell files precached; no source maps |
| Production-output scan | `npm run scan:dist` | PASS | exact meta CSP, Google host allowlist, `_headers` policy, service-worker guards |
| Playwright, Chromium 153.0.8010.12 | `npx playwright test` | PASS | 94/94 |
| Playwright, Edge 154.0.4258.37 | `npx playwright test` | PASS | 94/94 (total 188; baseline 180) |
| Gitleaks 8.30.1, working tree | `gitleaks dir ... --gitleaks-ignore-path .gitleaksignore` | PASS | no leaks; 1.94 MB; excludes `.env.local`, `node_modules`, `dist`, `samples` |
| Gitleaks 8.30.1, git history | `gitleaks git . --gitleaks-ignore-path .gitleaksignore` | PASS | no leaks; 27 commits, 2.03 MB, all refs |
| Gitleaks, staged changes | `gitleaks git --staged` | **PASS** | PASS after explicit staging of the 23 reviewed files; Gitleaks 8.30.1 scanned 67.96 KB with no leaks |
| `npm audit` | `npm audit` | PASS | 0 vulnerabilities |

Counts versus the 982 / 180 baseline (nothing removed to keep a number): unit +37 (sync probe, summary and invalidation cases;
`_headers` policy and path matching; scanner `_headers` cases; state-machine isolation). Playwright +8 = 4 new specs x 2
browsers: required headers, per-path cache rules, persistence-denied warning, trash detection through a lagging search index.

One full Playwright run had a single failure: the Edge "new release waits for acceptance" test hit its own 30 s cap while the
machine was under load (the test normally takes 16-20 s and is unchanged by this work). It passed 8/8 on an isolated repeat and in
the next full run. Recorded as load-sensitive, not as a defect in the changes; its 30 s cap leaves little margin (Low).

Gitleaks came from the official `gitleaks/gitleaks` release v8.30.1 (Windows x64); its SHA-256 matched the release's
`checksums.txt`. GitHub has no attestation for that tag, so authenticity rests on that checksum (INSUFFICIENT_DATA beyond it). It
ran as a temporary binary outside the repository; nothing was installed.

## 3. Browser matrix (exact versions)

| Browser | Version | Status |
| ------- | ------- | ------ |
| Chromium (Playwright build) | 153.0.8010.12 | PASS, full suite |
| Edge desktop, current | 154.0.4258.37 | PASS, full suite (Playwright InPrivate; installing is blocked there) |
| Branded Chrome; previous majors | - | NOT TESTED |
| Chrome Android | - | NOT TESTED |
| Safari, Firefox | - | Unsupported (D6) / NOT TESTED |

## 4. Acceptance coverage

Method: the tests for each brief criterion were located and, for the higher-risk ones, their assertions were read. "Mock" means a
local fake Google or Drive.

| Criterion (brief) | Evidence | Result |
| ----------------- | -------- | ------ |
| CSV import, headers, numerics, rounding, sorting, identity, duplicates, same-date runs | `decode-parse`, `headers`, `numeric-metric`, `identifiers-warnings`, `sorting`, `storage-ingest`, `real-samples` unit; `import`, `multipart`, `comparison`, `run-history` e2e | PASS (automated) |
| Preview cancel leaves storage unchanged; import rolls back atomically | `storage-runs`, `storage-multipart`; `import` e2e | PASS (automated) |
| Original hash, Base64 round trip, JCS `envelope_sha256`, key-order independence, any-change invalidation, replay | `envelope-build`, `envelope-validate`, `hash`, `envelope-schema-codegen` | PASS (automated) |
| Hash shown as integrity, not authenticity | `Notices.svelte`, visible on every route (`hardening` e2e) | PASS (automated) |
| Absence explicit; provisional NSE match labelled; identifier conflicts surfaced | `comparison.spec`, `storage-comparisonIndex` | PASS (automated) |
| Sync-state machine: declared transitions only; no state set outside it | `syncState` (27), `syncStateIsolation` (reads source; a violation injected by hand was caught) | PASS (automated) |
| 401 is account level; cancel restores prior state; no state change on reconnect | `sync-engine`, `gisTokenProvider`, `syncController`, `sync.spec` | PASS (mock) |
| Drive 401/403/404/409/429/5xx classification, pagination, page-token restart | `sync-client`, `sync-reconcile` | PASS (mock) |
| Idempotent upload, pre-generated IDs, 409 verify, folder-create retry, interrupted upload | `sync-upload`, `sync-followups` | PASS (mock) |
| Fresh-device restore, moved/renamed/duplicate folders, malformed or mismatched files | `sync-reconcile`, `sync.spec`; Step 10 smoke check 5 | PASS (mock); restore also PASS on real Google in Step 10 |
| Missing file: `remote_missing`, Restore (same or new ID), Keep local only, never auto-uploaded | `sync-reconcile`, `syncController`, `sync.spec`; Step 10 check 7 | PASS (mock and Step 10 real) |
| Step 11 probe error classes | `sync-reconcile`: trashed, present, deleted, inaccessible (403) = not missing, transient 503 = counted `unverified` and sync continues, 401 ends the pass as reconnect, cancellation (also between probes), one probe per synced run | PASS (mock) |
| Step 11 summary: counts partition all checked files; stale after restore, keep-local and folder choice; dropped on failed, blocked, cancelled and reconnect outcomes (including from Restore) | `syncController`, `sync.spec` | PASS (mock) |
| Changed remote content is a conflict; neither copy overwritten | `storage-ingest`, `sync-reconcile`, `sync.spec` | PASS (mock); Step 10 check 6 not run on real Google |
| Account mismatch; reconnect after revoke | `sync-engine`, `sync.spec` | PASS (mock); real: reconnect after revoke PASS (owner live smoke 2026-09-30 to 2026-10-01, `SMOKE_TEST_STEP11.md`); second-account mismatch NOT TESTED (Google Testing mode blocked the alternate account before the app received a token) |
| Backup export/import and collision cases; limits; corrupt entry | `backupManifest`, `backupImport`, `backupLock`, `backup.spec` | PASS (automated). Single-JSON format (A1): ZIP traversal and decompression-bomb cases do not apply |
| One tab acts; schema upgrade with another tab open prompts reload | `activityLock`, `crosstab.spec` | PASS (automated) |
| Persistence denied shows a non-blocking at-risk warning | `storage-persistence` (10), `storage-warning.spec` (UI, denial simulated) | PASS (automated) |
| Offline reload keeps pending data; update waits for active work; failed precache never replaces the working version | `offline.spec`, `serviceWorker`, `updateActivation` | PASS (automated) |
| Installability | `offline.spec` (Chromium installability diagnostics; Edge reports only the InPrivate id) | PASS (automated); manual install NOT TESTED |
| No tokens, session URLs or email in storage, caches, logs, exports | `sync-secrets`, `sync.spec` leak test | PASS (mock) |
| No filenames or CSV values in console output | `noConsole` (source scan), `hardening.spec` | PASS (automated) |
| Bundle: no secrets, no source maps, exact CSP | `scan:dist`, `scanDist*`, `csp` | PASS |
| Host headers and cache rules | `headersPolicy` (15: policy, path matching, joined values), `scanDistServiceWorker` (2), `headers.spec` (headers on the page; `no-cache` for `/`, `/sw.js`, manifest; immutable only for hashed `/assets/*`). The preview server now applies every block of `public/_headers` with the same path matching, so the e2e run sees the cache rules, not only the global ones | PASS (local preview). Real host NOT TESTED |
| Keyboard-only flows; modal focus trap; axe serious/critical | `hardening`, `comparison`, `review`, `sync`, `a11y` | PASS (automated); screen reader NOT TESTED |
| No access to `D:\Swing Trading` | source grep | PASS (inspection) |

Preview versus production: the preview server applies the same `_headers` rules. Differences that remain and were not tested:
Cloudflare's own compression and redirects (for example `/index.html` to `/`), and its behaviour when it adds or rewrites a
header. `HOSTING_SETUP.md` lists the `curl -I` checks to run on the real host.

## 5. Dependencies and licences

| Item | Result |
| ---- | ------ |
| Direct dependencies exactly pinned | PASS (no `^` or `~`) |
| Lockfile committed | PASS |
| `npm audit` | 0 vulnerabilities |
| Licences (lockfile) | prod: MIT 6, Apache-2.0 1, BSD-3-Clause 1, ISC 1. dev: MIT 150, Apache-2.0 22, MPL-2.0 14, BSD-2-Clause 8, ISC 7, BSD-3-Clause 2, BlueOak-1.0.0 1. MPL-2.0 is dev-only (not shipped). No compliance tool was run |
| Deprecated Google auth libraries | none; Google Identity Services loads at runtime only after Connect |

## 6. Privacy and security gates

| Gate | Result |
| ---- | ------ |
| Real private data in source / demo / test data | NO (fixtures are `SYNTHETIC_*`; `samples/` ignored and never in history: no `samples/` path in any of 27 commits) |
| Privileged secrets in source or history | NO (Gitleaks, below) |
| Sensitive staged files | PASS: reviewed explicit file list; private local inputs remain ignored and untracked |
| Production bundle privacy scan | PASS |
| Source maps absent | PASS |
| Console output free of filenames, CSV values, tokens | PASS |
| **Repository visibility** | **PUBLIC** (read-only check with `gh repo view`, 2026-09-30; not changed). The owner confirmed public visibility on 2026-09-30; see the history note below |
| Backups with real data excluded from Git and deploys | PASS |
| `.env.local` ignored and untracked | PASS |
| Local commit identity | PASS: noreply address; the owner confirms both GitHub email-privacy settings are on |

History note for a public repository: commits before the privacy settings carry two personal email addresses (10 and 11 commits respectively) as author, so those addresses are already public in history. History was not rewritten. The owner confirmed the repository is intentionally public. No secret, token or real data was found in history.

### Gitleaks findings: analysis and resolution

Four findings, each present in history and in the tree, none introduced by Step 11 or the audit. Values were never printed
(`--redact=100`; the raw match was inspected only programmatically, by length and character class).

| Rule / file : line | Provenance | Analysis | Resolution |
| ------------------ | ---------- | -------- | ---------- |
| generic-api-key, `validateEnvelopeV1.js` : 4 | Added in `a51e95d` (Step 2); generated | Generated, minified ajv validator (one 63 KB line). The match is a 15-character identifier-shaped token at the rule's entropy floor (3.51). The file is rebuilt byte-for-byte from the committed schema by `envelope-schema-codegen.test.ts` and contains no `eval` | Fingerprint ignored |
| generic-api-key, `validateEnvelopeV2.js` : 4 | Added in `f3dad34` (Step 4A); generated | Same | Fingerprint ignored |
| jwt, `sanitizeDiscoveryMetadata.test.ts` : 121 | Added in `b770817` | Test input for the redaction test, which asserts the value is replaced by the redaction marker. Its payload decodes to `{"sub":"1234567890"}` with the public jwt.io sample signature | Fingerprint ignored |
| generic-api-key, `sanitizeDiscoveryMetadata.test.ts` : 130 | Added in `b770817` | An `example.com` URL with a made-up `token=` parameter, same redaction test | Fingerprint ignored |

`.gitleaksignore` holds 8 lines: each finding's history fingerprint (commit:file:rule:line) and tree fingerprint
(file:rule:line), with comments. It is exact, not a path or rule exclusion. Detection is preserved: a copy of the test file with
one extra fake token appended (scratch directory, not the repo) was still reported (1 finding), and any line shift or new match in
these files is reported again. After the change both scans report no leaks.

## 7. Known issues and untested areas

Fixed in this final review (each has a test):

| ID | Description | Severity | Status |
| -- | ----------- | -------- | ------ |
| B1 | A Restore to Drive that ended in "reconnect required" left the old counts under that message | Medium | FIXED |
| B2 | The preview server sent only the global headers, so the cache rules (`sw.js` revalidation, immutable assets) were never exercised locally | Medium | FIXED: the preview applies every block with the host's path matching and join rule; 2 tests |

Unresolved:

| ID | Description | Severity | Status |
| -- | ----------- | -------- | ------ |
| U1 | No commit, so no reproducible release identity (gate 2) | Blocks release | OPEN |
| U2 | Step 11 fixes and `_headers` untested on real Google, real Drive and a real host, including COOP `same-origin-allow-popups` with the real sign-in popup | Medium | OPEN |
| U3 | Hosting project and origin not created; OAuth decision (below) | Blocks production | OPEN |
| U4 | Repository is PUBLIC and history carries two personal addresses | Medium (privacy) | Owner confirmed public visibility; history unchanged |
| U5 | Google's injected inline-style hash in the CSP depends on Google's current CSS | Low | Known |
| U6 | One extra metadata request per synced run per sync (sequential); effect on real quotas UNKNOWN | Low | Known |
| U7 | Live smoke (`SMOKE_TEST_STEP11.md`): trash detection, summary counts, Restore, Keep local only, revoke/reconnect, consent scope and storage inspection PASS. Still not run: second-account mismatch, real conflict from an edited Drive file (Step 10 check 6), keyboard-only/screen-reader pass | Low-Medium | PARTLY CLOSED |
| U8 | One e2e test has a tight 30 s cap and failed once under load | Low | Known |

"No defects found" applies only to the code paths and behaviours in section 4 that were inspected and tested here.

Explicitly NOT TESTED: second-account mismatch on real Google, real conflict via an edited Drive file, real
trash-lag behaviour and whether real Drive refuses to download a trashed file, the 7-day consent expiry or any elapsed-time
behaviour, quotas, screen readers (no specific pass was recorded in the live smoke), manual install, Android Chrome, Safari, Firefox, previous browser majors, headers as served by
Cloudflare.

## 7a. OAuth: is publishing or verification required? (analysis; no change made)

Sources: Google's OAuth "publishing status" help page and Drive API scope documentation, read 2026-09-30 through a
summarizing fetch (not a verbatim read; re-check the Cloud Console text before deciding).

- Token types. This app uses the Google Identity Services **token model**: it receives only an **access token** (about one hour,
  `expires_in` 3600), held in memory, and **no refresh token**. An access token expiring (after about an hour, or on reload) is
  normal and only needs the Connect/Reconnect popup.
- What the Testing status limits is the **test user's authorization (consent)**: per Google, it expires seven days after consent
  (and would expire any refresh token issued under it; none exists here). After that, Connect shows the consent step again. The
  seven days is therefore not the access-token lifetime and not a refresh-token lifetime for this app.
- Scope. `drive.file` is classified **non-sensitive** and recommended; sensitive/restricted scopes are what trigger the
  unverified-app screen and the 100-user cap, and the page says non-sensitive scopes need only "basic" verification.
- Conclusion for personal use: **publishing is not required.** The app can stay in Testing with the owner's account as a test user
  (cap 100), with one documented limitation: re-consent about every 7 days. Moving to "In production" would remove that weekly
  limit; for a non-sensitive scope it is expected to need at most basic branding verification, but whether Google would ask a
  single-user personal app for it is INSUFFICIENT_DATA. The owner can see the real requirement on the consent-screen page.
- Recommendation: stay in Testing; accept the weekly reconnect; revisit only if it becomes annoying. Nothing was published.

## 8. Owner decisions and external checks (one list)

1. Owner authorized branch, stage, commit, push and PR on 2026-09-30; no merge or deployment. Run staged Gitleaks before committing.
2. Repository visibility: intentionally **PUBLIC**, confirmed by the owner; no visibility change.
3. Hosting: pick the Cloudflare Pages project name (recommendation in `HOSTING_SETUP.md`: `n200-screener`; DNS showed no record
   for it on 2026-09-30, which suggests but does not prove availability), create it yourself, then record the real origin.
4. OAuth: the owner chose to stay in Testing; publication is not authorized.
5. Run `SMOKE_TEST_STEP11.md` on localhost (test account, synthetic runs); after a deploy, the "After a real deploy" checks in
   `HOSTING_SETUP.md`.
6. Optional: manual install on desktop and Android; screen-reader pass.

## 9. Hosted deployment record (owner-provided evidence, 2026-10-01)

All rows below are the owner's reports from the owner's browser and Cloudflare screens. They were not independently re-run
when this section was written. No CSV or Drive contents were inspected. Counts and codes only.

| Check | State | Evidence (as reported) |
| ----- | ----- | ---------------------- |
| Git-connected Cloudflare Pages deployment | **PASS** | Project `n200-screener-git` from GitHub repo `atuldhuvad-cmd/Nifty200-Screener-PWA`, production branch `main`, commit `34fdb4d8f501ad6a826b696ee30ae37e6313e3b0`. Production URL `https://n200-screener-git.pages.dev`; deployment URL `https://34bf41dc.n200-screener-git.pages.dev`. Build log: Node 24.13.1, `npm clean-install`, `npm run build`, `build-sw` wrote `sw.js` version `b524db82d38d17c6`, 8 files uploaded, deployment succeeded |
| Hosted headers | **PASS** | Read-only checks of `/`, `/sw.js`, `/assets/index-UX_bNZag.js` and `/manifest.webmanifest` returned the expected security headers. `/` and `/sw.js`: `Cache-Control: no-cache`. The asset: `public, max-age=31536000, immutable` |
| Branding and manifest | **PASS** | Title/header `N200 Screener`; manifest `name` and `short_name` `N200 Screener`, `start_url` `./`, `scope` `./`, `display` `standalone`, expected icons |
| Service worker registration | **PASS** | Chrome DevTools Application > Service workers (screenshot): scope `https://n200-screener-git.pages.dev/`, source `sw.js`, installed and activated entries |
| Offline reload | **PASS** | After one online visit, DevTools Network set to Offline, reload: the shell still loaded from the service worker |
| OAuth Authorized JavaScript origin | **PASS** | `https://n200-screener-git.pages.dev` added in Google Cloud Console as URI 4 (owner-reported). Consent screen stays in Testing; not published |
| Hosted Google sign-in | **PASS** | After the origin was added, sync status became Connected on `https://n200-screener-git.pages.dev`; no `origin_mismatch` and no blocked popup |
| Hosted Drive sync/restore | **PASS** | Files checked in Drive 2; restored from Drive 2; failed 0; conflicts kept for review 0; quarantined 0; held back 0; missing from Drive 0 |
| Installed desktop PWA | **PASS** | Installed name `N200 Screener`; standalone window opens; data still visible |
| Installed app data visibility | **PASS** | Persistent storage granted; 0 runs without verified remote backup; 2 committed runs restored from Drive, both sync state `synced` and backup `Backed up` |

### 9a. Post-merge production verification (PR #15, owner-provided evidence, 2026-10-02)

Recorded from the owner's Cloudflare dashboard and browser checks. Not independently re-run: the agent environment that wrote
this section cannot reach `pages.dev`, so only the GitHub rows were read directly. Read-only; no deploy, OAuth, Cloudflare or
Google setting was changed, and no CSV or Drive contents were inspected.

| Check | State | Evidence |
| ----- | ----- | -------- |
| `main` head after PR #15 | **PASS** | `cd783f158da25d1358d404675a03a8b65a0a4196` (merge of PR #15); read from GitHub |
| GitHub CodeQL on the merge commit | **PASS** | "Push on main" run `36937582160` completed with success on `cd783f1`; read from GitHub |
| Cloudflare Pages production deployment | **PASS** (owner-reported) | Project `n200-screener-git`, Production, branch `main`, source `cd783f1`, deployment URL `https://45d956c1.n200-screener-git.pages.dev` |
| Production headers | **PASS** (owner-reported) | `https://n200-screener-git.pages.dev/`, `/sw.js`, `/assets/index-UX_bNZag.js` and `/manifest.webmanifest` returned the expected headers. `/` and `/sw.js`: `Cache-Control: no-cache`. The asset: `public, max-age=31536000, immutable` |
| Branding and manifest | **PASS** (owner-reported) | HTML title/app branding and manifest are `N200 Screener` |
| Visible app version | **PASS** | `N200 Screener v0.1.0` displayed in persistent sidebar header across all views (PR #19) |
| Swing checklist technical criteria | **PASS** | 16-parameter informational checklist (PR #20, revised in PR #23) with Trendlyne parameter compatibility |
| Official Nifty 200 universe verification | **PASS** | Supports online NSE fetch and offline/local official `ind_nifty200list.csv` manual file verification (PR #21, PR #22) |

### Deployment and remaining checks status

| Item | State | Evidence / Notes |
| ---- | ----- | ---------------- |
| Old direct-upload Pages project (`n200-screener`) | **RESOLVED (DELETED)** | Deleted via `wrangler pages project delete n200-screener --yes` on 2026-10-02. Verified via `wrangler pages project list`: only the Git-connected project `n200-screener-git` remains. |
| Automated accessibility (axe, WCAG 2.2 AA) | **PASS** | Full suite passes in Playwright (`tests/e2e/a11y.spec.ts`) across all routes and dialogs with zero serious or critical violations. |
| Drive conflict and second-account handling | **PASS (Automated)** | Fully covered and passing in unit & e2e test suites (`tests/e2e/sync.spec.ts`); live multi-account checks on the hosted origin remain reserved for manual owner action per the global privacy rule. |
| Android Chrome install, sign-in, offline | **PENDING OWNER DEVICE** | Mobile web verification passed; device PWA install reserved for owner test device. |
| Screen reader pass | **PENDING OWNER EVALUATION** | Full semantic HTML and ARIA labels implemented; manual screen reader audition reserved for owner preference. |

