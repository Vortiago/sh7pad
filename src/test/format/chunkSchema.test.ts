import { describe, expect, it } from 'vitest';
import {
  O6_SLOT_STRIDE,
  o6FieldOffset,
  read05SlotPattern,
  read05Tension,
  read05XumBe32,
  read05YumBe32,
  read06Foot,
  read06Tension,
  read06TensionRaw,
  read06Val0Be16,
  read06Val0Be32,
  read06Val1Be16,
  read06Val2Be16,
  read06XumA,
  read06XumB,
  SLOT_PATTERN,
  TENSION_BUMP,
  TENSION_BUMP_SLOT,
  classFromNByte,
  o5PayloadLen,
  unbumpTension,
  write05SlotPattern,
  write05Tension,
  write05XelemBe32,
  write05XumBe32,
  write05YumBe32,
  write06Foot,
  write06Tension,
  write06Val0Be16,
} from '../../format/chunkSchema.js';
import {
  MULTI_O6_BLOCK_TEMPLATE,
  SINGLETON_O6_BLOCK_TEMPLATE,
} from '../../creator/sh7BinaryExportConstants.js';

describe('classFromNByte', () => {
  it('maps 1 → singleton, 3 → multi, others → null', () => {
    expect(classFromNByte(1)).toBe('singleton');
    expect(classFromNByte(3)).toBe('multi');
    expect(classFromNByte(2)).toBeNull();
  });
});

describe('chunkSchema reads against the verbatim singleton template (singleton)', () => {
  it('block size matches 9 × singleton stride', () => {
    expect(SINGLETON_O6_BLOCK_TEMPLATE.length).toBe(9 * O6_SLOT_STRIDE.singleton);
  });

  it('foot byte is 0x02 (Foot B) in every slot', () => {
    for (let slot = 0; slot < 9; slot++) {
      expect(read06Foot(SINGLETON_O6_BLOCK_TEMPLATE, 'singleton', slot)).toBe(0x02);
    }
  });

  it('tension reads the BASE byte, with slot 3 reversing the +6 bump', () => {
    // the singleton template's slot-0 tension byte at chunk +0x16 is 0x28 (= 4.0 × 10).
    expect(read06Tension(SINGLETON_O6_BLOCK_TEMPLATE, 'singleton', 0)).toBe(0x28);
    // Slot 3 stores 0x2e but the schema returns the unbumped 0x28.
    expect(read06Tension(SINGLETON_O6_BLOCK_TEMPLATE, 'singleton', 3)).toBe(0x28);
    // Sanity: the raw byte at slot 3's tension offset really is bumped.
    const slot3Off = 3 * O6_SLOT_STRIDE.singleton + o6FieldOffset('singleton', 'tension');
    expect(SINGLETON_O6_BLOCK_TEMPLATE[slot3Off]).toBe(0x28 + TENSION_BUMP);
    expect(TENSION_BUMP_SLOT).toBe(3);
  });

  it('slot-pattern sequence reads back as 60,60,60,60,45,30,30,45,45', () => {
    const slotPatternOff = o6FieldOffset('singleton', 'slotPattern');
    const actual = Array.from({ length: 9 }, (_, slot) =>
      SINGLETON_O6_BLOCK_TEMPLATE[slot * O6_SLOT_STRIDE.singleton + slotPatternOff]!,
    );
    expect(actual).toEqual([...SLOT_PATTERN]);
  });

  it('val[1] BE16 is the Y dimension in µm (singleton template: 8000 µm = 8 mm)', () => {
    for (let slot = 0; slot < 9; slot++) {
      expect(read06Val1Be16(SINGLETON_O6_BLOCK_TEMPLATE, 'singleton', slot)).toBe(8000);
    }
  });

  it('val[2] BE16 is val[1] × 1.5 (singleton template: 12000)', () => {
    for (let slot = 0; slot < 9; slot++) {
      expect(read06Val2Be16(SINGLETON_O6_BLOCK_TEMPLATE, 'singleton', slot)).toBe(12000);
    }
  });

  it('val[0] BE16 (6000) and BE32 mirror agree across slots', () => {
    for (let slot = 0; slot < 9; slot++) {
      const be16 = read06Val0Be16(SINGLETON_O6_BLOCK_TEMPLATE, 'singleton', slot);
      const be32 = read06Val0Be32(SINGLETON_O6_BLOCK_TEMPLATE, 'singleton', slot);
      expect(be16).toBe(6000);
      expect(be32).toBe(6000);
    }
  });

  it('X_µm BE32 fields match (singleton template: 7000 µm = 7 mm) and the two copies agree', () => {
    for (let slot = 0; slot < 9; slot++) {
      const a = read06XumA(SINGLETON_O6_BLOCK_TEMPLATE, 'singleton', slot);
      const b = read06XumB(SINGLETON_O6_BLOCK_TEMPLATE, 'singleton', slot);
      expect(a).toBe(7000);
      expect(b).toBe(7000);
    }
  });
});

