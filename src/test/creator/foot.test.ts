// Foot module tests — registry, allowance checks, and the carriage
// planner. Pre-unification the planner lived in footSCarriagePlanner.ts
// and only ran for Foot S; after the unification it lives here on the
// Foot module and runs for every foot, with reach refusal as the only
// failure mode.

import { describe, it, expect } from 'vitest';
import {
  FEET,
  DEFAULT_FOOT_ID,
  foot,
  footFromByte,
  needleAllowedAt,
  jumpAllowedTo,
  type Foot,
} from '../../creator/foot.js';
import {
  DEFAULT_THREAD_TENSION,
  TENSION_MIN,
  TENSION_MAX,
  TENSION_STEP,
} from '../../creator/project.js';
import {
  planFoot,
  planFootGroupedBySegment,
} from '../../creator/carriagePlanner.js';
import { PER_RECORD_JUMP_CAP_MM } from '../../creator/sh7Limits.js';

describe('foot registry', () => {
  it('exposes only the V1 supported feet (S, B, hidden)', () => {
    expect(FEET.map((f) => f.id)).toEqual(['S', 'B', 'hidden']);
  });

  it('maps each id to its file byte', () => {
    const byId = Object.fromEntries(FEET.map((f) => [f.id, f.byte]));
    expect(byId).toEqual({ S: 0x07, B: 0x02, hidden: 0xff });
  });

  it('defaults to Foot S (the Side-motion foot)', () => {
    expect(DEFAULT_FOOT_ID).toBe('S');
  });

  it('defaults thread tension to 4.0 (matches the sample-file default of byte 0x28)', () => {
    expect(DEFAULT_THREAD_TENSION).toBe(4.0);
  });

  it('exposes a tension range that brackets the practical machine values', () => {
    expect(TENSION_MIN).toBe(2.0);
    expect(TENSION_MAX).toBe(7.0);
    expect(TENSION_STEP).toBe(0.1);
  });

  it('foot(id) returns the matching record', () => {
    expect(foot('S').byte).toBe(0x07);
    expect(foot('B').name).toContain('Decorative');
  });

  it('every foot has the 7 mm needle window (3.5 mm half)', () => {
    // Machine manual: stitch width 0..7 mm. Slot is foot-agnostic on this
    // machine family — Foot S's wider reach comes from the carriage's
    // side-motion, not from a wider slot.
    for (const f of FEET) {
      expect(f.needleSlotHalfMm).toBe(3.5);
    }
  });
});

describe('carriage reach by foot', () => {
  it('Foot B carriage reach is ±4.5 mm (empirical, the foot-B reference design)', () => {
    expect(foot('B').carriageReachHalfMm).toBe(4.5);
  });

  it('Foot S carriage reach is ±27.25 mm (side-motion)', () => {
    expect(foot('S').carriageReachHalfMm).toBe(27.25);
  });

  it('hidden inherits Foot S reach so the editor does not gate without cause', () => {
    expect(foot('hidden').carriageReachHalfMm).toBe(27.25);
  });
});

describe('footFromByte', () => {
  it('maps known V1 bytes to their foot record', () => {
    expect(footFromByte(0x07).id).toBe('S');
    expect(footFromByte(0x02).id).toBe('B');
    expect(footFromByte(0xff).id).toBe('hidden');
  });

  it('unknown bytes (including legacy A/C/J) fall back to the default foot (S)', () => {
    expect(footFromByte(0x01).id).toBe(DEFAULT_FOOT_ID);
    expect(footFromByte(0x03).id).toBe(DEFAULT_FOOT_ID);
    expect(footFromByte(0x06).id).toBe(DEFAULT_FOOT_ID);
    expect(footFromByte(0x42).id).toBe(DEFAULT_FOOT_ID);
  });
});

describe('needleAllowedAt — sweeps every foot', () => {
  const frame = { carriageXMm: 0, needleXMm: 0, needleYMm: 0 };

  it.each(FEET)('$id allows needle at carriage X (frame center)', (f) => {
    expect(needleAllowedAt(f, frame, 0).ok).toBe(true);
  });

  it.each(FEET)('$id allows needle at the slot edge (+needleSlotHalfMm)', (f) => {
    expect(needleAllowedAt(f, frame, f.needleSlotHalfMm).ok).toBe(true);
  });

  it.each(FEET)('$id rejects needle just past the slot edge', (f) => {
    const r = needleAllowedAt(f, frame, f.needleSlotHalfMm + 0.01);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('outside');
  });
});

