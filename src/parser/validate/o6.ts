// 0x06 chunks — the per-slot block chunks (118 B singleton, 113 B multi).
// Nine consecutive chunks per file. Field offsets are payload-relative and
// owned by the chunk schema. Each chunk holds foot byte, tension byte
// (with slot 3 bumped by TENSION_BUMP), val[0]/val[1]/val[2] in BE16/BE32
// forms, and a head_list / small_list tail.

import { readBE16 as be16, readBE32 as be32 } from '../bytes.js';
import { type ChunkClass, o6PayloadOffset, TENSION_BUMP } from '../../format/chunkSchema.js';
import { type Ctx, fail, pass, warn } from './types.js';

interface Chunk06 {
  off: number;
  len: number;
  payload: Uint8Array;
}

const VERIFIED_FOOT_BYTES = new Set([0x01, 0x02, 0x03, 0x06, 0x07, 0xff]);

export function walkO6Chunks(
  ctx: Ctx,
  start: number,
  classByte: number,
): { chunks: Chunk06[]; nextOff: number } {
  const { buf } = ctx;
  const chunks: Chunk06[] = [];
  let i = start;
  while (i < buf.length - 7 && buf[i] === 0x06) {
    const n = buf[i + 1]!;
    const ver = buf[i + 2]!;
    const len = be32(buf, i + 3);
    if (ver !== 0x02) {
      fail(ctx, '0x06 version', `chunk @0x${i.toString(16)} ver=0x${ver.toString(16)}, expected 0x02`);
      break;
    }
    if (n !== classByte) {
      fail(
        ctx,
        '0x06 class byte',
        `chunk @0x${i.toString(16)} n=0x${n.toString(16)}, expected 0x${classByte.toString(16)}`,
        'FORMAT.md',
      );
    }
    const payload = buf.subarray(i + 7, i + 7 + len);
    chunks.push({ off: i, len, payload });
    i += 7 + len;
  }
  return { chunks, nextOff: i };
}