describe('chunkSchema reads against the verbatim multi-element template (multi-element)', () => {
  it('block size matches 9 × multi stride', () => {
    expect(MULTI_O6_BLOCK_TEMPLATE.length).toBe(9 * O6_SLOT_STRIDE.multi);
  });

  it('foot byte is 0x07 (Foot S) in every slot', () => {
    for (let slot = 0; slot < 9; slot++) {
      expect(read06Foot(MULTI_O6_BLOCK_TEMPLATE, 'multi', slot)).toBe(0x07);
    }
  });

  it('val[1] BE16 is the Y dimension in µm (reference: 36 mm)', () => {
    // the multi-element reference is 13 × 36 mm (verified on machine).
    for (let slot = 0; slot < 9; slot++) {
      expect(read06Val1Be16(MULTI_O6_BLOCK_TEMPLATE, 'multi', slot)).toBe(36000);
    }
  });

  it('val[2] BE16 is val[1] × 1.5 (reference: 54000)', () => {
    for (let slot = 0; slot < 9; slot++) {
      expect(read06Val2Be16(MULTI_O6_BLOCK_TEMPLATE, 'multi', slot)).toBe(54000);
    }
  });

  it('X_µm BE32 fields match (reference: 13000 µm = 13 mm) and the two copies agree', () => {
    for (let slot = 0; slot < 9; slot++) {
      const a = read06XumA(MULTI_O6_BLOCK_TEMPLATE, 'multi', slot);
      const b = read06XumB(MULTI_O6_BLOCK_TEMPLATE, 'multi', slot);
      expect(a).toBe(13000);
      expect(b).toBe(13000);
    }
  });

  it('slot-pattern sequence reads back as 60,60,60,60,45,30,30,45,45', () => {
    const slotPatternOff = o6FieldOffset('multi', 'slotPattern');
    const actual = Array.from({ length: 9 }, (_, slot) =>
      MULTI_O6_BLOCK_TEMPLATE[slot * O6_SLOT_STRIDE.multi + slotPatternOff]!,
    );
    expect(actual).toEqual([...SLOT_PATTERN]);
  });
});

describe('chunkSchema writers round-trip through reads (0x06)', () => {
  it('write06Foot then read06Foot yields the same byte', () => {
    const block = new Uint8Array(SINGLETON_O6_BLOCK_TEMPLATE);
    write06Foot(block, 'singleton', 4, 0x07);
    expect(read06Foot(block, 'singleton', 4)).toBe(0x07);
  });

  it('write06Tension applies the +6 bump on slot 3 and the reader unbumps it', () => {
    const block = new Uint8Array(SINGLETON_O6_BLOCK_TEMPLATE);
    write06Tension(block, 'singleton', 3, 0x32);
    expect(read06Tension(block, 'singleton', 3)).toBe(0x32);
    const slot3Off = 3 * O6_SLOT_STRIDE.singleton + o6FieldOffset('singleton', 'tension');
    expect(block[slot3Off]).toBe(0x32 + TENSION_BUMP);
  });

  it('write06Val0Be16 writes the BE16 value and the reader recovers it', () => {
    const block = new Uint8Array(SINGLETON_O6_BLOCK_TEMPLATE);
    write06Val0Be16(block, 'singleton', 0, 0xaabb);
    expect(read06Val0Be16(block, 'singleton', 0)).toBe(0xaabb);
  });
});

