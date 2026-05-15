import { readBE32 } from './bytes.js';
import { parseHeader } from './parseHeader.js';
import { parseO5Block, parseO6Block } from './parseChunks.js';
import { parseStitchChunk } from './parseStitches.js';
import { generateSimulatedSatinStitches, parseSatinChunk, placeSatinPoints } from './parseSatin.js';
import { rawXtoMm, rawYtoMm } from './units.js';
import { SATIN_TAG, STITCH_TAG } from '../format/chunkTags.js';
import type {
  AbsolutePoint,
  BoundingBox,
  BoundingBoxMm,
  DesignBlock,
  ParsedDesign,
  ParsedDesignMetadata,
  ParsedElement,
  SatinSection,
  Step,
} from './types.js';

interface ChunkLocation {
  kind: 'short' | 'satin';
  chunkOffset: number;
  payloadOffset: number;
  payloadLength: number;
}

/**
 * Parse the bytes of a `.sh7` design file into a structured
 * {@link ParsedDesign}. Throws if the magic bytes don't match, if the
 * declared file size disagrees with the buffer length, or if the
 * geometry-wrapper chunk count is inconsistent with the sub-chunks
 * found inside it.
 *
 * Library entry point for code that wants to read `.sh7` files without
 * touching the encoder or the editor — pair with the structured types
 * in {@link ./types.ts} to walk the design programmatically.
 */
export function parseFile(buf: Uint8Array): ParsedDesign {
  const header = parseHeader(buf);
  if (buf.length !== header.fileSize) {
    throw new Error(`File size mismatch: header says ${header.fileSize}, buffer is ${buf.length}`);
  }

  const metadata = parseMetadataFields(buf, header.outerChunkOffset);

  const chunks = findStitchAndSatinChunks(buf, header.outerChunkOffset, buf.length);
  if (chunks.length === 0) throw new Error('No 02 01 01 / 02 03 01 chunks found in file');

  const blocks: DesignBlock[] = [];
  let chainX = 0;
  let chainY = 0;
  let elementIndex = 0;
  let satinIndex = 0;

  for (const chunk of chunks) {
    if (chunk.kind === 'short') {
      const element = buildElementBlock(buf, chunk, chainX, chainY, elementIndex++);
      blocks.push({ kind: 'element', element });
      const last = element.absolutePoints[element.absolutePoints.length - 1]!;
      chainX = last.x;
      chainY = last.y;
    } else {
      const satin = buildSatinBlock(buf, chunk, chainX, chainY, satinIndex++);
      blocks.push({ kind: 'satin', satin });
      const lastR = satin.rightPoints[satin.rightPoints.length - 1];
      if (lastR) {
        chainX = lastR.x;
        chainY = lastR.y;
      }
    }
  }

  return assembleDesign(buf, header.producerString, blocks, metadata);
}

function buildElementBlock(
  buf: Uint8Array,
  chunk: ChunkLocation,
  chainX: number,
  chainY: number,
  index: number,
): ParsedElement {
  const payload = buf.subarray(chunk.payloadOffset, chunk.payloadOffset + chunk.payloadLength);
  const steps = parseStitchChunk(payload, chunk.payloadOffset, { elementIndex: index });
  const absolutePoints = computeAbsolutePoints(steps, chainX, chainY);
  return {
    index,
    steps,
    absolutePoints,
    bbox: computeBbox(absolutePoints),
    stitchChunkOffset: chunk.chunkOffset,
    stitchPayloadOffset: chunk.payloadOffset,
    stitchPayloadLength: chunk.payloadLength,
  };
}

function buildSatinBlock(
  buf: Uint8Array,
  chunk: ChunkLocation,
  chainX: number,
  chainY: number,
  index: number,
): SatinSection {
  const payload = buf.subarray(chunk.payloadOffset, chunk.payloadOffset + chunk.payloadLength);
  const decoded = parseSatinChunk(payload);
  const { leftPoints, rightPoints } = placeSatinPoints(decoded, chainX, chainY);
  return {
    index,
    leftPoints,
    rightPoints,
    simulatedStitches: generateSimulatedSatinStitches(leftPoints, rightPoints),
    bbox: computeBbox([...leftPoints, ...rightPoints]),
    chunkOffset: chunk.chunkOffset,
    payloadOffset: chunk.payloadOffset,
    payloadLength: chunk.payloadLength,
  };
}

function assembleDesign(
  buf: Uint8Array,
  producerString: string,
  blocks: DesignBlock[],
  metadata: ParsedDesignMetadata,
): ParsedDesign {
  const elements: ParsedElement[] = [];
  const satins: SatinSection[] = [];
  const steps: Step[] = [];
  for (const block of blocks) {
    if (block.kind === 'element') {
      elements.push(block.element);
      steps.push(...block.element.steps);
    } else {
      satins.push(block.satin);
      steps.push({
        kind: 'satin',
        satinIndex: block.satin.index,
        byteOffset: block.satin.chunkOffset,
        byteLength: 7 + block.satin.payloadLength,
      });
    }
  }

  const allBboxes = [...elements.map((e) => e.bbox), ...satins.map((s) => s.bbox)];
  const overallBbox = unionBboxes(allBboxes);
  return {
    fileSize: buf.length,
    producerString,
    elements,
    satins,
    blocks,
    steps,
    bbox: overallBbox,
    bboxMm: bboxToMm(overallBbox),
    metadata,
    rawBuffer: buf,
  };
}

