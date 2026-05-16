# Hobby+ roadmap

Five parallel reviews of sh7pad produced the reports in this directory.
This README synthesizes them into a sequenced plan, calls out
cross-cutting wins, and ranks each item by `value / effort`.

## The five reports

| Area | Report | Headline |
|------|--------|----------|
| Architecture (LOC) | [`architecture.md`](architecture.md) | 9 findings, **−189 to −264 LOC** safe set, up to **−620 LOC** with stretch items |
| Modern web platform | [`web-platform.md`](web-platform.md) | Already modern. **25–35 LOC** of incremental polish + 1 a11y win (`inert` on dialogs) |
| Tests | [`testing.md`](testing.md) | 6 PRs, **+1,140 LOC** of tests. Top gap: parser validators have **zero unit coverage** |
| Claude automation | [`claude-automation.md`](claude-automation.md) | `sh7-format-reviewer` subagent + Stop-hook + permission allowlist |
| Hobby+ polish | [`polish.md`](polish.md) | Dependabot, CHANGELOG/v0.1.0 reconciliation, sample-file corpus, global error handler |

## What "Hobby+" looks like after this lands

- Code: **~16,800 LOC** in src/ (down from ~17,100) with the carriage state and start-frame seams centralised.
- Tests: **~3,700 LOC** in src/test (up from ~2,600), with the parser validators and round-trip metadata covered.
- CI: dependabot keeps deps current, size-limit guards bundle size, Lighthouse perf is gated (warn → error).
- Releases: actually tagged. Site footer shows commit SHA + deploy date.
- Claude: every turn ends with green-or-loud (typecheck + vitest). Permission prompts only on mutating commands.
- Errors: every uncaught exception offers the user a "copy diagnostics" affordance instead of blanking the canvas.

## Sequenced rollout (8 PRs)

Each PR is independently mergeable. The order maximises early wins and lets later PRs build on earlier infrastructure.

### Phase 1 — Foundations (one-day batch)

**PR-1: Claude workflow plumbing.** From `claude-automation.md`:
- Permission allowlist in `.claude/settings.json` (12-ish read-only commands).
- Stop hook: `npm run typecheck && npm test --silent`.
- PreToolUse warning on FORMAT.md edits without CHANGELOG bump.
- Why first: every later PR benefits from the green-or-loud signal and fewer prompts.

**PR-2: Dependabot + CHANGELOG reconciliation.** From `polish.md` top-5 items 1 and 2:
- `.github/dependabot.yml` (npm weekly + github-actions weekly).
- Decide: tag `v0.1.0` retroactively, or rewrite CHANGELOG link to point at the commit.
- Bump `@types/node` to `^24` to match `engines.node`.
- Why now: zero-risk, unblocks the dep-update PRs that dependabot will start filing.

### Phase 2 — Test-shaped safety net (two PRs)

**PR-3: Parser validator unit tests.** From `testing.md` PR-1 (highest risk gap):
- `src/test/parser/validate/*.test.ts` for each of header, o5, o6, records, satinPayload, geometryWrapper.
- Use the `tdd` skill. Estimated **+400 LOC** of tests.
- Why now: the largest correctness gap in the project; this is the safety net every later refactor leans on.

**PR-4: Sample-file regression corpus + round-trip golden bytes.** Combines `testing.md` PR-2 with `polish.md` "Sample-file regression suite" items 1–2:
- 4–6 self-authored `.sh7` fixtures under `tests/fixtures/` (empty, single straight, single satin, manual+jump, max-length, edge-of-needle-slot start).
- `goldenRoundtrip.test.ts`: import → re-export → byte-identical for each fixture.
- Use the `verify-export-bytes` skill for magic-bytes / chunk-header assertions.
- Estimated **+150 LOC** tests + **~2 KB** binary fixtures.

### Phase 3 — Architecture deepening (one PR, three commits)

**PR-5: Carriage + start-frame consolidation.** The three highest-ROI architecture findings, landed together because they all touch the same conceptual area:
- F1: single `startFrames()` helper, used by all three encoder paths (**−60 to −80 LOC**).
- F2: `pointById(project)` accessor replaces six independent Map constructions (**−25 to −40 LOC**).
- F3: `carriageStateOf(project)` accessor unifies the three `startXMm` / `startStitch` / `isStartLocked` reads (**−40 to −50 LOC**).
- Safety net: PR-3's validator tests + PR-4's round-trip goldens catch any byte-shape regression.
- Net: **−125 to −170 LOC** for the three combined.

