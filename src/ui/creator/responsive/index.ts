// Responsive layout controller. Subscribes to matchMedia for the phone
// (≤639px) and tablet (640–1023px) breakpoints and mounts/unmounts the
// per-bucket chrome.
//
// At phone width:
//   - #sidebar and #stitch-list-panel become content-children of
//     bottom sheets controlled by a 2-pill bar at the bottom
//   - The phone app bar appears at the top with mode segmented
//     control + overflow menu
//   - A slide-up inspector peek strip (separate render host) auto-shows
//     on selection. The desktop #ed-inspector is hidden via CSS at
//     phone width; the peek owns its own renderHost and subscribes to
//     uiStore / projectStore independently.
//
// At tablet width:
//   - The left sidebar stays docked (always visible)
//   - #stitch-list-panel becomes a bottom sheet behind a single
//     right-anchored Stitches pill
//
// On every matchMedia change this controller pushes the new bucket
// into uiStore.layout. attachLayoutAttrs reads that field and applies
// the matching body.dataset.* state (suppressing dock-collapsed attrs
// on non-desktop, setting data-right-as-sheet on tablet). The
// controller itself no longer writes body.dataset — the store is the
// single source of truth for layout intent.
//
// CSS handles the visual rearrangement; this module owns the runtime
// mount/unmount lifecycle so we don't pay for extra DOM on desktop.

import { createBottomSheet, type BottomSheet } from '../bottomSheet/index.js';
import { createPillBar, type PillBar } from '../pillBar/index.js';
import { createAppBar, type AppBar } from '../appBar/index.js';
import { createInspectorPeek, type InspectorPeek } from '../inspectorPeek/index.js';
import type { InspectorCallbacks } from '../segmentInspector/index.js';
import { hideContextMenu } from '../contextMenu/index.js';
import type { Mode } from '../modeSwitch/index.js';
import type { Layout, UiStore } from '../store/uiStore.js';
import type { ProjectStore } from '../../../creator/projectStore.js';

import { PHONE_QUERY, TABLET_QUERY } from './breakpoints.js';

export interface ResponsiveControllerHandle {
  /** Close every transient overlay this controller owns: any open
   *  phone sheets and the tablet stitch sheet, plus the long-press /
   *  overflow context menu. The inspector peek is driven by
   *  uiStore.selection so the caller is responsible for resetting
   *  selection if it wants the peek to retract. */
  closeAllFlyouts(): void;
  /** Tear down the controller. matchMedia listeners removed; any
   *  mounted phone/tablet chrome is destroyed and the original DOM
   *  is restored. */
  destroy(): void;
}

export interface ResponsiveControllerOptions {
  /** The existing left sidebar — re-hosted into a sheet on phone. */
  sidebarHost: HTMLElement;
  /** The existing right stitch-list panel — re-hosted into a sheet on phone. */
  stitchListHost: HTMLElement;
  /** Where to inject the pill bar (typically the body or a wrapper). */
  chromeHost: HTMLElement;
  /** Optional ui store + setMode + disclaimer hook so the appBar can
   *  drive mode switches and the rulers toggle. When omitted, the
   *  appBar isn't mounted (used by tests that only exercise sheets). */
  uiStore?: UiStore;
  setMode?(next: Mode): void;
  onShowDisclaimer?(): void;
  /** Optional inspector callbacks — when present (with uiStore +
   *  projectStore), the phone adapter mounts an inspectorPeek that
   *  renders the segment inspector into its own host. The callbacks
   *  are shared with the desktop inspector so both adapters mutate
   *  state identically (subdivide selects first half, delete clears
   *  selection, etc.). */
  inspectorCallbacks?: InspectorCallbacks;
  /** Optional projectStore — when present, the appBar overflow menu
   *  surfaces the desktop toolbar's stats string (Q5). */
  projectStore?: ProjectStore;
}

/** A live phone/tablet chrome bundle. Owns its DOM children + listeners
 *  and a single destroy() that tears everything down (the underlying
 *  sheets restore their contentEl to its pre-mount parent on destroy,
 *  so the desktop grid finds sidebar/stitchList in their original
 *  slots after a viewport flip back).  */
interface LayoutChrome {
  /** Snap every open sheet closed. Used both by the Esc handler and
   *  by the public closeAllFlyouts() — the latter also clears the
   *  context menu (which lives outside the chrome bundle). */
  closeSheets(): void;
  destroy(): void;
}