describe('jumpAllowedTo — sweeps every foot', () => {
  const frame = { carriageXMm: 0, needleXMm: 0, needleYMm: 0 };

  it.each(FEET)('$id accepts a jump at the per-record cap', (f) => {
    expect(jumpAllowedTo(f, frame, PER_RECORD_JUMP_CAP_MM).ok).toBe(true);
  });

  it.each(FEET)('$id rejects a jump that exceeds the per-record cap', (f) => {
    const r = jumpAllowedTo(f, frame, PER_RECORD_JUMP_CAP_MM + 0.01);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('firmware envelope');
  });

  it.each(FEET)('$id rejects a jump that lands the carriage outside its reach', (f) => {
    const reach = f.carriageReachHalfMm;
    const atEdge = { carriageXMm: reach, needleXMm: reach, needleYMm: 0 };
    const r = jumpAllowedTo(f, atEdge, reach + 0.5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('range');
  });
});

// planFoot test config — historically a synthetic override when the
// production slot was 6 mm but the empirical hardware envelope was 7 mm.
// Production now matches the empirical 7 mm slot (NEEDLE_SLOT_HALF_MM = 3.5),
// so this is just a Foot S record. Kept as a separate alias to localize
// changes if planner tests ever need a different slot for what-if probes.
const CONFIG: Foot = { ...foot('S'), needleSlotHalfMm: 3.5 };

/** Asserts ok and returns the records (failing the test if the planner refused). */
function planRecordsOrFail(
  f: Foot,
  segments: ReadonlyArray<{ dxRaw: number; dyRaw: number }>,
) {
  const result = planFoot(f, segments);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('planFoot unexpectedly refused'); // for narrowing
  return result.records;
}

describe('planFoot — within-window short', () => {
  it('a 3 mm horizontal segment from cursor=0 emits one short (3 ≤ slot half 3.5)', () => {
    // 3 mm = 24 raw. |24 − 0| = 24 ≤ 28 = slotHalf → in-window single short.
    const records = planRecordsOrFail(CONFIG, [{ dxRaw: 24, dyRaw: 0 }]);

    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      kind: 'short',
      dxRaw: 24,
      dyRaw: 0,
      endXMm: 3,
      endYMm: 0,
      carriageXMm: 0,
    });
  });

  it('a 3.5 mm rightward push from cursor=0 sits exactly at the slot edge → still a short', () => {
    // |28 − 0| = 28 = slotHalf → boundary case, still in-window.
    const records = planRecordsOrFail(CONFIG, [{ dxRaw: 28, dyRaw: 0 }]);
    expect(records).toHaveLength(1);
    expect(records[0]?.kind).toBe('short');
  });
});

describe('planFoot — out-of-window: leading shorts then jumps walk the carriage', () => {
  it('a 5 mm rightward segment from cursor=0 sews until the slot edge, then walks the carriage', () => {
    // |40 − 0| = 40 > 28 = slotHalf → out of window for the whole segment.
    // Phase A consumes the slot reach (3.5 mm = 28 raw) in a single short
    // with the carriage planted at 0; Phase B walks the remaining 1.5 mm
    // as 1 mm + 0.5 mm jumps.
    const records = planRecordsOrFail(CONFIG, [{ dxRaw: 40, dyRaw: 0 }]);

    expect(records).toHaveLength(3);
    expect(records.map((r) => r.kind)).toEqual(['short', 'jump', 'jump']);
    // Phase A short: needle reaches the slot edge, carriage planted at 0.
    expect(records[0]?.dxRaw).toBe(28);
    expect(records[0]?.endXMm).toBe(3.5);
    expect(records[0]?.carriageXMm).toBe(0);
    // Phase B walks: cursor and carriage advance together.
    expect(records[1]?.dxRaw).toBe(8);
    expect(records[1]?.endXMm).toBe(4.5);
    expect(records[1]?.carriageXMm).toBe(1);
    const last = records[records.length - 1]!;
    expect(last.endXMm).toBe(5);
    // Carriage trails the cursor by exactly the slot half (3.5 mm) once
    // Phase A has pushed the needle out to the slot edge.
    expect(last.endXMm - last.carriageXMm).toBe(3.5);
  });

  it('two successive 10 mm segments — first sews up to the slot edge, then both walk the carriage', () => {
    const records = planRecordsOrFail(CONFIG, [
      { dxRaw: 80, dyRaw: 0 },
      { dxRaw: 80, dyRaw: 0 },
    ]);

    expect(records).toHaveLength(18);
    // First segment: 1 Phase-A short (cursor 0→3.5 mm) then 7 walks (six
    // 1 mm + one 0.5 mm) advancing carriage to 6.5 mm; cursor ends at 10 mm.
    expect(records[0]?.kind).toBe('short');
    expect(records.slice(1, 8).every((r) => r.kind === 'jump')).toBe(true);
    expect(records[7]?.endXMm).toBe(10);
    expect(records[7]?.carriageXMm).toBe(6.5);
    // Second segment: cursor enters with a slotHalf-sized lead on the
    // carriage, so Phase A has zero reach and every piece walks.
    expect(records.slice(8).every((r) => r.kind === 'jump')).toBe(true);
    expect(records[17]?.endXMm).toBe(20);
    expect(records[17]?.carriageXMm).toBe(16.5);
  });
});

