# Nifty 200 Screener PWA — Project Brief (v8, requirements-complete, pending pre-implementation gates)

## Purpose
A standalone, personal Progressive Web App to import, store, and compare Trendlyne swing-trading screener exports over time. This is a **new, independent project** — it does not touch, depend on, or share data with the existing `D:\Swing Trading` trading system. Do not read from, write to, or reference that project's database, schema, or code.

## Location
Create this project at: `D:\Nifty200 Screener PWA`

Before writing any code, check whether this folder already exists and what it currently contains. If it already has content, stop and report back rather than overwriting anything.

## Scope: v1

### Core flow
1. User exports a CSV from Trendlyne's custom screener (Nifty 200 universe only).
2. User imports that CSV via a preview-and-confirm screen (show parsed rows before committing, let user cancel; cancelling leaves storage completely unchanged).
3. On confirmed import, the app stores it as an **immutable "run" record** — content is never edited after creation. In-app deletion is not supported in v1 (see "Data lifecycle"). **This commit must be atomic** (see "Atomic import transaction" under Engineering Standards below) — preview parsing may use memory freely, but nothing is written to application storage until the user confirms, and the confirmed write either fully succeeds or leaves no partial trace.
4. The app auto-computes derived fields on import (see "Computed fields").
5. User can view a list of past runs and a side-by-side comparison view across runs.

### Universe
- Accept **Nifty 200 CSV exports only** for v1.
- The app cannot technically verify a CSV's source universe. At import, the user must explicitly attest the export came from Nifty 200. Store `universe: "Nifty 200"` and `universe_validation: "user_confirmed"`. Never infer universe from filename, row count, or current index membership.
- Every run record MUST store: `universe`, `universe_validation`, and `effective_date` (ISO `YYYY-MM-DD`, India-market calendar date, user-confirmed at import — never trusted from filename or file-modified date).
- Optional free-text field for the screener query used — encourage filling it in, don't block import if blank.

### Stock identity across runs
- **Match securities primarily by ISIN** (the identifier for a specific security — not treated as permanent across mergers, reorganizations, or replacement securities; a changed ISIN is a distinct security unless a future manually-reviewed aliasing feature is added), with **NSE Code as a fallback** for cases where ISIN is missing. Never match by company name alone.
- **Preserve raw identifiers separately from normalized comparison values — never mutate the raw cell.** Each stock identity record stores:
  - `raw_isin`: exactly as it appeared in the source CSV
  - `normalized_isin`: trimmed, uppercase ASCII, with structure/check-digit validated
  - `isin_validation`: result of that validation
  - `raw_nse_code`: exactly as it appeared in the source CSV
  - `normalized_nse_code`: normalized per a documented trimmed/case-normalized rule, confirmed against a real sample
  - `match_method`: `isin` or `nse_code_provisional`
  - `identity_warnings`: any issues found (e.g., failed check digit, ambiguous match)
- Invalid identifiers remain visible in the run but are never silently auto-repaired.
- Explicit matching rules:
  - Same ISIN, changed NSE Code → same security; retain both symbols in that security's history.
  - Same NSE Code, different ISIN → conflict; do not auto-merge, surface for review.
  - Missing ISIN but matching NSE Code → allow provisional comparison, labeled `nse_code_provisional`.
  - Neither identifier present → exclude the row from longitudinal comparison, but still preserve it in the raw run data.
  - **NSE-Code-only matches remain permanently labeled `nse_code_provisional` in v1.** v1 does **not** retroactively upgrade or alias historical identity records — even when a later run supplies a matching ISIN for what appears to be the same security. This is a deliberate scope boundary: an upgrade/aliasing mechanism would require its own audit-event schema and cross-device sync format, and mutating historical identity classifications could conflict with the run-immutability principle. A future aliasing feature, if built, must store separate, immutable, synchronized identity-resolution records and must never rewrite historical run envelopes.
- Verify against a real Nifty 200 CSV sample that both `NSE Code` and `ISIN` columns are consistently present before finalizing importer logic.

### Immutable run schema & Drive file format
Each run is stored as **one versioned JSON envelope** (both locally in IndexedDB and as the corresponding Drive file), containing:
- `run_id`: generated UUID (never derived from date; two same-date runs remain distinct)
- `schema_version`
- `universe`, `universe_validation`, `effective_date` (see above)
- `imported_at`: UTC timestamp
- `original_filename`, byte length, MIME type
- `original_file_sha256`: hash of the original file
- **Original CSV bytes, encoded losslessly as Base64** — preserves exact quoting, encoding, delimiters, and line endings
- **Parsed logical cell values** (decoded strings, not raw CSV token syntax) preserving original header order
- Import warnings and parser version
- Run-level stock count
- Optional screener query text
- Computed metrics (see below), stored separately from raw/parsed data — never blended into or overwriting it

A downloaded/imported run is accepted only if its schema validates **and** the decoded original bytes reproduce the stored `original_file_sha256`. Unknown future schema versions must be preserved (not discarded) but not silently imported/interpreted.

**Whole-envelope integrity (not just the raw CSV):** `original_file_sha256` only proves the embedded raw CSV bytes are intact — it says nothing about accidental corruption or uncoordinated modification of metadata, parsed cells, or computed metrics stored alongside them (note: a hash stored inside the same unsigned file provides integrity checking, not cryptographic authenticity — anyone able to modify the envelope can also recompute the hash; true tamper-proofing would need a separate signing key, out of scope for this personal v1). Additionally compute `envelope_sha256` over the UTF-8 bytes of the envelope serialized with the **RFC 8785 JSON Canonicalization Scheme (JCS)**, excluding only the top-level `envelope_sha256` field itself, and store `envelope_hash_algorithm: "sha256-jcs-rfc8785-v1"` alongside it. This is required (not just "canonical serialization" left to the implementer) because different JSON serializers can otherwise produce different property order, number formatting, or escaping for logically identical data, silently breaking hash comparison. Envelope values must conform to JCS's I-JSON restrictions: no duplicate object keys, no non-finite numbers, and any integer outside the safely-representable range stored as a string rather than a JSON number. After each upload, also store the Drive `file_id`, `version`, and `md5Checksum` in local sync metadata. Any change in the remote `version`/checksum must trigger a full re-download and full envelope validation — a changed remote file is never treated as unchanged just because it wasn't flagged by local state.

