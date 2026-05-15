// Byte-level validator for `.sh7` files we generate. Pure-data: no node
// imports, safe to bundle for the browser. Called from the encoder to
// double-check its own output before returning it.
//
// All rules are derived from observed sample files plus byte probes
// (deliberate single-byte mutations and the resulting machine response).
// Where a rule is invariant across every observed file it is FAIL-level;
// where it is dominant but not invariant it is WARN-level. See FORMAT.md
// for field-level details.

import { readBE16 as be16, readBE32 as be32 } from './bytes.js';
import { walkRecords } from '../format/recordCodec.js';
import {
  type ChunkClass,
  o5FieldOffset,
  o6PayloadOffset,
  SLOT_PATTERN as SCHEMA_SLOT_PATTERN,
  TENSION_BUMP,
} from '../format/chunkSchema.js';

export type Severity = 'PASS' | 'WARN' | 'FAIL';

export interface Result {
  rule: string;
  severity: Severity;
  detail: string;
  ref?: string;
}

interface Ctx {
  buf: Uint8Array;
  results: Result[];
}

const VERIFIED_FOOT_BYTES = new Set([0x01, 0x02, 0x03, 0x06, 0x07, 0xff]);

function pass(ctx: Ctx, rule: string, detail: string, ref?: string) {
  ctx.results.push({ rule, severity: 'PASS', detail, ref });
}
function warn(ctx: Ctx, rule: string, detail: string, ref?: string) {
  ctx.results.push({ rule, severity: 'WARN', detail, ref });
}
function fail(ctx: Ctx, rule: string, detail: string, ref?: string) {
  ctx.results.push({ rule, severity: 'FAIL', detail, ref });
}

// ---------- File header ----------