describe('planFoot — sign preservation', () => {
  it('preserves negative dx through a mixed short/jump sequence', () => {
    // 10 mm in the −X direction. Mirror of the positive case: 1 Phase-A
    // short of dx=−28 then 7 walks (six dx=−8 + one dx=−4) — both signs
    // negative throughout.
    const records = planRecordsOrFail(CONFIG, [{ dxRaw: -80, dyRaw: 0 }]);

    expect(records).toHaveLength(8);
    for (const r of records) {
      expect(r.dxRaw).toBeLessThan(0);
      expect(r.dyRaw).toBe(0);
    }
    expect(records[0]?.kind).toBe('short');
    expect(records[0]?.dxRaw).toBe(-28);
    expect(records.slice(1).every((r) => r.kind === 'jump')).toBe(true);
    expect(records[7]?.endXMm).toBe(-10);
    expect(records[7]?.carriageXMm).toBe(-6.5);
  });

  it('preserves dy sign independent of dx sign (positive dx, negative dy)', () => {
    // 10 mm +X with −5 mm Y. dx = +80 raw, dy = −60 raw, proportionally
    // distributed across one Phase-A short and the Phase-B walks. Every
    // piece must carry the sign of its axis.
    const records = planRecordsOrFail(CONFIG, [{ dxRaw: 80, dyRaw: -60 }]);

    expect(records.length).toBeGreaterThan(1);
    let sumDx = 0;
    let sumDy = 0;
    for (const r of records) {
      expect(r.dxRaw).toBeGreaterThan(0);
      expect(r.dyRaw).toBeLessThan(0);
      sumDx += r.dxRaw;
      sumDy += r.dyRaw;
    }
    expect(sumDx).toBe(80);
    expect(sumDy).toBe(-60);
    // Mixed: a Phase-A short up to the slot edge, then Phase-B walks.
    expect(records.some((r) => r.kind === 'short')).toBe(true);
    expect(records.some((r) => r.kind === 'jump')).toBe(true);
  });
});

describe('planFoot — needle stays inside the carriage slot half (no one-sided drift)', () => {
  // The foot's slot is centered on the carriage with half-width = slotWidth / 2.
  // The mechanical truth: a needle stitch can land anywhere inside the slot,
  // i.e. |needleX − carriageX| ≤ slotHalf. A run-span check that allows the
  // cursor to drift to one side until the *full* slot width is consumed
  // permits the cursor to land outside the slot half — which on hardware
  // means the design would skip stitches the user can see in the preview.
  // Invariant for every emitted short: |endX − carriageX| ≤ slotHalf.
  it('every short record satisfies |endXMm − carriageXMm| ≤ slotHalf for a one-sided run', () => {
    const slotHalfRaw = CONFIG.needleSlotHalfMm * 8;
    const segs = Array.from({ length: 7 }, () => ({ dxRaw: 8, dyRaw: 0 }));
    const records = planRecordsOrFail(CONFIG, segs);

    for (const r of records) {
      if (r.kind !== 'short') continue;
      const endRaw = r.endXMm * 8;
      const carRaw = r.carriageXMm * 8;
      expect(Math.abs(endRaw - carRaw)).toBeLessThanOrEqual(slotHalfRaw);
    }
  });

  it('a 5 mm rightward push from cursor=0 cannot stay a single short (target would sit outside the slot half)', () => {
    const records = planRecordsOrFail(CONFIG, [{ dxRaw: 40, dyRaw: 0 }]);
    expect(records.some((r) => r.kind === 'jump')).toBe(true);
  });
});

