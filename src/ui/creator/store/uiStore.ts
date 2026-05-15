// Tiny pub/sub store for the editor's session state. Mirrors the shape of
// projectStore so consumers see one consistent pattern: getState/setState/
// subscribe + a skip-when-equal short-circuit.
//
// What lives here is everything that does NOT survive serialization to JSON
// or .sh7 — UI session state, basically. The Project (geometry, foot, tension,
// bg image) lives in projectStore. Sidebar-collapse mirrors to localStorage
// (sentinel) for boot-time restoration but the runtime source of truth lives
// here.
//
// Layout-attribute slice: the subset (mode, tool, leftCollapsed,
// rightCollapsed, layout, rulersShown) drives body.dataset.* and the
// html.ed-rulers-shown class via attachLayoutAttrs (./attachLayoutAttrs.ts) —
// one derivation function, one writer. Callers update the store; the
// derivation writes the DOM. CSS still reads the same selectors.

import type { Project } from '../../../creator/types.js';
import type { Tool } from '../editor/interact.js';
import type { StitchKind } from '../toolbar/index.js';
import type { Mode } from '../modeSwitch/index.js';
import {
  DEFAULT_NEEDLE_NM, DEFAULT_THREAD_MM,
  DEFAULT_BG_COLOR, DEFAULT_THREAD_COLOR,
} from '../preview/constants.js';

/** Coarse responsive bucket. Driven by the responsive controller's
 *  matchMedia listeners; consumed by attachLayoutAttrs to suppress
 *  dock-collapsed body attrs on non-desktop layouts. */
export type Layout = 'desktop' | 'tablet' | 'phone';

/**
 * What the editor currently has selected. The discriminated union makes
 * mutual exclusion structural — only one kind can be set at a time.
 * `null` means "no selection."
 *
 *   - 'segment'      → a design-mode segment by its id
 *   - 'point'        → a chain anchor by its id
 *   - 'manual-satin' → a manual-mode satin entry by its index in
 *                      project.manualStitches
 *
 * Re-exported as InspectorTarget by segmentInspector so readers and
 * writers speak the same vocabulary.
 */
export type Selection =
  | { kind: 'segment'; id: string }
  | { kind: 'point'; id: string }
  | { kind: 'manual-satin'; idx: number };

export interface UiState {
  /** All projects loaded from storage, in display order. The active one's
   *  reference is also held in projectStore; we mirror it here for the
   *  sidebar list rendering. */
  projects: Project[];
  /** Id of the project currently in projectStore. */
  currentId: string;
  /** Which pane is visible. */
  mode: Mode;
  /** Currently-selected segment / chain point / manual-satin entry, or
   *  null when nothing is selected. See {@link Selection} for the shape. */
  selection: Selection | null;

  /** Editor pointer hover position + last-known affordance validity. */
  hover: { x: number; y: number; valid?: boolean } | null;
  hoverValid: boolean;
  tool: Tool;
  activeStitch: StitchKind;
  /**
   * Two-click satin-in-manual-mode placement state. The first click on Satin
   * in manual mode stashes the spine start; the second click clears it.
   */
  pendingManualSatinStart: { x: number; y: number } | null;

  /** Playback / transport. */
  step: number;
  playing: boolean;
  speed: number;

  /** Preview tuning (session-only — not persisted). */
  needleSizeNm: number;
  threadDiameterMm: number;
  threadColor: string;
  bgColor: string;
  showHistory: boolean;
  showFoot: boolean;

  /** Editor + preview cameras. */
  userZoom: number;
  previewUserZoom: number;
  pan: { x: number; y: number };
  previewPan: { x: number; y: number };
  /** Editor canvas wrapper size, kept in sync via ResizeObserver. */
  containerSize: { w: number; h: number };

  // ── layoutState slice ──────────────────────────────────────────────
  // Fields consumed by attachLayoutAttrs to derive body.dataset.* and
  // the html.ed-rulers-shown class. Every writer of those DOM hooks
  // routes through these fields — the derivation is the only place
  // that touches body.dataset / html.classList for layout intent.

