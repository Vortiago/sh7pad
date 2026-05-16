// Characterization tests for the satin sub-chunk payload validator.
//
// Satin payload layout (per FORMAT.md):
//   BE16 lead          // {0, 1, 0x100, 0x101} observed
//   BE16 numL          // ≥ 1
//   numL × 8 bytes of left-cone BE32 (x, y) pairs
//   BE16 numR          // ≥ 1
//   numR × 8 bytes of right-cone BE32 (x, y) pairs
//   BE16 trailer       // 0 across observed samples
//
// All BE32 cone coords must have the high bit clear (firmware reads
// unsigned).

import { describe, expect, it } from 'vitest';
import { checkSatinPayload } from '../../../parser/validate/satinPayload.js';
import type { SubChunk } from '../../../parser/validate/geometryWrapper.js';
import type { Ctx, Result } from '../../../parser/validate/types.js';
import { writeBE16, writeBE32 } from '../../../parser/bytes.js';

function buildSatinPayload(opts: {
  lead?: number;
  left?: ReadonlyArray<readonly [number, number]>;
  right?: ReadonlyArray<readonly [number, number]>;
  trailer?: number;
} = {}): Uint8Array {
  const lead = opts.lead ?? 0x0001;
  const left = opts.left ?? [[1000, 0]];
  const right = opts.right ?? [[2000, 0]];
  const trailer = opts.trailer ?? 0;
  const len = 2 + 2 + left.length * 8 + 2 + right.length * 8 + 2;
  const p = new Uint8Array(len);
  let off = 0;
  writeBE16(p, off, lead);
  off += 2;
  writeBE16(p, off, left.length);
  off += 2;
  for (const [x, y] of left) {
    writeBE32(p, off, x);
    writeBE32(p, off + 4, y);
    off += 8;
  }
  writeBE16(p, off, right.length);
  off += 2;
  for (const [x, y] of right) {
    writeBE32(p, off, x);
    writeBE32(p, off + 4, y);
    off += 8;
  }
  writeBE16(p, off, trailer);
  return p;
}

function makeSub(payload: Uint8Array): SubChunk {
  return {
    kind: 'satin',
    off: 0x200,
    len: payload.length,
    payload,
    preHeader: new Uint8Array(20),
  };
}

function ruleEndingWith(results: readonly Result[], suffix: string): Result | undefined {
  return results.find((r) => r.rule.endsWith(suffix));
}

describe('checkSatinPayload', () => {
  it('PASSes every rule on a minimal valid 1L/1R cone', () => {
    const ctx: Ctx = { buf: new Uint8Array(0), results: [] };
    checkSatinPayload(ctx, makeSub(buildSatinPayload()));
    expect(ruleEndingWith(ctx.results, 'lead BE16')?.severity).toBe('PASS');
    expect(ruleEndingWith(ctx.results, 'trailer BE16')?.severity).toBe('PASS');
    expect(ruleEndingWith(ctx.results, 'payload length')?.severity).toBe('PASS');
    expect(ruleEndingWith(ctx.results, 'non-negative coords')?.severity).toBe('PASS');
  });

  it('FAILs payload length when chunk is shorter than 6 bytes', () => {
    const ctx: Ctx = { buf: new Uint8Array(0), results: [] };
    checkSatinPayload(ctx, makeSub(new Uint8Array(4)));
    const len = ruleEndingWith(ctx.results, 'payload length');
    expect(len?.severity).toBe('FAIL');
  });

  it('WARNs on an unfamiliar lead value', () => {
    const ctx: Ctx = { buf: new Uint8Array(0), results: [] };
    checkSatinPayload(ctx, makeSub(buildSatinPayload({ lead: 0x0042 })));
    expect(ruleEndingWith(ctx.results, 'lead BE16')?.severity).toBe('WARN');
  });

  it('FAILs when numL is zero', () => {
    // Hand-build a payload with numL = 0 (then a 0-byte left region).
    const p = new Uint8Array(2 + 2 + 2 + 8 + 2);
    writeBE16(p, 0, 0x0001); // lead
    writeBE16(p, 2, 0); // numL = 0
    writeBE16(p, 4, 1); // numR = 1
    writeBE32(p, 6, 2000);
    writeBE32(p, 10, 0);
    writeBE16(p, 14, 0); // trailer
    const ctx: Ctx = { buf: new Uint8Array(0), results: [] };
    checkSatinPayload(ctx, makeSub(p));
    expect(ruleEndingWith(ctx.results, 'numL')?.severity).toBe('FAIL');
  });

  it('FAILs non-negative-coords when a BE32 has the high bit set', () => {
    const p = buildSatinPayload();
    // Mutate the first left-cone X (at payload +4) to a high-bit value.
    writeBE32(p, 4, 0x80000001);
    const ctx: Ctx = { buf: new Uint8Array(0), results: [] };
    checkSatinPayload(ctx, makeSub(p));
    expect(ruleEndingWith(ctx.results, 'non-negative coords')?.severity).toBe('FAIL');
  });

  it('WARNs on a non-zero trailer', () => {
    const ctx: Ctx = { buf: new Uint8Array(0), results: [] };
    checkSatinPayload(ctx, makeSub(buildSatinPayload({ trailer: 1 })));
    expect(ruleEndingWith(ctx.results, 'trailer BE16')?.severity).toBe('WARN');
  });

  it('counts both left and right cones in the non-negative-coords rule', () => {
    const ctx: Ctx = { buf: new Uint8Array(0), results: [] };
    checkSatinPayload(
      ctx,
      makeSub(buildSatinPayload({ left: [[1000, 0], [1500, 100]], right: [[2000, 0], [2500, 100]] })),
    );
    const rule = ruleEndingWith(ctx.results, 'non-negative coords');
    expect(rule?.severity).toBe('PASS');
    expect(rule?.detail).toContain('4 BE32');
  });
});
