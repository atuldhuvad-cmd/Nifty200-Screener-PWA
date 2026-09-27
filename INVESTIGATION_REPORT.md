# Nifty 200 Screener PWA: Pre-Implementation Investigation Report

- **Date:** 2026-09-27
- **Governing brief:** `Nifty200_Screener_PWA_Brief_v8.md` (read in full)
- **Session scope:** read-only investigation. No code, no installs, no git, no Google sign-in, no access to `D:\Swing Trading`. This file is the only one created.

**Status legend:**
- **VERIFIED:** checked this session against the real sample, or against current official docs or the npm registry.
- **NOT VERIFIED:** based on prior knowledge, or needs a live test before relying on it.

---

## 0. Folder state at start

| Item | Finding |
|---|---|
| Folder contents | `Nifty200_Screener_PWA_Brief_v8.md`, `samples\Nifty 200 with Fundamentals_September 27, 2026.csv`. Nothing else: no git repo and no existing code. |
| Brief filename | Differed from the instructions (`PROJECT_BRIEF_v8.md`). You confirmed the actual file is correct. |

---

## 1. CSV sample analysis (VERIFIED against the sample)

### 1.1 File-level format

| Property | Finding |
|---|---|
| Size | 1,129 bytes |
| Encoding | UTF-8. Decodes strictly and contains only ASCII after the BOM. |
| BOM | **Present** (`EF BB BF`) |
| Delimiter | Comma `,`. No tabs or semicolons. |
| Quote style | **Every field is double-quoted**, in the header and in all data rows. No escaped quotes (`""`) appear. |
| Line endings | **LF only** (5 × `\n`, 0 × `\r`) |
| Trailing newline | **Absent.** The last row ends without a newline. |
| Rows | 1 header row + **5 data rows** |
| Columns | **19** in every row. No ragged rows. |
| Embedded newlines or commas in values | None in this sample, so this behaviour is untested. |

### 1.2 Exact headers

`␠` marks a trailing space. `␠␠` marks a doubled internal space.

| # | Exact header (repr) | Notes |
|---|---|---|
| 0 | `'Sl No'` | Rank or serial number |
| 1 | `'Stock'` | Company name |
| 2 | `'Day Vol '` | **Trailing space.** This is the Volume Ratio **numerator**. |
| 3 | `'Consolidated 30D average end of day Vol '` | **Trailing space.** This is the Volume Ratio **denominator**. |
| 4 | `'Day RSI'` | |
| 5 | `'LTP'` | |
| 6 | `'Day SMA20'` | |
| 7 | `'Day SMA50'` | |
| 8 | `'Day Chg %'` | |
| 9 | `'Day ADX'` | |
| 10 | `'ROE Ann  %'` | **Double internal space** (`Ann␠␠%`) |
| 11 | `'Interest Coverage Ratio Ann '` | Trailing space |
| 12 | `'Piotroski Score'` | |
| 13 | `'ROCE Ann  %'` | **Double internal space** |
| 14 | `'Altman Zscore'` | |
| 15 | `'LT Debt To Equity Ann '` | Trailing space |
| 16 | `'NSE Code'` | |
| 17 | `'BSE Code'` | Not mentioned in the brief. It could be kept as an informational field and not used for matching. |
| 18 | `'ISIN'` | |

- **Duplicate headers:** none, either raw or after trimming, whitespace-collapsing and lower-casing.
- **Blank headers:** none.
- **Leading whitespace:** none.
- **Implication:** the brief's rule to trim outer whitespace is required. Without it, `Day Vol` will not match `Day Vol `. For the two `Ann␠␠%` headers, the brief does not say whether to collapse internal whitespace (see Decision D3).

### 1.3 Volume Ratio column mapping

| Role | Exact header | Normalized (trim + lowercase) |
|---|---|---|
| Numerator ("Day Volume" in the brief) | `Day Vol ` | `day vol` |
| Denominator ("Consolidated 30-day average end-of-day volume") | `Consolidated 30D average end of day Vol ` | `consolidated 30d average end of day vol` |

The brief's wording, "Day Volume", does not literally match the Trendlyne header, "Day Vol". An approved alias list is therefore needed (see Decision D3).

