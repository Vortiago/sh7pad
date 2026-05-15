// Keyboard shortcuts:
//   1            — switch to edit mode
//   2            — switch to preview mode
//   Delete /     — remove the currently-selected segment or point
//   Backspace
//
// The editor pane exposes deleteSelectedSegmentOrPoint(); we just trigger it
// here. Mode toggling goes through the shared setMode callback so the
// body.dataset / pane visibility / renderAll dance stays in one place.
//
// shouldSkipForInput() is the shared "is the user typing in a form
// field" guard — we export it so editor/keyboard.ts (canvas arrow
// nudges, [/] cycle, Esc) reuses the exact same predicate rather than
// reimplementing it.

import type { EditorPaneHandle } from './editor/index.js';
import type { Mode } from './modeSwitch/index.js';

/** True when the keyboard event originated from a form-control element
 *  (input/select/textarea) and should bypass canvas/global shortcuts.
 *  Shared with editor/keyboard.ts so both code paths have one source
 *  of truth for "is the user typing somewhere we shouldn't intercept". */
export function shouldSkipForInput(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  return (
    target?.tagName === 'INPUT' ||
    target?.tagName === 'SELECT' ||
    target?.tagName === 'TEXTAREA'
  );
}

export interface KeyboardShortcutDeps {
  doc: Document;
  setMode: (next: Mode) => void;
  editor: EditorPaneHandle;
}

export function attachKeyboardShortcuts(deps: KeyboardShortcutDeps): void {
  const { doc, setMode, editor } = deps;

  doc.addEventListener('keydown', (e) => {
    if (shouldSkipForInput(e)) return;
    if (e.key === '1') {
      setMode('edit');
    } else if (e.key === '2') {
      setMode('preview');
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (editor.deleteSelectedSegmentOrPoint()) {
        e.preventDefault();
      }
    }
  });
}
