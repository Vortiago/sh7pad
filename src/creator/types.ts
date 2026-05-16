// Data model for the Creator. Keep these types narrow: the projectStore
// passes Project shapes through migrate/lock invariants on every mutation,
// so consumers can trust the discriminated union.

import type { FootId } from './foot.js';
import type { JumpStitch, NeedleStitch } from './pipeline/stitch.js';
import type { SatinEndAt } from '../shared/satinShape.js';

export type { SatinEndAt };

export interface Hoop {
  /** Half-width in mm; X axis spans [-halfW, +halfW]. */
  halfW: number;
  /** Total height in mm; Y axis spans [0, h]. */
  h: number;
}

export interface Point {
  id: string;
  x: number; // mm
  y: number; // mm
}

interface BaseSegment {
  id: string;
  from: string; // Point.id
  to: string;   // Point.id
  /**
   * True when this segment was created by importing a real binary .sh7
   * (so the user knows it can't yet be re-encoded back to binary).
   */
  imported?: boolean;
}

export interface StraightSegment extends BaseSegment {
  type: 'straight';
}

export interface SatinSegment extends BaseSegment {
  type: 'satin';
  /** Cone width at the segment start, in mm. */
  widthStart: number;
  /** Cone width at the segment end, in mm. */
  widthEnd: number;
  /** Spacing between alternating zigzag drops along the spine, in mm. */
  density: number;
  /**
   * Where the chain should leave the cone. The satin geometry itself
   * always lands at BR (firmware convention, see satinShape.ts); a
   * non-'right' value tells the encoder to append one trailing needle
   * drop to nudge the chain to the requested corner before the next
   * element starts. Default 'right' (= undefined here).
   */
  endAt?: SatinEndAt;
}

export type Segment = StraightSegment | SatinSegment;

export interface BgImage {
  /**
   * Raw image bytes. Stored natively in IndexedDB (no base64 overhead) and
   * rendered via URL.createObjectURL() — object-URL lifecycle is owned by
   * the mount layer so it can revoke previous URLs when the bg changes.
   */
  blob: Blob;
  x: number; // mm offset from canvas origin (top-left of design area)
  y: number;
  scale: number;
  rotate: number;
  opacity: number;
  /**
   * When true the editor pointer handler ignores hits on the bg image.
   * Prevents accidental drags after the user has positioned it.
   */
  locked?: boolean;
}

/**
 * A satin segment placed in manual mode. Structurally identical in role
 * to {@link SatinSegment}: the encoder flattens both into zig-zag
 * needle drops and emits the same `02 03 01` chunk on export. The only
 * reason this type exists separately is storage. Design-mode satins
 * reference their spine endpoints through `project.points` (so dragging
 * a shared point moves the satin too), while manual mode has no shared
 * point graph and inlines the spine coordinates directly.
 *
 * Lives inside {@link ManualStitchInput} alongside NeedleStitch and
 * JumpStitch only because manual placement order is recorded as one
 * flat array, but conceptually it is a segment, not a machine stitch.
 * The satin's chain advance (to the cone's BR corner, matching
 * the .sh7 convention) is computed at encode time, not stored here.
 */
export interface ManualSatinSegment {
  kind: 'satin';
  /** Spine start (absolute mm); = chain anchor when this satin begins. */
  x: number;
  y: number;
  /** Spine end (absolute mm). */
  toX: number;
  toY: number;
  /** Cone width at the spine start, in mm. */
  widthStart: number;
  /** Cone width at the spine end, in mm. */
  widthEnd: number;
  /** Spacing between alternating zigzag drops along the spine, in mm. */
  density: number;
  /**
   * Where the chain should leave the cone. See SatinSegment.endAt.
   * Default 'right' (= undefined here).
   */
  endAt?: SatinEndAt;
}

/**
 * The storage shape of a manual-mode needle stitch. Same as the encoder's
 * {@link NeedleStitch} minus the encoder-only bookkeeping fields
 * (sourceIndex, carriageXMm) — those are computed at encode time, not
 * stored in the project.
 */
