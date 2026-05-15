// Field schema for the .sh7 0x06 (per-slot metadata) and 0x05 (per-slot
// record) chunks. One source of truth for every firmware-read field
// offset, parameterized by chunk class (singleton n=1 vs. multi n=3).
//
// The encoder writes through these accessors (template-and-patch over the
// verbatim the singleton + multi-element templates byte arrays in
// [sh7BinaryExportConstants](../creator/sh7BinaryExportConstants.ts)),
// the parser reads through them, and the validator checks them. The
// schema does NOT replace the templates — most of the chunk's bytes are
// un-decoded round numbers and signatures; the schema names only the
// firmware-read sites and lays them over the templates.
//
// All offsets are PAYLOAD-relative. Slot strides differ between classes;
// per-field offsets within a slot's payload are mostly identical, with a
// handful of class-specific exceptions documented inline.

import { readBE16, readBE32, writeBE16, writeBE32 } from '../parser/bytes.js';

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

/**
 * Offset within a single 0x06 chunk's RAW chunk bytes (header included)
 * to each named field. Most are payload-relative + 7 (the header length);
 * we keep them chunk-relative because the encoder works over a
 * concatenated block of chunks rather than individual payloads.
 */
const O6_CHUNK_OFFSETS: Record<ChunkClass, {
  foot: number;
  tension: number;
  val0Be16: number;
  val1Be16: number;  // Y_µm
  val2Be16: number;  // Y_µm × 1.5
  val0Be32: number;  // mirror of val0Be16
  xUmA: number;
  xUmB: number;
  slotPattern: number;
}> = {
  singleton: {
    foot: 0x0c,         // payload +0x05
    tension: 0x16,      // payload +0x0F
    val0Be16: 0x24,     // payload +0x1D
    val1Be16: 0x28,     // payload +0x21
    val2Be16: 0x2c,     // payload +0x25
    val0Be32: 0x2f,     // payload +0x28
    xUmA: 0x57,         // payload +0x50
    xUmB: 0x5b,         // payload +0x54
    slotPattern: 0x74,  // payload +0x6D
  },
  multi: {
    foot: 0x0c,
    tension: 0x16,
    val0Be16: 0x24,
    val1Be16: 0x28,
    val2Be16: 0x2c,
    val0Be32: 0x2f,
    xUmA: 0x4f,         // payload +0x48
    xUmB: 0x53,         // payload +0x4C
    slotPattern: 0x6f,  // payload +0x68
  },
};

/** Slot index whose tension byte carries `tension + TENSION_BUMP`. */
export const TENSION_BUMP_SLOT = 3;
export const TENSION_BUMP = 6;

/** The slot-pattern bytes at the trailing slot-pattern offset: 60,60,60,60,45,30,30,45,45. */
export const SLOT_PATTERN: readonly number[] = [0x3c, 0x3c, 0x3c, 0x3c, 0x2d, 0x1e, 0x1e, 0x2d, 0x2d];

function slotStart(cls: ChunkClass, slot: number): number {
  return slot * O6_SLOT_STRIDE[cls];
}

// --- 0x06 readers ---

export function read06Foot(block: Uint8Array, cls: ChunkClass, slot: number): number {
  return block[slotStart(cls, slot) + O6_CHUNK_OFFSETS[cls].foot]!;
}

/**
 * Reverse the slot-3 tension bump. The byte stored at the tension
 * offset of slot 3 is `tensionByte + TENSION_BUMP`; every other slot
 * stores the base byte. Callers that read tension from a buffer where
 * the position-in-buffer doesn't match the semantic slot (e.g. the
 * parser, which hands `read06TensionRaw` a single-chunk slice and
 * tracks the slot index itself) compose `read06TensionRaw` with this
 * helper.
 */
export function unbumpTension(raw: number, slot: number): number {
  return slot === TENSION_BUMP_SLOT ? raw - TENSION_BUMP : raw;
}

/**
 * Read the raw tension byte at `slot`'s offset, WITHOUT reversing the
 * slot-3 bump. Pair with {@link unbumpTension} when the buffer slot and
 * the semantic slot differ. Most callers want {@link read06Tension}.
 */
export function read06TensionRaw(block: Uint8Array, cls: ChunkClass, slot: number): number {
  return block[slotStart(cls, slot) + O6_CHUNK_OFFSETS[cls].tension]!;
}

export function read06Tension(block: Uint8Array, cls: ChunkClass, slot: number): number {
  return unbumpTension(read06TensionRaw(block, cls, slot), slot);
}

