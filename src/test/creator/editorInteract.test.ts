import { describe, it, expect, vi } from 'vitest';
import {
  hoopFromClient,
  clampToHoopAndLimit,
  createEditorInteract,
  determineActionFromPointer,
  liveBoundsForClick,
  type Tool,
} from '../../ui/creator/editor/interact.js';
import {
  isInsideBounds,
  liveWindowGeometry,
} from '../../ui/creator/editor/interactMath.js';
import type { View } from '../../ui/creator/editor/view.js';
import { newProject } from '../../creator/project.js';
import type { Project } from '../../creator/types.js';

const view: View = { zoom: 5, offsetX: 100, offsetY: 50, fitZoom: 1 };

describe('hoopFromClient', () => {
  it('translates client-px to hoop mm using view.zoom and offsets', () => {
    // (clientX - rect.left - offsetX) / zoom
    // With rect.left=0, clientX=125, offsetX=100, zoom=5 → (125-100)/5 = 5mm
    const out = hoopFromClient({ clientX: 125, clientY: 60 }, { left: 0, top: 0 } as DOMRect, view);
    expect(out.x).toBeCloseTo(5);
    expect(out.y).toBeCloseTo(2);
  });
});

describe('clampToHoopAndLimit', () => {
  it('clamps X to ±effLim and Y to [0, H]', () => {
    const r = clampToHoopAndLimit({ x: 100, y: -5 }, { effLim: 27.25, H: 150 });
    expect(r.x).toBe(27.25);
    expect(r.y).toBe(0);
  });

  it('passes values through when in range', () => {
    const r = clampToHoopAndLimit({ x: 5, y: 10 }, { effLim: 27.25, H: 150 });
    expect(r.x).toBe(5);
    expect(r.y).toBe(10);
  });

  it('clamps negative X to -effLim', () => {
    const r = clampToHoopAndLimit({ x: -100, y: 10 }, { effLim: 3.5, H: 150 });
    expect(r.x).toBe(-3.5);
  });
});

describe('determineActionFromPointer', () => {
  const e = (overrides: Partial<{ button: number; altKey: boolean }>) => ({
    button: 0, altKey: false, ...overrides,
  });

  it('treats pan tool as pan regardless of button', () => {
    expect(determineActionFromPointer(e({}), 'pan' as Tool)).toBe('pan');
  });

  it('treats middle-click as pan even when tool is add', () => {
    expect(determineActionFromPointer(e({ button: 1 }), 'add' as Tool)).toBe('pan');
  });

  it('treats right-click as pan', () => {
    expect(determineActionFromPointer(e({ button: 2 }), 'add' as Tool)).toBe('pan');
  });

  it('treats Alt+left-click as pan', () => {
    expect(determineActionFromPointer(e({ altKey: true }), 'add' as Tool)).toBe('pan');
  });

  it('treats plain left-click in add tool as add', () => {
    expect(determineActionFromPointer(e({}), 'add' as Tool)).toBe('add');
  });

  it('treats plain left-click in move tool as move', () => {
    expect(determineActionFromPointer(e({}), 'move' as Tool)).toBe('move');
  });

  it('treats plain left-click in select tool as select (no add, no drag)', () => {
    expect(determineActionFromPointer(e({}), 'select' as Tool)).toBe('select');
  });

  it('still routes Alt+left-click in select tool to pan', () => {
    expect(determineActionFromPointer(e({ altKey: true }), 'select' as Tool)).toBe('pan');
  });
});

