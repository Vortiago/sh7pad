// Convert a real binary .sh7 ParsedDesign (from src/parser) into an
// editable Creator Project. The binary parser produces:
//   - elements with absolutePoints (raw stitch units, original coords)
//   - satin sections (cone-shaped fills between two outline curves)
//   - blocks: ordered alternation of element/satin
//
// Two top-level entry points share one walker:
//   - parsedStitchFileToProject — flattens to Points + Segments. Element
//     steps become editable points with straight segments; satin sections
//     become a chain of three segments (detour straights sandwich the
//     spine-centered satin so the renderer can lay them out axis-aligned).
//   - parsedStitchFileToManualProject — flattens to ManualStitchInput
//     entries. Element steps become NeedleStitch / JumpStitch with their
//     raw deltas preserved; satin sections become ManualSatinSegment.
//
// The walker (`walkParsedBlocks`) iterates the parsed blocks in chain
// order, calling visitor hooks for the chain anchor, each element step,
// and each satin section. The two visitors share the iteration but emit
// different shapes.
//
// Both importers mark their output `imported: true` so the UI can warn
// users that round-tripping back to binary may diverge from the original
// bytes (the encoder re-plans rather than reproducing the original
// records).

import { rawXtoMm, rawYtoMm } from '../parser/units.js';
import type { ElementStep, ParsedDesign, SatinSection } from '../parser/types.js';
import type { FootId } from './foot.js';
import { newPointId, newSegmentId } from './ids.js';
import { DEFAULT_SATIN_DENSITY_MM, newProject } from './project.js';
import type {
  ManualSatinSegment,
  ManualStitchInput,
  Point,
  Project,
  Segment,
} from './types.js';

/**
 * Options for the binary-import helpers. Both importers accept the same
 * bag so callers don't have to spread-override the returned Project to
 * patch fields the import already knows about (name, suggestedFoot).
 * Omitted fields fall back to {@link newProject}'s defaults.
 */
export interface BinaryImportOptions {
  name: string;
  suggestedFoot?: FootId;
}

interface MmPoint {
  x: number;
  y: number;
}

const toMm = (raw: { x: number; y: number }): MmPoint => ({
  x: rawXtoMm(raw.x),
  y: rawYtoMm(raw.y),
});

// ---------------------------------------------------------------------------
// Shared walker
// ---------------------------------------------------------------------------

/**
 * Hooks for a single pass over a parsed design's blocks. Each hook is
 * optional; an importer implements the ones it cares about.
 */
interface BlockVisitor {
  /**
   * Called once at the start of the walk with the design's chain anchor
   * (= the first absolute point of the first element block, in mm). Used
   * by the segment importer to seed `points[0]`; the manual importer
   * ignores it.
   */
  onChainStart?(at: MmPoint): void;

  /**
   * Called once per step inside an element block. `landing` is the
   * absolute position (mm) AFTER the step has been applied — i.e. the
   * point at `absolutePoints[i + 1]` for step `i`. The entry point of
   * each element (`absolutePoints[0]`) is never reported: it duplicates
   * the previous block's exit, so segment-mode reuses its existing
   * `lastPointId` and manual-mode has nothing to emit at the entry.
   */
  onElementStep?(landing: MmPoint, step: ElementStep): void;

  /** Called once per satin block, in chain order. */
  onSatinSection?(satin: SatinSection): void;
}

function walkParsedBlocks(design: ParsedDesign, visitor: BlockVisitor): void {
  let chainStartReported = false;
  for (const block of design.blocks) {
    if (block.kind === 'element') {
      const abs = block.element.absolutePoints;
      const steps = block.element.steps;
      if (!chainStartReported && abs.length > 0) {
        visitor.onChainStart?.(toMm(abs[0]!));
        chainStartReported = true;
      }
      for (let i = 0; i < steps.length; i++) {
        const landing = toMm(abs[i + 1]!);
        visitor.onElementStep?.(landing, steps[i]!);
      }
    } else {
      visitor.onSatinSection?.(block.satin);
    }
  }
}

// ---------------------------------------------------------------------------
// Segment-mode importer
// ---------------------------------------------------------------------------

export function parsedStitchFileToProject(
  design: ParsedDesign,
  opts: BinaryImportOptions | string,
): Project {
  const { name, suggestedFoot } = normalizeImportOptions(opts);
  const proj = newProject(name, suggestedFoot ? { suggestedFoot } : {});
  const points: Point[] = [];
  const segments: Segment[] = [];
  let firstPoint: MmPoint | null = null;
  let lastPointId: string | null = null;

  walkParsedBlocks(design, {
    onChainStart(at) {
      firstPoint = at;
      const id = newPointId();
      points.push({ id, x: at.x, y: at.y });
      lastPointId = id;
    },
    onElementStep(landing) {
      const id = newPointId();
      points.push({ id, x: landing.x, y: landing.y });
      if (lastPointId != null) {
        segments.push({
          id: newSegmentId(),
          from: lastPointId,
          to: id,
          type: 'straight',
          imported: true,
        });
      }
      lastPointId = id;
    },
    onSatinSection(satin) {
      const newLastId = appendSatinChain(satin, lastPointId, points, segments);
      if (newLastId) lastPointId = newLastId;
    },
  });

  // Translate every point so the chain anchor lands at the project's (0, 0).
  shiftPointsToChainAnchor(points, firstPoint);

  return {
    ...proj,
    points,
    segments,
    startXMm: importedStartXMm(design, firstPoint),
  };
}

