// Outer 0x07 metadata chunk and NN dispatch byte. Determines the file's
// class (singleton n=1 or multi-element n=3) by peeking the first 0x06
// chunk's n byte inside the outer body.

import { readBE32 as be32 } from '../bytes.js';
import { type Ctx, fail, pass, warn } from './types.js';

export interface OuterChunkInfo {
  nn: number;
  classByte: number;
  bodyEnd: number;
  bodyStart: number;
}

export function checkOuterChunk(ctx: Ctx, outerChunkOffset: number): OuterChunkInfo | null {
  const { buf } = ctx;
  const ref = 'FORMAT.md';
  const tagOff = outerChunkOffset;
  const hex = (n: number) => `0x${n.toString(16)}`;

  if (buf[tagOff] !== 0x07) {
    fail(
      ctx,
      'outer chunk tag',
      `expected 0x07 at offset ${hex(tagOff)}, got 0x${buf[tagOff]!.toString(16)}`,
      ref,
    );
    return null;
  }
  pass(ctx, 'outer chunk tag', `0x07 at offset ${hex(tagOff)}`, ref);

  const nn = buf[tagOff + 1]!;
  // NN = 1 selects the singleton parser; NN = 5 selects the
  // multi-element-with-satin parser. The encoder supports those two;
  // other dispatch values exist in observed sample files but are out
  // of scope here.
  const label = nn === 1 ? 'singleton' : nn === 5 ? 'multi-element' : 'other';
  if (nn === 1 || nn === 5) pass(ctx, 'outer NN', `0x${nn.toString(16)} (${label})`, ref);
  else warn(ctx, 'outer NN', `0x${nn.toString(16)} (encoder produces 0x01 or 0x05)`, ref);

  const ver = buf[tagOff + 2]!;
  if (ver === 0x01) pass(ctx, 'outer chunk version', `0x01`, ref);
  else fail(ctx, 'outer chunk version', `expected 0x01, got 0x${ver.toString(16)}`, ref);

  const len = be32(buf, tagOff + 3);
  const bodyStart = tagOff + 7;
  const bodyEnd = bodyStart + len;
  if (bodyEnd === buf.length)
    pass(
      ctx,
      'outer chunk length',
      `BE32 = ${len}, body ${hex(bodyStart)}..${hex(bodyEnd)} == EOF`,
      ref,
    );
  else
    fail(
      ctx,
      'outer chunk length',
      `BE32 = ${len}, body ends at ${hex(bodyEnd)} but file ends at ${hex(buf.length)}`,
      ref,
    );

  // Detect the class byte (n) from the first 0x06 chunk in the body.
  // 0x06 is the per-slot block chunk; its n byte (1 for singleton, 3 for
  // multi-element) is the file's class. We then verify every other 0x06,
  // every 0x05, and the geometry wrapper sub-byte all match.
  let classByte = nn === 1 ? 1 : 3; // fallback to NN-derived
  for (let i = bodyStart; i < bodyEnd - 7; i++) {
    if (buf[i] === 0x06 && buf[i + 2] === 0x02) {
      classByte = buf[i + 1]!;
      break;
    }
  }
  return { nn, classByte, bodyEnd, bodyStart };
}
