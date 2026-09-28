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
