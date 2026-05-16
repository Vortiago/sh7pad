// Field schema for the .sh7 0x06 (per-slot metadata) and 0x05 (per-slot
// record) chunks. One source of truth for every firmware-read field
// offset, parameterized by chunk class (singleton n=1 vs. multi n=3).
//
// The encoder writes through these accessors (template-and-patch over the
// verbatim singleton + multi-element templates in
// [sh7BinaryExportConstants](../creator/sh7BinaryExportConstants.ts)),
// the parser reads through them, and the validator checks them. The
// schema does NOT replace the templates — most of the chunk's bytes are
// un-decoded round numbers and signatures; the schema names only the
// firmware-read sites and lays them over the templates.
//
// 0x06 offsets are CHUNK-relative (header included) because the encoder
// works over a concatenated nine-chunk block; 0x05 offsets are
// PAYLOAD-relative because 0x05 chunks are emitted one at a time.

import { readBE16, readBE32, writeBE16, writeBE32 } from '../parser/bytes.js';
import { COUNT_BYTE_9 } from './chunkTags.js';

export type ChunkClass = 'singleton' | 'multi';

/** Chunk class encoded in every chunk header's `n` byte (1 or 3). */
export function classToNByte(cls: ChunkClass): 1 | 3 {
  return cls === 'singleton' ? 1 : 3;
}

export function classFromNByte(n: number): ChunkClass | null {
  if (n === 1) return 'singleton';
  if (n === 3) return 'multi';
  return null;
}

/** Slot index whose tension byte carries `tension + TENSION_BUMP`. */
export const TENSION_BUMP_SLOT = 3;
export const TENSION_BUMP = 6;

/** The slot-pattern bytes at the trailing slot-pattern offset: 60,60,60,60,45,30,30,45,45. */
export const SLOT_PATTERN: readonly number[] = [0x3c, 0x3c, 0x3c, 0x3c, 0x2d, 0x1e, 0x1e, 0x2d, 0x2d];

/** Length of the standard chunk header (`tag n ver [BE32 length]`). */
export const CHUNK_HEADER_LEN = 7;

/** One yielded chunk: the byte range, the header fields, and the payload slice. */
export interface WalkedChunk {
  /** Offset of the chunk header's first byte (the tag) within the source buffer. */
  off: number;
  /** Class byte from the header (1=singleton, 3=multi, other for unknown). */
  n: number;
  /** Version byte from the header (expected 0x02 across all observed files). */
  ver: number;
  /** BE32 length field from the header. */
  len: number;
  /** Payload slice (header stripped). */
  payload: Uint8Array;
  /** Full chunk slice including the 7-byte header. */
  chunk: Uint8Array;
}

/**
 * Skip forward past any 0x09 sentinel bytes from `start`. Both the
 * parser and the validator have a stretch of 0x09 bytes between
 * chunk blocks (used as a count marker by the firmware).
 */
export function skipCountSentinels(buf: Uint8Array, start: number): number {
  let i = start;
  while (i < buf.length && buf[i] === COUNT_BYTE_9) i++;
  return i;
}

/**
 * Walk forward yielding one length-prefixed chunk at a time. The walker
 * stops at the first byte that doesn't equal `tag` or when the buffer
 * runs out. It does NOT throw on a malformed chunk header — callers
 * decide whether to throw (parser) or record a validation Result
 * (validator). Each yielded `WalkedChunk` carries the header fields
 * and the payload slice; the parser reads firmware fields off the
 * payload via the schema's accessors.
 */
export function* walkTaggedChunks(
  buf: Uint8Array,
  start: number,
  tag: number,
): Generator<WalkedChunk> {
  let i = start;
  while (i < buf.length - CHUNK_HEADER_LEN && buf[i] === tag) {
    const n = buf[i + 1]!;
    const ver = buf[i + 2]!;
    const len = readBE32(buf, i + 3);
    const payloadStart = i + CHUNK_HEADER_LEN;
    const payloadEnd = payloadStart + len;
    if (payloadEnd > buf.length) break;
    yield {
      off: i,
      n,
      ver,
      len,
      payload: buf.subarray(payloadStart, payloadEnd),
      chunk: buf.subarray(i, payloadEnd),
    };
    i = payloadEnd;
  }
}

// === Field-accessor factories ==============================================
//
// Each named field below is one row: a `kind` (byte width) and a per-class
// offset. The factories turn that row into a `{read, write}` pair that
// knows its own offset arithmetic. Callers see typed named accessors;
// the boilerplate stays in the factory.

type Kind = 'u8' | 'be16' | 'be32';
type ClassOffsets = Record<ChunkClass, number>;

function readAt(kind: Kind, buf: Uint8Array, off: number): number {
  if (kind === 'u8') return buf[off]!;
  if (kind === 'be16') return readBE16(buf, off);
  return readBE32(buf, off);
}

function writeAt(kind: Kind, buf: Uint8Array, off: number, value: number): void {
  if (kind === 'u8') buf[off] = value;
  else if (kind === 'be16') writeBE16(buf, off, value);
  else writeBE32(buf, off, value);
}