// ---------- metadata fields (0x06 + 0x05 blocks) -----------------------------

/**
 * Decode the firmware-read fields from the file's per-slot metadata
 * chunks. Layout: outer-chunk header (7 B) → metadata-table chunk
 * (8-byte header + 148-byte payload = 156 B) → 0x06 block → 0x05 block.
 * The 0x09 sentinel byte before each block is skipped by parseO6Block /
 * parseO5Block themselves.
 */
function parseMetadataFields(buf: Uint8Array, outerChunkOffset: number): ParsedDesignMetadata {
  const outerBodyStart = outerChunkOffset + 7;
  // Metadata-table chunk: 0x01 0x08 0x01 0x01 [BE32 0x94] [148 bytes].
  // Header is 8 bytes (4-byte prefix + BE32 length).
  const metadataLen = readBE32(buf, outerBodyStart + 4);
  const o6Start = outerBodyStart + 8 + metadataLen;
  const o6 = parseO6Block(buf, o6Start);
  const o5 = parseO5Block(buf, o6.blockOffset + o6.blockLength);

  // The 0x05 chunk's BE32 X_µm / Y_µm are more authoritative than the
  // 0x06 BE16 mirrors (0x05 is BE32, 0x06 is BE16-capped to 65535 µm).
  // Take dimensions from slot 0 of the 0x05 block; foot/tension come
  // from slot 0 of the 0x06 block; val0Um from slot 0 of 0x06.
  return {
    classByte: o6.cls === 'singleton' ? 1 : 3,
    footByte: o6.slots[0]!.footByte,
    tensionByte: o6.slots[0]!.tensionByte,
    xUm: o5.slots[0]!.xUm,
    yUm: o5.slots[0]!.yUm,
    val0Um: o6.slots[0]!.val0Be16,
    slotPattern: o6.slots.map((s) => s.slotPattern),
    xElemUm: o5.slots[0]!.xElemUm,
  };
}

// ---------- chunk discovery ---------------------------------------------------

function findStitchAndSatinChunks(buf: Uint8Array, startOffset: number, endOffset: number): ChunkLocation[] {
  const chunks: ChunkLocation[] = [];
  let i = startOffset;
  while (i + 7 <= endOffset) {
    const kind = matchChunkTag(buf, i);
    if (kind !== null) {
      const length = readBE32(buf, i + 3);
      const payloadOffset = i + 7;
      if (length > 0 && length < 0x10000 && payloadOffset + length <= endOffset) {
        chunks.push({ kind, chunkOffset: i, payloadOffset, payloadLength: length });
        i = payloadOffset + length;
        continue;
      }
    }
    i++;
  }
  return chunks;
}

function matchChunkTag(buf: Uint8Array, i: number): 'short' | 'satin' | null {
  if (buf[i] === STITCH_TAG[0] && buf[i + 1] === STITCH_TAG[1] && buf[i + 2] === STITCH_TAG[2]) return 'short';
  if (buf[i] === SATIN_TAG[0] && buf[i + 1] === SATIN_TAG[1] && buf[i + 2] === SATIN_TAG[2]) return 'satin';
  return null;
}

// ---------- geometry helpers --------------------------------------------------

function computeAbsolutePoints(steps: Step[], startX: number, startY: number): AbsolutePoint[] {
  const points: AbsolutePoint[] = [{ x: startX, y: startY }];
  let x = startX;
  let y = startY;
  for (const step of steps) {
    if (step.kind === 'satin') continue;
    x += step.dx;
    y += step.dy;
    points.push({ x, y });
  }
  return points;
}

function computeBbox(points: AbsolutePoint[]): BoundingBox {
  if (points.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, xSpan: 0, ySpan: 0 };
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY, xSpan: maxX - minX, ySpan: maxY - minY };
}

function unionBboxes(bboxes: BoundingBox[]): BoundingBox {
  if (bboxes.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0, xSpan: 0, ySpan: 0 };
  let { minX, maxX, minY, maxY } = bboxes[0]!;
  for (let i = 1; i < bboxes.length; i++) {
    const b = bboxes[i]!;
    if (b.minX < minX) minX = b.minX;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return { minX, maxX, minY, maxY, xSpan: maxX - minX, ySpan: maxY - minY };
}

function bboxToMm(bbox: BoundingBox): BoundingBoxMm {
  const minXmm = rawXtoMm(bbox.minX);
  const maxXmm = rawXtoMm(bbox.maxX);
  const minYmm = rawYtoMm(bbox.minY);
  const maxYmm = rawYtoMm(bbox.maxY);
  return {
    minXmm,
    maxXmm,
    minYmm,
    maxYmm,
    xSpan: maxXmm - minXmm,
    ySpan: maxYmm - minYmm,
  };
}