describe('createInteractionHandlers (smoke)', () => {
  it('module exports the expected helpers', async () => {
    const mod = await import('../../ui/creator/editor/interact.js');
    expect(typeof mod.hoopFromClient).toBe('function');
    expect(typeof mod.clampToHoopAndLimit).toBe('function');
    expect(typeof mod.determineActionFromPointer).toBe('function');
    // The full createEditorInteract function is wired up in main.ts integration tests.
    expect(typeof mod.createEditorInteract).toBe('function');
  });

  it('createEditorInteract returns an object with attach/detach/setTool methods', async () => {
    const mod = await import('../../ui/creator/editor/interact.js');
    const onAddPoint = vi.fn();
    const onSelectPoint = vi.fn();
    const onMovePoint = vi.fn();
    const onSelectSegment = vi.fn();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    const handlers = mod.createEditorInteract(svg, {
      getView: () => view,
      getProject: () => ({ hoop: { halfW: 60, h: 150 }, suggestedFoot: 'B', points: [{ id: 'p1', x: 0, y: 0 }] } as never),
      onAddPoint,
      onSelectPoint,
      onMovePoint,
      onSelectSegment,
      onHover: () => {},
    });
    expect(typeof handlers.setTool).toBe('function');
    expect(typeof handlers.attach).toBe('function');
    expect(typeof handlers.detach).toBe('function');
  });
});

