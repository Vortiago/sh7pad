// Project factory + migration + the first-point-at-X=0 invariant.
//
// The Creator's coordinate system mirrors the .sh7 binary format:
//   X = 0 in the middle, negative goes left, positive goes right
//   Y = 0 at the top of the design, grows downward
// Every project MUST have its first point at X=0 (the stitch always starts
// on the center axis). lockFirstPoint() is the single source of truth for
// that invariant — call it from the store reducer, not scattered across
// add/drag/import code paths.

import type {
  BgImage,
  IdGenOptions,
  Point,
  Project,
  ProjectMode,
  SatinSegment,
  Segment,
} from './types.js';
import type { FootId } from './foot.js';
import { SH7_MAX_Y_MM, clampHoopH, clampStitchY } from './sh7Limits.js';
import { DEFAULT_FOOT_ID } from './foot.js';
import { newPointId, newSegmentId } from './ids.js';

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

const defaultIdGen = (): string => Math.random().toString(36).slice(2, 9);

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

export interface AddPointIds {
  pointId: string;
  segmentId: string;
}

/**
 * Pure reducer for "user clicked to add a point". Appends a point and (when a
 * chain end exists) a segment from the chain end to the new point. Used by
 * the editor click handler — extracted so it's unit-testable without DOM.
 */
export function addPointToProject(
  project: Project,
  click: { x: number; y: number },
  kind: 'straight' | 'satin',
  ids: AddPointIds,
  now: number = Date.now(),
): Project {
  const endId = chainEndPointId(project);
  const last = endId ? project.points.find((pt) => pt.id === endId) : undefined;

  if (!last) {
    return {
      ...project,
      points: [...project.points, { id: ids.pointId, x: click.x, y: clampStitchY(click.y, project.hoop.h) }],
      updatedAt: now,
    };
  }

  // Clamp Y into the file-format-supported design area. The visual hoop's
  // bottom edge is also the bottom edge of the export-valid region, so a
  // click below the hoop snaps to the hoop edge rather than failing later
  // at export time with a BE16 overflow.
  const clampedY = clampStitchY(click.y, project.hoop.h);

  if (kind === 'satin') {
    // Satin spine is vertical (top-to-bottom). Inherit the chain end's X for
    // both endpoints and let only Y advance — clamped so the spine has length.
    const targetY = clampStitchY(Math.max(last.y + 1, clampedY), project.hoop.h);
    const points = [...project.points, { id: ids.pointId, x: last.x, y: targetY }];
    const segments: Segment[] = [
      ...project.segments,
      {
        id: ids.segmentId,
        from: last.id, to: ids.pointId,
        type: 'satin',
        widthStart: DEFAULT_SATIN_WIDTH_MM,
        widthEnd: DEFAULT_SATIN_WIDTH_MM,
        density: DEFAULT_SATIN_DENSITY_MM,
      },
    ];
    return { ...project, points, segments, updatedAt: now };
  }

  const points = [...project.points, { id: ids.pointId, x: click.x, y: clampedY }];
  const segments: Segment[] = [
    ...project.segments,
    { id: ids.segmentId, from: last.id, to: ids.pointId, type: 'straight' },
  ];
  return { ...project, points, segments, updatedAt: now };
}

/**
 * Remove a segment from the chain. The segment's `to` point is pruned from
 * `points[]` if no other segment references it (the X=0 anchor is preserved
 * unconditionally, even when it appears as the removed segment's `to`).
 */
export function removeSegment(
  project: Project,
  segmentId: string,
  now: number = Date.now(),
): Project {
  const segIdx = project.segments.findIndex((s) => s.id === segmentId);
  if (segIdx === -1) return project;
  const removed = project.segments[segIdx]!;

  const segments = project.segments.slice();
  segments.splice(segIdx, 1);

  // Re-link the chain: if the next segment was anchored to the removed
  // segment's `to`, rewire it to the removed segment's `from` so the path
  // stays continuous (A→B→C with B deleted becomes A→C).
  const nextSeg = segments[segIdx];
  if (nextSeg && nextSeg.from === removed.to) {
    segments[segIdx] = { ...nextSeg, from: removed.from };
  }

  const anchorId = project.points[0]?.id;
  const stillReferenced = segments.some(
    (s) => s.from === removed.to || s.to === removed.to,
  );
  const points =
    stillReferenced || removed.to === anchorId
      ? project.points
      : project.points.filter((pt) => pt.id !== removed.to);

  return { ...project, points, segments, updatedAt: now };
}