// === 0x06 chunks ============================================================

/**
 * Stride between consecutive 0x06 chunks. Singleton chunks are 7-byte
 * header + 111-byte payload = 118 B; multi-element chunks are 7-byte
 * header + 106-byte payload = 113 B. The encoder concatenates 9 of these
 * into a single block and patches per-slot fields by offset.
 */
export const O6_SLOT_STRIDE: Record<ChunkClass, number> = {
  singleton: 118,
  multi: 113,
};

function slotStart(cls: ChunkClass, slot: number): number {
  return slot * O6_SLOT_STRIDE[cls];
}

interface O6Field {
  read(block: Uint8Array, cls: ChunkClass, slot: number): number;
  write(block: Uint8Array, cls: ChunkClass, slot: number, value: number): void;
  offset(cls: ChunkClass): number;
}

function o6Field(kind: Kind, offsets: ClassOffsets): O6Field {
  return {
    read: (block, cls, slot) => readAt(kind, block, slotStart(cls, slot) + offsets[cls]),
    write: (block, cls, slot, value) =>
      writeAt(kind, block, slotStart(cls, slot) + offsets[cls], value),
    offset: (cls) => offsets[cls],
  };
}

// Most 0x06 fields sit at identical chunk-relative offsets across the
// two classes; xUmA / xUmB / slotPattern shift because the multi-element
// payload is 5 bytes shorter at the tail.
const FOOT = o6Field('u8', { singleton: 0x0c, multi: 0x0c });
const TENSION_RAW = o6Field('u8', { singleton: 0x16, multi: 0x16 });
const VAL0_BE16 = o6Field('be16', { singleton: 0x24, multi: 0x24 });
const VAL1_BE16 = o6Field('be16', { singleton: 0x28, multi: 0x28 });
const VAL2_BE16 = o6Field('be16', { singleton: 0x2c, multi: 0x2c });
const VAL0_BE32 = o6Field('be32', { singleton: 0x2f, multi: 0x2f });
const XUM_A = o6Field('be32', { singleton: 0x57, multi: 0x4f });
const XUM_B = o6Field('be32', { singleton: 0x5b, multi: 0x53 });
const O6_SLOT_PATTERN = o6Field('u8', { singleton: 0x74, multi: 0x6f });

const O6_FIELD_INDEX = {
  foot: FOOT,
  tension: TENSION_RAW,
  val0Be16: VAL0_BE16,
  val1Be16: VAL1_BE16,
  val2Be16: VAL2_BE16,
  val0Be32: VAL0_BE32,
  xUmA: XUM_A,
  xUmB: XUM_B,
  slotPattern: O6_SLOT_PATTERN,
} as const;

/** Returns the chunk-relative offset of a 0x06 named field. */
export function o6FieldOffset(cls: ChunkClass, field: keyof typeof O6_FIELD_INDEX): number {
  return O6_FIELD_INDEX[field].offset(cls);
}

/**
 * Payload-relative offset of a 0x06 named field, for validator-style
 * walkers that subarray-strip the header before reading. Equivalent to
 * `o6FieldOffset(cls, field) - CHUNK_HEADER_LEN`.
 */
export function o6PayloadOffset(cls: ChunkClass, field: keyof typeof O6_FIELD_INDEX): number {
  return o6FieldOffset(cls, field) - CHUNK_HEADER_LEN;
}

// --- 0x06 readers ---

export const read06Foot = FOOT.read;
export const read06TensionRaw = TENSION_RAW.read;
export const read06Val0Be16 = VAL0_BE16.read;
export const read06Val1Be16 = VAL1_BE16.read;
export const read06Val2Be16 = VAL2_BE16.read;
export const read06Val0Be32 = VAL0_BE32.read;
export const read06XumA = XUM_A.read;
export const read06XumB = XUM_B.read;

/**
 * Reverse the slot-3 tension bump. The byte stored at the tension offset
 * of slot 3 is `tensionByte + TENSION_BUMP`; every other slot stores the
 * base byte. Callers that read tension from a buffer where the
 * position-in-buffer doesn't match the semantic slot (e.g. the parser,
 * which hands `read06TensionRaw` a single-chunk slice and tracks the
 * slot index itself) compose `read06TensionRaw` with this helper.
 */
export function unbumpTension(raw: number, slot: number): number {
  return slot === TENSION_BUMP_SLOT ? raw - TENSION_BUMP : raw;
}

export function read06Tension(block: Uint8Array, cls: ChunkClass, slot: number): number {
  return unbumpTension(read06TensionRaw(block, cls, slot), slot);
}

// --- 0x06 writers ---

export const write06Foot = FOOT.write;
export const write06Val0Be16 = VAL0_BE16.write;
export const write06Val1Be16 = VAL1_BE16.write;
export const write06Val2Be16 = VAL2_BE16.write;
export const write06Val0Be32 = VAL0_BE32.write;
export const write06XumA = XUM_A.write;
export const write06XumB = XUM_B.write;

