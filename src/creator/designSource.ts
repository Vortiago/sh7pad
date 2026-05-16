// DesignSource — the dispatch layer between an authoring-mode Project
// and the two emission-side consumers (preview/list StitchSequence,
// byte-export DesignDraft).
//
// Every consumer asks the same two questions about a Project:
//   1. Does it carry any satin segments?
//   2. Is the user authoring it in segment mode or manual mode?
// The answer to those questions decides which pipeline branch runs:
//   • no-satin             → carriage planner (planFoot) for design mode,
//                             or a verbatim wrap for manual mode
//   • satin (either mode)  → the multi-block walker (runMultiBlock)
//
// Before this module the (mode, hasSatin) dispatch was rewritten at
// every consumer site: sequenceFromProject did one shape, projectDraft
// did another. Lift it here so consumers ask once and either receive a
// flat sequence or an export-ready draft. The shared helpers
// (singleton draft assembly, dimensions math, satin source factories)
// are private to this module.

import { foot } from './foot.js';
import { hasSatin, startXMmOf } from './project.js';
import { boundsOf, xUmYumFromBbox } from './bbox.js';
import { spineToEdges, type ConeEdges } from '../shared/satinShape.js';
import {
  emitDesignMultiBlock,
  emitManualMultiBlock,
} from './pipeline/multiBlockEmit.js';
import { encodeSegments } from './pipeline/encodeSegments.js';
import { X_UNITS_PER_MM } from '../parser/units.js';
import type { Foot } from './foot.js';
import type { Project } from './types.js';
import type { Stitch, StitchSequence } from './pipeline/stitch.js';
import type {
  DesignBlockDraft,
  StitchInput,
} from './pipeline/multiBlockEmit.js';
import type {
  DesignDraft,
  MultiBlockDesignDraft,
  SingletonDesignDraft,
} from './sh7BinaryExport.js';

/**
 * Encoder formula for `xElem` (in µm) from the project's chain-anchor-
 * relative `startXMm`. The firmware places the carriage at `-xElem / 1000
 * mm` in machine coords, and the importer maps that into project coords
 * via `startXMm = -xElemMm - firstPointXMm`. Since new projects have the
 * chain anchor at design origin (firstPoint.x = 0 after recentering),
 * the encoder inverse is `xElem = -startXMm * 1000`.
 */
function xElemUmFromStart(startXMm: number): number {
  // `+0` collapses the JS -0 case so consumers that strictly equality-check
  // against literal 0 (existing tests, snapshot generation) stay happy.
  return Math.round(-startXMm * 1000) + 0;
}

function planOptsFor(project: Project) {
  return { maxNeedleMm: project.encoderMode === 'uniform' ? 1.0 : Infinity };
}

function isInt8(v: number): boolean {
  return Number.isInteger(v) && v >= -128 && v <= 127;
}

/**
 * Build the StitchSequence for a project. The preview, stitch-list, and
 * carriage-frame tracker all consume this. Satin-free projects route
 * through the carriage planner (preserves the characterization snapshot
 * byte-stream); satin-bearing projects route through the multi-block
 * walker.
 */
export function projectSequence(project: Project): StitchSequence {
  const projectFoot = foot(project.suggestedFoot);
  const planOpts = planOptsFor(project);
  const startX = startXMmOf(project);
  if (project.mode === 'manual') {
    return hasSatin(project)
      ? emitManualMultiBlock(project, projectFoot, planOpts, startX).sequence
      : manualSequence(project, startX);
  }
  return encodeSegments(project.points, project.segments, projectFoot, planOpts, startX);
}

/**
 * Build the byte-export draft for a project. Satin-free projects emit a
 * {@link SingletonDesignDraft} from the same StitchSequence the preview
 * consumes; satin-bearing projects emit a {@link MultiBlockDesignDraft}
 * via the multi-block walker (which mirrors the firmware's chain model
 * across the cone boundaries the planner can't see).
 */
export function projectDraft(project: Project): DesignDraft {
  if (!hasSatin(project)) {
    return sequenceToSingletonDraft(projectSequence(project), project);
  }
  const source = project.mode === 'manual'
    ? manualSatinSource(project)
    : segmentSatinSource(project);
  return multiBlockDraft(project, source);
}