export function read06Val0Be16(block: Uint8Array, cls: ChunkClass, slot: number): number {
  return readBE16(block, slotStart(cls, slot) + O6_CHUNK_OFFSETS[cls].val0Be16);
}

export function read06Val1Be16(block: Uint8Array, cls: ChunkClass, slot: number): number {
  return readBE16(block, slotStart(cls, slot) + O6_CHUNK_OFFSETS[cls].val1Be16);
}

export function read06Val2Be16(block: Uint8Array, cls: ChunkClass, slot: number): number {
  return readBE16(block, slotStart(cls, slot) + O6_CHUNK_OFFSETS[cls].val2Be16);
}

export function read06Val0Be32(block: Uint8Array, cls: ChunkClass, slot: number): number {
  return readBE32(block, slotStart(cls, slot) + O6_CHUNK_OFFSETS[cls].val0Be32);
}

export function read06XumA(block: Uint8Array, cls: ChunkClass, slot: number): number {
  return readBE32(block, slotStart(cls, slot) + O6_CHUNK_OFFSETS[cls].xUmA);
}

export function read06XumB(block: Uint8Array, cls: ChunkClass, slot: number): number {
  return readBE32(block, slotStart(cls, slot) + O6_CHUNK_OFFSETS[cls].xUmB);
}

// --- 0x06 writers ---

export function write06Foot(block: Uint8Array, cls: ChunkClass, slot: number, byte: number): void {
  block[slotStart(cls, slot) + O6_CHUNK_OFFSETS[cls].foot] = byte;
}

/**
 * Writes `tensionByte`, applying the slot-3 +6 bump automatically. Pass
 * the BASE tension byte (the value the user would set in the UI ×10);
 * the schema applies the bump itself so callers can't accidentally
 * double-bump.
 */
export function write06Tension(block: Uint8Array, cls: ChunkClass, slot: number, tensionByte: number): void {
  const stored = slot === TENSION_BUMP_SLOT ? tensionByte + TENSION_BUMP : tensionByte;
  block[slotStart(cls, slot) + O6_CHUNK_OFFSETS[cls].tension] = stored;
}

export function write06Val0Be16(block: Uint8Array, cls: ChunkClass, slot: number, value: number): void {
  writeBE16(block, slotStart(cls, slot) + O6_CHUNK_OFFSETS[cls].val0Be16, value);
}

export function write06Val1Be16(block: Uint8Array, cls: ChunkClass, slot: number, value: number): void {
  writeBE16(block, slotStart(cls, slot) + O6_CHUNK_OFFSETS[cls].val1Be16, value);
}

export function write06Val2Be16(block: Uint8Array, cls: ChunkClass, slot: number, value: number): void {
  writeBE16(block, slotStart(cls, slot) + O6_CHUNK_OFFSETS[cls].val2Be16, value);
}

export function write06Val0Be32(block: Uint8Array, cls: ChunkClass, slot: number, value: number): void {
  writeBE32(block, slotStart(cls, slot) + O6_CHUNK_OFFSETS[cls].val0Be32, value);
}

export function write06XumA(block: Uint8Array, cls: ChunkClass, slot: number, value: number): void {
  writeBE32(block, slotStart(cls, slot) + O6_CHUNK_OFFSETS[cls].xUmA, value);
}

export function write06XumB(block: Uint8Array, cls: ChunkClass, slot: number, value: number): void {
  writeBE32(block, slotStart(cls, slot) + O6_CHUNK_OFFSETS[cls].xUmB, value);
}

// === 0x05 chunks ============================================================

/**
 * 0x05 chunks are written one at a time (singleton 32-B payload, multi
 * 33-B payload), not as a concatenated block — the encoder builds nine
 * chunks individually. Offsets here are PAYLOAD-relative.
 */
const O5_PAYLOAD_OFFSETS: Record<ChunkClass, {
  xElem: number | null;  // singleton only
  tension: number;
  yUm: number;
  xUm: number;
  marker: number | null;  // multi only (always 0x02)
  slotPattern: number;
}> = {
  singleton: {
    xElem: 0x04,
    tension: 0x10,
    yUm: 0x11,
    xUm: 0x15,
    marker: null,
    slotPattern: 0x1e,
  },
  multi: {
    xElem: null,
    tension: 0x10,
    yUm: 0x11,
    xUm: 0x15,
    marker: 0x1e,  // always 0x02
    slotPattern: 0x1f,
  },
};

