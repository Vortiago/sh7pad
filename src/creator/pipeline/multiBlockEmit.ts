// Shared chain-tracking walker for designs that contain satin chunks.
//
// Used by both the binary export (DesignDraft.blocks) and the preview
// pipeline (StitchSequence). The walker is the single source of truth
// for the per-record stream the firmware will receive — preview and
// export read the same flat stitch list, so the preview is a literal
// preview of what the export writes.
//
// The walker mirrors the firmware's chain model:
//   • Straight segment → moveTo(target). One short record if the delta
//     fits int8, otherwise split into ≤ 1 mm jump pieces. Chain advances
//     to the segment's `to` point.
//   • Satin segment → moveTo(TL); placeSatin (emits zigzag drops);
//     chain → BR. If `endAt` is set, moveTo(trailer): the trailer is
//     usually a single short carrying the full BR→corner delta —
//     trailers across every observed multi-element sample file are
//     single shorts, no jump chains. chain → trailer.
//
// The chain reset through satin chunks is exactly what was missing in
// the prior planFoot-only preview path: planFoot doesn't see satins,
// so it threaded a stale carriage value across satin boundaries — its
// post-satin records mixed shorts and jumps assuming a planted carriage
// at the wrong X. The bytes the binary export wrote (via this walker)
// disagreed. Routing both consumers through one walker eliminates that
// mismatch by construction.

import type { Point, Project } from '../types.js';
import type { Stitch, StitchSequence } from './stitch.js';
import {
  coneCorners,
  satinTrailerEnd,
  spineXAtY,
  type ConeEdges,
} from '../../shared/satinShape.js';
import { X_UNITS_PER_MM, Y_UNITS_PER_MM } from '../../parser/units.js';
import { satinStitches } from '../../shared/satinShape.js';
import { boundsOf } from '../bbox.js';
import {
  coneEdgesFromManual,
  coneEdgesFromSegment,
} from '../satinSources.js';
import type { Foot } from '../foot.js';
import {
  FootEncodeException,
  planFoot,
  type PlanFootOptions,
} from '../carriagePlanner.js';

// File-format input shapes — what each record costs in bytes. Shared by
// the binary export's `encodeStitches` and the multi-block builder.

// Byte-shape stitch records — what the codec writes into the file.
// Same delta data as Stitch.dxRaw / Stitch.dyRaw (from stitch.ts), in
// raw stitch units (X: 8/mm, Y: 12/mm). Field names align so the
// conversion between the two types is property shorthand.
export interface ShortStitchInput {
  kind?: 'short';
  dxRaw: number;
  dyRaw: number;
}

export interface JumpStitchInput {
  kind: 'jump';
  dxRaw: number;
  dyRaw: number;
}

export type StitchInput = ShortStitchInput | JumpStitchInput;

export interface ElementBlockDraft {
  kind: 'element';
  stitches: StitchInput[];
  /** Override per-element X_elem (default: draft.xElem). */
  xElem?: number;
  /** Per-element 5th BE32 (chain Y at element start in µm; default 0). */
  yPos?: number;
}

export interface SatinBlockDraft {
  kind: 'satin';
  edges: ConeEdges;
  /**
   * Override the trailing two BE32s of the (1, 1, 1, ?, ?) interstitial that
   * sits between an element-stitch chunk and this satin. Default (0, 0).
   */
  interstitial?: [number, number];
}

export type DesignBlockDraft = ElementBlockDraft | SatinBlockDraft;

/** Result of one project walk — both representations from the same builder run. */
export interface MultiBlockEmitResult {
  /** Flat StitchSequence for the preview / tracker. */
  sequence: StitchSequence;
  /** Block list for the binary export wrapper. */
  blocks: DesignBlockDraft[];
}

function isInt8(v: number): boolean {
  return Number.isInteger(v) && v >= -128 && v <= 127;
}

/**
 * Choose the stitch envelope based on raw deltas. `dx = -128` collides
 * with the long-jump prefix `0x80` and must be promoted to a jump even
 * when it nominally fits int8.
 */
export function promoteToShortOrJump(dxRaw: number, dyRaw: number): 'short' | 'jump' {
  if (!isInt8(dxRaw) || !isInt8(dyRaw)) return 'jump';
  if (dxRaw === -128) return 'jump';
  return 'short';
}

