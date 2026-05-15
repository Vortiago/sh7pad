// Shared base for modal-shaped overlays — the three modal dialogs
// (disclaimerModal, exportDialog, newProjectDialog) and the floating
// contextMenu. Wraps the native <dialog> + .showModal() pattern with
// Esc + click-on-backdrop + cancel-event fallback + single-instance
// so each caller stays focused on its body rather than re-implementing
// focus management.
//
// Two anchoring modes:
//   - 'center' (default): the native <dialog> sits where the UA puts
//     it (typically centered). The ::backdrop dim is owned by the
//     caller's CSS (e.g. .info-backdrop).
//   - { x, y }: popover mode. After .showModal() the base positions
//     the dialog with style.left/top, clamping to the viewport so it
//     doesn't ride off-screen near the edges. The caller's CSS is
//     responsible for making the ::backdrop transparent if it doesn't
//     want a dim (see contextMenu.css).
//
// Single-instance pattern: only one dialog with a given data-component
// can be open at a time. open() short-circuits if one already exists.

export type DialogAnchor = 'center' | { x: number; y: number };

export interface DialogBaseOptions {
  /** className applied to the <dialog> element. The existing modals
   *  use 'info-backdrop' so their CSS still matches; the contextMenu
   *  uses 'cm-root'. */
  className: string;
  /** data-component value used for the single-instance check and as
   *  a stable hook for tests. */
  componentTag: string;
  /** id of the heading element inside the dialog body (set by the
   *  caller after appendChild). Sets aria-labelledby for AT. */
  ariaLabelledBy: string;
  /** Anchoring mode. 'center' (default) leaves positioning to the UA;
   *  { x, y } pins the dialog near those viewport coords (popover). */
  anchor?: DialogAnchor;
  /** Called when the dialog dismisses for ANY reason (Esc, backdrop
   *  click, native cancel). The action buttons inside the body are
   *  the caller's responsibility — they typically call close() directly. */
  onCancel?: () => void;
  /** Optional document override for tests. */
  doc?: Document;
}

export interface DialogBase {
  /** The <dialog> element, ready to receive content. */
  dialog: HTMLDialogElement;
  /** Append to <body>, call showModal(), focus the first focusable
   *  inside `dialog` if any. For popover anchors, also positions the
   *  dialog after showModal so measurement is accurate. No-op if a
   *  dialog with the same componentTag is already open. */
  open(): void;
  /** Remove from DOM and detach listeners. Idempotent. */
  close(): void;
}

const VIEWPORT_MARGIN_PX = 8;

export function createDialogBase(opts: DialogBaseOptions): DialogBase {
  const doc = opts.doc ?? document;
  if (doc.querySelector(`dialog[data-component="${opts.componentTag}"]`)) {
    // Already open — return an inert handle whose dialog is a detached
    // scratch element. Any content the caller still appends lands on the
    // detached node (invisible) rather than mutating the live dialog,
    // and open()/close() are no-ops. The existing dialog continues to
    // own its own close path (its action buttons + Esc + backdrop).
    const scratch = doc.createElement('dialog');
    return {
      dialog: scratch,
      open: () => {},
      close: () => {},
    };
  }

  const dialog = doc.createElement('dialog');
  dialog.className = opts.className;
  dialog.dataset['component'] = opts.componentTag;
  dialog.setAttribute('aria-labelledby', opts.ariaLabelledBy);

  let escHandler: ((ev: KeyboardEvent) => void) | null = null;
  let opened = false;

  function close(): void {
    if (escHandler) {
      doc.removeEventListener('keydown', escHandler);
      escHandler = null;
    }
    dialog.remove();
    opened = false;
  }

  function fireCancel(): void {
    opts.onCancel?.();
    close();
  }

  // Click on the dialog itself (not a child) = click on the backdrop.
  // The native ::backdrop pseudo-element bubbles to the dialog. This
  // works for both modal-style (full-viewport dim) and popover-style
  // (transparent backdrop still captures clicks anywhere outside the
  // positioned dialog body).
  dialog.addEventListener('click', (ev) => {
    if (ev.target === dialog) fireCancel();
  });
  // Native cancel event (Esc in real browsers).
  dialog.addEventListener('cancel', () => fireCancel());

  function positionAtAnchor(anchorX: number, anchorY: number): void {
    // Measurement after showModal so getBoundingClientRect is accurate.
    const rect = dialog.getBoundingClientRect();
    const vw = (doc.defaultView ?? window).innerWidth;
    const vh = (doc.defaultView ?? window).innerHeight;
    let left = anchorX;
    let top = anchorY;
    if (left + rect.width + VIEWPORT_MARGIN_PX > vw) {
      left = Math.max(VIEWPORT_MARGIN_PX, vw - rect.width - VIEWPORT_MARGIN_PX);
    }
    if (top + rect.height + VIEWPORT_MARGIN_PX > vh) {
      top = Math.max(VIEWPORT_MARGIN_PX, vh - rect.height - VIEWPORT_MARGIN_PX);
    }
    dialog.style.left = `${Math.max(VIEWPORT_MARGIN_PX, left)}px`;
    dialog.style.top = `${Math.max(VIEWPORT_MARGIN_PX, top)}px`;
  }

  function open(): void {
    if (opened) return;
    opened = true;
    doc.body.appendChild(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    // Position popovers after showModal so measurements are accurate.
    const anchor = opts.anchor ?? 'center';
    if (anchor !== 'center') {
      positionAtAnchor(anchor.x, anchor.y);
    }
    // jsdom-test compat: synthetic Esc keydowns on document don't
    // fire the dialog's native cancel handler.
    escHandler = (ev) => {
      if (ev.key === 'Escape') fireCancel();
    };
    doc.addEventListener('keydown', escHandler);
    // Focus the first focusable in the dialog so keyboard users land
    // on something. Caller can override afterward (e.g. an input).
    const firstFocusable = dialog.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    firstFocusable?.focus();
  }

  return { dialog, open, close };
}
