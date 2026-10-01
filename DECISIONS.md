# Nifty 200 Screener PWA: Decisions Record

- **Date:** 2026-09-27
- **Status:** pre-implementation decisions confirmed by the project owner. **Implementation is authorized only for the completed Steps 1–6, Step 6B, Step 7, Step 8, Step 9, Step 10 and Step 11 (see §5, §22, §23, §25, §26, §27 and §28).** Hosting, Cloudflare, a production origin, OAuth publishing, automatic or background sync, deletion, encryption, Android and any later step still require separate, explicit authorization.
- **Governing brief:** `Nifty200_Screener_PWA_Brief_v8.md`, unchanged. The amendments in §3 take precedence over the brief where they conflict. The brief itself is not edited.
- **Supporting evidence:** `INVESTIGATION_REPORT.md`

---

## 1. Reference hashes

Each hash is SHA-256, verified against the current files on 2026-09-27 with `sha256sum`.

| File | Expected SHA-256 | Result |
|---|---|---|
| `samples/Nifty 200 with Fundamentals_September 27, 2026.csv` | `b861b033b69cf54a24e12429591626075c6a74eb3270171c875bb526cef31086` | MATCH |
| `INVESTIGATION_REPORT.md` | `49ee07c761eaf47151f048a659a03258d33b81f1da9e599e34bb2dcb9abf4ff9` | MATCH |
| `Nifty200_Screener_PWA_Brief_v8.md` | `fd999fe9c40b6f5ff763503a6e9aa77b3202add8e23478f512d617a9ee3efcc1` | MATCH |
| `samples/Nifty 200 with Fundamentals_September 27, 2026 (1).csv` (sample 2, added 2026-09-27) | `cd307a9eb7cdfe865afb96473fe0b730ab80cf5976d4367bae8a62368d4e8da3` | Recorded on first read. The brief and sample 1 were re-hashed at the same time and still match. Re-hashed again at the sample 3 analysis and still matches. |
| `samples/Nifty200 All_September 27, 2026.csv` (sample 3, page 1) | `65f0e577a7edf533a0946ddf8d5f050c0ea4606f1845a6026c0e49d187c3b252` | Recorded on first read. The brief and samples 1–2 were re-hashed at the same time and still match. |
| `samples/Nifty200 All_September 27, 2026 (1).csv` (sample 3, page 2) | `419721aa234b83a84fae4c7808d5b1b223bcaf05443bcd2778a2e6be7eb84e2f` | Recorded on first read |
| `samples/Nifty200 All_September 27, 2026 (2).csv` (sample 4, a 7-row real run) | `1536260f77c71f867374dbed8d3d686774f6bb28d288132f6ff3a021648ecc07` | Recorded on first read, 2026-09-27. All other samples were re-hashed at the same time and still match. |

**Sample 4 findings** (VERIFIED, read-only):
- **Size and shape:** 1,700 B, 7 data rows, 22 columns.
- **Format:** the same format as sample 3 (UTF-8 with a BOM, every field quoted, LF line endings, no final newline). The headers are identical to sample 3's.
- **Grammar:** every numeric cell passes A3.
- **Identifiers:** all 7 ISINs have valid check digits.
- **Cells:** no blank cells and no trailing-space names.
- **Cross-check:** all 7 stocks appear in sample 3, with every cell identical except `Sl No`.
- **Volume Ratio:** `Consolidated end of day Vol` ÷ `Consolidated 30D average end of day Vol`, rounded to 2 dp, matches Trendlyne's `VolumeRatio` in **7/7** rows.

App values at 3 decimal places, for use as test expectations:

| NSE Code | App value |
|---|---|
| LGEINDIA | 1.450 |
| APOLLOHOSP | 1.420 |
| MCX | 1.164 |
| OBEROIRLTY | 1.150 |
| ENRIN | 1.129 |
| JUBLFOOD | 1.046 |
| BLUESTARCO | 1.021 |

---

## 2. Confirmed decisions

### D1. UI stack and styling
- **Stack:** Svelte 5 as a plain single-page app (no SvelteKit), built with Vite, in TypeScript strict mode.
- **Styling:** gold accent colours are allowed. Decorative glass effects may be used only where WCAG 2.2 AA contrast holds, and **never behind text**.
- **Precedence:** for this project, the brief overrides the owner's global style and layout preferences. That includes the `index.html` / `css/styles.css` / `js/app.js` file layout.

### D2. Numeric grammar
See amendment A3.

### D3. Header matching
- **Normalization** is for matching only. Preserved header strings are never modified.
  1. Trim outer whitespace.
  2. Apply controlled normalization to internal whitespace.
  3. Compare case-insensitively.
  4. Apply the explicit alias list.
- **Volume Ratio numerator (updated by V1, 2026-09-27):** header `Consolidated end of day Vol`. The raw header is `"Consolidated end of day Vol "`, with a trailing space.
  - There is **no alias** to `NSE+BSE Vol` or `Day Vol`.
  - **Evidence:** across all 200 rows of the sample 3 two-page export, `Consolidated end of day Vol` ÷ `Consolidated 30D average end of day Vol` reproduces Trendlyne's `VolumeRatio` to 2 decimal places in **200/200** rows. `Day Vol` reproduces it in only 7/200 rows, because it is on a different volume basis (§7.3).
  - The earlier numerator, `Day Vol`, is **superseded**. `Day Vol` stays an ordinary informational column.
- **Volume Ratio denominator:** header `Consolidated 30D average end of day Vol`. The raw sample header is `"Consolidated 30D average end of day Vol "`, with a trailing space.
- **`BSE Code`:** informational only. It is never used for identity matching.
- **Required fields:** if a required field matches zero columns, or more than one column, after normalization, confirmation is **blocked** with an explicit error. The app never guesses.
- **Normalization rule (resolved):**
  1. Trim the header.
  2. Collapse every run of ASCII space (U+0020), tab (U+0009) and no-break space (U+00A0) into a single ASCII space (U+0020). The trim step removes the same three characters at the start and end.
  3. Compare case-insensitively for **ASCII letters only** (A–Z and a–z). Every other character is compared exactly, with no Unicode case folding and no other normalization.
  - The preserved header strings are **never modified**. Normalization produces a separate matching key only.

### D4. Import limits
See amendment A2.

### D5. Backup format
See amendment A1.

### D6. Browser support matrix (v1)
| Browser | Status |
|---|---|
| Chrome desktop, current and previous major | Supported, tested |
| Edge desktop, current and previous major | Supported, tested |
| Chrome Android, current | Supported, tested |
| Safari (macOS and iOS), including iOS PWA | **Explicitly unsupported and untested in v1** |
| Any other browser | Unsupported or untested. Mark as `NOT TESTED` in release reports. |

Exact browser versions are recorded at test time.

### D7. OAuth consent screen
- **During development:** External / Testing.
- **Before release:** investigate publishing to production. This is a separate decision, not yet made.
- **Known consequence:** in Testing, test-user authorizations expire 7 days after consent (report R1).

### D8. OAuth scopes
- **Scope:** `https://www.googleapis.com/auth/drive.file` only.
- **Identity scopes** (`openid`, `email`) are added only if the live account-binding test proves they are necessary.

### D9. Hosting
- **Provider:** Cloudflare Pages.
- **Project name:** `n200-screener`.
- **Intended production origin:** `https://n200-screener.pages.dev` (default subdomain, no custom domain).
- **Origin not yet verified:** it is confirmed only once the project is actually created, because Cloudflare may add a suffix if the name is taken. The authorized OAuth JavaScript origin must match the actual origin.
- **No actions taken:** no Cloudflare account, project or deployment has been created. None is authorized by this record.

### D10. CSV samples and fixtures
- **Second sample:** the owner will provide a larger, unfiltered Nifty 200 export.
- **Grammar not frozen:** the CSV grammar stays unfrozen until that sample has been analysed against the checklist in report §1.8.
- **Synthetic fixtures until then:** use clearly labelled synthetic test fixtures, for example under a `synthetic` path or with a `SYNTHETIC` header comment. They must never be presented as real Trendlyne data.

### D11. CSV parser
- **Parser:** `csv-parse` (adaltas/node-csv).
- **Parse settings:** automatic delimiter detection and automatic newline detection are disabled. Delimiter, quote character, record delimiter and BOM handling are set explicitly and recorded in the envelope.
- **Decoding:** bytes are decoded with `TextDecoder('utf-8', { fatal: true })` before parsing.

### D12. JSON Schema validation
- **Validator:** Ajv standalone. Validators for JSON Schema Draft 2020-12 are precompiled at build time.
- **No runtime `new Function`,** so no CSP `'unsafe-eval'` is needed.

### D13. IndexedDB
- **Library:** `idb`, used with explicit transaction control for the atomic import commit.

### D14. Dependency pinning
- **Exact versions:** every dependency that affects hash outcomes or replay results is pinned to an exact version. This includes at least:
  - `canonicalize` (RFC 8785 JCS)
  - `csv-parse`
  - the decimal library
  - `ajv` and its generated validators
- **Lockfile:** all direct dependencies use exact versions with a checked-in lockfile, as the brief requires.
- **Upgrades:** upgrading a hash-affecting or replay-affecting dependency requires golden-vector regression tests to pass. This includes JCS test vectors and frozen parse and metric fixtures.

---

## 3. Brief amendments

These supersede the corresponding text in brief v8.

### A1. Backup format: a single JSON file, no ZIP
- **Replaces:** the brief's ZIP/archive wording.
- **Format:** a backup is **one JSON file** containing the manifest and the immutable run envelopes.
- **Manifest content is unchanged:**
  - `format_version`, schema version and creation timestamp
  - run count and an ordered list of run IDs
  - a SHA-256 for each envelope
  - no OAuth data, Drive file IDs, resumable-session URLs, account email, sync state or device-specific metadata
- **Removed requirements:** because there is no archive extraction, the brief's rules on decompression ratio, nesting depth, entry paths, zip-slip and archive filenames no longer apply.
- **Backup import limits (resolved):**
  - **Maximum file size: 50 MiB** (52,428,800 bytes). This is checked using the file's byte length **before JSON parsing**.
  - **Maximum number of runs: 2,000.**
  - An oversized backup is rejected with a clear error, and **nothing is written**.
  - **Check order (final, confirmed 2026-09-27):**
    1. Check the 50 MiB file size before parsing.
    2. Parse the JSON.
    3. Before any validation, hashing, preview, or write, reject the file if the manifest's run count exceeds 2,000, the actual number of runs exceeds 2,000, or the two counts disagree.
- **Unchanged:** preview-and-confirm import, all six collision and edge cases, and the preview counts.
- **Filename:** `format_version` still appears in the backup filename.

### A2. Import limits, tightened
Replaces the brief's starting recommendation of 10 MiB / 1,000 / 500 / 256 KiB.

| Limit | Value |
|---|---|
| File size | **2 MiB** (2,097,152 bytes) |
| Data rows | **1,000** |
| Columns | **200** |
| Decoded cell size | **4 KiB** (4,096 bytes, measured as UTF-8) |

Limits are enforced before any data is committed, with a clear error.

### A3. Numeric grammar
- **Accepted characters:** ASCII digits, an optional leading minus sign `-`, and `.` as the only decimal separator.
- **Rejected:**
  - grouping commas (Western or Indian style)
  - a leading `+`
  - whitespace
  - any other character
- **Exact pattern (resolved):** `^-?(0|[1-9][0-9]*)(\.[0-9]+)?$`
- **Edge cases:**

  | Input | Result |
  |---|---|
  | `007` (leading zeros) | Rejected |
  | `.5` (no digit before the point) | Rejected |
  | `5.` (no digit after the point) | Rejected |
  | `-0` | **Accepted as numeric zero, not a negative number** |

- **Effect of `-0` on Volume Ratio:**
  - A `-0` numerator is a valid zero, giving the result `"0.000"`. It is not `NEGATIVE_NUMERATOR`.
  - A `-0` denominator is zero, so it is invalid with `NON_POSITIVE_DENOMINATOR`.
  - The same "is it negative" rule applies to `-0.00`: it is numerically zero, so it is not negative.
- **Raw strings** are always preserved unchanged, including `-0`.
- **Rejection reason code** for Volume Ratio inputs: `INVALID_NUMERATOR` or `INVALID_DENOMINATOR`.
- **Grouping commas (resolved):**
  - The reason code stays `INVALID_NUMERATOR` / `INVALID_DENOMINATOR`, with a detail field set to `"grouping_comma"`.
  - **No new top-level reason codes** are introduced.
  - Example of an invalid metric: `{ "status": "invalid", "value": null, "reason": "INVALID_NUMERATOR", "detail": "grouping_comma", "metric_version": "volume_ratio_v1" }`
  - The optional `detail` field must be added to the metric JSON Schema.
- **Blank cell:** `MISSING_NUMERATOR` or `MISSING_DENOMINATOR`.
- **Adding comma support** later requires an explicit written amendment, justified by a real export that shows commas.
- **Grammar freeze:** the grammar is still not frozen for fixtures until the second sample is analysed (D10). If that sample contradicts this pattern, a written amendment is required.

---

## 4. Open items

To be resolved before, or during, the grammar freeze:

Items resolved on 2026-09-27: the header whitespace and case rule (D3), the numeric pattern and its edge cases (A3), the grouping-comma detail (A3), and the backup file-size and run-count limits with their check order (A1).

Still open:

1. ~~Sample decisions~~. **Resolved 2026-09-27.** G1, V1, V2, M1 and S2–S4 are recorded in §8.
2. **Cloudflare origin.** Confirm the actual origin once the project is created (D9).
3. **Live Google tests.** Covers the brief's "Working method" gates and report risks R1, R8–R10 and R19. Includes live `drive.file` scope behaviour, re-consent after the 7-day expiry, and account-binding and account-switch behaviour.
4. **Production publishing.** Investigate before release (D7).

---

## 5. Authorization state

| Action | Authorized? |
|---|---|
| Implementation, scaffolding, package installs, git — Steps 1–6 (completed), Step 6B, Step 7, Step 8, Step 9 (Drive sync engine core against a FAKE Drive), Step 10 (localhost Google Drive connection and user-initiated sync, using the Step 9 engine) and Step 11 (sync summary clarity and trash-detection hardening, §28) only | **Yes** (updated 2026-09-30; see §22, §23, §25, §26, §27 and §28). Nothing beyond Step 11 is authorized. |
| Hosting, deployment, a production origin, OAuth consent-screen publishing, automatic or background sync, deletion from Drive, encryption, Android, or any later step | **No.** Each needs its own explicit approval. |
| First real Google contact | **Yes, only on `http://localhost` with a dedicated test Google account, through the owner's manual smoke test (§27).** Automated tests never contact Google. |
| Google Cloud project / OAuth client creation | **No.** The owner performs this personally. |
| Cloudflare account / project / deployment | **No** |
| Access to `D:\Swing Trading` | **Never** |
| Editing `Nifty200_Screener_PWA_Brief_v8.md` | **No** |

---

## 6. Sample 2 analysis (2026-09-27, read-only)

- **File:** `samples/Nifty 200 with Fundamentals_September 27, 2026 (1).csv`. The filename is informational only.
- **Stated export query:** "Current Price > 0" on the Nifty 200 universe.
- **Method:** the same as sample 1. Strict UTF-8 decode, byte-level checks, Python `csv` parsing, the A3 regular expression, ISIN checks (letters converted to numbers, then Luhn), and the D3 header normalization.
- **Status:** every finding in this section is VERIFIED against the file.

### 6.1 File format

| Property | Sample 2 | Same as sample 1? |
|---|---|---|
| Size | 4,655 bytes | — |
| Encoding | UTF-8, strict decode succeeds, ASCII-only after the BOM | Yes |
| BOM | Present | Yes |
| Delimiter | `,` | Yes |
| Quoting | Every field in every row is double-quoted. No `""` escapes. | Yes |
| Line endings | LF only (25 LF, 0 CR) | Yes |
| Final newline | Absent | Yes |
| Rows / columns | 1 header + **25 data rows**, **20 columns** in every row | Different column count (see 6.2) |
| Largest cell | 40 bytes (a header) | Yes |

### 6.2 Headers
- **Same headers as sample 1, in the same order,** plus one new column, `"VolumeRatio"`, inserted at **index 2**. It sits between `Stock` and `Day Vol `, so every later column shifts by one position.
- **Header strings match sample 1 exactly,** including the trailing spaces and the `Ann␠␠%` double spaces.
- **No duplicate headers,** either raw or after D3 normalization. **No blank headers.**
- **Implication:** column positions are not stable between exports. Matching by normalized header (D3) is required, and matching by position must never be used. This confirms D3.

### 6.3 Row count and other data findings

| Check | Finding |
|---|---|
| **Row count** | **25, far below the roughly 200 expected.** **FLAG: the export was probably still filtered or capped.** Rows are sorted by `VolumeRatio` in descending order, from 9.1 down to a minimum of 1.21. That suggests either an active `VolumeRatio` condition (for example about ≥ 1.2) or a 25-row limit on the view or export, not "Current Price > 0" alone. **Cause NOT VERIFIED.** |
| Numeric grammar (A3) | **All 16 numeric columns × 25 rows pass** `^-?(0|[1-9][0-9]*)(\.[0-9]+)?$`. At most 2 decimal places. Trailing zeros are dropped. |
| Grouping commas | **None**, even for values of 1 crore or more (`Day Vol` up to `41589859`, the 30-day average up to `13467765.52`). This is stronger evidence that Trendlyne does not emit grouping commas. It supports A3. |
| Negatives | Only in `Day Chg %` (for example `-3.41`, `-4.5`) |
| Blanks / placeholders (`-`, `NA`, empty) | **None observed** in either sample |
| ISIN | 25/25 present, well-formed, with **valid check digits**. Letters appear in the issuer segment (`INE0V6F01027`, `INE07Y701011`). No duplicates. |
| NSE Code | 25/25 present, uppercase alphanumeric, matching `[A-Z0-9&-]+`. No duplicates. **No `&` or `-` symbols appear** (for example M&M, BAJAJ-AUTO), so these remain unobserved. |
| BSE Code | 25/25 present (informational only, D3) |
| **Stock name cells** | **2 cells have a trailing space:** `"Max Financial "` and `"Tata Consumer "`. No commas, quotes or non-ASCII characters appear in names. |
| Consistency across exports | LGEINDIA and APOLLOHOSP appear in both samples, and **every overlapping cell is identical** (excluding `Sl No`). |
| **Limits (A2)** | 4,655 B / 25 rows / 20 columns / 40 B largest cell. **All fit** 2 MiB / 1,000 / 200 / 4 KiB. |

### 6.4 Can the CSV grammar be frozen?

**Not fully.** A partial freeze is supportable.

**Supported by both samples (30 rows, 2 exports):**
- **File format:** UTF-8 with a BOM, comma delimiter, every field quoted, LF line endings, no final newline.
- **Headers:** the header strings and their whitespace.
- **Numeric tokens:** the A3 pattern, with no grouping commas.
- **Identifiers:** ISIN and NSE Code are always present, and ISIN check digits are valid.

**Still never observed in real data:**
- Blank or placeholder numeric cells, and therefore the real form of `MISSING_*` inputs
- Missing ISIN or NSE Code
- NSE symbols containing `&` or `-`
- Company names containing commas, quotes or non-ASCII characters
- A zero `Day Vol`
- Negative fundamentals values
- CRLF line endings, or a file that ends with a newline
- A full-universe row count

The parser configuration must still *accept* the unobserved but RFC 4180-valid variants:
- CRLF line endings
- a final newline
- unquoted fields
- `""` escapes

These must be covered by synthetic fixtures clearly labelled as synthetic (D10).

### 6.5 Conflicts and flags against current decisions

| # | Flag | Affects | Proposed handling |
|---|---|---|---|
| F1 | **`VolumeRatio` has 2 decimal places,** not the 1 decimal place described (for example `3.23`, `1.21`) | Informational column | None needed. Record it as provider-formatted text. |
| F2 | **Trendlyne's `VolumeRatio` does not equal Day Vol ÷ 30-day average.** It matches the computed value, even rounded to 1 decimal place, in only 7 of 25 rows. Large gaps occur, for example ICICIBANK provider **3.06** against computed **0.991**, and TATACONSUM **1.21** against **0.728**. Trendlyne evidently uses a different formula or averaging window (NOT VERIFIED which). | `volume_ratio_v1`, UI | **This is not a conflict with the decision to compute our own ratio,** but the two values must never be presented as the same metric. Label the column "VolumeRatio (Trendlyne, provider-defined)" and keep it separate from the app's `volume_ratio_v1`. Never use it for validation or as a fallback. |
| F3 | **Trendlyne's `VolumeRatio` header normalizes to `volumeratio`.** That does not collide with any alias, but a future alias list must not map "volume ratio"-like headers onto the app's computed metric. | D3 alias list | Keep the alias list limited to the numerator and denominator only. Treat `VolumeRatio` as an ordinary informational column. |
| F4 | **Column positions shift between exports** (see 6.2) | Parser replay, fixtures | This is already handled by D3 and the brief's column map. Add a fixture with the column in a different position. |
| F5 | **Trailing spaces in `Stock` cells** | Display, text sorting | The raw cell is preserved (brief). **Decision needed (S3):** proposed rule is to apply the D3 whitespace normalization (trim, then collapse) to the *sort and display key* only. |
| F6 | **The export appears filtered or capped** (25 rows) | Grammar freeze, D10 | **Decision needed (S1).** |

### 6.6 Decisions needed

- **S1. Grammar freeze.** Choose one:
  - **(a) Partial freeze now** (recommended). Freeze the observed format and number grammar (6.4), and cover unobserved cases with synthetic fixtures clearly labelled as synthetic. Any later real export that contradicts it requires a written amendment.
  - **(b) Wait for a third export** confirmed to be unfiltered, with about 200 rows (for example with no `VolumeRatio` condition and any row limit removed).