Preview values from this sample, using Python `Decimal` with ROUND_HALF_UP at 3 decimal places. These are for sanity only and are not a test fixture: MCX 1.098, LGEINDIA 1.301, OBEROIRLTY 1.113, ENRIN 1.022, APOLLOHOSP 1.396.

### 1.4 Numeric formats present

| Observation | Evidence |
|---|---|
| Plain integers | `Sl No`, `Day Vol `, `Piotroski Score`, and some values in `LTP`, `Day Chg %` and `LT Debt To Equity Ann ` (for example `3313`, `-3`, `0`) |
| Decimals with at most 2 decimal places | All other numeric columns. The average volume has 2 dp (for example `2174644.95`). |
| **Trailing zeros are stripped** | `3313` (not `3313.00`), `55.9`, `678884.9`, `0` |
| Negatives | Yes, with a leading `-` (`Day Chg %` = `-3`) |
| Leading `+` | Not observed |
| Grouping commas (Western or Indian style) | **Not observed.** The largest value is 2,386,852, written as `2386852`. |
| Blank cells | **None in this sample** |
| Other tokens (`-`, `NA`, `N/A`, `∞`, `%`, whitespace) | None |
| Leading zeros | Only in the form `0.xx` |

**Grammar supported by the sample:** `^-?(0|[1-9][0-9]*)(\.[0-9]+)?$`

The brief permits grouping commas, but this sample gives no evidence either way (see Decision D2).

Because `Day Vol` is an integer and the average has 2 dp, a decimal library is required, as the brief states. Native floating-point division is not needed and should not be used.

### 1.5 Identifiers

| Check | Result |
|---|---|
| ISIN present in every row | Yes (5/5) |
| ISIN structure `^[A-Z]{2}[A-Z0-9]{9}[0-9]$` | 5/5 pass. All are `IN` prefixed. One has letters in the issuer segment (`INE1NPP01017`). |
| ISIN check digit (letters converted to numbers, then Luhn) | **5/5 valid** |
| NSE Code present in every row | Yes (5/5) |
| NSE Code form | Uppercase alphanumerics with no whitespace (`MCX`, `LGEINDIA`, `OBEROIRLTY`, `ENRIN`, `APOLLOHOSP`) |
| Whitespace around identifiers | None |
| Duplicate ISIN or NSE Code within the run | None |

**Proposed NSE Code normalization:** trim outer ASCII whitespace, uppercase the ASCII, and reject anything outside `[A-Z0-9&-]`.

This is confirmed only for simple symbols. Nifty 200 includes symbols containing `&` and `-` (for example M&M and BAJAJ-AUTO; NOT VERIFIED which are currently in the index), and this sample has none of them.

### 1.6 Import limits against the sample

| Limit (brief) | Sample | Fits? |
|---|---|---|
| 10 MiB per file | 1,129 B | Yes |
| 1,000 data rows | 5 | Yes. A full 200-stock export would also fit. |
| 500 columns | 19 | Yes |
| 256 KiB per decoded cell | Largest cell is 40 B (a header) | Yes |

All four limits fit with a very large margin. A full Nifty 200 export with about 20 to 40 columns is an estimated 30 to 80 KB. That is an estimate, NOT VERIFIED.

The limits are safe but generous. A tighter set such as 2 MiB, 1,000 rows, 200 columns and 4 KiB per cell would also fit and would keep envelopes small. After Base64 plus parsed cells, an envelope is roughly 2.5× the CSV size (see Decision D4).

### 1.7 Other sample observations

- **The filename date is a Sunday** (27 Sep 2026, VERIFIED). The market data therefore most likely reflects an earlier trading day, probably Fri 25 Sep 2026 (NOT VERIFIED). This supports the brief's rule that `effective_date` must be confirmed by the user and never taken from the filename. The preview should suggest nothing, or at most show the filename date labelled as unconfirmed.
- **Only 5 rows.** This is a filtered screener result, not all 200 constituents. That is consistent with the brief's rule to never infer the universe from row count.

### 1.8 Limits of one sample: what a second export should confirm