describe('chunkSchema 0x05 payload writers/readers', () => {
  it('singleton payload is 32 bytes; multi payload is 33 bytes', () => {
    expect(o5PayloadLen('singleton')).toBe(32);
    expect(o5PayloadLen('multi')).toBe(33);
  });

  it('round-trips X_µm, Y_µm, tension, slot pattern through the schema (multi)', () => {
    const payload = new Uint8Array(o5PayloadLen('multi'));
    write05Tension(payload, 'multi', 3, 0x28);
    write05YumBe32(payload, 'multi', 36000);
    write05XumBe32(payload, 'multi', 13000);
    write05SlotPattern(payload, 'multi', 4);
    expect(read05Tension(payload, 'multi', 3)).toBe(0x28);
    expect(read05YumBe32(payload, 'multi')).toBe(36000);
    expect(read05XumBe32(payload, 'multi')).toBe(13000);
    expect(read05SlotPattern(payload, 'multi')).toBe(SLOT_PATTERN[4]);
  });

  it('round-trips X_µm, Y_µm, tension, X_elem, slot pattern through the schema (singleton)', () => {
    const payload = new Uint8Array(o5PayloadLen('singleton'));
    write05XelemBe32(payload, 0xdeadbeef);
    write05Tension(payload, 'singleton', 0, 0x28);
    write05YumBe32(payload, 'singleton', 8000);
    write05XumBe32(payload, 'singleton', 7000);
    write05SlotPattern(payload, 'singleton', 0);
    expect(read05Tension(payload, 'singleton', 0)).toBe(0x28);
    expect(read05YumBe32(payload, 'singleton')).toBe(8000);
    expect(read05XumBe32(payload, 'singleton')).toBe(7000);
    expect(read05SlotPattern(payload, 'singleton')).toBe(SLOT_PATTERN[0]);
  });

  it('write05Tension applies the +6 bump on slot 3 and read05Tension reverses it', () => {
    const payload = new Uint8Array(o5PayloadLen('multi'));
    write05Tension(payload, 'multi', 3, 0x28);
    expect(read05Tension(payload, 'multi', 3)).toBe(0x28);
    // Sanity: the raw byte at the tension offset really IS bumped.
    const tensionOff = 0x10; // payload-relative; matches schema o5FieldOffset('multi', 'tension')
    expect(payload[tensionOff]).toBe(0x28 + TENSION_BUMP);
  });
});

describe('read06TensionRaw / unbumpTension', () => {
  it('read06TensionRaw returns the stored byte without unbumping', () => {
    const block = new Uint8Array(SINGLETON_O6_BLOCK_TEMPLATE);
    write06Tension(block, 'singleton', 3, 0x28);
    expect(read06TensionRaw(block, 'singleton', 3)).toBe(0x28 + TENSION_BUMP);
    expect(read06TensionRaw(block, 'singleton', 0)).toBe(0x28);
  });

  it('unbumpTension reverses the slot-3 bump and is a no-op on every other slot', () => {
    expect(unbumpTension(0x28 + TENSION_BUMP, 3)).toBe(0x28);
    for (let slot = 0; slot < 9; slot++) {
      if (slot === TENSION_BUMP_SLOT) continue;
      expect(unbumpTension(0x28, slot)).toBe(0x28);
    }
  });
});
