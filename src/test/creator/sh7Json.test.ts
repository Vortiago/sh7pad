import { describe, it, expect } from 'vitest';
import {
  exportProjectJson,
  importProjectJson,
  SH7C_FILE_EXT,
  SH7C_MAGIC,
} from '../../creator/sh7Json.js';
import { newProject, SAMPLE } from '../../creator/project.js';
import type { ManualStitchInput } from '../../creator/types.js';

describe('sh7Json', () => {
  it('exposes the SH7C_FILE_EXT (.sh7c.json) and SH7C_MAGIC constants', () => {
    expect(SH7C_FILE_EXT).toBe('.sh7c.json');
    expect(SH7C_MAGIC).toBe('SH7C');
  });

  it('exportProjectJson includes magic, version, name, hoop, mode, points, segments, manualStitches', async () => {
    const p = newProject('Foo');
    const text = await exportProjectJson(p);
    const parsed = JSON.parse(text);
    expect(parsed.magic).toBe('SH7C');
    expect(parsed.version).toBe(1);
    expect(parsed.name).toBe('Foo');
    expect(parsed.hoop).toEqual(p.hoop);
    expect(parsed.mode).toBe('design');
    expect(parsed.points).toEqual(p.points);
    expect(parsed.segments).toEqual(p.segments);
    expect(parsed.manualStitches).toEqual([]);
  });

  it('importProjectJson restores a project from exportProjectJson output', async () => {
    const orig = SAMPLE();
    const restored = importProjectJson(await exportProjectJson(orig));
    expect(restored.name).toBe(orig.name);
    expect(restored.hoop).toEqual(orig.hoop);
    expect(restored.points).toEqual(orig.points);
    expect(restored.segments).toEqual(orig.segments);
  });

  it('importProjectJson assigns a fresh project id (not the exported one)', async () => {
    const orig = newProject('Foo');
    const restored = importProjectJson(await exportProjectJson(orig));
    expect(restored.id).not.toBe(orig.id);
  });

  it('importProjectJson uses the fallback name when payload has none', () => {
    const restored = importProjectJson(
      JSON.stringify({ magic: 'SH7C', version: 1 }),
      'Fallback',
    );
    expect(restored.name).toBe('Fallback');
  });

  it('importProjectJson rejects payloads without the SH7C magic', () => {
    expect(() => importProjectJson('{}')).toThrow(/SH7C/);
    expect(() => importProjectJson('{"magic":"WRONG"}')).toThrow(/SH7C/);
  });

  it('importProjectJson lets JSON.parse errors propagate', () => {
    expect(() => importProjectJson('{not json')).toThrow();
  });

  it('fills suggestedFoot and threadTension with defaults when payload omits them', () => {
    const legacy = {
      magic: 'SH7C',
      version: 1,
      name: 'Old',
      points: [{ id: 'a', x: 0, y: 0 }],
      segments: [],
    };
    const restored = importProjectJson(JSON.stringify(legacy));
    expect(restored.suggestedFoot).toBe('S');
    expect(restored.threadTension).toBe(4.0);
  });

  it('round-trips suggestedFoot and threadTension through export/import', async () => {
    const p = { ...newProject('Foo'), suggestedFoot: 'B' as const, threadTension: 5.5 };
    const restored = importProjectJson(await exportProjectJson(p));
    expect(restored.suggestedFoot).toBe('B');
    expect(restored.threadTension).toBe(5.5);
  });

  it('importProjectJson migrates older shapes (e.g. v1 hoop)', () => {
    const v1 = {
      magic: 'SH7C',
      version: 1,
      name: 'Old',
      hoop: { w: 240, h: 150 },
      points: [{ id: 'a', x: 50, y: 0 }],
      segments: [],
    };
    const restored = importProjectJson(JSON.stringify(v1));
    expect(restored.hoop.halfW).toBe(120);
    expect(restored.points[0]?.x).toBe(0);
  });

  it('round-trips a manual-mode project including its manualStitches', async () => {
    const base = newProject('Manual one', { mode: 'manual', suggestedFoot: 'S' });
    const manualStitches: ManualStitchInput[] = [
      { kind: 'needle', x: 0, y: 1.5, dxRaw: 0, dyRaw: 18 },
      { kind: 'jump',   x: 4, y: 1.5, dxRaw: 32, dyRaw: 0 },
      { kind: 'needle', x: 4, y: 3.0, dxRaw: 0, dyRaw: 18 },
    ];
    const orig = { ...base, manualStitches };

    const restored = importProjectJson(await exportProjectJson(orig));
    expect(restored.mode).toBe('manual');
    expect(restored.suggestedFoot).toBe('S');
    expect(restored.manualStitches).toEqual(manualStitches);
    expect(restored.segments).toEqual([]);
  });

  it('round-trips a project with a bg.blob (export base64, import back to Blob)', async () => {
    const base = newProject('With BG');
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
    const orig = {
      ...base,
      bg: {
        blob: new Blob([bytes], { type: 'image/png' }),
        x: 5, y: 7, scale: 1.5, rotate: 30, opacity: 0.4, locked: true,
      },
    };
    const restored = importProjectJson(await exportProjectJson(orig));
    expect(restored.bg).not.toBeNull();
    expect(restored.bg?.x).toBe(5);
    expect(restored.bg?.y).toBe(7);
    expect(restored.bg?.scale).toBe(1.5);
    expect(restored.bg?.rotate).toBe(30);
    expect(restored.bg?.opacity).toBe(0.4);
    expect(restored.bg?.locked).toBe(true);
    expect(restored.bg?.blob).toBeInstanceOf(Blob);
    expect(restored.bg?.blob.type).toBe('image/png');
    const restoredBytes = new Uint8Array(await restored.bg!.blob.arrayBuffer());
    expect(Array.from(restoredBytes)).toEqual(Array.from(bytes));
  });

  it('payloads without mode default to design (and empty manualStitches)', () => {
    const legacy = {
      magic: 'SH7C',
      version: 1,
      name: 'Pre-manual',
      points: [{ id: 'a', x: 0, y: 0 }],
      segments: [],
    };
    const restored = importProjectJson(JSON.stringify(legacy));
    expect(restored.mode).toBe('design');
    expect(restored.manualStitches).toEqual([]);
  });
});
