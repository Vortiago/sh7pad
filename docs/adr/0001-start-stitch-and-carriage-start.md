# Start Stitch and Carriage Start as separate, eye-bound handles

Replace the legacy "chain anchor locked at x=0" + "freely-draggable `startXMm`" pair with two coupled handles: a **Start Stitch** (dedicated `project.startStitch` field, Y=0, slidable within the Needle Slot) and a **Carriage Start** (slidable within Carriage Reach, dragging it drags the Start Stitch along). The Start Stitch is encoded as a real first machine record (a needle drop) in both Design and Manual Mode — `xElem` keeps its existing role of encoding the Carriage Start position.

The previous model allowed `|startXMm − 0| > needleSlotHalfMm`, which the firmware can't physically execute: the preview faked it by emitting a fast carriage walk before the first stitch. The chosen design enforces the slot invariant by construction, gives users a real handle on where the first needle drops within the eye, and unifies Design Mode and Manual Mode (both now begin with an explicit Start Stitch as the first machine record). The simpler alternative — just clamping `startXMm` to ±3.5 mm — was rejected because it loses the expressive freedom the .sh7 format genuinely supports (the carriage and the first needle can sit at independent positions within the slot, and that maps to a real degree of freedom in `xElem` + the first record's `dx`).

## Considered alternatives

- **Just clamp `startXMm` to ±3.5 mm.** Simplest fix but collapses two file-format degrees of freedom into one, and offers the user no direct manipulation of the first needle position.
- **Couple the Start Stitch and Carriage Start rigidly (Option A from the design discussion).** One handle, simpler UI, but the user can't position the first needle anywhere except dead-center of the foot.
- **Two independent handles (chosen).** Adds a UI affordance and a third top-level entity to the Project, but matches the .sh7 format's actual expressive range and makes the first machine record visible and movable.

## Consequences

- New `project.startStitch: { x: number }` field stored alongside `startXMm` on the Project. `startStitchOf(project)` is the read accessor.
- `lockFirstPoint` no longer pins `points[0].x = 0` — it now mirrors `points[0].x` to `startStitch.x` and forces `points[0].y = 0`. `points[0]` is a synthetic view of the Start Stitch so the segment-from-id machinery keeps working.
- `clampStartStateToEye` enforces the slot invariant `|startStitch.x − startXMm| ≤ needleSlotHalfMm` AND the reach invariant `|startXMm| ≤ carriageReachHalfMm`. On a same-project carriage move it drags the Start Stitch along (preserves the eye-relative offset). On a same-project Start Stitch move it hard-stops at the Eye edge.
- Encoder emits a leading needle record (the Start Stitch) as the first machine record in every non-empty design — singleton encoder (`encodeSegments`), satin walker (`runMultiBlock`), and manual sequence (`manualSequence`) all share the same `prependStartFrames` shape. `xElem` continues to encode `-carriageStart × 1000` µm; the leading needle's `dxRaw = round(startStitch.x × 8)` ferries the cursor from machine origin to the Start Stitch.
- Importer (`parsedStitchFileToProject` and `parsedStitchFileToManualProject`) does compatibility-matching on the file's first record: a needle with `dy = 0` whose landing X fits the slot of the imported `xElem` is consumed as the Start Stitch; otherwise the importer synthesizes `startStitch.x = 0` and treats the file's first record as a regular user stitch. Files emitted by the new sh7pad round-trip byte-identical.
- Editor renders a distinct green-diamond glyph for the Start Stitch inside the foot's slot, with the entire slot region as a touch-friendly hit target. The foot body outside the slot routes to the Carriage drag.
- Migration of legacy projects clamps any persisted `startXMm` outside the eye down to `±needleSlotHalfMm` and synthesizes `startStitch.x = 0` (legacy `lockFirstPoint` pinned the old chain anchor there).
- Manual Mode locks BOTH handles after the first user stitch is placed (`lockStartXMm` — the Start Lock now freezes both).
- Test coverage: 883 unit tests + 16 Playwright tests (5 of which exercise the two-handle interaction model: glyph rendering, drag-along on carriage move, hard-stop on Start Stitch move, the carriage moving freely within reach, and a byte-level assertion that a `startStitch.x = 2 mm` design encodes a leading needle short with `dx = 16, dy = 0`).
