// Project factory + first-cluster accessors. The Creator's coordinate
// system mirrors the .sh7 binary format:
//   X = 0 in the middle, negative goes left, positive goes right
//   Y = 0 at the top of the design, grows downward
// Every project MUST have its first point at X=0 (the stitch always
// starts on the center axis) — see projectInvariants.lockFirstPoint.

import type {
  IdGenOptions,
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

export const defaultIdGen = (): string => Math.random().toString(36).slice(2, 9);

export interface NewProjectOptions extends IdGenOptions {
  /** Authoring mode. Locked for the lifetime of the project. Default: 'design'. */
  mode?: ProjectMode;
  /** Foot the machine should suggest. Locked for the lifetime of the project. */
  suggestedFoot?: FootId;
}

export function newProject(name = 'Untitled', opts: NewProjectOptions = {}): Project {
  const idGen = opts.idGen ?? defaultIdGen;
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
    bg: null,
  };
}

/**
 * Resolved carriage-start X for a project. Falls back to 0 when the
 * field is missing (projects predating startXMm). Centralised so every
 * pipeline / preview / encoder consumer reads the same default rule.
 */
export function startXMmOf(project: Project): number {
  return project.startXMm ?? 0;
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
