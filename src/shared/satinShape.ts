// Satin cone geometry — single source of truth shared by:
//   • The binary parser (src/parser/parseSatin.ts) for SatinSection.simulatedStitches.
//   • The creator's drop generator (src/creator/stitchPath.ts).
//   • The creator's editor renderer (src/ui/creator/editor/render.ts).
//
// Coordinate space is whatever the caller passes in (mm for the creator,
// raw stitch units for the parser). The module is unit-agnostic.
//
// .sh7 satin convention: a satin cone's chain entry is at the top-LEFT corner
// of its leftPoints curve, and the chain exit is at the bottom-RIGHT corner
// of its rightPoints curve. The simulated zigzag stitches reflect this:
// the FIRST stitch starts at TL, sides alternate, and the LAST stitch ends
// at BR. We force an odd step count to guarantee the BR landing.

export interface Point2D {
  x: number;
  y: number;
}

export interface ConeEdges {
  /** Top→bottom along the cone's left edge. ≥ 2 points. */
  leftPoints: readonly Point2D[];
  /** Top→bottom along the cone's right edge. ≥ 2 points. */
  rightPoints: readonly Point2D[];
}

export interface SatinSpec {
  /** Spine top — midpoint of the cone's top edge. */
  from: Point2D;
  /** Spine bottom — midpoint of the cone's bottom edge. */
  to: Point2D;
  /** Cone width at the spine top, perpendicular to the spine direction. */
  widthStart: number;
  /** Cone width at the spine bottom. */
  widthEnd: number;
}

export interface ConeCorners {
  tl: Point2D;
  tr: Point2D;
  bl: Point2D;
  br: Point2D;
}

export interface SimulatedStitch {
  start: Point2D;
  end: Point2D;
}

/**
 * Spine spec → flat 2-point cone edges. The "left" edge is on the +perp side
 * of the spine, where perp = (-dy, dx)/len. For a downward-vertical spine
 * (+Y), perp = (-1, 0), so leftPoints land at negative X (visual left). For
 * an axis-aligned binary cone this matches "TL = chain entry corner".
 */
export function spineToEdges(spec: SatinSpec): ConeEdges {
  const dx = spec.to.x - spec.from.x;
  const dy = spec.to.y - spec.from.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const halfStart = spec.widthStart / 2;
  const halfEnd = spec.widthEnd / 2;
  return {
    leftPoints: [
      { x: spec.from.x + nx * halfStart, y: spec.from.y + ny * halfStart },
      { x: spec.to.x + nx * halfEnd, y: spec.to.y + ny * halfEnd },
    ],
    rightPoints: [
      { x: spec.from.x - nx * halfStart, y: spec.from.y - ny * halfStart },
      { x: spec.to.x - nx * halfEnd, y: spec.to.y - ny * halfEnd },
    ],
  };
}

export type SatinEndAt = 'left' | 'center' | 'right';

/**
 * Where the chain should leave a satin cone. The satin geometry itself
 * always lands at BR (firmware-driven, see header); a non-'right' value
 * means the encoder appends a trailing needle drop to nudge the chain
 * to the requested corner before the next element starts.
 *
 * Returns null when no trailer is needed (endAt is 'right' or undefined),
 * the BL corner for 'left', and the spine endpoint (midpoint of BL/BR)
 * for 'center'.
 */
export function satinTrailerEnd(edges: ConeEdges, endAt: SatinEndAt | undefined): Point2D | null {
  if (endAt === undefined || endAt === 'right') return null;
  const corners = coneCorners(edges);
  if (endAt === 'left') return corners.bl;
  return { x: (corners.bl.x + corners.br.x) / 2, y: (corners.bl.y + corners.br.y) / 2 };
}

/** The four corner endpoints of a cone (chain entry TL, top-right, bottom-left, chain exit BR). */
export function coneCorners(edges: ConeEdges): ConeCorners {
  const { leftPoints, rightPoints } = edges;
  return {
    tl: leftPoints[0]!,
    tr: rightPoints[0]!,
    bl: leftPoints[leftPoints.length - 1]!,
    br: rightPoints[rightPoints.length - 1]!,
  };
}

/**
 * Build the zigzag fill for a satin cone.
 *
 * Stitches advance along Y from the top of the cone to the bottom, alternating
 * between left and right edges (left→right on odd i, right→left on even i).
 * The step count is forced odd so the last stitch lands at BR — this is the
 * exit corner the chain leaves the satin from.
 *
 * For a uniform vertical cone of length 10 mm at density 1 mm, you get 11
 * stitches: TL→R, R→L, L→R, …, last L→BR.
 */
export function satinStitches(edges: ConeEdges, density: number): SimulatedStitch[] {
  const { leftPoints, rightPoints } = edges;
  if (leftPoints.length < 2 || rightPoints.length < 2) return [];
  const yStart = leftPoints[0]!.y;
  const yEnd = leftPoints[leftPoints.length - 1]!.y;
  const ySpan = Math.abs(yEnd - yStart);
  let steps = Math.max(1, Math.round(ySpan / density));
  if (steps % 2 === 0) steps += 1;

  const stitches: SimulatedStitch[] = [];
  for (let i = 1; i <= steps; i++) {
    const y = yStart + ((yEnd - yStart) * i) / steps;
    const goRight = i % 2 === 1;
    const target = goRight ? interpolateAtY(rightPoints, y) : interpolateAtY(leftPoints, y);
    const prev = stitches.length > 0
      ? stitches[stitches.length - 1]!.end
      : interpolateAtY(leftPoints, yStart);
    stitches.push({ start: prev, end: target });
  }
  return stitches;
}

/**
 * Spine X at a given Y on a cone (= midpoint of the cone's left- and right-edge
 * X at that Y). Used by trackFoot to plant the virtual carriage on the cone's
 * spine for satin-internal needle drops, so the preview foot tracks the spine
 * even though the satin emits no jumps. The cone's spine is the
 * machine's actual carriage path through a satin.
 */
export function spineXAtY(edges: ConeEdges, y: number): number {
  const lx = interpolateAtY(edges.leftPoints, y).x;
  const rx = interpolateAtY(edges.rightPoints, y).x;
  return (lx + rx) / 2;
}

function interpolateAtY(points: readonly Point2D[], y: number): Point2D {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const yLo = Math.min(a.y, b.y);
    const yHi = Math.max(a.y, b.y);
    if (y >= yLo && y <= yHi) {
      const t = b.y - a.y === 0 ? 0 : (y - a.y) / (b.y - a.y);
      return { x: a.x + (b.x - a.x) * t, y };
    }
  }
  return y <= points[0]!.y ? points[0]! : points[points.length - 1]!;
}
