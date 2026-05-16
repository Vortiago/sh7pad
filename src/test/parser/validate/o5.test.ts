// Characterization tests for the 0x05 chunk validator + the 0x09 marker
// gate. Fixtures: nine encoded singleton 0x05 chunks (or nine multi-element
// chunks) concatenated into one buffer. Tension byte for slot 0 is fixed at
// 0x28; slot 3 is bumped to 0x28 + TENSION_BUMP per the schema.

import { describe, expect, it } from 'vitest';
import {
  check09Marker,
  checkO5Chunks,
  walkO5Chunks,
} from '../../../parser/validate/o5.js';
import type { Ctx, Result } from '../../../parser/validate/types.js';
import { encode05Chunk, encode05ChunkMulti, concat } from '../../../creator/sh7Codec.js';
import { TENSION_BUMP } from '../../../format/chunkSchema.js';

const BASE_TENSION = 0x28;

// The o5 encoders auto-bump slot 3 by TENSION_BUMP, so callers pass the
// pre-bump (canonical) tension byte for every slot and the encoder writes
// `tensionByte + TENSION_BUMP` for slot 3.

function buildSingletonO5Block(): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (let slot = 0; slot < 9; slot++) {
    chunks.push(
      encode05Chunk({
        slotIndex: slot,
        tensionByte: BASE_TENSION,
        xUm: 0,
        yUm: 0,
        xElem: 0,
      }),
    );
  }
  return concat(chunks);
}

function buildMultiO5Block(): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (let slot = 0; slot < 9; slot++) {
    chunks.push(
      encode05ChunkMulti({
        slotIndex: slot,
        tensionByte: BASE_TENSION,
        xUm: 0,
        yUm: 0,
      }),
    );
  }
  return concat(chunks);
}

function find(results: readonly Result[], rule: string): Result | undefined {
  return results.find((r) => r.rule === rule);
}

describe('check09Marker', () => {
  it('PASSes and advances past a 0x09 byte', () => {
    const ctx: Ctx = { buf: new Uint8Array([0x09]), results: [] };
    expect(check09Marker(ctx, 0)).toBe(1);
    expect(find(ctx.results, '0x09 marker')?.severity).toBe('PASS');
  });

  it('FAILs and does not advance when the byte is not 0x09', () => {
    const ctx: Ctx = { buf: new Uint8Array([0x07]), results: [] };
    expect(check09Marker(ctx, 0)).toBe(0);
    expect(find(ctx.results, '0x09 marker')?.severity).toBe('FAIL');
  });
});

describe('walkO5Chunks', () => {
  it('walks all nine singleton chunks out of a valid block', () => {
    const buf = buildSingletonO5Block();
    const ctx: Ctx = { buf, results: [] };
    const out = walkO5Chunks(ctx, 0, 0x01);
    expect(out.chunks).toHaveLength(9);
    expect(out.nextOff).toBe(buf.length);
  });

  it('FAILs and stops at a chunk with the wrong version byte', () => {
    const buf = buildSingletonO5Block();
    buf[2] = 0x03; // mutate first chunk's ver
    const ctx: Ctx = { buf, results: [] };
    const out = walkO5Chunks(ctx, 0, 0x01);
    expect(find(ctx.results, '0x05 version')?.severity).toBe('FAIL');
    expect(out.nextOff).toBe(0); // points at the bad chunk so the driver doesn't skip
  });

  it('FAILs the class-byte rule when n does not match the declared class', () => {
    const buf = buildSingletonO5Block();
    const ctx: Ctx = { buf, results: [] };
    walkO5Chunks(ctx, 0, 0x03); // declare multi but block is singleton
    expect(find(ctx.results, '0x05 class byte')?.severity).toBe('FAIL');
  });
});

describe('checkO5Chunks', () => {
  it('PASSes count + slot-pattern + slot-3 tension bump for nine valid singletons', () => {
    const buf = buildSingletonO5Block();
    const ctx: Ctx = { buf, results: [] };
    const { chunks } = walkO5Chunks(ctx, 0, 0x01);
    ctx.results = [];
    checkO5Chunks(ctx, chunks, 0x01);
    expect(find(ctx.results, '0x05 chunk count')?.severity).toBe('PASS');
    expect(find(ctx.results, '0x05 slot-pattern sequence')?.severity).toBe('PASS');
    const slot3 = ctx.results.find((r) => r.rule.includes(`slot-3 tension+${TENSION_BUMP}`));
    expect(slot3?.severity).toBe('PASS');
  });

  it('emits no FAIL rules on a valid multi-element block', () => {
    const buf = buildMultiO5Block();
    const ctx: Ctx = { buf, results: [] };
    const { chunks } = walkO5Chunks(ctx, 0, 0x03);
    ctx.results = [];
    checkO5Chunks(ctx, chunks, 0x03);
    expect(ctx.results.filter((r) => r.severity === 'FAIL')).toEqual([]);
  });

  it('FAILs the chunk-count invariant when the list is short', () => {
    const buf = buildSingletonO5Block();
    const ctx: Ctx = { buf, results: [] };
    const { chunks } = walkO5Chunks(ctx, 0, 0x01);
    ctx.results = [];
    checkO5Chunks(ctx, chunks.slice(0, 4), 0x01);
    expect(find(ctx.results, '0x05 chunk count')?.severity).toBe('FAIL');
  });

  it('FAILs "chunks present" when handed an empty list', () => {
    const ctx: Ctx = { buf: new Uint8Array(0), results: [] };
    checkO5Chunks(ctx, [], 0x01);
    expect(find(ctx.results, '0x05 chunks present')?.severity).toBe('FAIL');
  });

  it('WARNs when slot 3 tension is not slot 0 + TENSION_BUMP', () => {
    // The encoder always bumps slot 3, so post-mutate the slot-3 tension
    // byte to break the invariant. Singleton chunks are 39 bytes each
    // (7-byte header + 32-byte payload). The tension byte lives at the
    // schema-owned 0x05 tension offset, payload-relative.
    const buf = buildSingletonO5Block();
    const slotSize = 39;
    const tensionPayloadOff = 0x10; // o5FieldOffset('singleton', 'tension')
    const slot3Off = 3 * slotSize + 7 + tensionPayloadOff;
    buf[slot3Off] = BASE_TENSION; // un-bump
    const ctx: Ctx = { buf, results: [] };
    const { chunks: walked } = walkO5Chunks(ctx, 0, 0x01);
    ctx.results = [];
    checkO5Chunks(ctx, walked, 0x01);
    const slot3 = ctx.results.find((r) => r.rule.includes('slot-3 tension'));
    expect(slot3?.severity).toBe('WARN');
  });
});
