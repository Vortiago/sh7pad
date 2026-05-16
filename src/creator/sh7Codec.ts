// Byte-level encoders for the .sh7 file format. Pure functions that
// know how to write specific chunks and records — they don't know
// about Project, DesignDraft, or any higher-level orchestration.
//
// The orchestrator (`sh7BinaryExport.ts`) drives these primitives to
// turn a Project into bytes. Tests and probes can import this module
// directly when they need to build chunks by hand.

import { writeBE16, writeBE32, writeUtf16BE } from '../parser/bytes.js';
import type { SatinPayload } from '../parser/parseSatin.js';
import { X_UNITS_PER_MM, Y_UNITS_PER_MM } from '../parser/units.js';
import type { ConeEdges } from '../shared/satinShape.js';
import { boundsOf } from './bbox.js';
import {
  encodeJumpRecord,
  encodeShortRecord,
} from '../format/recordCodec.js';
import {
  GEOMETRY_WRAPPER_PREFIX_SINGLETON,
} from '../format/chunkTags.js';
import {
  type ChunkClass,
  o5PayloadLen,
  write05SlotPattern,
  write05Tension,
  write05XelemBe32,
  write05XumBe32,
  write05YumBe32,
  write06Foot,
  write06Tension,
  write06Val0Be16,
  write06Val0Be32,
  write06Val1Be16,
  write06Val2Be16,
  write06XumA,
  write06XumB,
} from '../format/chunkSchema.js';
import {
  METADATA_TABLE_CHUNK,
  MULTI_O5_CHUNK_TEMPLATE,
  MULTI_O6_BLOCK_TEMPLATE,
  SINGLETON_O6_BLOCK_TEMPLATE,
} from './sh7BinaryExportConstants.js';
import type { StitchInput } from './pipeline/multiBlockEmit.js';

// ---------------------------------------------------------------------------
// Stitch records

export function encodeStitches(stitches: readonly StitchInput[]): Uint8Array {
  const records: Uint8Array[] = [];
  for (let i = 0; i < stitches.length; i++) {
    const s = stitches[i]!;
    const codecInput = { dx: s.dxRaw, dy: s.dyRaw };
    try {
      records.push(s.kind === 'jump' ? encodeJumpRecord(codecInput) : encodeShortRecord(codecInput));
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      const label = s.kind === 'jump' ? 'jump' : 'delta';
      throw new Error(`Stitch #${i} ${label} out of range: dx=${s.dxRaw}, dy=${s.dyRaw} (${cause})`);
    }
  }
  return concat(records);
}

// ---------------------------------------------------------------------------
// Satin chunk payload (parsed by src/parser/parseSatin.ts)
//   [BE16 0x0001][BE16 numLeft][numLeft × (BE32 x_um, BE32 y_um)]
//   [BE16 numRight][numRight × (BE32 x_um, BE32 y_um)][BE16 0x0000]

const SATIN_LEAD = 0x0001;
const SATIN_TRAILER = 0x0000;

// All encoded BE32 values must be NON-NEGATIVE — every satin chunk in the
// observed sample files has the high bit clear. Probing showed the
// machine producing dummy stitches for cones whose negative deltas read
// as ~4 billion µm unsigned. We shift the local frame so the minimum X
// and Y across all left+right points sit at the origin; the parser
// anchors at left[0] so the local-frame origin doesn't change world
// placement.
//
// Y axis uses the X stitch scale (1500 µm/mm) — see parseSatin.ts
// placeSatinPoints.
const SATIN_UM_PER_MM_X = 1000;
const SATIN_UM_PER_MM_Y = (Y_UNITS_PER_MM * 1000) / X_UNITS_PER_MM;