describe('planFoot — firmware envelope (|dxHi| ≤ 1 for jumps; int8 dx for shorts)', () => {
  // The firmware caps each long-jump record at dxHi ∈ {-1, 0, +1} (verified
  // empirically on the foot-S reference designs).
  // Shorts use signed int8 dx (with the −128 byte reserved as the long-jump
  // prefix — see FORMAT.md §short stitch). The planner caps jump pieces at
  // X_UNITS_PER_MM raw (1 mm) and short pieces at 127 raw (int8 max).
  //
  // This test focuses on the per-piece dx envelope, not on reach. We use a
  // synthetic foot with the empirical 7 mm slot probe AND an extra-wide
  // reach so reach refusal can't shadow the envelope assertion at the wider
  // widths.
  const ENVELOPE_FOOT: Foot = { ...CONFIG, carriageReachHalfMm: 100 };
  it.each([
    { width: 65, label: '8.125 mm' },
    { width: 100, label: '12.5 mm' },
    { width: 256, label: '32 mm' },
    { width: -73, label: '−9.125 mm negative wide' },
  ])('jumps ≤ 8 raw, shorts ≤ 127 raw for a wide $label segment', ({ width }) => {
    const records = planRecordsOrFail(ENVELOPE_FOOT, [{ dxRaw: width, dyRaw: 0 }]);

    expect(records.length).toBeGreaterThan(0);
    // At least one piece must bust the slot — these widths all overflow.
    expect(records.some((r) => r.kind === 'jump')).toBe(true);
    for (const r of records) {
      if (r.kind === 'jump') {
        expect(Math.abs(r.dxRaw)).toBeLessThanOrEqual(8);
      } else {
        expect(Math.abs(r.dxRaw)).toBeLessThanOrEqual(127);
      }
    }
    // Pieces sum to the input dx exactly (no rounding loss).
    const sum = records.reduce((s, r) => s + r.dxRaw, 0);
    expect(sum).toBe(width);
  });
});

describe('planFoot — carriage tracking', () => {
  it('shorts leave the carriage planted; jumps walk it; subsequent shorts inherit the new carriage X', () => {
    // 1. 3 mm short from cursor=0: |3 − 0| ≤ 3.5 → in-window. cursor 0→3,
    //    carriage stays at 0.
    // 2. 10 mm bust from cursor=3, carriage=0: |13 − 0| = 13 > 3.5 → out
    //    of window. Phase A emits one short of dx=4 raw (the remaining
    //    slot reach from cursor=24 raw), then Phase B walks 10 jumps —
    //    9 × dx=8 + 1 × dx=4 — carrying both cursor and carriage to the
    //    right. After: cursor = 13, carriage = 9.5.
    // 3. −3 mm leftward short from cursor=13, carriage=9.5: target = 10,
    //    |10 − 9.5| = 0.5 ≤ 3.5 → in-window. cursor 13→10, carriage stays.
    const records = planRecordsOrFail(CONFIG, [
      { dxRaw: 24, dyRaw: 0 },
      { dxRaw: 80, dyRaw: 0 },
      { dxRaw: -24, dyRaw: 0 },
    ]);

    expect(records).toHaveLength(13); // 1 + (1 + 10) + 1

    expect(records[0]?.kind).toBe('short');
    expect(records[0]?.endXMm).toBe(3);
    expect(records[0]?.carriageXMm).toBe(0);

    // Phase A bridge short on segment 2 — needle reaches the slot edge
    // without moving the carriage.
    expect(records[1]?.kind).toBe('short');
    expect(records[1]?.endXMm).toBe(3.5);
    expect(records[1]?.carriageXMm).toBe(0);

    // Ten walking jumps on segment 2. The final walk is a 0.5 mm
    // remainder; the rest are 1 mm steps.
    for (let i = 2; i <= 11; i++) {
      expect(records[i]?.kind).toBe('jump');
    }
    // Final cursor + carriage after segment 2.
    expect(records[11]?.endXMm).toBe(13);
    expect(records[11]?.carriageXMm).toBe(9.5);

    expect(records[12]?.kind).toBe('short');
    expect(records[12]?.endXMm).toBe(10);
    expect(records[12]?.carriageXMm).toBe(9.5);
  });
});

describe('planFoot — leading-needle invariant for wide segments', () => {
  // The user-visible expectation behind issue #44: "the first stitch of
  // a wide segment should be a needle since the needle can still reach
  // there from a planted carriage". And "after a direction change, the
  // first stitch in the new direction should also be a needle". The
  // per-piece slot test gives us both: while cursor + dxPiece stays
  // inside the slot, emit shorts; only switch to jumps when sewing is no
  // longer mechanically possible.

  it('the very first piece of a wide segment is a needle (the cursor can reach into the slot)', () => {
    // 15 mm leftward sweep from the start position (cursor=0, carriage=0)
    // — the SAMPLE wave's first segment. Pre-fix: 15 jumps. Post-fix:
    // shorts while the cursor stays inside the slot, then jumps.
    const records = planRecordsOrFail(CONFIG, [{ dxRaw: -120, dyRaw: 32 }]);
    expect(records[0]?.kind).toBe('short');
  });

  it('the first piece after a direction change is a needle (the cursor enters the new slot direction)', () => {
    // Two segments: a wide leftward bust, then a wide rightward bust.
    // After the leftward bust ends, cursor and carriage trail at the
    // negative slot edge — the next segment's first piece reverses
    // direction, so the cursor moves back into the slot before busting
    // out the other side. That first reversing piece must be a short.
    const records = planRecordsOrFail(CONFIG, [
      { dxRaw: -120, dyRaw: 0 }, // 15 mm leftward
      { dxRaw: 120, dyRaw: 0 },  // 15 mm rightward
    ]);
    // Find the boundary between the two segments by summing dx until the
    // first segment's −120 raw is consumed.
    let i = 0;
    let sum = 0;
    while (i < records.length && sum > -120) {
      sum += records[i]!.dxRaw;
      i++;
    }
    // First piece of the second segment.
    expect(records[i]?.kind).toBe('short');
  });
});