describe('createEditorInteract — drag flows (regression coverage)', () => {
  // Each drag flow has caused a regression at least once during development:
  //   - Point drag depends on `dragging`, NOT on `dragStart` (regression: a
  //     refactor that gated the move handler on dragStart broke Move tool).
  //   - Pan & BG drag DO use `dragStart` because they need a per-frame delta.
  // These tests exercise the three flows independently so the gate stays
  // correct.

  function setup(opts: {
    points?: Array<{ id: string; x: number; y: number }>;
    bg?: { locked?: boolean } | null;
    initialTool?: Tool;
  } = {}) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    });
    const points = opts.points ?? [{ id: 'p1', x: 5, y: 10 }];
    const project = {
      hoop: { halfW: 60, h: 150 },
      suggestedFoot: 'S' as const,
      points,
      segments: [],
      bg: opts.bg ? { blob: new Blob([new Uint8Array([0])], { type: 'image/png' }), x: 0, y: 0, scale: 1, rotate: 0, opacity: 0.5, ...opts.bg } : null,
    };
    const spies = {
      onAddPoint: vi.fn(),
      onSelectPoint: vi.fn(),
      onMovePoint: vi.fn(),
      onSelectSegment: vi.fn(),
      onHover: vi.fn(),
      onPan: vi.fn(),
      onBgMove: vi.fn(),
    };
    // Build a point group so pointer hits resolve to a [data-point-id] target.
    for (const pt of points) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('data-point-id', pt.id);
      svg.appendChild(g);
    }
    if (project.bg) {
      const bgG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      bgG.setAttribute('data-role', 'bg-image');
      svg.appendChild(bgG);
    }
    const handle = createEditorInteract(svg, {
      getView: () => view,
      getProject: () => project as never,
      ...spies,
    });
    handle.setTool(opts.initialTool ?? 'select');
    handle.attach();
    return { svg, handle, spies };
  }

  it('Move tool: pointerdown on a point + pointermove fires onMovePoint with raw mm coords (no snap)', async () => {
    const { svg, handle, spies } = setup({ initialTool: 'move' });
    const ptGroup = svg.querySelector('[data-point-id="p1"]')!;

    ptGroup.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 0, clientY: 0,
    }) as unknown as PointerEvent);
    // Pick a non-integer cursor so we'd notice if snap crept back in.
    // (175.7 - 100) / 5 = 15.14mm  ;  (80.3 - 50) / 5 = 6.06mm
    window.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: 175.7, clientY: 80.3,
    }) as unknown as PointerEvent);

    expect(spies.onMovePoint).toHaveBeenCalled();
    const [id, point] = spies.onMovePoint.mock.calls[0]!;
    expect(id).toBe('p1');
    expect(point.x).toBeCloseTo(15.14);
    expect(point.y).toBeCloseTo(6.06);
    handle.detach();
  });

  it('Pan: middle-mouse drag fires onPan with pixel deltas', () => {
    const { svg, handle, spies } = setup({ initialTool: 'select' });
    svg.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 1, clientX: 100, clientY: 100,
    }) as unknown as PointerEvent);
    window.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: 130, clientY: 110,
    }) as unknown as PointerEvent);
    expect(spies.onPan).toHaveBeenCalledWith(30, 10);
    handle.detach();
  });

  it('BG drag: pointerdown on the bg image + pointermove fires onBgMove with mm deltas', () => {
    const { svg, handle, spies } = setup({ bg: {}, initialTool: 'select' });
    const bgGroup = svg.querySelector('[data-role="bg-image"]')!;
    bgGroup.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 200, clientY: 200,
    }) as unknown as PointerEvent);
    window.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: 250, clientY: 220,
    }) as unknown as PointerEvent);
    // 50px / zoom(5) = 10mm  ;  20px / zoom(5) = 4mm
    expect(spies.onBgMove).toHaveBeenCalledWith(10, 4);
    handle.detach();
  });

  it('BG drag is suppressed when bg.locked is true (the click falls through)', () => {
    const { svg, handle, spies } = setup({ bg: { locked: true }, initialTool: 'select' });
    const bgGroup = svg.querySelector('[data-role="bg-image"]')!;
    bgGroup.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 200, clientY: 200,
    }) as unknown as PointerEvent);
    window.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: 250, clientY: 220,
    }) as unknown as PointerEvent);
    expect(spies.onBgMove).not.toHaveBeenCalled();
    handle.detach();
  });

  it('Select tool: clicking a point fires onSelectPoint, no drag starts', () => {
    const { svg, handle, spies } = setup({ initialTool: 'select' });
    const ptGroup = svg.querySelector('[data-point-id="p1"]')!;
    ptGroup.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 0, clientY: 0,
    }) as unknown as PointerEvent);
    // A subsequent pointermove must NOT fire a move (no drag in progress).
    window.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: 200, clientY: 200,
    }) as unknown as PointerEvent);
    expect(spies.onSelectPoint).toHaveBeenCalledWith('p1');
    expect(spies.onMovePoint).not.toHaveBeenCalled();
    handle.detach();
  });

  it('Add tool: clicking on an existing point lays a co-located new point (backtrack)', () => {
    const { svg, handle, spies } = setup({
      points: [{ id: 'p1', x: -5, y: 12 }],
      initialTool: 'add',
    });
    const ptGroup = svg.querySelector('[data-point-id="p1"]')!;
    ptGroup.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 0, clientY: 0,
    }) as unknown as PointerEvent);
    expect(spies.onAddPoint).toHaveBeenCalledTimes(1);
    const [point] = spies.onAddPoint.mock.calls[0]!;
    expect(point).toEqual({ x: -5, y: 12 });
    handle.detach();
  });

  it('Add tool (design mode): click on empty canvas forwards raw mm coords — no editor-side snap', () => {
    const { svg, handle, spies } = setup({ initialTool: 'add' });
    // (147.3 - 100) / 5 = 9.46mm  ;  (62.8 - 50) / 5 = 2.56mm
    svg.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 147.3, clientY: 62.8,
    }) as unknown as PointerEvent);
    expect(spies.onAddPoint).toHaveBeenCalledTimes(1);
    const [pt] = spies.onAddPoint.mock.calls[0]!;
    expect(pt.x).toBeCloseTo(9.46);
    expect(pt.y).toBeCloseTo(2.56);
    handle.detach();
  });

  it('Move tool: hover (pointermove with no drag) fires onHover but NOT onMovePoint', () => {
    const { svg, handle, spies } = setup({ initialTool: 'move' });
    void svg;
    window.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: 200, clientY: 100,
    }) as unknown as PointerEvent);
    expect(spies.onHover).toHaveBeenCalled();
    expect(spies.onMovePoint).not.toHaveBeenCalled();
    handle.detach();
  });

  it('hover reports raw + clamped coords; the on-canvas dot tracks the cursor 1:1', () => {
    // The editor does not snap. The hover dot must land exactly under the
    // cursor so a follow-up click places a point at the same visible spot
    // (no jump-on-click). Pick a non-integer cursor so we'd notice if snap
    // crept back in.
    const { handle, spies } = setup({ initialTool: 'add' });
    // (203.4 - 100) / 5 = 20.68mm  ;  (103.2 - 50) / 5 = 10.64mm
    window.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: 203.4, clientY: 103.2,
    }) as unknown as PointerEvent);
    const last = spies.onHover.mock.calls.at(-1)![0];
    expect(last.x).toBeCloseTo(20.68);
    expect(last.y).toBeCloseTo(10.64);
    handle.detach();
  });

  it('hover is hidden (null) when the cursor is outside the touchable area', () => {
    const { handle, spies } = setup({ initialTool: 'add' });
    // hoop.halfW = 60, so X ≥ 100 + 60*5 = 400 lies past the right edge.
    window.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: 500, clientY: 100,
    }) as unknown as PointerEvent);
    expect(spies.onHover).toHaveBeenLastCalledWith(null);
    handle.detach();
  });

  it('detach() removes pointer listeners (no further events processed)', () => {
    const { svg, handle, spies } = setup({ initialTool: 'move' });
    handle.detach();
    const ptGroup = svg.querySelector('[data-point-id="p1"]')!;
    ptGroup.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 0, clientY: 0,
    }) as unknown as PointerEvent);
    window.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: 175, clientY: 80,
    }) as unknown as PointerEvent);
    expect(spies.onSelectPoint).not.toHaveBeenCalled();
    expect(spies.onMovePoint).not.toHaveBeenCalled();
  });
});