**Parser replay (internally consistent requirement):** store `parser_id`, `parser_version`, detected source encoding, BOM presence, delimiter, quote character, and any other parse configuration needed for deterministic replay. The app must retain validators for every parser/schema version it has ever written. On validation, reparse the preserved CSV bytes using the recorded parser version and confirm the parsed cells and computed metrics still match what's stored in the envelope — this must hold for every parser/schema version the app has produced, not just "where supported." A genuinely future/unrecognized schema version is stored opaquely with state `unsupported_schema` (see sync states below) — it is preserved, not treated as corrupt, and does not enter active views. A mismatch against a *known* parser version quarantines the run (state `quarantined`) rather than silently accepting it.

The Drive filename is informational only — `run_id` and Drive `appProperties` (see Sync section) establish identity, not the filename or folder name.

**Storage layout — resolving the uniqueness/conflict-preservation contradiction:** `run_id` must be unique within the app's canonical run store, but the app must also be able to preserve a divergent copy encountered during Drive reconciliation or backup import without violating that uniqueness. This is resolved with two separate stores:
- **`runs`** — the primary store, containing exactly **one canonical envelope per unique `run_id`** (enforced via an IndexedDB unique constraint on `run_id`).
- **`run_variants`** — a separate store for divergent candidates, keyed by the composite `[run_id, envelope_sha256]`, each tagged with its source (`remote`, `backup_import`, or `manual_recovery`).
- Variants in `run_variants` never enter active views or automatic upload — they exist purely for conflict inspection/resolution.
- A `conflict` state on a canonical run references that run plus every preserved variant for it.
- This same two-store model applies uniformly wherever "preserve both, don't overwrite" is required elsewhere in this document (Drive sync conflicts and backup-import conflicts alike).
- **`quarantine_items`** — a third store for malformed or untrusted inputs that cannot supply a validated `run_id` and `envelope_sha256`. Each item is keyed by a generated `quarantine_id` and preserves its original bytes, source (`drive`, `backup_import`, or `local_import`), discovery metadata, observed byte-level SHA-256, validation errors, and detection timestamp. Quarantine items never enter active views, identity indexes, duplicate-run logic, comparison calculations, or automatic upload.
- Boundary rule: a structurally valid canonical run that later fails deterministic replay may remain in `runs` with state `quarantined`; malformed objects that cannot satisfy the canonical schema belong in `quarantine_items`.

**Formal schemas and encodings:**
- Define each known run-envelope and backup-manifest version using committed **JSON Schema Draft 2020-12** files. A known version must pass its exact schema plus semantic validation for hashes, row widths, identifiers, metric structures, and cross-field invariants. Unknown schema versions are preserved opaquely as `unsupported_schema`; they are never forced through the latest known schema.
- SHA-256 values: lowercase 64-character hexadecimal strings.
- Original CSV bytes: canonical RFC 4648 Base64, no whitespace.
- UTC timestamps: RFC 3339 strings ending in `Z`.
- `run_id` and `quarantine_id`: UUID v4 generated with `crypto.randomUUID()`.

**MIME type handling:** preserve the browser-supplied MIME type on the original file for provenance/record-keeping only — never trust it for validation. All content validation is based on actual bytes and parser rules, not the reported MIME type.

### Duplicate detection (v1, simplified)
- Warn the user when an import's `original_file_sha256` already exists locally.
- **Do not** attempt semantic or normalized-content duplicate detection in v1 — only exact-byte-hash matching.
- Files with different hashes remain independently importable even if their parsed contents look similar.
- After Drive reconciliation, if two different `run_id`s happen to share the same hash, treat this as a permitted duplicate (never auto-merge).

### Computed fields
- `Volume Ratio` = Day Volume ÷ Consolidated 30-day average end-of-day volume.
- **Numeric parsing (strict, documented grammar — never guess a locale):**
  - Accept only: ASCII digits, an optional leading sign, a decimal point, and standard or Indian-style digit-grouping commas — confirm the exact accepted grammar against a real representative Trendlyne export before finalizing.
  - Reject anything ambiguous or malformed with a reason code; never guess whether a comma is a decimal or thousands separator.
  - Reason codes: `MISSING_NUMERATOR`, `MISSING_DENOMINATOR`, `INVALID_NUMERATOR`, `INVALID_DENOMINATOR`, `NEGATIVE_NUMERATOR`, `NON_POSITIVE_DENOMINATOR`.
  - On any of the above invalid cases, store the metric as invalid with the reason code — never crash, never guess.
  - **Explicit zero/negative/sign handling:** a zero numerator with a positive denominator is a *valid* result (a stock with genuinely zero volume today against a positive average is meaningful data, not an error). A negative numerator is invalid with reason `NEGATIVE_NUMERATOR`. A zero or negative denominator is invalid with reason `NON_POSITIVE_DENOMINATOR`.
  - **Decimal representation (required — do not rely on binary floating-point):** parse valid inputs using decimal arithmetic (not native binary floating-point division, which can produce inconsistent boundary rounding, e.g. around values like 1.2345), and round using `ROUND_HALF_UP` to a fixed scale of 3 decimal places.
    - Store a valid metric as: `{ "status": "valid", "value": "0.000", "scale": 3, "metric_version": "volume_ratio_v1" }` — note `value` is a **string**, not a JSON number, because a JSON number cannot preserve trailing-zero display precision (the number `0` does not encode `"0.000"`).
    - Store an invalid metric as: `{ "status": "invalid", "value": null, "reason": "<CODE>", "metric_version": "volume_ratio_v1" }`.
    - Sort valid decimal-string values using a decimal-number comparator, never lexicographic string comparison.
    - `ROUND_HALF_UP` at scale 3 is fixed for `volume_ratio_v1`. Any future rounding change requires a new metric version, never a silent change to `volume_ratio_v1`.
  - Tag every computed value with its `metric_version` (e.g., `"volume_ratio_v1"`) so future formula changes never silently reinterpret old data.
