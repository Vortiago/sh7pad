// Geometry wrapper (`01 03 SS 01 ...`): the outer envelope that holds
// per-element headers, stitch sub-chunks, and (for n=3 multi-element)
// satin sub-chunks. Sub-chunk content rules are delegated to
// records.ts and satinPayload.ts.

import { readBE32 as be32 } from '../bytes.js';
import { checkStitchRecords } from './records.js';
import { checkSatinPayload } from './satinPayload.js';
import { type Ctx, fail, pass, warn } from './types.js';

/** One sub-chunk inside the geometry wrapper, plus the 20 bytes that
 *  precede its header (the per-element header / interstitial prefix).
 *  Produced by the wrapper walker, consumed by the stitch-records and
 *  satin-payload checks. */
export interface SubChunk {
  kind: 'stitch' | 'satin';
  off: number;
  len: number;
  payload: Uint8Array;
  preHeader: Uint8Array;
}

export function checkGeometryWrapper(
  ctx: Ctx,
  start: number,
  classByte: number,
  bodyEnd: number,
  nn: number = 0,
): void {
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

    // Y values must have the high bit clear. readBE32 returns a signed
    // int32, so a high-bit-set byte sequence reads as a negative number.
    // The firmware reads the field as unsigned, so a -1500 µm value (signed
    // wrap) reads as ~4 billion µm and crashes the stitch generator.
    if (x >= 0 && y >= 0)
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
