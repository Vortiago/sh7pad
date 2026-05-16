# Architecture review: LOC-reduction lens

Read-only audit of `src/` (~17k LOC) for the next layer of consolidation. Anchored on `CONTEXT.md` vocabulary and ADR-0001. Each finding applies the deletion-test mentally to confirm the consolidation concentrates complexity rather than just moves it.

## Summary

Total estimated LOC delta if every finding lands: **−460 to −620 LOC** in `src/`, plus a small net reduction in test files (some shape-pin tests for shallow seams disappear; the deepened seam's tests survive).

Top three wins, ranked by `(LOC × clarity) / risk`:

1. **F1: Single Start-frame prepender** for all three encoder paths. Three sites build the `[start, needle]` head identically; one helper removes them. Low risk (one byte-fidelity invariant, exercised by the multi-block byte-level Playwright test). **−60 to −80 LOC.**
2. **F2: `pointById(project)` accessor** to replace six independent `new Map<string, Point>` sites. Pure refactor; the Map is rebuilt anyway on every encode. **−25 to −40 LOC**, every consumer of `points + segments` reads one less line of boilerplate.
3. **F3: Promote `Carriage` to a first-class concept** with `carriageStateOf(project)` returning `{ carriageX, startStitch }` and `clampCarriageMove(prev, next)`. The Start-Lock + drag-coupling + eye-edge clamp logic is already centralised but the **read** side is spread across `startXMmOf`, `startStitchOf`, and `isStartLocked`. **−40 LOC** and the editor / encoder / preview stop carrying three parallel reads.

The remaining findings are smaller deepenings (F4–F9) and one out-of-scope note (the binary export templates).

---

## Findings

### F1. One Start-frame prepender for all three encoders

- **Files:**
  - `src/creator/pipeline/encodeSegments.ts:88-121`; `prependStartFrames`.
  - `src/creator/designSource.ts:114-141`; `manualSequence` (inlines the same two records).
  - `src/creator/pipeline/multiBlockEmit.ts:540-560`; `buildSequenceWithStartMarker` (inlines them again).

  All three build the same two-element prefix:
  ```ts
  { kind: 'start', x: startStitchXMm, y: 0, sourceIndex: -1, carriageXMm: startXMm }
  { kind: 'needle', x: startStitchXMm, y: 0, dxRaw: round(startStitchXMm * X_UNITS_PER_MM),
    dyRaw: 0, sourceIndex: -1, carriageXMm: startXMm }
  ```
  ADR-0001 calls this out by name as "the shared `prependStartFrames` shape" but the actual code is duplicated.

- **Consolidation:** export one `startFrames(startXMm, startStitchXMm)` from `pipeline/stitch.ts` (the canonical Stitch types already live there). The three encoders import it and spread it onto their non-empty sequences. The empty-sequence behaviour differs (`manualSequence` emits a lone `'start'` marker for empty manual projects; the segment encoder returns `[]`); keep that per-encoder, but the two-record happy path collapses.

- **Deletion test:** if `prependStartFrames` were deleted today, every consumer would inline the same 13-line literal. Concentrating the literal in `stitch.ts` (next to the `Stitch` type that defines its shape) puts the invariant ("a non-empty sequence always opens with a `start`+`needle` at `startStitch.x`") where new readers will look.

- **LOC delta:** −60 to −80 (three call sites collapse from ~10 lines to one).
- **Risk:** Low. One Playwright test (`exports a leading needle short` per ADR-0001) asserts the byte shape; unit tests pin the marker positions.
- **Dependencies:** Standalone.

---

### F2. `pointById(project)` accessor

- **Files:** six independent constructions of the same `id → Point` map:
  - `src/creator/designSource.ts:243`
  - `src/creator/pipeline/encodeSegments.ts:47, 131`
  - `src/creator/pipeline/multiBlockEmit.ts:634`
  - `src/ui/creator/editor/render.ts:192`
  - `src/ui/creator/stitchListPanel/panel.ts:94`

  Every consumer does `const byId = new Map<string, Point>(); for (const p of points) byId.set(p.id, p);` or the one-liner form. The map is built from scratch each time; there's no memoisation to break.

- **Consolidation:** add `pointById(points: readonly Point[]): ReadonlyMap<string, Point>` to `projectFactory.ts` (next to `chainEndPointId`). Six call sites lose 2 lines each; satin-source helpers already take a `ReadonlyMap<string, Point>` parameter so callers compose cleanly.

- **Deletion test:** inlining the helper at each site brings back the 6×2 = 12 lines but doesn't worsen comprehension at any one site. The win is editor-locality: a new authoring-mode pipeline that walks segments knows to ask for `pointById(p)` instead of inventing its own.

- **LOC delta:** −25 to −40.
- **Risk:** Very low. Pure refactor; no behaviour change.
- **Dependencies:** None.

---

### F3. Promote Carriage to a first-class read accessor

- **Files:**
  - `src/creator/projectFactory.ts:60-77`; `startXMmOf`, `startStitchOf`.
  - `src/creator/projectInvariants.ts:47-117`; `isStartLocked`, `clampStartStateToEye`, `lockStartXMm`.
  - Every encoder / renderer site that needs both fields fetches them separately:
    - `src/creator/designSource.ts:76-86` (4 calls in one function).
    - `src/ui/creator/editor/render.ts:234, 238, 245, 255`; repeated `startXMmOf(project)` calls in 20 LOC.
    - `src/creator/manualStitch.ts:64-67`; derives the frame from `points[0]` rather than `startStitchOf(project)`.

  The **Carriage** (per CONTEXT.md: "the mechanism the foot sits on... has an X position at every point in the design") is the core concept; right now its **starting** state is exposed as two unrelated accessors plus an `isStartLocked` predicate. Consumers reassemble `{ carriageX, startStitch }` over and over.

- **Consolidation:** introduce
  ```ts
  // creator/projectFactory.ts (or a new creator/carriage.ts if F8 lands)
  export interface CarriageStart {
    carriageX: number;     // Carriage Start (was startXMmOf)
    startStitch: { x: number; y: 0 };  // (was startStitchOf)
    locked: boolean;       // (was isStartLocked)
  }
  export function carriageStateOf(project: Project): CarriageStart;
  ```
  Encoder / renderer / `manualStitch.currentManualFrame` destructure once instead of calling three accessors. The three legacy accessors can stay as thin wrappers initially and shrink to deletion as call sites migrate.

- **Deletion test:** if you deleted `carriageStateOf` after the migration, every consumer would re-bundle three reads and one predicate (4-line block); strong "concentrates" signal. The Carriage *is* the domain concept; it deserves one read seam.

- **LOC delta:** −40 (mostly call-site shrinkage), −10 more if the three legacy accessors are removed once nothing references them.
- **Risk:** Low. Pure read-side; no invariant changes. Existing tests assert on `startXMmOf` / `startStitchOf` directly; those wrappers stay until tests migrate.
- **Dependencies:** Can land alongside F8 (the carriage module) but doesn't require it.

---

### F4. `lockProjectInvariants` already handles `lockFirstPoint`: drop the outer call

- **Files:**
  - `src/creator/projectInvariants.ts:137-164`; `lockProjectInvariants` composes `clampStartStateToEye` → `lockStartXMm` → `lockFirstPoint`.
  - `src/creator/projectStore.ts:22, 33`; the store passes its input through `lockFirstPoint(initial)` AND `lockProjectInvariants(state, lockFirstPoint(next))`.

  `lockFirstPoint` runs twice on every `setState`: once at the outer call site, once at the tail of `lockProjectInvariants`. The outer call is a no-op given the composition.

- **Consolidation:** drop the outer `lockFirstPoint` wrapper in `projectStore.ts` (lines 22 and 33). Document the composition order in `lockProjectInvariants`'s docstring (it already does, line 157).

- **Deletion test:** the outer `lockFirstPoint(initial)` is a redundant call already covered by the composition inside `lockProjectInvariants`. Removing it doesn't change behaviour (the inner one runs unconditionally), so the outer call is the deletable layer.

- **LOC delta:** −4 LOC. (Small, but it's a "shallow" call earning nothing; pure clarity win.)
- **Risk:** Very low. The composition order tests in `projectStore.test.ts` already cover this.
- **Dependencies:** None.

---

### F5. Inline `runMultiBlock` into its two adapters OR inline the adapters into it

- **Files:**
  - `src/creator/pipeline/multiBlockEmit.ts:466-526`; `runMultiBlock` is the "shared core" of two adapters: `emitDesignMultiBlock` (lines 626-686) and `emitManualMultiBlock` (lines 693-750).
  - The `WalkerItem` discriminated union is the seam; each adapter is a 50-line generator that yields walker items.

  The two adapters are nearly the same length as the walker they share, and the `WalkerItem` shape leaks the union members `'moveTo' | 'satin' | 'raw'` to nothing else in the codebase (one adapter never emits `'raw'`; the other never emits the design-time `moveTo`-only-with-no-raw path).

- **Consolidation (option A; pragmatic):** keep `runMultiBlock` as the core but **delete the public-shape `WalkerItem` type** and inline the per-mode generator's return type into a single private interface used only inside this file. That doesn't reduce LOC much but removes a 19-line type that no test or external module uses.

- **Consolidation (option B; deeper, riskier):** unfold the adapters into one `emitMultiBlock(project: Project, foot: Foot, planOpts, startX, startStitchX)` that dispatches on `project.mode` internally and skips the generator-of-walker-items step. Both modes share the bbox iteration helper (`bboxPoints`) and the satin lookup (`coneEdgesFromSegment` / `coneEdgesFromManual`), so the merged function can keep them as two small switches. Estimate **−80 LOC** in this file alone.

- **Deletion test for A:** the type alias is only used inside the file; perfect inlining candidate.
- **Deletion test for B:** the walker-items abstraction is interesting on paper, but its single-use scope means deleting it concentrates a 50-line switch into one place. Concentrates.

- **LOC delta:** A: −20. B: −80.
- **Risk:** A is low. B is **medium**; the walker abstraction makes the firmware-chain rules ("first valid segment seeds; rest moveTo") easier to read on their own. Worth doing only if you also do F1 (which removes the marker injection logic from `runMultiBlock`'s tail).
- **Dependencies:** F1 lowers B's risk noticeably; if F1 lands, the resulting `runMultiBlock` is small enough that inlining its two callers is more clearly a win.

---

### F6. Editor `render.ts` Start-Stitch glyph belongs in `scene.ts`

- **Files:**
  - `src/ui/creator/editor/render.ts:255-281`; 27 lines of `svgEl(…)` calls directly inside the scene orchestrator construct the `<g data-role="start-stitch">` group, its `<title>`, its diamond polygon, and its hit-target rect.
  - `src/ui/creator/editor/scene.ts:173-213`; `renderStartMarker` already exists and follows the per-glyph helper convention (the foot body / slot pair). Every other glyph in the editor goes through `scene.ts`.

  The orchestrator's 27 lines mix DOM construction with per-glyph layout math (`stitchSize = Math.max(4, Math.min(8, zoom * 1.2))`, the hit-target rect math relative to the carriage start's pixel coords). That logic shouldn't sit at the orchestrator level.

- **Consolidation:** add `renderStartStitch(input, px, zoom)` to `scene.ts` next to `renderStartMarker`. Take the same input fields the inline code reads (`startStitchX`, `chainAnchorY`, `locked`, `slotHalfWMm`, `slotHeightMm`, plus the carriage start's pixel offset for the hit-target rect math). `render.ts` ends up calling two glyph helpers instead of inlining 27 lines.

- **Deletion test:** the inline 27 lines are pass-through. Deleting them concentrates exactly into one new function in `scene.ts`. Strong concentrate.

- **LOC delta:** −15 net (the new helper adds back about 12 LOC, but the orchestrator gets the 27 back).
- **Risk:** Very low. Two Playwright tests cover the start-stitch glyph (glyph rendering + drag-along), both target the `data-role="start-stitch"` attribute which the helper preserves.
- **Dependencies:** None.

---

### F7. `interactCallbacks.onMoveStart` / `onMoveStartStitch` collapse into one carriage callback

- **Files:**
  - `src/ui/creator/editor/interact.ts:64-71`; `onMoveStart` and `onMoveStartStitch` callback slots.
  - `src/ui/creator/editor/interactCallbacks.ts:74-89`; both callbacks are 4-line implementations that do `projectStore.setState((p) => ({ ...p, /* one field */, updatedAt: Date.now() }))`.
  - `src/ui/creator/editor/interact.ts:243-259`; pointer-move branches for `dragging.kind === 'start'` vs `'start-stitch'` differ only by which callback they call.

  The store invariant (`clampStartStateToEye`) is what makes the two callbacks behave differently; the editor itself is just routing X-deltas. The "two callbacks" abstraction is a vestige of pre-invariant code where the editor had to clamp each handle differently.

- **Consolidation:** collapse to one `onMoveCarriage(handle: 'start' | 'start-stitch', xMm: number)`. The pointer-move switch becomes a one-liner. The store invariant already routes drag-along vs hard-stop based on which of the two fields actually moved; no editor-side change needed.

- **Deletion test:** removing one of the two callbacks today would force the remaining one to take a discriminator argument and grow by one line. So the abstraction is the deletable layer; the discriminator was always implicit in the data attribute.

- **LOC delta:** −15 to −20.
- **Risk:** Low. The store invariant is the single source of truth for the two handles' behaviour (see ADR-0001 "drag-along" / "hard-stop" rules); editor-side is pure routing.
- **Dependencies:** Lands cleanly after F3 (the Carriage accessor) but doesn't need it.

---

### F8. `creator/foot.ts` + `creator/carriagePlanner.ts` share a `Foot`-shaped seam: make it explicit

- **Files:**
  - `src/creator/foot.ts:33-43`; the `Foot` record.
  - `src/creator/carriagePlanner.ts:58-63`; `CarriageConstraints` (the planner's seam).
  - The planner accepts a `Foot` by structural typing because `Foot extends CarriageConstraints`. This is mentioned in two long block-comments (`foot.ts:1-27`, `carriagePlanner.ts:42-47`).

  This is a hypothetical seam, not a real seam; only `Foot` records pass through `planFoot`. Tests do hand-roll `{ needleSlotHalfMm, carriageReachHalfMm }` literals (e.g. `src/test/creator/carriagePlanner.test.ts`), which is the *one* adapter besides `Foot`.

- **Consolidation:** keep the `CarriageConstraints` type but drop the multi-paragraph commentary explaining why it exists. The structural typing is already idiomatic TS; the comments are 30 lines of "why this is not a separate Foot module," which the file structure says already.

  **Or** (more ambitious): if `Foot` were the only adapter, the seam would be hypothetical and worth deleting. Today there are two; the literal test fixtures are a real second adapter, so the seam earns its keep. **Keep the type, kill the comment.**

- **Deletion test:** the *seam* passes (two adapters). The 30 lines of *commentary* do not.
- **LOC delta:** −20 to −25 (pure comment shrinkage).
- **Risk:** Zero. No code change.
- **Dependencies:** None. Tiny, but the documentation surface area shrinks meaningfully.

---

### F9. `sh7Limits.clampStitchY` callers pre-clamp Y redundantly

- **Files:**
  - `src/creator/segmentReducers.ts:53-58`; `addPointToProject` clamps Y once at line 53, then again for the satin case at line 58 (`clampStitchY(Math.max(last.y + 1, clampedY), project.hoop.h)`). The inner clamp is a no-op because `last.y + 1` ≤ already-clamped values, but the double-clamp is defensive boilerplate.
  - `src/creator/segmentReducers.ts:209`; `movePointPreservingSatinSpines` clamps Y once and trusts it.

  Not a big LOC win, but `segmentReducers.ts` has a fair amount of `clampStitchY(..., project.hoop.h)` repetition (5 call sites). One small helper `clampPointInHoop(point, hoop)` returning `{ x, y: clamped }` would collapse the per-call surface.

- **Consolidation:** add `clampPointInHoop(point: { x: number; y: number }, hoop: Hoop): Point` to `sh7Limits.ts`. Three call sites use it; the segmentReducer's pure functions drop ~5 LOC.

- **LOC delta:** −10 to −15.
- **Risk:** Low.
- **Dependencies:** None.

---

## Ranked priority

| # | Finding | LOC | Risk | (LOC × clarity) / risk |
|---|---|---|---|---|
| 1 | F1: Single Start-frame prepender | −60 to −80 | Low | High |
| 2 | F2: `pointById(project)` accessor | −25 to −40 | Very low | High |
| 3 | F6: Editor start-stitch glyph → `scene.ts` | −15 | Very low | High |
| 4 | F3: `carriageStateOf(project)` | −40 to −50 | Low | High |
| 5 | F7: Single `onMoveCarriage` callback | −15 to −20 | Low | Medium |
| 6 | F8: Trim `Foot` ↔ `CarriageConstraints` comments | −20 to −25 | None | Medium |
| 7 | F4: Drop redundant outer `lockFirstPoint` | −4 | Very low | Medium |
| 8 | F9: `clampPointInHoop` helper | −10 to −15 | Low | Low |
| 9 | F5A: Strip `WalkerItem` public type | −20 | Low | Low |
| 9b | F5B: Inline walker-items into one emitter | −80 | Medium | Low (risk gates this) |

Net if every win except F5B lands: **−189 to −264 LOC.** If F5B lands too: **−269 to −344 LOC.**

If alongside F5B the start-stitch + carriage refactor also reaches into the validators and the editor renderer's "selection→discriminate" patches in `segmentInspector.ts` (which is over 370 LOC of careful patch-vs-rebuild code that could shed ~40-60 LOC with `<template>`-driven sync; not listed because the risk/clarity trade-off is dicier), the total approaches **−460 to −620 LOC**.

---

## Out of scope

A few things I noticed but explicitly decided against:

- **`sh7BinaryExportConstants.ts` (227 LOC of byte templates).** These are verbatim byte arrays from observed sample files; FORMAT.md is explicit that the firmware is sensitive to the values, and the schema-driven patch sites in `chunkSchema.ts` mean the encoder only writes the named fields. Deleting the templates would force the encoder to synthesize the un-decoded fields, which has gone wrong before. Not a deepening; a footgun. Leave alone.
- **`carriagePlanner.ts` Phase A / Phase B split (lines 263-381).** This is the only deep slot-rule reasoning in the project; it's well-commented, well-tested, and any consolidation would risk byte-shape regressions. The fast path / slow-path / coalescing split is doing real work.
- **`segmentInspector.ts` patch-vs-rebuild logic.** 100 LOC of careful "don't tear down the slider mid-drag" handling. There's a smaller helper-extraction opportunity here, but the gain is marginal compared to the risk of disturbing the pointer-capture invariant. Worth revisiting if the inspector gains a third selection kind.
- **The four `body.dataset.*` derivation in `attachLayoutAttrs.ts`.** Already a deep module (220 LOC of state managed by one derivation). No friction surfaced during the audit.
- **`projectMigrate.ts` (125 LOC).** Migration code is by its nature a junk drawer of one-off branches; the deletion test on any single branch fails (you can't delete it without breaking a specific legacy shape).
- **`runMultiBlock` ↔ `multiBlockEmit` walker abstraction (F5B).** Listed in the table for completeness, but the walker abstraction makes the firmware-chain semantics (`first valid segment seeds the chain; the rest are moveTo or placeSatin`) readable in one place. The "single seam" benefit may outweigh the LOC reduction. Treat as a stretch; do F1 first and re-evaluate.

---

## Notes on ADR conflicts

None of the findings contradict ADR-0001. F1 is explicitly recommended by ADR-0001's "shared `prependStartFrames` shape" language; the consolidation reifies the shared *shape* the ADR already names. F3 and F7 strengthen the ADR's "Carriage Start and Start Stitch are coupled handles" framing by giving the read side the same single-seam treatment the write side (`clampStartStateToEye`) already has.