export function coneEdgesToSatinPayload(edges: ConeEdges): SatinPayload {
  // A cone with no points is not a real export-time shape, but guard
  // anyway: fall back to a {0, 0} origin so the payload still encodes
  // (downstream length-prefix machinery handles the empty-list shape).
  const bbox = boundsOf((function* () {
    for (const p of edges.leftPoints) yield p;
    for (const p of edges.rightPoints) yield p;
  })());
  const minX = bbox?.minX ?? 0;
  const minY = bbox?.minY ?? 0;
  const toLocalUm = (p: { x: number; y: number }) => ({
    x: Math.round((p.x - minX) * SATIN_UM_PER_MM_X),
    y: Math.round((p.y - minY) * SATIN_UM_PER_MM_Y),
  });
  return {
    leftUm: edges.leftPoints.map(toLocalUm),
    rightUm: edges.rightPoints.map(toLocalUm),
  };
}

export function encodeSatinPayload(payload: SatinPayload): Uint8Array {
  const numL = payload.leftUm.length;
  const numR = payload.rightUm.length;
  const out = new Uint8Array(2 + 2 + numL * 8 + 2 + numR * 8 + 2);
  let cursor = 0;
  writeBE16(out, cursor, SATIN_LEAD);
  cursor += 2;
  writeBE16(out, cursor, numL);
  cursor += 2;
  for (const p of payload.leftUm) {
    writeBE32(out, cursor, p.x);
    writeBE32(out, cursor + 4, p.y);
    cursor += 8;
  }
  writeBE16(out, cursor, numR);
  cursor += 2;
  for (const p of payload.rightUm) {
    writeBE32(out, cursor, p.x);
    writeBE32(out, cursor + 4, p.y);
    cursor += 8;
  }
  writeBE16(out, cursor, SATIN_TRAILER);
  return out;
}

// ---------------------------------------------------------------------------
// Chunk envelopes

export function encodeChunk(prefix: Uint8Array, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(prefix.length + 4 + payload.length);
  out.set(prefix, 0);
  writeBE32(out, prefix.length, payload.length);
  out.set(payload, prefix.length + 4);
  return out;
}

const GEOMETRY_PARAM_FIXED = [125, 125, 1000] as const;

export interface GeometryWrapperInput {
  xElem: number;
  stitchChunk: Uint8Array;
}

export function encodeGeometryWrapper(input: GeometryWrapperInput): Uint8Array {
  const payload = new Uint8Array(16 + input.stitchChunk.length);
  writeBE32(payload, 0, GEOMETRY_PARAM_FIXED[0]);
  writeBE32(payload, 4, GEOMETRY_PARAM_FIXED[1]);
  writeBE32(payload, 8, GEOMETRY_PARAM_FIXED[2]);
  writeBE32(payload, 12, input.xElem);
  payload.set(input.stitchChunk, 16);
  return encodeChunk(GEOMETRY_WRAPPER_PREFIX_SINGLETON, payload);
}

// ---------------------------------------------------------------------------
// 0x05 chunks (one per slot, nine per file)

const O5_PREFIX = new Uint8Array([0x05, 0x01, 0x02]);
const BE16_MAX = 0xffff;

export interface O5ChunkInput {
  slotIndex: number; // 0..8
  tensionByte: number;
  xUm: number;
  yUm: number;
  xElem: number;
  multiElementMarker?: number; // 0 for singletons, 0x02 for the multi-element template
}

export function encode05Chunk(input: O5ChunkInput): Uint8Array {
  // Singleton 0x05 chunk: 32-byte payload built from scratch. The slot
  // pattern lives at +0x1E (one byte earlier than n=3 multi chunks,
  // which have their multi-element marker at +0x1E and slot pattern at
  // +0x1F). The byte at +0x1D is a padding zero in singleton chunks;
  // a few byte-equal round-trip tests pass an explicit override there,
  // so we keep the multiElementMarker field as a back door for them.
  const payload = new Uint8Array(o5PayloadLen('singleton'));
  write05XelemBe32(payload, input.xElem);
  write05Tension(payload, 'singleton', input.slotIndex, input.tensionByte);
  write05YumBe32(payload, 'singleton', input.yUm);
  write05XumBe32(payload, 'singleton', input.xUm);
  payload[0x1d] = input.multiElementMarker ?? 0;
  write05SlotPattern(payload, 'singleton', input.slotIndex);
  return encodeChunk(O5_PREFIX, payload);
}