export type ManualNeedleStitch = Omit<NeedleStitch, 'sourceIndex' | 'carriageXMm'>;

/** Same Omit as {@link ManualNeedleStitch} but for the jump variant. */
export type ManualJumpStitch = Omit<JumpStitch, 'sourceIndex' | 'carriageXMm'>;

/**
 * Items in `project.manualStitches`. The name is historical: needle and
 * jump entries ARE machine stitches, but ManualSatinSegment is a segment
 * (a recipe the encoder flattens). It shares the array purely to
 * preserve placement order alongside the real stitches.
 */
export type ManualStitchInput = ManualNeedleStitch | ManualJumpStitch | ManualSatinSegment;

export type ProjectMode = 'design' | 'manual';

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  hoop: Hoop;
  /** Foot the machine should suggest when this design is loaded. Locked at project creation. */
  suggestedFoot: FootId;
  /** Suggested upper-thread tension as the displayed value (e.g. 4.0). */
  threadTension: number;
  /**
   * Authoring mode. Locked at project creation; the store invariant
   * rejects any setState that mutates this field.
   *   • 'design'  — segment-authored. points/segments are populated;
   *                 manualStitches must be empty.
   *   • 'manual'  — directly placed stitches. manualStitches is
   *                 populated; points contains only the chain anchor;
   *                 segments must be empty.
   */
  mode: ProjectMode;
  points: Point[];
  segments: Segment[];
  /** User-placed stitches when mode === 'manual'. Empty when mode === 'design'. */
  manualStitches: ManualStitchInput[];
  /**
   * Carriage's X position (mm) at design start — the slot's centre when
   * the firmware loads the file. Encoded in the geometry wrapper's
   * `xElem` field (= `-startXMm × 1000` µm); the firmware places the
   * carriage there before the first machine record runs.
   *
   * Constraint: bounded by `±carriageReachHalfMm` on its own AND by the
   * requirement that the **Start Stitch** sit inside the Needle Slot
   * (`|startStitch.x − startXMm| ≤ needleSlotHalfMm`). Dragging the
   * carriage in the editor drags the Start Stitch along so the slot
   * constraint stays satisfied (drag-along behavior).
   *
   * Locked in Manual Mode once any user stitch is placed (Start Lock).
   *
   * Optional so projects predating this field default to 0.
   */
  startXMm?: number;
  /**
   * The **Start Stitch** — the first needle drop in the design. A real
   * machine record encoded as a normal dx/dy short stitch. Y is always 0
   * (not stored). X is bounded by `|startStitch.x − startXMm| ≤
   * needleSlotHalfMm` (must sit inside the Needle Slot). In a fresh
   * project sits at (0, 0). Slidable in Design Mode at any time;
   * slidable in Manual Mode until the first user stitch is placed,
   * then frozen by the Start Lock.
   *
   * Dedicated field (not derived from points[0]) because the Start
   * Stitch is a third top-level entity alongside Segments and manual
   * Stitches, has its own invariants, and is undeletable. `points[0]`
   * is kept in sync as a synthetic mirror so existing segment-from
   * references continue to work.
   *
   * Optional so projects predating this field default to {x: 0}.
   */
  startStitch?: { x: number };
  bg: BgImage | null;
  /**
   * Per-record stitch length strategy.
   *   • 'compact' (default) — emit the longest legal needle stitch the
   *     carriage slot allows, falling back to walks only when forced. Fewer
   *     records; mixed-looking punctures on the fabric.
   *   • 'uniform' — cap every record (needle and jump) at 1 mm in both
   *     X and Y so punctures land at uniform spacing. More records.
   * Optional so projects predating this field default to 'compact'.
   */
  encoderMode?: 'compact' | 'uniform';
}

export interface IdGenOptions {
  idGen?: () => string;
}