describe('createEditorInteract — manual mode click gating', () => {
  // Foot S manual project starts with the carriage parked at X = 0, so the
  // needle window is [-3, 3] mm. Foot S also gates jump dx to ±1 mm of the
  // current needle. A click outside either window must be rejected entirely
  // — no snap-and-clamp fallback that would silently put the stitch at the
  // boundary the user didn't click.

  function setupManual(opts: {
    activeStitch: 'needle' | 'jump';
    manualStitches?: Array<{ kind: 'needle' | 'jump'; x: number; y: number; dxRaw?: number; dyRaw?: number }>;
    foot?: 'S' | 'B';
  }) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    });
    const project = {
      mode: 'manual' as const,
      hoop: { halfW: 60, h: 150 },
      suggestedFoot: opts.foot ?? 'S',
      points: [{ id: 'start', x: 0, y: 0 }],
      segments: [],
      manualStitches: (opts.manualStitches ?? []).map((s) => ({
        ...s,
        dxRaw: s.dxRaw ?? Math.round(s.x * 8),
        dyRaw: s.dyRaw ?? Math.round(s.y * 8),
      })),
      bg: null,
    };
    const spies = {
      onAddPoint: vi.fn(),
      onSelectPoint: vi.fn(),
      onMovePoint: vi.fn(),
      onSelectSegment: vi.fn(),
      onHover: vi.fn(),
      onHoverValidity: vi.fn(),
      onPan: vi.fn(),
      onBgMove: vi.fn(),
    };
    const handle = createEditorInteract(svg, {
      getView: () => view,
      getProject: () => project as never,
      ...spies,
    });
    handle.setTool('add');
    handle.setActiveStitch(opts.activeStitch);
    handle.attach();
    return { svg, handle, spies };
  }

  // Helpers: at view zoom 5 / offsetX 100 / offsetY 50, hoop x maps to
  // clientX = offsetX + x*zoom = 100 + x*5; hoop y maps to clientY = 50 + y*5.
  const cx = (x: number) => 100 + x * 5;
  const cy = (y: number) => 50 + y * 5;

  it('rejects a needle click outside carriageX ± 3 mm — no onAddPoint', () => {
    const { svg, handle, spies } = setupManual({ activeStitch: 'needle' });
    svg.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: cx(10), clientY: cy(0),
    }) as unknown as PointerEvent);
    expect(spies.onAddPoint).not.toHaveBeenCalled();
    handle.detach();
  });

  it('accepts a needle click inside carriageX ± 3 mm — fires onAddPoint with kind=needle', () => {
    const { svg, handle, spies } = setupManual({ activeStitch: 'needle' });
    svg.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: cx(2), clientY: cy(1),
    }) as unknown as PointerEvent);
    expect(spies.onAddPoint).toHaveBeenCalledTimes(1);
    const [point, kind] = spies.onAddPoint.mock.calls[0]!;
    expect(point.x).toBe(2);
    expect(point.y).toBe(1);
    expect(kind).toBe('needle');
    handle.detach();
  });

  it('after a jump moves the carriage, the live needle window slides to follow it', () => {
    // Foot S: only jumps advance the carriage (needles use the foot's side-motion to
    // reach off-axis without moving the carriage). One jump of dx=1 takes
    // the carriage from 0 → 1, so the next needle window becomes
    // [1-3, 1+3] = [-2, 4]. A click at x=4 is the new edge — valid; a
    // click at x=-3 is now outside — rejected.
    const { svg, handle, spies } = setupManual({
      activeStitch: 'needle',
      manualStitches: [{ kind: 'jump', x: 1, y: 0 }],
    });
    svg.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: cx(4), clientY: cy(0),
    }) as unknown as PointerEvent);
    expect(spies.onAddPoint).toHaveBeenCalledTimes(1);
    spies.onAddPoint.mockClear();
    svg.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: cx(-3), clientY: cy(0),
    }) as unknown as PointerEvent);
    expect(spies.onAddPoint).not.toHaveBeenCalled();
    handle.detach();
  });

  it('rejects a jump click whose dx exceeds 1 mm from the current needle', () => {
    // Fresh project: needle at start (0,0). Jump window is [-1, 1].
    const { svg, handle, spies } = setupManual({ activeStitch: 'jump' });
    svg.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: cx(2), clientY: cy(0),
    }) as unknown as PointerEvent);
    expect(spies.onAddPoint).not.toHaveBeenCalled();
    handle.detach();
  });

  it('accepts a jump click inside ±1 mm dx — fires onAddPoint with kind=jump', () => {
    const { svg, handle, spies } = setupManual({ activeStitch: 'jump' });
    svg.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: cx(1), clientY: cy(0),
    }) as unknown as PointerEvent);
    expect(spies.onAddPoint).toHaveBeenCalledTimes(1);
    const [, kind] = spies.onAddPoint.mock.calls[0]!;
    expect(kind).toBe('jump');
    handle.detach();
  });

  it('hover outside the live window fires onHoverValidity(false); inside fires onHoverValidity(true)', () => {
    const { handle, spies } = setupManual({ activeStitch: 'needle' });
    // Inside [-3, 3]: valid.
    window.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: cx(2), clientY: cy(1),
    }) as unknown as PointerEvent);
    expect(spies.onHoverValidity).toHaveBeenLastCalledWith(true);
    // Outside [-3, 3]: invalid.
    window.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: cx(10), clientY: cy(1),
    }) as unknown as PointerEvent);
    expect(spies.onHoverValidity).toHaveBeenLastCalledWith(false);
    handle.detach();
  });

  // Y-cap (firmware envelope |dy| ≤ 4 mm per record). The validator inside
  // addManualStitch already enforces this — these tests gate the *visual*
  // behavior so the live window, hover affordance, and click pre-check
  // tell the user about the same envelope before it gets silently dropped.
  it('rejects a needle click whose dy exceeds 4 mm — start at y=0, click at y=5', () => {
    const { svg, handle, spies } = setupManual({ activeStitch: 'needle' });
    svg.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: cx(0), clientY: cy(5),
    }) as unknown as PointerEvent);
    expect(spies.onAddPoint).not.toHaveBeenCalled();
    handle.detach();
  });

  it('accepts a needle click at the boundary dy = 4 mm exactly', () => {
    const { svg, handle, spies } = setupManual({ activeStitch: 'needle' });
    svg.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: cx(0), clientY: cy(4),
    }) as unknown as PointerEvent);
    expect(spies.onAddPoint).toHaveBeenCalledTimes(1);
    handle.detach();
  });

  it('rejects a jump click whose dy exceeds 4 mm (Y cap is foot- and kind-agnostic)', () => {
    const { svg, handle, spies } = setupManual({ activeStitch: 'jump' });
    svg.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: cx(0), clientY: cy(5),
    }) as unknown as PointerEvent);
    expect(spies.onAddPoint).not.toHaveBeenCalled();
    handle.detach();
  });

  it('hover above the Y window fires onHoverValidity(false); inside fires (true)', () => {
    const { handle, spies } = setupManual({ activeStitch: 'needle' });
    // y=3 is dy=3 from start=0 → valid.
    window.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: cx(0), clientY: cy(3),
    }) as unknown as PointerEvent);
    expect(spies.onHoverValidity).toHaveBeenLastCalledWith(true);
    // y=5 is dy=5 → invalid.
    window.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: cx(0), clientY: cy(5),
    }) as unknown as PointerEvent);
    expect(spies.onHoverValidity).toHaveBeenLastCalledWith(false);
    handle.detach();
  });

  // Validity-as-rejection-cue is meaningful only in Add tool, where a
  // click would actually try to place a stitch. In Select / Move / Pan
  // there's no placement to reject — the live window is hidden, the
  // cursor stays normal, and the on-canvas reject glyph must NOT paint.
  it('Select tool: hover outside the live window does NOT fire onHoverValidity(false)', () => {
    const { handle, spies } = setupManual({ activeStitch: 'needle' });
    handle.setTool('select');
    // Outside both the X (carriageX ± 3) and Y (needleY ± 4) windows.
    window.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: cx(10), clientY: cy(5),
    }) as unknown as PointerEvent);
    // Validity should be cleared (true) so any stale false from a prior
    // Add session is wiped — never false in non-Add tools.
    expect(spies.onHoverValidity).toHaveBeenLastCalledWith(true);
    handle.detach();
  });

  it('Move tool: hover outside the live window does NOT fire onHoverValidity(false)', () => {
    const { handle, spies } = setupManual({ activeStitch: 'needle' });
    handle.setTool('move');
    window.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: cx(10), clientY: cy(5),
    }) as unknown as PointerEvent);
    expect(spies.onHoverValidity).toHaveBeenLastCalledWith(true);
    handle.detach();
  });

  it('design mode emits onHoverValidity(true) so stale manual-mode false flags are cleared', () => {
    // The reject affordance is a manual-mode concept (per-record envelope
    // around the carriage). In design mode there's no live window — and
    // the on-canvas glyph must never paint. Emitting valid=true on every
    // design-mode move guarantees ui.hoverValid is wiped if the user
    // navigates away from a manual project that left it false.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    });
    const designProject = newProject('D'); // design mode default
    const onHoverValidity = vi.fn();
    const handle = createEditorInteract(svg, {
      getView: () => view,
      getProject: () => designProject as never,
      onAddPoint: vi.fn(),
      onSelectPoint: vi.fn(),
      onMovePoint: vi.fn(),
      onSelectSegment: vi.fn(),
      onHover: vi.fn(),
      onHoverValidity,
    });
    handle.setTool('add');
    handle.attach();
    // Hover anywhere — design mode should always report valid.
    window.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: 200, clientY: 100,
    }) as unknown as PointerEvent);
    expect(onHoverValidity).toHaveBeenLastCalledWith(true);
    // Even outside the touchable area (off the design X-limit), validity is true.
    window.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: 590, clientY: 100,
    }) as unknown as PointerEvent);
    expect(onHoverValidity).toHaveBeenLastCalledWith(true);
    handle.detach();
  });

  it('switching from Add (false) to Select clears the validity flag on the next move', () => {
    const { handle, spies } = setupManual({ activeStitch: 'needle' });
    // First, in Add tool, hover outside the window → validity false.
    window.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: cx(10), clientY: cy(5),
    }) as unknown as PointerEvent);
    expect(spies.onHoverValidity).toHaveBeenLastCalledWith(false);
    // Switch to Select; next move at the same spot should emit true.
    handle.setTool('select');
    window.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: cx(10), clientY: cy(5),
    }) as unknown as PointerEvent);
    expect(spies.onHoverValidity).toHaveBeenLastCalledWith(true);
    handle.detach();
  });
});

