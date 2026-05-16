# Test Strategy Review: sh7pad

## Inventory Summary

Test files: 57 in `src/test`, 9 in `tests/e2e`. Total: 2590 LOC unit + 1462 LOC e2e.

**By area:**
- **Creator** (43 test files, ~10,000 LOC): UI components (editor, toolbar, sidebar, dialogs), store/state (project, uiStore), pipeline/encoding (sequenceFromProject, encodeDesign, stitch, trackFoot), export (sh7BinaryExport), and manual mode (addManualStitch, validateManualStitch).
- **Format** (2 test files, 402 LOC): Binary format readers/writers (chunkSchema, recordCodec) with verbatim template validation.
- **Shared** (2 test files, 233 LOC): Geometry helpers (satinParity, satinShape).
- **A11y** (3 test files): axe-core gate (mountCreator), keyboard nav (editor.keyboard), touch targets (phoneToolbar).
- **E2E** (9 files, 1462 LOC): Smoke (onboarding, project creation), editing workflows, export/download, manual mode, preview, startStitch variants.

**Test granularity:** Mostly unit (jsdom + fake-indexeddb). Vitest for unit; Playwright for e2e. No parser-specific tests (parseFile, validateSh7Bytes, parseChunks untested in isolation).

---

## Brittle Patterns

### 1. No Parser Validation Tests
**Files:** `src/parser/validate/*` (header, metadata, o5, o6, records, geometryWrapper, satinPayload) — 8 validators covering the binary format spec — are tested only indirectly through round-trip exports.

**Risk:** High. Format validators are gnarly, well-specified logic. A bug in o5/o6 slot reading or metadata bounds checking won't surface until a malformed .sh7 file is loaded. The equivalence invariant test (`sh7BinaryExport.unified.test.ts`) proves encoder ↔ decoder match *given a valid project*, but doesn't verify the decoder rejects invalid payloads.

**Lines affected:** src/parser/validate/header.ts, src/parser/validate/o5.ts, src/parser/validate/o6.ts, src/parser/validate/records.ts, src/parser/validate/satinPayload.ts (~600 LOC validator code, 0 unit tests).

### 2. Missing Round-Trip Validation on Parser Output
**Files:** `sh7BinaryExport.manual.test.ts:63–80` does a single round-trip (export → parseFile → step sequence shape), but doesn't:
- Validate magic bytes and chunk headers against format spec
- Assert bbox metadata integrity after reparse
- Test that step counts and field ranges survive the round-trip
- Verify footer CRC/structure

**Risk:** Medium. Binary export could emit structurally sound bytes that parse cleanly but have silent data corruption (e.g., bbox clamped wrong, tension bytes bumped incorrectly in slot 3).

### 3. Snapshot Tests Without Regression Tracking
**Files:** `editor.snapshot.test.ts`, `preview.snapshot.test.ts` — structural snapshots (SVG element counts, classes, point/segment IDs).

**Risk:** Low. Snapshots are shallow (element-tag and class counts only, not visual rendering), so false positives are rare. But noise accumulation is possible if the render pipeline changes.

### 4. No Keyboard Trap or Focus Restoration Tests for Modals
**Files:** `mountCreator.axe.test.ts` disables `landmark-*` and `region` rules in jsdom. Axe-core can't evaluate focus restoration after modal close or keyboard-trap rules truthfully in headless jsdom.

**Risk:** Medium. A modal that doesn't restore focus to the trigger button (e.g., export dialog closing, new-project dialog cancel) won't be caught until Lighthouse-CI or user testing. Keyboard traps (tabbing cycles within a dialog instead of the document) are also jsdom-blind.

**Recommendation:** Add a focused unit test for each modal (disclaimerModal, newProjectDialog, exportDialog) that:
- Opens the modal
- Captures the trigger element's id
- Closes the modal (Escape or Cancel button)
- Asserts that `document.activeElement` is the original trigger

Lines: ~200 LOC for 5 modals × 1 test each.

### 5. E2E Tests Lack Data-Driven Assertions for State
**Files:** `tests/e2e/editing.spec.ts:8–48` — reads the inspector widthStart value from the DOM, but no store-level assertion that the project state actually changed.

**Example:** The test sets `widthStart = 3.05` via `evaluate()` and dispatchEvent, then checks the row label text. If the label rebuilding worked but the reducer didn't fire, the test would still pass.

**Risk:** Low (visual correctness is typically the goal), but flakiness is possible if DOM-to-state binding is delayed. The `e2e-store-handle` skill exposes `globalThis.store` to make this easier.