// ---------------------------------------------------------------------------
// No-satin manual path
//
// Manual mode without satin: each stitch was slot-validated when placed,
// so we just wrap the stored ManualStitchInput list in the canonical
// {start, ...} StitchSequence shape. No encoding happens here. Each
// stitch is shallow-copied so callers can't mutate project state through
// the returned sequence.

function manualSequence(project: Project, startXMm: number): StitchSequence {
  const startPt = project.points[0] ?? { x: 0, y: 0 };
  const stitches: Stitch[] = [
    { kind: 'start', x: startPt.x, y: startPt.y, sourceIndex: -1, carriageXMm: startXMm },
  ];
  // Satin-free manual mode: each stitch was slot-validated when placed,
  // so the firmware's carriage follows the simple rule — jumps slide
  // the carriage by dxHi (or dxRaw / X_UNITS_PER_MM for encoder-emitted
  // jumps that don't carry dxHi), needles plant. Fold that running
  // carriage onto each emitted Stitch directly.
  let carriage = startXMm;
  for (const m of project.manualStitches) {
    if (m.kind === 'satin') continue;
    // m is now narrowed to ManualNeedleStitch | ManualJumpStitch.
    if (m.kind === 'jump') carriage += jumpCarriageDxMm(m);
    stitches.push(stitchFromManual(m, carriage));
  }
  return stitches;
}

/**
 * Lateral carriage slide for a single jump record, in mm. The firmware
 * envelope is `|dxHi| ≤ 1 mm` per jump record (see FORMAT.md for the
 * dxHi / dxLow split of the 7-byte long-jump record). Imported binary
 * jumps preserve their original dxHi; encoder-emitted jumps don't set
 * dxHi (= dxRaw / X_UNITS_PER_MM by construction since the encoder
 * caps |dxRaw| at 8 raw / 1 mm). Falling back to dxRaw / X_UNITS_PER_MM
 * keeps encoder output's carriage trace unchanged.
 */
function jumpCarriageDxMm(m: { dxRaw: number; dxHi?: number }): number {
  return m.dxHi ?? m.dxRaw / X_UNITS_PER_MM;
}

function stitchFromManual(
  m: import('./types.js').ManualNeedleStitch | import('./types.js').ManualJumpStitch,
  carriage: number,
): Stitch {
  // The caller filters satin out, so this only sees needle / jump. We
  // attach the encoder bookkeeping (sourceIndex, carriageXMm) here.
  // Manual-mode records never originate from a segment, so sourceIndex
  // is always -1.
  if (m.kind === 'jump') {
    return { kind: 'jump', x: m.x, y: m.y, dxRaw: m.dxRaw, dyRaw: m.dyRaw, sourceIndex: -1, carriageXMm: carriage };
  }
  return { kind: 'needle', x: m.x, y: m.y, dxRaw: m.dxRaw, dyRaw: m.dyRaw, sourceIndex: -1, carriageXMm: carriage };
}

// ---------------------------------------------------------------------------
// Singleton draft assembly

function sequenceToSingletonDraft(seq: StitchSequence, project: Project): SingletonDesignDraft {
  const stitches: StitchInput[] = [];
  for (const s of seq) {
    if (s.kind === 'start') continue;
    if (s.kind === 'jump') {
      stitches.push({ kind: 'jump', dxRaw: s.dxRaw, dyRaw: s.dyRaw });
      continue;
    }
    // 'needle' → 'short' record, with int8 auto-promotion to 'jump' for any
    // delta the planner / manual validator missed (defensive — a valid
    // pipeline output never exceeds int8 here).
    const kind = isInt8(s.dxRaw) && isInt8(s.dyRaw) ? 'short' : 'jump';
    stitches.push({ kind, dxRaw: s.dxRaw, dyRaw: s.dyRaw });
  }
  const { xUm, yUm } = sequenceDimensionsUm(seq);
  return {
    kind: 'singleton',
    footByte: foot(project.suggestedFoot).byte,
    tensionByte: Math.round(project.threadTension * 10),
    xUm,
    yUm,
    xElem: xElemUmFromStart(startXMmOf(project)),
    stitches,
  };
}

