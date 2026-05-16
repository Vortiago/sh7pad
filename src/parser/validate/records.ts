// Stitch-record content rules. The byte layout (envelope, dxHi/dxLow
// split) lives in recordCodec; this file only counts policy-relevant
// facts that emerge from walking the records.

import { walkRecords } from '../../format/recordCodec.js';
import type { SubChunk } from './geometryWrapper.js';
import { type Ctx, fail, pass, warn } from './types.js';

export function checkStitchRecords(ctx: Ctx, sub: SubChunk): void {
  const where = `stitch@0x${sub.off.toString(16)}`;
  const p = sub.payload;
  // Record byte layout (envelope, dxHi/dxLow split) lives in recordCodec.
  // The validator counts policy-relevant facts that emerge from walking
  // the records: short stitches with dx = -128 (encoder explicitly
  // disallows; the byte 0x80 collides with the long-jump prefix), and
  // long-jumps with |dxHi| > 1 (outside the observed firmware envelope).
  let badShortDx = 0;
  let longJumpsBadHi = 0;
  let stitchCount = 0;
  let consumed = 0;
  for (const r of walkRecords(p)) {
    stitchCount++;
    consumed = r.recordOffset + r.recordLength;
    if (r.kind === 'jump') {
      const dxHi = (r.flag << 24) >> 24; // signed int8
      if (dxHi > 1 || dxHi < -1) longJumpsBadHi++;
    } else if (r.dx === -128) {
      badShortDx++;
    }
  }
  if (consumed !== p.length)
    warn(ctx, `${where} stitch payload trailing`, `${p.length - consumed} unparsed bytes at end of payload`);

  if (stitchCount === 0) fail(ctx, `${where} stitch count`, `payload contains no parseable stitches`);
  else pass(ctx, `${where} stitch count`, `${stitchCount} records`);

  if (badShortDx === 0)
    pass(ctx, `${where} short-stitch dx`, `no records with dx = -128`);
  else
    // Some observed files use 0x80-prefixed forms beyond the canonical
    // 80 23 .. 80 03 long-jump (we see 80 1d, 80 3d); the validator can't
    // tell those apart from a short stitch with dx = -128. WARN rather
    // than FAIL.
    warn(
      ctx,
      `${where} short-stitch dx`,
      `${badShortDx} candidate dx = -128 short stitches (or unknown 80-prefixed records); encoder must not emit dx = -128`,
      'FORMAT.md',
    );

  if (longJumpsBadHi === 0)
    pass(ctx, `${where} long-jump |dxHi| ≤ 1`, `all long-jumps within envelope`);
  else
    warn(
      ctx,
      `${where} long-jump |dxHi| ≤ 1`,
      `${longJumpsBadHi} long-jump records with |dxHi| > 1 (observed envelope is ±1)`,
      'FORMAT.md',
    );
}