A single 5-row export is weak evidence. Before freezing the importer grammar, a second export, ideally a full or near-full run of 50 to 200 rows, should confirm:

1. **Header stability.** Do headers (including trailing and double spaces) come out identically on another day? What happens when you add, remove or reorder screener columns?
2. **Whether the BOM, all-field quoting, LF line endings and missing final newline are consistent.** The same export from a different browser or OS would also help.
3. **Blank or placeholder cells.** These are likely for debt-free companies (Interest Coverage), loss-making companies (negative ROE or ROCE), and new listings with no 30-day average. Are they empty, `-`, `NA`, or `0`?
4. **Large values.** Does a volume of 1 crore or more ever carry grouping commas? This decides whether commas are rejected or accepted.
5. **Symbols with `&` or `-`** (for example M&M, BAJAJ-AUTO) and their exact rendering, including whether `&` becomes `&amp;`.
6. **Company names containing commas, quotes or non-ASCII characters**, to exercise quoted delimiters and UTF-8.
7. **A zero `Day Vol` row**, to confirm it appears as `0` rather than blank.
8. **Any missing ISIN or NSE Code**, to confirm how it is rendered.
9. **Negative values** in fundamentals columns (ROE, Altman Z).

---

## 2. Framework and tooling recommendations (recommendations only; nothing installed)

Version and licence data came from the npm registry on 2026-09-27 (VERIFIED where marked). "Maintenance" is my assessment from release recency and is not a guarantee.

| Role | Recommendation | Licence | Latest version seen | Rationale / notes |
|---|---|---|---|---|
| Build tool | **Vite** + **TypeScript** (strict) | MIT / Apache-2.0 | not checked | De-facto standard. Static output suits any static host. Lockfile via **pnpm** (or npm). |
| UI layer | **Svelte 5** as a plain Vite SPA (no SvelteKit), *or* vanilla TypeScript modules | MIT | not checked | Svelte's compiler emits accessibility warnings at build time, which helps the WCAG goals. It gives small bundles without a virtual DOM. Vanilla TS is closer to your global "index.html / css / js" preference but means hand-writing reactive table and dialog state (see Decision D1). |
| IndexedDB | **idb** (Jake Archibald) | ISC | 8.0.3 (VERIFIED) | A thin promise wrapper that keeps **explicit transaction control**, which the atomic-import requirement needs. Dexie also works but hides transactions more. |
| CSV parser | **csv-parse** (adaltas/node-csv), browser ESM build | MIT (VERIFIED) | 7.0.3 (VERIFIED) | Strict mode and per-record error reporting. Explicit `delimiter`, `quote`, `record_delimiter`, `bom` and `relax_*` options suit frozen, replayable parse configurations. **Alternative:** PapaParse 5.7.0 (MIT, last release Jan 2025, VERIFIED). It is mature, but its default auto-detection of delimiter and newline must be disabled, and its error model is looser. In both cases, decode the bytes yourself with `TextDecoder('utf-8', {fatal:true})` so invalid UTF-8 is rejected rather than replaced. |
| Decimal math | **big.js** | MIT | 7.0.1 (VERIFIED, Apr 2025) | Small, and supports `ROUND_HALF_UP` (`RM=1`) with a fixed division scale (`DP=3`), which is exactly `volume_ratio_v1`. Use an isolated `Big()` factory so global settings never leak. **Alternative:** decimal.js 10.6.0 (MIT, Jul 2025, VERIFIED) if more functions are needed later. |
| RFC 8785 JCS | **canonicalize** (erdtman) | Apache-2.0 (VERIFIED) | 5.1.0, published 2026-09-18 (VERIFIED) | Written by an RFC 8785 co-author. It is small, and **pinning an exact version is required** because JCS output feeds a stored hash. Because the envelope stores metric values as strings, number-formatting edge cases are mostly avoided. |
| JSON Schema 2020-12 | **Ajv v8 in *standalone* (build-time precompiled) mode**, using `ajv/dist/2020` | MIT | 8.20.0 (VERIFIED) | **Important:** by default Ajv compiles with `new Function`, which requires CSP `'unsafe-eval'` (VERIFIED, Ajv security docs). That conflicts with the brief's restrictive CSP. Standalone generation at build time avoids it. **Alternative:** `@cfworker/json-schema` 4.1.1 (MIT, VERIFIED). It supports 2020-12 and needs no eval, but has a smaller ecosystem. |
| SHA-256 / UUID | Web Crypto `crypto.subtle.digest`, `crypto.randomUUID()` | built in | — | No dependency needed. |
| Base64 | Native `Uint8Array.toBase64/fromBase64`, with a small fallback | built in | Baseline 2025 (VERIFIED, MDN) | Keep a tested fallback for the "previous major version" browsers in the matrix. |
| Backup archive | **fflate** (if ZIP is used) | MIT | not checked | Streaming and small, and allows size, ratio and entry-count checks. **Or avoid ZIP entirely:** a single JSON backup file (manifest plus envelopes) removes the decompression-bomb and zip-slip risks (see Decision D5). |
| Service worker | Hand-written SW with a build-generated precache allowlist, or `vite-plugin-pwa` in `injectManifest` mode | MIT | not checked | The brief needs an allowlist-only cache and a user-prompted, deferred activation. A small custom SW is easier to audit than Workbox's generated SW. |
| Google auth | Google Identity Services token model (`accounts.google.com/gsi/client`) plus Drive REST via `fetch` | Google ToS | — | Avoids the older `gapi` client. See risk R7 on SRI. |
| Tests | Vitest, fast-check (property/fuzz tests), fake-indexeddb, Playwright (end-to-end and cross-tab), axe-core | MIT / MIT / Apache-2.0 / Apache-2.0 / **MPL-2.0** | not checked | axe-core's MPL-2.0 licence is fine for a dev-only dependency. Note it in the licence review. |
| Lint/format | ESLint + typescript-eslint, Prettier | MIT | not checked | A custom lint rule (or `no-restricted-syntax`) can enforce "sync state is only assigned inside the state-machine function". |

