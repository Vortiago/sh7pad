// Decode the per-slot 0x06 metadata block and the 0x05 record chunks
// that sit between the file header and the geometry wrapper. Field
// layouts are owned by [chunkSchema](../format/chunkSchema.ts); this
// module is a thin walker that locates the chunk runs and reads the
// firmware-read fields by name.

import { readBE32 } from './bytes.js';
import {
  type ChunkClass,
  classFromNByte,
  o5PayloadLen,
  read05SlotPattern,
  read05Tension,
  read05XelemBe32,
  read05XumBe32,
  read05YumBe32,
  read06Foot,
  read06TensionRaw,
  read06Val0Be16,
  read06Val0Be32,
  read06Val1Be16,
  read06Val2Be16,
  read06XumA,
  read06XumB,
  unbumpTension,
} from '../format/chunkSchema.js';
import { COUNT_BYTE_9, O5_CHUNK_TAG, O6_CHUNK_TAG } from '../format/chunkTags.js';

export interface SlotO6 {
  footByte: number;
  /** Tension byte with the slot-3 +6 bump removed; same scale across slots. */
  tensionByte: number;
  val0Be16: number;
  /** val[1] BE16 — Y dimension in µm. */
  yUm: number;
  /** val[2] BE16 — Y_µm × 1.5 mirror. */
  yUmTimes1p5: number;
  /** BE32 mirror of val[0]. */
  val0Be32: number;
  /** First copy of X dimension in µm. */
  xUmA: number;
  /** Second copy of X dimension in µm. Encoder keeps the two equal. */
  xUmB: number;
  slotPattern: number;
}

export interface SlotO5 {
  /** Tension byte with the slot-3 +6 bump removed. */
  tensionByte: number;
  yUm: number;
  xUm: number;
  slotPattern: number;
  /**
   * Singleton-only: BE32 µm encoding the carriage's initial X position
   * (firmware places the slot centre at `-xElemUm / 1000` mm relative to
   * the design's machine origin). Null for multi-element classes.
   */
  xElemUm: number | null;
}

export interface O6BlockResult {
  cls: ChunkClass;
  /** Offset into the outer buffer where the first 0x06 chunk header begins. */
  blockOffset: number;
  /** Total byte length of the nine 0x06 chunks (including headers). */
  blockLength: number;
  slots: SlotO6[];
}

export interface O5BlockResult {
  cls: ChunkClass;
  /** Offset into the outer buffer where the first 0x05 chunk header begins. */
  blockOffset: number;
  blockLength: number;
  slots: SlotO5[];
}

const CHUNK_HEADER_LEN = 7;

/**
 * Walk forward from `start`, skipping leading 0x09 sentinel bytes, then
 * read 9 consecutive 0x06 chunks. Returns the parsed slot fields plus
 * the offset/length of the chunk run so the caller knows where to
 * continue scanning (the 0x05 block, then the geometry wrapper).
 *
 * Chunk lengths can vary per file (the encoder always emits the singleton + multi-element templates
 * shapes, but older files across observed samples have shorter payloads), so the
 * walker reads each chunk's BE32 length individually rather than
 * assuming the encoder's uniform slot stride. The schema's read
 * accessors operate on a single chunk's bytes by passing slot=0; the
 * chunk-relative offsets they use don't depend on the payload length
 * because every named field sits in the chunk's prefix.
 */