- **S2.** Confirm that Trendlyne's `VolumeRatio` is stored and shown only as a separately labelled provider column, never compared against or substituted for `volume_ratio_v1` (F2, F3).
- **S3.** Confirm that trim-and-collapse normalization (D3 rule) applies to the display and sort key of text cells, with the raw cell preserved unchanged (F5).
- **S4.** When importing any provider-defined numeric columns, like `VolumeRatio`, should the app type-detect them for numeric sorting under the A3 grammar? Recommended: yes, for sorting only.

---

## 7. Sample 3 analysis: "Nifty200 All", two pages (2026-09-27, read-only)

- **Files:**
  - `samples/Nifty200 All_September 27, 2026.csv`, referred to below as **P1**
  - `samples/Nifty200 All_September 27, 2026 (1).csv`, referred to below as **P2**
- **Stated source:** the screener "Nifty200 All", query "Current Price > 0", Nifty 200 universe.
- **Method:** the same as §6, extended to cover both pages together.
- **Status:** all findings are VERIFIED against the files unless marked otherwise.

### 7.1 Identity of the two files

| | P1 | P2 |
|---|---|---|
| Size | 19,637 B | 19,529 B |
| SHA-256 | `65f0e577…c3b252` | `419721aa…84e2f` |
| Data rows | **100** | **100** |
| `Sl No` | 1–100, sequential | **1–100 again.** The numbering restarts on each page. |
| `VolumeRatio` range (sorted descending) | 9.1 → 0.72 | 0.71 → 0.12 |

- **The files are not identical:** the hashes differ.
- **The files are disjoint:**
  - ISIN overlap is **0**, and NSE Code overlap is **0**.
  - There are no duplicate ISINs within either page.
- **Combined unique rows: 200** (200 unique ISINs).
- **Page order:** P2 continues P1's descending `VolumeRatio` order without a gap (P1 ends at 0.72, P2 starts at 0.71). This is consistent with **page 1 and page 2 of one sorted result, at 100 rows per page**.
- **Full Nifty 200?** The count matches 200 exactly. Whether these are the *current* index constituents was NOT VERIFIED, because there was no external membership check. By the brief's rules, universe is attested by you, never inferred.
- **Sample 2 was page 1 with a 25-row page size.** Its 25 ISINs are exactly P1's first 25 rows, in the same order (VERIFIED). The "filtered or capped" flag (F6) is therefore explained by **pagination**, not a query filter. That the page size was the cause is an inference and NOT VERIFIED.
- **Sample 1** stocks all appear in P1, at positions 16, 18, 32, 33 and 34. Sample 1 was evidently a differently sorted or filtered view (NOT VERIFIED).

### 7.2 Format and grammar across both pages

| Property | Finding |
|---|---|
| Encoding / BOM | UTF-8 with a BOM, strict decode succeeds, ASCII-only after the BOM (both pages) |
| Delimiter / quoting | `,` with every field in every row double-quoted. **No `""` escape sequences** (the only `""` token found is an empty quoted field, see below). |
| Line endings | LF only (100 LF, 0 CR, per file). **No final newline** (both pages). |
| Columns | **22 in every row.** The headers are identical in P1 and P2. |
| Headers | The sample 2 headers, **plus two new columns at indices 17–18: `"NSE+BSE Vol "` and `"Consolidated end of day Vol "`** (both with a trailing space). Note these are *not* the names "Consolidated day Volume" or "Consolidated end of day volume" given in your message. No duplicate or blank headers, raw or normalized. |
| Numeric grammar (A3) | **All 18 numeric columns × 200 rows pass.** At most 2 decimal places. **No grouping commas**, including values up to `442582817.9` and `330779007`. |
| Negatives | `Day Chg %` (76 rows) and **fundamentals**: ROE (4), ROCE (2), Interest Coverage (1), LT Debt/Equity (2). Examples: IDEA ROE `-96.62`, GMRAIRPORT LT D/E `-11.66`, SWIGGY ICR `-13.62`. |
| Zeros | `Day Chg %` = `0` (NTPC). LT Debt/Equity = `0` in 92 rows. **No zero `Day Vol`** (minimum 2,338). |
| **Blanks** | **First real blank cell seen:** `BSE Code` is `""` for the stock BSE Ltd (NSE `BSE`, P1 row 38). It is an informational column only. **No blank numeric cells** and no placeholders (`-`, `NA`) anywhere in the 200 rows. |
| ISIN | 200/200 present, well-formed, **with valid check digits**. No duplicates. |
| NSE Code | 200/200 present. **`&` and `-` now observed:** `M&M`, `M&MFIN`, `GVT&D`, `BAJAJ-AUTO`. They are raw, not HTML-escaped. All 200 match `[A-Z0-9&-]+`, which confirms the report's proposed NSE normalization. |
| Stock names | Punctuation observed: `&` (`Mahindra & Mahindra`, `L&T`, `GE T&D`), apostrophe (`Divi's Laboratories`, `Dr. Reddy's Labs`), hyphen (`Colgate-Palmolive`, `FSN E-Commerce`) and period. **13 names end in a space** (8 in P1, 5 in P2) (for example `"Motilal Oswal "`, `"SBI Life Insurance "`). **No commas, double quotes or non-ASCII characters** in any name. |
| Limits (A2) | Per file: about 19.6 KB, 100 rows, 22 columns, largest data cell 25 B. **Everything fits.** Even both pages combined into one file would fit. |

### 7.3 Volume basis (decision D3 numerator)

Tested on all 200 rows with exact decimal arithmetic. Each candidate numerator was divided by `Consolidated 30D average end of day Vol ` and compared with Trendlyne's `VolumeRatio`, rounded to 2 decimal places.

| Numerator | Rows reproducing `VolumeRatio` | Largest absolute difference |
|---|---|---|
| `Day Vol ` | **7 / 200** | 2.07 |
| `NSE+BSE Vol ` | **200 / 200** | 0.0049 (within rounding) |
| `Consolidated end of day Vol ` | **200 / 200** | 0.0049 (within rounding) |

**Supporting relationships:**
- `NSE+BSE Vol ` equals `Consolidated end of day Vol ` in **200/200** rows.
- `Day Vol ` is **never greater** than `NSE+BSE Vol `.
  - It is strictly less in 199 rows, at 32%–100% of it.
  - It is equal in 1 row, BSE Ltd, which has no BSE listing.
- This is consistent with **`Day Vol` being NSE-only volume, while the 30-day average is consolidated (NSE+BSE)**. That interpretation is NOT VERIFIED against Trendlyne documentation.

**Result, VERIFIED (200/200, consistent):** Trendlyne's `VolumeRatio` equals **`Consolidated end of day Vol` ÷ `Consolidated 30D average end of day Vol`**. Using `Day Vol` as the numerator compares an NSE-only figure against a consolidated average, so the bases are mismatched. That systematically understates the ratio, by up to about 68% in this data.

**Should D3 change?** The data supports changing it. The recommended numerator is **`Consolidated end of day Vol`**:
- Its basis matches the denominator's ("consolidated … end of day").
- It reproduces Trendlyne's ratio exactly.

`NSE+BSE Vol ` was numerically identical in this Sunday export. Whether the two differ while the market is open was NOT VERIFIED, so the named "end of day" column is the safer choice.

**Not determinable:** Trendlyne's own rounding mode. No row falls on a 2-decimal half-step boundary. This does not affect `volume_ratio_v1`, which is ROUND_HALF_UP at scale 3.

### 7.4 Cross-check with samples 1 and 2

- **Sample 1:** all 5 stocks are found in sample 3, and **every shared column is identical** (excluding `Sl No`).
- **Sample 2:** all 25 stocks are found, and **every shared column is identical** (excluding `Sl No`). They are P1 rows 1–25, in the same order.
- All four exports are internally consistent for the same date.

### 7.5 Can the CSV grammar be frozen?

**Yes.** I recommend freezing now (decision G1). The evidence is 4 exports and 230 data rows, including one complete 200-row universe.

**Observed in real data and frozen:**
- **File format:** UTF-8 with a BOM, comma delimiter, every field double-quoted, LF line endings, no final newline.
- **Headers:** the header strings, including their trailing and double spaces.
- **Numbers:** the A3 numeric grammar, with no grouping commas.
- **NSE Code:** matches `[A-Z0-9&-]+`.
- **ISIN:** always present and checksum-valid.
- **Blank cells:** can occur in informational columns (as an empty quoted field).
- **Negatives:** occur in fundamentals columns.
- **Names:** can contain `& ' - .` and trailing spaces.

**Still unobserved, to be covered by synthetic fixtures clearly labelled as synthetic:**
- **RFC 4180 variants the parser must still accept:** CRLF line endings, a final newline, unquoted fields, `""` escapes, and embedded commas or newlines in names.
- **Cases handled by the brief's rules:**
  - a blank or placeholder numeric cell (becomes `MISSING_*` or `INVALID_*`)
  - a zero `Day Vol` or consolidated volume
  - a missing ISIN or NSE Code
  - non-ASCII names

  None of these appeared in a full 200-row universe, which is good evidence they are rare, but they remain possible.

### 7.6 Conflicts and flags