---

## 3. Hosting options (static HTTPS PWA)

Google's rules for Authorized JavaScript origins (VERIFIED, Google OAuth docs):
- HTTPS is required, except for `localhost`.
- **No wildcards.**
- No path, query or fragment.

This means preview-deploy URLs such as `abc123.project.pages.dev` cannot be authorized collectively. Only a fixed production origin plus `http://localhost:<port>` should be registered.

| Option | Pros | Cons | Cost (personal use) |
|---|---|---|---|
| **A. Cloudflare Pages** (recommended) | Custom headers via a `_headers` file, so a real CSP and COOP header can be set, and these apply on `pages.dev` (VERIFIED). Works with a **private** GitHub repo. Stable `<project>.pages.dev` origin, or a custom domain. | Each preview deploy gets its own origin. Keep OAuth to the production origin only. | Free tier is ample for this app (NOT VERIFIED current limits) |
| **B. Netlify** | Custom headers (`_headers` / `netlify.toml`). Works with a private repo. Stable `<site>.netlify.app` origin. | The Free plan is now credit-based ("300 credit limit", VERIFIED). What happens at the limit is not documented on the pricing page (NOT VERIFIED). Same preview-origin caveat. | Free, credit-capped |
| **C. GitHub Pages** | Simple, stable `<user>.github.io/<repo>` origin | **GitHub Free only publishes Pages from *public* repos** (VERIFIED). It **cannot set HTTP headers**: CSP only via `<meta>`, no `frame-ancestors`, and no COOP header (NOT VERIFIED from docs this session). A project site shares the `<user>.github.io` origin with every other Pages site you own, so they share storage and OAuth origin. | Free (public repo), or a paid plan |

**Recommendation: Cloudflare Pages** with the fixed `*.pages.dev` production origin, or a custom domain if you own one.

**Origin-change policy to adopt:** IndexedDB data is **per-origin**, so changing the host or domain later means local data does not carry over. That is survivable only because Drive restore is required. The policy should be:
1. Sync everything on the old origin.
2. Add the new origin to the OAuth client.
3. Restore on the new origin from Drive, or from a portable backup.
4. Only then remove the old origin.

---

## 4. Google configuration steps (for you to perform; not performed here)