interface MultiBlockBuilderOptions {
  initialChain: { x: number; y: number } | null;
  /**
   * Foot under which moveTo's chain transitions get planned. Every
   * straight-segment chain transition (and the bridge to a satin's TL,
   * and any satin trailer) calls planFoot with the foot's slot and
   * reach values, so the records the multi-block builder emits respect
   * the same slot rule the planFoot path enforces — no separate
   * "long-short fits int8" rule that bypasses the slot.
   */
  foot: Foot;
  /** Forwarded to planFoot at every chain transition. */
  planOpts?: PlanFootOptions;
  /**
   * Carriage X at design start in mm. Mirrors the firmware's `xElem`
   * field: imported binaries set this to the value the firmware uses
   * to place the slot at design load; new projects default to 0
   * (carriage at chain anchor). The running carriage advances from
   * here via moveTo / placeSatin / pushRawStitch as records emit.
   */
  initialCarriageXMm?: number;
}

interface MultiBlockBuilder {
  chain(): { x: number; y: number } | null;
  setInitialChain(p: { x: number; y: number }): void;
  /**
   * Walk the chain to `target`, emitting whatever short / jump records
   * planFoot decides under the configured foot's slot rule. The chain
   * advances to `target` after; the running carriage threads through
   * the planner's per-piece carriage decisions.
   */
  moveTo(target: { x: number; y: number }, sourceIndex: number): void;
  /** Emit a satin block AND zigzag drops (with optional trailer) in one step.
   * The chain advances to the trailer (if any) or BR. */
  placeSatin(
    edges: ConeEdges,
    density: number,
    endAt: import('../../shared/satinShape.js').SatinEndAt | undefined,
    sourceIndex: number,
  ): void;
  /** Push a pre-decided record (manual mode passes byte-shape stitches). */
  pushRawStitch(
    kind: 'short' | 'jump',
    dxRaw: number,
    dyRaw: number,
    newChain: { x: number; y: number },
    sourceIndex: number,
    /** Optional signed dxHi for jumps imported from binary. See JumpStitch.dxHi. */
    dxHi?: number,
  ): void;
  finalize(): {
    blocks: DesignBlockDraft[];
    /**
     * Per-block start position, parallel to `blocks`. Element blocks
     * carry the chain X/Y at their first record; satin blocks have no
     * start (they advance the chain through their cone), so their
     * entry is `null`. The high-level walker uses this to compute
     * each element block's `xElem` / `yPos` relative to the design
     * origin without round-tripping the start through a private field
     * on the block itself.
     */
    blockStarts: ({ x: number; y: number } | null)[];
    flatStitches: Stitch[];
  };
}

/**
 * Multi-block builder. Tracks the chain across straights and satins,
 * emits both byte-shape blocks and a parallel flat StitchSequence with
 * absolute (x, y) coords for the preview.
 */