### 6. No Font-Loading or Prefers-Reduced-Motion Tests
**Files:** Tests run in jsdom (no layout, no font metrics) and bare Playwright (no color-contrast or prefers-reduced-motion).

**Risk:** Negligible. Accessibility is gated by Lighthouse-CI (mentioned in mountCreator.axe.test.ts header), not unit tests. Animation flakiness would show up in e2e if animations were tested, but currently the e2e suite is pure interaction flow, not animation assertions.

---

## Coverage Gaps (Ranked by Risk)

### 1. Parser Validation (HIGH RISK)
- **What's missing:** Unit tests for each validator in `src/parser/validate/*.ts`. Specifically:
  - `header.ts`: bounds checks on O5/O6 stitch counts, hoop dimensions
  - `o5.ts`: slot offsets, tension bumping (slot 3), slot-pattern sequence
  - `o6.ts`: foot byte, multi-block frame layout
  - `records.ts`: stitch-kind classification, coordinate encoding
  - `satinPayload.ts`: width range, carriage-reach clamping
  - `geometryWrapper.ts`: bbox vs. stitch-sequence bbox matching

**Estimated LOC:** ~400 (60–80 per validator, 5 edge cases each).

**Why:** These validators are load-bearing. A typo in a slot offset or a missing bounds check corrupts user data on import.

### 2. projectMigrate.ts (MEDIUM RISK)
- **What's missing:** `src/creator/projectMigrate.ts` handles v1→v2 hoop conversion, missing satin widths, mode/foot defaults, startXMm clamping. Currently only tested indirectly in `project.test.ts:93–150`.
- **Gap:** No tests for:
  - v1 hoop (w, h) → v2 (halfW, h) re-centering math (points should shift ±w/2)
  - Missing widthStart/widthEnd synthesis on satin segments
  - startXMm clamping to `±NEEDLE_SLOT_HALF_MM` when it exceeds carriage reach
  - Idempotency (migrate(migrate(p)) == migrate(p))

**Estimated LOC:** ~150.

**Why:** Projects loaded from localStorage/disk that predate recent schema changes could lose data if migration is wrong. The invariant test (`sh7BinaryExport.unified.test.ts`) would catch a gross bug, but silent data loss (e.g., re-centering off by 0.5 mm) is hard to spot.

### 3. Encoder Edge Cases in Pipeline (MEDIUM RISK)
- **What's missing:** `src/creator/pipeline/encodeSegments.ts` and `trackFoot.ts` handle foot-specific planning (Foot B vs. S, needle sampling, carriage slotting). Tests exist for:
  - Manual ↔ segment equivalence (`sh7BinaryExport.unified.test.ts`)
  - sequenceFromProject dispatch (`sequenceFromProject.test.ts`)
  - But NOT:
    - Edge case: segment longer than foot reach (should jump-split)
    - Edge case: carriage X exactly at needle-slot boundary (rounding)
    - Edge case: jumps with dxRaw > 127 or dyRaw > 32,767 (overflow)
    - Foot S planner: slot-window packing with density=uniform vs. compact

**Estimated LOC:** ~180.

**Why:** These are the "gnarly, well-defined" behaviors mentioned in the brief. A segment that *should* jump-split but doesn't (because of a boundary-condition bug) will export silently and break on a real machine.

### 4. Footer and Metadata Round-Trip (LOW-MEDIUM RISK)
- **What's missing:** After exporting a project and parsing it back, tests don't verify:
  - Footer (CRC, element count) matches original
  - Bbox metadata (minX, maxX, minY, maxY) is correct
  - hoop dimensions, thread tension, startXMm survived the round-trip
  - Carriage tracking (carriageX in the sequence) matches the parsed file's multiblock record

**Estimated LOC:** ~120.

**Why:** Metadata corruption (e.g., bbox off by 1 mm) would go unnoticed. A user exports a project, imports it again, and suddenly the machine tries to sew outside the hoop.

---

## Recommended New Tests (Ordered by Priority)

### PR 1: Parser Validators Unit Tests (HIGH)
**Scope:** Add `src/test/parser/validate/*.test.ts` for each validator.

**Tests:**
- `header.test.ts`: O5/O6 stitch count bounds, hoop-H clamping, magic byte recognition
- `o5.test.ts`: Slot offsets, tension byte unbumping (slot 3 = +6 special case), slot-pattern sequence readback
- `o6.test.ts`: Foot-byte reading, multi-block stride & offset math
- `records.test.ts`: Kind → stitch-class mapping, delta encoding ranges
- `satinPayload.test.ts`: Width min/max, carriage-reach enforcement
- `geometryWrapper.test.ts`: Bbox covering all stitches (not just endpoints)

