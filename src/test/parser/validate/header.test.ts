// Characterization tests for the file-header validator.
//
// Each test builds the smallest Uint8Array that exercises the rule under
// test and asserts the (rule, severity) shape of the emitted Result(s).
// FORMAT.md §file header is the spec being checked.

import { describe, expect, it } from 'vitest';
import { checkFileHeader } from '../../../parser/validate/header.js';
import type { Ctx, Result, Severity } from '../../../parser/validate/types.js';
import { writeBE16, writeBE32, writeUtf16BE } from '../../../parser/bytes.js';

// Build a minimum-viable file with a valid header. The body after the
// header is filler bytes long enough to satisfy the 7-byte outer-chunk
// reservation that checkFileHeader enforces.
function buildHeader(opts: {
  magic?: string;
  version?: readonly [number, number, number];
  declaredSize?: number;
  producer?: string;
  totalSize?: number;
} = {}): Uint8Array {
  const magic = opts.magic ?? '%spx%';
  const version = opts.version ?? ([0x01, 0x02, 0x01] as const);
  const producer = opts.producer ?? 'sh7pad';
  const prodBytes = producer.length * 2;
  // Default the total size to header + producer + 7 reserved for outer chunk.
  const totalSize = opts.totalSize ?? 0x0e + prodBytes + 7;
  const declaredSize = opts.declaredSize ?? totalSize - 12;
  const buf = new Uint8Array(totalSize);
  for (let i = 0; i < Math.min(magic.length, 5); i++) buf[i] = magic.charCodeAt(i);
  buf[5] = version[0];
  buf[6] = version[1];
  buf[7] = version[2];
  writeBE32(buf, 0x08, declaredSize);
  writeBE16(buf, 0x0c, prodBytes);
  writeUtf16BE(buf, 0x0e, producer);
  return buf;
}

function find(results: readonly Result[], rule: string): Result | undefined {
  return results.find((r) => r.rule === rule);
}

function severities(results: readonly Result[]): readonly Severity[] {
  return results.map((r) => r.severity);
}

describe('checkFileHeader', () => {
  it('returns the outer chunk offset for a valid header', () => {
    const buf = buildHeader(); // producer 'sh7pad' = 12 bytes
    const ctx: Ctx = { buf, results: [] };
    const out = checkFileHeader(ctx);
    expect(out).not.toBeNull();
    expect(out?.outerChunkOffset).toBe(0x0e + 12);
  });

  it('passes all four checks on a valid header', () => {
    const buf = buildHeader();
    const ctx: Ctx = { buf, results: [] };
    checkFileHeader(ctx);
    expect(severities(ctx.results)).toEqual(['PASS', 'PASS', 'PASS', 'PASS']);
  });

  it('returns null and emits FAIL on bad magic', () => {
    const buf = buildHeader({ magic: 'XXXXX' });
    const ctx: Ctx = { buf, results: [] };
    const out = checkFileHeader(ctx);
    expect(out).toBeNull();
    expect(find(ctx.results, 'magic')?.severity).toBe('FAIL');
  });

  it('keeps checking after a wrong version triple', () => {
    const buf = buildHeader({ version: [0x01, 0x02, 0x02] });
    const ctx: Ctx = { buf, results: [] };
    const out = checkFileHeader(ctx);
    expect(out).not.toBeNull();
    expect(find(ctx.results, 'version triple')?.severity).toBe('FAIL');
  });

  it('FAILs when the BE32 file-size does not match the buffer length', () => {
    const buf = buildHeader();
    // Bump the declared size by 1 to force a mismatch.
    writeBE32(buf, 0x08, buf.length - 12 + 1);
    const ctx: Ctx = { buf, results: [] };
    checkFileHeader(ctx);
    expect(find(ctx.results, 'file-size BE32')?.severity).toBe('FAIL');
  });

  it('returns null when the producer-string length pushes the outer chunk past EOF', () => {
    // 0x0e + prodLen + 7 must be <= buf.length. Bump prodLen so the math
    // overruns by exactly 1 byte.
    const buf = buildHeader();
    writeBE16(buf, 0x0c, buf.length - 0x0e - 7 + 1);
    const ctx: Ctx = { buf, results: [] };
    const out = checkFileHeader(ctx);
    expect(out).toBeNull();
    expect(find(ctx.results, 'producer-string length')?.severity).toBe('FAIL');
  });

  it('PASSes a non-default producer-string length that still leaves room for the outer chunk', () => {
    const buf = buildHeader({ producer: 'x' }); // 2 bytes
    const ctx: Ctx = { buf, results: [] };
    const out = checkFileHeader(ctx);
    expect(out?.outerChunkOffset).toBe(0x0e + 2);
    expect(find(ctx.results, 'producer-string length')?.severity).toBe('PASS');
  });
});
