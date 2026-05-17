// Characterization tests for the stitch-records sub-chunk validator. The
// validator walks a payload and emits PASS/WARN/FAIL based on (a) parseable
// stitch count, (b) trailing unparsed bytes, (c) candidate dx = -128 short
// stitches (the byte 0x80 collides with the long-jump prefix), and (d)
// long-jumps with |dxHi| > 1 (outside the observed firmware envelope).

import { describe, expect, it } from 'vitest';
import { checkStitchRecords } from '../../../parser/validate/records.js';
import type { SubChunk } from '../../../parser/validate/geometryWrapper.js';
import type { Ctx, Result } from '../../../parser/validate/types.js';

function makeSub(payload: readonly number[]): SubChunk {
  return {
    kind: 'stitch',
    off: 0x100, // arbitrary; threaded into the rule key for inspection
    len: payload.length,
    payload: new Uint8Array(payload),
    preHeader: new Uint8Array(20),
  };
}

function ruleEndingWith(results: readonly Result[], suffix: string): Result | undefined {
  return results.find((r) => r.rule.endsWith(suffix));
}

describe('checkStitchRecords', () => {
  it('PASSes stitch count and both envelope checks for a single short record', () => {
    // One short stitch: dx = 5, dy = 0.
    const ctx: Ctx = { buf: new Uint8Array(0), results: [] };
    checkStitchRecords(ctx, makeSub([0x05, 0x00]));
    expect(ruleEndingWith(ctx.results, 'stitch count')?.severity).toBe('PASS');
    expect(ruleEndingWith(ctx.results, 'stitch count')?.detail).toContain('1 records');
    expect(ruleEndingWith(ctx.results, 'short-stitch dx')?.severity).toBe('PASS');
    expect(ruleEndingWith(ctx.results, 'long-jump |dxHi| ≤ 1')?.severity).toBe('PASS');
  });

  it('FAILs when the payload contains no parseable stitches', () => {
    const ctx: Ctx = { buf: new Uint8Array(0), results: [] };
    checkStitchRecords(ctx, makeSub([])); // empty payload
    expect(ruleEndingWith(ctx.results, 'stitch count')?.severity).toBe('FAIL');
  });

  it('WARNs when a trailing byte is left unparsed', () => {
    // Two valid short stitches (4 bytes) plus a dangling 5th byte.
    const ctx: Ctx = { buf: new Uint8Array(0), results: [] };
    checkStitchRecords(ctx, makeSub([0x01, 0x00, 0x02, 0x00, 0x07]));
    const trailing = ruleEndingWith(ctx.results, 'trailing');
    expect(trailing?.severity).toBe('WARN');
    expect(trailing?.detail).toContain('1 unparsed');
  });

  it('WARNs on a short record with dx = -128 (byte 0x80 not a long-jump)', () => {
    // 0x80 followed by dy = 0x00 — not the jump envelope, so the walker
    // emits a short stitch with dx = -128.
    const ctx: Ctx = { buf: new Uint8Array(0), results: [] };
    checkStitchRecords(ctx, makeSub([0x80, 0x00, 0x01, 0x00]));
    expect(ruleEndingWith(ctx.results, 'short-stitch dx')?.severity).toBe('WARN');
  });

  it('PASSes a valid long-jump with dxHi = 1', () => {
    // 80 23 dxLow dy dxHi 80 03 — dxHi = 0x01.
    const ctx: Ctx = { buf: new Uint8Array(0), results: [] };
    checkStitchRecords(ctx, makeSub([0x80, 0x23, 0x05, 0x00, 0x01, 0x80, 0x03]));
    expect(ruleEndingWith(ctx.results, 'long-jump |dxHi| ≤ 1')?.severity).toBe('PASS');
  });

  it('WARNs on a long-jump with |dxHi| > 1', () => {
    // dxHi = 0x05 (out of observed ±1 envelope).
    const ctx: Ctx = { buf: new Uint8Array(0), results: [] };
    checkStitchRecords(ctx, makeSub([0x80, 0x23, 0x00, 0x00, 0x05, 0x80, 0x03]));
    expect(ruleEndingWith(ctx.results, 'long-jump |dxHi| ≤ 1')?.severity).toBe('WARN');
  });

  it('threads the sub-chunk offset into the rule key', () => {
    const ctx: Ctx = { buf: new Uint8Array(0), results: [] };
    checkStitchRecords(ctx, makeSub([0x01, 0x00]));
    // Sub-chunk constructed at off = 0x100; rules read 'stitch@0x100 ...'.
    expect(ctx.results.every((r) => r.rule.startsWith('stitch@0x100 '))).toBe(true);
  });
});