**Grain:** Each validator gets 60–80 LOC of tests. Use the `SINGLETON_O6_BLOCK_TEMPLATE` and `MULTI_O6_BLOCK_TEMPLATE` constants from sh7BinaryExportConstants as fixtures.

**Estimated LOC delta:** +400.

**Skill:** `tdd` (write tests first, then fix bugs found).

---

### PR 2: Round-Trip Verification with verify-export-bytes (HIGH)
**Scope:** Expand `sh7BinaryExport.manual.test.ts` and add a new round-trip suite.

**Tests:**
- `.sh7 magic bytes, version bytes, element count in footer` (parseFile result)
- `bbox metadata: minX, maxX, minY, maxY all match stitch-sequence bounds`
- `thread tension, hoop dimensions, startXMm survive export→parse`
- `carriage-X tracking in jumps matches sequence footprint`
- `round-trip-stable`: export(p) → import → export(p2) → byte-equality with export(p)

**Grain:** Add ~120 LOC of assertions to existing test files, plus one new `roundTrip.test.ts` with 5–6 tests.

**Use `verify-export-bytes` skill:** It provides helpers to read magic bytes, chunk headers, and structure from a .sh7 binary without re-implementing the parser.

**Estimated LOC delta:** +150.

---

### PR 3: Migration Tests (MEDIUM)
**Scope:** New file `src/test/creator/projectMigrate.test.ts`.

**Tests:**
- v1 hoop {w: 240, h: 150} → v2 {halfW: 120, h: 150} + point shift correctness
- Missing widthStart/widthEnd on satin segments default to config values
- startXMm > carriageReachHalfMm gets clamped
- Idempotency: migrate(migrate(p)) equals migrate(p)
- Mode defaults (missing mode, manualStitches arrays)

**Grain:** ~150 LOC. Use existing project factories; test the migrateProject function directly.

**Estimated LOC delta:** +150.

---

### PR 4: Encoder Edge Cases (MEDIUM)
**Scope:** Expand `src/test/creator/pipeline/encodeDesign.test.ts` and add `encodeSegments.edge-cases.test.ts`.

**Tests:**
- Segment longer than foot reach triggers jump-splits (Foot B with 20 mm segment)
- Carriage X at needle-slot boundary (e.g., exactly ±3 mm for Foot B) rounds consistently
- dxRaw overflow: a 20 mm jump is split into multiple jump records, not single >127
- Foot S planner: uniform density vs. compact mode with identical point layout
- Start Stitch offset (startXMm) carries through the sequence

**Grain:** ~50–70 LOC per test, ~6 tests.

**Estimated LOC delta:** +180.

---

### PR 5: Modal Focus Restoration (MEDIUM)
**Scope:** New file `src/test/creator/modalFocus.test.ts`.

**Tests (one per modal):**
- disclaimerModal: dismiss button (Got it) returns focus to the main canvas
- newProjectDialog: Cancel returns focus to the trigger (New Stitch button)
- exportDialog: Escape and Cancel both return focus
- bottomSheet: close button returns focus to last-active editor element

**Grain:** ~40 LOC per test. Use `beforeEach` to focus the trigger, `afterEach` to check restoration.

**Estimated LOC delta:** +180.

---

### PR 6: E2E State Assertions with Store Handle (LOW)
**Scope:** Refactor `tests/e2e/editing.spec.ts` to expose `globalThis.store`.

**Tests:** Rewrite 3–4 existing tests to assert store state in addition to DOM text:
- Edit a satin segment: verify `projectStore.state.segments[2].widthStart === 3.05` (not just row label)
- Subdivide: verify `projectStore.state.segments.length` increased
- Delete: verify segment is gone from the store

**Use `e2e-store-handle` skill:** It mounts the store on globalThis.store so tests can read/mutate without UI clicks.

**Estimated LOC delta:** +80 (refactor, not new tests).

---

## Recommended Refactors (With Skill References)

### 1. Consolidate Axe Configuration (MINOR)
**Where:** `src/test/a11y/mountCreator.axe.test.ts` disables 4 rules that jsdom can't evaluate. The disabled-rules list is hardcoded.

