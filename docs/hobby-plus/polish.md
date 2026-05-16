# Hobby+ Polish Audit

Date: 2026-05-16
Scope: cross-cutting project health for sh7pad (CI, deps, docs, error visibility, releases, sample regression).
Excluded: architecture (#1), web platform (#2), test strategy (#3), Claude automations (#4).

Priority scale: **1 = ship now (high ROI, low cost)**; **5 = nice-to-have / wait for signal**.

---

## Summary: top 5 highest-ROI items

1. **Dependabot config** (P1). Zero dependency-update plumbing today. A two-file `.github/dependabot.yml` (npm weekly + github-actions weekly) gives free CVE coverage and keeps `actions/checkout@v6` etc. current. ~10 minutes.
2. **Automate the release tag / version flow** (P1). CHANGELOG declares `v0.1.0` and links a GitHub release that does not exist (no git tags in the repo). The site auto-deploys from `main` on every push, but tagged releases are referenced as if they matter. Either drop the tag pretence or wire a tiny `release.yml` (manual `workflow_dispatch`, bumps version, tags, drafts GitHub release).
3. **Commit a sample-file regression corpus** (P1). Every test that touches the binary format synthesizes bytes inline (`SINGLETON_O6_BLOCK_TEMPLATE`, `MULTI_O6_BLOCK_TEMPLATE`). There is no on-disk `.sh7` corpus a future refactor can be checked against. Add 4-6 self-authored fixtures under `tests/fixtures/` and a single round-trip test that imports each and re-exports byte-identically.
4. **User-facing error reporting beyond toast** (P2). Imports already toast on failure (`sidebar/callbacks.ts:110`). But unhandled rejections and synchronous renderer throws have no path to the user; the canvas just goes blank. Add a `window.addEventListener('error', ...)` + `unhandledrejection` listener that surfaces a single toast with a "copy diagnostics" affordance (project JSON + UA string).
5. **Browser support statement** (P2). README and SECURITY.md never name supported browsers. The code uses native `<dialog>`, `:has()`, `color-mix()`, CSS nesting, BroadcastChannel-era APIs (per the web-platform audit). Add a one-paragraph "Tested in current Chrome/Firefox/Safari; older browsers may render incorrectly" to README. Also add a `browserslist` field so `vite build` warns when downlevel polyfills would be needed.

---

## CI / release

| # | Item | Priority | Notes |
|---|------|---------:|-------|
| 1 | `ci.yml` and `a11y.yml` overlap on checkout+install+build but run as separate jobs. | 4 | Each pays ~30s of `npm ci`. Could be merged into one workflow with multiple jobs sharing a setup step via `actions/cache`. Low ROI unless CI minutes start to bite. |
| 2 | `ci.yml` does not run `npm run lint` or `npm run format` because the scripts do not exist. | 3 | Either add eslint+prettier (extra dep weight) or commit explicitly to "tsc + tests are the linter". If the latter, document it in CONTRIBUTING so contributors do not propose ESLint configs unprompted. |
| 3 | E2E job in `ci.yml` installs `chromium` only; Playwright config also only declares chromium. Firefox + WebKit are absent. | 3 | Acceptable for a hobby project, but at minimum say so in CONTRIBUTING. A nightly cron firing WebKit would catch Safari-specific breakage cheaply. |
| 4 | `pages.yml` deploys on every push to `main`, including doc-only commits. | 3 | Add a `paths-ignore` for `**.md`, `docs/**`, `.github/ISSUE_TEMPLATE/**` so README typos do not trigger a Pages redeploy. |
| 5 | No concurrency cancellation on `ci.yml` / `a11y.yml`. | 3 | A `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }` block stops superseded PR pushes from queueing duplicate runs. |
| 6 | Lighthouse CI only uploads to `filesystem`; the GitHub status check is gated on a secret that forks cannot read. | 4 | Working as designed and documented in the workflow comment; flagged only because it means external PRs see a missing status. Optional: switch to `target: "temporary-public-storage"` so fork PRs get a link. |
| 7 | No bundle-size budget enforcement. | 2 | The build runs but nothing fails on a regression. Add `size-limit` (one dev dep + a 6-line config + a CI step) with a budget like `"160 KB gzip"` for `dist/assets/index-*.js`. Catches an accidental moment.js-class regression in one PR. |

## Dependency hygiene

| # | Item | Priority | Notes |
|---|------|---------:|-------|
| 1 | No `.github/dependabot.yml`. | 1 | See top-5. The npm config alone is worth it; `actions/checkout@v6` and `actions/setup-node@v6` will move and silent staleness is the failure mode. |
| 2 | `@types/node` is pinned to v22 but `engines.node` requires `>=24`. | 2 | Bump to `@types/node@^24` so types match the runtime; otherwise contributors get spurious red squigglies on `node:`-prefixed APIs. |
| 3 | `vite ^5.4.0` while Vite 6 is the current major. | 3 | Vite 6 is a soft cutover. Wait for dependabot to file the PR (once configured); validate against the e2e suite before merging. |
| 4 | `vitest ^2.1.0` while v3 ships. | 3 | Vitest 3 changes some snapshot serializer defaults; bundle with the Vite 6 upgrade. |
| 5 | `jsdom ^25` while v26 ships. | 4 | Low risk; deferred polish. |
| 6 | No `npm audit` step in CI. | 4 | dependabot covers the same surface for npm. Skip unless dependabot is rejected. |
| 7 | No `package-lock.json` integrity check in CI. | 5 | `npm ci` already enforces it. No action. |

## Docs and onboarding

| # | Item | Priority | Notes |
|---|------|---------:|-------|
| 1 | `CONTRIBUTING.md` is solid on the rules-of-the-road, but does not say "first PR? try one of these". | 3 | Add a `good-first-issue` label section and a "PR checklist" pointing at the four CI gates (tsc, vitest, playwright, lighthouse) so contributors know in advance what will run. |
| 2 | No PR template under `.github/pull_request_template.md`. | 2 | A 6-line template ("what changed / why / how tested / screenshots if UI") nudges quality without ceremony. Mirrors the bug-report template's tone. |
| 3 | No CODEOWNERS. | 3 | Single maintainer makes this near-cosmetic, but a `CODEOWNERS` of `* @Vortiago` ensures GitHub auto-requests review on PRs from collaborators in the future. |
| 4 | ADRs: only 0001 exists. | 2 | At least three decisions deserve capture: (a) "no telemetry, no error reporting service — we accept blind-spots in exchange for the privacy claim"; (b) "vanilla TS over a framework"; (c) "format is reverse-engineered, format docs in `FORMAT.md` are authoritative". These are decisions a future contributor will second-guess. |
| 5 | `docs/user-guides/` is comprehensive for the *features*. There is no troubleshooting guide. | 3 | A `troubleshooting.md` covering the two predictable user pain-points (storage quota toast, machine rejecting an exported file) would deflect issues. |
| 6 | README does not mention the `.sh7c.json` round-trip story for sharing in-progress designs. | 4 | The CHANGELOG mentions it; the README does not. One sentence in "What's in here". |
| 7 | `FORMAT.md` is the crown jewel of this repo. There is no link to it from the README's first screen. | 3 | The current link is at line 38 under "What's in here". Promote to a "Reverse-engineering notes" callout near the top — it is what makes this repo interesting to outside engineers. |
| 8 | `SECURITY.md` reporting flow is "open a public issue". | 4 | Defensible for a static client-side app, but a one-line "or email atle@havso.net" is one extra line and lets non-public reports land. |

## Error visibility

| # | Item | Priority | Notes |
|---|------|---------:|-------|
| 1 | No global `window.onerror` / `unhandledrejection` handler. | 2 | See top-5. Today, an exception in render path leaves the canvas blank with only the dev-tools console as a signal. A 20-line module that toasts "Something went wrong - copy details?" with a clipboard button is enough. |
| 2 | Errors that are surfaced (import/export/quota in `sidebar/callbacks.ts` and `mountCreator.ts:102`) use `(err as Error).message` directly in user-facing text. | 3 | Fine for hobby, but message text leaks internal vocabulary (e.g., `StorageError`, validator strings). Wrap with a `toUserMessage(err)` so the toast stays friendly and the raw message goes to console. |
| 3 | No "report this file" affordance for `.sh7` imports that fail. | 2 | The format is reverse-engineered, so import failures *are* the bug-report stream. On import error, the toast could offer a "Copy diagnostic bundle" button that puts (file size, first 32 bytes hex, error message, UA) on the clipboard ready to paste into a GitHub issue. Cheap, high signal, matches the spirit of the bug-report template's "hex excerpt" ask. |
| 4 | No version string visible in-app. | 3 | When users file a bug, "sh7pad version / commit" is the first field of the bug template and they cannot fill it without `git log`. Inject `__APP_VERSION__` via Vite `define` (from `package.json` + short commit SHA), surface in About / footer. |
| 5 | Console errors during boot (e.g., IDB blocked, localStorage disabled) silently degrade. | 3 | Detect once at boot, show a non-dismissible banner: "Browser storage is unavailable; projects will not persist." Better than the user discovering this when they reload tomorrow. |

## Accessibility (beyond unit-test axe)

| # | Item | Priority | Notes |
|---|------|---------:|-------|
| 1 | `prefers-reduced-motion` is honored in `tapRipple.css`, `bottomSheet.css`, `inspectorPeek.css`. Coverage is *good* in the styling layer. | - | Not flagged; just noting the audit found this. |
| 2 | Lighthouse CI a11y threshold is `0.95`. The web/format community uses `1.0` as the practical bar for new components. | 4 | Optional tightening; raise to `0.98` once a CI run shows headroom. |
| 3 | No automated keyboard-trap test for the `<dialog>` modals. | 3 | jsdom + axe will not catch focus traps. A single Playwright spec that tabs through the disclaimer modal and asserts focus stays inside is ~15 lines. |
| 4 | `aria-live="polite"` region (`#canvas-announce` in `index.html:31`) exists but is not exercised by an a11y test. | 4 | Add one vitest that verifies the canvas announces a non-empty string after a stitch is placed. Otherwise it can silently rot. |
| 5 | No screen-reader smoke test (NVDA / VoiceOver) documented. | 5 | Not realistic for a hobby project. Mention in CONTRIBUTING that SR testing is welcomed but not gated. |
| 6 | High-contrast mode (`forced-colors: active`) is untested. | 4 | One CSS audit pass to ensure custom-painted SVG strokes degrade. The canvas may be inherently broken under forced-colors, in which case state so. |

## Performance budgets

| # | Item | Priority | Notes |
|---|------|---------:|-------|
| 1 | Lighthouse asserts `accessibility >= 0.95` and `best-practices >= 0.9`. It does **not** assert `performance` or `seo`. | 2 | Add `categories:performance: ["warn", { minScore: 0.9 }]` first (warn, not error). After two weeks of green runs, promote to error. The site is fast; let the gate reflect that. |
| 2 | No LCP / TBT budgets in `lighthouserc.json`. | 3 | Once perf gating is on, add `largest-contentful-paint: ["warn", { maxNumericValue: 2500 }]` and `total-blocking-time: ["warn", { maxNumericValue: 200 }]`. |
| 3 | No bundle-size budget. | 2 | See CI item #7. The single most likely source of perf regression is `npm install some-tempting-library`; size-limit catches that at PR time. |
| 4 | Lighthouse only runs against `localhost:4173/sh7pad/` with `numberOfRuns: 1`. | 4 | One run has noisy results. Bump to 3 and rely on median; CI minute cost is small. |
| 5 | No `lighthouserc.json` mobile preset run. | 4 | Site is desktop-first per its target, but a `mobile` preset run (warn-only) catches viewport / touch-target regressions before users do. |

## Release process

| # | Item | Priority | Notes |
|---|------|---------:|-------|
| 1 | CHANGELOG references `v0.1.0` GitHub release and tag; neither exists in the repo. | 1 | See top-5. Either tag and create the release, or rewrite the CHANGELOG link to point at the commit (`https://github.com/Vortiago/sh7pad/commit/<sha>`). Currently the link 404s. |
| 2 | `package.json:version` is `0.1.0` but `pages.yml` deploys whatever `main` is. Version number is decorative. | 2 | Either (a) accept it and remove the version from `package.json` discussion, or (b) wire a `release.yml` workflow that runs on tag push, bumps version, builds, deploys, and creates a GitHub release with auto-generated notes. Option b is ~30 lines of YAML. |
| 3 | No "released vs deployed" distinction surfaced to users. | 3 | The deployed site is HEAD-of-main, not the most recent tagged version. A footer line "sh7pad <commit-sha> (deployed YYYY-MM-DD)" with a link to the changelog is honest about this. |
| 4 | No automated changelog. | 3 | `release-please` (Google) or a manual flow using `git log --oneline` since the last tag is fine. Hobby-scale: a one-line bash script `git log v$LAST..HEAD --oneline > CHANGELOG-draft.md` invoked by the release workflow. |
| 5 | Rollback is "force-push to main and wait for Pages to redeploy". | 4 | A `workflow_dispatch` on `pages.yml` already exists, so `git revert` is one command. Document this in CONTRIBUTING under "if a deploy breaks production". |

## Sample-file regression suite

| # | Item | Priority | Notes |
|---|------|---------:|-------|
| 1 | Zero `.sh7` or `.sh7c.json` fixtures committed. | 1 | See top-5. The repo explicitly forbids proprietary samples (good), but the maintainer can author and commit their own. 4-6 fixtures: empty design, single straight segment, single satin, manual mode with jump, max-length design, edge-of-needle-slot start stitch. |
| 2 | No "golden bytes" test for the encoder. | 2 | The existing test infrastructure handles inline bytes for chunk schema. Extend with a `goldenRoundtrip.test.ts`: for each fixture, parse → re-export → assert byte equality. Catches encoder drift across refactors. |
| 3 | No "third-party file we should still parse" corpus. | 3 | The format is reverse-engineered. A reasonable hobby-scale compromise: ask one or two users via issue tracker to contribute *their own* sample files (which they own), commit under `tests/fixtures/community/` with their attribution. |
| 4 | No fuzz / property test for the parser. | 4 | A 50-line `fast-check` test that generates random byte sequences and asserts the parser either returns a valid project or throws a typed `ValidateError` (never crashes the renderer) would be high-value but is real new dependency weight. Defer until first crash-on-import bug. |
| 5 | Producer-string regression. | 3 | Test exists (`producerString.test.ts`); flagged only as a reminder that the `sh7pad` producer string is part of the file format contract and should be in any goldens. |

---

## Skipped

- **Telemetry / analytics**: explicitly out of scope per `CONTRIBUTING.md` and the project's privacy posture. No recommendation to add anything that phones home, including error-reporting services like Sentry. The "report this file" affordance (Error visibility #3) is the privacy-respecting equivalent.
- **Multi-language support / i18n**: hobby project, single maintainer, English-only is fine. Flag this only if/when a contributor offers a translation.
- **Stable release channel**: continuous-deploy-from-main is appropriate at this scale. Don't introduce a beta/stable split until there is more than one user actively reporting bugs.
- **Code coverage gating**: vitest has coverage out of the box but enforcing a number creates incentive to write low-value tests. The test-strategy audit (#3) covers what *should* be tested instead.
- **Security scanning beyond dependabot**: CodeQL / Snyk are overkill for a static client-side app with no network calls.
- **Hosted issue tracker beyond GitHub Issues**: project is small enough that GitHub Issues + the existing two templates cover it.
- **Containerized dev environment / devcontainer**: `npm ci && npm run dev` is the whole story. A devcontainer would be ceremony.
- **Renaming Mocha-style describe blocks, lint config debates, prettier vs dprint**: not polish, just bikeshedding.