Current console naming is "Google Auth Platform", with Branding, Audience, Clients and Data Access pages. The exact labels may shift (NOT VERIFIED screen by screen).

1. **Create a Cloud project** in the Google Cloud Console with your personal account, for example `nifty200-screener`. There is no organization, so the user type will be External.
2. **Enable the Google Drive API:** APIs & Services → Library → "Google Drive API" → Enable.
3. **Google Auth Platform → Branding:** app name, support email, developer contact email.
   - Skip the logo. Uploading a logo can trigger brand verification.
   - The app home page, privacy and terms URLs are optional in Testing.
4. **Audience:** set User type to **External** and Publishing status to **Testing**. Add **yourself** (plus any second Google test account you'll use for the account-switch test) under **Test users**. The limit is 100 test users (VERIFIED).
5. **Data Access (scopes):** add only `https://www.googleapis.com/auth/drive.file`. It is classed as **non-sensitive** (VERIFIED). Do not add `drive`, `drive.appdata`, or `drive.readonly`.
   - Whether to also add `openid`/`email` for displaying the email is Decision D8. The brief binds the account via `about.get` → `user.permissionId`, which `drive.file` should allow (NOT VERIFIED; confirm in the smoke test).
6. **Clients → Create OAuth client → Web application:**
   - **Authorized JavaScript origins:** `http://localhost:5173` (or the chosen dev port) and the production origin, for example `https://<project>.pages.dev`.
   - **No redirect URIs are needed** for the GIS token model.
   - **There is no client secret to use.** The browser uses only the client ID, which is public. Never download or commit the client-secret JSON.
7. Give me **only the client ID**. It is public configuration and safe to put in source.
8. **After the build exists**, run the live smoke tests from the brief's gates:
   - drive.file visibility across two devices
   - re-consent after expiry
   - account switch (permissionId mismatch)
   - moved and trashed files
   - 409 on a reused ID

---

## 5. Recommended v1 browser support matrix

| Browser | Status |
|---|---|
| Chrome desktop (Windows), current and previous major | **Supported, tested** |
| Edge desktop (Windows), current and previous major | **Supported, tested** |
| Chrome Android, current | **Supported, tested** (installable PWA), if you want mobile. See Decision D6. |
| Firefox desktop | **Untested / unsupported** in v1. It is likely to work, but it cannot install PWAs on desktop (NOT VERIFIED). Label it in the UI. |
| Safari macOS / iOS (including iOS PWA) | **Explicitly labelled unsupported/untested** in v1. There are known risks around storage eviction for non-installed sites and differences in popup-based OAuth (NOT VERIFIED). |

Record exact version numbers at test time. I have not stated current Chrome or Edge version numbers because I did not verify them.

Every recommended engine supports the features the brief relies on: Web Locks, BroadcastChannel, `navigator.storage.persist`, `crypto.randomUUID` and Service Workers (NOT VERIFIED per version this session). The "Web Locks unavailable" fallback will therefore rarely run, but it should still be unit-tested.

---

## 6. Risks and conflicts

| # | Finding | Status | Impact / proposed handling |
|---|---|---|---|
| R1 | **Testing-mode consent expires every 7 days.** Google's docs: "Authorizations by a test user will expire seven days from the time of consent." | **VERIFIED** (Google Cloud Help) | With External/Testing as the brief requires, you will see the full consent screen roughly weekly. That is acceptable (tokens are memory-only anyway) but should be documented. **Unknown:** whether `drive.file` access to previously created files survives re-consent. This must be confirmed in the live test (brief gate). **Alternative:** publish "In production" with only the non-sensitive `drive.file` scope, which typically needs no verification and has no 7-day expiry (NOT VERIFIED for your project; Decision D7). |
| R2 | **Ajv's default mode requires CSP `'unsafe-eval'`**, which conflicts with the brief's "restrictive CSP" | **VERIFIED** (Ajv docs) | Use Ajv standalone (precompiled at build time) or `@cfworker/json-schema`. |
| R3 | **GIS popup flow needs the COOP header `same-origin-allow-popups`** (not `same-origin`), plus CSP allowances for `accounts.google.com/gsi/*` in `script-src`, `frame-src`, `connect-src` and `style-src` | **VERIFIED** (GIS setup docs) | The CSP must include these, plus `connect-src https://www.googleapis.com` for Drive (NOT VERIFIED: the upload host may need `www.googleapis.com/upload`, which is the same origin). Header-less hosting (GitHub Pages) cannot set COOP. |
| R4 | **Drive's 409 on a reused pre-generated ID is documented**, including that folder IDs can be pre-generated | **VERIFIED** (Drive create-file and manage-uploads guides). The brief is consistent. | None needed. Note that the general error-handling page does *not* list 409. Handle it explicitly as the brief says. |
| R5 | **The resumable session URI works without an auth header and lasts up to one week** | **VERIFIED** (Drive uploads guide) | Confirms the brief's rule that session URIs are sensitive capability URLs and belong in memory only. |
| R6 | **"Invalid page token" 400 has no distinct documented reason code** | **VERIFIED** (not listed in the Drive error guide) | The implementation must treat *any* 400 on a paginated call that carried a `pageToken` as a candidate for the single restart the brief allows. Confirm the real error body in the live test. |
| R7 | **SRI cannot be applied to the GIS script.** Google serves `gsi/client` unversioned and changes it silently. | NOT VERIFIED (widely known; not checked in current docs) | The brief's "Subresource/CSP controls for externally-loaded scripts" can only be met by the CSP allowlist for this script, not SRI. Document this as an accepted exception. |
| R8 | **The brief's 404 rule (tell "inaccessible", "trashed" and "permanently missing" apart) can only partly be met.** With `drive.file`, a file the app can no longer see and a deleted file are both expected to return 404. Trashed files are expected to still return 200 with `trashed=true`. | NOT VERIFIED | The brief already says "where the API allows". Expect two outcomes: trashed (restorable) versus not found (unknown whether deleted or inaccessible). Confirm live. |
| R9 | **`files.list` may include trashed files by default.** The docs checked do not state the default. | NOT VERIFIED | Always state `trashed` explicitly in queries. Decide whether reconciliation searches trashed files, which is needed for "Restore = untrash". |
| R10 | **drive.file scope boundaries.** A file you re-upload through the Drive web UI (for example a manually restored envelope) is *not* visible to the app unless it is opened through a picker. Files created by the app should be visible from any device using the same OAuth client. | NOT VERIFIED (docs confirm the scope is per-file and app-created; cross-device behaviour needs the live test) | This is covered by the brief's gate on live `drive.file` scope behavior. A Google Picker import could be a later feature; it is out of scope now. |
| R11 | **`appProperties` limits:** 30 private properties per file per app, **124 bytes per key+value (UTF-8)** | **VERIFIED** (Drive properties guide) | A 64-character SHA-256 plus key (for example `src_sha256`, 10 chars) is 74 B and fits. The UUID `run_id` fits. Keep keys short. Search syntax `appProperties has { key='k' and value='v' }` is VERIFIED. |
| R12 | **The brief says "Day Volume", but the actual header is `Day Vol ` with a trailing space.** Several headers have trailing or double internal spaces. | **VERIFIED** (sample) | This is not a conflict, but it needs an explicit alias list and a whitespace-normalization rule for matching (Decision D3). |
| R13 | **Grouping-comma support in the brief has no evidence in the sample.** Values are written as `2386852`. | **VERIFIED** (sample) | Recommend the strict grammar with no commas until a real export shows them. Accepting unseen formats weakens "never guess" (Decision D2). |
| R14 | **Blank or placeholder numeric cells are not observed**, so the `MISSING_*` reason paths cannot be confirmed from real data | **VERIFIED** (sample) | They need a second export, or synthetic fixtures clearly labelled as synthetic. |
| R15 | **The filename date is a Sunday** | **VERIFIED** | Supports the brief's user-confirmed `effective_date`. Pre-filling it from the filename would be wrong. |
| R16 | **Your global preferences conflict with parts of the brief.** They specify an "index.html / css/styles.css / js/app.js" structure and a "gold foil, glassmorphism" style. The brief requires a TypeScript build and WCAG 2.2 AA contrast. | VERIFIED (both documents read) | A Vite build outputs bundled, hashed files rather than that literal structure. Glassmorphism (translucent text over blurred backgrounds) often fails AA contrast unless it is backed by solid surfaces under text. Needs your call (Decision D1). |
| R17 | **Envelope size is roughly 2.5× the CSV** (Base64 is about 1.33×, plus parsed cells) | VERIFIED (arithmetic) | Trivial at real sizes (tens of KB). This only matters if the 10 MiB limit is kept (Decision D4). |
| R18 | **The `canonicalize` package had a new release on 2026-09-18** | VERIFIED (npm) | Pin the exact version. Include golden JCS test vectors (for example from RFC 8785 Appendix B) so a future upgrade cannot silently change hashes. |
| R19 | **`md5Checksum` / `version` fields** are expected to be present for binary (non-Google-Docs) files, including uploaded JSON | NOT VERIFIED | Confirm in the smoke test. The brief's change detection depends on them. |
| R20 | **Persistent storage on Chrome is granted by heuristics, not a prompt** (installed PWA or high engagement). A fresh, uninstalled site will often get `false`. | NOT VERIFIED | The brief's warning path will be common. That is by design, but expect it. |

---

## 7. Decisions needed from you

- **D1. UI stack and styling.**
  - Stack: Svelte 5 + Vite + TS (recommended), or vanilla TS + Vite (closer to your global file-structure preference).
  - Styling: may the "gold foil / glassmorphism" style be applied only where it doesn't compromise WCAG AA contrast, meaning solid surfaces behind all text and tables?
- **D2. Numeric grammar.** Freeze v1 to `^-?(0|[1-9][0-9]*)(\.[0-9]+)?$` (what the sample shows), rejecting grouping commas? Or also accept Western and Indian grouping commas as the brief currently allows, without real evidence?
- **D3. Header matching rule and aliases.**
  - Normalize by trimming, collapsing internal whitespace runs to one space, and ASCII-lowercasing?
  - Approve the aliases `day vol` → Day Volume and `consolidated 30d average end of day vol` → 30-day average volume?
  - Treat `BSE Code` as informational only?
- **D4. Import limits.** Keep the brief's 10 MiB / 1,000 rows / 500 columns / 256 KiB, or tighten to about 2 MiB / 1,000 / 200 / 4 KiB?
- **D5. Backup format.** Use a single JSON file (no ZIP, which removes decompression-bomb and zip-slip handling), or a ZIP with the limits in the brief?
- **D6. Mobile.** Include Android Chrome (installable) in the tested v1 matrix? Is Safari/iOS explicitly unsupported in v1?
- **D7. OAuth publishing status.** Stay External/**Testing** as the brief says (weekly re-consent), or plan to move to "In production" with only `drive.file` later?
- **D8. Account display.** Is `drive.file` plus Drive `about.get` (permissionId, and email if returned) sufficient, or do you want `openid email` scopes added?
- **D9. Hosting.** Cloudflare Pages (recommended), Netlify, or GitHub Pages (public repo required on Free)? Use the default `*.pages.dev` origin or a custom domain?
- **D10. Second CSV sample.** Will you provide a second, larger export covering the §1.8 checklist before the importer grammar is frozen? Or should v1 proceed on this one sample plus synthetic fixtures clearly labelled as synthetic?
- **D11. CSV parser.** Use csv-parse (recommended, stricter) or PapaParse?
- **D12. JSON Schema validator.** Use precompiled Ajv standalone (recommended) or `@cfworker/json-schema`?

---

## 8. What was and was not done

- **Read:** the brief (in full) and the sample CSV. The sample was analysed with read-only Python in the shell.
- **Checked online (read-only):** npm registry metadata; Google Drive, OAuth, GIS and Cloud Help docs; Ajv, Cloudflare, GitHub, Netlify and MDN docs.
- **Not done:**
  - No code, packages, config, or git.
  - No Google sign-in or Cloud configuration.
  - No access to `D:\Swing Trading`.
- **Still untested or unknown:**
  - All live `drive.file` behaviour (R1, R8 to R10, R19)
  - Blank-cell and grouping-comma formats (R13, R14)
  - Current exact browser versions
  - Hosting free-tier limits
