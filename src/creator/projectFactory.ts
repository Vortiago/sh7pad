// Project factory + first-cluster accessors. The Creator's coordinate
// system mirrors the .sh7 binary format:
//   X = 0 in the middle, negative goes left, positive goes right
//   Y = 0 at the top of the design, grows downward
// Every project MUST have its first point at X=0 (the stitch always
// starts on the center axis) — see projectInvariants.lockFirstPoint.

import type {
  IdGenOptions,
  Point,
  Project,
  ProjectMode,
} from './types.js';
import type { FootId } from './foot.js';
import { SH7_MAX_Y_MM } from './sh7Limits.js';
import { DEFAULT_FOOT_ID } from './foot.js';

export const HOOP_HALF_W = 60;          // ±60 mm wide design area (120 mm total)
export const HOOP_H = SH7_MAX_Y_MM;     // 0..43.69 mm — capped by the .sh7 file format

export const DEFAULT_SATIN_WIDTH_MM = 2.4;
export const DEFAULT_SATIN_DENSITY_MM = 0.6;

// Machine-wide thread tension defaults. Not foot-specific (every foot uses
// the same tension scale on the test machine), so they live with the
// rest of the "fresh-project defaults" family instead of on the Foot module.
export const DEFAULT_THREAD_TENSION = 4.0;
export const TENSION_MIN = 2.0;
export const TENSION_MAX = 7.0;
export const TENSION_STEP = 0.1;

export interface NewProjectOptions extends IdGenOptions {
  /** Authoring mode. Locked for the lifetime of the project. Default: 'design'. */
  mode?: ProjectMode;
  /** Foot the machine should suggest. Locked for the lifetime of the project. */
  suggestedFoot?: FootId;
}

export function newProject(name = 'Untitled', opts: NewProjectOptions = {}): Project {
  const idGen = opts.idGen ?? (() => Math.random().toString(36).slice(2, 9));
  const now = Date.now();
  return {
    id: `p_${idGen()}`,
    name,
    createdAt: now,
    updatedAt: now,
    hoop: { halfW: HOOP_HALF_W, h: HOOP_H },
    suggestedFoot: opts.suggestedFoot ?? DEFAULT_FOOT_ID,
    threadTension: DEFAULT_THREAD_TENSION,
    mode: opts.mode ?? 'design',
    points: [{ id: `pt_${idGen()}`, x: 0, y: 0 }],
    segments: [],
    manualStitches: [],
    startXMm: 0,
    startStitch: { x: 0 },
    bg: null,
  };
}

/**
 * Resolved **Carriage Start** X for a project. Falls back to 0 when the
 * field is missing (projects predating startXMm). Centralised so every
 * pipeline / preview / encoder consumer reads the same default rule.
 */
export function startXMmOf(project: Project): number {
  return project.startXMm ?? 0;
}

/**
 * Resolved **Start Stitch** position for a project. Y is always 0. X
 * defaults to the synthetic-mirror `points[0].x` (or 0) for projects
 * predating the dedicated field. Centralised so every consumer reads
 * the same default rule.
 */
export function startStitchOf(project: Project): { x: number; y: 0 } {
  const x = project.startStitch?.x ?? project.points[0]?.x ?? 0;
  return { x, y: 0 };
}

/**
 * The **Carriage Start** state a renderer / encoder / planner needs to
 * read about a project: the carriage's resting X position, the **Start
 * Stitch** position (always `y: 0`), and whether both are frozen by the
 * Start Lock. The three values move together (drag-coupling is enforced
 * by [[clampStartStateToEye]] / [[lockStartXMm]] on every store
 * transition), so this is the single read seam consumers should use.
 *
 * Internally composes [[startXMmOf]], [[startStitchOf]], and
 * [[isStartLocked]] — those wrappers remain for back-compat but new
 * callers should ask for the bundled state.
 */
export interface CarriageStart {
  /** **Carriage Start** X in mm (per CONTEXT.md, the carriage's resting position). */
  carriageX: number;
  /** **Start Stitch** position. Y is always 0. */
  startStitch: { x: number; y: 0 };
  /**
   * True when the Start Lock is in effect. Imported from
   * [[isStartLocked]] to avoid a second require of `projectInvariants`.
   */
  locked: boolean;
}

export function carriageStateOf(project: Project): CarriageStart {
  return {
    carriageX: startXMmOf(project),
    startStitch: startStitchOf(project),
    locked: project.mode === 'manual' && project.manualStitches.length > 0,
  };
}

/**
 * Build an `id → Point` lookup map from the project's points. Centralised so
 * the encoders, the editor renderer, and the stitch-list panel all read
 * the same map and the Map construction lives in one place.
 */
export function pointById(points: readonly Point[]): ReadonlyMap<string, Point> {
  const map = new Map<string, Point>();
  for (const p of points) map.set(p.id, p);
  return map;
}

/**
 * Where does the next click attach? The chain end is the to-endpoint of the
 * last segment — NOT the last entry in `points`. Subdividing a segment appends
 * a midpoint to `points`, so "last point in array" is unsafe; the segment list
 * is the authoritative ordering.
 */
export function chainEndPointId(project: Project): string | null {
  const lastSeg = project.segments[project.segments.length - 1];
  if (lastSeg) return lastSeg.to;
  return project.points[project.points.length - 1]?.id ?? null;
}

/**
 * True if the project authors at least one satin chunk. Design mode
 * looks at segments; manual mode looks at the stored manual stitches.
 * The pipeline dispatches on this to choose between the planFoot
 * encoder (satin-free designs) and the chain-tracking multi-block
 * walker (anything with a satin) — see encodeDesign.ts and
 * sh7BinaryExport.ts.
 */
export function hasSatin(project: Project): boolean {
  return project.mode === 'manual'
    ? project.manualStitches.some((m) => m.kind === 'satin')
    : project.segments.some((s) => s.type === 'satin');
}
