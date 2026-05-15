import { describe, expect, it } from 'vitest';
import {
  decodeJumpRecord,
  decodeShortRecord,
  encodeJumpRecord,
  encodeShortRecord,
  isJumpAt,
  JUMP_PREFIX,
  JUMP_RECORD_LEN,
  JUMP_SUFFIX,
  SHORT_RECORD_LEN,
  walkRecords,
} from '../../format/recordCodec.js';

describe('encodeShortRecord', () => {
  it('emits [dx, dy] as unsigned int8 bytes', () => {
    expect(Array.from(encodeShortRecord({ dx: 5, dy: 3 }))).toEqual([5, 3]);
    expect(Array.from(encodeShortRecord({ dx: -5, dy: -2 }))).toEqual([0xfb, 0xfe]);
  });

  it('rejects dx = -128 because byte 0x80 collides with the long-jump prefix', () => {
    expect(() => encodeShortRecord({ dx: -128, dy: 0 })).toThrow(/-128/);
  });

  it('rejects dx or dy outside the int8 range', () => {
    expect(() => encodeShortRecord({ dx: 128, dy: 0 })).toThrow();
    expect(() => encodeShortRecord({ dx: 0, dy: 200 })).toThrow();
  });
});

describe('encodeJumpRecord', () => {
  it('emits the 7-byte 80 23 .. 80 03 envelope with dxHi rounding away from zero', () => {
    // dx = 18 → dxHi = ceil(18/8) = 3; dxLow = 18 - 24 = -6
    const bytes = Array.from(encodeJumpRecord({ dx: 18, dy: 11 }));
    expect(bytes[0]).toBe(JUMP_PREFIX[0]);
    expect(bytes[1]).toBe(JUMP_PREFIX[1]);
    expect(bytes[2]).toBe(0xfa); // dxLow = -6
    expect(bytes[3]).toBe(11); // dy
    expect(bytes[4]).toBe(3); // dxHi
    expect(bytes[5]).toBe(JUMP_SUFFIX[0]);
    expect(bytes[6]).toBe(JUMP_SUFFIX[1]);
  });

  it('encodes dx = 0 as dxHi = 0, dxLow = 0', () => {
    const bytes = Array.from(encodeJumpRecord({ dx: 0, dy: 0 }));
    expect(bytes[2]).toBe(0); // dxLow
    expect(bytes[4]).toBe(0); // dxHi
  });

  it('encodes negative dx with dxHi negative', () => {
    // dx = -9 → dxHi = -ceil(9/8) = -2; dxLow = -9 - (-16) = 7
    const bytes = Array.from(encodeJumpRecord({ dx: -9, dy: -1 }));
    expect(bytes[2]).toBe(7); // dxLow
    expect(bytes[3]).toBe(0xff); // dy = -1
    expect(bytes[4]).toBe(0xfe); // dxHi = -2
  });

  it('rejects dy outside the int8 range', () => {
    expect(() => encodeJumpRecord({ dx: 0, dy: 200 })).toThrow(/dy/);
  });

  it('rejects dx that overflows the 16-bit dxHi*8 + dxLow envelope', () => {
    // dx that requires |dxHi| > 127. dxHi = ceil(2000/8) = 250 → out of int8.
    expect(() => encodeJumpRecord({ dx: 2000, dy: 0 })).toThrow(/dx/);
  });
});

describe('decodeJumpRecord / isJumpAt', () => {
  it('matches a complete jump envelope', () => {
    const buf = new Uint8Array([0x80, 0x23, 0x0a, 0x0b, 0x01, 0x80, 0x03]);
    expect(isJumpAt(buf, 0)).toBe(true);
    const decoded = decodeJumpRecord(buf, 0);
    expect(decoded).toEqual({ kind: 'jump', dx: 18, dy: 11, flag: 0x01 });
  });

  it('returns null when the envelope suffix is missing', () => {
    const buf = new Uint8Array([0x80, 0x23, 0x0a, 0x0b, 0x01, 0x00, 0x00]);
    expect(isJumpAt(buf, 0)).toBe(false);
    expect(decodeJumpRecord(buf, 0)).toBeNull();
  });

  it('flag preserves the unsigned dxHi byte (0xff for dxHi = -1)', () => {
    const buf = new Uint8Array([0x80, 0x23, 0xff, 0xff, 0xff, 0x80, 0x03]);
    const decoded = decodeJumpRecord(buf, 0)!;
    expect(decoded.flag).toBe(0xff);
    expect(decoded.dx).toBe(-9);
    expect(decoded.dy).toBe(-1);
  });
});

