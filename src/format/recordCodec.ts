// Record-level codec for the .sh7 stitch chunk (`02 01 01`) payload.
//
// One source of truth for the short / jump record byte layout. Encoder,
// parser, and validator all walk records through this module.
//
//   Short record (2 bytes):  [dx int8] [dy int8]
//   Long-jump record (7 bytes): 80 23 [dxLow int8] [dy int8] [dxHi int8] 80 03
//                               with dx = dxLow + dxHi * X_UNITS_PER_MM
//
// dxHi acts as a "millimetre extension" of dx. The encoder rounds away
// from zero (`dxHi = sign(dx) * ceil(|dx|/8)`) so dxLow corrects the
// remainder; this matches the convention observed in the foot-B reference design and
// across the observed sample files.
//
// Short records with dx = -128 are forbidden: the byte 0x80 collides with
// the long-jump prefix and the parser would mis-dispatch.

import { toUnsignedI8, readSI8 } from '../parser/bytes.js';
import { X_UNITS_PER_MM } from '../parser/units.js';

export const JUMP_PREFIX = [0x80, 0x23] as const;
export const JUMP_SUFFIX = [0x80, 0x03] as const;
export const JUMP_RECORD_LEN = 7;
export const SHORT_RECORD_LEN = 2;

export interface ShortFields {
  dx: number;
  dy: number;
}

export interface JumpFields {
  dx: number;
  dy: number;
}

export function encodeShortRecord(fields: ShortFields): Uint8Array {
  if (!isInt8(fields.dx) || !isInt8(fields.dy)) {
    throw new Error(`Short record delta out of range: dx=${fields.dx}, dy=${fields.dy}`);
  }
  if (fields.dx === -128) {
    throw new Error('Short record dx = -128 collides with long-jump prefix 0x80');
  }
  return new Uint8Array([toUnsignedI8(fields.dx), toUnsignedI8(fields.dy)]);
}

export function encodeJumpRecord(fields: JumpFields): Uint8Array {
  const { dx, dy } = fields;
  if (!isInt8(dy)) {
    throw new Error(`Jump dy out of range: dy=${dy}`);
  }
  // Round away from zero so dxLow stays close to the remainder. This is
  // the convention observed in the foot-B reference design and the observed sample files.
  const dxHi = dx === 0 ? 0 : Math.sign(dx) * Math.ceil(Math.abs(dx) / X_UNITS_PER_MM);
  const dxLow = dx - dxHi * X_UNITS_PER_MM;
  if (!isInt8(dxHi) || !isInt8(dxLow)) {
    throw new Error(`Jump dx out of range: dx=${dx} (dxHi=${dxHi}, dxLow=${dxLow})`);
  }
  return new Uint8Array([
    JUMP_PREFIX[0],
    JUMP_PREFIX[1],
    toUnsignedI8(dxLow),
    toUnsignedI8(dy),
    toUnsignedI8(dxHi),
    JUMP_SUFFIX[0],
    JUMP_SUFFIX[1],
  ]);
}

export function isJumpAt(buf: Uint8Array, i: number): boolean {
  return (
    i + JUMP_RECORD_LEN <= buf.length &&
    buf[i] === JUMP_PREFIX[0] &&
    buf[i + 1] === JUMP_PREFIX[1] &&
    buf[i + 5] === JUMP_SUFFIX[0] &&
    buf[i + 6] === JUMP_SUFFIX[1]
  );
}

export interface DecodedJump {
  kind: 'jump';
  dx: number;
  dy: number;
  /** Raw unsigned dxHi byte, preserved for byte-level inspection. */
  flag: number;
}

export interface DecodedShort {
  kind: 'short';
  dx: number;
  dy: number;
}

export type DecodedRecord = DecodedShort | DecodedJump;

export function decodeJumpRecord(buf: Uint8Array, i: number): DecodedJump | null {
  if (!isJumpAt(buf, i)) return null;
  const dxLow = readSI8(buf, i + 2);
  const dy = readSI8(buf, i + 3);
  const dxHi = readSI8(buf, i + 4);
  return {
    kind: 'jump',
    dx: dxLow + dxHi * X_UNITS_PER_MM,
    dy,
    flag: buf[i + 4]!,
  };
}

export function decodeShortRecord(buf: Uint8Array, i: number): DecodedShort {
  return { kind: 'short', dx: readSI8(buf, i), dy: readSI8(buf, i + 1) };
}

/**
 * One record as the walker yields it: the decoded fields plus the
 * record's offset within the payload and its byte length. Callers add
 * domain-specific decoration (elementIndex, absolute byte offsets, etc.).
 */
export type WalkedRecord = DecodedRecord & {
  recordOffset: number;
  recordLength: number;
};

/**
 * Walk a stitch-chunk payload, yielding one decoded record at a time.
 * `0x80` introduces a long-jump record only when followed by the full
 * `80 23 .. 80 03` envelope; otherwise the byte is the int8 dx of a
 * short record (which would be -128 and rejected by the encoder).
 *
 * Walking stops at the first byte that doesn't fit a complete record
 * (a trailing 0x80 with no envelope, or a single dangling byte).
 */
export function* walkRecords(payload: Uint8Array): Generator<WalkedRecord> {
  let i = 0;
  while (i + 1 < payload.length) {
    if (isJumpAt(payload, i)) {
      const jump = decodeJumpRecord(payload, i)!;
      yield { ...jump, recordOffset: i, recordLength: JUMP_RECORD_LEN };
      i += JUMP_RECORD_LEN;
      continue;
    }
    yield {
      ...decodeShortRecord(payload, i),
      recordOffset: i,
      recordLength: SHORT_RECORD_LEN,
    };
    i += SHORT_RECORD_LEN;
  }
}

function isInt8(v: number): boolean {
  return Number.isInteger(v) && v >= -128 && v <= 127;
}