export interface O5MultiChunkInput {
  slotIndex: number;
  tensionByte: number;
  xUm: number;
  yUm: number;
}

export function encode05ChunkMulti(input: O5MultiChunkInput): Uint8Array {
  // Multi-element 0x05 chunks are built by patching the verbatim
  // template; the template carries the trailing zero byte and other
  // bytes outside the named field set. The schema patches the named
  // sites; bytes we don't understand stay verbatim.
  const out = new Uint8Array(MULTI_O5_CHUNK_TEMPLATE);
  const PAYLOAD_OFFSET = 7; // 7-byte chunk header
  const payload = out.subarray(PAYLOAD_OFFSET);
  write05Tension(payload, 'multi', input.slotIndex, input.tensionByte);
  write05YumBe32(payload, 'multi', input.yUm);
  write05XumBe32(payload, 'multi', input.xUm);
  write05SlotPattern(payload, 'multi', input.slotIndex);
  return out;
}

// ---------------------------------------------------------------------------
// 0x06 blocks (nine consecutive chunks per file: 118 B singletons,
// 113 B multi). Both classes start from a verbatim template (one per
// class) and patch the firmware-read sites by name.
//
// Multi-element files (NN=5, designs containing satin chunks) MUST use
// n=3 chunks; otherwise the multi-element parser rejects them
// with "Not supported SDC" and the firmware can crash on cascade.
//
// Confirmed firmware-read sites (mapped via probes — see
// ../format/chunkSchema.ts): foot byte, tension (slot 3 = tension + 6),
// val[0] BE16 + BE32 mirror, val[1] = Y_µm BE16, val[2] = Y_µm × 1.5
// BE16, X_µm BE32 (× 2).

export interface O6BlockInput {
  footByte: number;
  tensionByte: number;
  /** Y dimension in micrometers (drives the displayed height). */
  yUm: number;
  /** X dimension in micrometers — used for val[0] unless val0Um is set. */
  xUm: number;
  /**
   * Override for the BE16 at payload +0x1D (val[0] in FORMAT.md). Semantics
   * unknown but firmware-read — width turns red on the machine when it
   * disagrees with the displayed X. Default = X_µm. the singleton template sets 6000 explicitly
   * for byte-equal round-trip.
   */
  val0Um?: number;
}

function encodeO6BlockOver(template: Uint8Array, input: O6BlockInput, cls: ChunkClass): Uint8Array {
  const out = new Uint8Array(template);
  const val0 = input.val0Um ?? input.xUm;
  const val1 = input.yUm;
  const val2 = Math.round(input.yUm * 1.5);
  if (val0 > BE16_MAX || val1 > BE16_MAX || val2 > BE16_MAX) {
    throw new Error(
      `0x06 chunk dimension exceeds BE16 range (max ${BE16_MAX} µm = ${BE16_MAX / 1000} mm). xUm=${input.xUm}, yUm=${input.yUm}, val0=${val0}, val2=${val2}`,
    );
  }
  for (let slot = 0; slot < 9; slot++) {
    write06Foot(out, cls, slot, input.footByte);
    write06Tension(out, cls, slot, input.tensionByte);
    write06Val0Be16(out, cls, slot, val0);
    write06Val1Be16(out, cls, slot, val1);
    write06Val2Be16(out, cls, slot, val2);
    write06Val0Be32(out, cls, slot, val0);
    write06XumA(out, cls, slot, input.xUm);
    write06XumB(out, cls, slot, input.xUm);
  }
  return out;
}

export function encode06Block(input: O6BlockInput): Uint8Array {
  return encodeO6BlockOver(SINGLETON_O6_BLOCK_TEMPLATE, input, 'singleton');
}