/**
 * Convert a binary satin section into the chain of segments the creator's
 * renderers can lay out correctly. The binary stores the satin's left/right
 * cone edges in raw units; the chain enters at left[0] (TL corner) and exits
 * at rightPoints[last] (BR). The creator's rendering treats a SatinSegment's
 * from/to as the spine endpoints, so we sandwich the satin between two tiny
 * detour straights that step from the chain's corner positions onto the
 * spine center and back.
 *
 * Returns the new chain end (the BR corner point's id), or null if the
 * satin is malformed.
 */
function appendSatinChain(
  satin: SatinSection,
  fromId: string | null,
  points: Point[],
  segments: Segment[],
): string | null {
  if (!fromId) return null;
  const c = extractSatinCorners(satin);
  if (!c) return null;
  const exitMm = toMm(c.brRaw);

  // 1) detour-in: TL → spineTop
  const spineTopId = newPointId();
  points.push({ id: spineTopId, x: c.top.x, y: c.top.y });
  segments.push({
    id: newSegmentId(),
    from: fromId,
    to: spineTopId,
    type: 'straight',
    imported: true,
  });

  // 2) satin: spineTop → spineBot
  const spineBotId = newPointId();
  points.push({ id: spineBotId, x: c.bot.x, y: c.bot.y });
  segments.push({
    id: newSegmentId(),
    from: spineTopId,
    to: spineBotId,
    type: 'satin',
    widthStart: c.widthStart,
    widthEnd: c.widthEnd,
    density: 0.6,
    imported: true,
  });

  // 3) detour-out: spineBot → BR
  const brId = newPointId();
  points.push({ id: brId, x: exitMm.x, y: exitMm.y });
  segments.push({
    id: newSegmentId(),
    from: spineBotId,
    to: brId,
    type: 'straight',
    imported: true,
  });

  return brId;
}

/**
 * Shared corner-extraction for a binary SatinSection. Returns the
 * spine-top / spine-bottom mm midpoints, the original raw BR corner
 * (for the manual-mode chain exit point), and the cone widths derived
 * from the top/bottom edge spans. Returns null when any of the four
 * outline corners is missing.
 */
function extractSatinCorners(satin: SatinSection): {
  top: MmPoint;
  bot: MmPoint;
  brRaw: { x: number; y: number };
  widthStart: number;
  widthEnd: number;
} | null {
  const left0 = satin.leftPoints[0];
  const right0 = satin.rightPoints[0];
  const leftN = satin.leftPoints[satin.leftPoints.length - 1];
  const rightN = satin.rightPoints[satin.rightPoints.length - 1];
  if (!left0 || !right0 || !leftN || !rightN) return null;
  return {
    top: midpointMm(left0, right0),
    bot: midpointMm(leftN, rightN),
    brRaw: rightN,
    widthStart: rawXtoMm(Math.abs(right0.x - left0.x)),
    widthEnd: rawXtoMm(Math.abs(rightN.x - leftN.x)),
  };
}

function midpointMm(a: { x: number; y: number }, b: { x: number; y: number }): MmPoint {
  return { x: rawXtoMm((a.x + b.x) / 2), y: rawYtoMm((a.y + b.y) / 2) };
}

// ---------------------------------------------------------------------------
// Manual-mode importer
// ---------------------------------------------------------------------------

/**
 * Manual-mode counterpart of {@link parsedStitchFileToProject}. The UI's
 * binary-import flow uses this one because the file already carries known
 * stitches — re-authoring them as editable segments invites accidental
 * geometry edits and hides the fact that these bytes came off a real
 * machine.
 *
 * Each element step becomes a NeedleStitch or JumpStitch (kind from
 * step.kind: 'short' → 'needle', 'jump' → 'jump'); each satin section
 * becomes a ManualSatinSegment whose spine endpoints sit at the midpoints
 * of the binary cone's first/last left+right pairs. The encoder's manual
 * walker ({@link emitManualMultiBlock}) re-derives element/satin block
 * boundaries from the order of these entries, so the chain shape matches
 * the binary's original block layout.
 *
 * Recentered so the chain anchor lands at (0, 0) — matches
 * parsedStitchFileToProject. Validation against the foot envelope is
 * intentionally bypassed: the bytes came off a real machine, they are
 * mechanically valid by construction.
 */
