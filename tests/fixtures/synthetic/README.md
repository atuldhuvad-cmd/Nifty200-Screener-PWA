# SYNTHETIC test fixtures

**Everything in this folder is fabricated test data. None of it is real Trendlyne data, and it must never be presented as such (decision D10).**

- **Company names:** every one is invented and starts with "Synthetic" (or a transliteration of it).
- **ISINs:** every one uses the prefix `ZZ`, which is not a real ISO 3166 country code. Valid check digits were computed for the fabricated codes. `ZZSYNTH00010` is deliberately invalid.
- **NSE codes** (`SYNA`, `SYN&CO`, …) are invented.
- **Numbers** were chosen only to exercise parsing and rounding rules.
- **Filenames:** every file starts with `SYNTHETIC_`.

The files are byte-exact inputs. `.gitattributes` disables line-ending conversion for them, and Prettier ignores this folder. Expected outcomes live in the tests, not here.

| File | Exercises |
|---|---|
| `SYNTHETIC_crlf_final_newline.csv` | BOM, CRLF line endings, final newline |
| `SYNTHETIC_escaped_quotes_embedded.csv` | `""` escapes, an embedded comma, embedded LF and CRLF inside quoted fields |
| `SYNTHETIC_unquoted_final_newline.csv` | Unquoted fields, no BOM, final LF |
| `SYNTHETIC_mixed_line_endings.csv` | Mixed CRLF and LF (warning) |
| `SYNTHETIC_blank_numerics.csv` | Blank, whitespace-only, `-` and `NA` numeric cells |
| `SYNTHETIC_missing_identifiers.csv` | Missing, invalid and normalizable ISIN/NSE codes; duplicate ISIN; `&` and `-` symbols |
| `SYNTHETIC_zero_and_negative_volume.csv` | Zero, `-0`, `-0.00`, negative numerator and denominator |
| `SYNTHETIC_non_ascii_names.csv` | Non-ASCII names (Latin-1, Devanagari, ₹, 4-byte emoji); header whitespace and case variants |
| `SYNTHETIC_grouping_commas.csv` | Western and Indian grouping commas, decimal comma, `+`, leading zeros, bare points, exponent |
| `SYNTHETIC_rounding_boundaries.csv` | ROUND_HALF_UP at scale 3 (1.2344 / 1.2345 / 1.2346 and others) |
| `SYNTHETIC_provider_mismatch.csv` | The S2 provider `VolumeRatio` comparison |
| `SYNTHETIC_missing_numerator_column.csv` | V2: `Day Vol` and `NSE+BSE Vol` present, but no `Consolidated end of day Vol` |
| `SYNTHETIC_ambiguous_numerator.csv` | Two headers normalizing to the numerator |
| `SYNTHETIC_duplicate_blank_headers.csv` | Duplicate and blank headers are preserved, with warnings |
| `SYNTHETIC_unclosed_quote.csv`, `SYNTHETIC_ragged_rows.csv`, `SYNTHETIC_bare_cr_line_endings.csv` | Syntax errors |
| `SYNTHETIC_invalid_utf8.csv`, `SYNTHETIC_utf16le_bom.csv` | Encoding rejection |
| `SYNTHETIC_run_history_multipart_1.csv`, `SYNTHETIC_run_history_multipart_2.csv` | Step 5A: a two-part multipart run whose parts deliberately reorder their headers differently, with combined Volume Ratios 0.900 / 2.000 / 9.000 / 10.000 (proving numeric, not lexicographic, ordering end to end) |
| `SYNTHETIC_5b_symbol_history_run1.csv`, `SYNTHETIC_5b_symbol_history_run2.csv` | Step 5B: same ISIN (`ZZSYNTH00015`), NSE Code changes `OLDCODE` -> `NEWCODE` across two runs — proves the comparison view treats this as one security and shows both raw symbols in its history. Never presented as Trendlyne evidence: these ISINs/NSE Codes do not correspond to a real security. |
| `SYNTHETIC_5b_nse_only_early.csv`, `SYNTHETIC_5b_isin_appears_later.csv` | Step 5B: an earlier run with no ISIN (NSE-only, `nse_code_provisional`) and a later run supplying a valid ISIN (`ZZSYNTH00056`) for the same NSE Code (`PROVCODE`) — proves the later ISIN identity is never retroactively merged into or upgrades the older NSE-only comparison entry. |
| `SYNTHETIC_5b_conflict.csv` | Step 5B: two rows sharing one NSE Code (`SHAREDCODE`) but carrying two different valid ISINs (`ZZSYNTH00015`, `ZZSYNTH00023`) — an identity conflict the comparison view must surface, never auto-merge. |

The oversized-input and page-size cases are generated inside the tests rather than stored here, to keep the repository small.