/**
 * Bbox over every stitch position in the sequence (including the
 * 'start' marker). Both authoring sources flow through the same
 * pipeline, so the same bbox math applies. A disconnected design
 * produces a smaller bbox (or {0, 0} for an empty sequence) than a
 * points-only bbox would: that is intentional — disconnected points
 * don't sew, so they shouldn't drive the displayed dimension.
 */
function sequenceDimensionsUm(seq: StitchSequence): { xUm: number; yUm: number } {
  return xUmYumFromBbox(boundsOf(seq));
}

// ---------------------------------------------------------------------------
// Multi-block draft assembly
//
// Both mode-specific satin sources (segment-mode and manual-mode) implement
// the same two-method interface: enumerate the cone edges for the bbox
// calculation, and emit the chain-walker's block list. The single
// `multiBlockDraft` helper packages either source into a
// {@link MultiBlockDesignDraft}.

interface SatinSource {
  /** Every cone's ConeEdges, in design order. Consumed by the bbox calc. */
  coneEdges(): Iterable<ConeEdges>;
  /** Run the multi-block walker under the given foot, return the block list. */
  emitBlocks(foot: Foot, planOpts: { maxNeedleMm: number }): DesignBlockDraft[];
}

function multiBlockDraft(project: Project, source: SatinSource): MultiBlockDesignDraft {
  const projectFoot = foot(project.suggestedFoot);
  const planOpts = planOptsFor(project);
  const blocks = source.emitBlocks(projectFoot, planOpts);
  const { xUm, yUm } = dimensionsUm(project, source.coneEdges());
  return {
    kind: 'multi',
    footByte: projectFoot.byte,
    tensionByte: Math.round(project.threadTension * 10),
    xUm,
    yUm,
    blocks,
  };
}

function segmentSatinSource(project: Project): SatinSource {
  const pointsById = new Map(project.points.map((p) => [p.id, p] as const));
  const edges: ConeEdges[] = [];
  for (const seg of project.segments) {
    if (seg.type !== 'satin') continue;
    const from = pointsById.get(seg.from);
    const to = pointsById.get(seg.to);
    if (!from || !to) continue;
    edges.push(spineToEdges({
      from, to, widthStart: seg.widthStart, widthEnd: seg.widthEnd,
    }));
  }
  return {
    coneEdges: () => edges,
    emitBlocks: (f, planOpts) =>
      emitDesignMultiBlock(project.points, project.segments, f, planOpts, startXMmOf(project)).blocks,
  };
}

function manualSatinSource(project: Project): SatinSource {
  const edges: ConeEdges[] = [];
  for (const m of project.manualStitches) {
    if (m.kind !== 'satin') continue;
    edges.push(spineToEdges({
      from: { x: m.x, y: m.y },
      to: { x: m.toX, y: m.toY },
      widthStart: m.widthStart,
      widthEnd: m.widthEnd,
    }));
  }
  return {
    coneEdges: () => edges,
    emitBlocks: (f, planOpts) => emitManualMultiBlock(project, f, planOpts, startXMmOf(project)).blocks,
  };
}

/**
 * Bbox of every point that contributes to the design's displayed dimensions:
 * project.points (segment-mode spine endpoints, manual-mode chain anchor),
 * every manual stitch's absolute (x, y) and — for satin stitches — the
 * spine endpoint, plus the cone-edge corners of every satin in `satinEdges`.
 *
 * Without the cone edges the bbox would undersize designs whose cones
 * extend beyond the spine's bounding box.
 */
function* dimensionsPoints(
  project: Project,
  satinEdges: Iterable<ConeEdges>,
): Iterable<{ x: number; y: number }> {
  for (const p of project.points) yield p;
  for (const m of project.manualStitches) {
    yield { x: m.x, y: m.y };
    if (m.kind === 'satin') yield { x: m.toX, y: m.toY };
  }
  for (const edges of satinEdges) {
    for (const p of edges.leftPoints) yield p;
    for (const p of edges.rightPoints) yield p;
  }
}

function dimensionsUm(
  project: Project,
  satinEdges: Iterable<ConeEdges>,
): { xUm: number; yUm: number } {
  return xUmYumFromBbox(boundsOf(dimensionsPoints(project, satinEdges)));
}