export function parsedStitchFileToManualProject(
  design: ParsedDesign,
  opts: BinaryImportOptions | string,
): Project {
  const { name, suggestedFoot } = normalizeImportOptions(opts);
  const proj = newProject(name, suggestedFoot ? { mode: 'manual', suggestedFoot } : { mode: 'manual' });
  const stitches: ManualStitchInput[] = [];
  let firstPoint: MmPoint | null = null;

  walkParsedBlocks(design, {
    onChainStart(at) {
      firstPoint = at;
    },
    onElementStep(landing, step) {
      if (step.kind === 'jump') {
        // The 7-byte long-jump record splits dx into dxLow (raw) +
        // dxHi (mm × 8). The firmware slides the carriage by dxHi mm
        // and additionally swings the needle by dxLow / 8 mm within
        // the slot — preserving dxHi here lets the preview's foot
        // tracker walk the carriage by the firmware-faithful amount
        // instead of by the full dx / 8 mm.
        stitches.push({
          kind: 'jump',
          x: landing.x,
          y: landing.y,
          dxRaw: step.dx,
          dyRaw: step.dy,
          dxHi: signedI8(step.flag),
        });
      } else {
        stitches.push({
          kind: 'needle',
          x: landing.x,
          y: landing.y,
          dxRaw: step.dx,
          dyRaw: step.dy,
        });
      }
    },
    onSatinSection(satin) {
      const seg = manualSatinFromSection(satin);
      if (seg) stitches.push(seg);
    },
  });

  centerManualStitchesAtChainAnchor(stitches, firstPoint);

  return {
    ...proj,
    manualStitches: stitches,
    startXMm: importedStartXMm(design, firstPoint),
  };
}

/**
 * Resolve the carriage-start X in the creator's chain-anchor-relative
 * coordinate system from the file's `xElem` field. The firmware places
 * the slot centre at `-xElemUm / 1000 mm` in MACHINE coords. The
 * creator recenters every coordinate by `-firstPoint.x`, so the
 * carriage's project-coord X is `-xElem − firstPoint.x` mm.
 *
 * Returns 0 when the file is not a singleton design (multi-element
 * designs encode their per-element xElem in geometry wrapper sub-blocks
 * we don't surface yet) or when no chain anchor exists.
 */
function importedStartXMm(design: ParsedDesign, firstPoint: MmPoint | null): number {
  const xElemUm = design.metadata.xElemUm;
  if (xElemUm == null) return 0;
  const xElemMm = xElemUm / 1000;
  const firstX = firstPoint?.x ?? 0;
  // `+0` collapses the JS -0 case (-xElemMm with xElemUm=0) so consumers
  // doing Object.is equality against 0 stay happy.
  return -xElemMm - firstX + 0;
}

function normalizeImportOptions(opts: BinaryImportOptions | string): BinaryImportOptions {
  return typeof opts === 'string' ? { name: opts } : opts;
}

/** Re-interpret an unsigned byte (0..255) as a signed int8 (-128..127). */
function signedI8(byte: number): number {
  return byte > 127 ? byte - 256 : byte;
}

/**
 * Translate `points` in place so the chain anchor (`origin`) lands at
 * (0, 0). `origin` is the absolute mm position of the first emitted
 * point; when null (empty import) the array is left untouched.
 */
function shiftPointsToChainAnchor(points: Point[], origin: MmPoint | null): void {
  if (!origin) return;
  const { x: dx, y: dy } = origin;
  if (dx === 0 && dy === 0) return;
  for (const p of points) {
    p.x -= dx;
    p.y -= dy;
  }
}

/**
 * Manual-mode counterpart of {@link shiftPointsToChainAnchor}. Shifts
 * every stitch's absolute position (and a satin's spine end) so the
 * first parsed point lands at (0, 0). In place because manual stitches
 * are still mutable construction-stage objects at this point — the
 * Project they end up on is the freshly-built return value.
 */
function centerManualStitchesAtChainAnchor(
  stitches: ManualStitchInput[],
  origin: MmPoint | null,
): void {
  if (!origin) return;
  const { x: dx, y: dy } = origin;
  if (dx === 0 && dy === 0) return;
  for (const s of stitches) {
    s.x -= dx;
    s.y -= dy;
    if (s.kind === 'satin') {
      s.toX -= dx;
      s.toY -= dy;
    }
  }
}

function manualSatinFromSection(satin: SatinSection): ManualSatinSegment | null {
  const c = extractSatinCorners(satin);
  if (!c) return null;
  return {
    kind: 'satin',
    x: c.top.x, y: c.top.y,
    toX: c.bot.x, toY: c.bot.y,
    widthStart: c.widthStart,
    widthEnd: c.widthEnd,
    density: DEFAULT_SATIN_DENSITY_MM,
  };
}
