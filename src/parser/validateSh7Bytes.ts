// Byte-level validator for `.sh7` files we generate. Pure-data: no node
// imports, safe to bundle for the browser. Called from the encoder to
// double-check its own output before returning it.
//
// All rules are derived from observed sample files plus byte probes
// (deliberate single-byte mutations and the resulting machine response).
// Where a rule is invariant across every observed file it is FAIL-level;
// where it is dominant but not invariant it is WARN-level. See FORMAT.md
// for field-level details.
//
// This file is the driver: it threads a single Ctx through each
// per-domain check in `./validate/*.ts`. Each check is independently
// testable with a hand-crafted Uint8Array.

import { checkFileHeader } from './validate/header.js';
import { checkOuterChunk } from './validate/outerChunk.js';
import { checkMetadataTable } from './validate/metadata.js';
import { checkO6Chunks, walkO6Chunks } from './validate/o6.js';
import { check09Marker, checkO5Chunks, walkO5Chunks } from './validate/o5.js';
import { checkGeometryWrapper } from './validate/geometryWrapper.js';
import { type Ctx, fail, warn, type Result, type Severity } from './validate/types.js';
import { readBE32 as be32 } from './bytes.js';

export type { Result, Severity };

export function validate(buf: Uint8Array): Result[] {
  const ctx: Ctx = { buf, results: [] };
  // Minimum viable file: 14-byte fixed header + smallest plausible producer
  // string (2 bytes for one UTF-16 char) + 7-byte outer chunk header.
  if (buf.length < 14 + 2 + 7) {
    fail(ctx, 'file too short', `${buf.length} bytes`);
    return ctx.results;
  }
  const headerResult = checkFileHeader(ctx);
  if (!headerResult) return ctx.results;
  const outer = checkOuterChunk(ctx, headerResult.outerChunkOffset);
  if (!outer) return ctx.results;
  let off = checkMetadataTable(ctx, outer.classByte, outer.bodyStart);

  // n=1 singletons: 0x07 chunk at the start of the metadata-table body.
  // n=3 multi-element: 0x06 chunks immediately after the metadata wrapper.
  // For simplicity, walk forward through the body skipping 0x09 markers.
  while (off < outer.bodyEnd && buf[off] === 0x09) off = check09Marker(ctx, off);

  const o6 = walkO6Chunks(ctx, off, outer.classByte);
  checkO6Chunks(ctx, o6.chunks, outer.classByte);
  off = o6.nextOff;

  while (off < outer.bodyEnd && buf[off] === 0x09) off = check09Marker(ctx, off);

  const o5 = walkO5Chunks(ctx, off, outer.classByte);
  checkO5Chunks(ctx, o5.chunks, outer.classByte);
  off = o5.nextOff;

  // Skip past optional pre-wrapper chunks (0x04 sensor/calibration chunks,
  // additional 0x09 markers) and find the geometry wrapper. The encoder
  // only produces NN=1 and NN=5; for those NN values the wrapper sits
  // immediately after the 0x05 chunks. For other NN values (out of
  // encoder scope) we'll just look for `01 03 ?? 01` if it exists.
  while (off < outer.bodyEnd && buf[off] !== 0x01) {
    if (buf[off] === 0x09) {
      off = check09Marker(ctx, off);
      continue;
    }
    // 0x04 sensor / calibration chunks appear in some sample files
    // (calibration-data category). Tag/n/ver/BE32-len header same as
    // other chunks. Skip past them with a WARN — the encoder doesn't
    // produce them.
    if (buf[off] === 0x04) {
      const len = be32(buf, off + 3);
      warn(
        ctx,
        '0x04 sensor chunk present',
        `tag 0x04 at 0x${off.toString(16)}, len ${len}; encoder doesn't produce these`,
      );
      off += 7 + len;
      continue;
    }
    if (outer.nn === 1 || outer.nn === 5) {
      fail(
        ctx,
        'unexpected chunk before geometry wrapper',
        `0x${buf[off]!.toString(16)} at 0x${off.toString(16)}`,
      );
      break;
    } else {
      off++; // unsupported NN — silently skip unknown bytes
    }
  }

  if (off < outer.bodyEnd && buf[off] === 0x01)
    checkGeometryWrapper(ctx, off, outer.classByte, outer.bodyEnd, outer.nn);

  return ctx.results;
}