  /** Whether the left rail is collapsed in desktop layout. Suppressed
   *  by the derivation on tablet/phone (panels live in sheets there).
   *  Mirrored to sentinel storage (sh7.ui.leftCollapsed) by the
   *  sidebar pane for first-paint restoration. */
  leftCollapsed: boolean;
  /** Whether the right rail is collapsed in desktop layout. Same
   *  treatment as leftCollapsed. */
  rightCollapsed: boolean;
  /** Coarse responsive bucket. The responsive controller updates this
   *  on matchMedia changes; the derivation reads it to choose between
   *  dock-collapsed (desktop) vs right-as-sheet (tablet) vs no body
   *  layout attrs (phone, where the sheets own the chrome). */
  layout: Layout;
  /** Whether rulers are opted in at phone width. The overflow menu
   *  flips this; the derivation toggles the html.ed-rulers-shown
   *  class. Desktop CSS shows rulers unconditionally, so this is a
   *  phone-only opt-in surfaced through the class. */
  rulersShown: boolean;
}

export type UiUpdater = ((prev: UiState) => UiState) | UiState;
export type UiSubscriber = (ui: UiState) => void;
export type Unsubscribe = () => void;

export interface UiStore {
  getState(): UiState;
  setState(updater: UiUpdater): void;
  /** Convenience: shallow-merge a patch onto the current state. */
  update(patch: Partial<UiState>): void;
  subscribe(fn: UiSubscriber): Unsubscribe;
}

/**
 * Returns a fresh `UiState` populated with sensible defaults for every
 * field. Production seeds an initial state from sentinel storage +
 * matchMedia on top of this factory; tests spread `defaultUiState()`
 * and override only the fields they care about.
 *
 * This factory is the single source of truth for "what fields exist on
 * UiState" — the shape-pin assertion in uiStore.test.ts asserts the
 * exact return value here. Adding a new UiState field is a one-place
 * change: add it to the interface, add a default here, the shape-pin
 * test updates, and every call site keeps working.
 *
 * Each call returns a freshly-allocated object (including nested
 * `pan` / `previewPan` / `containerSize`) so callers can mutate
 * without leaking state between fixtures.
 */
export function defaultUiState(): UiState {
  return {
    projects: [],
    currentId: '',
    mode: 'edit',
    selection: null,
    hover: null,
    hoverValid: true,
    tool: 'select',
    activeStitch: 'straight',
    pendingManualSatinStart: null,
    step: 0,
    playing: false,
    speed: 8,
    needleSizeNm: DEFAULT_NEEDLE_NM,
    threadDiameterMm: DEFAULT_THREAD_MM,
    threadColor: DEFAULT_THREAD_COLOR,
    bgColor: DEFAULT_BG_COLOR,
    showHistory: true,
    showFoot: true,
    userZoom: 1,
    previewUserZoom: 1,
    pan: { x: 0, y: 0 },
    previewPan: { x: 0, y: 0 },
    containerSize: { w: 600, h: 400 },
    leftCollapsed: false,
    rightCollapsed: false,
    layout: 'desktop',
    rulersShown: false,
  };
}

export function createUiStore(initial: UiState): UiStore {
  let state = initial;
  const subscribers = new Set<UiSubscriber>();

  const setState = (updater: UiUpdater): void => {
    const next = typeof updater === 'function'
      ? (updater as (prev: UiState) => UiState)(state)
      : updater;
    // Skip notification when the updater returned the same reference — saves
    // a render pass for callers that produce no-op state changes.
    if (next === state) return;
    state = next;
    for (const fn of subscribers) fn(state);
  };

  return {
    getState: () => state,
    setState,
    update(patch) {
      setState((prev) => {
        // Skip the spread (and avoid notifying subscribers) when every
        // patched key already holds the same value. Stitch-list row
        // clicks on needle / jump rows commonly send the same null
        // selection repeatedly, and each spread used to fire every
        // pane's render scheduler.
        let changed = false;
        for (const k in patch) {
          if (prev[k as keyof UiState] !== patch[k as keyof UiState]) {
            changed = true;
            break;
          }
        }
        return changed ? { ...prev, ...patch } : prev;
      });
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => { subscribers.delete(fn); };
    },
  };
}
