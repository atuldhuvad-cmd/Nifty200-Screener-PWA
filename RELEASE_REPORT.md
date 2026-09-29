# Release report — TEMPLATE (not completed)

> This file is a blank template. Do not fill it with real stock data, CSV values, sample or
> upload filenames, query text, tokens or Drive responses. Record counts, versions, hashes of
> the build and stable error codes only. A completed report is a separate, later deliverable.

Brief rule: release only when all required automated checks pass, no unresolved severity-high
defect remains, and every manual acceptance test has a recorded evidence trail. A passing test
demonstrates only the tested behaviour. Anything not tested is written `NOT TESTED`, never
assumed to work.

## 1. Build identity

| Field                          | Value |
| ------------------------------ | ----- |
| Commit SHA                     |       |
| Branch / tag                   |       |
| Date (UTC)                     |       |
| Node / npm versions            |       |
| `dist/` file list + SHA-256s   |       |
| Brief SHA-256 (unchanged?)     |       |
| `samples/` unchanged?          |       |

## 2. Automated checks

| Check                                        | Command                   | Result | Counts |
| -------------------------------------------- | ------------------------- | ------ | ------ |
| Format, lint, type-check                     | `npm run verify` (part 1) |        |        |
| Unit tests                                   | `npm run test`            |        |        |
| Production build                             | `npm run build`           |        |        |
| Production-output scan (`scan:dist`)         | `npm run scan:dist`       |        |        |
| Playwright — Chromium                        | `npm run test:e2e`        |        |        |
| Playwright — Edge                            | `npm run test:e2e`        |        |        |
| Gitleaks on the release delta                | `gitleaks git …`          |        |        |
| `npm audit`                                  | `npm audit`               |        |        |
| Dependency licence review                    | (see section 5)           |        |        |

## 3. Browser matrix (exact versions)

| Browser                        | Version | Status                        |
| ------------------------------ | ------- | ----------------------------- |
| Chrome desktop, current        |         |                               |
| Chrome desktop, previous major |         | NOT TESTED unless filled in   |
| Edge desktop, current          |         |                               |
| Edge desktop, previous major   |         | NOT TESTED unless filled in   |
| Chrome Android, current        |         | NOT TESTED unless filled in   |
| Safari (macOS, iOS)            |         | Unsupported / NOT TESTED (D6) |

## 4. Acceptance coverage

For each brief acceptance criterion: test name or manual evidence, result, or `NOT TESTED`.

| Criterion (brief section) | Evidence | Result |
| ------------------------- | -------- | ------ |
|                           |          |        |

Required manual evidence (record who, when, on what device):

- [ ] Keyboard-only walk-through: import, comparison, conflict resolution, modal focus trap.
- [ ] Screen-reader spot check of sort-direction announcements.
- [ ] Real Google test-account smoke tests — `NOT TESTED` until Drive work is authorized.
- [ ] Installability and offline reload — `NOT TESTED` until service-worker work is authorized.

## 5. Dependencies and licences

| Item                                   | Result |
| -------------------------------------- | ------ |
| Direct dependencies exactly pinned     |        |
| Lockfile committed                     |        |
| `npm audit` (all severities)           |        |
| Licence summary (production / dev)     |        |
| Deprecated Google auth libraries       | none expected — verify |

## 6. Privacy and security gates

| Gate                                                                | Result |
| ------------------------------------------------------------------- | ------ |
| Real private data in source / demo / test data                      |        |
| Privileged secrets in source                                        |        |
| Sensitive staged files                                              |        |
| Production bundle privacy scan                                      |        |
| Source maps absent from `dist/`                                     |        |
| Console output free of filenames, CSV values, query text, tokens    |        |
| Repository visibility appropriate                                   |        |
| Backups containing real data excluded from Git and deploys          |        |

A hash stored inside the same unsigned file gives integrity checking, not authenticity. A passing
vulnerability scan is evidence, not proof of security.

## 7. Known issues and untested areas

| ID  | Description | Severity | Status |
| --- | ----------- | -------- | ------ |
|     |             |          |        |

Explicitly `NOT TESTED`:

-