export function attachResponsiveController(
  opts: ResponsiveControllerOptions,
): ResponsiveControllerHandle {
  const mqPhone = window.matchMedia(PHONE_QUERY);
  const mqTablet = window.matchMedia(TABLET_QUERY);
  let mounted: { layout: Layout; chrome: LayoutChrome | null } | null = null;

  function syncFromMatchMedia(): void {
    // Phone takes precedence — at ≤639px we never need the tablet
    // hybrid. Tablet runs only when phone is OFF and tablet is ON.
    const layout: Layout =
      mqPhone.matches ? 'phone' : mqTablet.matches ? 'tablet' : 'desktop';
    if (mounted?.layout === layout) return;
    mounted?.chrome?.destroy();
    mounted = {
      layout,
      chrome: layout === 'desktop' ? null : mountChromeForLayout(layout, opts),
    };
    // Push the bucket into the store so attachLayoutAttrs can derive
    // body[data-right-as-sheet] / suppress dock-collapsed attrs from
    // a single source. The desktop rail-collapsed UX survives a
    // resize round-trip because uiStore.leftCollapsed / rightCollapsed
    // are untouched here — only the suppression flag flips.
    opts.uiStore?.update({ layout });
  }

  function escHandler(ev: KeyboardEvent): void {
    if (ev.key !== 'Escape') return;
    mounted?.chrome?.closeSheets();
  }

  mqPhone.addEventListener('change', syncFromMatchMedia);
  mqTablet.addEventListener('change', syncFromMatchMedia);
  // Esc closes any open sheet (Q8). Registered once at controller
  // construction; removed at destroy. The handler short-circuits when
  // no chrome is mounted, so it's a cheap no-op on desktop.
  document.addEventListener('keydown', escHandler);
  // Initial state.
  syncFromMatchMedia();

  return {
    closeAllFlyouts() {
      mounted?.chrome?.closeSheets();
      // hideContextMenu always runs — long-press menus can outlive
      // a layout transition (rare, but cheap to clear). Calling it
      // when no menu is open is a no-op.
      hideContextMenu();
    },
    destroy() {
      mqPhone.removeEventListener('change', syncFromMatchMedia);
      mqTablet.removeEventListener('change', syncFromMatchMedia);
      document.removeEventListener('keydown', escHandler);
      mounted?.chrome?.destroy();
      mounted = null;
    },
  };
}

/** Build the phone or tablet chrome bundle. Returns a uniform handle so
 *  the controller doesn't have to distinguish layouts at use sites. */
function mountChromeForLayout(
  layout: 'phone' | 'tablet',
  opts: ResponsiveControllerOptions,
): LayoutChrome {
  // Stitches sheet is shared between phone and tablet (full-by-default;
  // hosts #stitch-list-panel and restores it on destroy).
  const stitchesSheet = createBottomSheet(opts.chromeHost, {
    contentEl: opts.stitchListHost,
    label: 'Stitches',
    defaultOpen: 'full',
  });
  stitchesSheet.el.id = 'sheet-stitches';

  // Projects sheet — phone only. The tablet has the sidebar docked.
  let projectsSheet: BottomSheet | null = null;
  if (layout === 'phone') {
    projectsSheet = createBottomSheet(opts.chromeHost, {
      contentEl: opts.sidebarHost,
      label: 'Projects',
      defaultOpen: 'half',
    });
    projectsSheet.el.id = 'sheet-projects';
  }

  // Pills: 2-pill phone bar in the flow, or single-pill tablet bar
  // fixed to the viewport bottom.
  const pillBar: PillBar = createPillBar(opts.chromeHost, {
    stitchesSheet,
    ...(projectsSheet ? { projectsSheet } : {}),
    variant: layout,
  });

  // Phone-only passengers — the app bar at the top, the inspector peek
  // strip auto-shown on selection. (Tablet keeps the desktop toolbar
  // visible inside the editor pane, so no app bar needed.)
  let appBar: AppBar | null = null;
  let inspectorPeek: InspectorPeek | null = null;
  if (layout === 'phone') {
    if (opts.uiStore && opts.setMode && opts.onShowDisclaimer) {
      appBar = createAppBar(opts.chromeHost, {
        uiStore: opts.uiStore,
        setMode: opts.setMode,
        onShowDisclaimer: opts.onShowDisclaimer,
        projectStore: opts.projectStore,
      });
      // App bar at the top of the chrome host; insert before everything else.
      opts.chromeHost.insertBefore(appBar.el, opts.chromeHost.firstChild);
    }
    if (opts.inspectorCallbacks && opts.uiStore && opts.projectStore) {
      inspectorPeek = createInspectorPeek(opts.chromeHost, {
        uiStore: opts.uiStore,
        projectStore: opts.projectStore,
        callbacks: opts.inspectorCallbacks,
      });
    }
  }

  return {
    closeSheets() {
      if (projectsSheet && projectsSheet.getState() !== 'closed') {
        projectsSheet.setState('closed');
      }
      if (stitchesSheet.getState() !== 'closed') {
        stitchesSheet.setState('closed');
      }
    },
    destroy() {
      // Teardown order: passengers first (inspectorPeek owns its own
      // .ip-root, no external DOM to restore), then chrome host elements,
      // then the sheets — each sheet returns its contentEl to the
      // original parent on destroy.
      inspectorPeek?.destroy();
      appBar?.destroy();
      pillBar.destroy();
      projectsSheet?.destroy();
      stitchesSheet.destroy();
    },
  };
}
