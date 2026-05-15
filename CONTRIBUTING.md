# Contributing

PRs welcome. The repo is intentionally small and entirely client-side
(no servers, no telemetry); see [README.md](README.md) for the project
disclaimer before submitting anything substantial.

## Ground rules

- **No proprietary samples.** Do not commit `.sh7` files you didn't
  author yourself, and do not embed bytes copied from a vendor sample.
- **No decompiled code.** Do not include source extracted from firmware
  dumps, disassembly listings, or internal function names. The
  `FORMAT.md` reference describes what the bytes mean, derived from
  observation and on-machine probing.
- **Keep the disclaimer honest.** The README promises everything runs
  in the browser and that exported files are experimental. PRs that
  add server calls, telemetry, or auto-update mechanisms need explicit
  discussion first.

## Local setup

```sh
npm ci
npm run dev       # vite dev server at http://localhost:5173/sh7pad/
npm test          # vitest unit + integration suite
npm run test:e2e  # playwright (first run: `npx playwright install chromium`)
npm run build     # production build (writes to dist/)
```

Requires Node 24+.

## Filing a bug

If a `.sh7` file misbehaves on your machine, the most useful report
includes:

- the machine model and what it shows on screen,
- a brief hex excerpt of the bytes that differ (`xxd file.sh7 | head`),
- whether the same input loaded on a different machine the same way,
- if possible, the `.sh7c.json` project export so we can re-run the
  encoder on the same source.

For UI bugs, a screenshot + browser/OS line is enough.

## Branch and commit style

- Branch off `main`; rebase rather than merge.
- One logical change per commit. Commit messages have a short subject
  line and a body that explains _why_ (the diff already shows _what_).
- CI must be green (`npm test`, `npm run test:e2e`, `npx tsc --noEmit`,
  Lighthouse a11y/best-practices) before merge.