/**
 * Remove a point from the chain by deleting the segment that ends at it.
 * Delegates to removeSegment so middle-point deletions merge their two
 * adjacent segments and tail-point deletions just drop the trailing segment
 * — same splice + re-link + prune behaviour, expressed at the point level
 * to match the user's mental model of "delete this stitch".
 *
 * No-ops on the X=0 anchor (points[0]) and on points with no incoming
 * segment (orphans, unknown ids) — those should not be reachable through
 * the normal click-a-point gesture, but the reducer stays defensive.
 */
export function removePoint(
  project: Project,
  pointId: string,
  now: number = Date.now(),
): Project {
  if (project.points[0]?.id === pointId) return project;
  const incoming = project.segments.find((s) => s.to === pointId);
  if (!incoming) return project;
  return removeSegment(project, incoming.id, now);
}

export function lockFirstPoint(project: Project): Project {
  const first = project.points[0];
  if (!first || first.x === 0) return project;
  const points = project.points.slice();
  points[0] = { ...first, x: 0 };
  return { ...project, points };
}

/**
 * True when the project's start position is no longer freely moveable.
 *
 * Per-mode rule:
 *   - Design mode → never locked. The encoder re-plans from scratch on
 *     every render, so the start is a design-level knob the user can
 *     retune at any time without disturbing the authored geometry.
 *   - Manual mode → locked once at least one manual stitch exists.
 *     Each manual stitch was placed against the carriage state at the
 *     moment of placement; moving the start retroactively would shift
 *     every subsequent slot decision, invalidating the design.
 *
 * Note: the chain anchor (`points[0]`) is part of every project from
 * creation and is NOT counted as user geometry — it isn't a stitch.
 */
export function isStartLocked(project: Project): boolean {
  return project.mode === 'manual' && project.manualStitches.length > 0;
}

/**
 * Enforce the start-position rule from {@link isStartLocked} during a
 * store transition. When the project is locked and the next state is a
 * same-project mutation, revert `startXMm` to the previous value so
 * any setState that tries to move the start is silently ignored (the
 * UI drag handler relies on this — see editor/interactCallbacks.ts).
 * New project swaps (`prev.id !== next.id`) and the freely-placeable
 * states (design mode, empty manual) pass through unchanged.
 */
export function lockStartXMm(prev: Project | null, project: Project): Project {
  if (!isStartLocked(project)) return project;
  if (!prev || prev.id !== project.id) return project;
  const prevStart = prev.startXMm ?? 0;
  const nextStart = project.startXMm ?? 0;
  if (nextStart === prevStart) return project;
  return { ...project, startXMm: prevStart };
}

/**
 * Enforce the cross-cutting invariants every store update has to honour:
 *
 *   • `mode` and `suggestedFoot` are creation-only. Any next state that
 *     differs on those fields is rejected — we keep the prior values.
 *   • In design mode, manualStitches must be empty.
 *   • In manual mode, segments must be empty (the chain anchor in points
 *     is allowed; user-authored points are not).
 *
 * Returns a Project with the violating fields reverted to the prior
 * state's values where applicable. Pure function — store calls this
 * after lockFirstPoint and writes the result.
 */
export function lockProjectInvariants(prev: Project | null, next: Project): Project {
  let p = next;
  // Only enforce mode/foot immutability for in-place updates of the same
  // project. setState(otherProject) — used when the user switches the
  // active project in the sidebar — must not be reverted; that's a swap,
  // not a mutation.
  if (prev && prev.id === next.id) {
    if (p.mode !== prev.mode) {
      p = { ...p, mode: prev.mode };
    }
    if (p.suggestedFoot !== prev.suggestedFoot) {
      p = { ...p, suggestedFoot: prev.suggestedFoot };
    }
  }
  if (p.mode === 'design' && p.manualStitches.length > 0) {
    p = { ...p, manualStitches: [] };
  }
  if (p.mode === 'manual' && p.segments.length > 0) {
    p = { ...p, segments: [] };
  }
  p = lockStartXMm(prev, p);
  return p;
}

