# Claude Automation Scout: sh7pad

Recommendations to graduate sh7pad's Claude Code workflow from "I install
nothing, I just talk to Claude" to "Claude is wired into the project's
ground truth (FORMAT.md, ADRs, round-trip checks, e2e suite)."

## Summary

sh7pad is a vanilla TS + Vite SPA (~17k LOC src, 57 vitest files, 9 Playwright
specs, 1 ADR, a deep hand-rolled binary parser/encoder in `src/parser` and
`src/creator/sh7Binary*`). CI runs typecheck, build, vitest, Playwright, and
Lighthouse a11y/best-practices gates. No lint or formatter is configured.
A single maintainer, hobby cadence, intentional no-server stance.

Three Claude automations would pay off immediately:

1. **A `sh7-format-reviewer` subagent** that loads FORMAT.md + ADR-0001 + the
   parser/encoder bytes-of-record map, and reviews any diff touching
   `src/format`, `src/parser`, or `src/creator/sh7Binary*` for spec drift,
   missing verified/observed/assumed annotations, and importer/encoder
   asymmetry. This is the single highest-leverage change because the format
   is the project's irreplaceable artefact and the only docs are prose.
2. **A Stop hook that runs `npm run typecheck` + `npm test`**, so every turn
   ends with a green-or-loud signal. The project already trusts vitest and
   tsc as ground truth; missing only the wiring.
3. **A `.claude/settings.json` allowlist** for the dozen-or-so read-only
   shell commands the maintainer types every session (`gh pr view`,
   `npm test`, `npx playwright test --reporter=line`, `git log --oneline`),
   eliminating repetitive permission prompts.

The rest of this document fleshes those out and lists the skills, hooks,
agents, and MCP servers that are worth a maintainer's attention versus the
ones that aren't.

---

## Skills routinely useful

These ship with the workspace and fire on the kinds of work sh7pad maintainers
actually do. Rated R (routine, used most sessions), O (occasional, used a few
times a month), and S (situational, used once per quarter or per spike).

| Rating | Skill | Why for sh7pad |
|--------|-------|----------------|
| R | `diagnose` | Format bugs and Playwright flakes are exactly the "hard to reproduce, easy to misdiagnose" shape this skill targets. Reach for it before ad-hoc poking. |
| R | `e2e-store-handle` | The Playwright suite already does heavy pixel-coordinate clicking (`startStitch.spec.ts` is 33 KB). Exposing the project store on `globalThis` would shrink and de-flake the suite. |
| R | `verify-export-bytes` | sh7pad's whole reason to exist is exporting valid `.sh7` bytes. Any e2e that triggers an export should read the bytes back and assert magic + chunk headers, not just that the click happened. |
| R | `tdd` | The parser/encoder is the textbook case where red-green-refactor pays off (small, total, well-specified). |
| O | `html-structure` | Vanilla TS + DOM (no React/Vue) is the exact shape this skill addresses. Apply when new UI panels are added. |
| O | `css-structure` | Vanilla CSS, no Tailwind. Apply when introducing a new component stylesheet. |
| O | `deletion-test` | The codebase already favours small modules; useful before introducing a new helper or abstraction in `src/creator`. |
| O | `simplify` | Run on touched files at the end of a feature branch. |
| O | `improve-codebase-architecture` | Architecture review is already happening in `docs/hobby-plus/`. This is the skill that backs that workflow. |
| O | `claude-md-management:revise-claude-md` | Once a CLAUDE.md exists (recommended below), this keeps it honest. |
| S | `grill-with-docs` | Useful when planning a format-touching change against CONTEXT.md and `docs/adr/`. |
| S | `to-prd` / `to-issues` / `triage` | The maintainer is a team of one with a GitHub issue tracker, not Linear. These are overkill for the current cadence but worth knowing for the rare "I want to convert a spike into 5 issues" moment. |
| S | `prototype` | Worth invoking when sketching a new authoring mode or visualisation, not for day-to-day work. |
| S | `mcp-server-dev:*` | Only if the maintainer ever wants to expose sh7pad's parser/encoder as an MCP for AI assistants to round-trip binary files. Not a near-term need. |