function checkFileHeader(ctx: Ctx): { outerChunkOffset: number } | null {
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

// ---------- Outer 0x07 metadata chunk and NN ----------

function checkOuterChunk(
  ctx: Ctx,
  outerChunkOffset: number,
): { nn: number; classByte: number; bodyEnd: number; bodyStart: number } | null {
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

// ---------- Metadata-table chunk (first chunk inside the outer body) ----------

function checkMetadataTable(ctx: Ctx, _classByte: number, bodyStart: number): number {
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

// ---------- 0x06 chunks ----------

interface Chunk06 {
  off: number;
  len: number;
  payload: Uint8Array;
}

function walkO6Chunks(ctx: Ctx, start: number, classByte: number): { chunks: Chunk06[]; nextOff: number } {
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

function checkO6Chunks(ctx: Ctx, chunks: Chunk06[], classByte: number) {
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

// ---------- 0x09 marker ----------

function check09Marker(ctx: Ctx, off: number): number {
  const { buf } = ctx;
  if (buf[off] === 0x09) {
    pass(ctx, '0x09 marker', `byte 0x09 at offset 0x${off.toString(16)}`);
    return off + 1;
  }
  fail(ctx, '0x09 marker', `expected 0x09 at offset 0x${off.toString(16)}, got 0x${buf[off]!.toString(16)}`);
  return off;
}

// ---------- 0x05 chunks ----------

interface Chunk05 {
  off: number;
  len: number;
  payload: Uint8Array;
}

function walkO5Chunks(ctx: Ctx, start: number, classByte: number): { chunks: Chunk05[]; nextOff: number } {
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

function checkO5Chunks(ctx: Ctx, chunks: Chunk05[], classByte: number) {
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

// ---------- Geometry wrapper ----------

interface SubChunk {
  kind: 'stitch' | 'satin';
  off: number;
  len: number;
  payload: Uint8Array;
  preHeader: Uint8Array; // 20 bytes immediately before
}

function checkGeometryWrapper(ctx: Ctx, start: number, classByte: number, bodyEnd: number, nn: number = 0) {
  const { buf } = ctx;
  if (buf[start] !== 0x01) {
    fail(ctx, 'geometry wrapper tag', `expected 0x01 at 0x${start.toString(16)}, got 0x${buf[start]!.toString(16)}`);
    return;
  }
  // The geometry wrapper's bytes are `01 03 SS 01` where SS = 0x01 for
  // singletons, 0x03 for multi-element. The "n" byte (second byte) is
  // always 0x03, regardless of the file's class. The class is encoded in
  // the third byte (SS).
  const n = buf[start + 1]!;
  const sub = buf[start + 2]!;
  const ver = buf[start + 3]!;
  const len = be32(buf, start + 4);

  if (n === 0x03)
    pass(ctx, 'geometry wrapper n byte', `0x03`);
  else
    warn(ctx, 'geometry wrapper n byte', `0x${n.toString(16)} (observed: 0x03)`, 'FORMAT.md §geometry wrapper');

  // The wrapper's sub byte is per-class for the encoder's supported NN
  // values: 0x01 for NN=1, 0x03 for NN=5. Other NN values use 0x02 or
  // 0x00 across observed samples and are out of encoder scope, so we only enforce
  // when NN ∈ {1, 5}.
  const expectedSub = classByte === 3 ? 0x03 : 0x01;
  if (nn === 1 || nn === 5) {
    if (sub === expectedSub)
      pass(ctx, 'geometry wrapper sub byte', `0x${sub.toString(16)} (matches file class ${classByte})`, 'FORMAT.md');
    else
      fail(
        ctx,
        'geometry wrapper sub byte',
        `0x${sub.toString(16)}, expected 0x${expectedSub.toString(16)} for class ${classByte}`,
        'FORMAT.md',
      );
  } else {
    pass(ctx, 'geometry wrapper sub byte', `0x${sub.toString(16)} (NN=0x${nn.toString(16)}, encoder doesn't produce this NN)`);
  }

  if (ver === 0x01) pass(ctx, 'geometry wrapper version', `0x01`);
  else fail(ctx, 'geometry wrapper version', `0x${ver.toString(16)}`);

  const wrapperEnd = start + 8 + len;
  if (wrapperEnd === bodyEnd)
    pass(ctx, 'geometry wrapper length', `len=${len}; ends at outer body end`);
  else
    fail(
      ctx,
      'geometry wrapper length',
      `wrapper ends at 0x${wrapperEnd.toString(16)} but outer body ends at 0x${bodyEnd.toString(16)}`,
    );

  if (classByte !== 3) return; // sub-chunk rules below are multi-element-only

  // The wrapper preamble is `[BE32 signed design_x_offset_µm]
  // [BE16 sub_chunk_count]` (verified across the observed NN=5 sample
  // files; see FORMAT.md). The BE16 count must match the actual number
  // of sub-chunks below — mismatches make the machine reject the file.
  const preamble = buf.slice(start + 8, start + 8 + 6);
  const declaredCount = (preamble[4]! << 8) | preamble[5]!;
  const preBe32Signed =
    ((preamble[0]! << 24) | (preamble[1]! << 16) | (preamble[2]! << 8) | preamble[3]!) | 0;

  // Find sub-chunks in order.
  const subs: SubChunk[] = [];
  let j = start + 8 + 6;
  while (j < wrapperEnd - 7) {
    if (buf[j] === 0x02 && buf[j + 2] === 0x01 && (buf[j + 1] === 0x01 || buf[j + 1] === 0x03)) {
      const subLen = be32(buf, j + 3);
      if (subLen > 0 && j + 7 + subLen <= wrapperEnd) {
        const kind = buf[j + 1] === 0x01 ? 'stitch' : 'satin';
        subs.push({
          kind,
          off: j,
          len: subLen,
          payload: buf.subarray(j + 7, j + 7 + subLen),
          preHeader: buf.subarray(j - 20, j),
        });
        j += 7 + subLen;
        continue;
      }
    }
    j += 1;
  }

  if (subs.length === 0) {
    fail(ctx, 'wrapper sub-chunks', `no 02 01 01 / 02 03 01 chunks found`);
    return;
  }
  pass(
    ctx,
    'wrapper sub-chunks',
    `${subs.length} chunks: ${subs.map((s) => (s.kind === 'stitch' ? 'S' : 'T')).join('')}`,
  );

  // Wrapper preamble check: the BE16 count at preamble +0x04..+0x05 must
  // equal the actual sub-chunk count, verified across every observed
  // NN=5 sample file.
  if (declaredCount === subs.length)
    pass(
      ctx,
      'wrapper preamble sub-chunk count',
      `declared ${declaredCount} == actual ${subs.length}`,
      'FORMAT.md',
    );
  else
    fail(
      ctx,
      'wrapper preamble sub-chunk count',
      `declared ${declaredCount} != actual ${subs.length}; the multi-element parser overruns and emits "Not supported SDC"`,
      'FORMAT.md',
    );

  // The first 4 bytes of the preamble are a signed BE32 we don't fully
  // understand; some observed sample files use 0, the rest use 125-µm-step
  // values. We just note non-zero rather than enforcing.
  if (preBe32Signed === 0)
    pass(ctx, 'wrapper preamble BE32', `0`);
  else
    warn(
      ctx,
      'wrapper preamble BE32',
      `${preBe32Signed} µm; non-zero BE32 occurs in 41 of the observed NN=5 sample files (rule unknown)`,
      'FORMAT.md',
    );

  // The encoder appends a synthetic closing stitch chunk when the user's
  // logical design ends on a satin. Empirically the observed samples include NN=5
  // files ending on stitch and 42 ending on satin, so this rule is
  // encoder-style, not firmware-required. Keep as WARN.
  const last = subs[subs.length - 1]!;
  if (last.kind === 'stitch')
    pass(ctx, 'closing chunk is stitch', `last sub-chunk is stitch (len=${last.len})`, 'FORMAT.md');
  else
    warn(
      ctx,
      'closing chunk is stitch',
      `last sub-chunk is satin; encoder appends a closing stitch chunk after a trailing satin`,
      'FORMAT.md',
    );

  if (last.len > 0)
    pass(ctx, 'closing chunk length', `${last.len} bytes`);
  else
    fail(ctx, 'closing chunk length', `0 bytes; firmware needs a non-zero closing chunk`);

  // Per-element header / interstitial pre-bytes.
  for (const s of subs) {
    const where = `${s.kind}@0x${s.off.toString(16)}`;
    const a = be32(s.preHeader, 0);
    const b = be32(s.preHeader, 4);
    const c = be32(s.preHeader, 8);
    const x = be32(s.preHeader, 12);
    const y = be32(s.preHeader, 16);

    if (s.kind === 'stitch') {
      // most observed NN=5 stitch chunks use (125, 125, 1000); the
      // remaining 2 use (250, 125, 750). Encoder emits the dominant form.
      if (a === 125 && b === 125 && c === 1000)
        pass(ctx, `${where} pre-header prefix`, `(125, 125, 1000)`);
      else
        warn(
          ctx,
          `${where} pre-header prefix`,
          `(${a}, ${b}, ${c}); encoder uses (125, 125, 1000)`,
          'FORMAT.md §per-element header fields',
        );

      if (x === 0)
        warn(
          ctx,
          `${where} X_elem`,
          `0 µm; rare across observed samples (only a few NN=5 STS-shape files use 0; the rest use 3500 µm)`,
          'FORMAT.md',
        );
      else
        pass(ctx, `${where} X_elem`, `${x} µm`);
    } else {
      if (a === 1 && b === 1 && c === 1)
        pass(ctx, `${where} pre-header prefix`, `(1, 1, 1)`);
      else
        warn(
          ctx,
          `${where} pre-header prefix`,
          `(${a}, ${b}, ${c}); encoder uses (1, 1, 1)`,
          'FORMAT.md §interstitial fields',
        );
    }

    // Y values are derivable; we just check they fit BE32 and are non-negative
    // (BE32 reads unsigned anyway, so this is just a sanity check on the
    // upper bit being zero, which means the firmware reads the same value
    // even if the encoder accidentally treated it as signed).
    if (x < 0x80000000 && y < 0x80000000)
      pass(ctx, `${where} pre-header trailing values fit unsigned BE32`, `(${x}, ${y})`);
    else
      fail(ctx, `${where} pre-header trailing values fit unsigned BE32`, `(${x}, ${y}) — high bit set`);
  }

  // Stitch-record content rules.
  for (const s of subs) {
    if (s.kind !== 'stitch') continue;
    checkStitchRecords(ctx, s);
  }

  // Satin payload rules.
  for (const s of subs) {
    if (s.kind !== 'satin') continue;
    checkSatinPayload(ctx, s);
  }
}

function checkStitchRecords(ctx: Ctx, sub: SubChunk) {
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

function checkSatinPayload(ctx: Ctx, sub: SubChunk) {
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

// ---------- Driver ----------

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