- Design computed-metrics storage (e.g., a flexible key-value/JSON structure) so new metrics can be added later without a schema rewrite — but every metric must carry its own version identifier regardless of storage flexibility.

### Views
1. **Run list** — chronological list of past runs (date, universe, stock count). **Default sort order is deterministic:** by `effective_date` descending, then `imported_at` descending, then `run_id` as a final tiebreaker — state this ordering explicitly in the UI rather than leaving default sort ambiguous. Click into one for its full stock table. **Every column is sortable using its declared/detected type**: numeric columns (e.g., Volume Ratio, Day RSI, LTP) use numeric ordering, textual columns (e.g., Stock Name) use case-insensitive textual ordering, dates use chronological ordering, and missing/invalid values sort last. Volume Ratio specifically must always use numeric ordering (e.g., "10" sorts after "9", never lexicographically between "1" and "2").
2. **Comparison view** — pick a stock (matched by ISIN/NSE Code, per rules above) and show its appearance and metrics across multiple past runs. A stock's absence from a given run must be shown explicitly, not as blank/zero.

## Data storage & sync architecture

### Local storage
- IndexedDB is the local operational store and pending-upload queue. Every import gets a permanent `run_id` locally regardless of Drive sync status.
- **Complete sync-state model (every state used anywhere in this document must appear here — no state is introduced ad hoc in prose):**
  - `pending`: local run has not yet been uploaded
  - `syncing`: upload or verification is actively in progress
  - `synced`: local and remote envelopes match and are verified
  - `error`: a run-specific operation failed. Carries diagnostic metadata `retryable: boolean` plus a stable error code — permission/validation failures are typically non-retryable, transient network/quota failures are typically retryable.
  - `remote_missing`: a previously-synced remote file is now absent
  - `local_only`: user explicitly chose "Keep local only" for this run
  - `conflict`: same `run_id`, but local and remote envelopes have diverged and both validate independently
  - `quarantined`: envelope is malformed, corrupted, or internally inconsistent (e.g., failed reparse verification)
  - `unsupported_schema`: structurally preserved but not interpreted by this app version (e.g., a future schema version)
  - **A user cancellation restores the run to its previous stable state — it never leaves a run stuck in `syncing`.** An interrupted-but-unsynced run returns to `pending`; an already-`synced` run stays `synced` (an auth failure alone doesn't prove the remote content actually diverged).
- **Runs in `conflict`, `quarantined`, or `unsupported_schema` state must not participate in comparison views or automatic upload until resolved.** They may still be exported for inspection.
- **`orphaned_remote` is a diagnostic attribute on a discovered file, not a run sync state** — see "New-device / restore-from-Drive behavior" below.

### OAuth / authorization state (separate from run sync state)
Authorization is an **account-level** concern, independent of any individual run's sync state — a Drive `401` means the app's authorization has expired, not that a specific run's data has diverged, so it must never be conflated with the per-run states above.
- Allowed OAuth states: `disconnected`, `authorizing`, `connected`, `reconnect_required`.
- A Drive `401` response sets the global OAuth state to `reconnect_required` — it does **not** introduce or touch any run's sync state.
- While in `reconnect_required`, runs that were `pending` remain `pending`; runs that were already `synced` remain `synced` until an actual content check proves otherwise.

### Google Drive sync
- **Architecture constraint:** a pure client-side PWA cannot securely hold a refresh token for silent background sync — that requires a backend, out of scope for v1.
- Use **Google Identity Services' browser token model**. Keep access tokens in memory only — never persist tokens in IndexedDB, localStorage, application files, Drive, or the service worker cache.
- When authorization expires or hasn't happened yet, preserve all pending local work and show an explicit **"Reconnect Google Drive"** action.
- **Storage location:** a **visible, app-created Google Drive folder**, using the narrow **`drive.file`** scope (not `appDataFolder`, and not broad whole-Drive access).
- **Identity tagging:** tag the app folder and every run file with private Drive `appProperties` — an application identifier, `run_id`, `schema_version`, and `original_file_sha256`. Use `appProperties` search (not folder/file naming) to reliably locate the app's data, since a user could rename the visible folder.
- **`appProperties` are discovery hints only, never trusted content.** After downloading a candidate file, always derive the authoritative `run_id`, schema version, and hashes from the validated envelope itself. If `appProperties` disagree with the envelope's own content, quarantine the file (state `quarantined`) and report a metadata conflict — never reclassify or trust envelope content based on `appProperties` alone.
- The app folder itself should also be created using a persisted pre-generated Drive file ID (via `files.generateIds`), so that an indeterminate folder-creation retry cannot silently produce a second folder — same idempotency mechanism as individual run uploads.

### Multi-device sync semantics (v1, explicit)
- Multiple devices may independently import and append runs.
- Reconciliation downloads the union of valid run files (identified by `run_id`) — it **never overwrites** an existing run.
- Concurrent deletion is out of scope (no in-app deletion exists in v1 at all — see below).
- Sync operations must be idempotent: retrying never creates a duplicate Drive entry for the same `run_id`.
- **Idempotency mechanism (required, not just a stated property):** before a run's first upload attempt, request a pre-generated Drive file ID and persist it in that run's local sync metadata. Every retry for that run reuses the same Drive file ID. A `409 Conflict` response means the file may already exist and must be retrieved and verified — never treated as license to upload again under a new ID. **Resumable-upload session URIs are sensitive capability URLs, not harmless metadata — keep them in memory only, never in IndexedDB, Cache Storage, logs, archives, or Drive.** If the page stays open, query the in-memory session after an interruption. If the page reloads and the in-memory URI is lost, fall back to the persisted pre-generated Drive file ID: verify the file if it exists, or initiate a fresh resumable session under that same pre-generated file ID if it doesn't.
- Store each run as an independent file (one-file-per-run, append-only) — never one large mutable manifest.

### New-device / restore-from-Drive behavior
- After authorizing on a new device, or after local storage loss, reconciliation performs **two fully-paginated searches**, not one: (1) every tagged application folder, and (2) a **global search for every tagged run file accessible to this app, regardless of parent folder** — because a user could move an individual run file outside its folder while its `appProperties` tag stays intact, which a folder-scoped-only search would miss entirely.
- Download every discovered valid run file, verify each one's schema and both hashes (`original_file_sha256` and `envelope_sha256`), and reconstruct IndexedDB from them.
- A tagged run file found outside any recognized app folder is classified with the diagnostic attribute `orphaned_remote` (not a sync state — see Local Storage section) — it remains discoverable and readable regardless. Folder membership only determines the *preferred organization and upload destination*, never whether a valid tagged run is considered to exist.
- Any pending local runs already present at that point must be preserved and merged with downloaded runs by `run_id` (never overwritten by the restore).

### Duplicate application folders (race condition to handle explicitly)
Two fresh devices can each search for the app's tagged folder, both find none, and each create their own separate correctly-tagged folder — `appProperties` support discovery, not uniqueness. Handle this explicitly:
- Reconciliation must search for **every** folder carrying this application's folder tag, not just the first match.
- If multiple matching folders are found, scan the union of run files across all of them, and surface a folder conflict to the user rather than silently deleting, merging, or moving any folder.
- After the user selects one folder as the active upload destination, continue reading valid runs from the other(s) as well, rather than ignoring them.

### Data lifecycle (v1, explicit — no ambiguity)
- **In-app run deletion is not supported in v1.** State this plainly in the UI rather than leaving it undefined.
- The user can still manually delete or modify the visible Drive file outside the app. Handle this case explicitly:
  - If a previously-synced local run is missing from Drive on next sync check → mark it `remote_missing` and offer **"Restore to Drive"** or **"Keep local only."** Never auto-re-upload silently.
    - **"Restore to Drive" file-ID lifecycle:** if the Drive file was only trashed and is still accessible, restore untrashes and re-verifies the existing file (reusing its existing Drive file ID). If the file has been permanently deleted and no longer exists, restore is a **recovery operation, not a retry**: obtain and persist a *new* pre-generated Drive file ID, then upload the same immutable local envelope under that new Drive identity. The `run_id` and envelope content remain unchanged either way.
    - **"Keep local only"** transitions the run to `local_only` state and suppresses future missing-remote prompts for that run unless the user explicitly re-requests sync later.
  - If a remote file with a known `run_id` has changed content → **do not overwrite either copy.** Preserve the existing canonical envelope in the primary `runs` store (see schema note below), store the divergent remote candidate as a variant, and set the canonical run's state to `conflict`. Resolution options available to the user: export both copies for inspection, or retain the canonical local run as `local_only`. **The app never overwrites externally-modified remote content in v1** — restoring or replacing the disputed Drive file is outside v1 scope and must be done manually outside the app. The app must never modify the immutable local run envelope during this process.
  - Note: on a completely fresh device with no prior local record of a run, a deleted-from-Drive run is undetectable — the "detect missing" behavior above only applies to a device that previously synced that specific run.
- **Portable backup export and preview-and-confirm restoration are both required v1 features — not optional, and not an export-only fallback.** The portable archive contains a versioned manifest plus the immutable run envelopes; it must exclude OAuth credentials, Drive file IDs, resumable-session URLs, sync states, and any other device-specific metadata (these are not portable across devices/accounts and should not be baked into a backup file). Import is preview-and-confirm, and handles collisions explicitly:
  - New `run_id` → validate and add as `pending`.
  - Existing `run_id` with identical `envelope_sha256` → no-op, report "already present."
  - Existing `run_id` with a *different* `envelope_sha256` → preserve the existing canonical envelope in `runs`, store the divergent import candidate in `run_variants` (source `backup_import`), and mark the canonical run `conflict`. Never overwrite either envelope.
  - Different `run_id` sharing the same `original_file_sha256` → warn, but allow as a permitted duplicate (same rule as ordinary duplicate detection above).
  - If the device is authenticated at import time, reconcile imported runs against Drive before uploading — if an equivalent valid run already exists remotely, link to it rather than creating a second Drive file.
  - If the archive format is ZIP or similar, enforce documented limits on archive size, file count, decompression ratio, and nesting depth, to prevent decompression-bomb or oversized-archive imports.
- Do not describe Drive sync as a "backup" unless historical recovery from it has actually been implemented and tested.

### Local storage durability
- Request **persistent browser storage** (via the Storage API) when supported, to reduce the risk of the browser evicting IndexedDB data under storage pressure.
- If persistence is denied by the browser, show a non-blocking warning naming the count of unsynchronized (`pending`) runs that remain vulnerable to storage clearing until they sync to Drive.

## Hosting & Google configuration (decide before implementation)
- Production hosting provider and final origin/URL
- Google Cloud project ownership
- **OAuth consent screen: `External / Testing`** for a personal Google account (`Internal` is only available under an eligible Google Workspace organization — not applicable here unless confirmed otherwise)
- Authorized JavaScript origins for local development and production
- Drive API enablement and exact scope requested (`drive.file`)
- Policy for what happens if the hosting origin changes later

## Security & import handling
- Render all imported CSV values as plain text — never as HTML.
- Apply a restrictive Content Security Policy.
- Validate file encoding/structure before parsing; reject files above a documented size/row limit with a clear error.
- Surface duplicate or malformed stock identifiers rather than silently dropping/merging them.
- If data is ever re-exported as CSV, neutralize spreadsheet-formula injection (leading `=`, `+`, `-`, `@`) in the export only, without altering the originally preserved values.
- The service worker must exclude OAuth responses, any Drive API response containing authorization/token data, and access tokens from all persistent caches.

## Engineering Standards (required for v1, not optional hardening)

### Atomic import transaction
A confirmed import commits the immutable envelope, derived indexes, duplicate-hash index, comparison identity index, and initial sync state in **one IndexedDB transaction**. If any write fails, the entire transaction aborts and no partial run remains. A successfully committed `run_id` must be enforced unique via an IndexedDB unique constraint. Generate IDs with `crypto.randomUUID()`; on the extremely unlikely event of a local collision, generate another before committing. Derived indexes are disposable caches — they may be rebuilt from validated immutable envelopes at any time and must never become the sole copy of any information.

### Duplicate/blank CSV headers
Rows must **never** be stored as objects keyed only by header name, since a CSV can contain duplicate or blank headers that would silently overwrite cells. Preserve headers as an ordered array and every row as an equally-ordered cell array; store a separate normalized column map for application use. Duplicate or blank headers remain preserved in raw parsed data but produce import warnings. If a required field (e.g., Day Volume) matches zero or more than one column after normalization, **block confirmation with an explicit ambiguity error** rather than guessing which column is meant. Normalize headers for matching purposes only (trim outer whitespace, documented case handling, approved aliases) — never modify the preserved header strings themselves.

### CSV parsing standard
Use a mature, maintained CSV parser — do not hand-roll CSV tokenization. Support quoted delimiters, escaped quotes, embedded newlines, CRLF/LF line endings, empty cells, trailing empty columns, and an optional UTF-8 BOM. Default to UTF-8; reject unsupported/invalid encodings rather than silently replacing undecodable bytes. Record parser identity, version, encoding, delimiter, quote character, newline style, and BOM presence in the envelope (this feeds the parser-replay requirement above). Treat RFC 4180 as the interoperability baseline, while accepting documented Trendlyne-specific deviations confirmed against the real sample — freeze the exact accepted behavior in test fixtures. Set explicit limits before implementation (starting recommendation: 10 MiB per CSV, 1,000 data rows, 500 columns, 256 KiB per decoded cell — adjust only if the real sample proves these insufficient), and enforce limit violations **before** committing any data.

### Google account binding
The app must prevent silently synchronizing local data into the wrong Google account. After authorization, retrieve the current Drive user and bind the local sync profile to the opaque Drive `permissionId` (not email, which may be unavailable or reused). Display the account email when available for the user's own reference, but never use it as the primary account key. If a later authorization returns a *different* `permissionId` than the bound profile, **block automatic synchronization** and require the user to either switch back to the original account, create a separate local profile, or explicitly start a reviewed migration. Never mix two Drive accounts within one sync profile. Do not include the account email in exported run envelopes unless the user explicitly requests it.

### Cross-tab concurrency
Two tabs open on the same device must not race on import, sync, Drive-folder creation, backup restoration, or database migration. Use an origin-scoped exclusive **Web Lock** for these operations — only the lock-holding tab drains the pending sync queue; other tabs remain usable for read-only viewing and receive state updates via `BroadcastChannel` (or equivalent). Never hold nested locks. If Web Locks are unavailable in a supported browser, disable concurrent sync entirely and show a single-active-tab warning rather than risking a race. Handle IndexedDB's `blocked` and `versionchange` events explicitly: an old tab must close its database connection and prompt for reload rather than indefinitely blocking a schema upgrade in another tab.

### Sync state machine discipline
Beyond the declared state set (`pending`, `syncing`, `synced`, `error`, `remote_missing`, `local_only`, `conflict`, `quarantined`, `unsupported_schema`): **every state transition must pass through one single state-machine function** — UI code may never assign a sync state directly. Each transition commits transactionally along with its diagnostic metadata: `last_attempt_at`, `last_success_at`, `attempt_count`, and a stable, non-sensitive error code. Never persist access tokens, resumable-session authorization headers, response bodies containing credentials, or raw Google error payloads that might contain sensitive request details. Runs in `conflict`, `quarantined`, or `unsupported_schema` are excluded from active comparison calculations and must be clearly labeled as such in the UI.

### Drive API contract standards
- **Pagination:** process every `files.list` page until `nextPageToken` is absent — never assume the first response contains all folders/runs. Request only the response fields actually needed. If a page token is rejected, restart that listing from the first page once (see the `400` rule below) without discarding already-validated local data.
- **Error handling policy:**
  - `400` → treat as permanent and do not retry, **except** when a paginated listing specifically reports an invalid/rejected page token. In that case, discard the token and restart that listing from its first page **once**. If the restarted listing fails again, stop and report.
  - `401` → sets global OAuth state to `reconnect_required` (see OAuth state section above) — never introduces or touches a run's sync state directly.
  - `403` → inspect the reason; quota/rate-limit errors may retry, permission errors must not.
  - `404` → distinguish inaccessible, trashed, and permanently-missing where the API allows.
  - `409` on a pre-generated ID → retrieve and verify the existing file, never re-upload under a new ID.
  - `429` and transient `5xx` → retry with bounded, truncated exponential backoff plus jitter.
  - Network timeout/offline → preserve the previous stable run state: an unsynced run returns to `pending`; a previously verified run remains `synced` with a diagnostic. Never convert every timed-out operation to `pending`. Retry only after connectivity returns or on explicit user action.
  - User cancellation → stop cleanly; never convert this into an error state.
- Cap automatic retry attempts — never retry indefinitely.
- Every Drive request needs an `AbortController` timeout.
- Only retry operations that are genuinely idempotent (via a persisted pre-generated ID, an existing file ID, or a resumable session) — never retry a non-idempotent operation blindly.

### Backup archive format (standardized)
A backup archive contains `manifest.json` plus the immutable envelope files. The manifest has its own schema version, creation timestamp, run count, an ordered run-ID list, and a SHA-256 for every included envelope. It contains **no** OAuth data, Drive file IDs, resumable-session URLs, account email, sync state, or other device-specific metadata — a backup must be portable across devices/accounts by design. Import behavior:
- New `run_id` → add as `pending`.
- Existing `run_id`, identical envelope hash → no-op.
- Existing `run_id`, different envelope hash → preserve the canonical envelope in `runs`, store the divergent entry in `run_variants` (source `backup_import`), mark canonical run `conflict`. Never overwrite either.
- Different `run_id`s sharing the same source-file hash → permitted duplicate, with a warning.
- Unsupported schema version → preserve as `unsupported_schema`.
- Corrupt entry → quarantine that entry only; don't abort the rest of the archive's import unless the manifest itself is invalid.
Preview must show counts of added / already-present / duplicate / conflict / unsupported / rejected entries before the user confirms import. Enforce compressed-size, uncompressed-size, entry-count, nesting-depth, and path-traversal protections on archive extraction (to prevent decompression-bomb or zip-slip style attacks). Include a `format_version` in both the archive filename and the manifest itself. Name archive entries from `run_id` only — never from the original CSV filename — to prevent unsafe paths and filename collisions inside the archive.

### Service worker update safety
The service worker caches **only** the versioned application shell and explicitly approved static assets — it must **never** cache Google OAuth endpoints, Google API responses, CSV uploads, backup archives, Drive run files, or any URL containing credentials. Use an allowlist, not a denylist, for what gets cached. A service worker update must not activate mid-way through an import, an IndexedDB migration, or a sync operation — show an "Update available" prompt and only activate once active transactions complete. Explicitly test an upgrade scenario with: an old tab still open, pending unsynchronized runs, an interrupted upload, an IndexedDB schema migration in progress, and offline startup immediately after the new service worker installs.

### Privacy boundaries
Run envelopes are stored as **readable, unencrypted JSON** in the user's visible Google Drive folder — protected only by ordinary Google account access controls, not end-to-end encrypted by this app. State this plainly in the UI so the user's expectations are accurate. Client-side encryption, passphrase recovery, key synchronization, and encrypted search are all out of scope for v1 unless separately designed and authorized. Never write filenames, stock data, query text, CSV cell values, tokens, or complete Drive API responses into analytics, crash reports, or console logs — production logging uses stable error codes and redacted structural metadata only.

### Dependency & build standards
- TypeScript strict mode.
- A checked-in package-manager lockfile, with exact direct-dependency versions.
- A reproducible production build.
- Documented lint, format, type-check, unit-test, integration-test, and build commands.
- No secrets or OAuth client secrets in source or build output (a public OAuth client ID is not a secret and may appear in source).
- A dependency license and vulnerability review before any release.
- No deprecated Google authentication libraries.
- Subresource/CSP controls for any externally-loaded scripts.
- Production source maps either excluded (if they'd expose sensitive source context) or published deliberately with documented rationale — not included by accident.
- A passing vulnerability scanner is evidence, not proof, of security — never claim more than the scan actually checked.

### Browser support & accessibility
Define the supported browser matrix explicitly before implementation. A reasonable Windows-first v1 baseline: current and previous major versions of desktop Chrome and Edge, plus current Android Chrome if mobile installability is wanted. Safari/iOS should be either explicitly tested or explicitly labeled unsupported/untested — not left ambiguous.

Target WCAG 2.2 AA-oriented behavior:
- Full keyboard operability
- Visible focus indicators
- Semantic labels and proper table headers
- Sort direction announced to assistive technology
- Errors associated with their specific fields, not just a generic banner
- No status communicated by color alone
- Responsive tables that don't lose data on small screens
- Reduced-motion support
- Sufficient color contrast
- OAuth and conflict dialogs that correctly trap and restore keyboard focus

### Release verification (without overclaiming "bug-free")
No specification guarantees a bug-free application. Replace any "bug-free" framing with: **release only when all required automated checks pass, no unresolved severity-high defects remain, and every manual acceptance test has a recorded evidence trail.** A passing test demonstrates only the tested behavior — untested browsers, devices, account states, and failure modes remain explicitly marked `NOT TESTED`, not assumed fine.

Minimum verification coverage:
- Unit tests for CSV grammar, identifier normalization, decimal metric math, hashing, state transitions, and schema validation
- Property/fuzz tests for malformed CSV and malformed envelopes
- IndexedDB transaction rollback tests
- Cross-tab race tests
- Drive API contract tests simulating pagination, timeouts, `401`, `403`, `404`, `409`, `429`, and `5xx` responses
- Real Google test-account smoke tests (not just mocked API responses)
- Offline/reconnect and service-worker-upgrade tests
- Fresh-device reconstruction test
- Backup export/import round-trip test
- Corruption and conflict recovery tests
- Accessibility checks including actual keyboard-only testing
- Production build and installability check
- Verification that no operation ever accesses `D:\Swing Trading`
- Verification that no secret/token appears in IndexedDB, Cache Storage, logs, exported archives, or Drive files

Record exact browser versions tested, executed test counts, failures, skips, and explicitly untested areas in the release report. Do not convert source-code inspection or mocked-API tests into a claim that real Drive synchronization was verified — that requires an actual test against a real Google account.

## Explicit non-goals for v1 (do not build unless separately authorized)

- No automatic fetching from Trendlyne or any other source — manual CSV import only (Trendlyne's ToS on automated reuse has not been reviewed).
- No integration with or modification of `D:\Swing Trading`.
- No trading signals, alerts, or automatic trade/order logic — passive research/tracking only.
- No Nifty 50-specific import handling.
- No silent/unattended background Drive sync requiring a backend (that's a separate, larger project needing its own authorization).
- No in-app run deletion (see Data lifecycle).

## Working method

**Document status:** this brief is requirements-complete after four rounds of technical review, but is deliberately titled "pending pre-implementation gates" rather than "implementation-ready" — the following decisions are correctly left to actual investigation of the real environment rather than pre-guessed on paper, and must be resolved and recorded before implementation begins:

- Actual Nifty 200 Trendlyne CSV headers and numeric formats (confirmed against a real export)
- Final production import limits (the values in this brief are starting recommendations, not fixed)
- Framework and package selection
- Production hosting origin
- Google Cloud project and OAuth client configuration
- Final supported-browser matrix
- Live `drive.file` scope behavior confirmed with the actual selected OAuth client
- Real test-account restoration and account-switching behavior (tested against an actual Google account, not just read from documentation)

Before writing implementation code, investigate and report back on all of the above. Get explicit confirmation on these before proceeding with implementation, since they are hard to reverse later. Do not treat this document's title, or the presence of detailed specifications, as authorization to skip this investigation phase.

Preserve any existing files in `D:\Nifty200 Screener PWA` if the folder already has content — do not reset, delete, or overwrite without explicit authorization.

Report back plainly: what was built, what was verified (and how), what remains untested/unknown, and whether anything was committed to git (do not push to any remote unless explicitly authorized).

## Acceptance criteria (implementation should not begin without these being testable)
- Valid representative Trendlyne CSV imports correctly
- Preview cancellation leaves storage completely unchanged
- Original file's SHA-256 survives storage and retrieval unchanged, and the envelope's decoded Base64 bytes reproduce that hash
- Missing required headers handled with a clear error, not a crash
- Reordered/unexpected additional columns handled gracefully
- A zero numerator with a positive denominator produces a valid result of `"0.000"` (string, scale 3) — not treated as invalid
- A negative numerator produces invalid + `NEGATIVE_NUMERATOR`; a zero or negative denominator produces invalid + `NON_POSITIVE_DENOMINATOR`; blank/malformed inputs produce the correct missing/invalid reason code — none of these ever crash or silently guess
- Decimal rounding is correct at half-step boundary values (e.g., inputs mathematically producing 1.2344, 1.2345, and 1.2346) under the declared `ROUND_HALF_UP` rule
- Numeric sorting correctly orders string-valued decimal results like `"2.000"`, `"9.000"`, `"10.000"` (never lexicographically)
- Duplicate file (same hash) shows a warning but allows a confirmed second run
- Same-date runs remain separately identifiable via `run_id`
- ISIN-based matching correctly links a security across an NSE Code change
- NSE-Code-only provisional matching is labeled as such and distinguished from ISIN matching
- Conflicting identifiers (same NSE Code, different ISIN) are surfaced, not auto-merged
- A stock's absence from a given run is shown explicitly in comparison view
- Numeric columns (Volume Ratio, Day RSI, LTP, etc.) sort numerically (e.g., "10" after "9", never lexicographically); textual columns sort case-insensitively; date columns sort chronologically; missing/invalid values sort last
- **A completely fresh browser/device can reconnect and fully restore all previously-synced runs from Drive** (this is a required test, more important than just surviving an offline reload)
- Offline import followed by later idempotent sync creates no duplicate Drive entries
- Expired/revoked OAuth shows a clear "Reconnect" prompt with no data loss
- Interrupted upload recovers without corruption or duplication
- A run manually deleted from Drive is detected as `remote_missing` on a device that previously synced it, with restore/keep-local options offered — never auto-re-uploaded
- A run's remote content changed outside the app is detected as a conflict, local copy retained, no auto-resolution
- Renamed or moved Drive app folder is still discoverable via `appProperties`
- Malformed or unrelated files inside the Drive app folder are ignored/skipped safely during restore, not treated as valid runs
- Two devices independently creating separate tagged app folders (race condition) results in a surfaced folder conflict, with runs from all matching folders still readable — never silent data loss
- A retried upload for the same run reuses the same pre-generated Drive file ID; a `409 Conflict` triggers retrieval/verification, never a duplicate upload
- A remote file's changed Drive `version`/`md5Checksum` always triggers full re-download and re-validation, even if local state didn't flag it as stale
- Reparsing preserved CSV bytes with the recorded parser version reproduces the stored parsed cells and computed metrics; a mismatch quarantines the run
- Portable backup export can be re-imported through preview-and-confirm, covering all four collision cases: new `run_id`, identical existing run as a no-op, divergent same-ID envelope preserved in `run_variants` as a conflict, and same-hash/different-ID run as a permitted duplicate
- `envelope_sha256` computed via RFC 8785 JCS is stable regardless of in-memory object property insertion order
- Any change to metadata, parsed cells, or computed metrics (not just the raw CSV) invalidates `envelope_sha256`
- A recalculated/self-stored hash is never described in the UI or docs as proof of authenticity — only as integrity/corruption detection
- Every declared sync-state transition (`pending` → `syncing` → `synced`/`error`, `synced` → `remote_missing`/`conflict`, `remote_missing` → `local_only`, etc.) behaves as specified, and no state outside the declared set is ever used
- Trashed-but-recoverable Drive file restoration reuses the existing file ID; permanently-deleted-file restoration correctly obtains and persists a new pre-generated file ID as a recovery operation, not a retry
- A timed-out app-folder creation, retried, reuses the same pre-generated folder ID rather than creating a second folder
- Mismatched `appProperties` vs. actual envelope content is detected and quarantines the file, rather than trusting `appProperties`
- An unsupported future schema version is preserved on disk/Drive but excluded from all active views and comparisons
- Every parser/schema version this app has ever written remains replayable (reparse reproduces stored parsed cells and metrics) after a future app upgrade
- When persistent storage is denied by the browser, a non-blocking warning correctly shows the count of at-risk pending runs
- App reload while offline preserves pending local data
- No reads from or writes to `D:\Swing Trading` anywhere in the codebase
- No OAuth tokens or secrets appear in persistent browser storage, service worker cache, logs, or synced Drive files

### Engineering Standards acceptance criteria
- A simulated write failure partway through a confirmed import leaves zero partial run data (full transaction rollback verified)
- A CSV with duplicate or blank headers is preserved in raw form with warnings, and an ambiguous required-field mapping blocks confirmation rather than guessing
- The chosen CSV parser correctly handles quoted delimiters, escaped quotes, embedded newlines, both CRLF and LF endings, empty/trailing cells, and BOM presence, per frozen test fixtures from a real sample
- Files exceeding the documented size/row/column/cell limits are rejected before any data is committed
- Raw and normalized ISIN/NSE Code values are both preserved and independently inspectable; an invalid ISIN check digit is flagged, never silently repaired
- NSE-Code-only matches remain permanently labeled `nse_code_provisional` in v1 — never silently upgraded to an ISIN match, even when a later run supplies a matching ISIN
- Reconnecting with a different Google account (`permissionId` mismatch) blocks automatic sync and prompts the user, rather than merging data across accounts
- Two tabs simultaneously attempting to sync/restore/migrate correctly serialize through the Web Lock, with only one tab acting and others staying read-only
- An IndexedDB schema upgrade with another tab still open triggers the old tab to close its connection and prompt for reload, rather than hanging indefinitely
- No sync state is ever assigned outside the single state-machine function (verified by code review/lint rule, not just testing)
- Simulated `401`, `403`, `404`, `409`, `429`, and `5xx` Drive API responses each trigger the specified handling behavior, not generic retry-or-fail logic
- A `files.list` response with a `nextPageToken` is fully paginated before being treated as complete
- A backup archive with all six documented collision/edge cases (new, no-op, conflict, permitted duplicate, unsupported schema, corrupt entry) behaves exactly as specified, with correct preview counts shown before import
- A crafted archive attempting path traversal or decompression-bomb behavior is rejected before extraction completes
- A service worker update during an active import/sync/migration correctly defers activation until the transaction completes
- No analytics, crash report, or console log output contains filenames, stock data, query text, cell values, tokens, or raw Drive responses
- Production build output contains no secrets, and source maps are either absent or deliberately/documented as published
- Full keyboard-only operation is verified for import, comparison view, and conflict resolution, including correct focus trapping in modal dialogs
- The release report explicitly lists tested browser versions and marks all untested combinations as `NOT TESTED`, never silently assumed working

### Internal-consistency acceptance criteria (fourth review round)
- A Drive `401` sets the global OAuth state to `reconnect_required` without altering any individual run's sync state; a `pending` run stays `pending` and a `synced` run stays `synced` through a reconnect cycle
- A user-cancelled sync operation returns the run to its correct prior stable state (`pending` if never synced, `synced` if previously synced) — never left stuck in `syncing`
- The `run_id` unique constraint on the `runs` store is never violated, including during simultaneous Drive-conflict and backup-import scenarios — divergent copies always land in `run_variants`, never in `runs`
- Resumable-upload session URIs never appear in IndexedDB, Cache Storage, logs, exported archives, or Drive files — verified as part of the secret-leak test suite
- A run file manually moved (in Google Drive's web UI) outside all tagged app folders, while retaining its `appProperties`, is still discovered and correctly reconstructed on a fresh device via the global tagged-file search
- No policy branch in the document is left as "either X or Y, implementer's choice" for in-scope v1 behavior — verified by a documentation review, not just a code review
- An entry with a missing or malformed `run_id` and no usable `envelope_sha256` is stored in `quarantine_items` with its original bytes and validation errors, and never appears in active views, indexes, comparisons, or uploads
- A rejected page token triggers exactly one restart of that listing from page one; a second failure stops and reports rather than looping
- A network timeout leaves an unsynced run `pending` and a previously verified run `synced` (with a diagnostic)
- Every stored envelope and backup manifest validates against its committed JSON Schema Draft 2020-12 file; hashes, Base64, timestamps, and UUIDs match the specified encodings
- `volume_ratio_v1` uses only `ROUND_HALF_UP` at scale 3; no configuration path exists to change it without a new metric version
- The document title accurately reflects its actual status (do not label a brief "implementation-ready" while pre-implementation gates listed under "Working method" remain unresolved)