/**
 * Migrate a project loaded from disk/localStorage into the current shape.
 * Handles:
 *   - v1 hoop ({w, h}) → v2 hoop ({halfW, h}) + re-centering existing points
 *   - missing widthStart/widthEnd on satin segments
 *   - drop the legacy xLimit field (now derived from foot)
 *   - first-point-at-X=0 invariant
 * Idempotent: passing an already-migrated project returns an equivalent shape.
 */
export function migrateProject(project: Project): Project {
  let p = project;

  // Older projects stored an explicit xLimit. The current model derives
  // the X reach from the foot, so the field has nothing to do — drop it
  // if present so type-narrow consumers don't see a stale value.
  if ('xLimit' in p) {
    const { xLimit: _, ...rest } = p as Project & { xLimit?: unknown };
    p = rest as Project;
  }

  // Fill missing or unrecognized suggestedFoot; clamp tension.
  const rawFoot = p.suggestedFoot as unknown as string | undefined;
  if (rawFoot !== 'B' && rawFoot !== 'S' && rawFoot !== 'hidden') {
    p = { ...p, suggestedFoot: DEFAULT_FOOT_ID };
  }

  // Default new fields for projects predating manual mode. Older projects
  // are always design-mode with no manual stitches.
  if (p.mode !== 'manual' && p.mode !== 'design') {
    p = { ...p, mode: 'design' };
  }
  if (!Array.isArray(p.manualStitches)) {
    p = { ...p, manualStitches: [] };
  }
  if (typeof p.startXMm !== 'number' || Number.isNaN(p.startXMm)) {
    p = { ...p, startXMm: 0 };
  }
  if (typeof p.threadTension !== 'number' || Number.isNaN(p.threadTension)) {
    p = { ...p, threadTension: DEFAULT_THREAD_TENSION };
  } else if (p.threadTension < TENSION_MIN || p.threadTension > TENSION_MAX) {
    p = { ...p, threadTension: Math.min(TENSION_MAX, Math.max(TENSION_MIN, p.threadTension)) };
  }

  // Convert v1 hoop {w} into centered {halfW}.
  const hoop = p.hoop as unknown as { w?: number; halfW?: number; h?: number };
  if (typeof hoop.halfW !== 'number') {
    const oldW = typeof hoop.w === 'number' ? hoop.w : HOOP_HALF_W * 2;
    const halfW = oldW / 2;
    const h = typeof hoop.h === 'number' ? hoop.h : HOOP_H;
    const recentered: Point[] = (p.points ?? []).map((pt) => ({
      ...pt,
      x: (pt.x ?? 0) - halfW,
      y: pt.y ?? 0,
    }));
    p = { ...p, hoop: { halfW, h }, points: recentered };
  }

  // Clamp hoop.h to the .sh7 file-format limit (43.69 mm); points beyond
  // the new hoop edge get pulled in so existing projects don't ship with
  // out-of-bounds geometry that would fail to export.
  const clampedH = clampHoopH(p.hoop.h);
  if (clampedH !== p.hoop.h) {
    p = {
      ...p,
      hoop: { ...p.hoop, h: clampedH },
      points: p.points.map((pt) => ({ ...pt, y: clampStitchY(pt.y, clampedH) })),
    };
  }

  // Migrate segments: ensure satin has widthStart/widthEnd/density.
  const segments: Segment[] = (p.segments ?? []).map((s) => migrateSegment(s));
  p = { ...p, segments };

  // Convert old-format imported satins (from at TL, to at BR — pre-detour-chain
  // import) into the new detour-chain layout so they render axis-aligned.
  p = migrateOldFormatSatins(p);

  // Always finish with the first-point-at-X=0 lock.
  p = lockFirstPoint(p);
  return p;
}

