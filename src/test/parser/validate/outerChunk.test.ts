// Characterization tests for the outer 0x07 chunk validator. Each test
// builds a tiny buffer where the outer chunk is at offset 0 (the
// validator takes the offset as an argument, so we don't need real
// file-header bytes around it).

import { describe, expect, it } from 'vitest';
import { checkOuterChunk } from '../../../parser/validate/outerChunk.js';
import type { Ctx, Result, Severity } from '../../../parser/validate/types.js';
import { writeBE32 } from '../../../parser/bytes.js';

// Build an outer chunk body of `bodyLen` bytes followed by an optional
// 0x06 marker at the start of the body so the validator can detect the
// class byte.
function buildOuterChunk(opts: {
  nn?: number;
  version?: number;
  bodyLen?: number;
  classByte?: number | null;
  tag?: number;
} = {}): Uint8Array {
  const nn = opts.nn ?? 0x01;
  const version = opts.version ?? 0x01;
  const bodyLen = opts.bodyLen ?? 16;
  const tag = opts.tag ?? 0x07;
  const buf = new Uint8Array(7 + bodyLen);
  buf[0] = tag;
  buf[1] = nn;
  buf[2] = version;
  writeBE32(buf, 3, bodyLen);
  // Optionally seed a 0x06 marker at body offset 0 so the validator
  // picks up the class byte.
  if (opts.classByte != null) {
    buf[7] = 0x06;
    buf[8] = opts.classByte;
    buf[9] = 0x02;
  }
  return buf;
}

function find(results: readonly Result[], rule: string): Result | undefined {
  return results.find((r) => r.rule === rule);
}

function severities(results: readonly Result[]): readonly Severity[] {
  return results.map((r) => r.severity);
}

describe('checkOuterChunk', () => {
  it('returns body bounds and NN/class for a valid singleton chunk', () => {
    const buf = buildOuterChunk({ nn: 0x01, classByte: 0x01 });
    const ctx: Ctx = { buf, results: [] };
    const out = checkOuterChunk(ctx, 0);
    expect(out).not.toBeNull();
    expect(out?.nn).toBe(0x01);
    expect(out?.classByte).toBe(0x01);
    expect(out?.bodyStart).toBe(7);
    expect(out?.bodyEnd).toBe(buf.length);
  });

  it('returns body bounds for a valid multi-element chunk', () => {
    const buf = buildOuterChunk({ nn: 0x05, classByte: 0x03 });
    const ctx: Ctx = { buf, results: [] };
    const out = checkOuterChunk(ctx, 0);
    expect(out?.nn).toBe(0x05);
    expect(out?.classByte).toBe(0x03);
  });

  it('falls back to NN-derived class byte when no 0x06 marker is in the body', () => {
    // NN=1 → classByte fallback 1. No 0x06 chunk in the body.
    const buf = buildOuterChunk({ nn: 0x01 });
    const ctx: Ctx = { buf, results: [] };
    const out = checkOuterChunk(ctx, 0);
    expect(out?.classByte).toBe(1);

    const buf2 = buildOuterChunk({ nn: 0x05 });
    const ctx2: Ctx = { buf: buf2, results: [] };
    const out2 = checkOuterChunk(ctx2, 0);
    expect(out2?.classByte).toBe(3);
  });

  it('returns null and FAILs when the tag byte is not 0x07', () => {
    const buf = buildOuterChunk({ tag: 0x08 });
    const ctx: Ctx = { buf, results: [] };
    expect(checkOuterChunk(ctx, 0)).toBeNull();
    expect(find(ctx.results, 'outer chunk tag')?.severity).toBe('FAIL');
  });

  it('WARNs for unsupported NN values but keeps parsing', () => {
    const buf = buildOuterChunk({ nn: 0x02, classByte: 0x01 });
    const ctx: Ctx = { buf, results: [] };
    const out = checkOuterChunk(ctx, 0);
    expect(out).not.toBeNull();
    expect(find(ctx.results, 'outer NN')?.severity).toBe('WARN');
  });

  it('FAILs on a wrong outer-chunk version byte', () => {
    const buf = buildOuterChunk({ version: 0x02, classByte: 0x01 });
    const ctx: Ctx = { buf, results: [] };
    checkOuterChunk(ctx, 0);
    expect(find(ctx.results, 'outer chunk version')?.severity).toBe('FAIL');
  });

  it('FAILs when the declared BE32 body length does not reach EOF', () => {
    const buf = buildOuterChunk({ bodyLen: 16 });
    // Trim the buffer by 2 bytes so bodyEnd > buf.length.
    const ctx: Ctx = { buf: buf.slice(0, buf.length - 2), results: [] };
    checkOuterChunk(ctx, 0);
    expect(find(ctx.results, 'outer chunk length')?.severity).toBe('FAIL');
  });

  it('PASSes every check on a valid singleton outer chunk', () => {
    const buf = buildOuterChunk({ nn: 0x01, classByte: 0x01 });
    const ctx: Ctx = { buf, results: [] };
    checkOuterChunk(ctx, 0);
    // Four checks: tag, NN, version, length.
    expect(severities(ctx.results)).toEqual(['PASS', 'PASS', 'PASS', 'PASS']);
  });
});
