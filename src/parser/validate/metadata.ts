// First chunk inside the outer body: a 148-byte metadata table wrapped
// in a class-byte-0x08 envelope (constant across observed files
// regardless of file class). The check returns the offset past the
// table so the driver can continue scanning.

import { readBE32 as be32 } from '../bytes.js';
import { type Ctx, fail, pass, warn } from './types.js';

export function checkMetadataTable(ctx: Ctx, _classByte: number, bodyStart: number): number {
  const { buf } = ctx;
  const ref = 'FORMAT.md';
  const hex = (n: number) => `0x${n.toString(16)}`;

  if (buf[bodyStart] !== 0x01) {
    fail(
      ctx,
      'metadata wrapper tag',
      `expected 0x01 at ${hex(bodyStart)}, got 0x${buf[bodyStart]!.toString(16)}`,
      ref,
    );
    return bodyStart;
  }
  // The metadata wrapper carries n=0x08 in every observed file regardless
  // of the file's class. Verbatim from known-good (singleton or multi).
  if (buf[bodyStart + 1] !== 0x08)
    warn(
      ctx,
      'metadata wrapper class byte',
      `expected n=0x08, got 0x${buf[bodyStart + 1]!.toString(16)} (multi-element files use 0x08)`,
      ref,
    );
  else pass(ctx, 'metadata wrapper class byte', `n = 0x08`, ref);

  const len = be32(buf, bodyStart + 4);
  if (len === 148) pass(ctx, 'metadata-table length', `148 bytes`, ref);
  else warn(ctx, 'metadata-table length', `BE32 = ${len}, expected 148`, ref);

  return bodyStart + 9 + len;
}