/**
 * Pre-fix sh7BinaryImport stored each binary satin as a SatinSegment whose
 * `from` pointed at the cone's TL corner and `to` at the BR corner. The
 * creator's renderers treat from/to as spine endpoints and applied perp
 * offsets off the TL→BR diagonal, tilting every imported cone. The new
 * importer instead places from/to on the spine center and sandwiches each
 * satin between two imported detour straights (TL → spineTop, spineBot → BR).
 *
 * This migration detects the old format on a per-satin basis and rewrites
 * each one into the new layout. Detection: an imported satin whose from/to
 * x-coordinates differ by ~half their combined width (the signature of a
 * TL→BR diagonal). User-created (non-imported) satins are never touched —
 * those use the spine convention by design.
 */
function migrateOldFormatSatins(p: Project): Project {
  const points: Point[] = p.points.slice();
  const segments: Segment[] = [];
  for (const seg of p.segments) {
    if (!isOldFormatSatin(seg, points)) {
      segments.push(seg);
      continue;
    }
    const tl = points.find((pt) => pt.id === seg.from);
    const br = points.find((pt) => pt.id === seg.to);
    if (!tl || !br) {
      segments.push(seg);
      continue;
    }
    // For an axis-aligned cone, TL = (spineTop.x - widthStart/2, spineTop.y)
    // and BR = (spineBot.x + widthEnd/2, spineBot.y). Solve for spine.
    const spineTopX = tl.x + seg.widthStart / 2;
    const spineBotX = br.x - seg.widthEnd / 2;
    const spineTopId = newPointId();
    const spineBotId = newPointId();
    points.push({ id: spineTopId, x: spineTopX, y: tl.y });
    points.push({ id: spineBotId, x: spineBotX, y: br.y });
    segments.push(
      { id: newSegmentId(), from: tl.id, to: spineTopId, type: 'straight', imported: true },
      {
        id: seg.id,
        from: spineTopId,
        to: spineBotId,
        type: 'satin',
        widthStart: seg.widthStart,
        widthEnd: seg.widthEnd,
        density: seg.density,
        imported: true,
      },
      { id: newSegmentId(), from: spineBotId, to: br.id, type: 'straight', imported: true },
    );
  }
  return { ...p, points, segments };
}

function isOldFormatSatin(
  seg: Segment,
  points: readonly Point[],
): seg is SatinSegment {
  if (seg.type !== 'satin' || !seg.imported) return false;
  const a = points.find((p) => p.id === seg.from);
  const b = points.find((p) => p.id === seg.to);
  if (!a || !b) return false;
  // Old format: |from.x - to.x| ≈ (widthStart + widthEnd)/2 (TL→BR diagonal).
  // New format: |from.x - to.x| is essentially 0 (spine center to spine center).
  // Threshold at 30% of the combined half-widths is a safe split.
  const expectedDiagonalDx = (seg.widthStart + seg.widthEnd) / 2;
  const dx = Math.abs(a.x - b.x);
  return dx > expectedDiagonalDx * 0.3;
}

