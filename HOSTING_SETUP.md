# Hosting and OAuth setup (prepared locally; nothing provisioned)

Status: **PROVISIONED (Git-connected, owner-verified 2026-10-01).** Production origin `https://n200-screener-git.pages.dev`
(project `n200-screener-git`); evidence in `RELEASE_REPORT.md` section 9. The origin is in the OAuth client's Authorized JavaScript origins (owner-reported); OAuth publishing remains unauthorized (Testing). The
historical text below was written before provisioning; `<ANGLE_BRACKET>` values are no longer unknown. Every value below in `<ANGLE_BRACKETS>` is a placeholder the owner decides. Do not put a real
client ID, token or secret in this file.

## Placeholders (owner decisions)

| Placeholder          | Meaning                                                              | Current state |
| -------------------- | -------------------------------------------------------------------- | ------------- |
| `<CF_PROJECT_NAME>`  | Cloudflare Pages project. Recommended: `n200-screener` (D9). A DNS lookup on 2026-09-30 found no `.pages.dev` record for it or for `nifty200-screener`, `n200-screener-pwa`, `nifty200-screener-pwa`; this suggests but does not prove availability, and Cloudflare may still append a suffix | Owner prefers `n200-screener`; availability unconfirmed |
| `<PROD_ORIGIN>`      | Final `https://...` origin. Cloudflare may add a suffix if taken     | UNKNOWN       |
| `<OAUTH_CLIENT_ID>`  | Web client ID (public configuration, not a secret), set at build time | not set for prod |

## Build and host configuration (Cloudflare Pages)

- Framework preset: none. Build command `npm run build`. Output directory `dist`. Node `>=24` (`package.json` engines).
- Build variable: `VITE_GOOGLE_CLIENT_ID=<OAUTH_CLIENT_ID>` (a public value baked into the bundle; no client secret exists).
- `dist/_headers` is produced from `public/_headers` and applied by Cloudflare Pages (the same file format works on Netlify).
  It sets `nosniff`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'`, `Cross-Origin-Opener-Policy:
  same-origin-allow-popups`, a restrictive `Permissions-Policy`, `no-cache` for the shell and `sw.js`, and immutable caching
  only under `/assets/*`. It names no origin, so it needs no production value.
- The page CSP stays the `<meta>` tag in `index.html` (exact policy pinned in `scripts/csp-policy.mjs`). The `_headers` CSP
  adds only `frame-ancestors`, which a meta tag cannot express; it cannot loosen the meta policy.
- COOP is deliberately `same-origin-allow-popups`: `same-origin` would sever the Google sign-in popup's link to the page.
- `sw.js` is served from the site root, so its scope is the whole site. `_headers` is never precached (build-sw ignores it).

## Google Cloud / OAuth (owner performs personally)

1. Project and Drive API enabled (the Step 10 smoke test showed an unenabled Drive API returns `accessNotConfigured`).
2. OAuth consent screen: External, **Testing** while developing. Test users: the owner's accounts. Test-user authorization expires after 7 days in
   Testing. **Publishing is not required for personal use** (see `RELEASE_REPORT.md` 7a): with no refresh token, what Testing limits is the test user's consent, which lapses about 7 days after it was given, so Connect asks again weekly. The access token itself lasts about an hour either way. Publishing is a separate owner decision (D7) and is not prepared here.
3. Scope: `https://www.googleapis.com/auth/drive.file` only. No email or profile scope.
4. OAuth client (Web application) Authorized JavaScript origins: `http://localhost:4321` (development, already used) and, only
   after the origin is known, `<PROD_ORIGIN>`. No redirect URIs or client secret are used (token model).
5. If the hosting origin changes later, the old origin's saved sign-in does not carry over: add the new origin, reconnect, and
   re-check the Drive folder (the Drive app folder is found by `appProperties`, not by origin).

## Local validation (run before any deploy; all pass at the time of writing)

```
npm run verify          # format, lint, svelte-check, unit tests, build, scan:dist (includes the _headers policy)
npx playwright test     # Chromium and Edge; the preview server sends the /* headers
```

`scan:dist` fails the build if `_headers` is missing, drops a required header, names an origin, uses a wildcard or `unsafe-*`
value, sets an unapproved header, or marks anything but `/assets/*` immutable. It also still enforces the exact meta CSP and the
Google host allowlist.

## After a real deploy (owner checks; NOT TESTED until performed)

- `curl -sI <PROD_ORIGIN>/` shows the `_headers` values on `/`, `/sw.js` and an `/assets/*` file, and that Cloudflare did not
  add or remove a CSP or COOP.
- The page loads, registers the service worker, and works offline after one visit.
- Sign-in popup completes with COOP `same-origin-allow-popups` (real Google; the mock cannot prove this).
- `<PROD_ORIGIN>` appears in the OAuth client's origins and the dev origin is removed if no longer needed.
- Repository visibility is unchanged (intentionally public, as confirmed by the owner); no `.env.local` value is committed.