**Skipped (do not invoke for sh7pad work)**: `claude-api`, `no-slop-writing`
(README is already tight), `fewer-permission-prompts` itself ships as a
skill but is also covered below, `keybindings-help`, `update-config` (for
one-shot config changes only), `init` (no CLAUDE.md scaffold is wanted; the
project's `CONTEXT.md` already plays that role).

---

## Recommended hooks

All snippets go in `.claude/settings.json` under a `"hooks"` key.

### 1. Stop hook: typecheck + vitest (highest priority)

The project already trusts `tsc --noEmit` and `vitest` as ground truth, and
CI runs both on every PR. Running them at end-of-turn locally catches
regressions before the user even sees a diff. The whole suite is ~2-3
seconds for typecheck and ~5-10 seconds for vitest on a warm cache.

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "npm run typecheck" },
          { "type": "command", "command": "npm test --silent" }
        ]
      }
    ]
  }
}
```

Skip Playwright in the Stop hook (60+ seconds, too slow). Run it manually or
via a dedicated `/e2e` skill instead.

### 2. PreToolUse hook: block edits to `package-lock.json`

The lock file should only change via `npm install`. A Claude turn that
hand-edits it almost certainly indicates a confused merge or a
mistyped dependency.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node -e \"const i=JSON.parse(require('fs').readFileSync(0,'utf8'));if(/package-lock\\.json$/.test(i.tool_input?.file_path||'')){console.error('Edit package.json instead and run npm install');process.exit(2);}\""
          }
        ]
      }
    ]
  }
}
```

### 3. PreToolUse hook: warn on FORMAT.md edits without a CHANGELOG bump

`FORMAT.md` is the canonical reverse-engineering reference. Touching it without
a paired CHANGELOG entry is almost always an accident, because format changes
are by definition user-visible.

This is intentionally a warning (exit 0 with stderr message), not a block,
because there are legitimate prose-only edits to FORMAT.md (typo, link fix)
that don't need a CHANGELOG entry.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node -e \"const i=JSON.parse(require('fs').readFileSync(0,'utf8'));const p=i.tool_input?.file_path||'';if(/FORMAT\\.md$/.test(p)){console.error('Reminder: FORMAT.md change usually needs a CHANGELOG.md entry.');}\""
          }
        ]
      }
    ]
  }
}
```

### 4. PostToolUse hook: run axe-core a11y on UI edits (occasional)

The project runs Lighthouse a11y in CI and has `axe-core` configured via
`src/test/a11y/mountCreator.axe.test.ts`. Wiring a PostToolUse hook to
re-run that one test when files under `src/ui/` are edited gives immediate
a11y feedback without the 30-second Lighthouse round trip.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node -e \"const i=JSON.parse(require('fs').readFileSync(0,'utf8'));const p=i.tool_input?.file_path||'';if(/^src[\\\\/]ui[\\\\/]/.test(p)){require('child_process').spawnSync('npx',['vitest','run','src/test/a11y/mountCreator.axe.test.ts','--silent'],{stdio:'inherit'});}\""
          }
        ]
      }
    ]
  }
}
```

### 5. Hooks intentionally *not* recommended

| Hook | Why skip |
|------|----------|
| Prettier/ESLint format-on-save | The project has no Prettier or ESLint config and no `.editorconfig`. The maintainer relies on TypeScript + tests, not auto-formatting. Adding a formatter is a separate decision (see `docs/hobby-plus/` other reviews). |
| `npm audit` on Stop | Only 9 devDependencies, all reputable, no runtime deps. `npm audit` would be noise. Run it once per release, not per turn. |
| `npm run build` on Stop | Slow (~10s) and largely redundant with typecheck. Build runs in CI on every push. |
| Pre-commit hook to run Playwright | 60+ seconds; would make commits painful. Leave to CI. |
| Block `.env` edits | The project has no `.env` files and the README guarantees no-server-no-secrets. The hook would never fire. |

---

## Recommended subagents

Define these in `.claude/agents/<name>.md` (the standard subagent location).
Each entry below is a one-paragraph spec the maintainer can adapt.

### 1. `sh7-format-reviewer` (highest priority)

