// Pure reducers that mutate the points/segments graph. Every editor
// gesture that adds, removes, splits, drags, or retypes a segment lands
// in one of these functions. The store calls them between
// projectInvariants.lockFirstPoint and lockProjectInvariants on each
// transition.

import type { Project, Segment } from './types.js';
import { clampStitchY } from './sh7Limits.js';
import {
  DEFAULT_SATIN_DENSITY_MM,
  DEFAULT_SATIN_WIDTH_MM,
  chainEndPointId,
} from './projectFactory.js';

export interface AddPointIds {
  pointId: string;
  segmentId: string;
}

export interface SubdivideSegmentIds {
  pointId: string;
  segmentAId: string;
  segmentBId: string;
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
