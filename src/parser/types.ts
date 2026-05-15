export interface ShortStitchStep {
  kind: 'short';
  dx: number;
  dy: number;
  byteOffset: number;
  byteLength: 2;
  elementIndex: number;
  stepInElement: number;
}

export interface JumpStitchStep {
  kind: 'jump';
  dx: number;
  dy: number;
  flag: number;
  byteOffset: number;
  byteLength: 7;
  elementIndex: number;
  stepInElement: number;
}

/**
 * A pseudo-step representing a whole satin chunk. Occupies one slot in the
 * step timeline so users can click / highlight / play through it like a real
 * stitch — the visual is the cone polygon plus its simulated zigzag fill.
 */
export interface SatinStep {
  kind: 'satin';
  satinIndex: number;
  byteOffset: number;
  byteLength: number;
}

/** Real stitches (have dx/dy/elementIndex). Excludes satin pseudo-steps. */
export type ElementStep = ShortStitchStep | JumpStitchStep;

/** Anything that can appear in the global timeline. */
export type Step = ElementStep | SatinStep;

export interface AbsolutePoint {
  x: number;
  y: number;
}

export interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  xSpan: number;
  ySpan: number;
}

export interface BoundingBoxMm {
  minXmm: number;
  maxXmm: number;
  minYmm: number;
  maxYmm: number;
  xSpan: number;
  ySpan: number;
}

export interface ParsedElement {
  index: number;
  steps: ElementStep[];
  /** Length = steps.length + 1, starting at the element's chain position. */
  absolutePoints: AbsolutePoint[];
  bbox: BoundingBox;
  stitchChunkOffset: number;
  stitchPayloadOffset: number;
  stitchPayloadLength: number;
}

/**
 * One simulated zigzag stitch inside a satin cone — endpoints in raw stitch
 * units, world coordinates. The parser interpolates the left/right edges at
 * a fixed density and alternates left-to-right / right-to-left.
 */
export interface SimulatedSatinStitch {
  start: AbsolutePoint;
  end: AbsolutePoint;
}

/**
 * Satin section — a 02 03 01 chunk that defines a cone-shaped fill between
 * two outline curves (left and right). Encodes points in the satin's local
 * frame; world position depends on the chain position when the satin is
 * processed.
 */
export interface SatinSection {
  index: number;
  /** Left edge of the cone, in raw stitch units, in world coordinates. */
  leftPoints: AbsolutePoint[];
  /** Right edge, in raw stitch units, in world coordinates. */
  rightPoints: AbsolutePoint[];
  /** Simulated zigzag fill stitches in playback order. */
  simulatedStitches: SimulatedSatinStitch[];
  bbox: BoundingBox;
  chunkOffset: number;
  payloadOffset: number;
  payloadLength: number;
}

/**
 * Anything that can appear between elements in a multi-element file. Sequence
 * of these (alternating element/satin) defines the chain order for positioning.
 */
export type DesignBlock =
  | { kind: 'element'; element: ParsedElement }
  | { kind: 'satin'; satin: SatinSection };

/**
 * Firmware-read fields decoded from the file's 0x06 (per-slot metadata)
 * and 0x05 (per-slot record) chunks. Layout owned by
 * [chunkSchema](../format/chunkSchema.ts); the field set is the
 * intersection of what the firmware reads and what the encoder writes
 * by name (rather than carries verbatim from a verbatim template).
 *
 * Tension is the BASE byte (slot 0); the slot-3 +6 bump is reversed by
 * the schema before it lands here.
 */
export interface ParsedDesignMetadata {
  /** 1 for singleton (NN=1) files, 3 for multi-element (NN=5, satin-bearing). */
  classByte: 1 | 3;
  /** Suggested presser foot byte (0x06 chunk +0x05). */
  footByte: number;
  /** Thread tension byte (display value × 10), with the slot-3 bump removed. */
  tensionByte: number;
  /**
   * X dimension in micrometres, read from the 0x05 chunk (BE32; more
   * precise than the 0x06 BE16 mirror).
   */
  xUm: number;
  /** Y dimension in micrometres, read from the 0x05 chunk (BE32). */
  yUm: number;
  /**
   * The BE16 at 0x06 payload +0x1D ("val[0]" in FORMAT.md). Defaults to
   * X_µm in the encoder; the singleton template sets 6000 explicitly. Firmware-read but
   * semantics unknown.
   */
  val0Um: number;
  /** Slot-pattern bytes from the 0x06 chunks. Length 9. */
  slotPattern: number[];
  /**
   * Carriage-initial X offset (BE32 µm) from slot 0 of the 0x05 chunks
   * — singleton only. The firmware places the slot centre at
   * `-xElemUm / 1000 mm` relative to the design's machine origin so
   * the first run of shorts fits within the slot. Null for multi-element
   * designs (their per-element xElem lives in the geometry wrapper
   * sub-blocks instead).
   */
  xElemUm: number | null;
}

export interface ParsedDesign {
  fileSize: number;
  producerString: string;
  /** Stitch elements (02 01 01 chunks). */
  elements: ParsedElement[];
  /** Satin cone sections (02 03 01 chunks), interleaved between elements. */
  satins: SatinSection[];
  /** Ordered sequence of element/satin blocks as they appear in the file. */
  blocks: DesignBlock[];
  /** Concatenation of all elements' steps in order. */
  steps: Step[];
  /** bbox over all elements + satins. */
  bbox: BoundingBox;
  bboxMm: BoundingBoxMm;
  /** Firmware-read fields decoded from the 0x06 and 0x05 chunk blocks. */
  metadata: ParsedDesignMetadata;
  rawBuffer: Uint8Array;
}

export { X_UNITS_PER_MM, Y_UNITS_PER_MM } from './units.js';