### Phase 4 — Polish (three PRs, parallel)

**PR-6: Global error visibility.** From `polish.md` top-5 item 4 + Error visibility section:
- `window.error` + `unhandledrejection` listener that toasts "Something went wrong — copy diagnostics?".
- Inject `__APP_VERSION__` (package version + short commit SHA) at build time, surface in disclaimer modal footer.
- Wrap user-facing error toasts with `toUserMessage(err)` so internal vocabulary stays in console.
- Plus the F6 architecture finding (move start-stitch glyph into `scene.ts`) — small, low-risk, **−15 LOC**.

**PR-7: Tests round 2.** From `testing.md`:
- PR-3 (projectMigrate edge cases, **+150 LOC**).
- PR-5 (modal focus restoration, **+180 LOC**).
- Plus the `inert` attribute on `DialogBase` from `web-platform.md`.

**PR-8: Performance + bundle budgets.** From `polish.md` Performance budgets section:
- Add `categories:performance: ["warn", { minScore: 0.9 }]` to `lighthouserc.json`.
- Add `size-limit` + a CI step with a 160 KB gzip budget for `dist/assets/index-*.js`.
- After two weeks of green runs, promote both to error.

### Stretch (optional, after PR-1 through PR-8 are green)

- `sh7-format-reviewer` custom subagent (`.claude/agents/sh7-format-reviewer.md`). Highest-ROI automation per `claude-automation.md`, but writing the spec well is a real hour.
- Remaining architecture findings F4–F9 + F5A (**−50 to −85 LOC** combined, all low risk).
- ADRs for the three undocumented decisions: no-telemetry, vanilla-TS, FORMAT.md-as-authority (`polish.md` Docs item 4).
- Bundle the Vite 6 / Vitest 3 upgrades dependabot will file.

## Cross-cutting wins (where two reports compound)

- **Parser validators (`testing.md` PR-1) × `sh7-format-reviewer` subagent (`claude-automation.md`).** The subagent's value depends on validators being testable in isolation. Land PR-3 first, then the subagent can point at concrete tests instead of prose.
- **Sample-file fixtures (`polish.md` + `testing.md`) × architecture F1 / F3 (`architecture.md`).** The carriage refactor is much safer with golden bytes pinning the output. PR-4 before PR-5 is the right order.
- **Stop hook (`claude-automation.md`) × all architecture PRs.** Every architecture change wants the typecheck + vitest signal at end-of-turn, not at PR time.
- **Global error handler (`polish.md`) × `verify-export-bytes` skill (`testing.md` / `claude-automation.md`).** The "copy diagnostics" affordance is the user-side equivalent of the e2e byte-verification: both close the loop between "the bytes were emitted" and "they were the bytes I meant".

## What was explicitly skipped

Each report has its own "skipped" section. The big skips that apply across the project:

- **Auto-format / lint.** The maintainer relies on `tsc` + tests; no Prettier/ESLint is going in.
- **Telemetry / Sentry / analytics.** Privacy posture is explicit. The "copy diagnostics" toast is the substitute.
- **Coverage gating.** `testing.md` covers what to test; an arbitrary coverage number incentivises low-value tests.
- **Records/Tuples, container queries, anchor positioning.** Modern but no fit here per `web-platform.md`.
- **`carriagePlanner.ts` Phase A/B split, `sh7BinaryExportConstants.ts` byte templates.** Both flagged as "out of scope" by `architecture.md` — risk/reward is wrong.
- **Framework migration, devcontainer, i18n.** Out of scope for a hobby+ project per `polish.md`.

## Estimated end-state delta

- **src/ LOC: −189 to −264** (safe architecture set; up to **−620** with stretch items).
- **src/test/ LOC: +1,140** (six test PRs).
- **Net repo LOC: roughly flat**, but with the high-value code shrunk and the safety net thickened.
- **Time investment: ~1.5 weeks of evenings** for PR-1 through PR-8, including review cycles.
- **Risk: low.** Every code-shrinking PR has a test safety net by the time it lands.