export function parseO6Block(buf: Uint8Array, start: number): O6BlockResult {
  let i = skipCountSentinels(buf, start);
  if (buf[i] !== O6_CHUNK_TAG) {
    throw new Error(`parseO6Block: expected 0x06 tag at 0x${i.toString(16)}, got 0x${(buf[i] ?? 0).toString(16)}`);
  }
  const cls = classFromNByte(buf[i + 1] ?? 0);
  if (cls === null) {
    throw new Error(`parseO6Block: unsupported class byte 0x${(buf[i + 1] ?? 0).toString(16)} at 0x${(i + 1).toString(16)}`);
  }
  const blockOffset = i;
  const slots: SlotO6[] = [];
  let cursor = i;
  for (let s = 0; s < 9; s++) {
    if (buf[cursor] !== O6_CHUNK_TAG) {
      throw new Error(`parseO6Block: slot ${s} missing 0x06 tag at 0x${cursor.toString(16)}`);
    }
    const len = readBE32(buf, cursor + 3);
    const chunkLen = CHUNK_HEADER_LEN + len;
    const chunk = buf.subarray(cursor, cursor + chunkLen);
    // The schema's `read06Tension` reverses the slot-3 bump using the
    // same slot arg it uses for the stride math. Here the buffer is
    // a single-chunk slice (slot-in-buffer is always 0), so we split
    // the read: pull the raw byte at chunk-relative offset, then
    // unbump for the actual semantic slot `s`.
    slots.push({
      footByte: read06Foot(chunk, cls, 0),
      tensionByte: unbumpTension(read06TensionRaw(chunk, cls, 0), s),
      val0Be16: read06Val0Be16(chunk, cls, 0),
      yUm: read06Val1Be16(chunk, cls, 0),
      yUmTimes1p5: read06Val2Be16(chunk, cls, 0),
      val0Be32: read06Val0Be32(chunk, cls, 0),
      xUmA: read06XumA(chunk, cls, 0),
      xUmB: read06XumB(chunk, cls, 0),
      // Slot pattern sits at payload length - 2 across every shape we
      // see (encoder uses payload +0x6D singleton / +0x68 multi; older
      // observed sample files have shorter payloads but still pen-ultimate byte).
      // [validateSh7Bytes](./validateSh7Bytes.ts) has used the same
      // tail-relative read.
      slotPattern: chunk[chunkLen - 2]!,
    });
    cursor += chunkLen;
  }
  return { cls, blockOffset, blockLength: cursor - blockOffset, slots };
}

/**
 * Walk nine 0x05 chunks starting at `start` (skipping leading 0x09
 * sentinels). Each 0x05 chunk is independent (singleton 32 B payload,
 * multi 33 B); we read each chunk's class from its `n` byte to support
 * mixed buffers in tests.
 */
export function parseO5Block(buf: Uint8Array, start: number): O5BlockResult {
  let i = skipCountSentinels(buf, start);
  if (buf[i] !== O5_CHUNK_TAG) {
    throw new Error(`parseO5Block: expected 0x05 tag at 0x${i.toString(16)}, got 0x${(buf[i] ?? 0).toString(16)}`);
  }
  const cls = classFromNByte(buf[i + 1] ?? 0);
  if (cls === null) {
    throw new Error(`parseO5Block: unsupported class byte 0x${(buf[i + 1] ?? 0).toString(16)} at 0x${(i + 1).toString(16)}`);
  }
  const blockOffset = i;
  const slots: SlotO5[] = [];
  let cursor = i;
  for (let s = 0; s < 9; s++) {
    if (buf[cursor] !== O5_CHUNK_TAG) {
      throw new Error(`parseO5Block: slot ${s} missing 0x05 tag at 0x${cursor.toString(16)}`);
    }
    const len = readBE32(buf, cursor + 3);
    const expectedLen = o5PayloadLen(cls);
    if (len !== expectedLen) {
      throw new Error(`parseO5Block: slot ${s} payload length ${len} != expected ${expectedLen}`);
    }
    const payload = buf.subarray(cursor + CHUNK_HEADER_LEN, cursor + CHUNK_HEADER_LEN + len);
    slots.push({
      tensionByte: read05Tension(payload, cls, s),
      yUm: read05YumBe32(payload, cls),
      xUm: read05XumBe32(payload, cls),
      slotPattern: read05SlotPattern(payload, cls),
      xElemUm: read05XelemBe32(payload, cls),
    });
    cursor += CHUNK_HEADER_LEN + len;
  }
  return { cls, blockOffset, blockLength: cursor - blockOffset, slots };
}

function skipCountSentinels(buf: Uint8Array, start: number): number {
  let i = start;
  while (i < buf.length && buf[i] === COUNT_BYTE_9) i++;
  return i;
}