export function checkO6Chunks(ctx: Ctx, chunks: Chunk06[], classByte: number): void {
  if (chunks.length === 0) {
    fail(ctx, '0x06 chunks present', 'no 0x06 chunks found');
    return;
  }
  // every observed sample file have exactly 9 0x06 chunks regardless of NN.
  if (chunks.length === 9)
    pass(ctx, '0x06 chunk count', `9 chunks`, 'FORMAT.md');
  else
    fail(
      ctx,
      '0x06 chunk count',
      `${chunks.length} chunks; invariant across observed samples is exactly 9`,
      'FORMAT.md',
    );

  // 0x06 slot-pattern sequence (second-to-last byte of each chunk's payload)
  // is identical to [60, 60, 60, 60, 45, 30, 30, 45, 45] across all observed sample
  // files across all NN values.
  const expectedSlotPattern = [60, 60, 60, 60, 45, 30, 30, 45, 45];
  const actualSlotPattern = chunks.map((c) => c.payload[c.payload.length - 2]!);
  const seqMatches = actualSlotPattern.length === expectedSlotPattern.length &&
    actualSlotPattern.every((v, i) => v === expectedSlotPattern[i]);
  if (seqMatches)
    pass(ctx, '0x06 slot-pattern sequence', `[${actualSlotPattern.join(',')}]`, 'FORMAT.md');
  else
    fail(
      ctx,
      '0x06 slot-pattern sequence',
      `[${actualSlotPattern.join(',')}], expected [${expectedSlotPattern.join(',')}] (invariant across observed samples)`,
      'FORMAT.md',
    );

  // The validator works with chunk PAYLOADS (header stripped). Field
  // offsets come from the chunkSchema's payload-relative table, so any
  // future field rename or shift lands in one place.
  const cls: ChunkClass = classByte === 3 ? 'multi' : 'singleton';
  const FOOT_OFF = o6PayloadOffset(cls, 'foot');
  const TENSION_OFF = o6PayloadOffset(cls, 'tension');
  const VAL0_BE16_OFF = o6PayloadOffset(cls, 'val0Be16');
  const Y_UM_OFF = o6PayloadOffset(cls, 'val1Be16');
  const VAL2_BE16_OFF = o6PayloadOffset(cls, 'val2Be16');
  const VAL0_BE32_OFF = o6PayloadOffset(cls, 'val0Be32');

  for (let slot = 0; slot < chunks.length; slot++) {
    const c = chunks[slot]!;
    const p = c.payload;
    const where = `0x06[${slot}] @0x${c.off.toString(16)}`;

    const foot = p[FOOT_OFF]!;
    if (VERIFIED_FOOT_BYTES.has(foot))
      pass(ctx, `${where} foot byte`, `0x${foot.toString(16)}`, 'FORMAT.md');
    else
      warn(
        ctx,
        `${where} foot byte`,
        `0x${foot.toString(16)} not in verified set {0x01..0x03, 0x06, 0x07, 0xFF}`,
        'FORMAT.md',
      );

    // Y dimension cap. The (verified) ~43.6 mm cap was established for
    // multi-element-shape singletons where val[2] = round(Y × 1.5) and val[2] is
    // BE16. Some observed sample files have Y > 43.6 mm with a different val[2]
    // semantic, so the cap doesn't apply universally — WARN instead of
    // FAIL.
    const yUm = be16(p, Y_UM_OFF);
    if (yUm <= 43600)
      pass(ctx, `${where} Y dim`, `${yUm} µm`, 'FORMAT.md');
    else
      warn(
        ctx,
        `${where} Y dim`,
        `${yUm} µm > 43600 µm (Y × 1.5 BE16 caps at 43.6 mm for multi-element-shape; observed samples has files with larger Y and different val[2] semantics)`,
        'FORMAT.md',
      );

    // val[2] BE16. In multi-element-shape singletons val[2] = round(Y × 1.5)
    // (the firmware reads it as the height-display field). Across other
    // observed samples the relationship is looser, so we only WARN when
    // it diverges.
    const val2 = be16(p, VAL2_BE16_OFF);
    const expectedVal2 = Math.round(yUm * 1.5);
    if (val2 === expectedVal2)
      pass(ctx, `${where} val[2] = Y × 1.5`, `${val2}`);
    else
      warn(
        ctx,
        `${where} val[2] = Y × 1.5`,
        `BE16 = ${val2}, Y × 1.5 would be ${expectedVal2} (multi-element-shape relationship; observed samples varies)`,
        'FORMAT.md',
      );

    // val[0] BE16 and its BE32 mirror. The multi-element reference keeps them equal; not all
    // observed sample files do.
    const val0Be16 = be16(p, VAL0_BE16_OFF);
    const val0Be32 = be32(p, VAL0_BE32_OFF);
    if (val0Be16 === val0Be32) pass(ctx, `${where} val[0] mirror`, `BE16 ${val0Be16} == BE32 ${val0Be32}`);
    else
      warn(
        ctx,
        `${where} val[0] mirror`,
        `BE16 +0x${VAL0_BE16_OFF.toString(16)} = ${val0Be16}, BE32 +0x${VAL0_BE32_OFF.toString(16)} = ${val0Be32}; encoder keeps them equal`,
      );

    // 0x06 tail decomposition: small_count u8 at +0x27, head_count = small_count - 1.
    const smallCount = p[0x27]!;
    if (smallCount < 1) {
      fail(ctx, `${where} small_count`, `u8 = 0; must be ≥ 1`);
      continue;
    }
    const headCount = smallCount - 1;
    const headOff = 0x2c;
    const sepOff = headOff + headCount * 4;
    const smallOff = sepOff + 4;
    const endMarkerOff = smallOff + smallCount * 4;
    const xUmOff = endMarkerOff + 4;
    const xMirrorOff = xUmOff + 4;

    if (xMirrorOff + 4 > p.length) {
      fail(ctx, `${where} tail layout`, `payload too short for derived offsets (have ${p.length})`);
      continue;
    }

    // The "head_list / 1000000-separator / small_list / 0-end-marker"
    // decomposition is observed across the multi-element reference and
    // most other sample files, but some files use a different tail
    // layout. Treat it as a soft check: WARN if the canonical
    // separator/marker aren't in place.
    const sep1 = be32(p, sepOff);
    if (sep1 === 1_000_000)
      pass(ctx, `${where} head/small separator`, `BE32 = 1000000 at +0x${sepOff.toString(16)}`);
    else
      warn(
        ctx,
        `${where} head/small separator`,
        `BE32 = ${sep1} at +0x${sepOff.toString(16)}, multi-element-shape uses 1000000`,
        'FORMAT.md',
      );

    const endMarker = be32(p, endMarkerOff);
    if (endMarker === 0)
      pass(ctx, `${where} list end marker`, `BE32 = 0 at +0x${endMarkerOff.toString(16)}`);
    else
      warn(
        ctx,
        `${where} list end marker`,
        `BE32 = ${endMarker} at +0x${endMarkerOff.toString(16)}, multi-element-shape uses 0`,
      );

    // head_list and small_list strictly ascending and multiples of 125.
    const head: number[] = [];
    for (let k = 0; k < headCount; k++) head.push(be32(p, headOff + k * 4));
    const small: number[] = [];
    for (let k = 0; k < smallCount; k++) small.push(be32(p, smallOff + k * 4));

    const ascending = (xs: number[]) => xs.every((v, k) => k === 0 || v > xs[k - 1]!);
    const allMul125 = (xs: number[]) => xs.every((v) => v % 125 === 0);
    if (ascending(head) && ascending(small))
      pass(ctx, `${where} head/small ordering`, `head=${head.join(',')}; small=${small.join(',')}`);
    else
      warn(
        ctx,
        `${where} head/small ordering`,
        `lists not strictly ascending; got head=${head.join(',')} small=${small.join(',')}`,
      );

    if (allMul125(head) && allMul125(small))
      pass(ctx, `${where} head/small × 125µm`, `all values are integer multiples of 125`);
    else
      warn(
        ctx,
        `${where} head/small × 125µm`,
        `some values are not multiples of 125 (observed convention only)`,
      );

    // X_µm position depends on the list lengths (it sits right after the
    // small_list end marker). Mirror is BE32 four bytes later.
    const xUm = be32(p, xUmOff);
    const xMirror = be32(p, xMirrorOff);
    if (xUm === xMirror)
      pass(ctx, `${where} X_µm mirror`, `BE32 = ${xUm} at both +0x${xUmOff.toString(16)} and +0x${xMirrorOff.toString(16)}`);
    else
      warn(
        ctx,
        `${where} X_µm mirror`,
        `+0x${xUmOff.toString(16)} = ${xUm}, +0x${xMirrorOff.toString(16)} = ${xMirror}; encoder keeps them equal`,
      );

    // n=3 sigil 00 02 0D right before slot_pattern.
    if (classByte === 3) {
      const sigil = `${p[p.length - 5]!.toString(16).padStart(2, '0')} ${p[p.length - 4]!.toString(16).padStart(2, '0')} ${p[p.length - 3]!.toString(16).padStart(2, '0')}`;
      if (sigil === '00 02 0d')
        pass(ctx, `${where} n=3 sigil`, `00 02 0D before slot_pattern`);
      else
        warn(
          ctx,
          `${where} n=3 sigil`,
          `expected '00 02 0d' before slot_pattern, got '${sigil}'`,
          'FORMAT.md',
        );
    }

    // Slot 3 carries tension + TENSION_BUMP. The exact offset is
    // payload-relative; schema owns it.
    if (slot === 3) {
      const t = p[TENSION_OFF]!;
      const tBase = chunks[0]?.payload[TENSION_OFF] ?? t;
      if (t === tBase + TENSION_BUMP)
        pass(ctx, `${where} slot-3 tension+${TENSION_BUMP}`, `tension byte 0x${t.toString(16)} = 0x${tBase.toString(16)} + ${TENSION_BUMP}`);
      else
        warn(
          ctx,
          `${where} slot-3 tension+${TENSION_BUMP}`,
          `+0x${TENSION_OFF.toString(16)} = 0x${t.toString(16)}, slot 0 = 0x${tBase.toString(16)}; expected slot 3 = slot 0 + ${TENSION_BUMP}`,
          'FORMAT.md',
        );
    }
  }
}
