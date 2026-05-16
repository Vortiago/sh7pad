// Satin-chunk payload rules: lead/trailer markers, left/right point
// counts, and the high-bit-clear constraint on all BE32 cone coordinates.

import { readBE16 as be16, readBE32 as be32 } from '../bytes.js';
import type { SubChunk } from './subChunk.js';
import { type Ctx, fail, pass, warn } from './types.js';

export function checkSatinPayload(ctx: Ctx, sub: SubChunk): void {
  const where = `satin@0x${sub.off.toString(16)}`;
  const p = sub.payload;
  if (p.length < 6) {
    fail(ctx, `${where} payload length`, `len=${p.length}, too short`);
    return;
  }
  const lead = be16(p, 0);
  // Lead values seen in NN=5 samples: {0, 1, 256, 257}.
  if ([0, 1, 256, 257].includes(lead))
    pass(ctx, `${where} lead BE16`, `0x${lead.toString(16)}`);
  else
    warn(ctx, `${where} lead BE16`, `0x${lead.toString(16)} not in observed set {0, 1, 0x100, 0x101}`);

  const numL = be16(p, 2);
  if (numL < 1) fail(ctx, `${where} numL`, `BE16 = 0; cone needs at least 1 left point`);
  let cursor = 4 + numL * 8;
  if (cursor + 2 > p.length) {
    fail(ctx, `${where} numR location`, `payload ends before numR field`);
    return;
  }
  const numR = be16(p, cursor);
  cursor += 2;
  if (numR < 1) fail(ctx, `${where} numR`, `BE16 = 0; cone needs at least 1 right point`);
  cursor += numR * 8;
  if (cursor + 2 > p.length) {
    fail(ctx, `${where} trailer location`, `payload ends before trailer BE16`);
    return;
  }
  const trail = be16(p, cursor);
  if (trail === 0) pass(ctx, `${where} trailer BE16`, `0`);
  else warn(ctx, `${where} trailer BE16`, `${trail}; observed samples has 0 in every observed case`);

  if (cursor + 2 !== p.length)
    fail(
      ctx,
      `${where} payload length`,
      `parsed ${cursor + 2} bytes but chunk has ${p.length}; trailing ${p.length - cursor - 2} bytes`,
    );
  else pass(ctx, `${where} payload length`, `${p.length} bytes consumed exactly`);

  // All BE32 cone-point values must be < 2^31 (firmware reads unsigned;
  // negatives encoded via signed wrap appear as ~4 billion µm).
  let bad = 0;
  for (let i = 0; i < numL; i++) {
    if (be32(p, 4 + i * 8) >= 0x80000000) bad++;
    if (be32(p, 4 + i * 8 + 4) >= 0x80000000) bad++;
  }
  const rOff = 4 + numL * 8 + 2;
  for (let i = 0; i < numR; i++) {
    if (be32(p, rOff + i * 8) >= 0x80000000) bad++;
    if (be32(p, rOff + i * 8 + 4) >= 0x80000000) bad++;
  }
  if (bad === 0)
    pass(ctx, `${where} non-negative coords`, `all ${numL + numR} BE32s have high bit clear`);
  else
    fail(
      ctx,
      `${where} non-negative coords`,
      `${bad} BE32 cone values have high bit set; firmware reads as ~4 billion µm`,
      'FORMAT.md',
    );
}
