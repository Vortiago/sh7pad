// 0x05 chunks — nine per file, paired with the 0x06 block chunks. The
// 0x09 marker check lives here too since it gates the start/end of the
// 0x05 sequence in the driver.

import { readBE32 as be32 } from '../bytes.js';
import {
  type ChunkClass,
  o5FieldOffset,
  SLOT_PATTERN as SCHEMA_SLOT_PATTERN,
  TENSION_BUMP,
} from '../../format/chunkSchema.js';
import { type Ctx, fail, pass, warn } from './types.js';

interface Chunk05 {
  off: number;
  len: number;
  payload: Uint8Array;
}

export function check09Marker(ctx: Ctx, off: number): number {
  const { buf } = ctx;
  if (buf[off] === 0x09) {
    pass(ctx, '0x09 marker', `byte 0x09 at offset 0x${off.toString(16)}`);
    return off + 1;
  }
  fail(ctx, '0x09 marker', `expected 0x09 at offset 0x${off.toString(16)}, got 0x${buf[off]!.toString(16)}`);
  return off;
}

export function walkO5Chunks(
  ctx: Ctx,
  start: number,
  classByte: number,
): { chunks: Chunk05[]; nextOff: number } {
  const { buf } = ctx;
  const chunks: Chunk05[] = [];
  let i = start;
  while (i < buf.length - 7 && buf[i] === 0x05) {
    const n = buf[i + 1]!;
    const ver = buf[i + 2]!;
    const len = be32(buf, i + 3);
    if (ver !== 0x02) {
      fail(ctx, '0x05 version', `chunk @0x${i.toString(16)} ver=0x${ver.toString(16)}, expected 0x02`);
      break;
    }
    if (n !== classByte) {
      fail(
        ctx,
        '0x05 class byte',
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

export function checkO5Chunks(ctx: Ctx, chunks: Chunk05[], classByte: number): void {
  if (chunks.length === 0) {
    fail(ctx, '0x05 chunks present', 'no 0x05 chunks found');
    return;
  }
  // every observed sample file have exactly 9 0x05 chunks regardless of NN.
  if (chunks.length === 9)
    pass(ctx, '0x05 chunk count', `9 chunks`, 'FORMAT.md');
  else
    fail(
      ctx,
      '0x05 chunk count',
      `${chunks.length} chunks; invariant across observed samples is exactly 9`,
      'FORMAT.md',
    );

  // 0x05 slot-pattern offset and marker offset come from the schema.
  const cls: ChunkClass = classByte === 3 ? 'multi' : 'singleton';
  const slotPatternOff = o5FieldOffset(cls, 'slotPattern')!;
  const markerOff = o5FieldOffset(cls, 'marker'); // null for singleton
  const expectedSlotPattern = SCHEMA_SLOT_PATTERN;
  const actualSlotPattern = chunks.map((c) => c.payload[slotPatternOff]!);
  const seqMatches = actualSlotPattern.length === expectedSlotPattern.length &&
    actualSlotPattern.every((v, i) => v === expectedSlotPattern[i]);
  if (seqMatches)
    pass(ctx, '0x05 slot-pattern sequence', `[${actualSlotPattern.join(',')}]`, 'FORMAT.md');
  else
    fail(
      ctx,
      '0x05 slot-pattern sequence',
      `[${actualSlotPattern.join(',')}], expected [${expectedSlotPattern.join(',')}] (invariant across observed samples)`,
      'FORMAT.md',
    );

  for (let slot = 0; slot < chunks.length; slot++) {
    const c = chunks[slot]!;
    const p = c.payload;
    const where = `0x05[${slot}] @0x${c.off.toString(16)}`;

    if (p.length < 0x20) {
      fail(ctx, `${where} payload length`, `len=${p.length}, expected ≥ 32`);
      continue;
    }

    // The Y_µm cap (~43.6 mm) only applies to the 0x06 chunk's val[2] BE16.
    // The 0x05 chunk stores Y as BE32 at +0x11 and can hold larger values
    // (observed files have values up to 0xFFFFFFFF, which look like sentinels). No
    // cap to enforce here.

    // The expected slot-pattern sequence (multi-element-template-derived) is 60,60,60,60,45,30,30,45,45.
    const slotPattern = p[slotPatternOff]!;
    if (slot < expectedSlotPattern.length && slotPattern === expectedSlotPattern[slot])
      pass(ctx, `${where} slot-pattern`, `+0x${slotPatternOff.toString(16)} = ${slotPattern}`);
    else
      warn(
        ctx,
        `${where} slot-pattern`,
        `+0x${slotPatternOff.toString(16)} = ${slotPattern}, multi-element-template-derived expects ${expectedSlotPattern[slot] ?? '?'}`,
        'FORMAT.md',
      );

    if (classByte === 3 && markerOff !== null) {
      // The marker byte is observed-variable {0..5} across observed
      // samples, but multi-element-shape files use 0x02. WARN if it
      // isn't 0x02 since the encoder writes 0x02 verbatim from the
      // multi-element template.
      const marker = p[markerOff]!;
      if (marker === 0x02)
        pass(ctx, `${where} +0x${markerOff.toString(16)} marker`, `0x02 (n=3 multi-element)`);
      else
        warn(
          ctx,
          `${where} +0x${markerOff.toString(16)} marker`,
          `0x${marker.toString(16)} (n=3 multi-element files use 0x02; observed samples also have {0,1,3,4,5})`,
          'FORMAT.md',
        );
    }

    // Slot 3 carries tension + TENSION_BUMP. Offset comes from the schema.
    if (slot === 3) {
      const tensionOff = o5FieldOffset(cls, 'tension')!;
      const t = p[tensionOff]!;
      const tBase = chunks[0]?.payload[tensionOff] ?? t;
      if (t === tBase + TENSION_BUMP)
        pass(ctx, `${where} slot-3 tension+${TENSION_BUMP}`, `tension byte = ${t} = ${tBase} + ${TENSION_BUMP}`);
      else
        warn(
          ctx,
          `${where} slot-3 tension+${TENSION_BUMP}`,
          `+0x${tensionOff.toString(16)} = ${t}, slot 0 = ${tBase}; expected slot 3 = slot 0 + ${TENSION_BUMP}`,
        );
    }
  }
}