**Refactor:** Extract `JSDOM_BLIND_AXE_RULES` to a shared constant in `src/test/a11y/axeConfig.ts`. Update the list when axe-core is upgraded or jsdom support improves.

**Why:** Single source of truth. If a new a11y test (e.g., disclaimerModal.axe.test.ts) is added, it reuses the same config.

**Estimated LOC delta:** +10.

---

### 2. Simplify E2E Helper Selectors (MINOR)
**Where:** `tests/e2e/helpers.ts` — 54 LOC with 4 exported functions and good intent, but data-action selectors are scattered across 9 spec files.

**Refactor:** Add a selector registry helper:
```typescript
export const sel = {
  disclaimerDismiss: () => 'button[data-action="disclaimer-dismiss"]',
  exportButton: () => 'button[data-action="export"]',
  modeSwitch: (mode: 'edit'|'preview') => `#mode-switch button[data-mode="${mode}"]`,
  ...
};
```

**Why:** Reduces duplication and centralizes DOM structure contracts. If a data-action name changes, fix it once.

**Estimated LOC delta:** +60 (new registry), −40 (less duplication in specs) = +20 net.

---

### 3. Parameterize A11y Test Fixtures (MINOR)
**Where:** `src/test/a11y/mountCreator.axe.test.ts` builds DOM manually with hardcoded IDs and classes.

**Refactor:** Extract the DOM-building to a test fixture factory. Allow mounting creator in isolation (just the editor) or with sidebar, for partial a11y audits.

**Why:** Future a11y tests (modal focus traps, keyboard nav landmarks) can reuse the fixture without copy-paste.

**Estimated LOC delta:** +50.

---

## Coverage Gaps Summary

| Gap | Risk | Area | Est. LOC | Priority |
|-----|------|------|---------|----------|
| Parser validators untested | HIGH | src/parser/validate/* | +400 | 1 |
| Round-trip metadata verification | HIGH | export↔import | +150 | 1 |
| projectMigrate edge cases | MEDIUM | src/creator/projectMigrate.ts | +150 | 2 |
| Encoder boundary conditions | MEDIUM | pipeline/encodeSegments | +180 | 2 |
| Modal focus restoration | MEDIUM | UI dialogs | +180 | 2 |
| E2E store assertions | LOW | tests/e2e | +80 | 3 |

**Total recommended new LOC:** ~1,140 across 6 PRs.

---

## Skipped / Out of Scope

- **Color contrast & visual regression:** Handled by Lighthouse-CI (see mountCreator.axe.test.ts header). Not in unit scope.
- **Network error injection:** App has no network dependencies; skipable.
- **IndexedDB corruption:** fake-indexeddb is in-memory; corruption isn't a failure mode we test for in units. E2E with real IDB would be a separate infrastructure concern.
- **Touch gesture flakiness:** phoneToolbar.test.ts (touchTargets) tests size/spacing; gesture animation tested manually or via Lighthouse. Playwright can't emulate touch events reliably cross-platform.
- **Snapshot test noise:** The existing snapshots (editor.snapshot, preview.snapshot) are structural, not visual. Upgrading to visual regression (e.g., Percy, Chromatic) is a separate initiative.

---

## Flakiness Vectors (Observed)

**Export e2e tests:** Use `page.waitForEvent('download')` before clicking the export button. This is a race: if the download fires before the listener is installed, it's missed. Current tests consistently pass (downloads are immediate), but risk is nonzero. Mitigation: none needed unless export becomes async or deferred.

**Modal timing:** All modal tests use `await expect(locator).toBeVisible()` or `.toHaveCount(0)`, which Playwright auto-waits. Low flakiness risk.

**Canvas focus tests:** `editor.keyboard.test.ts` dispatches synthetic KeyboardEvent on the SVG. This is deterministic (no animation, no network). No flakiness observed.

---

## Final Notes

**Strengths:**
- Strong equivalence invariant (manual ↔ design encode unification).
- Round-trip testing for binary export (single test, but solid).
- Comprehensive UI component coverage (43 creator tests).
- A11y gate via axe-core prevents major WCAG violations.

**Gaps:**
- Parser validation is the largest blind spot: validators are untested in isolation, so format bugs hide until deployment.
- Migration logic (project loading from disk) lacks edge-case coverage.
- E2E suite is interaction-focused, not state-focused; store assertions would raise confidence.

**Recommendation:** Start with PRs 1 and 2 (parser validators + round-trip verification). These address the highest-risk gaps and are straightforward to write. PR 3 and 4 follow naturally. PRs 5 and 6 are polish.