function migrateSegment(seg: Segment): Segment {
  if (seg.type !== 'satin') return seg;
  const sat = seg as SatinSegment & { width?: number };
  if (
    typeof sat.widthStart === 'number' &&
    typeof sat.widthEnd === 'number' &&
    typeof sat.density === 'number'
  ) {
    return sat;
  }
  const fallback = typeof sat.width === 'number' ? sat.width : 2.4;
  return {
    id: sat.id,
    from: sat.from,
    to: sat.to,
    type: 'satin',
    widthStart: typeof sat.widthStart === 'number' ? sat.widthStart : fallback,
    widthEnd: typeof sat.widthEnd === 'number' ? sat.widthEnd : fallback,
    density: typeof sat.density === 'number' ? sat.density : 0.6,
    ...(sat.imported ? { imported: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// Segment / point editor reducers
// ---------------------------------------------------------------------------

export interface SubdivideSegmentIds {
  pointId: string;
  segmentAId: string;
  segmentBId: string;
}

/**
 * Split the segment with id `segId` at its midpoint. Appends a new midpoint
 * to `points` and replaces the original segment with two halves at the same
 * index. Satin segments preserve density and average their start/end widths
 * so the new midpoint carries `(widthStart + widthEnd) / 2`. No-op when the
 * segment id, its `from`, or its `to` cannot be resolved (returns the same
 * project reference).
 */
export function subdivideSegment(
  project: Project,
  segId: string,
  ids: SubdivideSegmentIds,
  now: number = Date.now(),
): Project {
  const segIdx = project.segments.findIndex((s) => s.id === segId);
  const seg = project.segments[segIdx];
  if (!seg) return project;
  const fromPt = project.points.find((pt) => pt.id === seg.from);
  const toPt = project.points.find((pt) => pt.id === seg.to);
  if (!fromPt || !toPt) return project;

  const midX = (fromPt.x + toPt.x) / 2;
  const midY = (fromPt.y + toPt.y) / 2;
  const points = [...project.points, { id: ids.pointId, x: midX, y: midY }];

  let segA: Segment;
  let segB: Segment;
  if (seg.type === 'satin') {
    const midW = (seg.widthStart + seg.widthEnd) / 2;
    segA = {
      id: ids.segmentAId, from: seg.from, to: ids.pointId,
      type: 'satin', widthStart: seg.widthStart, widthEnd: midW, density: seg.density,
    };
    segB = {
      id: ids.segmentBId, from: ids.pointId, to: seg.to,
      type: 'satin', widthStart: midW, widthEnd: seg.widthEnd, density: seg.density,
    };
  } else {
    segA = { id: ids.segmentAId, from: seg.from, to: ids.pointId, type: 'straight' };
    segB = { id: ids.segmentBId, from: ids.pointId, to: seg.to, type: 'straight' };
  }
  const segments = [...project.segments];
  segments.splice(segIdx, 1, segA, segB);
  return { ...project, points, segments, updatedAt: now };
}

/**
 * Move a point and (if it's a satin endpoint) slide the OTHER endpoint of any
 * satin segment that contains it so the spine stays vertical. Y is clamped
 * into the hoop. No-op when no point matches `id`.
 *
 * The spine-stays-vertical rule is a Project invariant: every satin segment
 * has from.x === to.x (the editor authors them that way; the encoder relies
 * on it). Dragging one endpoint without the other would silently break that
 * invariant, so the reducer drags both.
 */
export function movePointPreservingSatinSpines(
  project: Project,
  id: string,
  point: { x: number; y: number },
  now: number = Date.now(),
): Project {
  const tiedIds = new Set<string>();
  for (const s of project.segments) {
    if (s.type !== 'satin') continue;
    if (s.from === id) tiedIds.add(s.to);
    else if (s.to === id) tiedIds.add(s.from);
  }
  const clampedY = clampStitchY(point.y, project.hoop.h);
  return {
    ...project,
    points: project.points.map((pt) => {
      if (pt.id === id) return { ...pt, x: point.x, y: clampedY };
      if (tiedIds.has(pt.id)) return { ...pt, x: point.x };
      return pt;
    }),
    updatedAt: now,
  };
}

/**
 * Apply a partial segment update. Handles type swaps (straight↔satin) by
 * filling missing widthStart/widthEnd/density with their defaults; preserves
 * the `imported` flag on type swap so an imported segment stays flagged.
 */
export function mergeSegmentPatch(seg: Segment, patch: Partial<Segment>): Segment {
  const next = { ...seg, ...patch } as Segment;
  if (patch.type && patch.type !== seg.type) {
    if (patch.type === 'satin') {
      const sat = patch as Partial<Segment & { widthStart: number; widthEnd: number; density: number }>;
      return {
        id: seg.id,
        from: seg.from,
        to: seg.to,
        type: 'satin',
        widthStart: sat.widthStart ?? DEFAULT_SATIN_WIDTH_MM,
        widthEnd: sat.widthEnd ?? DEFAULT_SATIN_WIDTH_MM,
        density: sat.density ?? DEFAULT_SATIN_DENSITY_MM,
        ...(seg.imported ? { imported: true } : {}),
      };
    }
    return {
      id: seg.id,
      from: seg.from,
      to: seg.to,
      type: 'straight',
      ...(seg.imported ? { imported: true } : {}),
    };
  }
  return next;
}

/**
 * Apply `patch` to the segment with id `segId`. Uses {@link mergeSegmentPatch}
 * for the per-segment merge; no-op when the id is unknown.
 */
export function updateSegment(
  project: Project,
  segId: string,
  patch: Partial<Segment>,
  now: number = Date.now(),
): Project {
  if (!project.segments.some((s) => s.id === segId)) return project;
  return {
    ...project,
    segments: project.segments.map((s) => s.id === segId ? mergeSegmentPatch(s, patch) : s),
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Project-metadata reducers
// ---------------------------------------------------------------------------

/** Rename the project. */
export function setProjectName(project: Project, name: string, now: number = Date.now()): Project {
  return { ...project, name, updatedAt: now };
}

/** Set thread tension, clamped to [TENSION_MIN, TENSION_MAX]. */
export function setThreadTension(project: Project, value: number, now: number = Date.now()): Project {
  const clamped = Math.min(TENSION_MAX, Math.max(TENSION_MIN, value));
  return { ...project, threadTension: clamped, updatedAt: now };
}

// ---------------------------------------------------------------------------
// Background-image reducers
// ---------------------------------------------------------------------------

/** Replace the background image (or set one for the first time). */
export function setBgImage(project: Project, bg: BgImage, now: number = Date.now()): Project {
  return { ...project, bg, updatedAt: now };
}

/** Apply a partial update to the existing background image. No-op when no bg is set. */
export function updateBgImage(
  project: Project,
  patch: Partial<BgImage>,
  now: number = Date.now(),
): Project {
  if (!project.bg) return project;
  return { ...project, bg: { ...project.bg, ...patch }, updatedAt: now };
}

/** Remove the background image. */
export function clearBgImage(project: Project, now: number = Date.now()): Project {
  return { ...project, bg: null, updatedAt: now };
}

/**
 * Translate the background image by (dxMm, dyMm). No-op when no bg is set.
 * Editor uses this for the bg-drag gesture.
 */
export function moveBgImage(
  project: Project,
  dxMm: number,
  dyMm: number,
  now: number = Date.now(),
): Project {
  if (!project.bg) return project;
  return {
    ...project,
    bg: { ...project.bg, x: project.bg.x + dxMm, y: project.bg.y + dyMm },
    updatedAt: now,
  };
}

/**
 * Seed project — wavy straights with two vertical satin runs at varied X.
 * Satin segments must run top-to-bottom (vertical spine) but their X
 * position is wherever the previous chain left off — the user does not
 * have to detour through the centerline first.
 */
export function SAMPLE(opts: IdGenOptions = {}): Project {
  const idGen = opts.idGen ?? defaultIdGen;
  const proj = newProject('Wave sample', { idGen });
  // Layout fits inside the SH7_MAX_Y_MM (43.69 mm) hoop — every Y stays
  // within the file-format-supported range so the seed exports cleanly.
  const layout: Array<{ x: number; y: number; type: 'straight' | 'satin' | 'start' }> = [
    { x: 0,   y: 2,    type: 'start' },
    { x: -15, y: 6,    type: 'straight' },
    { x: 12,  y: 10,   type: 'straight' },
    { x: 12,  y: 18,   type: 'satin' },    // vertical satin run at X=12
    { x: -18, y: 22,   type: 'straight' },
    { x: 0,   y: 26,   type: 'straight' },
    { x: 0,   y: 34,   type: 'satin' },    // vertical satin run at X=0
    { x: 15,  y: 38,   type: 'straight' },
    { x: -10, y: 42,   type: 'straight' },
  ];
  const points: Point[] = [{ id: proj.points[0]!.id, x: layout[0]!.x, y: layout[0]!.y }];
  for (let i = 1; i < layout.length; i++) {
    points.push({ id: `pt_${idGen()}`, x: layout[i]!.x, y: layout[i]!.y });
  }
  const segments: Segment[] = [];
  for (let i = 1; i < layout.length; i++) {
    const step = layout[i]!;
    if (step.type === 'satin') {
      segments.push({
        id: `s_${idGen()}`,
        from: points[i - 1]!.id,
        to: points[i]!.id,
        type: 'satin',
        widthStart: 2.4,
        widthEnd: 4.5,
        density: 0.6,
      });
    } else {
      segments.push({
        id: `s_${idGen()}`,
        from: points[i - 1]!.id,
        to: points[i]!.id,
        type: 'straight',
      });
    }
  }
  return { ...proj, points, segments };
}
