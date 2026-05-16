// Characterization tests for the metadata-table validator. The validator
// takes a body-start offset and reads a 0x01 0x08 ?? ?? BE32(len) header
// followed by `len` payload bytes. Each rule emits PASS / WARN / FAIL.

import { describe, expect, it } from 'vitest';
import { checkMetadataTable } from '../../../parser/validate/metadata.js';
import type { Ctx, Result } from '../../../parser/validate/types.js';
import { writeBE32 } from '../../../parser/bytes.js';

function buildMetadataTable(opts: {
  wrapperTag?: number;
  classByte?: number;
  declaredLen?: number;
  payloadBytes?: number;
} = {}): Uint8Array {
  const wrapperTag = opts.wrapperTag ?? 0x01;
  const classByte = opts.classByte ?? 0x08;
  const declaredLen = opts.declaredLen ?? 148;
  const payloadBytes = opts.payloadBytes ?? 148;
  // Header layout: tag (1) + n (1) + 2 unknown (2) + BE32 len (4) + 1 = 9
  // bytes before the payload starts. The validator advances by `9 + len`.
  const buf = new Uint8Array(9 + payloadBytes);
  buf[0] = wrapperTag;
  buf[1] = classByte;
  // bytes 2-3 are not inspected by the validator
  writeBE32(buf, 4, declaredLen);
  // byte 8 is not inspected either
  return buf;
}

function find(results: readonly Result[], rule: string): Result | undefined {
  return results.find((r) => r.rule === rule);
}

describe('checkMetadataTable', () => {
  it('PASSes all three rules and returns body + 9 + len for a valid 148-byte table', () => {
    const buf = buildMetadataTable();
    const ctx: Ctx = { buf, results: [] };
    const next = checkMetadataTable(ctx, 0x01, 0);
    expect(next).toBe(9 + 148);
    expect(find(ctx.results, 'metadata wrapper class byte')?.severity).toBe('PASS');
    expect(find(ctx.results, 'metadata-table length')?.severity).toBe('PASS');
  });

  it('FAILs and short-circuits when the wrapper tag is not 0x01', () => {
    const buf = buildMetadataTable({ wrapperTag: 0x02 });
    const ctx: Ctx = { buf, results: [] };
    const next = checkMetadataTable(ctx, 0x01, 0);
    // Validator returns bodyStart unchanged and emits only the tag FAIL.
    expect(next).toBe(0);
    expect(find(ctx.results, 'metadata wrapper tag')?.severity).toBe('FAIL');
    expect(ctx.results).toHaveLength(1);
  });

  it('WARNs but keeps parsing when the class byte is not 0x08', () => {
    const buf = buildMetadataTable({ classByte: 0x09 });
    const ctx: Ctx = { buf, results: [] };
    checkMetadataTable(ctx, 0x01, 0);
    expect(find(ctx.results, 'metadata wrapper class byte')?.severity).toBe('WARN');
  });

  it('WARNs when the BE32 length is not 148', () => {
    const buf = buildMetadataTable({ declaredLen: 144, payloadBytes: 144 });
    const ctx: Ctx = { buf, results: [] };
    checkMetadataTable(ctx, 0x01, 0);
    expect(find(ctx.results, 'metadata-table length')?.severity).toBe('WARN');
  });
});