**One-paragraph spec.** Reviews any diff touching `src/format/**`,
`src/parser/**`, `src/creator/sh7Binary*.ts`, or `FORMAT.md`. Loaded with
FORMAT.md, `docs/adr/0001-start-stitch-and-carriage-start.md`,
`docs/research/cross-format-comparison.md`, and the Kaitai spec at
`docs/format.ksy` as required reading. Checks: (a) every new claim about
the firmware in FORMAT.md is labelled `(verified)`, `(observed)`, or
`(assumed: ...)` per the project's existing convention; (b) encoder
changes have a symmetric importer change and vice versa (look for one-sided
edits in `sh7BinaryExport.ts` vs `sh7BinaryImport.ts`); (c) new chunk types
or tag bytes added in `chunkTags.ts` are also added to the validator under
`src/parser/validate/`; (d) the round-trip equivalence test
(`sh7BinaryExport.unified.test.ts`) still passes mentally for the diff. Outputs
a structured review: spec-drift risks, asymmetry, missing validators, missing
labels.

**Why it matters.** The format is the project's irreplaceable artefact. The
parser/encoder is the highest-stakes code, with the deepest implicit
knowledge, and the most prose-only documentation. A subagent that knows
FORMAT.md cold catches the failure mode (silently breaking format compat)
that no other tooling will.

### 2. `round-trip-checker`

**One-paragraph spec.** Triggered manually after any change to encoder,
importer, or chunk schemas. Runs `npm test -- sh7BinaryExport.unified` and
`sh7BinaryExport.manual` to confirm encoder ↔ decoder symmetry, then runs
the e2e export specs (`tests/e2e/export.spec.ts`). Reads the exported bytes
back and asserts magic bytes, outer chunk header, and metadata-chunk length
match FORMAT.md's top-level layout table. Useful as a one-line invocation
("@round-trip-checker") rather than asking the maintainer to remember which
of the 50 vitest specs are the round-trip ones.

**Why it matters.** Round-trip is the single most important
correctness property of the project and it's currently spread across
multiple test files with no single "did the bytes survive" command.

### 3. `playwright-runner`

**One-paragraph spec.** Runs targeted Playwright specs against the dev
server (which `playwright.config.ts` already auto-starts via `webServer`).
Knows that `startStitch.spec.ts` is the heaviest spec (33 KB, many drag
interactions) and runs it in isolation when start-stitch or carriage code is
touched. Knows that `smoke.spec.ts` is the always-on first check. Outputs
failure traces inline rather than just exit codes.

**Why it matters.** The Playwright suite is non-trivial (1500 LOC across
9 specs) and the maintainer benefits from someone who knows which subset
matches the current change set, rather than running the full suite every
time.

### 4. (Optional) `adr-author`

**One-paragraph spec.** Triggered when a non-trivial design decision is
being made. Loads `docs/adr/0001-start-stitch-and-carriage-start.md` as a
voice/structure exemplar, drafts a new ADR in the same shape (decision,
alternatives, consequences, with the project's signature
"verified/observed/assumed" framing where relevant). Saves under
`docs/adr/NNNN-<slug>.md`.

**Why it matters.** The existing ADR is genuinely good prose and worth
replicating, but a maintainer rarely sits down to write an ADR from cold.
A subagent that picks up the slack on draft-1 lowers the cost-of-ADR enough
that more decisions get captured.

---

## MCP recommendations

The project already lists `playwright` MCP tools in this session, which is
the right call for any browser-driven debugging the maintainer wants to do
ad hoc. Beyond that:

### Worth wiring up

- **GitHub MCP** (or just the `gh` CLI, which is already implied by the
  contributing guide). Most "look at PR #5" / "what does CI say on the
  current branch" workflows are one `gh` command away. If the maintainer
  installs the GitHub MCP, those become first-class tools instead of bash
  invocations. Modest win; mostly nicer error handling and structured PR
  data. Allowlist `Bash(gh:*)` either way (see permissions section).

### Not worth wiring up

- **Linear MCP**: The project tracks issues in GitHub
  (`.github/ISSUE_TEMPLATE/bug_report.md`, `feature_request.md`,
  `https://github.com/Vortiago/sh7pad/issues` in SECURITY.md). No Linear
  workspace exists. Skip unless the maintainer migrates.
- **Database MCP (Postgres / Supabase / etc.)**: sh7pad has no server and
  no database. State lives in IndexedDB inside the user's browser. There
  is no surface for a DB MCP to talk to.
- **Sentry / observability MCP**: No telemetry by design (SECURITY.md is
  explicit about this). Skip.
