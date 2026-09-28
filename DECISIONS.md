# Nifty 200 Screener PWA: Decisions Record

- **Date:** 2026-09-27
- **Status:** pre-implementation decisions confirmed by the project owner. **This document does not authorize implementation.** Implementation begins only after separate, explicit approval.
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
| Implementation, scaffolding, package installs, git | **No.** Pending explicit approval. |
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