function createMultiBlockBuilder(opts: MultiBlockBuilderOptions): MultiBlockBuilder {
  const blocks: DesignBlockDraft[] = [];
  // Parallel to blocks. Element blocks store their chain start
  // position; satin blocks store null. Read by the high-level walker's
  // post-walk pass to resolve xElem / yPos without smuggling a private
  // field on the block itself.
  const blockStarts: ({ x: number; y: number } | null)[] = [];
  let curStitches: StitchInput[] = [];
  let chain: { x: number; y: number } | null = opts.initialChain;
  let curElementStart: { x: number; y: number } | null = null;

  // Preview-side stitch buffer. Each Stitch carries (absolute x/y, raw
  // deltas, sourceIndex back to the originating segment, carriage X
  // after the record executes). The encoder is the one place that knows
  // where the firmware's carriage will be (long-short auto-walk, satin
  // spine pinning), so the tracker reads carriageXMm verbatim instead
  // of inferring it from kind + dxRaw.
  //
  // Running carriage state — tracks the firmware's carriage as records
  // are emitted. moveTo's records walk the carriage with the chain
  // (the firmware auto-walks during long shorts and per-piece during
  // split jumps). placeSatin's drops pin it to the cone's spine.
  // pushRawStitch follows the user's chosen kind (jumps walk, shorts
  // plant) since manual mode validates each stitch fits the slot.
  const flatStitches: Stitch[] = [];
  // Carriage starts at `opts.initialCarriageXMm` (default 0). Imported
  // binaries set this from the file's xElem so the slot is positioned
  // off-centre at design start (matches the firmware's actual
  // carriage placement). Records emitted below walk it (moveTo,
  // pushRawStitch jump) or pin it to the cone spine (placeSatin drops).
  let runningCarriageXMm = opts.initialCarriageXMm ?? 0;

  const flushElement = () => {
    if (curStitches.length === 0) return;
    const start = curElementStart ?? chain ?? { x: 0, y: 0 };
    blocks.push({ kind: 'element', stitches: curStitches });
    blockStarts.push(start);
    curStitches = [];
    curElementStart = null;
  };

  const moveTo = (target: { x: number; y: number }, sourceIndex: number) => {
    if (chain == null) {
      // First chain transition seeds the chain at `target` — no records
      // are emitted (the chain anchor isn't a stitch). Crucially, do
      // NOT reset runningCarriageXMm here: the carriage's initial X
      // (`opts.initialCarriageXMm`) may differ from the chain anchor
      // when the imported `xElem` puts the slot off-centre at design
      // start. Resetting would collapse that offset.
      chain = target;
      return;
    }
    if (curElementStart == null) curElementStart = chain;
    const dxRawTotal = Math.round((target.x - chain.x) * X_UNITS_PER_MM);
    const dyRawTotal = Math.round((target.y - chain.y) * Y_UNITS_PER_MM);
    if (dxRawTotal === 0 && dyRawTotal === 0) {
      chain = target;
      return;
    }
    // Hand the chain transition to planFoot — the single source of
    // truth for "what records does this delta become". planFoot
    // splits oversized pieces (slot-violating shorts → jumps) and
    // tracks the carriage per-piece. We resume planning at the
    // current chain X / carriage X so the slot test runs in the
    // absolute design frame.
    const result = planFoot(opts.foot, [{ dxRaw: dxRawTotal, dyRaw: dyRawTotal }], {
      ...opts.planOpts,
      initialCursorXRaw: Math.round(chain.x * X_UNITS_PER_MM),
      initialCarriageXRaw: Math.round(runningCarriageXMm * X_UNITS_PER_MM),
    });
    if (!result.ok) {
      // planFoot's segmentIndex is local to the array we passed it (1
      // entry); rewrite to the project's segment index our caller
      // tagged this transition with so the error message points at
      // the right segment.
      throw new FootEncodeException(opts.foot.name, {
        code: result.error.code,
        segmentIndex: sourceIndex,
      });
    }
    let cumDxRaw = 0;
    let cumDyRaw = 0;
    for (let pi = 0; pi < result.records.length; pi++) {
      const r = result.records[pi]!;
      const isLast = pi === result.records.length - 1;
      curStitches.push({ kind: r.kind, dxRaw: r.dxRaw, dyRaw: r.dyRaw });
      cumDxRaw += r.dxRaw;
      cumDyRaw += r.dyRaw;
      // Mid-piece coords come from cursor + cumulative raw deltas; the
      // final piece snaps to `target` so per-piece quantization rounding
      // doesn't drift the chain landing away from the segment endpoint
      // (target may be a non-stitch-quantized fractional mm value).
      const ax = isLast ? target.x : chain.x + cumDxRaw / X_UNITS_PER_MM;
      const ay = isLast ? target.y : chain.y + cumDyRaw / Y_UNITS_PER_MM;
      runningCarriageXMm = r.carriageXMm;
      flatStitches.push({
        kind: r.kind === 'short' ? 'needle' : 'jump',
        x: ax, y: ay,
        dxRaw: r.dxRaw, dyRaw: r.dyRaw,
        sourceIndex,
        carriageXMm: runningCarriageXMm,
      });
    }
    chain = target;
  };

  const placeSatin = (
    edges: ConeEdges,
    density: number,
    endAt: import('../../shared/satinShape.js').SatinEndAt | undefined,
    sourceIndex: number,
  ) => {
    const { tl, br } = coneCorners(edges);
    const bridgeIdxBefore = flatStitches.length;
    moveTo(tl, sourceIndex);
    // The bridge's LANDING record sits at TL — inside the cone's top
    // edge. From that frame on, the firmware drives the carriage along
    // the cone's spine, so override the moveTo's "carriage = cursor"
    // value with spineXAtY. Intermediate bridge pieces (only emitted
    // for long bridges) keep their cursor-tracking carriage; only the
    // landing pins to the spine.
    if (flatStitches.length > bridgeIdxBefore) {
      const lastIdx = flatStitches.length - 1;
      runningCarriageXMm = spineXAtY(edges, flatStitches[lastIdx]!.y);
      (flatStitches[lastIdx] as { carriageXMm: number }).carriageXMm = runningCarriageXMm;
    }
    flushElement();
    blocks.push({ kind: 'satin', edges });
    blockStarts.push(null);
    chain = br;
    // Zigzag drops — the firmware computes the records from the cone
    // edges, so the bytes don't list them, but the preview shows each
    // drop. Carriage rides the spine: spineXAtY at each drop's Y.
    let cur = tl;
    for (const s of satinStitches(edges, density)) {
      const dxRaw = Math.round((s.end.x - cur.x) * X_UNITS_PER_MM);
      const dyRaw = Math.round((s.end.y - cur.y) * Y_UNITS_PER_MM);
      runningCarriageXMm = spineXAtY(edges, s.end.y);
      flatStitches.push({
        kind: 'needle', x: s.end.x, y: s.end.y, dxRaw, dyRaw,
        sourceIndex, carriageXMm: runningCarriageXMm,
      });
      cur = s.end;
    }
    // Trailer (if any) — moveTo so the bytes carry it inside the next
    // element block. Carriage rides the spine through the trailer step
    // too (firmware drives carriage along spine for the whole satin
    // chunk), so override every record moveTo emitted to spineXAtY.
    const trailer = satinTrailerEnd(edges, endAt);
    if (trailer) {
      const trailerIdxBefore = flatStitches.length;
      moveTo(trailer, sourceIndex);
      for (let i = trailerIdxBefore; i < flatStitches.length; i++) {
        (flatStitches[i] as { carriageXMm: number }).carriageXMm =
          spineXAtY(edges, flatStitches[i]!.y);
      }
      const lastIdx = flatStitches.length - 1;
      if (lastIdx >= 0) runningCarriageXMm = flatStitches[lastIdx]!.carriageXMm;
    }
  };

  const pushRawStitch = (
    kind: 'short' | 'jump',
    dxRaw: number,
    dyRaw: number,
    newChain: { x: number; y: number },
    sourceIndex: number,
    dxHi?: number,
  ) => {
    if (curElementStart == null) curElementStart = chain ?? newChain;
    curStitches.push({ kind, dxRaw, dyRaw });
    // Shorts plant the carriage (only the needle swings within the
    // foot's slot). Jumps slide the carriage laterally by dxHi mm
    // (firmware envelope |dxHi| ≤ 1 mm). For encoder-emitted jumps
    // dxLow is always 0 and dxHi defaults to dxRaw / X_UNITS_PER_MM —
    // the two carriage models agree there. For IMPORTED binary jumps
    // (parsedStitchFileToManualProject) dxHi is set explicitly because
    // dxLow may be non-zero, in which case the firmware-faithful walk
    // uses dxHi rather than the full dxRaw / X_UNITS_PER_MM.
    if (kind === 'jump') {
      runningCarriageXMm += dxHi ?? dxRaw / X_UNITS_PER_MM;
    }
    flatStitches.push(
      kind === 'jump'
        ? { kind: 'jump', x: newChain.x, y: newChain.y, dxRaw, dyRaw, dxHi, sourceIndex, carriageXMm: runningCarriageXMm }
        : { kind: 'needle', x: newChain.x, y: newChain.y, dxRaw, dyRaw, sourceIndex, carriageXMm: runningCarriageXMm },
    );
    chain = newChain;
  };

  return {
    chain: () => chain,
    setInitialChain(p) {
      chain = p;
      // The firmware's carriage starts at the design origin. When the
      // first chain landing is non-zero (e.g. design-mode points[0] at
      // x=10), the seeded carriage is at that landing's X — matching
      // moveTo's null-chain branch, which sets `runningCarriageXMm =
      // target.x` for the same reason. Without this, planFoot would
      // think the carriage was still at 0 on the first chain transition,
      // and slot decisions for non-zero starts would land in the wrong
      // frame.
      runningCarriageXMm = p.x;
    },
    moveTo,
    placeSatin,
    pushRawStitch,
    finalize() {
      flushElement();
      // Wrapper convention: a satin-tail design ends with a synthetic
      // closing element using the current chain, so the file always
      // closes on a stitch chunk.
      if (blocks[blocks.length - 1]?.kind === 'satin' && chain) {
        blocks.push({
          kind: 'element',
          stitches: [{ kind: 'short', dxRaw: 0, dyRaw: 0 }],
        });
        blockStarts.push(chain);
      }
      return {
        blocks,
        blockStarts,
        flatStitches,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// High-level walkers — design-mode and manual-mode entry points.

/** Minimum-X / minimum-Y across every point that contributes to a satin
 *  design's bbox: project.points + cone corners + chain start. The binary
 *  export uses these to compute xElem / yPos offsets per element block. */
function originXY(
  initialChain: { x: number; y: number },
  points: Iterable<{ x: number; y: number }>,
): { minXmm: number; minYmm: number } {
  const bbox = boundsOf(points);
  return bbox
    ? { minXmm: bbox.minX, minYmm: bbox.minY }
    : { minXmm: initialChain.x, minYmm: initialChain.y };
}

function* coneEdgePoints(edges: ConeEdges): Iterable<{ x: number; y: number }> {
  for (const p of edges.leftPoints) yield p;
  for (const p of edges.rightPoints) yield p;
}

/**
 * One unit of work the walker should perform: straight chain transition,
 * satin cone placement, or a pre-shaped raw stitch (manual mode).
 *
 * Both design and manual mode produce the same item kinds for satin, by
 * design: satin is one concept regardless of authoring path. The two
 * adapter functions below ({@link emitDesignMultiBlock},
 * {@link emitManualMultiBlock}) translate their inputs into this shared
 * vocabulary; the core walker {@link runMultiBlock} doesn't know which
 * mode it came from.
 */
type WalkerItem =
  | { kind: 'moveTo'; target: { x: number; y: number }; sourceIndex: number }
  | {
      kind: 'satin';
      edges: ConeEdges;
      density: number;
      endAt: import('../../shared/satinShape.js').SatinEndAt | undefined;
      sourceIndex: number;
    }
  | {
      kind: 'raw';
      stitchKind: 'short' | 'jump';
      dxRaw: number;
      dyRaw: number;
      newChain: { x: number; y: number };
      sourceIndex: number;
      /** Optional signed dxHi for jumps imported from binary files. See JumpStitch.dxHi. */
      dxHi?: number;
    };

/**
 * Shared core walker. Builds the StitchSequence and DesignBlockDraft list
 * from a vocabulary of {@link WalkerItem}s. Lifts the cone-corner /
 * interstitial / start-marker post-passes that previously lived
 * duplicated in the two mode-specific walkers.
 */
function runMultiBlock(opts: {
  initialChain: { x: number; y: number };
  attachInitialChain: boolean;
  foot: Foot;
  planOpts: PlanFootOptions;
  /** Iteration of geometry that contributes to the design bounding box. */
  bboxPoints: () => Iterable<{ x: number; y: number }>;
  items: Iterable<WalkerItem>;
  /** Carriage X at design start (mm); see MultiBlockBuilderOptions. */
  initialCarriageXMm?: number;
  /**
   * **Start Stitch** X (mm). Prepended as a leading needle short with
   * `dx = round(startStitchXMm * X_UNITS_PER_MM)`, `dy = 0` — the first
   * machine record in the sequence and in the first element block.
   * Defaults to 0 (no offset; the leading record is a no-op needle drop
   * at the chain anchor).
   */
  startStitchXMm?: number;
}): MultiBlockEmitResult {
  const { minXmm, minYmm } = originXY(opts.initialChain, opts.bboxPoints());

  const builder = createMultiBlockBuilder({
    initialChain: opts.attachInitialChain ? opts.initialChain : null,
    foot: opts.foot,
    planOpts: opts.planOpts,
    initialCarriageXMm: opts.initialCarriageXMm,
  });

  for (const item of opts.items) {
    if (item.kind === 'moveTo') {
      if (builder.chain() == null) builder.setInitialChain(item.target);
      else builder.moveTo(item.target, item.sourceIndex);
    } else if (item.kind === 'satin') {
      builder.placeSatin(item.edges, item.density, item.endAt, item.sourceIndex);
    } else {
      builder.pushRawStitch(item.stitchKind, item.dxRaw, item.dyRaw, item.newChain, item.sourceIndex, item.dxHi);
    }
  }

  const finalized = builder.finalize();
  const sequence = buildSequenceWithStartMarker(
    finalized.flatStitches,
    opts.initialCarriageXMm ?? 0,
    opts.startStitchXMm ?? 0,
  );
  const blocks = resolveBlockOffsets(
    finalized.blocks,
    finalized.blockStarts,
    opts.initialChain,
    minXmm,
    minYmm,
    opts.startStitchXMm ?? 0,
  );
  return { sequence, blocks };
}

/**
 * Wrap the builder's flat stitch list in the StitchSequence shape the
 * preview / tracker consume. Empty walks (no points, no segments, no
 * contributing manual stitches) yield an empty sequence — matching the
 * "nothing to render" shape also returned by safeSequenceFromProject on
 * FootEncodeException. Non-empty walks get a chain-anchor 'start' marker
 * prepended at design (0, 0), followed by the **Start Stitch** needle
 * record at `(startStitchXMm, 0)` — the first real machine record.
 */
function buildSequenceWithStartMarker(
  flatStitches: readonly Stitch[],
  initialCarriageXMm: number,
  startStitchXMm: number,
): StitchSequence {
  if (flatStitches.length === 0) return [];
  const startDxRaw = Math.round(startStitchXMm * X_UNITS_PER_MM);
  return [
    { kind: 'start', x: 0, y: 0, sourceIndex: -1, carriageXMm: initialCarriageXMm },
    {
      kind: 'needle',
      x: startStitchXMm,
      y: 0,
      dxRaw: startDxRaw,
      dyRaw: 0,
      sourceIndex: -1,
      carriageXMm: initialCarriageXMm,
    },
    ...flatStitches,
  ];
}

/**
 * Resolve element-block xElem/yPos from the parallel blockStarts array,
 * fix up satin-block interstitials so each cone's min-X / chain-Y sits
 * in design-relative µm, and inject the **Start Stitch** as the leading
 * short record in the FIRST element block so the binary export emits it
 * as machine record #1. Pure function — same logic regardless of mode.
 */
function resolveBlockOffsets(
  blocks: readonly DesignBlockDraft[],
  blockStarts: readonly ({ x: number; y: number } | null)[],
  initialChain: { x: number; y: number },
  minXmm: number,
  minYmm: number,
  startStitchXMm: number,
): DesignBlockDraft[] {
  const startDxRaw = Math.round(startStitchXMm * X_UNITS_PER_MM);
  let startStitchInjected = startStitchXMm === 0; // skip injection on no-op
  const out: DesignBlockDraft[] = [];
  let runningChainY = initialChain.y;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.kind === 'element') {
      const start = blockStarts[i] ?? initialChain;
      let elemStitches = b.stitches;
      if (!startStitchInjected) {
        elemStitches = [{ kind: 'short', dxRaw: startDxRaw, dyRaw: 0 }, ...b.stitches];
        startStitchInjected = true;
      }
      out.push({
        kind: 'element',
        stitches: elemStitches,
        xElem: Math.round((start.x - minXmm) * 1000),
        yPos: Math.round((start.y - minYmm) * 1500),
      });
      continue;
    }
    const coneBbox = boundsOf(coneEdgePoints(b.edges));
    const coneMinXmm = coneBbox?.minX ?? initialChain.x;
    out.push({
      kind: 'satin',
      edges: b.edges,
      interstitial: [
        Math.round((coneMinXmm - minXmm) * 1000),
        Math.round((runningChainY - minYmm) * 1500),
      ],
    });
    // After the satin, the chain Y advances to BR.y for any subsequent
    // element block's yPos calculation.
    runningChainY = coneCorners(b.edges).br.y;
  }
  return out;
}

/**
 * Walk segment-authored geometry whose chain may pass through satin
 * chunks. Returns the StitchSequence (for the preview) and the block
 * list (for the binary export) from a single chain-tracker run.
 *
 * Accepts loose `(points, segments, foot)` rather than a `Project` so
 * callers that don't have a full Project — e.g. tests that build a
 * sequence from a points + segments pair — can use the same walker.
 * The foot drives planFoot's slot decisions for every chain transition
 * the walker emits.
 */
export function emitDesignMultiBlock(
  points: readonly Point[],
  segments: readonly import('../types.js').Segment[],
  foot: Foot,
  planOpts: PlanFootOptions = {},
  initialCarriageXMm = 0,
  startStitchXMm = 0,
): MultiBlockEmitResult {
  const byId = new Map<string, Point>();
  for (const p of points) byId.set(p.id, p);

  const edgesBySegId = new Map<string, ConeEdges>();
  for (const seg of segments) {
    if (seg.type !== 'satin') continue;
    const edges = coneEdgesFromSegment(seg, byId);
    if (edges) edgesBySegId.set(seg.id, edges);
  }

  const initialChain = points[0] ?? { x: 0, y: 0 };
  const bboxPoints = function* (): Iterable<{ x: number; y: number }> {
    for (const p of points) yield p;
    for (const e of edgesBySegId.values()) {
      for (const p of e.leftPoints) yield p;
      for (const p of e.rightPoints) yield p;
    }
  };

  const items = function* (): Iterable<WalkerItem> {
    // The first VALID segment seeds the chain at its `from`; subsequent
    // segments walk to `to` (or placeSatin). This matches the legacy
    // semantics: no spurious moveTo-to-`from` records for segments where
    // the chain is already there.
    let seeded = false;
    for (const [idx, seg] of segments.entries()) {
      const from = byId.get(seg.from);
      const to = byId.get(seg.to);
      if (!from || !to) continue;
      if (!seeded) {
        yield { kind: 'moveTo', target: from, sourceIndex: idx };
        seeded = true;
      }
      if (seg.type === 'straight') {
        yield { kind: 'moveTo', target: to, sourceIndex: idx };
      } else {
        const edges = edgesBySegId.get(seg.id)!;
        yield { kind: 'satin', edges, density: seg.density, endAt: seg.endAt, sourceIndex: idx };
      }
    }
  };

  return runMultiBlock({
    initialChain,
    attachInitialChain: false,
    foot,
    planOpts,
    bboxPoints,
    items: items(),
    initialCarriageXMm,
    startStitchXMm,
  });
}

/**
 * Walk a manual-mode project that contains at least one satin. Same
 * output shape as {@link emitDesignMultiBlock}; differs only in which
 * adapter shape we translate from.
 */
export function emitManualMultiBlock(
  project: Project,
  foot: Foot,
  planOpts: PlanFootOptions = {},
  initialCarriageXMm = 0,
  startStitchXMm = 0,
): MultiBlockEmitResult {
  const start = project.points[0] ?? { x: 0, y: 0 };
  const edgesByStitchIdx = new Map<number, ConeEdges>();
  project.manualStitches.forEach((m, i) => {
    if (m.kind !== 'satin') return;
    edgesByStitchIdx.set(i, coneEdgesFromManual(m));
  });

  const bboxPoints = function* (): Iterable<{ x: number; y: number }> {
    yield start;
    for (const [i, m] of project.manualStitches.entries()) {
      const edges = edgesByStitchIdx.get(i);
      if (edges) {
        for (const p of edges.leftPoints) yield p;
        for (const p of edges.rightPoints) yield p;
      } else {
        yield { x: m.x, y: m.y };
      }
    }
  };

  const items = function* (): Iterable<WalkerItem> {
    for (const [i, m] of project.manualStitches.entries()) {
      if (m.kind === 'satin') {
        const edges = edgesByStitchIdx.get(i)!;
        yield { kind: 'satin', edges, density: m.density, endAt: m.endAt, sourceIndex: -1 };
        continue;
      }
      const stitchKind = m.kind === 'jump' ? 'jump' : promoteToShortOrJump(m.dxRaw, m.dyRaw);
      yield {
        kind: 'raw',
        stitchKind,
        dxRaw: m.dxRaw,
        dyRaw: m.dyRaw,
        newChain: { x: m.x, y: m.y },
        sourceIndex: -1,
        dxHi: m.kind === 'jump' ? m.dxHi : undefined,
      };
    }
  };

  return runMultiBlock({
    initialChain: start,
    attachInitialChain: true,
    foot,
    planOpts,
    bboxPoints,
    items: items(),
    initialCarriageXMm,
    startStitchXMm,
  });
}