- **Slack / Discord MCP**: Solo project, no team channel. Skip.
- **context7 (live docs lookup)**: Tempting for the TypeScript + Vite +
  Playwright stack, but those docs are well-cached in the model and rarely
  change in breaking ways. Marginal; only install if the maintainer hits a
  specific case where docs are out of date.
- **MCPB / "build local MCP" workflows**: Out of scope unless the
  maintainer wants to expose the `.sh7` parser as an MCP tool (interesting
  side project, not core to sh7pad).

---

## Permission allowlist suggestions

Current `.claude/settings.json` has only env vars and an empty attribution
block. The maintainer therefore sees a permission prompt for every shell
command. The following allowlist covers the recurring read-only and
known-safe commands. Add under a `"permissions": { "allow": [...] }` key in
`.claude/settings.json`.

```json
{
  "permissions": {
    "allow": [
      "Bash(npm test:*)",
      "Bash(npm run typecheck:*)",
      "Bash(npm run build:*)",
      "Bash(npm run dev:*)",
      "Bash(npm run test:e2e:*)",
      "Bash(npm ci:*)",
      "Bash(npx vitest:*)",
      "Bash(npx playwright test:*)",
      "Bash(npx playwright show-report:*)",
      "Bash(npx tsc --noEmit:*)",
      "Bash(npx lhci autorun:*)",
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git show:*)",
      "Bash(git branch:*)",
      "Bash(git stash list:*)",
      "Bash(gh pr view:*)",
      "Bash(gh pr list:*)",
      "Bash(gh pr checks:*)",
      "Bash(gh pr diff:*)",
      "Bash(gh issue view:*)",
      "Bash(gh issue list:*)",
      "Bash(gh run view:*)",
      "Bash(gh run list:*)"
    ]
  }
}
```

**Intentionally *not* allowlisted** (these still prompt, on purpose):

- `git commit`, `git push`, `git rebase`, `git reset` (mutating, want
  per-call confirmation).
- `gh pr create`, `gh pr merge`, `gh release create` (mutating, public).
- `npm install`, `npm uninstall` (changes `package-lock.json`).
- Anything that writes to `dist/`, `.lighthouseci/`, or `playwright-report/`
  outside the standard scripts.

The `fewer-permission-prompts` skill can run after a few sessions to mine
the maintainer's transcripts and propose further additions; the list above
is the conservative starting point based on what the codebase clearly uses.

---

## Skipped

Items considered and explicitly skipped, with reasons:

- **CLAUDE.md.** `CONTEXT.md` already does this job (it defines the
  domain language, modes, primitives, and relationships in detail). Adding
  a CLAUDE.md would just create a second source of truth that drifts.
  Re-evaluate only if the project grows enough that CONTEXT.md becomes too
  long to load every session.
- **Auto-format on save.** No formatter is configured. Adding one is a
  separate decision (architecture review's call), not a Claude-automation
  question.
- **`npm audit` hook.** 0 prod deps, 9 dev deps. Run quarterly, not per
  turn.
- **Pre-commit Playwright.** Too slow; CI catches it.
- **Block sensitive file edits.** No secrets, no `.env`, no credentials in
  the repo by design.
- **"Translate Linear ticket → branch" workflows.** Project uses GitHub
  Issues; the GitHub-equivalent flows are simple enough that the existing
  `gh` CLI suffices.
- **Background subagent for "run all tests every N minutes".** The project
  is too small for this to be worth the context cost. Stop hook + manual
  invocation of `playwright-runner` is enough.
- **MCP-builder workflows.** Only relevant if sh7pad ships an MCP server,
  which is not on the roadmap.

---

## Suggested rollout order

If the maintainer adopts this incrementally:

1. **Permission allowlist** (5 minutes, immediate win on prompt fatigue).
2. **Stop hook for typecheck + vitest** (10 minutes, immediate win on
   regression catching).
3. **`sh7-format-reviewer` subagent** (1 hour to write the spec well; pays
   off the next time a format-touching PR lands).
4. **`round-trip-checker` and `playwright-runner` subagents** (30 minutes
   each).
5. **FORMAT.md + lock-file PreToolUse hooks** (15 minutes total).
6. **`adr-author` subagent** when the next non-trivial design call comes
   up.