/**
 * Writes `tensionByte`, applying the slot-3 +6 bump automatically. Pass
 * the BASE tension byte (the value the user would set in the UI ×10);
 * the schema applies the bump itself so callers can't accidentally
 * double-bump.
 */
export function write06Tension(
  block: Uint8Array,
  cls: ChunkClass,
  slot: number,
  tensionByte: number,
): void {
  TENSION_RAW.write(block, cls, slot, slot === TENSION_BUMP_SLOT ? tensionByte + TENSION_BUMP : tensionByte);
}

// === 0x05 chunks ============================================================
//
// 0x05 chunks are written one at a time (singleton 32-B payload, multi
// 33-B payload), not as a concatenated block. Accessors take a single
// chunk's PAYLOAD; the slot index is only used to reverse the slot-3
// tension bump (no slot stride math).

/** Singleton 0x05 chunk payload size: 32 bytes. */
export const O5_PAYLOAD_LEN_SINGLETON = 32;
/** Multi-element 0x05 chunk payload size: 33 bytes. */
export const O5_PAYLOAD_LEN_MULTI = 33;

export function o5PayloadLen(cls: ChunkClass): number {
  return cls === 'singleton' ? O5_PAYLOAD_LEN_SINGLETON : O5_PAYLOAD_LEN_MULTI;
}

interface O5Field {
  read(payload: Uint8Array, cls: ChunkClass): number;
  write(payload: Uint8Array, cls: ChunkClass, value: number): void;
  offset(cls: ChunkClass): number | null;
}

function o5Field(kind: Kind, offsets: Record<ChunkClass, number | null>): O5Field {
  return {
    read: (payload, cls) => {
      const off = offsets[cls];
      if (off === null) throw new Error(`0x05 field not present in class '${cls}'`);
      return readAt(kind, payload, off);
    },
    write: (payload, cls, value) => {
      const off = offsets[cls];
      if (off === null) throw new Error(`0x05 field not present in class '${cls}'`);
      writeAt(kind, payload, off, value);
    },
    offset: (cls) => offsets[cls],
  };
}

const O5_XELEM = o5Field('be32', { singleton: 0x04, multi: null });
const O5_TENSION_RAW = o5Field('u8', { singleton: 0x10, multi: 0x10 });
const O5_YUM = o5Field('be32', { singleton: 0x11, multi: 0x11 });
const O5_XUM = o5Field('be32', { singleton: 0x15, multi: 0x15 });
const O5_MARKER = o5Field('u8', { singleton: null, multi: 0x1e });
const O5_SLOT_PATTERN_FIELD = o5Field('u8', { singleton: 0x1e, multi: 0x1f });

const O5_FIELD_INDEX = {
  xElem: O5_XELEM,
  tension: O5_TENSION_RAW,
  yUm: O5_YUM,
  xUm: O5_XUM,
  marker: O5_MARKER,
  slotPattern: O5_SLOT_PATTERN_FIELD,
} as const;

/** Payload-relative offset of a 0x05 named field, for validator-style walkers. */
export function o5FieldOffset(
  cls: ChunkClass,
  field: keyof typeof O5_FIELD_INDEX,
): number | null {
  return O5_FIELD_INDEX[field].offset(cls);
}

// --- 0x05 readers ---

export const read05YumBe32 = O5_YUM.read;
export const read05XumBe32 = O5_XUM.read;

export function read05Tension(payload: Uint8Array, cls: ChunkClass, slot: number): number {
  return unbumpTension(O5_TENSION_RAW.read(payload, cls), slot);
}

export function read05SlotPattern(payload: Uint8Array, cls: ChunkClass): number {
  return O5_SLOT_PATTERN_FIELD.read(payload, cls);
}

/**
 * Read the singleton 0x05 chunk's xElem field (BE32 µm). Returns null
 * for multi-element classes since they don't carry an xElem on the 0x05
 * chunk; their per-element offsets live in the geometry wrapper
 * sub-blocks instead. xElem encodes the carriage's initial X position
 * relative to the design's machine origin (firmware places the slot
 * centre at -xElem / 1000 mm).
 */
export function read05XelemBe32(payload: Uint8Array, cls: ChunkClass): number | null {
  return O5_XELEM.offset(cls) === null ? null : O5_XELEM.read(payload, cls);
}

// --- 0x05 writers ---

export const write05YumBe32 = O5_YUM.write;
export const write05XumBe32 = O5_XUM.write;

export function write05Tension(
  payload: Uint8Array,
  cls: ChunkClass,
  slot: number,
  tensionByte: number,
): void {
  O5_TENSION_RAW.write(
    payload,
    cls,
    slot === TENSION_BUMP_SLOT ? tensionByte + TENSION_BUMP : tensionByte,
  );
}

export function write05XelemBe32(payload: Uint8Array, value: number): void {
  // singleton-only.
  O5_XELEM.write(payload, 'singleton', value);
}

export function write05SlotPattern(payload: Uint8Array, cls: ChunkClass, slot: number): void {
  O5_SLOT_PATTERN_FIELD.write(payload, cls, SLOT_PATTERN[slot]!);
}