describe('liveBoundsForClick — manual mode Y cap', () => {
  // Build a manual-mode project with the start anchor at a specific Y.
  // currentManualFrame falls back to points[0] when manualStitches is
  // empty, so this is the cleanest way to control frame.needleYMm
  // without walking many stitches through the validator.
  function manualWithStartY(startY: number, hoopH = 150): Project {
    const p = newProject('M', { mode: 'manual', suggestedFoot: 'S' });
    return {
      ...p,
      hoop: { halfW: p.hoop.halfW, h: hoopH },
      points: [{ id: 'start', x: 0, y: startY }],
    };
  }

  it('clips Y to ±STITCH_DY_MAX_MM (4 mm) around the current needle Y', () => {
    const b = liveBoundsForClick(manualWithStartY(10), 'needle');
    expect(b.yMin).toBe(6);
    expect(b.yMax).toBe(14);
  });

  it('clamps Y window to the hoop floor near the top', () => {
    const b = liveBoundsForClick(manualWithStartY(2), 'needle');
    expect(b.yMin).toBe(0);
    expect(b.yMax).toBe(6);
  });

  it('clamps Y window to the hoop ceiling near the bottom', () => {
    // hoop H = 150, frame.needleYMm = 148: window would be [144, 152] → clamped to [144, 150].
    const b = liveBoundsForClick(manualWithStartY(148), 'needle');
    expect(b.yMin).toBe(144);
    expect(b.yMax).toBe(150);
  });

  it('jump kind has the same Y window as needle (Y cap is foot- and kind-agnostic)', () => {
    const project = manualWithStartY(10);
    const bN = liveBoundsForClick(project, 'needle');
    const bJ = liveBoundsForClick(project, 'jump');
    expect(bN.yMin).toBe(bJ.yMin);
    expect(bN.yMax).toBe(bJ.yMax);
  });

  it('design mode keeps yMin=0 and yMax=hoop.h (no Y cap visualized)', () => {
    const project = newProject('D');
    const b = liveBoundsForClick(project, 'needle');
    expect(b.yMin).toBe(0);
    expect(b.yMax).toBe(project.hoop.h);
  });
});