describe('decodeShortRecord', () => {
  it('reads two signed int8 bytes', () => {
    const buf = new Uint8Array([0x05, 0x03, 0xfb, 0xfe]);
    expect(decodeShortRecord(buf, 0)).toEqual({ kind: 'short', dx: 5, dy: 3 });
    expect(decodeShortRecord(buf, 2)).toEqual({ kind: 'short', dx: -5, dy: -2 });
  });
});

describe('walkRecords', () => {
  it('yields one record per stitch in payload order with offsets and lengths', () => {
    const payload = new Uint8Array([
      0x05, 0x03, // short
      0x80, 0x23, 0x0a, 0x0b, 0x01, 0x80, 0x03, // jump
      0xfb, 0xfe, // short
    ]);
    const records = Array.from(walkRecords(payload));
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({
      kind: 'short', dx: 5, dy: 3, recordOffset: 0, recordLength: SHORT_RECORD_LEN,
    });
    expect(records[1]).toMatchObject({
      kind: 'jump', dx: 18, dy: 11, flag: 0x01,
      recordOffset: 2, recordLength: JUMP_RECORD_LEN,
    });
    expect(records[2]).toMatchObject({
      kind: 'short', dx: -5, dy: -2, recordOffset: 9, recordLength: SHORT_RECORD_LEN,
    });
  });

  it('walks consecutive jump records back-to-back', () => {
    const j1 = encodeJumpRecord({ dx: 18, dy: 11 });
    const j2 = encodeJumpRecord({ dx: -16, dy: -2 });
    const payload = new Uint8Array([...j1, ...j2]);
    const records = Array.from(walkRecords(payload));
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      kind: 'jump', dx: 18, dy: 11, recordOffset: 0, recordLength: JUMP_RECORD_LEN,
    });
    expect(records[1]).toMatchObject({
      kind: 'jump', dx: -16, dy: -2, recordOffset: JUMP_RECORD_LEN, recordLength: JUMP_RECORD_LEN,
    });
  });

  it('stops cleanly when a jump record is followed by a single trailing byte', () => {
    // 7-byte jump + 1 dangling byte. The trailing byte alone is not a
    // complete short record (needs 2), so the walker stops after the jump.
    const jump = encodeJumpRecord({ dx: 18, dy: 11 });
    const payload = new Uint8Array([...jump, 0x42]);
    const records = Array.from(walkRecords(payload));
    expect(records).toHaveLength(1);
    expect(records[0]?.kind).toBe('jump');
  });

  it('treats a 0x80 byte without a complete envelope as the start of a short stitch', () => {
    // 0x80 followed by 0x23 but no suffix → not a jump; falls through to short.
    // But the encoder rejects dx=-128 short stitches; this is a parser-side
    // fact only.
    const payload = new Uint8Array([0x80, 0x01, 0x05, 0x03]);
    const records = Array.from(walkRecords(payload));
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ kind: 'short', dx: -128, dy: 1 });
    expect(records[1]).toMatchObject({ kind: 'short', dx: 5, dy: 3 });
  });

  it('round-trips encode → decode for representative (dx, dy) pairs', () => {
    // Sweep a representative grid; the full envelope is large so we sample.
    // dxHi is signed int8, so the envelope is |dx| ≤ 127 * 8 = 1016.
    const dxs = [-1016, -100, -16, -9, -8, -1, 0, 1, 8, 18, 100, 1016];
    const dys = [-127, -50, -1, 0, 1, 50, 127];
    for (const dx of dxs) {
      for (const dy of dys) {
        const isShort = dx >= -127 && dx <= 127 && dy >= -128 && dy <= 127 && dx !== -128;
        if (isShort) {
          const bytes = encodeShortRecord({ dx, dy });
          const decoded = decodeShortRecord(bytes, 0);
          expect(decoded).toEqual({ kind: 'short', dx, dy });
        }
        const jumpBytes = encodeJumpRecord({ dx, dy });
        const decodedJump = decodeJumpRecord(jumpBytes, 0)!;
        expect(decodedJump.dx).toBe(dx);
        expect(decodedJump.dy).toBe(dy);
      }
    }
  });
});