/** Singleton 0x05 chunk payload size: 32 bytes. */
export const O5_PAYLOAD_LEN_SINGLETON = 32;

/** Multi-element 0x05 chunk payload size: 33 bytes. */
export const O5_PAYLOAD_LEN_MULTI = 33;

export function o5PayloadLen(cls: ChunkClass): number {
  return cls === 'singleton' ? O5_PAYLOAD_LEN_SINGLETON : O5_PAYLOAD_LEN_MULTI;
}

// --- 0x05 readers (payload-relative; pass the chunk PAYLOAD, not the chunk envelope) ---

export function read05Tension(payload: Uint8Array, cls: ChunkClass, slot: number): number {
  const raw = payload[O5_PAYLOAD_OFFSETS[cls].tension]!;
  return slot === TENSION_BUMP_SLOT ? raw - TENSION_BUMP : raw;
}

export function read05YumBe32(payload: Uint8Array, cls: ChunkClass): number {
  return readBE32(payload, O5_PAYLOAD_OFFSETS[cls].yUm);
}

export function read05XumBe32(payload: Uint8Array, cls: ChunkClass): number {
  return readBE32(payload, O5_PAYLOAD_OFFSETS[cls].xUm);
}

export function read05SlotPattern(payload: Uint8Array, cls: ChunkClass): number {
  return payload[O5_PAYLOAD_OFFSETS[cls].slotPattern]!;
}

/**
 * Read the singleton 0x05 chunk's xElem field (BE32 µm). Returns null
 * for multi-element classes since they don't carry an xElem on the
 * 0x05 chunk; their per-element offsets live in the geometry wrapper
 * sub-blocks instead. xElem encodes the carriage's initial X position
 * relative to the design's machine origin (firmware places the slot
 * centre at -xElem / 1000 mm).
 */
export function read05XelemBe32(payload: Uint8Array, cls: ChunkClass): number | null {
  const off = O5_PAYLOAD_OFFSETS[cls].xElem;
  if (off == null) return null;
  return readBE32(payload, off);
}

// --- 0x05 writers ---

export function write05Tension(payload: Uint8Array, cls: ChunkClass, slot: number, tensionByte: number): void {
  const stored = slot === TENSION_BUMP_SLOT ? tensionByte + TENSION_BUMP : tensionByte;
  payload[O5_PAYLOAD_OFFSETS[cls].tension] = stored;
}

export function write05YumBe32(payload: Uint8Array, cls: ChunkClass, value: number): void {
  writeBE32(payload, O5_PAYLOAD_OFFSETS[cls].yUm, value);
}

export function write05XumBe32(payload: Uint8Array, cls: ChunkClass, value: number): void {
  writeBE32(payload, O5_PAYLOAD_OFFSETS[cls].xUm, value);
}

export function write05XelemBe32(payload: Uint8Array, value: number): void {
  // singleton-only.
  writeBE32(payload, O5_PAYLOAD_OFFSETS.singleton.xElem!, value);
}

export function write05SlotPattern(payload: Uint8Array, cls: ChunkClass, slot: number): void {
  payload[O5_PAYLOAD_OFFSETS[cls].slotPattern] = SLOT_PATTERN[slot]!;
}

/**
 * Returns the chunk-relative offset of a 0x06 named field, for callers
 * that need to walk an outer buffer (e.g. validateSh7Bytes). Most
 * callers should use the read/write helpers above instead.
 */
export function o6FieldOffset(cls: ChunkClass, field: keyof typeof O6_CHUNK_OFFSETS['singleton']): number {
  return O6_CHUNK_OFFSETS[cls][field];
}

/**
 * Returns the payload-relative offset of a 0x05 named field, for
 * validator-style walkers.
 */
export function o5FieldOffset(cls: ChunkClass, field: keyof typeof O5_PAYLOAD_OFFSETS['singleton']): number | null {
  return O5_PAYLOAD_OFFSETS[cls][field];
}

/** Length of the standard chunk header (`tag n ver [BE32 length]`). */
export const CHUNK_HEADER_LEN = 7;

/**
 * Payload-relative offset of a 0x06 named field, for validator-style
 * walkers that subarray-strip the header before reading. Equivalent to
 * `o6FieldOffset(cls, field) - CHUNK_HEADER_LEN`.
 */
export function o6PayloadOffset(
  cls: ChunkClass,
  field: keyof typeof O6_CHUNK_OFFSETS['singleton'],
): number {
  return O6_CHUNK_OFFSETS[cls][field] - CHUNK_HEADER_LEN;
}