describe('liveWindowGeometry — overlay/click-gate contract', () => {
  // Pins the renderer's overlay to the click-gate. If a click would
  // pass liveBoundsForClick, the geometry helper that render.ts uses
  // to draw the overlay must include that same point. This is the
  // contract that keeps the rejected-affordance glyph and the
  // highlighted band from disagreeing.

  it('returns null in design mode (no overlay)', () => {
    expect(liveWindowGeometry(newProject('D'), 'needle')).toBeNull();
  });

  it('returns null for non-needle/jump kinds (toolbar straight/satin)', () => {
    const p = newProject('M', { mode: 'manual', suggestedFoot: 'S' });
    expect(liveWindowGeometry(p, 'straight')).toBeNull();
    expect(liveWindowGeometry(p, 'satin')).toBeNull();
  });

  it('agrees with liveBoundsForClick on xMin/xMax/yMin/yMax for needle in manual mode', () => {
    const p = newProject('M', { mode: 'manual', suggestedFoot: 'S' });
    const g = liveWindowGeometry(p, 'needle')!;
    const b = liveBoundsForClick(p, 'needle');
    expect(g.xMin).toBe(b.xMin);
    expect(g.xMax).toBe(b.xMax);
    expect(g.yMin).toBe(b.yMin);
    expect(g.yMax).toBe(b.yMax);
  });

  it('agrees with liveBoundsForClick for jump kind too', () => {
    const p = newProject('M', { mode: 'manual', suggestedFoot: 'S' });
    const g = liveWindowGeometry(p, 'jump')!;
    const b = liveBoundsForClick(p, 'jump');
    expect(g.xMin).toBe(b.xMin);
    expect(g.xMax).toBe(b.xMax);
    expect(g.yMin).toBe(b.yMin);
    expect(g.yMax).toBe(b.yMax);
  });

  it('any accepted click lies inside the geometry returned to the renderer', () => {
    // Foot S manual project: needle window is [-3, 3], Y window is
    // [needleY - 4, needleY + 4]. A click at (2, 1) passes the gate,
    // so the overlay must include it.
    const p = newProject('M', { mode: 'manual', suggestedFoot: 'S' });
    const b = liveBoundsForClick(p, 'needle');
    const accepted = { x: 2, y: 1 };
    expect(isInsideBounds(b, accepted)).toBe(true);
    const g = liveWindowGeometry(p, 'needle')!;
    expect(isInsideBounds(g, accepted)).toBe(true);
  });
});