export function encode06BlockMulti(input: O6BlockInput): Uint8Array {
  return encodeO6BlockOver(MULTI_O6_BLOCK_TEMPLATE, input, 'multi');
}

// ---------------------------------------------------------------------------
// Outer envelopes — file header, metadata table, multi-element preamble,
// per-element header, interstitial padding.

// 156-byte metadata-table chunk: design-independent across all 5 samples.
export function encodeMetadataTable(): Uint8Array {
  return new Uint8Array(METADATA_TABLE_CHUNK);
}

const MAGIC = [0x25, 0x73, 0x70, 0x78, 0x25] as const; // "%spx%"
const VERSION = [0x01, 0x02, 0x01] as const;

// Default producer string emitted by sh7pad. Verified on machine 2026-05-15:
// the firmware honours the BE16 length at file offset 0x0C and otherwise
// ignores the contents, so any UTF-16BE payload of any length is accepted.
export const SH7PAD_PRODUCER_STRING = 'sh7pad';

// Fixed portion of the header: magic (5) + version (3) + BE32 fileSize-12 (4)
// + BE16 producer-string byte length (2) = 14 bytes. The UTF-16BE producer
// string follows immediately and is variable-length.
const HEADER_FIXED_BYTES = 14;

export function headerByteLengthFor(producerString: string): number {
  return HEADER_FIXED_BYTES + producerString.length * 2;
}

// File header: magic + version + (fileSize-12 BE32) + producer-length BE16 +
// producer UTF-16BE. Total = headerByteLengthFor(producerString) bytes.
export function encodeHeader(fileSize: number, producerString: string): Uint8Array {
  const producerByteLength = producerString.length * 2;
  const out = new Uint8Array(HEADER_FIXED_BYTES + producerByteLength);
  out.set(MAGIC, 0);
  out.set(VERSION, 5);
  writeBE32(out, 0x08, fileSize - 12);
  writeBE16(out, 0x0c, producerByteLength);
  writeUtf16BE(out, 0x0e, producerString);
  return out;
}

// Multi-element geometry wrapper. The 6-byte preamble is
// [BE32 design_x_offset_µm signed][BE16 sub_chunk_count]. The BE16 count
// must equal the actual number of `02 01 01` / `02 03 01` sub-chunks the
// wrapper contains; declared != actual triggers the firmware's
// "Not supported SDC" crash (verified across the observed NN=5 sample files).
// The BE32 prefix is `0` for designs whose chain origin coincides with
// design.minX (the dominant case: some observed sample files use 0).
export function encodeMultiPreamble(subChunkCount: number, designXOffsetUm = 0): Uint8Array {
  const out = new Uint8Array(6);
  writeBE32(out, 0, designXOffsetUm < 0 ? designXOffsetUm + 0x100000000 : designXOffsetUm);
  writeBE16(out, 4, subChunkCount);
  return out;
}

export function encodePerElementHeader(xElem: number, yPos: number): Uint8Array {
  const out = new Uint8Array(20);
  writeBE32(out, 0, 125);
  writeBE32(out, 4, 125);
  writeBE32(out, 8, 1000);
  writeBE32(out, 12, xElem);
  writeBE32(out, 16, yPos);
  return out;
}

export function encodeInterstitial(trailing: readonly [number, number]): Uint8Array {
  const out = new Uint8Array(20);
  writeBE32(out, 0, 1);
  writeBE32(out, 4, 1);
  writeBE32(out, 8, 1);
  writeBE32(out, 12, trailing[0]);
  writeBE32(out, 16, trailing[1]);
  return out;
}

// ---------------------------------------------------------------------------
// Small utility — concatenates Uint8Arrays into a single buffer.

export function concat(buffers: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const b of buffers) total += b.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const b of buffers) {
    out.set(b, offset);
    offset += b.length;
  }
  return out;
}