| # | Flag | Affects |
|---|---|---|
| F7 | **The D3 numerator (`Day Vol`) is on a different basis from the denominator.** Using it would produce a ratio that is systematically wrong (§7.3). | D3, `volume_ratio_v1`. Decision V1. |
| F8 | **Samples 1 and 2 lack `Consolidated end of day Vol`.** If V1 changes the numerator, exports without that column will **block confirmation** under the brief's required-field rule. Samples 1 and 2 would no longer be importable. They would still be useful as negative fixtures. | Import rules. Decision V2. |
| F9 | **A full-universe result currently spans two files** (100 rows per page). The brief's run model is **one CSV file = one run**: one `original_file_sha256` and one set of original bytes. Importing each page as a separate run would make every stock on the other page look **"absent"** in comparisons, which is wrong. | Brief's run schema, comparison view. Decision M1. |
| F10 | **`Sl No` restarts on each page,** so it is not a rank across pages | Display. It stays informational only. |
| F11 | **The pages were saved one minute apart** (the files' local modified times are 16:22 and 16:23, which only approximate the export times). On a Sunday the data is static. During market hours, a stock could move between pages between the two downloads, so it would be **duplicated or missing**. | M1 |
| F12 | **Provider `VolumeRatio` formula now known:** consolidated EOD volume ÷ consolidated 30-day average, rounded to 2 dp. This updates F2: the earlier mismatch came from `Day Vol`, not from a different averaging window. | S2 |
| F13 | **The extra-column names in your message differ from the actual headers.** The actual headers are `NSE+BSE Vol ` and `Consolidated end of day Vol `. | Alias list (D3). Use the actual header strings. |

### 7.7 Decisions needed

- **G1. Freeze the CSV grammar** as in §7.5? Recommended: yes. Unobserved RFC 4180 variants are to be covered by synthetic fixtures clearly labelled as synthetic.
- **V1. Volume Ratio numerator.** Replace `Day Vol` with **`Consolidated end of day Vol`** (recommended, VERIFIED to reproduce Trendlyne 200/200), with no alias to `NSE+BSE Vol`? No runs exist yet, so `volume_ratio_v1` can simply be *defined* with the new numerator. No metric-version bump is needed.
- **V2. Missing numerator column.** When the numerator column is absent, **block confirmation** (the brief's required-field rule, recommended)? Or allow import with the metric marked `MISSING_NUMERATOR` for every row?
- **M1. Multi-page results.** Choose one:
  - **(a)** First check whether Trendlyne can export all 200 rows in **one file**, for example with a larger page size or an "export all" option. If it can, require single-file exports and keep the brief's run model. **Recommended first step; NOT VERIFIED that this option exists.**
  - **(b)** Amend the brief so that **one run can contain 1..N source files**, each preserved with its own bytes and SHA-256. The files must have identical headers, and any duplicate ISIN across the files blocks confirmation.
  - **(c)** One run per page, with an explicit "partial page" attestation. Absence in comparisons would then show "not in this page" rather than "absent". Not recommended.
- **S1–S4** (§6.6) remain open.
  - **S1 is superseded by G1.**
  - For **S2**, recommended: show provider `VolumeRatio` as a separately labelled column. Optionally, give a **non-blocking** import warning if the app's value, rounded to 2 dp, disagrees with the provider's. That would catch a wrong column mapping.

---

## 8. Resolutions: sample-driven decisions (confirmed 2026-09-27)

These resolve the questions in §6.6 and §7.7. Where they conflict with earlier sections (D10, A3 "Grammar freeze", D3), these take precedence.

- **G1. CSV grammar: FROZEN** as described in §7.5.
  - Unobserved RFC 4180 variants are covered by synthetic fixtures, clearly labelled as synthetic.
  - Any real export that contradicts the frozen grammar requires a written amendment.
  - This supersedes S1 and the "not frozen" notes in D10 and A3.
- **V1. Volume Ratio numerator = `Consolidated end of day Vol`**, with no alias to `NSE+BSE Vol`.
  - The denominator is unchanged: `Consolidated 30D average end of day Vol`.
  - `volume_ratio_v1` is defined with this numerator. No runs existed before this decision, so no metric-version change is needed.
  - D3 has been updated to match.
- **V2. Missing numerator column → block confirmation**, under the brief's required-field rule.
  - Exports without `Consolidated end of day Vol`, such as samples 1 and 2, cannot be imported.
  - They remain valid negative test inputs.
- **M1. Option (a): single-file exports only.** One CSV = one run; the brief's run model is unchanged.
  - **Page-size warning (non-blocking):** raised when the data row count is exactly **25, 50 or 100**, **or** when the first data row's `Sl No` is not `1`.
  - The warning tells you the export may be a single page of a larger result.
- **S2. Trendlyne `VolumeRatio`** is kept and shown as a **separately labelled provider column**.
  - **Mismatch warning (non-blocking):** raised when the app's ratio, rounded to 2 dp, differs from the provider value.
  - The provider value never blocks, merges with, or substitutes for `volume_ratio_v1`.
- **S3. Text cells:** display and sort keys use the D3 whitespace normalization (trim, then collapse). The raw cell stays unchanged.
- **S4. Provider numeric columns** (for example `VolumeRatio`) that match the A3 grammar sort numerically. This affects sorting only.

---

## 9. Step 1 review: confirmations and required-field amendment (2026-09-27)

- **V2 amendment (supersedes the V2 wording in §8):** required-identifier blocking is relaxed from "ISIN AND NSE Code both required" to **"block only when both ISIN and NSE Code columns are missing."**
  - If exactly one of the two identifier columns is present, import is **allowed** with a **non-blocking warning**.
  - Matching then uses whichever identifier is actually present, under the existing identity rules (ISIN preferred; NSE-Code-only is `nse_code_provisional`).
  - The Volume Ratio numerator/denominator columns are **still both required** and still block confirmation if either is missing (V2's original rule, unchanged for those two fields).
- **Empty-run amendment:** a CSV with a header row and **zero data rows** is no longer an error (`NO_DATA_ROWS` is removed as a blocking error).
  - It is **allowed after explicit user confirmation** and is stored as an **empty run**, with a stock count of 0.
  - It carries a **non-blocking warning** rather than being treated silently.
- **Repository visibility:** acceptable for this repository to remain local-only for now. **Any future remote must be private, and adding one requires the owner's explicit authorization** — this is not implied by any earlier or later authorization in this document.
- **Confirmed as implemented, no change needed:**
  - Numeric-cell classification: only the empty string is `MISSING_*`; a whitespace-only or placeholder cell is `INVALID_*`.
  - An invalid ISIN with a valid NSE Code falls back to `nse_code_provisional`, with a warning.
  - `computeVolumeRatio` check order: numerator syntax → denominator syntax → numerator sign → denominator sign.
  - The S2 mismatch warning rounds the exact quotient to 2 dp directly, not the already-rounded 3 dp value.
  - UTF-16 and embedded-NUL files are rejected; mixed LF/CRLF is accepted with a warning; bare CR line endings are rejected.
- **Toolchain confirmed:** TypeScript 6.0.3 (typescript-eslint does not yet support 7.x), npm with a committed lockfile (pnpm unavailable), `allowJs`+`checkJs` enabled (required by `svelte-check` for a script-less Svelte component), and S3/S4 deferred to the table UI step.

---

## 10. Pre-Step-3 check: minLength/maxLength vs. non-ASCII text (2026-09-27)

**Checked:** `src/core/envelope/schema/envelope.v1.schema.json` for every use of `minLength`/`maxLength`.

**Found:** `maxLength` is used nowhere. `minLength: 1` is used on exactly four fields:

| Field | User-controlled text that can be non-ASCII? |
|---|---|
| `original_filename` | **Yes.** The user's actual CSV filename, which can contain any Unicode text. |
| `parser.parser_id` | No — a fixed internal constant (`"csv-parse"`). |
| `parser.parser_version` | No — a fixed internal constant (the pinned csv-parse version). |
| `parser.config_id` | No — a fixed internal constant (`"n200-csv-v1"`). |

No `minLength`/`maxLength` appears on `headers`, `rows` (stock names, including non-ASCII ones, live here), or `query_text` — none of these are length-constrained at all.

**Risk assessed:** the generated validator is compiled with Ajv's `unicode: false` option (`scripts/compile-schema.mjs`), which makes `minLength`/`maxLength` count UTF-16 code units instead of Unicode code points. This was chosen only to avoid Ajv's `ucs2length` runtime helper, which the ESM standalone codegen emits as a `require(...)` call that breaks the CSP goal (report §2, D12). For a **minimum length of exactly 1**, code-unit counting and code-point counting can never disagree: every non-empty string has at least one UTF-16 code unit, including a lone astral-plane character (which is a 2-unit surrogate pair, still ≥ 1). **Conclusion: no bug.** The only field this could matter for, `original_filename`, is unaffected.

**Outcome: kept the schema constraint as-is** (not removed), and added a test rather than relying on this reasoning alone: `tests/unit/envelope-build.test.ts`, describe block "minLength:1 fields tolerate non-ASCII, including astral-plane, text". It proves `original_filename` is accepted with:
- ordinary BMP non-ASCII text (Devanagari, an en dash),
- a filename that is a single astral-plane code point alone,
- a single astral-plane code point plus an ASCII extension,

and that a genuinely empty `original_filename` is still correctly rejected. All pass.

**No schema change was needed.** If `maxLength` is ever added to any field in a future revision (none exists today), this reasoning would need re-deriving per-field, since a maximum is where code-unit vs. code-point counting actually can disagree.

---

## 11. Step 3 build note: Node 24 implements real Web Locks (2026-09-27)

While testing `withMigrationLock` (the Web Lock wrapper around schema migrations, D-item "single-tab fallback when Web Locks are unavailable"), this project's Node runtime (v24.20.0) turned out to implement a real, working `navigator.locks.request()` — not just an empty `navigator` stub. This was unexpected going in.

**Consequence:** the fallback path cannot be exercised by relying on the ambient test environment ("Web Locks aren't available under Node, so the fallback runs"). The storage tests (`tests/unit/storage-schema.test.ts`) instead stub `globalThis.navigator` explicitly for both cases — present and absent — so both branches of `withMigrationLock` are actually exercised, rather than only ever hitting whichever branch the ambient Node happens to support.

No behavior or design change resulted from this; it only changed how the fallback is tested.

---

## 12. Step 3 review: quarantine scope and at-risk count amendment (2026-09-27)

- **Amendment 2 (CSV-level rejection vs. envelope-level quarantine):** `quarantine_items` is reserved for **envelope-level** inputs only — a Drive-downloaded file, a backup-archive entry, or an internally-built envelope that fails post-build validation. It was already scoped this way in the Step 3 code (`ingestEnvelopeBytes` only ever operates on serialized *envelope* bytes, never on raw CSV bytes), so no code change was required here — this records the boundary explicitly as a rule Step 4 must follow.
  - A user-selected **CSV** that fails preview-time validation (parse errors, the A2 limits, blocking header/identifier issues from `analyzeCsvBytes`) is **rejected at the preview step**: nothing is written to any store, and the user sees a clear, specific error. It never reaches `quarantine_items`, `ingestEnvelopeBytes`, or `commitNewRun`.
- **Amendment 4 (at-risk run count):** `countPendingRuns` is renamed **`countAtRiskRuns`** and now counts every run with **no verified Drive copy right now**:
  - `pending`, `local_only`, and `remote_missing` — unconditionally.
  - `error` — **only** for a run that has never once synced successfully (`diagnostics.last_success_at === null`); an `error` run that previously synced still has a verified remote copy from before the failure, so it is excluded.
  - `synced`, `conflict`, `quarantined`, `unsupported_schema`, and `syncing` are excluded (a `conflict`/`quarantined`/`unsupported_schema` run's remote-copy status is unresolved/not applicable, not itself "storage-eviction risk" in the sense this warning is about).
- **Confirmed as implemented, no change needed:**
  1. `INGEST_CONFLICT_VARIANT` / `QUARANTINE` transitions are reachable from any resolvable state, excluding `quarantined` and `unsupported_schema` themselves.
  3. An `unsupported_schema` object with a `run_id` that collides with an existing run is quarantined rather than overwriting the existing record.
  5. The comparison-identity index omits rows with neither a usable ISIN nor NSE Code.

---

## 13. Bugbot review fixes, pre-Step-4 (2026-09-27)

An external review ("Bugbot") of Step 3 found 7 issues, fixed here test-first (a failing regression test was written and confirmed to fail against the pre-fix code, then the fix was applied and the same test confirmed to pass). §12's amendments (quarantine scope; the at-risk count) are reconfirmed as still in force, superseded only where P2-3 below extends the at-risk count further.

- **P1-1 (`ingest.ts`, atomic conflict routing).** The existing-run lookup, variant insert, and canonical-run transition to `conflict` now happen in **one** IndexedDB transaction spanning `runs`, `run_variants`, and `comparison_identity`, replacing the prior two-separate-transactions version. Re-ingesting an already-stored identical variant is now a **no-op** (checked via `get` before `add`), not a `ConstraintError`. The whole valid-envelope branch is wrapped in try/catch with an explicit `tx.abort()` on any thrown error — a plain JS error between two queued requests does **not** auto-abort a native IndexedDB transaction (only a failed *request* does), so without this, already-issued requests earlier in the same transaction would simply commit when it naturally completed. This was confirmed as a real, reproducible gap (not just theoretical) using a scratch repro before the fix was written.
  - Tests: concurrent ingestion of two different divergent envelopes for the same `run_id` (`Promise.all`) loses neither variant; re-ingesting an identical variant doesn't throw and doesn't duplicate; a simulated mid-transaction failure (the canonical-run `put` throws) leaves no orphan variant and no half-marked canonical run.
- **P1-2 (`comparisonIndex.ts`, state-filtered comparison queries).** `queryComparisonIndexByIdentity` now checks each matched row's canonical run's **current** `sync.state` and excludes `conflict`, `quarantined`, and `unsupported_schema` — filtered at query time, never by deleting or mutating index rows, so a run later restored to an eligible state (e.g. `conflict` → `local_only` via `KEEP_LOCAL_ONLY`) reappears with no rebuild needed.
- **P2-1 (`schema.ts`/`locks.ts`, surfaced lock status).** `openDatabase` now returns `{ db, usedLock, singleTabWarning }` instead of a bare `N200Database` (a breaking change to Step 3's own API; every call site, all in this codebase, was updated). A new `onSingleTabFallback` callback fires whenever the migration ran without a real Web Lock. `withMigrationLock` itself already returned `usedLock`; the bug was that `schema.ts` discarded it. **Note:** the actual sync-disabling *enforcement* has no caller to wire into yet, since Drive sync doesn't exist in this app — `singleTabWarning` is the signal a future sync layer must check before calling `applyTransition(..., { type: 'START_SYNC' })`.
- **P2-2 (`comparisonIndex.ts`, NSE/ISIN conflict detection).** Every `comparison_identity` row now stores both `normalized_isin` and `normalized_nse_code` (previously only the primary-matched one was implied by `identity_key`), plus a new `by_normalized_nse_code` index. A new `findIdentityConflicts(db)` detects the brief's "Same NSE Code, different ISIN → conflict; do not auto-merge, surface for review" rule by grouping rows by NSE code and flagging groups with ≥2 distinct non-null ISINs. Read-only detection only — never auto-merges.
- **P2-3 (`persistence.ts`/`syncState.ts`, explicit remote-durability tracking).** Added `diagnostics.has_verified_remote_copy: boolean` to `SyncRecord`, set `true` only by `SYNC_SUCCEEDED` and cleared back to `false` by `REMOTE_MISSING_DETECTED` and by entering `conflict` (`REMOTE_CONFLICT_DETECTED`/`INGEST_CONFLICT_VARIANT`) — replacing the §12 amendment's inference from `last_success_at`. `countAtRiskRuns` now counts `pending`/`local_only`/`remote_missing` unconditionally, plus **`error` or `conflict`** (extended from `error` alone) when `!has_verified_remote_copy`.
- **P2-4 (`syncState.ts`, distinct timeout vs. cancellation diagnostics).** `SYNC_TIMEOUT` now records a stable `error_code: 'SYNC_TIMEOUT'` with `retryable: true` while still restoring the prior stable state; `SYNC_CANCELLED` restores the prior state with no error diagnostic recorded, since it's user-initiated, not a failure. Previously both were handled identically with no diagnostic at all.
- **P2-5 (`types.ts`/`ingest.ts`, structured discovery metadata).** Added `QuarantineDiscoveryMetadata` (`drive_file_id`, `drive_app_properties`, `backup_entry_name`, `backup_entry_index`, `detection_context`) and an optional `discovery_metadata` field on `QuarantineItemRecord`. `ingestEnvelopeBytes` takes an optional 4th parameter carrying it through to whatever quarantine item results. Explicitly documented and tested as **non-authoritative** — exactly like the brief's treatment of Drive `appProperties` — never used for routing or trust decisions (a claimed `run_id` inside `drive_app_properties` on a malformed item does not affect where it lands).

**Shared fix:** extracted `safeAbort()` (abort-if-active, observe the `.done` rejection so it's never unhandled) from `runs.ts` into a new `txUtils.ts`, now used by both `runs.ts` and `ingest.ts`.

**Test count:** 391 → 412 (21 new/changed tests across the 7 findings). All were confirmed failing against the pre-fix code before the fix was applied; see the session transcript for the fail-before/pass-after evidence per finding.

---

## 14. Security review fixes, partial (P1-A, P1-B, P1-C, P2-A done; P2-B not started) (2026-09-28)

Test-first as before, with one exception noted below.

- **P1-A (`persistence.ts`): `has_verified_remote_copy` is the sole authoritative durability signal.** Found that P2-3 (§13) had added the field to `SyncRecord`/`transition()` but **never actually wired it into `countAtRiskRuns`**, which still read `last_success_at`. Fixed: `countAtRiskRuns` now filters purely on `!diagnostics.has_verified_remote_copy`, excluding only `quarantined`/`unsupported_schema` by state (out of scope for this warning, per §12). Regression test: synced → remote lost → re-sync fails (`error`) — `last_success_at` stays non-null throughout, so the old code wrongly excluded it; the new code correctly still counts it. 4 tests failed before the fix, 10/10 pass after.
- **P1-B (`schema.ts`): `DB_VERSION` bumped 1 → 2 with an `oldVersion`-aware migration.** A genuinely v1-shaped database (built by hand in the test, matching the original Step 3 schema before any Bugbot/security fixes) is migrated under the Web Lock, before the connection is returned: adds `by_normalized_nse_code`, rebuilds every run's comparison rows from its *stored, validated* envelope, and initializes `has_verified_remote_copy` conservatively (`true` only if the old `sync.state === 'synced'`, `false` otherwise — old data can't prove anything stronger). A fresh install skips straight to the v2 shape. 1 test failed before, 13/13 pass after.
- **P1-C (`comparisonIndex.ts`): single-transaction reads.** `queryComparisonIndexByIdentity` and `findIdentityConflicts` now read comparison rows and canonical run states inside **one explicit `readonly` transaction** spanning both stores, instead of separate `db.getAllFromIndex`/`db.get` shortcut calls (each its own transaction) — eliminating a "torn read" where rows and run states could reflect two different points in time relative to a concurrent `applyTransition`. `findIdentityConflicts` now applies the same conflict/quarantined/unsupported_schema exclusion as the query path. Verified two ways: a white-box test asserting exactly one `db.transaction(...)` call spans both stores (deterministic), and a best-effort behavioral test firing a query and a concurrent quarantine transition back-to-back, confirming the in-flight query still sees its pre-quarantine snapshot while a fresh query afterward correctly excludes it. 4 tests failed before, 13/13 pass after.
- **P2-A (`locks.ts`/`schema.ts`): fail closed when Web Locks are unavailable, for migrations only.** Added `WebLocksUnavailableError` (`code: 'WEB_LOCKS_UNAVAILABLE'`) and `isWebLocksAvailable()`. `openDatabase` now checks lock availability *before* opening: if a migration is needed (fresh install or `oldVersion < DB_VERSION`) and locks are unavailable, the `upgrade` callback calls `transaction.abort()` (not a raw `throw`, which fake-indexeddb/idb re-dispatches as a second unhandled error event) and the wrapping code throws the stable error after the aborted open rejects. Opening a database **already at the current version** needs no lock and still succeeds — "reads remain available." Regression test: two concurrent fallback-mode opens of a fresh database both reject with the stable code, and a normal (locked) open afterward still succeeds cleanly (no partial state left behind). This changes two existing P2-1 tests' premise (a fresh-install fallback open used to succeed with a warning; it now fails closed) — updated them to open an *already-current-version* database instead, which is the only case §P2-1's warning/fallback semantics still apply to. Tests were written after the implementation for this finding, not strictly before — see "process note" below.
- **P2-B (`types.ts`/`ingest.ts`): NOT STARTED.** Bounded allowlist validation of quarantine discovery metadata (known keys only, stable codes, length limits, credential-shaped value rejection/redaction) has not been implemented. `QuarantineDiscoveryMetadata` as added in §13 (P2-5) is currently accepted and stored **as given, unvalidated** — a caller could pass arbitrarily large or hostile values (e.g. a bearer token in `detection_context`) and they would be persisted verbatim. This must be fixed before any real Drive/backup-import caller is wired up.

**Process note:** P2-A's tests were written and iterated *against* the already-implemented fix (to work through two real fake-indexeddb/idb interaction bugs — an unhandled-rejection double-dispatch on a thrown `upgrade()` error, and a second one on an unobserved aborted-transaction `.done` — that only surfaced once real tests were run), not strictly fail-first. All other findings in this entry (P1-A, P1-B, P1-C) followed the fail-first discipline: a test was written, run against the pre-fix code and confirmed to fail, then the fix was applied and the same test confirmed to pass.

**Also confirmed (§9/§12 re-check, per this review's question 1):** quarantine-scope and Step 3 review choices 1/3/5 remain as recorded in §12 — no drift found, no changes needed.

**Test count:** 412 → 425 (13 net new/changed tests across P1-A/B/C/2-A). §13's reported "391 → 412" is confirmed correct by directly re-running the code at commit `ac9fe6a` (the original Step 3 commit): 390 tests, not 391 — the review's question 2. The Step 3 review commit (`40e8d0d`) replaced 2 `countPendingRuns` tests with 3 `countAtRiskRuns` tests (net +1), giving 391; the Bugbot-findings commit then went 391 → 412.

## 15. Security review round 2: P2-B, P2-A scope check, and full re-audit (2026-09-28)

### 1. P2-B: bounded validation of quarantine discovery metadata (new module, test-first)

New module `src/core/storage/sanitizeDiscoveryMetadata.ts` sits at the storage boundary and is the only path by which `discovery_metadata` reaches `quarantine_items`. `ingest.ts`'s `discoveryMetadata` parameter (both the internal `quarantine()` helper and the exported `ingestEnvelopeBytes()`) is now typed `unknown`, not `QuarantineDiscoveryMetadata` — a caller-supplied type annotation was never a real guarantee, so the boundary no longer trusts it.

Rules enforced, matching the finding exactly:
- **Bounded allowlist:** only five known keys (`drive_file_id`, `drive_app_properties`, `backup_entry_name`, `backup_entry_index`, `detection_context`) survive; everything else — including a `__proto__` pollution attempt — is silently dropped, not rejected wholesale (one bad key doesn't lose the good ones).
- **Stable codes, not free text:** `detection_context` is now a closed 6-value union (`QUARANTINE_DETECTION_CONTEXTS` in `types.ts`: `drive_folder_scan`, `drive_global_search`, `backup_import_scan`, `manual_recovery_attempt`, `periodic_integrity_check`, `other`). Any other string is dropped, never stored verbatim.
- **Length limits:** `drive_file_id` ≤200, `backup_entry_name` ≤255, `drive_app_properties` ≤30 entries / 124 chars per value (matching Drive's own `appProperties` limits), `backup_entry_index` a non-negative integer ≤1,000,000. Oversized-but-ordinary values are truncated, not dropped.
- **Credential-shaped values rejected/redacted:** Bearer/Basic-auth patterns, JWT-shaped strings, URLs with a query string or embedded userinfo, and long (40+ char) opaque tokens are replaced with the literal `[REDACTED]` rather than stored — checked before length truncation, so a redacted marker is never itself truncated. A realistic long `drive_file_id` (its normal shape) is exempted from the opaque-token check alone, but a Bearer/JWT/URL-shaped value inside `drive_file_id` is still redacted.

**Tests:** `tests/unit/sanitizeDiscoveryMetadata.test.ts` (21 tests, new) plus 2 new tests in `tests/unit/storage-ingest.test.ts` exercising the real `ingestEnvelopeBytes` boundary end-to-end (hostile/oversized object, and non-object `unknown` input). One pre-existing test's fixture (`detection_context: 'periodic Drive folder scan'`) was corrected to a valid stable code (`drive_folder_scan`) in two places. Total: 23 new/changed tests for this item.

### 2. P2-A scope check: are guarded WRITE entry points (commit, ingest, state transitions) also gated?

**Conclusion: no gate needed, and none was added.** The brief reserves Web Locks for operations that span *multiple* IndexedDB transactions and must pick one acting tab across tabs — draining the pending sync queue, Drive-folder creation, backup restoration, schema migration (the brief's "Cross-tab concurrency" section). `commitNewRun`, `applyTransition`, and `ingestEnvelopeBytes` are each exactly one atomic native IndexedDB transaction (already required by Bugbot P1-1 for the ingest conflict path); the platform's own per-store transaction ordering already serializes concurrent tabs safely with zero data loss — adding a Web Lock around them would only add a false-negative failure mode (rejecting a perfectly safe concurrent write) with no corresponding safety gain.

**Decision:** this single-transaction rationale is accepted as a deliberate deviation from Security Review P2-A's literal request to reject all guarded writes when Web Locks are unavailable. Multi-step migrations still fail closed; future multi-step sync entry points must do the same.

This is proven, not just asserted: `tests/unit/storage-runs.test.ts` gained a new describe block ("Security review P2-A scope check") with 2 tests, both run with `navigator` stubbed to an object with no `locks` property (Web Locks unavailable): (1) `commitNewRun` still succeeds normally; (2) two concurrent `applyTransition(..., {type: 'START_SYNC'})` calls on the same run resolve to exactly one success and one `invalid_transition` rejection, with `attempt_count` ending at exactly 1 — proving IndexedDB's native transaction serialization, not a Web Lock, is what prevents corruption. No "sync entry point" exists yet in the codebase to gate (the brief's actual Drive-sync push/pull logic is future work) — there's nothing there to fix.

### 3. Fail-before/pass-after evidence, P1-A / P1-B / P1-C / P2-A

| Finding | File | Tests failing before fix | Tests passing after fix |
|---|---|---|---|
| P1-A | `tests/unit/storage-persistence.test.ts` | 3 of 10 | 10/10 |
| P1-B | `tests/unit/storage-schema.test.ts` | 1 of 13 | 13/13 |
| P1-C | `tests/unit/storage-comparisonIndex.test.ts` | 4 of 13 | 13/13 |
| P2-A | `tests/unit/storage-schema.test.ts` | written and iterated against the already-implemented fix (surfaced 2 real fake-indexeddb/idb interaction bugs: an unhandled-rejection double-dispatch on a thrown `upgrade()` error, and one on an unobserved aborted-transaction `.done` — not strictly fail-first) | 16/16, plus 2 pre-existing tests updated for the new behavior |

All of P1-A, P1-B, and P1-C followed strict fail-first discipline: test written, run against pre-fix code and confirmed failing, then fixed, then confirmed passing. P2-A's process note is carried forward unchanged from §14 for completeness, since this round's item 2 only *extended* the audit (concluding no further gate is needed) rather than re-touching the migration-lock code itself.

### 4. Open questions

**(a) Were the Step 3 review decisions recorded and applied?**

Yes, confirmed still in force, no drift, no changes needed:
- *A user-selected CSV that fails preview validation is rejected at preview with nothing written to storage.* Confirmed structurally: `grep -rn "storage" src/core/csv/` returns nothing — the CSV analysis module has zero references to the storage layer. Its exported entry point, `analyzeCsvBytes(bytes: Uint8Array): CsvAnalysis` (`src/core/csv/analyze.ts:30`), is a pure function with no `db` parameter and no side effects — it is structurally incapable of writing to IndexedDB. Only an already-built, already-validated `RunEnvelopeV1` (via `buildEnvelope`, itself downstream of a successful `analyzeCsvBytes` call) ever reaches `commitNewRun` or `ingestEnvelopeBytes`.
- *Quarantine is only for envelope-level inputs.* Confirmed by `ingest.ts`'s own doc comment (`src/core/storage/ingest.ts:78-81`, "Scope boundary (§9/§12 review)") and by the fact `ingestEnvelopeBytes` is the only writer of `quarantine_items`, called only from future Drive/backup-restore paths (none exist yet) — never from the CSV-import flow.
- *Step 3 review choices 1, 3, 5 remain as recorded in §12* — re-checked this round, no drift found (recorded in §15 item 1 process note above and unchanged from §14's own re-check).

**(b) Explain the 390 vs 391 baseline test count.**

Both numbers are correct, for different points in history. Directly re-running the code at commit `ac9fe6a` (the original Step 3 commit, before its own review) gives **390** tests. The Step 3 review commit `40e8d0d` then replaced 2 `countPendingRuns` tests with 3 `countAtRiskRuns` tests (net +1), landing at **391** — this is the number §13 (Bugbot findings) correctly started from and took 391 → 412. There is no discrepancy: 390 is pre-Step-3-review, 391 is post-Step-3-review/pre-Bugbot, and both figures are internally consistent with the commit history.

### 5. Full re-audit: every finding against its exact original wording

**Bugbot (7 findings, §13):**

| # | Exact requirement | Status | Reason |
|---|---|---|---|
| P1-1 | Ingest's schema-valid/conflict/variant routing must be one atomic transaction (no lost-variant race) | Resolved | `ingestEnvelopeBytes` wraps the check-and-route in a single `db.transaction([runs, runVariants, comparisonIdentity], 'readwrite')`, verified by the atomic-rollback test in `storage-runs.test.ts` |
| P1-2 | (schema/validation fix, §13) | Resolved | Unchanged since §13; not touched or re-broken by this round's work |
| P2-1 | (schema/migration fix, §13) | Resolved | Unchanged since §13; extended (not re-opened) by this round's P2-A scope check, which found no further gap |
| P2-2 | (fix, §13) | Resolved | Unchanged since §13 |
| P2-3 | At-risk count must cover every canonical run without a verified remote copy | Resolved | §13 added explicit `has_verified_remote_copy`; Security Review P1-A in §14 made it the sole authoritative durability signal used by `countAtRiskRuns` |
| P2-4 | (fix, §13) | Resolved | Unchanged since §13 |
| P2-5 | Discovery metadata must be non-authoritative, bounded, allowlisted, and sanitized at the storage boundary | **Resolved (completed this round)** | §13 established non-authoritative routing; this round's P2-B adds runtime sanitization with known keys, length limits, stable codes, and credential redaction before persistence |

**Security Review round 1 (5 findings, §14):**

| # | Exact requirement | Status | Reason |
|---|---|---|---|
| P1-A | (persistence fix, §14) | Resolved | Unchanged since §14; 10/10 tests passing |
| P1-B | (schema fix, §14) | Resolved | Unchanged since §14; 13/13 tests passing |
| P1-C | (comparison-index fix, §14) | Resolved | Unchanged since §14; 13/13 tests passing |
| P2-A | Guarded operations must fail closed (stable error code), not silently fall back, when Web Locks are unavailable — scope: confirm migrations only, or also commit/ingest/state transitions | **Resolved, scope confirmed this round** | Migrations already failed closed via `WebLocksUnavailableError` (§14). This round's audit confirms `commitNewRun`, `applyTransition`, and `ingestEnvelopeBytes` correctly do *not* need the same gate — each is a single atomic IndexedDB transaction, already safely serialized by the platform, and gating them would add a false failure mode with no safety benefit. Proven by 2 new tests with Web Locks stubbed unavailable. The brief's future Drive-sync "queue drain" entry point (which *would* need the gate) does not exist yet — nothing to fix there |
| P2-B | Quarantine discovery metadata needs a bounded allowlist schema: stable codes not free text, length limits, credential-shaped values rejected/redacted | **Resolved (implemented this round)** | New `sanitizeDiscoveryMetadata.ts` module, wired into both `quarantine()` and `ingestEnvelopeBytes()`; see item 1 above for full detail; 23 new/changed tests, all passing |

**Net result: every finding from both rounds is now resolved**, with two explicit, reasoned exceptions carried forward rather than silently dropped: P2-A's "sync entry points" (don't exist yet in the codebase — nothing to gate), and the general caveat that none of this storage-layer work has been exercised against a real browser's IndexedDB implementation, only `fake-indexeddb` in tests.

**Test count:** 425 → 446 (21 net new tests, confirmed by the actual `vitest run` output for this commit: 446 passed / 446 total, 19 test files). Breakdown: 21 new tests in `sanitizeDiscoveryMetadata.test.ts`, 2 new tests in `storage-ingest.test.ts` for P2-B, 2 new tests in `storage-runs.test.ts` for the P2-A scope check, and 1 existing `storage-ingest.test.ts` test corrected in place (not counted as new) — net +21 reconciles 425 → 446.

## 16. Step 4: import preview UI (2026-09-28)

**Scope:** the CSV import flow only — file choice, parsed-headers/warnings/errors preview, a preview table with the app's computed Volume Ratio, the Nifty 200 attestation, required `effective_date`, optional query text, duplicate-hash and empty-run confirmations, commit through the existing Step 2/3 envelope-builder and atomic-storage path, and a minimal committed-runs list with status indicators. Drive, OAuth, the service worker, deployment, and the comparison view are explicitly out of scope and were not touched.

**New source files:**
- `src/core/display/normalizeForDisplay.ts` — S3 display/sort normalization (trim outer ASCII space/tab/NBSP, collapse internal runs to one space; never folds case, unlike D3's header-matching normalization). The raw cell/header string in `analysis`/the envelope is never mutated; this is applied only where a value is rendered.
- `src/lib/db.ts` — one shared `openDatabase()` connection per page load.
- `src/lib/importMessages.ts` — maps every `ImportErrorCode`/`ImportWarningCode`/`VolumeRatioReason` to plain-language text (never color alone).
- `src/lib/PreviewTable.svelte`, `ImportForm.svelte`, `RunsList.svelte`, `StatusBar.svelte` — the UI, composed from `App.svelte`.
- `src/app.css` — shared design tokens (gold accent on solid, non-translucent backgrounds only; contrast chosen for WCAG 2.2 AA on `#ffffff`/`#1a1a1a`).

**Provider `VolumeRatio` column:** rendered as an ordinary original column (never merged into or substituting for the app-computed metric), with a `provider-reported, not the app ratio` badge appended to its header when `mapping.columns.providerVolumeRatio` identifies it. The app's own computed ratio is a separate, clearly-labelled trailing column (`App Volume Ratio (computed)`).

**Confirmation gating:** the Confirm button is disabled unless: the analysis is confirmable (no blocking errors), `effective_date` is a non-empty `YYYY-MM-DD` value (never derived from the filename — the date `<input>` has no default), the attestation checkbox is checked, the duplicate-hash acknowledgement is checked whenever `findRunsByOriginalFileHash` (checked as soon as the file parses, independent of the rest of the form) returns any match, and the empty-run acknowledgement is checked whenever the `EMPTY_RUN` warning is present. Cancel clears all local component state and never calls into storage — nothing is written unless Confirm is clicked and every required gate passes. A blocked-at-preview file (parse failure or blocking header/mapping error) never reaches `buildEnvelope`/`commitNewRun` at all.

**CSP:** `index.html` carries a `<meta http-equiv="Content-Security-Policy">` with `script-src 'self'` and `style-src 'self'` (no `unsafe-eval`, no `unsafe-inline`) — enforceable because Vite's production build emits the app as an external module script plus an external Svelte-compiled stylesheet, with no inline `<script>` or `style="..."` anywhere in the shipped HTML. `frame-ancestors` was tried and removed: browsers ignore that directive when delivered via `<meta>` (it only works as a real HTTP header) and log a console notice about it, which would itself look like a CSP problem in the "no CSP violation in console" test.

**Bug found and fixed (not test-first — found by manual reproduction, then covered by the Playwright suite):** the first working build's Confirm button silently did nothing. Root cause: Svelte 5's `$state` wraps assigned objects (here, the `CsvAnalysis` result and the `Uint8Array` file bytes) in a reactive `Proxy`; passing that proxy into `buildEnvelope`/`commitNewRun` reached `IDBObjectStore.add()`, whose structured-clone algorithm cannot clone a `Proxy` and threw an uncaught `DataCloneError` with no UI feedback. Fixed in `ImportForm.svelte`'s `confirm()` by calling `$state.snapshot(...)` on both values before they leave the component, which strips the proxy and yields a plain, cloneable object. A second, related bug in the same function — the success message was set, then immediately wiped by the internal `cancel()` call used to reset the form after a successful commit — was fixed by reordering: reset first, then set the message. Both bugs were caught by the Playwright suite (`import.spec.ts` tests 1, 4, 5 and `persistence.spec.ts` test 6 all failed against the code before these two fixes, and pass after), which is the fail-before/pass-after evidence for this item; there is no separate unit test for either since both are UI-wiring bugs with no meaningful unit-level surface — the storage-layer functions being called were already fully covered.

**Committed-runs list:** effective date, universe, stock count, sync state, and a text-labelled at-risk indicator (`isAtRisk`: not `quarantined`/`unsupported_schema` and `!diagnostics.has_verified_remote_copy` — the same rule as `countAtRiskRuns`, applied per-row). `StatusBar.svelte` shows the single-tab warning (`openDatabase()`'s `singleTabWarning`), persistent-storage support/grant status (`requestPersistentStorage()`), and the current at-risk count (`countAtRiskRuns()`), refreshed after every commit.

**Testing:**
- `@playwright/test` kept exactly pinned at `1.63.0` (already staged before this step; committed here for the first time). Managed Chromium **153.0.8010.12**. `msedge` project uses `channel: 'msedge'` against the installed Microsoft Edge **154.0.4258.37**.
- `playwright.config.ts`: `webServer` runs `npm run build && npm run preview` (the CSP meta tag and external-script/style build output only exist in the production build, not `vite dev`, which needs `eval` for HMR). Each test gets Playwright's default fresh browser context, which is already isolated storage per test — no additional isolation config was needed.
- 8 scenarios × 2 browser projects = 16 Playwright tests, all passing: real 7-row sample import (`samples/Nifty200 All_September 27, 2026 (2).csv`, hash-verified via the existing `verifiedSample` convention is not used here since Playwright drives the real file picker directly against the path — the file's integrity is what the browser actually reads, so a separate hash check would be redundant); cancel-leaves-storage-empty (checked via a raw `indexedDB` count, not just the UI); missing-numerator blocked with zero writes (checked the same way, across both `runs` and `quarantine_items`); duplicate-hash re-import requiring explicit acknowledgement; header-only CSV requiring explicit acknowledgement and committing stock count 0; reload persistence; a real v1-shaped database (seeded via raw `indexedDB` calls on the app's own origin, with the app's bundle temporarily intercepted via `page.route` so it can't open the database first) upgrading to v2 with the `by_normalized_nse_code` index, rebuilt comparison rows with populated `normalized_isin`/`normalized_nse_code`, and the conservative `has_verified_remote_copy` flag (`true` only for the run that was actually `synced`, `false` for one that was `error`); and no CSP-violation console messages across a full import-and-reload cycle.
- New fixture: `tests/fixtures/synthetic/SYNTHETIC_header_only.csv` (header row only, matching `SYNTHETIC_HEADER`'s column names).
- New unit test: `tests/unit/normalizeForDisplay.test.ts` (6 tests) for the S3 display-normalization function — the one piece of new Step 4 logic with real unit-level determinism; the rest of the new code is UI wiring already exercised end-to-end by Playwright.
- Unit suite: 446 → 452 (+6). Full `npm run verify` (format, lint, svelte-check, 452 unit tests, build) green, plus all 16 Playwright tests green, run immediately before this commit.

**Accessibility:** every input has an associated `<label for>`; the effective-date input has `aria-describedby` pointing at its help text; blocking errors render inside a `role="alert"` container tied to the file input via `aria-describedby`; warnings, status, and success messages use `role="status"`/`role="alert"` with `aria-live` where appropriate; nothing is communicated by color alone (every badge carries text, e.g. "At risk — no verified backup", not just a colored dot); focus is left to the browser's native `:focus-visible` ring (styled at 3px, offset, on the shared focus color) rather than suppressed; the horizontally-scrollable preview table is a `role="region"` with `tabindex="0"` so keyboard users can scroll it (a deliberate, lint-suppressed use of `tabindex` on a non-interactive landmark — the standard pattern for keyboard-operable overflow regions); all CSV values are rendered through Svelte text interpolation only (never `{@html}`), so they can never be interpreted as markup; text sits only on solid `#ffffff`/`#f7f5f0` backgrounds, never on a translucent surface.

## 17. Step 4A: multipart CSV import, envelope schema v2 (2026-09-28)

### Amended decision: M1 "one CSV = one run"

**M1 is amended.** §8/§9's original decision ("single-file exports only; one CSV = one run") is replaced: Trendlyne caps every export at 100 rows, so a run may now be built from **one complete CSV, or two or more explicitly user-selected pagination parts of the same result**, combined in user-selected file order followed by row order within each file. This is additive, not a reversal — a single-file import is still exactly the v1 behavior, byte-for-byte unchanged (see "Backward compatibility" below). The M1 page-size warning (`POSSIBLE_PARTIAL_PAGE`) stays exactly as it was: informational, computed independently per file, and never escalated or reinterpreted at the combined level — a combined run that validates to exactly 200 unique stocks carries no additional "might be incomplete" messaging beyond each part's own (already-non-blocking, already-existing) page-size note.

### New module: combining and cross-validating parts (`src/core/csv/multipart.ts`)

`analyzeMultipartParts(parts)` runs the existing, unmodified `analyzeCsvBytes` independently on every part (so every existing single-file rule — limits, header mapping, numeric grammar, identifier validation, per-file warnings — applies unchanged, per file) and only then combines the results:

- **Any per-part blocking failure (parse error or blocking header/mapping error) rejects the whole multipart preview** (`ok: false`) before any combination or cross-part logic runs at all — nothing is written in that case, same guarantee as a single-file blocking error.
- **Combined ordering** is exactly source order (as selected/returned by the browser's multi-file picker) then row order within each source — never reordered, never deduplicated.
- **Three blocking cross-part identity rules**, evaluated only once every part individually confirms:
  1. `DUPLICATE_ISIN_ACROSS_PARTS` — the same *valid* ISIN appears in rows from two or more distinct parts (this is what catches overlapping-part selection: reselecting the same page twice, or picking two pages that share rows).
  2. `SAME_NSE_CODE_DIFFERENT_ISIN` — the same normalized NSE Code co-occurs with two or more distinct valid ISINs anywhere in the combined set (mirrors the existing cross-run conflict rule in `comparisonIndex.ts`, applied here at preview time within one candidate run).
  3. `AMBIGUOUS_NSE_CODE_ACROSS_PARTS` — a row whose *only* usable identifier is a provisional NSE Code (ISIN missing/invalid) shares that NSE Code with a same-kind row in a *different* part — blocked as ambiguous rather than silently deduplicated, per this round's explicit instruction.
  A **within-part** duplicate ISIN/NSE Code is deliberately left exactly as before (the existing non-blocking `DUPLICATE_ISIN_IN_RUN`/`DUPLICATE_NSE_CODE_IN_RUN` warnings, per file) — only a duplicate that *spans distinct parts* blocks, since that is specifically what signals a bad part selection.
- **Combined unique-stock count** = the count of distinct identity keys (`isin:<normalized>` for a valid-ISIN row, `nse:<normalized>` for a provisional-NSE-only row) across the whole combined set — naturally collapses a same-part duplicate to one, and is independent of `overlapErrors` (computed either way, but confirmation is blocked first by any `overlapErrors`).
- **Non-200 warning** (`COMBINED_COUNT_NOT_200`): non-blocking, fires whenever the unique count isn't exactly 200; the UI requires a separate explicit acknowledgement checkbox before Confirm is enabled, exactly mirroring the existing empty-run/duplicate-file acknowledgement pattern from Step 4.

Tested in `tests/unit/multipart-combine.test.ts` (10 tests): the two real disjoint 100-row samples combine to 200 with zero overlap errors and source-order preserved; reversed selection order still works; one blocked part rejects the whole preview (both a per-part blocking header error and a parse-level failure); differing header column order between parts is handled independently per part; all three blocking rules are exercised individually with fabricated valid-ISIN fixtures (a real, check-digit-valid synthetic ISIN generated the same way the existing `identifiers-warnings.test.ts` fixture was); a within-part duplicate does **not** block; the non-200 warning fires correctly.

### Envelope schema v2 (`src/core/envelope/schema/envelope.v2.schema.json`) — backward compatible

**`RunEnvelopeV1` is untouched.** v2 is a new, additive, independently-versioned schema (`schema_version: "2"`) compiled to its own standalone Ajv validator (`validateEnvelopeV2`, no `eval`/`new Function`, same CSP posture as v1) via a generalized `scripts/compile-schema.mjs` that now loops over both schema files. The generated v1 output is **byte-for-byte identical** to before this change (confirmed via `git diff --stat` immediately after regenerating both from the current schemas) — only its `.d.ts` companion's internal type name changed (`EnvelopeV1Validator` → `EnvelopeValidator`, unused outside the generated file itself), which is not the CSP-relevant artifact and does not affect `validate.ts`.

Shape, per the round's exact requirements:
- `source_files: SourceFileV2[]` (`minItems: 2` in the schema) — every source file preserved **independently and losslessly**: `original_filename`, `original_file_mime_type`, `original_file_byte_length`, `original_file_sha256` (lowercase 64-hex), `original_file_base64` (canonical RFC 4648), `parser` (the same `ParserProvenanceV1` shape v1 already used), `headers` (ordered, exact), `rows` (ordered, exact), and that file's own `import_warnings` — i.e. every field v1 kept at the top level for its one file, just repeated per file.
- `combined_row_refs: {source_index, source_row_index}[]` — records which source part and which row within it produced every combined row, index-aligned with `computed_metrics.volume_ratio_v1` (kept separate from raw data, per the round's instruction, exactly as v1 keeps `computed_metrics` separate from `rows`).
- `stock_count` keeps v1's exact meaning (total combined row count, `=== combined_row_refs.length`); a new `unique_stock_count` field is the deduplicated count (what the brief's "combined unique-stock count" refers to) — two distinct fields rather than overloading one, so nothing downstream has to guess which meaning `stock_count` has for a given schema version.
- Combined-level warnings (currently only `COMBINED_COUNT_NOT_200`) get their own new, narrow type (`CombinedImportWarningCode`/`CombinedImportWarning`, `{code, unique_stock_count}`) rather than being folded into the existing per-cell `ImportWarningCode` enum — that enum is shared by v1's schema and re-asserted equal to the TS source by `envelope-schema-codegen.test.ts`; adding a v2-only code to it would have forced either a spurious addition to the v1 schema (implying v1 could carry a warning that makes no sense for a single-file run) or broken that equality test. Each source file's own warnings stay the existing, unmodified `ImportWarning[]` type.
- `envelope_hash_algorithm`/`envelope_sha256`: identical mechanism to v1 — RFC 8785 JCS over every other top-level field via the same `jcsSha256Hex`, excluding only `envelope_sha256` itself.

Tested in `tests/unit/envelope-build-multipart.test.ts` (11 tests): builds a valid v2 envelope from two parts; every source file's provenance fields are correctly preserved and independently hashed; `validateEnvelope` reports a freshly-built envelope `valid`; **hash stability** (rebuilding from identical inputs with the same `run_id`/`imported_at` reproduces the same `envelope_sha256`); **tampering detection** (a changed source row, a changed source-file hash, a reordered `combined_row_refs`, and a tampered `unique_stock_count` are each independently caught and quarantined with a distinct, correct reason code); `buildMultipartEnvelope` correctly refuses (`cannot_confirm`) when the input analysis has a blocking overlap error.

### `validateEnvelope`: v2 replay

`validate.ts` is split into `validateV1` (the original logic, unchanged) and a new `validateV2`, dispatched on `schema_version` from the same top-level function. v2 replay re-parses **every** preserved source file (via the same unmodified `analyzeCsvBytes`), confirms each file's headers/rows still match what was recorded, then walks the recorded `combined_row_refs` against the **replayed** per-part analyses to reproduce `computed_metrics.volume_ratio_v1` and `unique_stock_count` independently, comparing both to what's stored. New quarantine reasons: `SOURCE_FILE_HASH_MISMATCH`, `COMBINED_ROW_REF_OUT_OF_RANGE`, `UNIQUE_STOCK_COUNT_MISMATCH` (added to the shared `QUARANTINE_REASONS` enum, clearly marked "v2 (multipart) only" in a comment — this list isn't schema-enforced anywhere the way the warning-code enums are, so no v1/v2 schema coupling issue arises from extending it).

Deliberately **not** re-checked at replay time: the three blocking overlap rules (`DUPLICATE_ISIN_ACROSS_PARTS` etc.) — those are a commit-time UI gate on what may be confirmed, not a property of whether already-stored data is an honest, reproducible transformation of its own preserved bytes. Re-enforcing them at replay would let a future stricter overlap rule retroactively quarantine an already-legitimately-committed historical run, which is exactly the kind of silent reinterpretation this app's storage layer is designed to avoid.

**Existing test fixed:** two pre-existing tests in `envelope-validate.test.ts` used `schema_version: '2'` specifically to simulate "some future, unrecognized version" (expecting `unsupported_schema`). Since `'2'` is now real and supported, both were updated to use `'3'` instead — the underlying behavior they test (an unrecognized version reports `unsupported_schema`, never forced through either known schema) is unchanged and still passes. The same fix was applied to four `schema_version: '2'` occurrences in `storage-ingest.test.ts`'s `unsupported_schema` describe block, for the same reason.

### Storage: no schema/index change, generalized comparison-index derivation, new duplicate-detection queries

**`DB_VERSION` is unchanged (still 2) — no migration was added for this round.** `RunRecord.envelope` widens to `RunEnvelopeV1 | RunEnvelopeV2 | UnsupportedSchemaEnvelope`; IndexedDB doesn't type-check stored values against a keyPath, so this widening needs no schema migration. `commitNewRun` already commits the envelope, the rebuilt comparison-identity index, and the initial `pending` sync state in one atomic IndexedDB transaction (the existing Bugbot-P1-1-era guarantee) — this was true before this round and needed no change to also cover v2; only `deriveComparisonRows` (and its `mapColumns`-based helper) needed generalizing to read identity inputs from either a v1 envelope's flat `headers`/`rows`, or a v2 envelope's `combined_row_refs` walked against each referenced `source_files[i]`'s own header mapping (parts may have differently-ordered headers; each is mapped independently, exactly as `analyzeCsvBytes` already does per part). `ComparisonIdentityRecord.row_index` needed no new field: for v2 it simply means "position in `combined_row_refs`," the same "this run's own row position" meaning it already had for v1's `rows`.

**Duplicate-file detection was extended, not indexed.** The round asked for two distinct signals:
- `findRunsBySourceFileHash(db, sha256)` — does this hash belong to *any* previously-imported file, whether committed as a v1 single-file run or as one part of a v2 multipart run? Covers "any selected source file was imported previously."
- `findRunsByExactSourceHashSet(db, orderedHashes)` — does any existing run's *complete, ordered* set of source-file hashes exactly equal this candidate set? The stronger signal: "this exact combination of files, in this exact order, was already imported as one run."

Both are a full scan over `getAllRuns()`, not a new IndexedDB index. `v1's original_file_sha256` and `v2's source_files[].sha256` can't share one native index (a native IndexedDB index keyPath can't reach into an array of objects' subfield the way a `multiEntry` index reaches into an array of primitives), and the realistic dataset size for this personal, local-first app (no server, a human's own import history) makes a linear scan the simpler, lower-risk choice over adding a redundant top-level hash-array field purely for indexing — consistent with this app's existing "no server, no scale" posture. The original v1-only, index-backed `findRunsByOriginalFileHash` is untouched and still used by Step 4's single-file duplicate warning.

Tested in `tests/unit/storage-multipart.test.ts` (8 tests): atomic commit of a v2 run (envelope + 2 correctly-derived comparison rows + initial `pending` state, all in the one transaction); **atomic rollback** on a `run_id` collision leaves zero partial comparison rows (mirroring the existing v1 rollback test exactly); a v1 run and a v2 run **coexist** in the same database with no interference (both independently listed, fetched, and comparison-indexed); `findRunsBySourceFileHash` finds a v1 run by its one hash, a v2 run by either of its two part hashes, and returns empty for an unknown hash; `findRunsByExactSourceHashSet` matches only the exact ordered complete set (not reversed, not a subset); a file previously used inside a multipart run is still traceable by hash when the same bytes are later re-imported standalone.

### UI: a mode toggle, not a rewrite of the single-file flow

Per the round's explicit "keep the existing single-file flow unchanged" instruction, `ImportForm.svelte` (Step 4) was **not modified**. A new `MultipartImportForm.svelte` implements the parallel flow, and `App.svelte` gained a radio-button "Import type" toggle (Single file / Multipart export) selecting which one renders; neither component is aware of the other. The multipart form: a `<input type="file" multiple>` (order preserved as the browser returns it — "user-selected file order" is interpreted as whatever order the browser's own multi-select dialog yields, since there is no standard way for a page to further reorder an already-made native multi-file selection without a custom drag-and-drop reordering UI, judged out of scope for this round); per-part filename/row-count/warnings/blocking-errors list; a combined-preview table (source file, source row, identity, computed Volume Ratio — deliberately a synthesized summary rather than attempting to align differing per-part column layouts into one table, since parts are not guaranteed to share column order); the shared effective-date/attestation/query-text fields; conditional prior-import and non-200 acknowledgement checkboxes (exact same accessible pattern as Step 4's duplicate/empty-run checkboxes: `role="status"`, a required checkbox, Confirm disabled until checked); and Confirm/Cancel with the identical `$state.snapshot(...)` guard against the Svelte-5-proxy `DataCloneError` that Step 4 discovered — applied here proactively from the start, so it was never hit during this round's manual or Playwright testing. `RunsList.svelte` gained one new "Source" column ("1 file" / "N parts") and its `RunEnvelopeV1`-only type guard was generalized to accept either schema version (same non-null-assertion-free type-guard-function pattern Step 4 already used, since the union's `UnsupportedSchemaEnvelope` index signature defeats plain `schema_version === '...'` control-flow narrowing).

### Testing

- `tests/e2e/multipart.spec.ts`: selects the two real 100-row samples (`samples/Nifty200 All_September 27, 2026.csv`, `samples/Nifty200 All_September 27, 2026 (1).csv`) via the multipart file input, confirms the combined-preview shows exactly 200 combined rows / 200 unique stocks with the computed-ratio column present, confirms the import, asserts the success message and that the committed-runs table shows **exactly one row with stock count 200** (and explicitly asserts no `100`-count cell exists) with `Source` reading "2 parts," then reloads and re-asserts the same single 200-stock row persists.
- Both real samples' SHA-256 hashes were verified against `DECISIONS.md` (§1) before use in this round: `Nifty200 All_September 27, 2026.csv` → `65f0e577a7edf533a0946ddf8d5f050c0ea4606f1845a6026c0e49d187c3b252`; `Nifty200 All_September 27, 2026 (1).csv` → `419721aa234b83a84fae4c7808d5b1b223bcaf05443bcd2778a2e6be7eb84e2f` — both matched, and both files were independently confirmed disjoint (0 ISIN overlap) and header-identical before writing any test.
- Full pipeline immediately before commit: `npm run verify` (format, lint, svelte-check — 411 files, 0 errors/warnings — 489 unit tests, build) green; `npx playwright test` (both projects, all specs, including every existing Step 4 spec) — **18/18 passing** (9 scenarios × 2 browsers: the 8 from Step 4 plus this round's multipart scenario).
- **Test counts:** unit 452 → 489 (+37: 10 in `multipart-combine.test.ts`, 11 in `envelope-build-multipart.test.ts`, 8 in `storage-multipart.test.ts`, plus 8 assertion-shape updates spread across `envelope-validate.test.ts`/`storage-ingest.test.ts`/`storage-runs.test.ts`/`envelope-schema-codegen.test.ts` that changed existing tests rather than adding new ones). Playwright 16 → 18 (+2: the new multipart scenario × 2 browsers). Playwright/Chromium/Edge versions unchanged from Step 4 (`1.63.0` / `153.0.8010.12` / `154.0.4258.37`).

**Out of scope, per this round's explicit instructions and unchanged from Step 4:** Drive, OAuth, the service worker, deployment, deletion of the two pre-existing v1 runs (confirmed untouched — `git status` shows no modification to any prior commit's data, and this is a fresh database on every test run in any case), and Step 5 comparison views.

## 18. Step 5A: run history and full stock-table views (2026-09-28)

**Scope:** replaces the minimal committed-runs proof table with a full run-history view (Views §1's default order, stated explicitly in the UI, and every field the round required) and adds a run-detail view opened by selecting a run, showing its complete, typed-sortable stock table for both v1 and v2 envelopes. Drive, OAuth, the service worker, deployment, portable backup/restore, conflict-resolution UI, deletion, and Step 5B's longitudinal comparison view are explicitly out of scope and untouched. No IndexedDB schema/version change was needed — everything here is derived, at render time, from already-validated stored envelopes.

### New pure TypeScript modules (`src/core/display/`, plus one in `src/core/storage/`)

Per the round's "sorting/type-detection and v1/v2 row-projection logic in pure TypeScript modules, not inside Svelte components" instruction, all of the following have zero Svelte/DOM dependency and are independently unit-tested:

- **`runOrder.ts`** — `compareRunsForHistory`/`sortRunsForHistory`: `effective_date` descending, then `imported_at` descending, then `run_id` ascending as the final tiebreaker. Both date fields are ISO 8601/RFC 3339 UTC strings, so plain string comparison is already chronologically correct — no `Date` parsing needed for this comparator. A run whose envelope isn't a known, supported schema (no dates to sort by) sorts after every supported run, ordered among themselves by `run_id` alone, so the list stays fully deterministic even then.
- **`sorting.ts`** — the generic typed-column sort engine: a `SortValue` union (`numeric` via an isolated `Big.js` instance — never native binary floating-point; `text` via S3 normalization + lowercase; `date` via `Date.parse`; `missing` for anything blank/grammar-invalid/invalid), `sortByColumn` (missing/invalid always sorts last in **both** directions — implemented by comparing missing-ness independent of `direction`, only flipping the comparison sign for two present values — with the original row position as the final, stable tiebreaker), `numericSortValue`/`decimalStringSortValue`/`textSortValue`/`dateSortValue`, and `detectColumnKind` (a raw column is numeric only if every present, non-blank cell matches the frozen A3/G1 grammar; a grouping-comma value or any other grammar failure makes the whole column text, per "provider numeric columns matching the decided numeric grammar sort numerically").
- **`runRows.ts`** — `projectRunRows(envelope)`: for v1, columns are the envelope's headers verbatim, positionally (duplicate/blank raw headers are never merged, per Engineering Standards — each physical column stays independently addressable); for v2, columns are the union of every source file's headers by D3-normalized key, in first-seen order, and each combined row is read using **its own source part's** header mapping (`combined_row_refs` order; a column a given row's part doesn't have renders as `undefined`, distinct from a genuinely blank cell). Per-row identity and `volume_ratio_v1` are recomputed from the raw cells via the existing `mapColumns`/`buildStockIdentity`/`computeVolumeRatio` — never read back from the envelope, since neither v1 nor v2 persists them (see `RunEnvelopeV1`'s own doc comment). Raw headers and cells are never mutated; S3 (`normalizeForDisplay`) is applied only to `DisplayColumn.label`.
  - **Known, deliberate limitation:** if a single v2 *part* has a duplicate normalized header (never observed in real data — G1-frozen headers have none — and possible only in a contrived synthetic fixture), only the first occurrence is addressable in the union view; no row or any other column is affected. Documented in the module itself rather than worked around, since real Trendlyne exports cannot trigger it.
- **`runTable.ts`** — `buildRunTableColumns(projection)`: assembles the full sortable column set — source file/row provenance columns (v2 only), an `Identity` column, every projected raw column (kind auto-detected via `detectColumnKind`), and the app-computed Volume Ratio column, always last and always distinct from whichever raw column D3 maps as the provider's own `VolumeRatio` (`isProviderVolumeRatio`, checked via `FIELD_DEFINITIONS.providerVolumeRatio.aliases` against the column's normalized `headerKey` — a separate field from `DisplayColumn.key`, added specifically because a v1 column's `key` is positional, not the normalized header, and provider-column detection needs the real normalized key regardless). Every column returned carries its own `getSortValue`, so "every visible stock-table column must be sortable" holds by construction, not by a UI-side checklist.
- **`storage/runStatus.ts`** — `isEnvelopeV1`/`isEnvelopeV2`/`isSupportedEnvelope` (centralizing the type guards `RunsList.svelte` previously kept as private local copies) and two new predicates: `isRunAtRisk` (`persistence.ts`'s `countAtRiskRuns` now calls this directly instead of keeping its own copy of the same rule — the only change to existing Step 4 code besides the export list) and `isRunOpenable` (a run may enter run-detail only when its envelope is a known schema **and** its current sync state isn't `conflict`/`quarantined`/`unsupported_schema` — re-evaluated live against the run's current state on every call, never cached, so a run that later resolves out of one of those states becomes openable immediately with no separate step).
- **`src/lib/route.ts`** — the one non-pure-in-spirit-but-still-pure-in-code piece: `parseRunIdFromHash`/`runDetailHash` implement `#/run/<run_id>` as the only route besides the list, as plain string functions (unit-tested directly); reading/writing `location.hash` itself happens only in `App.svelte`.

### UI: `RunHistory.svelte` (replaces `RunsList.svelte`) and new `RunDetail.svelte`

- **`RunHistory.svelte`**: the full table (effective date, imported timestamp, universe, stock count, source type/count, sync state, backup/at-risk status, and the run ID in a shortened form with the complete value as the element's accessible name via `aria-label`, plus a `title` tooltip) in `sortRunsForHistory` order, with a `<p>` immediately above stating that order in plain language (Views §1's "state this ordering explicitly in the UI"). Each openable run gets a real `<a href="#/run/<id>">Open</a>` — native browser navigation, so keyboard operability and the back button both come from the platform, not custom JS — with a visually-hidden suffix disambiguating same-date runs for screen-reader users tabbing through repeated "Open" links. A `conflict`/`quarantined`/`unsupported_schema` run (or one with an unrecognized schema entirely) still appears, for status visibility, but gets a plain-text "Not available — `<reason>`" badge instead of a link — never openable, per the round's instruction.
- **`RunDetail.svelte`**: loads the run by ID (`getRun`), and branches on `isRunOpenable`: not found → an error message; blocked → a labelled explanation naming the blocking state; empty (`projection.rows.length === 0`) → an explicit "This run has zero stocks" status message, no table rendered; otherwise the full stock table. Column headers are real `<button>`s inside `<th scope="col" aria-sort="...">` (`none`/`ascending`/`descending`), toggled by click **and** native keyboard activation (Enter/Space on a real button, no custom key handling needed); the active column also shows a plain-text ▲/▼ marker (`aria-hidden`, since the state is already announced via `aria-sort`) — never color alone. The provider `VolumeRatio` column (when present) keeps the same gold "provider-reported, not the app ratio" badge Step 4's `PreviewTable` already used, and the app-computed column is always a separate, later column — S2 kept intact. All CSV-derived text renders through Svelte interpolation only, exactly as every prior step's tables do; no `{@html}` was introduced. The table sits in the same `role="region"`/`tabindex="0"` horizontally-scrollable wrapper pattern already used by `PreviewTable`/`MultipartImportForm`, so every column stays keyboard-reachable on narrow viewports.
- **`App.svelte`**: gained a `selectedRunId` state read from `location.hash` on load and kept in sync via a `hashchange` listener (added/removed in `onMount`'s cleanup), rendering `RunDetail` instead of the import UI + `RunHistory` when a run is selected. Because this is real `location.hash` navigation (not virtual/in-memory routing), a reload while on `#/run/<id>` re-opens the database and renders the same run directly — the route survives reload for free, satisfying the round's "preserved across reload is preferred if implemented without expanding scope" with no extra code.

### Existing Step 4/4A tests updated for the new accessible name (behavior itself unchanged)

`RunHistory`'s "Open" links carry each row's date in their **accessible name** (`Open run <shortId> (<date>)`, for screen-reader disambiguation between repeated "Open" links). Five pre-existing assertions elsewhere in the e2e suite located a run's date via a *substring, non-exact* text/cell match scoped to the run-history table; once that table also contains a cell whose accessible name **contains** the same date substring (the "Open" cell), those matches became ambiguous (two elements) and would break — masked in this cloud checkout only because the specific scenarios that reach a committed real-sample run never get past the `samples/` `ENOENT`, so the true regression only surfaced via `migration.spec.ts` (which seeds via raw IndexedDB, not a real file, and so isn't blocked by missing samples). Fixed by adding `exact: true` (`persistence.spec.ts`, `import.spec.ts` test 1, `migration.spec.ts`) or scoping to the run-history table plus `exact: true` (`csp.spec.ts`) — the underlying guarantee each test makes (the run's date is visible / no CSP violation) is unchanged; only the locator's precision was fixed. `multipart.spec.ts`'s `'2 parts'` cell match needed no change (that substring never appears in the new accessible name). Confirmed via a full run of every pre-existing spec, not just the ones touched.

### New synthetic fixtures

`SYNTHETIC_run_history_multipart_1.csv` / `_2.csv` (`tests/fixtures/synthetic/`, README updated): a two-part multipart pair whose parts deliberately reorder their headers differently from each other (proving `runRows.ts` reads each part via its own mapping, not a shared position), combining to Volume Ratios 0.900 / 2.000 / 9.000 / 10.000 — chosen specifically so both the unit-level `sorting.ts` tests and an end-to-end Playwright run prove real numeric ordering (2 < 9 < 10), never lexicographic, through the actual UI, not only the isolated comparator.

### Testing

- Unit: `tests/unit/sorting.test.ts` (18), `runOrder.test.ts` (6), `runRows.test.ts` (11), `runTable.test.ts` (8), `route.test.ts` (4) — every acceptance point the round listed (deterministic ordering incl. same-date/same-imported-time ties; v1 and v2 row projection incl. differing per-part header order; multipart source provenance and combined order; `"2.000"`/`"9.000"`/`"10.000"` numeric sort; provider numeric sort under the grammar; case-insensitive S3-normalized text sort; chronological date sort; missing/invalid last in both directions; stable row-position tiebreak; empty runs; blocked-opening for `conflict`/`quarantined`/`unsupported_schema`; raw values unchanged after projection/sorting) is covered at this level, not just asserted in prose.
- `tests/e2e/run-history.spec.ts` (new, 6 scenarios): run-list ordering with the stated-order text visible; opening a v1 run, sorting its computed-ratio and Stock columns both directions with `aria-sort` checked at each step; opening a v2 multipart run with Source file/Source row columns visible and the same 2/9/10 numeric proof end-to-end; keyboard-only navigation from run history into a run and back (`.focus()` + `Enter`, no mouse); an empty run's explicit zero-stock state; the selected run surviving a full page reload.
- Full pipeline, run under Node **24.20.0** (matching `package.json`'s `"node": ">=24"`): `npm run verify` (format, lint, svelte-check — 425 files, 0 errors/warnings — **507/507 unit tests passing**, 29 skipped, build) green. `npx playwright test`, chromium (this container has no `msedge`/`microsoft-edge` binary — Microsoft Edge is `NOT TESTED — browser unavailable`, same as every prior round in this cloud checkout), every spec (Step 4/4A's plus this round's), **15 scenarios total, 9 passing / 6 `NOT TESTED — sample unavailable`**: the 6 are exactly the pre-existing real-`samples/`-dependent scenarios from Step 4/4A (`import.spec.ts` ×3, `csp.spec.ts`, `multipart.spec.ts`, `persistence.spec.ts`) — identical failure set to every prior round's cloud verification, not a regression. All 9 sample-independent scenarios pass, including this round's 6 new ones and, notably, `migration.spec.ts` (seeded via raw IndexedDB, not a real file — its assertion needed the `exact: true` fix below, not a sample, so it now passes where it previously would not have without that fix).
- **Test counts:** unit 489 → 536 (+47, all new tests — no existing unit test was changed). Playwright scenario count 9 → 15 (+6, the new `run-history.spec.ts` file); across both configured projects (chromium + msedge) that is 18 → 30 defined test cases, though only the chromium ones are runnable in this container. 5 pre-existing Playwright assertions were tightened (`exact`/scoped) as described above, not weakened or removed.

**Out of scope, confirmed unchanged:** Drive, OAuth, sync execution, account binding, the service worker, deployment, portable backup/restore, conflict-resolution UI, deletion, and any change to CSV grammar, metric definitions, or envelope hashing — `git diff` against the pre-Step-5A commit touches only display/routing modules, the two new Svelte views, `App.svelte`'s view switch, one `persistence.ts` refactor to reuse `isRunAtRisk` (behavior identical, verified by its own existing tests still passing unchanged), and test/fixture files. Step 5B (longitudinal comparison) was not started.

### Post-merge-review correction: `volume_ratio_v1` was being recomputed, not read from the envelope

A PR review (before merge) found that `runRows.ts` recomputed `volume_ratio_v1` from raw cells via `computeVolumeRatio()`, and its own doc comment incorrectly claimed the metric "isn't persisted in the envelope" — it is (`computed_metrics.volume_ratio_v1`, both v1 and v2). Functionally harmless in practice (a pure, deterministic function of the same raw cells the metric was originally computed from, and `validateEnvelope`'s replay already guarantees the stored value matches what recomputation would produce for any run `isRunOpenable` lets the UI reach), but wrong in principle: historical display data must be read from the immutable stored record, not silently rederived.

**Fix:** `identityAndProvider()` now derives only identity (a genuinely rebuildable, never-persisted index) and the provider's raw `VolumeRatio` cell; a new `historicalVolumeRatio(envelope, index)` reads `envelope.computed_metrics.volume_ratio_v1[index]` directly — by row index for v1, by combined-row index for v2 — and **throws explicitly** if the index has no entry, rather than falling back to recomputation (an "impossible" case in practice, since `buildEnvelope`/`buildMultipartEnvelope` construct the array index-aligned by construction and `validateEnvelope` re-checks it before commit). `computeVolumeRatio` is no longer imported by `runRows.ts` at all. Both doc comments (module-level and the `ProjectedRow.volumeRatio` field) were corrected.

**Regression tests added** (`tests/unit/runRows.test.ts`, +3): a v1 test that deliberately overwrites the in-memory stored metric to a value recomputation could never produce (raw cells 1500/1000 would give "1.500"; the tampered stored value is "9.999") and asserts the projection shows the tampered *stored* value — proving the read path, not just that the "normal" numbers happen to match; an equivalent v2 test proving the same by combined-row index; and a test asserting `projectRunRows` throws when a stored metric entry is missing at a row's index, rather than silently recomputing one. Each tampered envelope is a view-layer test fixture only — never passed through `validateEnvelope`, never treated as a real committed run. Identity-from-raw-cells and no-mutation-of-the-envelope were already covered by existing tests in the same file and re-verified unaffected.

**Verification:** focused (`runRows`/`runTable`, 22/22), full `npm run verify` (539/539 unit tests, up from 536; format/lint/check/build green), and full `npm run test:e2e` (30/30, unchanged — no sorting or UI behavior regressed) all green before committing.

## 19. Step 5B: longitudinal stock comparison across runs (2026-09-28)

**Scope:** a comparison view where the user selects one stock identity and sees its appearance/metrics across eligible historical runs — Views §2's "pick a stock ... and show its appearance and metrics across multiple past runs," amended for both v1 and v2 envelopes. Drive/OAuth/sync execution, the service worker, deployment, backup/export/restore, conflict-*resolution* UI, identity alias records, and deletion remain untouched and out of scope, as does Step 6.

### Architecture: pure identity/projection logic, one new storage query, two new views

Per this round's explicit "do not create a second identity-matching implementation in Svelte" instruction, every piece of comparison logic — identity selection, eligible-run projection, absence expansion, deterministic ordering — lives in plain TypeScript, reusing Step 4/4A/5A's existing machinery rather than re-deriving any of it:

- **`src/core/storage/comparisonIndex.ts`** gained one new query, `listComparisonIdentityGroups(db)`: enumerates every distinct `identity_key` with at least one occurrence in a currently-*eligible* run, grouping the existing `comparison_identity` rows it already reads via the exact same one-transaction, live-state-filtered pattern `queryComparisonIndexByIdentity`/`findIdentityConflicts` already use (`EXCLUDED_FROM_COMPARISON = {conflict, quarantined, unsupported_schema}`, evaluated fresh on every call, index rows never deleted). This is the stock picker's data source — built from the persisted, rebuildable index, never from raw stock-name text, per the round's explicit instruction. **No `DB_VERSION` bump, no new IndexedDB index** — grouping happens in memory from the existing `getAll()` read.
- **`src/core/display/comparison.ts`** (new, zero Svelte/DOM dependency): `identityKeyForIdentity(identity)` computes the same `isin:<x>`/`nse:<x>` key `comparisonIndex.ts` uses, from an already-derived `StockIdentity` (e.g. a run-detail row's `.identity`), via the existing exported `isinIdentityKey`/`nseIdentityKey` helpers — so a UI can link from any row straight into its comparison view without re-implementing matching. `buildComparisonPickerEntries(groups, runsById)` turns `listComparisonIdentityGroups`'s output into picker options with a cosmetic representative stock name (looked up via the existing `projectRunRows`, never authoritative). `buildComparisonResult(group, runs)` builds one identity's full longitudinal comparison: orders the given runs via a new `compareRunsChronologically`/`sortRunsChronologically` pair in `runOrder.ts` (Views §1's amended Step 5B default: `effective_date` ascending, then `imported_at` ascending, then `run_id` — sharing `runOrder.ts`'s existing `sortableDates` extraction and tiebreak convention with the unchanged `compareRunsForHistory`, so the two orderings can never independently drift), then for each run either finds its occurrence's row via `projectRunRows` (reusing Step 5A's v1/v2 row projection, which itself reads `computed_metrics.volume_ratio_v1` verbatim per this round's own correction commit — comparison metrics were **never** at risk of the recomputation bug, since they're built on the already-fixed `runRows.ts`) or reports `{ status: 'absent' }` — explicit, never blank/zero/an error. A run with more than one occurrence of the same identity (an already-flagged within-run duplicate) uses only the first by ascending `row_index`; every occurrence remains visible in that run's own detail view regardless.
- **`src/lib/route.ts`** gained `parseCompareRouteFromHash`/`compareHash`/`historyHash`, additively (the existing `parseRunIdFromHash`/`runDetailHash` and their test are untouched) — `#/compare` (picker only) and `#/compare/<identity_key>` (a stock selected), the same real `location.hash` pattern Step 5A already established, so keyboard navigation, the browser back button, and reload-preserves-route all still come from the platform for free. No framework router was added, per the round's explicit instruction.
- **`src/lib/RunComparison.svelte`** (new): fetches `getAllRuns`/`listComparisonIdentityGroups`/`findIdentityConflicts` fresh in one `$effect` keyed on `identityKey` (so switching stocks re-checks every run's *current* sync state, satisfying "if a selected run changes to an excluded state it must disappear from a fresh query without rebuilding the index" — proven at the storage-query level in `storage-comparisonIndex.test.ts`, using the exact same `applyTransition`-based disappear/reappear pattern the pre-existing `findIdentityConflicts` test already used); renders the picker (`<select>`, native and fully keyboard-operable), a run-inclusion `<fieldset>` of checkboxes defaulting to all eligible runs checked, an identity-conflict banner (from `findIdentityConflicts`, reused unchanged from Step 4A/5A's Bugbot-P2-2-era implementation), and the comparison table itself (one row per included run, chronological; columns for every field item 10 required — effective date, imported timestamp + run ID, presence, raw stock name, raw+normalized ISIN, raw+normalized NSE Code, match method, app Volume Ratio or its reason code, provider `VolumeRatio` kept separately labelled, and v2 source filename/row). `App.svelte` gained a persistent `<nav>` ("Run history" / "Compare stocks") visible across all three views, and `RunDetail.svelte`'s identity column now links each openable row straight into `#/compare/<identity_key>` via `identityKeyForIdentity`.
- **Never mutates anything:** `RunComparison.svelte` only reads (`getAllRuns`, `listComparisonIdentityGroups`, `findIdentityConflicts`); no envelope, comparison-identity row, or sync state is ever written from the comparison UI.

### Identity rules, exactly as specified

- **ISIN primary, NSE-Code-only provisional, never auto-merged, never retroactively upgraded:** all four already held at the storage-index level (Step 3/Bugbot P2-2); this round adds no new identity-matching code, only a new *read* of the same `identity_key` scheme. `nse_code_provisional` is always visibly labelled as such in the picker (`(provisional)` suffix) and the comparison table (`Match method` column literally reads `nse_code_provisional`), plus an explicit banner: "Provisional match by NSE Code only ... never silently upgraded to an ISIN match, even if a later run supplies one."
- **Same ISIN, changed NSE Code → same security, symbol history shown:** because `identity_key` is `isin:<normalized>` regardless of NSE Code, one identity_key's comparison naturally spans both symbols; each run's own row shows its own `raw_nse_code`/`normalized_nse_code`, so the symbol change is directly visible reading down the table. New synthetic fixtures `SYNTHETIC_5b_symbol_history_run1.csv`/`_run2.csv` (same ISIN `ZZSYNTH00015`, NSE Code `OLDCODE` → `NEWCODE`) exercise this in `comparison.test.ts`.
- **NSE-only never retroactively absorbed by a later ISIN:** proven at both levels — `storage-comparisonIndex.test.ts` shows `listComparisonIdentityGroups` keeps the older `nse:PROVCODE` group and the newer `isin:ZZSYNTH00015` group entirely separate; `comparison.spec.ts` (Playwright) proves the *same* fact through the real picker UI with `SYNTHETIC_5b_nse_only_early.csv`/`_isin_appears_later.csv` (`PROVCODE` → `ZZSYNTH00056`): two independent picker entries, never one.
- **Same NSE Code, different valid ISINs → conflict, surfaced, never comparable as one security:** `findIdentityConflicts` (unchanged, reused) feeds a conflict banner listing every conflicting group; because the picker is built from `identity_key` (always ISIN-keyed when a valid ISIN exists), the two conflicting ISINs are structurally two separate, independently selectable entries — there is no code path that could combine them into one "by NSE code" comparison. New fixture `SYNTHETIC_5b_conflict.csv` (two rows, one shared NSE Code `SHAREDCODE`, two different valid ISINs) exercises this end-to-end in Playwright: the banner appears, both ISINs remain separately selectable, and selecting one never shows the other's data.
- **Neither identifier → excluded from the picker, still preserved in the raw run:** unchanged from Step 3 — `deriveComparisonRows` never indexes a `match_method: null` row, so it can never appear as a `listComparisonIdentityGroups` entry; it remains fully visible in that run's own `RunDetail` table (Step 5A, unaffected).

### Testing

- **Unit — `tests/unit/comparison.test.ts`** (new, 10 tests): `identityKeyForIdentity` for both match methods and the null case; explicit absence for an eligible run genuinely lacking the stock; chronological ordering independent of input order; same-effective-date runs staying distinct; the stored (never recomputed) metric reaching the comparison cell unchanged; an invalid metric shown present-with-reason, never absent; v1+v2 coexistence in one comparison with correct v2 source filename/row/index provenance; picker entries built from identity groups with a representative name and deterministic sort.
- **Unit — `tests/unit/storage-comparisonIndex.test.ts`** (+4): `listComparisonIdentityGroups` groups correctly and keeps ISIN/NSE-only keys distinct for the same stock; the NSE-only-never-absorbed proof; exclude-on-ineligible-state/reappear-on-restore (same pattern as the pre-existing `findIdentityConflicts` test); index rows never deleted/mutated by the query.
- **Unit — `tests/unit/runOrder.test.ts`** (+5): `compareRunsChronologically`/`sortRunsChronologically` — ascending date, same-date/same-imported-time tiebreak, exact mirror-image relationship to `compareRunsForHistory`, unsupported-schema-last.
- **Unit — `tests/unit/route.test.ts`** (+6): the new compare-route parsing, round-tripping an `identity_key` containing a colon, never colliding with the run-detail route pattern.
- **Playwright — `tests/e2e/comparison.spec.ts`** (new, 10 scenarios × 2 browsers = 20 tests): selecting a stock; comparing a real v1 run and a real v2 multipart run for the same real stock (LG Electronics, `INE324D01010` — confirmed present in both the 7-row sample and the two-page 200-stock export before writing the test); explicit `Absent`; same-date runs distinct and separately checkable; provisional-NSE-only labelling plus a stored-metric display check; the NSE-only-not-absorbed proof through the real UI; keyboard-only navigation (history → compare → select → back, via `.focus()`+`Enter`, no mouse); the selected comparison surviving a full reload; no CSP violations across a full comparison flow; the identity-conflict banner and blocked-from-merging proof.
- **Real vs. synthetic evidence, kept distinct:** the v1/v2 coexistence scenario uses the two real, hash-verified samples already used in Step 4/4A (never presented as anything but what they are — real Trendlyne exports). Every identity-*transition* scenario (symbol history, NSE-only-not-absorbed, conflict) uses clearly-named `SYNTHETIC_5b_*.csv` fixtures with fabricated ISINs (`ZZSYNTH0001x`, valid-check-digit but not real securities) and fabricated NSE Codes (`OLDCODE`/`NEWCODE`/`PROVCODE`/`SHAREDCODE`) — real Trendlyne data cannot manufacture an ISIN change or an NSE-code collision on demand, so these are the only way to prove those rules deterministically, and are labelled as synthetic in the fixtures README, never claimed as Trendlyne evidence anywhere in code, tests, or this record.
- **Full pipeline immediately before commit:** `npm run verify` (format, lint, svelte-check — 429 files, 0 errors/warnings — 564 unit tests, build) green; `npx playwright test` (both projects, every spec including all prior steps') — **50/50 passing**. Playwright/Chromium/Edge versions unchanged (`1.63.0` / `153.0.8010.12` / `154.0.4258.37`).
- **Test counts:** unit 539 → 564 (+25: 10 `comparison.test.ts`, 4 `storage-comparisonIndex.test.ts`, 5 `runOrder.test.ts`, 6 `route.test.ts`). Playwright 30 → 50 (+20: the new `comparison.spec.ts`, 10 scenarios × 2 browsers).

**Out of scope, confirmed untouched:** Drive/OAuth/sync execution, the service worker, deployment, backup/export/restore, conflict-resolution UI, identity alias records, deletion, and Step 6. No `DB_VERSION` change. `git diff` against the pre-Step-5B commit touches only the new comparison module/view/route additions, one new storage query, `RunDetail.svelte`'s identity-column link, `App.svelte`'s nav, and new tests/fixtures — no existing Step 1–5A behavior, schema, or test was weakened.

### Post-review corrections (PR #2 review findings, second commit)

A PR review of the Step 5B branch raised four findings; all fixed on the same branch without expanding scope. No production behavior changed except the routing robustness fix (finding 1); the rest are test-quality corrections.

1. **Malformed hash routes crashed with an uncaught `URIError`.** `parseCompareRouteFromHash` (and the pre-existing `parseRunIdFromHash`) called `decodeURIComponent` unguarded, so a hash like `#/compare/%` or `#/run/%GG` threw on both initial load and same-document hash change (reproduced live in the browser during review). Fixed with a shared `safeDecodeURIComponent` helper in `route.ts` that catches the `URIError` and returns `null` — never a partial, repaired, or guessed value; a malformed segment is treated identically to "not a match for this route," falling back to the plain run-history view. Coverage: `route.test.ts` +14 cases (`%`, `%2`, `%GG`, `abc%`, `valid-prefix%2`, `valid-prefix%zz` for each parser, plus explicit "never partially decodes" and "adjacent well-formed value still decodes" assertions); new `tests/e2e/route-safety.spec.ts` (11 scenarios × 2 browsers = 22 tests) navigating malformed `#/run/` and `#/compare/` hashes via both same-document hash change and full page load, asserting the app stays rendered/usable, shows a safe fallback view, selects no incorrect run/identity, and emits zero `pageerror`/console-error events.
2. **No empty-run absence test.** Added a focused `comparison.test.ts` case building an eligible header-only run (`stock_count === 0`, no `comparison_identity` rows) and asserting the selected stock gets exactly one cell for it with `status: 'absent'` (structurally `{ status: 'absent', runId }` — never a zero value, never an invalid-metric reason), with chronological position preserved.
3. **Overclaiming state-filter test.** The `listComparisonIdentityGroups` exclusion test named all three excluded states but exercised only `quarantined`, and claimed "re-includes once restored" without testing restore. Extended (not renamed) to loop over `conflict`/`quarantined`/`unsupported_schema` independently using the same setup mechanism as the established sibling `queryComparisonIndexByIdentity` test: each state proven to remove the run's occurrence from the group immediately, `conflict` proven to reappear after the real `KEEP_LOCAL_ONLY` resolution transition, and the comparison-index row proven physically unchanged (same count, still queryable by `run_id`) throughout — no state-machine rule weakened, no production-only restoration path added. (`unsupported_schema` has no valid resolution transition in the declared state machine, matching the sibling test's identical omission.)
4. **"keyboard-only" Playwright test used `selectOption()` for the picker step.** Replaced with genuine keyboard type-ahead (`focus()` + `keyboard.type('LG Electronics')`), asserting the resulting `<select>` value and rendered comparison — verified reliable in both Chromium and Edge before committing (probed directly against a running preview server).

**Corrected totals:** unit 564 → **579** (+15: +14 `route.test.ts`, +1 `comparison.test.ts`; the `storage-comparisonIndex.test.ts` extension modified an existing test rather than adding one). Playwright 50 → **72** (+22: the new `route-safety.spec.ts`, 11 scenarios × 2 browsers). Full `npm run verify` (430 files, 0 errors/warnings) and full `npm run test:e2e` (72/72) green. Versions unchanged (`1.63.0` / Chromium `153.0.8010.12` / Edge `154.0.4258.37`). No brief or `samples/` file changed; no scope expansion.

## 20. Step 6: portable single-JSON backup export and preview-and-confirm import (2026-09-28)

**Scope:** the brief's "Portable backup export and preview-and-confirm restoration" requirement, per DECISIONS.md A1 (a single JSON file, no ZIP). A new "Backup" view, reached from the same persistent nav Step 5B introduced, exports every currently-stored run as one portable file and imports one back through a read-only preview (added/already-present/duplicate/conflict/unsupported/rejected counts) followed by an explicit confirmation. Conflict-resolution *actions* (inspecting or exporting a variant, "Keep local only") are deliberately deferred to Step 6B — a conflicted run from backup import is already visible and correctly excluded from active views (Step 5A/5B's existing `isRunOpenable`/`listComparisonIdentityGroups`), just not yet independently actionable. Drive, OAuth, sync execution, the service worker, deployment, and conflict-resolution UI remain untouched and out of scope, as does repository visibility. **No `DB_VERSION` change, no new object store, no new index** — this round is built entirely on already-existing, already-tested storage primitives.

### A pre-existing gap fixed as a correctness prerequisite: `ingestEnvelopeBytes` never supported v2 envelopes

Before writing any backup code, inspecting `ingest.ts` (per this round's "check existing modules before proposing new architecture" instruction) found that its valid-envelope branch hard-cast every candidate to `RunEnvelopeV1`, and `RunVariantRecord.envelope` was typed `RunEnvelopeV1` only — even though `commitNewRun`, `rebuildComparisonIndexTx`, and `validateEnvelope` have been fully generic over v1/v2 since Step 4A. Zero existing tests exercised `ingestEnvelopeBytes` with a v2 envelope. Since backup export/import must round-trip **every** run type the app actually produces — a multipart (v2) run is a completely ordinary thing to have committed by now — this was a real defect this round would otherwise have silently inherited (a v2 run's backup restore would misclassify or corrupt its shape), not a scope expansion. Fixed: `RunVariantRecord.envelope` widened to `RunEnvelopeV1 | RunEnvelopeV2`; `ingest.ts`'s hash-comparison logic reads `envelope_sha256` generically off whichever schema version is present. Covered by three new tests in `storage-ingest.test.ts` ("v2 envelopes are ingested exactly like v1") proving new/already-present/conflict-with-a-v2-variant all work, using the Step 5A `SYNTHETIC_run_history_multipart_1/2.csv` pair (most other `SYNTHETIC_*` fixtures share one small reused ISIN pool and would trip a spurious cross-part duplicate-ISIN block if paired as multipart parts — this pair was already built disjoint for exactly that reason).

### Refactor: one shared routing decision, never duplicated between preview and confirmed import

Per this round's explicit instruction, `ingest.ts` was split into three pieces without changing its external behavior (`storage-ingest.test.ts`'s full pre-existing suite passes unchanged):
- **`parseIngestCandidate(bytes)`** — the pure parse-and-validate half (JSON decode + `validateEnvelope`), performing no I/O and never throwing.
- **`decideRouting(candidate, existingRun)`** — the pure collision-routing decision (`add_new` / `already_present` / `add_variant_and_conflict` / `add_unsupported` / `quarantine_run_id_occupied`), taking "what's already there" as a plain input rather than reading it itself.
- **`ingestEnvelopeBytes`** — unchanged in behavior and unchanged in atomicity: still reads `existingRun` from **inside** its one atomic transaction (Bugbot P1-1 is untouched) and feeds it to `decideRouting` before writing.

Step 6's read-only preview (`src/core/backup/classify.ts`) calls the exact same `parseIngestCandidate`/`decideRouting` pair, supplying a plain, non-transactional `getRun` read — the same advisory relationship `findRunsByOriginalFileHash` already has to the real commit elsewhere in this codebase (a preview can go stale between reading and confirming; the actual commit re-decides fresh and atomically regardless of what was previewed). One rule set, two call sites, never two independently-maintained copies of "what should happen to this envelope."

### New module: `src/core/backup/`

- **`manifest.ts`** — `buildBackupFile(records)` (an explicit field allowlist — `RunRecord.envelope` only, never `.sync` — so a future device-specific field can't leak into an export just by existing on the record), `backupFilename()` (`n200-backup-v1-<UTC timestamp>.json`, `:`/`.` replaced for filesystem safety), and `parseBackupFile(bytes)` implementing A1's exact check order: (1) raw byte length against the 50 MiB limit, strictly before any parsing; (2) strict UTF-8 decode + `JSON.parse`; (3) before any per-envelope validation, hashing, preview, or write, reject if the claimed `run_count` exceeds 2,000, the actual `runs` array length exceeds 2,000, or the two disagree. An unrecognized `format_version` is rejected outright (this app has only ever produced `"1"`) — never opportunistically guessed at.
- **`classify.ts`** — `previewBackupImport(db, file)`: the read-only preview described above, refining `decideRouting`'s plain `add_new` into the brief's "different run_id sharing the same source-file hash → **permitted duplicate**, with a warning" via the existing `findRunsBySourceFileHash` (Step 4A). Performs **no writes of any kind** — not even a `quarantine_items` write for an entry that would be rejected; that only happens once the user confirms.
- **`commit.ts`** — `commitBackupImport(db, file)`: the confirmed-import step, looping every entry **independently** through the unmodified `ingestEnvelopeBytes` (each envelope is re-serialized to bytes and re-parsed/re-validated from scratch — nothing is trusted just because it was already parsed once during preview). Each call is already fully atomic and self-contained per entry, so one corrupt or divergent entry never aborts any other entry in the same file. A genuinely unexpected per-entry failure (not an ordinary data-quality one — e.g. a storage-quota error) is caught and recorded as its own `{ kind: 'error' }` outcome rather than stopping the batch, so "process entries independently" holds even beyond what `ingestEnvelopeBytes` itself normally produces.

### UI: `Backup.svelte`, reached from the persistent nav

A third `<nav>` link ("Backup") alongside Step 5B's "Run history"/"Compare stocks". Export is one button; import is file-choose → automatic read-only preview (a counts table, `role="status"`) → explicit "Confirm import" / "Cancel" — cancelling calls neither `previewBackupImport` again nor any write path, so it is structurally incapable of writing anything (proven directly in `backup.spec.ts` via a raw `indexedDB` count before and after). The confirmed-import summary groups results by outcome kind (`role="status"`). All status/error text is real text, never color alone; the preview and summary use proper table/list markup; every control is a native `<button>`/`<input type="file">`, so keyboard operability (`focus()` + `Enter`, proven in `backup.spec.ts`) comes from the platform rather than custom key handling, matching Step 5A/5B's established pattern.

### Testing

- **Unit — `tests/unit/backupManifest.test.ts`** (17): `buildBackupFile`'s allowlist (no `sync`/device data leaks), v1 and v2 export, `envelope_hashes` population, zero-run export; `parseBackupFile`'s exact A1 check order — oversized file rejected before JSON parsing, the 50 MiB boundary accepted, invalid encoding/JSON/structure, unsupported `format_version`, over-2,000 claimed count, over-2,000 actual count (even when claimed is smaller), claimed/actual mismatch with neither individually over the limit, and the exact 2,000 boundary accepted.
- **Unit — `tests/unit/backupImport.test.ts`** (10): `previewBackupImport` performs zero storage writes including for a corrupt entry; all six preview categories, each followed by confirming and asserting the matching real outcome (added→committed, already_present→no-op, conflict→variant-preserved-canonical-untouched, duplicate→committed-independently, unsupported→preserved-with-unsupported_schema-state, rejected→quarantined-without-touching-runs); one corrupt entry between two valid ones is quarantined without aborting either neighbor; re-importing an unmodified export of current runs is a no-op for every entry with hashes byte-for-byte unchanged; restoring an export into a completely fresh, empty database reproduces the same runs with unchanged hashes.
- **Unit — `tests/unit/storage-ingest.test.ts`** (+3): the v2-envelope fix, described above.
- **Playwright — `tests/e2e/backup.spec.ts`** (new, 4 scenarios × 2 browsers = 8 tests): export downloads a correctly-named file and re-importing it reports every run already present; restoring a real export onto a freshly-cleared instance re-adds every run (verified via the real Run History table afterward), with a corrupt entry spliced alongside two known-good ones on the *original* (non-cleared) instance correctly showing 2 already-present + 1 rejected and committing accordingly; cancelling a preview leaves `indexedDB`'s `runs` count provably unchanged, and the whole history→backup→export→import→confirm/cancel flow is exercised with genuine keyboard interaction (`focus()` + `Enter`, no mouse) exactly as Step 5A/5B established; an oversized/malformed file shows an accessible `role="alert"` error with no preview and no confirm button ever appearing.
- **Secret-pattern scan:** the repository's established mechanism (`sanitizeDiscoveryMetadata.ts`'s credential-shaped-value detection, exercised by its own 17-test suite) applies unchanged to the `backup_entry_index`/`detection_context` discovery metadata this round passes through `ingestEnvelopeBytes` — no new sanitization code was needed since nothing new is untrusted-string-shaped. Additionally grepped this round's new source files and the production `dist/assets/*.js` bundle for credential-shaped literals (`api[_-]?key`, `secret`, `password`, `bearer `, AWS/GitHub token shapes): clean.
- **Full pipeline, run under Node 24.20.0:** `npm run verify` (format, lint, svelte-check — 438 files, 0 errors/warnings — **580/580 unit tests passing**, 29 skipped, build) green. `npx playwright test`, chromium (Edge unavailable in this container, same as every prior round): of every scenario this cloud checkout can run without a real `samples/` file, **17 passing, 0 failing** — the 4 new backup scenarios plus every pre-existing sample-independent scenario. The 23 failures in the full chromium run are **entirely pre-existing and unrelated to this round**, confirmed by `git stash`-testing the identical, unmodified pre-Step-6 checkout in this same container: 21 are the established `samples/` `ENOENT` pattern (unchanged from every prior round), and 2 (`route-safety.spec.ts`'s initial-page-load console-error checks) reproduce identically on the pristine pre-Step-6 baseline — a pre-existing cloud-Chromium-only console-message difference from the authoritative desktop/Edge run (most likely an auto-requested favicon logged as a console error by this container's specific Chromium build), not a regression this round introduced. **Microsoft Edge: `NOT TESTED — browser unavailable`** in this container.
- **Test counts:** unit 579 → **609** (+30: 17 `backupManifest.test.ts`, 10 `backupImport.test.ts`, 3 `storage-ingest.test.ts`). Playwright 72 → **80** defined across both configured projects (+8: the new `backup.spec.ts`, 4 scenarios × 2 browsers), though only the chromium ones are runnable in this container.
- **Retained authoritative totals, not downgraded:** the desktop session's Node 24.20.0 pre-Step-6 baseline (579 unit / 72 Playwright, both browsers, all passing) is the number of record for everything this round did not touch — this round's own cloud-only totals above are additive evidence for the new work, not a replacement for that baseline.

**Out of scope, confirmed untouched:** Drive, OAuth, sync execution, account binding, the service worker, deployment, conflict-resolution UI, deletion, repository visibility, and Step 6B. No CSV grammar, metric definition, or envelope-hashing change. `Nifty200_Screener_PWA_Brief_v8.md` and every file under `samples/` are untouched (confirmed: this session never wrote to either).

## 21. Step 6 post-review fixes: preview race, error handling, and classification correctness/perf (2026-09-28)

A PR review of the Step 6 branch (`main...codex/step-6-portable-backup`) raised four findings; all fixed on the same branch, test-first, without expanding scope. No change to `DB_VERSION`, storage schema, CSV behavior, metric definitions, envelope hashing, Drive/OAuth/service-worker/deployment code, or conflict-resolution UI.

1. **`Backup.svelte`: overlapping file selections could leave a mismatched preview or backup file.** `handleFileChange` had no re-entrancy guard: selecting a second file before an earlier selection's preview resolved could let the two async chains interleave, so the displayed preview and/or the file `confirm()` would actually commit could each independently end up representing a *different* selection than the one currently shown. Fixed with a monotonically increasing `previewRequestId`, captured at the top of each `handleFileChange` call; every step after an `await` re-checks it against the current value and abandons (without touching `backupFile`/`preview`/`previewBusy`) the moment a later selection has superseded it. The file input is also now `disabled` for the full duration of `previewBusy || importBusy`, so a second selection can only happen through this same guarded path. Regression coverage: `tests/e2e/backup.spec.ts` — a deterministic `File.prototype.arrayBuffer` delay (not a timing guess) forces an earlier selection's read to resolve *after* a later one's full preview has already settled, then asserts the displayed preview and the eventual `Confirm import` outcome both still match the later (correct) selection; a second scenario asserts the file input is `disabled` while a preview is in flight and re-`enabled` once it settles.
2. **`Backup.svelte`: no error handling around `previewBackupImport`.** A thrown error (e.g. a genuine storage failure) left no error state set — only the `finally`'s `previewBusy = false` ran, so the "Checking this backup…" status silently vanished with no feedback and no way to retry. Fixed: the read-and-preview sequence is now wrapped in `try`/`catch`, setting a new `previewError` (`role="alert"`) state on failure; the file input remains usable immediately after (nothing left disabled), so re-selecting the same file retries cleanly. Regression coverage: a new `backup.spec.ts` scenario monkey-patches `IDBObjectStore.prototype.getAll` to throw once (simulating a genuine storage failure on `previewBackupImport`'s canonical-run-set load), asserts the accessible error appears with no preview/confirm UI left behind, then re-selects the same file and confirms it now succeeds normally.
3. **`classify.ts`: O(n²)-shaped duplicate-hash check.** `findRunsBySourceFileHash` (a full `getAllRuns()` scan) was called once per source hash for every "would-be-new" entry, instead of loading the canonical run set once. Fixed: `previewBackupImport` now calls `getAllRuns(db)` exactly once up front and builds an in-memory `run_id → RunRecord` map and `source-hash → run_ids` index from it, replacing every per-entry `getRun`/`findRunsBySourceFileHash` call. Regression coverage: a new `backupImport.test.ts` case spies on `findRunsBySourceFileHash` (the function the old code called once per hash) and asserts it is never called during a preview with three duplicate-hash entries — failing (3 calls) against the pre-fix code, passing (0 calls) after.
4. **`classify.ts`: preview didn't account for earlier entries in the same backup file.** Two entries sharing a `run_id` within one file both previewed as `added` (since the real DB is untouched by a read-only preview), while sequential confirmed import — which processes entries one at a time through the same `ingestEnvelopeBytes` used everywhere else — would actually resolve the second as `already_present` (identical envelope) or `conflict` (divergent envelope). Fixed as a natural consequence of finding 3's refactor: the in-memory `run_id → RunRecord` map (and the source-hash index) is updated after each entry that would route as `add_new`/`add_unsupported`, so a later entry in the same file sees exactly what sequential commit would have already written by that point. Regression coverage: two new `backupImport.test.ts` cases (neither entry pre-committed to the DB — both only exist within one backup file) assert a same-`run_id`, identical-envelope second entry now previews `already_present` (not `added`), and a same-`run_id`, divergent-envelope second entry now previews `conflict` (not `added`) — both then confirmed and checked against the real `commitBackupImport` outcome, proving preview and commit agree.

**Test-first discipline:** every one of the seven new/modified tests above was run against the unmodified pre-fix code first and confirmed to fail for the intended reason (not a setup error) — the two Playwright timing-sensitive ones (findings 1 and 2's race/disabled-input scenarios) were additionally re-run 2–3× each against both the pre-fix and post-fix code to confirm the failure/pass was deterministic, not a timing fluke — before implementing each fix and confirming the same test then passes.

**Test counts:** unit 609 → **612** (+3, all in `backupImport.test.ts`: the `findRunsBySourceFileHash`-call-count regression test, and the two same-file-duplicate-`run_id` sequencing tests). Playwright (chromium project) 40 → **43** defined (+3 new `backup.spec.ts` scenarios: input-disabled-while-previewing, overlapping-selection-race, storage-failure-during-preview); `backup.spec.ts` alone now has 7 scenarios (was 4). Both configured projects (chromium + msedge) therefore go from 80 → **86** defined; only the chromium half is runnable in this container.

**Full pipeline, run under Node 24.20.0:** `npm run format:check`, `npm run lint`, and `npm run check` (svelte-check, 438 files) all clean. `npm run test` (vitest): **583/612 passed, 29 skipped** (the 29 skips are the same pre-existing, environment-conditional skips present in the Step 6 baseline — `multipart-combine.test.ts`; unrelated to this round). `npm run build` clean. `npx playwright test` (chromium project only — Edge unavailable in this container, same limitation as every prior round in this environment): the full `backup.spec.ts` (7/7) passes, repeated 3× with no flakiness. Across the whole chromium project (43 defined): **20 passed, 23 failed** — the 23 failures are the identical, already-documented pre-existing pattern from the Step 6 baseline round in this same container (21 `samples/` `ENOENT` — this checkout has no `samples/` directory at all; 2 `route-safety.spec.ts` initial-load console-error assertions, a container-specific Chromium quirk) — re-confirmed this round by inspecting every failure's actual error text, not assumed. **Microsoft Edge: `NOT TESTED — browser unavailable in this container`**, as in every prior cloud round; the desktop/Edge baseline from the Step 6 PR (609/609 unit, 80/80 Playwright across Chromium and Edge) remains the number of record for everything this round did not touch, and is not re-claimed here for the 3 new tests added this round.

**Out of scope, confirmed untouched:** Drive, OAuth, sync execution, the service worker, deployment, database version, CSV grammar, metric definitions, envelope hashing, repository visibility, and Step 6B. `Nifty200_Screener_PWA_Brief_v8.md` and every file under `samples/` are unchanged (this checkout has no `samples/` directory to change).

## 22. Step 6B: conflict and quarantine review, inspection export, Keep-local-only (2026-09-29)

**Authorization (supersedes the stale §5 row):** implementation authorization covers the completed Steps 1–6 and Step 6B only. Drive, OAuth, sync, service worker, hosting and deployment remain unauthorized. D-1 through D-7 from the Step 6B plan were accepted as proposed.

**Scope:** a "Needs review" view (`#/review`, nav link) that makes already-stored `conflict`, `quarantined` and `unsupported_schema` data visible and actionable using local data only. No `DB_VERSION` change, no new store or index, no envelope/backup/metric/hash change.

- **Read (`src/core/review/queries.ts`, `loadReviewData`):** one readonly transaction over `runs`, `run_variants` and `quarantine_items` (no torn read). Returns conflict runs with every variant, "resolved" runs (no longer in `conflict` but still holding variants; read-only, no new persisted "dismissed" flag), quarantine items, and runs in `unsupported_schema`/`quarantined` state. Writes nothing.
- **Inspection export (`export.ts`):** each canonical envelope, variant and unsupported envelope downloads as its own JSON file, serialized as stored so content and `envelope_sha256` are preserved and the file re-validates to the same hash (original whitespace is not preserved). Files are named from `run_id`, role and an 8-character hash prefix only, restricted to `[A-Za-z0-9-]` (unsupported envelopes are untrusted); never from the CSV filename. Quarantine items download their original bytes exactly, as `application/octet-stream`. Nothing is rendered as HTML; displayed metadata is truncated text via `summarizeEnvelope`. Backups (Step 6) still exclude variants and quarantine items (D-5).
- **Resolution (`resolve.ts`, `keepLocalOnly`):** the only action. Restricted to runs currently in `conflict` (the raw `KEEP_LOCAL_ONLY` event is also legal from `remote_missing`, which this view must not offer), applied through `applyTransition`. The canonical envelope and all variants are untouched. The run rejoins run history and comparison through the existing live state filters. A later divergent copy returns a `local_only` run to `conflict` (existing `INGEST_CONFLICT_VARIANT` rule). The confirm dialog is a native modal `<dialog>` with an explicit Tab/Shift+Tab wrap (a native modal still lets Tab reach browser UI) and focus restored to the trigger, or to the view heading if the trigger has left the DOM.
- **Backup restore lock (D-3):** `commitBackupImport` now runs under the exclusive Web Lock `n200-backup-restore` (new `withRequiredLock` in `locks.ts`) and **fails closed** with `WebLocksUnavailableError` before writing anything when Web Locks are unavailable; `Backup.svelte` shows an accessible error. **The lock serializes tabs only. It does not make the multi-entry restore one atomic transaction: the existing per-entry `ingestEnvelopeBytes` transactions remain the sole atomicity guarantee** (an interrupted restore leaves processed entries committed and later ones untouched). This refines §15's single-transaction rationale, which still holds for single-transaction writes.

**Test-first evidence (fail before, pass after):**
- Unit: `reviewData.test.ts`, `reviewExport.test.ts`, `backupLock.test.ts` and the new `route.test.ts` case were written first. Before any implementation, two files failed to load (missing `src/core/review/*`) and, of the tests that could load, 3 failed (both `backupLock` tests' lock assertions and the `reviewHash` route test). After: 43/43 in those four files.
- Playwright: `tests/e2e/review.spec.ts` (8 scenarios) was run before any UI existed: 8/8 failed on chromium. After the UI: 7/8 passed; the keyboard test failed in both browsers because native `<dialog>` lets Tab leave the document; the explicit Tab wrap fixed it (8/8 in both browsers).

**Verification (Node 24.20.0):** `npm run verify` (format, lint, svelte-check 448 files 0 errors/warnings, build): unit 612 -> **631** passed (+19: 10 `reviewData`, 6 `reviewExport`, 2 `backupLock`, 1 `route`). Playwright across chromium + msedge: 86 -> **102** passed (+16 = 8 scenarios x 2). Chromium 153.0.8010.12, Microsoft Edge 154.0.4258.37, Playwright 1.63.0.

**Out of scope, untouched:** Drive, OAuth, sync execution, account binding, service worker, hosting, deployment, deletion, variant promotion or overwrite, row-level diff, aliasing, `DB_VERSION`, CSV grammar, metrics, envelope hashing. `Nifty200_Screener_PWA_Brief_v8.md` and `samples/` are unchanged.

## 23. Step 7: local-first release hardening (2026-09-29)

**Authorization (this entry only):** the owner approved Step 7 (local-first release hardening) alone. **Still unauthorized, each needing its own explicit approval:** service worker / manifest / offline mode, Drive, OAuth, sync execution, account binding, hosting, deployment, and any later step. No `DB_VERSION`, storage schema, CSV grammar, metric, envelope, backup-schema, `samples/` or brief change.

**Decisions (owner, 2026-09-29):** hardening scope only; dev dependencies `fast-check` 4.10.2 and `@axe-core/playwright` 4.13.0 (exact-pinned, dev only); the bundle scanner lives in `scripts/` and runs inside `npm run verify`; the three notices are persistent in the app shell; `RELEASE_REPORT.md` is committed as a blank template only.

**Delivered**
- **Persistent notices** (`src/lib/Notices.svelte`, rendered by `App.svelte` on every route, before storage opens): "No in-app run deletion in v1.", "Data is stored unencrypted in this browser.", "Hashes check integrity only; they do not prove authenticity."
- **Production-output scanner** (`scripts/scan-dist.mjs`, `npm run scan:dist`, now the last step of `npm run verify`): fails on source maps or `sourceMappingURL` references, JWT / Google access token / API key / OAuth client secret / bearer token / private key shapes, sample paths or filenames, real-looking ISINs, and `.csv` / `.sqlite` / `.db` / backup / `.env` files. Findings print the rule and file only, never the matched text.
- **Fuzz / property tests** (`tests/unit/fuzz.test.ts`, fixed seed 20260929): arbitrary and corrupted CSV bytes never throw; any change to a valid envelope stops it validating as valid; ingesting a mutated envelope never commits it and quarantines the exact bytes; arbitrary bytes never leave a run; arbitrary and corrupted backup files never throw and preview with zero writes.
- **Browser tests:** cross-tab `versionchange` (the other tab's upgrade completes and this tab prompts a reload); restore blocked while another tab holds the restore lock and completing on release; two tabs restoring the same backup produce exactly one run; oversized file / row / column inputs rejected with zero writes to `runs`, `run_variants` and `quarantine_items`; keyboard-only import; console output free of filenames and CSV values; axe (WCAG 2.0/2.1/2.2 A/AA tags) on history, run detail, comparison, backup, review and the review dialog.
- **Real defect found and fixed (regression-tested by the axe test):** the "provider-reported, not the app ratio" badge used `--color-gold` on `--color-gold-bg` at 4.34:1, below the 4.5:1 AA minimum (D1). Added `--color-gold-text` (`#735b10`, 5.76:1) for that badge only.
- **`RELEASE_REPORT.md`:** blank template only; no completed report exists.

**Fail-before / pass-after evidence**
- Notices: 2 of 2 notice tests and the console-privacy test's setup failed before `Notices.svelte` existed (no such region); pass after.
- Axe: failed before the contrast fix (`color-contrast`, serious, 1 node, ratio 4.34); pass after.
- Scanner: `scanDist.test.ts` failed to load (module missing) before `scripts/scan-dist.mjs`; a first draft's ISIN pattern was one character too long and failed its own test, then fixed. A `.map` planted in a real `dist/` made `npm run scan:dist` exit 1; removing it exits 0.
- Gates whose behaviour already existed were checked by temporary mutation, each reverted with `git checkout`, then re-run green: removing the restore lock failed the cross-tab lock test and both `backupLock` unit tests; disabling the `versionchange` prompt and, separately, the connection close failed the versionchange test; raising the file-size limit failed the oversize test; skipping the envelope-hash check failed the fuzz property (counterexample found by fast-check). The fuzz suites found no new production bug.

**Verification (Node 24.20.0):** `npm run verify` (now including `scan:dist`): unit 631 -> **652** passed (+21: 7 fuzz, 14 scanner). Playwright across Chromium 153.0.8010.12 and Microsoft Edge 154.0.4258.37 (Playwright 1.63.0): 102 -> **124** passed (+22 = 11 new tests x 2 browsers); the three cross-tab tests also passed 3 consecutive repeats in both browsers (18/18).

**Dependency review:** `npm audit` (all severities, including dev): 0 vulnerabilities. Licences (from `package-lock.json` / installed `package.json`): production — MIT 6, Apache-2.0 1, BSD-3-Clause 1, ISC 1; development — MIT 150, Apache-2.0 22, MPL-2.0 14, BSD-2-Clause 8, ISC 7, BSD-3-Clause 2, BlueOak-1.0.0 1. No unlicensed or copyleft-strong entries. This is evidence, not proof.

**Out of scope, untouched:** service worker / offline, Drive, OAuth, sync, hosting, deployment, deletion, and all schemas and grammar listed above.

## 24. Step 7 follow-up: hardening test tightening (2026-09-29)

Test and script changes only; no app behavior, schema, `DB_VERSION`, CSV grammar, metric, backup-format, brief or `samples/` change, and **no new authorization** (§23 stands: only Steps 1–7 are authorized).

- **No-console guard** (`tests/unit/noConsole.test.ts`): fails if any hand-written file under `src/` references the `console` global (calls, bracket access, aliasing, destructuring), ignoring comments. `src/core/envelope/schema/generated/` is skipped. Its detector has its own positive and negative self-tests. Closes the vacuous-pass concern about the browser console test in `tests/e2e/hardening.spec.ts`.
- **Backup fuzz** (`tests/unit/fuzz.test.ts`): the corrupted-backup property no longer filters with `fc.pre`. All 300 cases are counted; rejected ones must carry one of the seven stable reason codes; accepted ones must preview with zero writes and restore without throwing. The test asserts accepted + rejected = 300, at least half rejected, at least 5 accepted, and fewer than 10% unchanged files.
- **`scan-dist`:** added a `GITHUB_TOKEN` shape, `.pem` / `.p12` / `.pfx` file types, and tightened `.env` to `.env` or `.env.*` files only (previously any name beginning `.env`, e.g. `.environment`). Rules stay shape-specific; no generic key/secret matching was added.

**Fail-before / pass-after:** 5 new `scanDist` tests failed on the old rules (GitHub token, `.pem`, `.p12`, `.pfx`, and an innocent `.environment-notes.txt` wrongly flagged) and pass now. The two guards that describe existing behavior were mutation-checked and reverted: adding `console.log` to `src/lib/download.ts` failed the no-console test; making `parseBackupFile` always reject failed the fuzz property (0 accepted, needs 5).

**Correction to the no-console guard (PR #7 review, CodeQL alert #1):** the first version stripped comments with regular expressions. CodeQL flagged the `<!--` removal as incomplete multi-character sanitization, and review found two real blind spots (a `/*` inside a string hiding later code; an escaped `//` inside a regex literal hiding the rest of its line). The guard now uses real parsers already in the toolchain, no new dependency: TypeScript's parser (`typescript`, already a dev dependency) for `.ts` / `.js` / `.mjs` and Svelte's compiler parser (`svelte/compiler`) for `.svelte`. It counts `console` Identifier nodes (calls, aliasing, destructuring, `window.console`, template expressions and event handlers) plus string-keyed access such as `x['console']`. Comments, string, regex and template text are never identifiers, so they can neither hide a use nor cause a false positive; a parse failure throws and fails the test. The `generated/` exclusion and the more-than-40-files sanity check are unchanged.

**Fail-before / pass-after:** against the regex version, 7 of the 27 detector cases failed: `/*` in a string, `<!--` / `-->` inside strings (Svelte and TypeScript), and three false positives (the word in a string, in a single-quoted string and in Svelte text). The escaped-`//` regex-literal case was confirmed missed by the old detector separately. All 27 pass with the parser-based detector. Mutation check: adding `window.console.log` to `src/lib/download.ts` and `{console.log(1)}` to `src/App.svelte` made the source scan report exactly those two files; both were reverted.

## 25. Step 8: manifest, service worker and offline operation (2026-09-29)

**Authorization (this entry only):** the owner approved Step 8 alone. **Still unauthorized, each needing its own explicit approval:** Drive, OAuth, sync execution, account binding, hosting, deployment and any later step. Unchanged: `DB_VERSION`, all storage schemas, CSV grammar, metrics, envelopes, the backup format, `samples/`, the brief. Browser support matrix (D6) unchanged: Safari stays unsupported.

**Decisions (owner):** name "Nifty 200 Screener"; simple generated icons; hand-written worker with a post-build generation script and no new dependencies; register only in production builds; updates require user acceptance and wait for imports, migrations and restores across all open tabs.

**Design**
- **Shell-only precache** (`scripts/sw.template.js`, filled in by `scripts/build-sw.mjs` after `vite build`; `npm run build` now runs both): `index.html`, `manifest.webmanifest`, `icons/*.png`, `assets/*.js|css`. The version is a hash of the shell files' contents, so a rebuild of identical content is byte-identical. The generator **fails closed** on any other file in the build output (source maps, CSV or backup files, stray data).
- **Serving:** same-origin `GET` only, no `Authorization` header, empty query string, and only shell paths (navigations map to `index.html`, so hash routes work offline). Everything else, including user data, CSV uploads, backup exports (blob URLs never reach a worker), credential-bearing and external requests, goes straight to the network and is never stored. The worker never writes to a cache while handling a request; caches are filled only at install, from responses that are `ok`, not redirected, and of the content type their extension promises (a host rewriting missing files to an HTML page cannot poison the cache). A failed install deletes its half-built cache and leaves the working worker in place.
- **Cleanup:** on activation only this app's own `n200-shell-*` caches are considered; the current and the immediately previous generation are kept (tracked in `n200-meta`), so a page still running an older release keeps loading its hashed assets. Foreign caches are never touched.
- **Updates are never automatic:** no `skipWaiting` on install. A notice ("A new version of Nifty 200 Screener is ready", `role="status"`, keyboard-operable "Update now") appears; only the user's acceptance proceeds. The worker accepts `SKIP_WAITING` only from a window client.
- **Cross-tab coordination without a race:** one origin-wide Web Lock, `ACTIVITY_LOCK_NAME = 'n200-activity'`. Import confirm-and-commit holds it **shared** (`withActivity`); schema migrations and backup restores hold it **exclusive**; an accepted update takes it **exclusive** and asks the waiting worker to activate **while holding it**. The check for running operations and the activation are therefore one atomic step across every tab, and an operation that starts after acceptance queues behind the update. Nothing holds two locks (no nesting). Without Web Locks the updater fails closed (nothing is posted) and the browser activates the waiting worker only when all tabs close. This **replaces** the earlier lock names `n200-backup-restore` and `n200-schema-migration`; the restore still fails closed without Web Locks, and a restore now also excludes concurrent imports. §15's single-transaction rationale for imports still holds; the shared hold only lets updates wait for them. An open import **preview** (before Confirm) is not an operation; a user who accepts an update reloads their own tab and loses that unsaved preview. The notice says so **before** acceptance (in the "update available" state: "Updating reloads this page and discards any import preview you have not confirmed. Runs already saved on this device are not affected.") and again while the update waits for operations to finish, when the user can still cancel. Other tabs are never reloaded automatically: they show "The app was updated in another tab. Reload this page when you are ready."
- **Bug found by the Step 7 cross-tab test and fixed:** taking the shared lock name for migrations meant `openDatabase` queued behind a long restore held by another tab, so a reloaded tab sat on "Opening local storage" and the Backup link never appeared. Diagnosed with a probe on the failing test: the stuck tab had no navigation, no page errors, service worker active and controlling (so not a service-worker fault), and `navigator.locks.query()` showed the holder's exclusive `n200-activity` held and this tab's own exclusive request pending. **Fix:** `openDatabase` now opens the current version without any lock, and takes the exclusive lock only when `upgrade` shows a migration is needed (aborting that probe attempt, then redoing it under the lock). The original Step 7 cross-tab test is unchanged apart from the lock's new name.
- **Scanner / guards:** `scan:dist` now also requires `sw.js` and a valid manifest, parses `sw.js` for `console` references, validates that every precache entry is a shell path that exists in the build, and checks the worker still contains its request guards. `sw.template.js` is under the no-console lint rule and unit guard. PNG icons are skipped by the text rules.

**Installability:** automated only. Chromium's `Page.getInstallabilityErrors` returns none in Chromium. Edge under Playwright runs InPrivate and reports only `in-incognito` (installation is blocked in private windows), which is a property of the harness, so the test filters that single id and requires every other check (manifest, icons, start_url, display, service worker) to be clean. **Manual installation and Android Chrome are NOT TESTED.**

**PR #8 review follow-ups (2026-09-29):**
- **Pre-acceptance warning:** the reload/unsaved-preview consequence is shown in the initial "available" state, not only after acceptance (correcting the wording above, which had described it as shown by the notice generally).
- **Replaced waiting worker:** the worker captured at acceptance can be replaced by a newer release while the update is queued for the activity lock (the captured one then becomes `redundant` and would never signal again, costing the full 15 s timeout). `activateWaitingWorker` now takes `resolveWorker`, called once the lock is held, and activates whatever is waiting then; if nothing valid is waiting it fails at once with `NO_WAITING_WORKER` (no post, lock released). A worker that is already `redundant` also fails at once. The notice also no longer flips back to "Update now" when a newer candidate installs while this tab's accepted update is queued.
- **`usedLock` documentation:** `OpenDatabaseResult.usedLock` now documents both meanings: for a migration, whether it ran under the exclusive lock; for an already-current open (no lock taken), whether Web Locks are available.
- **Fail-before / pass-after:** three new `updateActivation` unit tests failed on the previous code (a replaced candidate was posted to and never activated; two hit the 5 s test timeout waiting for a worker that could never change state) and pass now. Two e2e checks failed before the change (no pre-acceptance warning; the queued update's notice was replaced by a second "Update now" and the replaced worker was never activated) and pass now.

## 26. Step 9: Drive sync engine core against a fake Drive (2026-09-30)

**Authorization (this entry only):** the owner approved Step 9 alone. **Still unauthorized, each needing its own explicit approval:** any real Google call, Google Identity Services or any Google script, OAuth screens or consent-screen/client setup, real Drive network access, CSP changes for Google, hosting, Cloudflare, deployment, any visible sync UI, run deletion, encryption, and Step 10 or later. Unchanged: CSV grammar, metrics, envelopes and their hashing, the backup format, `samples/`, the brief, the service worker (its request allowlist already ignores every cross-origin request, now covered by explicit Drive and Google URL cases). **Real Google account, OAuth consent, Drive API and Cloudflare behaviour remain NOT TESTED until Step 10.**

**Decisions (owner):** fake-Drive-only engine; `DB_VERSION` 2 -> 3; a `sync_profile` store and Drive metadata on runs; a `TokenProvider` interface with an in-memory fake only; resumable uploads with the session URL in memory only; the SHARED `n200-activity` lock plus a single-leader IndexedDB lease for sync (no nested Web Locks); no user-visible sync UI.

**What exists (`src/core/sync/`, all unreachable from the app: nothing outside that folder imports it, enforced by a test, so none of it is in the production bundle)**
- **`driveClient.ts` / `errors.ts`:** a Drive REST client behind an injected `fetch`. Full pagination with exactly one restart when a page token is rejected (a second rejection stops with `invalid_page_token`); a per-attempt `AbortController` timeout; retries only for idempotent requests, capped, exponential with jitter in [50%, 100%] (a `Retry-After` is honoured up to the cap). Exact classification: 400 bad request (permanent), 401 unauthorized, 403 rate-limit reasons (retry) versus permission (no retry) versus storage/daily-quota exhausted (no retry), 404 not found, 409 conflict, 429 and 5xx (retry), offline, timeout, cancelled. `probeFile` separates present, trashed, permanently missing and inaccessible (Drive gives the same 404 for missing and not-accessible under `drive.file`; a 403 app-not-authorized is reported as inaccessible). Errors carry only a kind, status and short reason code: no body, URL, header or token.
- **`auth.ts`:** `TokenProvider` and an in-memory implementation; an account-level `OAuthState` store. A 401 (or no token) sets `reconnect_required` there and never touches a run's state.
- **Idempotent upload (`upload.ts`):** the Drive file ID is generated and persisted on the run BEFORE the first attempt and reused on every retry; folders likewise (`pending_folder_id`). A resumable session is kept only in memory: after an interruption the session is asked how much arrived and resumed; if the session is lost (a reload) a fresh session is opened under the same persisted ID. A 409 retrieves and verifies the existing file (identical bytes: linked; a divergent copy of the same run: stored as a `remote` variant and the run becomes `conflict`; anything else at that ID: a non-retryable `DRIVE_ID_OCCUPIED` error, never overwritten). After upload the bytes are verified against Drive's `md5Checksum` (an in-repo MD5, since Web Crypto has none) and version, checksum and folder are stored on the run. Every outcome maps to exactly one state-machine event, so no run is left in `syncing`: 401 and cancellation return to the prior stable state with no error recorded; timeout/offline return to it with a retryable `SYNC_TIMEOUT`; exhausted 429/5xx/rate-limit -> `error` (retryable); permission, quota-exhausted, 400 -> `error` (not retryable).
- **Eligibility:** only `pending` and retryable-`error` runs upload automatically. `conflict`, `quarantined`, `unsupported_schema`, `synced`, `syncing`, `remote_missing` and non-retryable `error` never do; `local_only` only on explicit request. The state machine itself already forbids `START_SYNC` from the first three; `uploadRun` also refuses them directly.
- **Restore to Drive:** for `remote_missing` runs only. A trashed file is untrashed and re-verified under its existing ID; a permanently deleted one gets a new pre-generated ID and the same immutable envelope is uploaded under it.
- **Discovery and reconcile (`reconcile.ts`):** two fully paginated searches (every tagged app folder; every tagged run file regardless of parent, with files outside every known folder reported as `orphaned`, a diagnostic attribute not a state). Each file is downloaded, checked against its Drive checksum, validated, and merged by `run_id` through the same ingestion rules as backups. A known file with an unchanged version AND checksum is not re-downloaded; any change to either forces a full download and validation. Divergent remote content -> `remote` variant plus `conflict`; an identical remote copy of a local pending run is linked, not re-uploaded; a second remote copy of a linked run is reported as `duplicate_remote` and left alone. Malformed tagged files and unsupported schemas go through ingestion (quarantine / `unsupported_schema`); untagged and trashed files are never fetched. Runs previously synced from this device whose file has gone become `remote_missing` (checked with a direct probe, so a file that merely lost its tags is not misreported); nothing is auto re-uploaded. Several app folders are surfaced as a folder conflict: none is merged, moved, deleted or chosen, runs from all of them are still read, and uploads are blocked until `selectActiveFolder` is called.
- **appProperties policy:** tags (`n200_app`, `n200_kind`, `n200_run`, `n200_schema`, `n200_env`, `n200_file`) are discovery hints only. The file's IDENTITY tags (run id, schema version) must agree with its validated content or the file is quarantined (`APP_PROPERTIES_MISMATCH`). The envelope-hash tag is deliberately not part of that check: a file edited outside the app keeps its old hash tag, and that divergence must surface as a conflict with both copies preserved, not be discarded. (My first version checked the hash tag and quarantined such files; the divergent-remote test caught it.)
- **Account binding (`bindPermission`):** only the opaque `permissionId` is requested (`fields=user(permissionId)`) and stored, in one transaction. The first account binds, the same verifies, any other blocks the whole pass before any listing or upload. No email is requested, stored or placed in an envelope.
- **Coordination (`engine.ts`, `syncNow`):** one user-initiated pass: identity check, lease, discovery, uploads. It holds the SHARED activity lock (so a service-worker update waits for it) and fails closed without Web Locks; an IndexedDB compare-and-set lease (`sync_profile.lease`, with expiry so a crashed tab cannot block sync forever) decides which tab drains the queue. There is no second Web Lock, so nothing nests. Nothing runs in the background.

**Migration v2 -> v3:** one new empty object store, `sync_profile` (key `profile_id`). Drive metadata lives on each run's existing `sync` record as an optional `drive` field, so no existing record is read or rewritten; a v1 database chains v1 -> v2 -> v3. A fresh install creates all five stores directly. The migration still runs under the exclusive activity lock and fails closed without Web Locks; opening an already-current database still takes no lock. Tested with a hand-built v2 database: every run, index row and `countAtRiskRuns` result is unchanged, the new store is empty, and no run has Drive metadata.

**Defects found and fixed while building this**
- `transition()` returned a fresh sync record and silently dropped `sync.drive`, so every state change erased a run's persisted Drive file ID (the first upload tests failed 6 of 20 on this). It now carries `drive` through every transition, with a regression test.
- `.gitattributes` did not pin `*.webmanifest`, so on a Windows checkout with `core.autocrlf` the Step 8 manifest became CRLF and `npm run verify` failed its format check. `*.webmanifest text eol=lf` and `*.png binary` were added.
- The Step 7 cross-tab `versionchange` test hard-coded database version 3 as "newer than current"; with `DB_VERSION` now 3 that is no upgrade. It now reads the installed version and requests the next one (assertions unchanged).
- The existing schema tests were updated from four stores to five.

**Guards added:** `scan:dist` fails the build if the production bundle names `googleapis.com`, `accounts.google.com`, `apis.google.com` or `gstatic.com` (to be relaxed deliberately when a Google step is authorized); a test asserts that nothing outside `src/core/sync` imports the engine and that the only Google host inside it is the Drive API base URL constant; the service-worker unit test now also asserts Drive API, resumable-session and Google sign-in URLs are never intercepted.

**Evidence** (Node 24.20.0; Chromium 153.0.8010.12, Microsoft Edge 154.0.4258.37, Playwright 1.63.0): unit 756 -> **879** (+123: client and error contract 32, MD5 6, storage profile/lease/metadata 13, migration 3, upload 21, reconcile 21, engine 14, secrets 3, isolation 3, scanner 4, service worker 3, and schema-test updates). Mutation checks, each reverted, each caught by the intended tests: a secret-looking value persisted on a run; conflict runs allowed to upload; a lease that always grants; a 401 that does not set `reconnect_required`; an unpersisted pre-generated ID; a transition that drops Drive metadata. Secret-leak tests scan every IndexedDB store (including quarantined bytes) and every returned report, and spy on `console`, after a scenario with resumable interruption, 5xx, restore and a revoked token: no token, `Bearer`, session URL, session ID or email appears. **Cache Storage cannot be inspected in the unit environment**; that guarantee rests on the worker never caching cross-origin or authorized requests (unit-tested) and on the engine not being reachable from the app.

**NOT TESTED:** everything real: a Google account, OAuth consent, the Drive API's actual behaviour (the fake follows the documented API but is not Google), quotas, `drive.file` visibility rules, real latency and rate limits, the real `Retry-After` and error-body shapes, and Cloudflare. Also unchanged from earlier steps: manual install, Android Chrome, other browsers, manual screen-reader use.

**PR #9 review follow-ups (2026-09-30):**
- **Fake Drive fidelity:** creating or completing an upload under a parent that is missing or trashed is now a 404, an inaccessible parent a 403 `appNotAuthorizedToFile`, and a parent that is not a folder a 400; inaccessible files are not listed and answer 403 on read. (The first version accepted any parent, which hid the next item.)
- **Active-folder recovery (`checkActiveFolder`):** discovery now verifies a saved `active_folder_id` that the tagged-folder search did not return. A folder that still exists as a live folder (for example one that lost its tags) is kept and re-adopted; one that is trashed, permanently gone or inaccessible is cleared together with its known-folder entry, so the next pass adopts the single remaining tagged folder, surfaces several as a folder conflict, or creates a fresh one. An upload that gets a 404 for its parent also self-heals once (verify, clear, adopt or create, retry) instead of failing the run with a permanent `DRIVE_NOT_FOUND`; a failure that is not about the folder never clears it. Nothing on Drive is deleted, moved or merged.
- **`remote_missing` recovery:** a saved file that reappears and validates as the same run moves the run out of `remote_missing` to `synced` (through the state machine) with refreshed version, checksum and folder, reported as `recovered`, with no re-upload. A `remote_missing` run is never treated as "unchanged" (a reappearing file may report the same version), and a reappearing file whose content diverged becomes a `remote` variant plus `conflict`, not `synced`.
- **Lease renewal (implemented, so no follow-up is needed):** the client has an activity hook that runs before EVERY HTTP attempt (retries and each chunk or status query of a resumable upload included); `syncNow` sets it to renew the leader lease and clears it in `finally`. If a renewal finds the lease lost, the pass stops as cancelled (the run returns to its prior state) rather than racing the new leader. Test: with a 1 s lease and 600 ms per request, an interrupted multi-request upload runs far longer than one TTL while a contender tries to take the lease before every request and never succeeds.
- **Fail-before / pass-after:** 16 of the 20 new tests failed before the changes (parent checks, folder recovery, recovery of `remote_missing`, lease renewal); all 20 pass. Mutation checks, each reverted and caught: no renewal hook; no self-heal on parent 404; discovery never checking the active folder (8 tests); no `remote_missing` recovery (2); the "unchanged" guard removed. Existing conflict, variant, 409, duplicate-folder and fresh-device-restore tests are unchanged and pass.

---

## 27. Step 10: localhost Google Drive connection and user-initiated sync (2026-09-30)

**Authorization (this entry only):** Step 10 alone. **Still unauthorized:** hosting, Cloudflare, a production origin, OAuth publishing, Android, automatic or background sync, deletion, encryption, Step 11.

**Design**

- **Google Identity Services token model** (`src/core/sync/gisTokenProvider.ts`, `gisLoader.ts`). No refresh token, no client secret. The access token lives in memory only and is dropped on `reconnect_required` or `disconnected`. Scope is `https://www.googleapis.com/auth/drive.file` only; no email or profile scope. The script (`https://accounts.google.com/gsi/client`) is loaded only after the user clicks Connect; before that, nothing contacts Google.
- **Client ID** comes from `VITE_GOOGLE_CLIENT_ID` (untracked `.env.local`). It is public configuration baked into the build and is not echoed in reports. The `scan:dist` client-ID pattern (`*.apps.googleusercontent.com`) is stripped before scanning. Playwright builds override it with a synthetic `n200-e2e-client` value. Without it (for example in CI) the Sync view says it is not configured and Connect is disabled.
- **`#/sync` view** (`Sync.svelte`, `syncController.ts`, `syncMessages.ts`, `syncBrowser.ts`): Connect/Reconnect, Disconnect (revokes the token), Sync now (one sync at a time), status summary, account mismatch, folder-conflict chooser, `remote_missing` Restore-to-Drive / Keep-local-only, single-tab and Web-Locks warnings, and a readable-unencrypted-JSON notice.
- **CSP** (meta tag, exact hosts): `script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' https://accounts.google.com/gsi/style 'sha256-RU4sU0AaS8IBGZx8XrGt/pa9A5SLA3dQszGeqT5L3Kw='; connect-src 'self' https://www.googleapis.com https://accounts.google.com/gsi/ https://oauth2.googleapis.com/revoke; frame-src https://accounts.google.com/gsi/`. No `unsafe-inline`, `unsafe-hashes`, `unsafe-eval` or wildcard anywhere. Single source of truth: `scripts/csp-policy.mjs`.
- **`scan:dist`** moved from a blanket Google-host ban to an explicit allowlist (`accounts.google.com`, `www.googleapis.com`, `oauth2.googleapis.com`) plus an exact-CSP check (`CSP_POLICY`). Any other Google-family host in the bundle fails the build.
- **Service worker:** cross-origin requests are never intercepted or cached (tests added for the Google URLs).
- **Isolation test rewritten:** the Step 9 "nothing imports the sync engine" test became "only the sync controller, its messages and its browser wiring import the engine; no file outside `src/core/sync` names a Google host."

**Defect found by the browser tests:** `App.svelte` loaded the run list once, so after a sync or restore the Run history still showed `pending`. It now reloads on every route change.

**Unchanged:** brief, `samples/`, CSV grammar, metrics, envelopes, backup format, database schema (`DB_VERSION` 3).

**Evidence** (Node 24.20.0; Chromium 153.0.8010.12, Edge 154.0.4258.37, Playwright 1.63.0): unit 879 -> **981** (57 files). Playwright **180/180** across Chromium and Edge, including 17 new tests per browser in `tests/e2e/sync.spec.ts` against a local mock Google (`tests/e2e/mockGoogle.ts`, backed by the in-repo FakeDrive): lazy load, scope, connect, sync, fresh-device restore, conflict, both `remote_missing` actions, reconnect after 401, account mismatch, folder conflict, popup closed/blocked/denied, Disconnect revoke, Web Locks unavailable, keyboard-only flow, axe serious/critical clean in five states, zero CSP violations, and leak checks over IndexedDB, localStorage, sessionStorage, Cache Storage, console logs and a backup export (no token, upload session URL, email or Drive path). `npm run verify` passes; `npm audit` 0 vulnerabilities.

**Manual smoke findings and CSP amendment (2026-09-30, owner-approved):** the owner's localhost smoke test with a dedicated test account found two CSP violations the mock could not reveal.
- GIS inserts one inline style block. Chrome reported its hash, and the owner chose that exact hash in `style-src` over `unsafe-inline`. An interim `style-src-attr 'unsafe-inline'` attempt did not clear the violation (the block is an element, not an attribute) and was removed.
- Disconnect calls `https://oauth2.googleapis.com/revoke`, which the policy blocked. `connect-src` now allows that one URL (not the whole host).
- Tests: `csp.test.ts` pins the exact policy, allows exactly one `style-src` hash and no `unsafe-*`, and allows `oauth2.googleapis.com` only as `/revoke`. `scanDistServiceWorker.test.ts` rejects the whole OAuth host, another OAuth path, a different hash, `unsafe-inline` in place of the hash, a missing hash, and inline `style-src-elem`/`style-src-attr`. 12 of those tests failed against the previous policy and pass now (unit 981 -> 982). Playwright 180/180 again.
- Also found: a first `accessNotConfigured` 403 was a Cloud project setup issue (Drive API not enabled in the client's project), not an app defect; the app reported it and changed nothing.
- Risk: the hash is tied to Google's current inline CSS. If Google changes it, the style is blocked again (a cosmetic console error; sign-in was unaffected before the fix) and the hash needs updating, as a reviewed change.

**Manual smoke result (2026-09-30, localhost, dedicated test account, stopped by owner decision):** PASS: 1 no Google traffic before Connect; 2 consent lists only "See, edit, create, and delete only the specific Google Drive files you use with this app" (`drive.file`, no email/profile); 3 Connected with no CSP errors (after the hash fix); 4 synthetic run uploaded, `synced`, file in Drive; 5 fresh-device restore in Edge with no duplicate; 7 missing-file detection, recovery from Drive's Trash, Restore to Drive and Keep local only; 10 Disconnect/revoke with no CSP errors (after the revoke-URL fix). Low findings, not blockers, recorded in `SMOKE_TEST_STEP10.md`: F1 summary does not count unchanged/skipped files; F2 stale summary after Restore to Drive; F3 Drive search can lag about a minute after trashing.

**NOT TESTED:** manually: 6 conflict (covered by automated tests), 8 reconnect after revoke, 9 different account, 11 storage inspection, 12 keyboard/screen reader (8, 9, 11 and the keyboard part of 12 are covered by automated tests against the mock; no screen-reader pass). Also untested: quotas, 7-day test-mode token expiry, real-device and mobile browsers. Automated tests never contact Google.

---

## 28. Step 11: sync summary clarity and trash-detection hardening, with audit follow-ups (2026-09-30)

**Authorization:** Step 11 (findings F1-F3 from `SMOKE_TEST_STEP10.md`), then the owner's full-project instruction to finish all locally executable work, audit it, complete `RELEASE_REPORT.md`, scan with Gitleaks, and prepare (not provision) hosting and OAuth setup. **Still unauthorized:** provisioning or deploying anything (Cloudflare, production origin), publishing OAuth, automatic or background sync, deletion, encryption, Android work and any access to `D:\Swing Trading`.

**Changes**

- **F1 (`syncController.ts`, `Sync.svelte`):** `SyncSummary` gains counts by category: `checked`, `unchanged`, `refreshed`, `alreadyPresent`, `unsupported`, `duplicate`, `tooLarge`, `trashedListed`, `unverified`. Counts only; no file names, Drive IDs or emails. Every checked file falls in exactly one category (asserted).
- **F2:** `summaryStale` is set after Restore to Drive, Keep local only and choosing a folder, and cleared by the next Sync now or Disconnect. A sync that is blocked, cancelled, needs reconnect or fails now drops the previous counts instead of leaving them under the failure message (defect found in the audit).
- **F3 (`reconcile.ts`):** every synced run's Drive file is probed directly by ID during Sync now, whether or not the search listed it. Read-only: a run can only become `remote_missing`; nothing is uploaded, untrashed or deleted. A listed file whose own metadata says it is trashed is not downloaded (`trashed`). A `403` probe is `inaccessible`, not missing. Any other probe failure (5xx, timeout, network, rate limit) leaves the run `synced` and is counted as `unverified`; only `401` (reconnect) and cancellation end the pass. Request growth: one sequential metadata GET per synced run per sync. Whether real Drive refuses to download a trashed file is INSUFFICIENT_DATA; the skip makes the result independent of the answer.
- **Host headers (`public/_headers`, `scripts/headers-policy.mjs`):** `nosniff`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'` (additive: the page CSP stays the meta tag), `Cross-Origin-Opener-Policy: same-origin-allow-popups` (not `same-origin`, which would break the Google popup), a restrictive `Permissions-Policy`, `no-cache` for the shell and `sw.js`, immutable caching only for `/assets/*`. It names no origin. `scan:dist` now fails when the file is missing, drops a required header, names an origin, uses a wildcard or `unsafe-*` value, sets an unapproved header or marks anything else immutable; the exact meta CSP and Google host allowlist are unchanged. `build-sw.mjs` and the e2e `shellPaths` helper ignore `_headers` (it is host configuration, never precached). The preview server used by Playwright sends the same `/*` headers, so the whole e2e suite runs under them. `HOSTING_SETUP.md` documents the placeholders and owner steps.
- **Final review fixes:** a Restore to Drive that needs a reconnect now drops the old counts; the preview server applies every block of `public/_headers` with the host's path matching (`headersForPath`, values from several matching blocks joined), so the cache rules are exercised by the e2e suite. `.gitleaksignore` lists the four reviewed Gitleaks findings by exact fingerprint (generated validators and redaction-test fixtures); detection of any other or new match is preserved and was checked with a canary.
- **Docs:** `SMOKE_TEST_STEP11.md`; `RELEASE_REPORT.md` is now a completed, factual readiness report (verdict: not ready for production release) instead of a blank template.

**Unchanged:** scopes, Google hosts, the meta CSP, `DB_VERSION` 3, schemas, envelopes, CSV grammar, backup format, `samples/`, the brief, the service-worker logic, dependencies.

**Evidence (automated; Node 24.20.0, Chromium 153.0.8010.12, Edge 154.0.4258.37, Playwright 1.63.0; mock Drive and mock Google only):** `npm run verify` passes. Unit 982 -> **1019** (59 files). Playwright 180 -> **188** (94 per browser). `npm audit`: 0 vulnerabilities. Gitleaks 8.30.1 (checksum-verified official release): 4 findings in both history and tree, all reviewed as false positives and ignored by exact fingerprint; both scans then report no leaks (see `RELEASE_REPORT.md` §6).

**Live smoke (owner, localhost, dedicated test account, 2026-09-30 to 2026-10-01, recorded in `SMOKE_TEST_STEP11.md`):** PASS: Drive Trash detection, repeat-sync counts, Restore to Drive, Keep local only, revoke and reconnect (consent lists only app-specific Drive file access), storage/privacy inspection, final clean sync with the original account. **NOT TESTED:** second-account mismatch (Google Testing mode blocked the alternate account before the app received a token); a specific keyboard-only or screen-reader pass; real conflict from an edited Drive file; manual install, Android, headers as served by a real host, COOP with the real sign-in popup. See `HOSTING_SETUP.md`.

**Release-candidate Git authorization (2026-09-30):** the owner confirmed intentionally public visibility and authorized branch `codex/step-11-sync-clarity-and-release-prep`, explicit-file staging, gated commit with the noreply identity, push and PR to `main`. No merge or deployment. OAuth stays in Testing; preferred future Cloudflare name is `n200-screener`, subject to availability; provisioning remains unauthorized.
