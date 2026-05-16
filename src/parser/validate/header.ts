// File-header validator: magic, version triple, BE32 file-size, and the
// BE16 producer-string length that points at the outer chunk.

import { readBE16 as be16, readBE32 as be32 } from '../bytes.js';
import { type Ctx, fail, pass } from './types.js';

export function checkFileHeader(ctx: Ctx): { outerChunkOffset: number } | null {
  const { buf } = ctx;
  const ref = 'FORMAT.md §file header';

  const magic = String.fromCharCode(...buf.slice(0, 5));
  if (magic === '%spx%') pass(ctx, 'magic', `'%spx%' at offset 0`, ref);
  else {
    fail(ctx, 'magic', `expected '%spx%', got '${magic}'`, ref);
    return null;
  }

  const ver = [buf[5], buf[6], buf[7]].map((b) => b!.toString(16).padStart(2, '0')).join(' ');
  if (ver === '01 02 01') pass(ctx, 'version triple', ver, ref);
  else fail(ctx, 'version triple', `expected '01 02 01', got '${ver}'`, ref);

  const declared = be32(buf, 0x08) + 12;
  if (declared === buf.length)
    pass(ctx, 'file-size BE32', `${declared} bytes (matches`);
  else
    fail(ctx, 'file-size BE32', `BE32+12=${declared} but file is ${buf.length} bytes`, ref);

  // The BE16 at 0x0C is the UTF-16BE producer-string byte length. The
  // firmware honours it as the skip distance to the outer chunk but
  // ignores the contents (verified on machine 2026-05-15), so any length
  // is acceptable as long as it leaves room for the 7-byte outer chunk
  // header before EOF.
  const prodLen = be16(buf, 0x0c);
  const outerChunkOffset = 0x0e + prodLen;
  if (outerChunkOffset + 7 > buf.length) {
    fail(
      ctx,
      'producer-string length',
      `BE16 = ${prodLen} pushes outer chunk past EOF (file is ${buf.length} bytes)`,
      ref,
    );
    return null;
  }
  pass(
    ctx,
    'producer-string length',
    `BE16 = ${prodLen}; outer chunk at 0x${outerChunkOffset.toString(16)}`,
    ref,
  );
  return { outerChunkOffset };
}
