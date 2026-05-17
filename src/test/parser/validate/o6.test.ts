// Characterization tests for the 0x06 block-chunk validator. The validator
// takes a list of pre-walked Chunk06 records and emits PASS/WARN/FAIL based
// on (a) chunk count = 9, (b) slot-pattern sequence invariant, and per-slot
// (c) foot byte, (d) Y dimension cap, (e) val[2] = Y × 1.5, (f) val[0]
// BE16/BE32 mirror, (g) head_list/small_list shape, and (h) slot 3 tension
// bump.

import { describe, expect, it } from 'vitest';
import { checkO6Chunks, walkO6Chunks } from '../../../parser/validate/o6.js';
import type { Ctx, Result } from '../../../parser/validate/types.js';
import {
  SINGLETON_O6_BLOCK_TEMPLATE,
  MULTI_O6_BLOCK_TEMPLATE,
} from '../../../creator/sh7BinaryExportConstants.js';

function severityCounts(results: readonly Result[]): { pass: number; warn: number; fail: number } {
  return results.reduce(
    (acc, r) => ({
      pass: acc.pass + (r.severity === 'PASS' ? 1 : 0),
      warn: acc.warn + (r.severity === 'WARN' ? 1 : 0),
      fail: acc.fail + (r.severity === 'FAIL' ? 1 : 0),
    }),
    { pass: 0, warn: 0, fail: 0 },
  );
}

describe('walkO6Chunks', () => {
  it('walks all nine 0x06 chunks out of the singleton template', () => {
    const ctx: Ctx = { buf: SINGLETON_O6_BLOCK_TEMPLATE, results: [] };
    const out = walkO6Chunks(ctx, 0, 0x01);
    expect(out.chunks).toHaveLength(9);
    expect(out.nextOff).toBe(SINGLETON_O6_BLOCK_TEMPLATE.length);
  });

  it('walks all nine 0x06 chunks out of the multi-element template', () => {
    const ctx: Ctx = { buf: MULTI_O6_BLOCK_TEMPLATE, results: [] };
    const out = walkO6Chunks(ctx, 0, 0x03);
    expect(out.chunks).toHaveLength(9);
    expect(out.nextOff).toBe(MULTI_O6_BLOCK_TEMPLATE.length);
  });

  it('FAILs on a chunk with the wrong version byte', () => {
    const buf = new Uint8Array(SINGLETON_O6_BLOCK_TEMPLATE);
    buf[2] = 0x03; // ver should be 0x02
    const ctx: Ctx = { buf, results: [] };
    walkO6Chunks(ctx, 0, 0x01);
    expect(ctx.results.find((r) => r.rule === '0x06 version')?.severity).toBe('FAIL');
  });

  it('FAILs on a chunk whose n byte does not match the declared class byte', () => {
    const ctx: Ctx = { buf: SINGLETON_O6_BLOCK_TEMPLATE, results: [] };
    walkO6Chunks(ctx, 0, 0x03); // declare multi but the buffer is singleton
    expect(ctx.results.find((r) => r.rule === '0x06 class byte')?.severity).toBe('FAIL');
  });
});

describe('checkO6Chunks', () => {
  it('PASSes the chunk-count and slot-pattern invariants for the singleton template', () => {
    const ctx: Ctx = { buf: SINGLETON_O6_BLOCK_TEMPLATE, results: [] };
    const { chunks } = walkO6Chunks(ctx, 0, 0x01);
    ctx.results = []; // reset to inspect only checkO6Chunks output
    checkO6Chunks(ctx, chunks, 0x01);
    expect(ctx.results.find((r) => r.rule === '0x06 chunk count')?.severity).toBe('PASS');
    expect(ctx.results.find((r) => r.rule === '0x06 slot-pattern sequence')?.severity).toBe('PASS');
  });

  it('PASSes slot-3 tension-bump check (slot 3 = slot 0 + 6) for the singleton template', () => {
    const ctx: Ctx = { buf: SINGLETON_O6_BLOCK_TEMPLATE, results: [] };
    const { chunks } = walkO6Chunks(ctx, 0, 0x01);
    ctx.results = [];
    checkO6Chunks(ctx, chunks, 0x01);
    const slot3 = ctx.results.find((r) => r.rule.includes('slot-3 tension'));
    expect(slot3?.severity).toBe('PASS');
  });

  it('emits no FAIL rules across the multi-element template', () => {
    const ctx: Ctx = { buf: MULTI_O6_BLOCK_TEMPLATE, results: [] };
    const { chunks } = walkO6Chunks(ctx, 0, 0x03);
    ctx.results = [];
    checkO6Chunks(ctx, chunks, 0x03);
    expect(severityCounts(ctx.results).fail).toBe(0);
  });

  it('FAILs the chunk-count invariant when given fewer than 9 chunks', () => {
    const ctx: Ctx = { buf: SINGLETON_O6_BLOCK_TEMPLATE, results: [] };
    const { chunks } = walkO6Chunks(ctx, 0, 0x01);
    ctx.results = [];
    checkO6Chunks(ctx, chunks.slice(0, 5), 0x01);
    expect(ctx.results.find((r) => r.rule === '0x06 chunk count')?.severity).toBe('FAIL');
  });

  it('FAILs "chunks present" when handed an empty list', () => {
    const ctx: Ctx = { buf: new Uint8Array(0), results: [] };
    checkO6Chunks(ctx, [], 0x01);
    expect(ctx.results.find((r) => r.rule === '0x06 chunks present')?.severity).toBe('FAIL');
  });

  it('FAILs the slot-pattern sequence when one slot byte is mutated', () => {
    const buf = new Uint8Array(SINGLETON_O6_BLOCK_TEMPLATE);
    // Slot-pattern byte sits at payload.length - 2; locate the first chunk's
    // payload-end and zero its slot-pattern byte.
    const firstChunkPayloadLen = buf[3]! << 24 | buf[4]! << 16 | buf[5]! << 8 | buf[6]!;
    const firstChunkEnd = 7 + firstChunkPayloadLen;
    buf[firstChunkEnd - 2] = 0xff;
    const ctx: Ctx = { buf, results: [] };
    const { chunks } = walkO6Chunks(ctx, 0, 0x01);
    ctx.results = [];
    checkO6Chunks(ctx, chunks, 0x01);
    expect(ctx.results.find((r) => r.rule === '0x06 slot-pattern sequence')?.severity).toBe('FAIL');
  });
});
