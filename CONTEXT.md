# sh7pad

Browser-based viewer, creator, and editor for `.sh7` decorative-stitch files (Husqvarna Viking, reverse-engineered). Runs entirely client-side. This context covers the authoring model — projects, modes, segments, stitches, the foot/carriage mechanics that gate placement, and the encoder boundary.

## Language

### Modes

**Design Mode**:
Authoring mode where the user places **Points** chained by **Segments**. The encoder turns each Segment into Needle/Jump Stitches at export. The default for new projects.
_Avoid_: segment mode, segments mode, design-segment mode

**Manual Mode**:
Authoring mode where the user places **Needle Stitches**, **Jump Stitches**, and **Satin Segments** individually. Each placement is gated by the live **Foot Frame**.
_Avoid_: stitch mode, raw mode

### Authoring primitives

**Segment**:
A design-time path between two **Points**. Either **Straight** or **Satin**. Becomes one or more Stitches at export.
_Avoid_: line, edge, path

**Straight Segment**:
A simple line between two Points. Encoder fills it with evenly-spaced Needle Stitches (plus Jumps where needed).

**Satin Segment**:
A vertical-spine satin band. Authored in either Mode. Encoder fills it with a zig-zag of Needle Stitches.

**Point**:
A coordinate that participates in a Segment. Lives in `project.points`. Not itself a Stitch.
_Avoid_: vertex, node, stitch

**Start Stitch**:
The first needle drop in every project — a real Needle Stitch in both **Design Mode** and **Manual Mode**, encoded as a normal dx/dy record. Always sits inside the **Needle Slot** (its X is bounded by `±needleSlotHalfMm` around the **Carriage Start**). Y is always 0. In a fresh project it sits at (0, 0). Slidable in X by the user — freely in Design Mode at any time, freely in Manual Mode until the first user Stitch is placed (then locked by the **Start Lock**). In Manual Mode, the first user click is validated against the **Foot Frame** that exists *after* the Start Stitch has been laid. Stored in a dedicated field on the Project (not as a Point or a manual stitch). **Undeletable** — its existence is part of every Project.
_Avoid_: chain anchor, first point, initial stitch, anchor

**Chain End**:
The `to`-endpoint of the last Segment in Design Mode — where the next click appends. In a project with no user-placed Points, the Chain End is the **Start Stitch**.
_Avoid_: tail, cursor

### Stitches

**Stitch**:
A single machine action: either a **Needle Stitch** or a **Jump Stitch**. Stitches are what the machine actually performs on fabric.

**Needle Stitch**:
The needle goes down; the **Carriage** stays planted.

**Jump Stitch**:
Needle and Carriage advance together. ≤ 1 mm dx per record (firmware envelope).

### Foot and carriage

**Foot**:
The presser foot. V1: **Foot B** (decorative, narrow reach), **Foot S** (side-motion, wide reach), or hidden ("no suggestion"). A creation-time property of the project (`suggestedFoot`).

**Carriage**:
The mechanism the foot sits on. Slides laterally on Jump Stitches; stays planted on Needle Stitches. Has an X position at every point in the design.

**Carriage Start (`startXMm`)**:
The Carriage's X position at the start of a design — the position the carriage holds before the first machine record runs. Bounded by **Carriage Reach** on its own, and additionally by the requirement that the **Start Stitch** must sit inside the Needle Slot. Freely draggable in Design Mode; locks in Manual Mode once any user Stitch is placed (**Start Lock**).
_Avoid_: start marker, foot start, start position

**Start Lock**:
The rule that freezes both **Carriage Start** and **Start Stitch** in Manual Mode once any user Stitch has been placed — moving either retroactively would invalidate every downstream Foot Frame check. Design Mode never locks (the encoder re-plans from scratch on every render).

**Needle Slot**:
The Foot's mechanical needle window — ± `needleSlotHalfMm` (3.5 mm, total 7 mm) around the Carriage. A Needle Stitch is only valid when the cursor sits inside the Slot. The inner rectangle of the foot icon visualises this; users sometimes call this "the eye."
_Avoid_: eye, slot, window (use only as informal UI labels)