describe('planFoot — OOW slot-reach coalescing (Phase A short + Phase B walks)', () => {
  // The slow path used to slice every wide segment into uniform 1 mm
  // pieces and decide short-or-jump after the fact. That left leading
  // in-slot pieces as a run of 1 mm shorts instead of one big short
  // reaching to the slot edge. The new planner emits Phase A — one (or a
  // few) shorts up to slot reach — then Phase B walks the carriage in
  // 1 mm jumps. (Coalescing consecutive in-slot shorts in the OOW branch.)

  it('a 5 mm pure-X bust from cursor=0 emits ONE short of dx=3.5 mm then 2 jumps', () => {
    // CONFIG.slotHalfRaw = 28. Phase A reach = 28 from cursor 0.
    // Phase A emits short(dx=28). Remaining 12 raw walks in 1 mm + 0.5 mm.
    const records = planRecordsOrFail(CONFIG, [{ dxRaw: 40, dyRaw: 0 }]);
    expect(records).toHaveLength(3);
    expect(records.map((r) => ({ kind: r.kind, dxRaw: r.dxRaw }))).toEqual([
      { kind: 'short', dxRaw: 28 },
      { kind: 'jump', dxRaw: 8 },
      { kind: 'jump', dxRaw: 4 },
    ]);
    expect(records[2]?.endXMm).toBe(5);
    expect(records[2]?.carriageXMm).toBe(1.5);
    expect(records[2]!.endXMm - records[2]!.carriageXMm).toBe(3.5);
  });

  it('two successive 10 mm rightward segments — Phase A on segment 0, then walks only', () => {
    // Seg 0 (cursor=0, carriage=0): Phase A short(dx=28). Phase B walks
    // remDx=52 raw → 6×dx=8 + 1×dx=4 = 7 jumps. Cursor ends at 80,
    // carriage at 52. Slot lead 3.5 mm.
    // Seg 1: cursor−carriage = 28 = slotHalf → Phase A reach = 0 → all
    // 10 pieces are 1 mm walks. Carriage ends 16.5 mm; cursor at 20 mm.
    const records = planRecordsOrFail(CONFIG, [
      { dxRaw: 80, dyRaw: 0 },
      { dxRaw: 80, dyRaw: 0 },
    ]);
    expect(records).toHaveLength(18);
    expect(records[0]).toMatchObject({ kind: 'short', dxRaw: 28 });
    expect(records.slice(1, 8).every((r) => r.kind === 'jump')).toBe(true);
    expect(records.slice(8).every((r) => r.kind === 'jump')).toBe(true);
    expect(records[17]?.endXMm).toBe(20);
    expect(records[17]?.carriageXMm).toBe(16.5);
  });

  it('a wide-AND-tall segment splits Phase A when proportional dy exceeds STITCH_DY_MAX_RAW', () => {
    // dx=40 raw (5 mm), dy=96 raw (8 mm). Phase A iter 1 wants dx=28
    // but proportional dy = 67 raw > 48 cap → shrink dx to 20 (=
    // round(40*48/96)) and emit short(20, 48). Phase A iter 2: cursor=20,
    // reach=8, emits short(dx=8, dy=19). Phase B remains (dx=12, dy=29).
    // Two leading shorts; every record stays inside the dy envelope.
    const records = planRecordsOrFail(CONFIG, [{ dxRaw: 40, dyRaw: 96 }]);
    expect(records).toHaveLength(4);
    expect(records[0]).toMatchObject({ kind: 'short', dxRaw: 20, dyRaw: 48 });
    expect(records[1]?.kind).toBe('short');
    for (const r of records) {
      expect(Math.abs(r.dyRaw)).toBeLessThanOrEqual(48);
    }
    expect(records.reduce((s, r) => s + r.dxRaw, 0)).toBe(40);
    expect(records.reduce((s, r) => s + r.dyRaw, 0)).toBe(96);
  });

  it('direction reversal opens fresh slot reach — first piece of the new direction is a long short', () => {
    // After 15 mm leftward (seg 1), cursor sits at the negative slot edge
    // (cursor=-120, carriage=-92). Reversing into a 15 mm rightward seg,
    // the cursor needs to cross 3.5 mm (back into slot) + 3.5 mm (out the
    // other side) before walking again → Phase A reach = slotHalf +
    // |cursor−carriage| = 28 + 28 = 56 raw. First piece of seg 2 must be
    // a short of dx=56.
    const records = planRecordsOrFail(CONFIG, [
      { dxRaw: -120, dyRaw: 0 },
      { dxRaw: 120, dyRaw: 0 },
    ]);
    // Walk forward summing dx until we cross the segment-1 boundary.
    let i = 0;
    let sum = 0;
    while (i < records.length && sum > -120) {
      sum += records[i]!.dxRaw;
      i++;
    }
    expect(records[i]?.kind).toBe('short');
    expect(records[i]?.dxRaw).toBe(56);
  });

  it('uniform mode (maxNeedleMm=1) is unchanged: 1 mm pieces, [short, short, short, jump, jump]', () => {
    // Production Foot S has slotHalfRaw=24. With maxNeedleDxRaw=8 the
    // Phase A reach is clamped to 1 mm/piece, identical to the v1
    // uniform-mode behavior. 5 mm segment = 3 shorts (cursor 1, 2, 3 mm)
    // then 2 jumps.
    const r = planFoot(foot('S'), [{ dxRaw: 40, dyRaw: 0 }], { maxNeedleMm: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.records.map((x) => x.kind)).toEqual([
      'short', 'short', 'short', 'jump', 'jump',
    ]);
    expect(r.records.every((x) => Math.abs(x.dxRaw) <= 8)).toBe(true);
  });
});

describe('planFoot — Y-cap subdivision (every record |dyRaw| ≤ STITCH_DY_MAX_RAW)', () => {
  // Pre-unification the planner had no per-record dy cap on the
  // in-slot fast path: a 12 mm pure-Y segment emitted a single record
  // with dyRaw=144, which the validator caught at byte time. After the
  // unification the planner subdivides for the firmware Y cap (4 mm,
  // 48 raw) up front so every emitted record fits both axes' envelopes.

  it('a tall narrow segment (dx=0, dy=12 mm) splits into 3 shorts of dy=48 each', () => {
    // dxRaw=0 → carriage never moves; every piece is a short. dy=144 raw
    // = 12 mm → n_y = ceil(144/48) = 3 pieces; the planner distributes
    // dy evenly (proportional split with no remainder).
    const records = planRecordsOrFail(CONFIG, [{ dxRaw: 0, dyRaw: 144 }]);

    expect(records).toHaveLength(3);
    for (const r of records) {
      expect(r.kind).toBe('short');
      expect(r.dxRaw).toBe(0);
      expect(Math.abs(r.dyRaw)).toBeLessThanOrEqual(48);
    }
    expect(records.reduce((s, r) => s + r.dyRaw, 0)).toBe(144);
    expect(records[2]?.endYMm).toBe(12);
    expect(records[2]?.carriageXMm).toBe(0);
  });

  it('a 5 mm pure-Y segment splits into 2 pieces (n_y = ceil(60/48) = 2)', () => {
    const records = planRecordsOrFail(CONFIG, [{ dxRaw: 0, dyRaw: 60 }]);

    expect(records).toHaveLength(2);
    for (const r of records) {
      expect(Math.abs(r.dyRaw)).toBeLessThanOrEqual(48);
    }
    expect(records.reduce((s, r) => s + r.dyRaw, 0)).toBe(60);
  });

  it('Foot B: tall narrow segment splits the same way (planner is foot-agnostic on Y cap)', () => {
    const records = planRecordsOrFail(foot('B'), [{ dxRaw: 0, dyRaw: 144 }]);

    expect(records).toHaveLength(3);
    expect(records.reduce((s, r) => s + r.dyRaw, 0)).toBe(144);
    for (const r of records) {
      expect(r.kind).toBe('short');
      expect(Math.abs(r.dyRaw)).toBeLessThanOrEqual(48);
    }
  });

  it('a wide AND tall segment honors the dy cap on every piece', () => {
    // dx=80 (10 mm), dy=144 (12 mm). Phase A's proportional dy would
    // overflow the dy cap → the leading short clips to dy=48 with dx
    // shrunk proportionally, then a second short uses up the remaining
    // slot reach. Phase B walks the rest.
    const records = planRecordsOrFail(CONFIG, [{ dxRaw: 80, dyRaw: 144 }]);
    expect(records.reduce((s, r) => s + r.dxRaw, 0)).toBe(80);
    expect(records.reduce((s, r) => s + r.dyRaw, 0)).toBe(144);
    for (const r of records) {
      expect(Math.abs(r.dyRaw)).toBeLessThanOrEqual(48);
      if (r.kind === 'jump') {
        expect(Math.abs(r.dxRaw)).toBeLessThanOrEqual(8);
      } else {
        expect(Math.abs(r.dxRaw)).toBeLessThanOrEqual(127);
      }
    }
  });
});

describe('planFoot — reach refusal', () => {
  // Foot B's ±4.5 mm reach is the empirical bound observed on the foot-B
  // reference design and confirmed on-machine. A segment that requires
  // walking the carriage past that point can't be sewn under Foot B; the
  // planner refuses with { ok: false, error: { code: 'reach', segmentIndex } }.

  it('a 12 mm rightward segment under Foot B refuses with code=reach, segmentIndex=0', () => {
    // 12 mm = 96 raw. Walking the carriage from 0 mm requires 9 mm of
    // reach; Foot B has 4.5 mm. The planner detects the overrun on the
    // jump piece that would push past 4.5 mm and refuses.
    const result = planFoot(foot('B'), [{ dxRaw: 96, dyRaw: 0 }]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('reach');
      expect(result.error.segmentIndex).toBe(0);
    }
  });

  it('the same 12 mm segment under Foot S exports cleanly (Foot S reach is 27.25 mm)', () => {
    const result = planFoot(foot('S'), [{ dxRaw: 96, dyRaw: 0 }]);
    expect(result.ok).toBe(true);
  });

  it('refusal segmentIndex points to the offending segment (not the first)', () => {
    // Two segments. First fits (3 mm under Foot B). Second is the wide
    // bust that refuses.
    const result = planFoot(foot('B'), [
      { dxRaw: 24, dyRaw: 0 },  // 3 mm — in slot, single short
      { dxRaw: 96, dyRaw: 0 },  // 12 mm — requires walking past Foot B's reach
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('reach');
      expect(result.error.segmentIndex).toBe(1);
    }
  });

  it('a 6 mm rightward segment under Foot B succeeds (carriage walks to 3 mm, within reach)', () => {
    // 6 mm = 48 raw. After 3 leading shorts (cursor 0→3, carriage 0),
    // the remaining 3 mm walks the carriage to 3 mm — well inside Foot
    // B's ±4.5 mm reach.
    const records = planRecordsOrFail(foot('B'), [{ dxRaw: 48, dyRaw: 0 }]);
    expect(records.length).toBeGreaterThan(0);
    const last = records[records.length - 1]!;
    expect(Math.abs(last.carriageXMm)).toBeLessThanOrEqual(4.5);
    expect(records.some((r) => r.kind === 'jump')).toBe(true);
  });
});

describe('planFootGroupedBySegment — per-segment buckets', () => {
  it('groups records back to their input segments via cumulative dx/dy', () => {
    // Three segments: in-window short, busted 10 mm, in-window leftward short
    // back toward the carriage.
    const segs = [
      { dxRaw: 24, dyRaw: 0 },
      { dxRaw: 80, dyRaw: 0 },
      { dxRaw: -24, dyRaw: 0 },
    ];
    const grouped = planFootGroupedBySegment(CONFIG, segs);
    const flat = planFoot(CONFIG, segs);
    expect(grouped.ok).toBe(true);
    expect(flat.ok).toBe(true);
    if (!grouped.ok || !flat.ok) return;

    expect(grouped.buckets).toHaveLength(3);
    expect(grouped.buckets[0]).toHaveLength(1);
    // Segment 2 (the 10 mm bust): 1 Phase-A short + 10 Phase-B walks.
    expect(grouped.buckets[1]).toHaveLength(11);
    expect(grouped.buckets[2]).toHaveLength(1);
    expect(grouped.buckets.flat()).toEqual(flat.records);
  });

  it('returns an empty bucket array for empty input', () => {
    const result = planFootGroupedBySegment(CONFIG, []);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.buckets).toEqual([]);
  });

  it('propagates reach refusal from the underlying planner', () => {
    const result = planFootGroupedBySegment(foot('B'), [
      { dxRaw: 96, dyRaw: 0 }, // 12 mm — past Foot B's reach
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('reach');
      expect(result.error.segmentIndex).toBe(0);
    }
  });
});

describe('planFoot — uniform mode (maxNeedleMm caps short stitches)', () => {
  // Compact mode (today): the fast path emits a single ~3 mm SHORT for any
  // segment that fits the carriage slot. Uniform mode tightens the per-record
  // length so needle stitches and jumps look the same on the fabric — every
  // record's |dxRaw| ≤ maxNeedleMm × 8 and |dyRaw| ≤ maxNeedleMm × 12.
  // The slice 1 contract is X-only — Y caps land in slice 2.

  it('a 2 mm X segment under Foot S with maxNeedleMm=1 splits into 2 shorts of |dx|≤8', () => {
    // 2 mm = 16 raw. In compact mode the segment fits the slot half (24 raw)
    // so today it would emit one SHORT of dx=16. Uniform mode rejects the
    // fast path because |16| > 8, then the slow-path piece sizing caps each
    // piece at 8 raw (1 mm). Both pieces still land in the slot, so both
    // emit as SHORTs (not jumps).
    const result = planFoot(foot('S'), [{ dxRaw: 16, dyRaw: 0 }], { maxNeedleMm: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.records).toHaveLength(2);
    for (const r of result.records) {
      expect(r.kind).toBe('short');
      expect(Math.abs(r.dxRaw)).toBeLessThanOrEqual(8);
    }
    // Pieces sum to the input dx exactly.
    expect(result.records.reduce((s, r) => s + r.dxRaw, 0)).toBe(16);
  });

  it('a 3 mm Y segment under Foot S with maxNeedleMm=1 splits into 3 shorts of |dy|≤12', () => {
    // 3 mm Y = 36 raw. Compact mode: fits the firmware Y envelope (48 raw)
    // and the slot half on X (dxRaw=0), so today emits one SHORT of dy=36.
    // Uniform mode rejects the fast path because |36| > 12 (1 mm Y in raw),
    // and the slow-path piece sizing caps each piece at 12 raw.
    const result = planFoot(foot('S'), [{ dxRaw: 0, dyRaw: 36 }], { maxNeedleMm: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.records).toHaveLength(3);
    for (const r of result.records) {
      expect(r.kind).toBe('short');
      expect(r.dxRaw).toBe(0);
      expect(Math.abs(r.dyRaw)).toBeLessThanOrEqual(12);
    }
    expect(result.records.reduce((s, r) => s + r.dyRaw, 0)).toBe(36);
  });

  it('still refuses with code=reach when uniform caps cannot rescue an out-of-reach segment', () => {
    // 12 mm rightward under Foot B — same case as the compact reach test
    // earlier in this file. Uniform's tighter caps split the segment into
    // more pieces, but the carriage still has to walk past Foot B's
    // ±4.5 mm reach. The planner must refuse — uniform mode is not
    // permitted to silently swallow reach errors.
    const result = planFoot(foot('B'), [{ dxRaw: 96, dyRaw: 0 }], { maxNeedleMm: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('reach');
      expect(result.error.segmentIndex).toBe(0);
    }
  });

  it('default opts equal { maxNeedleMm: Infinity } — compact behavior is preserved bit-for-bit', () => {
    // Pins the contract that the Infinity default doesn't perturb today's
    // output. A non-trivial mix of in-slot and bust-out segments under
    // Foot S, sampled in both modes, must produce deep-equal records.
    const segs = [
      { dxRaw: 24, dyRaw: 0 },   // 3 mm in-window short
      { dxRaw: 80, dyRaw: 0 },   // 10 mm bust → leading shorts + jumps
      { dxRaw: 80, dyRaw: 144 }, // 10×12 mm wide+tall — exercises both axes
      { dxRaw: -24, dyRaw: 0 },  // leftward in-window short
    ];
    const a = planFoot(foot('S'), segs);
    const b = planFoot(foot('S'), segs, { maxNeedleMm: Infinity });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) expect(b.records).toEqual(a.records);
  });
});

describe('test-only Foot literals (e.g. empirical 7 mm slot probe)', () => {
  // The empirical Foot S swing-window probe (the foot-S reference designs runs)
  // showed a 7 mm hardware envelope, even though production uses the
  // safer 6 mm setting. Tests can construct a synthetic Foot to probe
  // that envelope directly without touching production constants.
  it('a custom foot record drives needleAllowedAt with its own slot', () => {
    const f: Foot = { ...foot('S'), needleSlotHalfMm: 3.5 };
    expect(needleAllowedAt(f, { carriageXMm: 0, needleXMm: 0, needleYMm: 0 }, 3.5).ok).toBe(true);
    expect(needleAllowedAt(f, { carriageXMm: 0, needleXMm: 0, needleYMm: 0 }, 3.6).ok).toBe(false);
  });
});