**Carriage Reach**:
Maximum `|Carriage X|` allowed by the Foot. Foot B: ±4.5 mm. Foot S: ±27.25 mm. The wide reach is achieved by carriage slide, not by widening the Needle Slot.

**Foot Frame**:
Snapshot of (Carriage X, Needle X, Needle Y) after a given Stitch. Manual Mode's placement gate runs against the current Foot Frame.

## Relationships

- A **Project** has one **Mode** and one **Foot**, both fixed at creation.
- Every Project — Design or Manual — begins with a **Start Stitch** at (0, 0) and a **Carriage Start** at 0.
- A Design-Mode project is a sequence of **Segments** connecting **Points**, beginning at the **Start Stitch** and ending at the **Chain End**.
- A Manual-Mode project is the **Start Stitch** plus a sequence of **Needle Stitches**, **Jump Stitches**, and **Satin Segments**, each validated against the **Foot Frame** at the moment of placement.
- **Start Stitch X** is constrained by the inequality `|startStitch.x − carriageStart.x| ≤ needleSlotHalfMm` (i.e., always inside the Eye).
- **Carriage Start X** is constrained by `|carriageStart.x| ≤ carriageReachHalfMm` (the active Foot's reach).
- Both are slidable on the X axis only. Y is fixed at 0 for the Start Stitch.
- **Drag coupling**:
  - Dragging the **Carriage Start** *drags the Start Stitch along* — the Start Stitch's eye-relative offset is preserved, so the foot keeps moving freely without the Eye constraint blocking it.
  - Dragging the **Start Stitch** is *hard-stopped at the Eye edge* — the foot stays put, mirroring the machine where the needle physically hits the foot wall.
- **Reshape-only geometry**: Dragging either handle reshapes only the *first* **Segment** (its starting Point gets new coordinates). Other Points are never moved by a Start-Stitch or Carriage-Start drag.
- **Start Lock**: after the first user-placed Stitch in Manual Mode, both freeze. Design Mode never freezes them.
- **Migration of legacy projects**: on-disk projects predating this model are migrated by clamping the persisted `startXMm` (now **Carriage Start**) to `±needleSlotHalfMm`, and synthesizing **Start Stitch** at `(0, 0)` to match the legacy locked `points[0]`. Geometry is otherwise preserved.

## Example dialogue

> **Dev:** "What happens when the user drags the **Carriage Start** in **Design Mode** with no Segments yet?"
> **Author:** "The foot icon slides along X within **Carriage Reach**. The **Start Stitch** stays put unless dragging the foot would push the Start Stitch outside the **Needle Slot** — then it's pulled along so the constraint stays satisfied."
> **Dev:** "And in **Manual Mode** after the first user Stitch?"
> **Author:** "Both freeze. The **Start Lock** takes effect because every downstream Stitch was validated against the Carriage Start and Start Stitch in effect at placement time."

## Flagged ambiguities

- "Eye" — user-facing colloquialism for **Needle Slot**. Resolved: prefer **Needle Slot** in code, docs, and ADRs; "eye" is acceptable in UI tooltips for sewing audiences only.
- "Chain Anchor" / "first point" / "anchor" — legacy terms for what is now the **Start Stitch**. Resolved: **Start Stitch** is canonical; "chain anchor" survives only as the historical name in code paths that haven't been renamed.
- "First stitch" — colloquially the same as **Start Stitch**. Resolved: use **Start Stitch** in design docs; "first stitch" is fine in casual conversation.
- "Start" (overloaded) — could mean **Carriage Start** (`startXMm`), **Start Stitch**, or the `'start'` pseudo-record the encoder prepends to the StitchSequence. Resolved: use the full term; never bare "start".
- "Segment mode" — incorrect alias for **Design Mode**. Resolved: use **Design Mode**.
