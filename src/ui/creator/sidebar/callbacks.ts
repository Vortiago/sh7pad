// Sidebar callbacks. Builds the SidebarCallbacks bag that
// renderSidebar consumes — project switch / new / import / export /
// delete / rename / bg ops / preview-tuning / tension / disclaimer /
// glossary.
//
// Pulled out of sidebar/index.ts so the orchestrator stays under the
// 300 LOC deep-module cap. The orchestrator wires this builder with
// its persist + switchToProject helpers. Every callback's job is to
// MUTATE the store. The sidebar's own scheduler subscription (in
// index.ts) handles the DOM follow-up — no manual render fan-out
// here.

import { parseFile } from '../../../parser/parseFile.js';
import { footFromByte } from '../../../creator/foot.js';
import {
  newProject,
  setProjectName,
  setThreadTension,
  setBgImage,
  updateBgImage,
  clearBgImage,
} from '../../../creator/project.js';
import { exportProjectJson, importProjectJson, SH7C_FILE_EXT } from '../../../creator/sh7Json.js';
import { parsedStitchFileToManualProject } from '../../../creator/sh7BinaryImport.js';
import { exportProjectBinary } from '../../../creator/sh7BinaryExport.js';
import { showToast } from '../toast/index.js';
import { showDisclaimer } from '../modals/disclaimerModal/index.js';
import { showGlossary } from '../help/glossaryModal.js';
import { showNewProjectDialog } from '../modals/newProjectDialog/index.js';
import { showExportDialog } from '../modals/exportDialog/index.js';
import type { ProjectStore } from '../../../creator/projectStore.js';
import type { UiStore } from '../store/uiStore.js';
import type { PreviewPaneHandle } from '../preview/index.js';
import type { SidebarCallbacks } from './sidebar.js';
import type { BgImage, Project } from '../../../creator/types.js';

export interface SidebarCallbacksDeps {
  storage: Storage;
  projectStore: ProjectStore;
  uiStore: UiStore;
  preview: PreviewPaneHandle;
  persist: () => void;
  deleteProject: (id: string) => void;
  /** Switch the active project — clears selection / step, normalizes
   *  active stitch, swaps projectStore. Owned by the orchestrator
   *  because it also touches editor.setActiveStitch. */
  switchToProject: (next: Project) => void;
  toggleLeftCollapse: () => void;
}

export function buildSidebarCallbacks(deps: SidebarCallbacksDeps): SidebarCallbacks {
  const {
    storage, projectStore, uiStore, preview, persist, deleteProject,
    switchToProject, toggleLeftCollapse,
  } = deps;
  // preview is unused below now that the preview pane auto-subscribes
  // to uiStore — every preview-tuning callback mutates the store and
  // the preview's scheduler renders the canvas. Kept in the deps
  // interface so the call site in index.ts doesn't need to change
  // (and so a future callback that needs preview.scrubTo / similar
  // can use it without a builder signature churn).
  void preview;
  return {
    onSelect: (id: string) => {
      const next = uiStore.getState().projects.find((p) => p.id === id);
      if (!next) return;
      switchToProject(next);
    },
    onNew: () => {
      const placeholder = `Stitch ${uiStore.getState().projects.length + 1}`;
      showNewProjectDialog(
        {
          onCreate: ({ name, mode, suggestedFoot }) => {
            const fresh = newProject(name, { mode, suggestedFoot });
            const ui = uiStore.getState();
            uiStore.update({ projects: [fresh, ...ui.projects] });
            switchToProject(fresh);
          },
        },
        { namePlaceholder: placeholder },
      );
    },
    onImport: (data: ArrayBuffer | string, name: string) => {
      try {
        let proj: Project;
        if (typeof data === 'string') {
          proj = importProjectJson(data, name);
        } else {
          const buf = new Uint8Array(data);
          const design = parseFile(buf);
          // Imported .sh7 files land as manual-mode projects: we don't
          // round-trip Designs through the segment graph because the
          // parsed geometry encodes intermediate jumps and per-stitch
          // density that the design-mode encoder would otherwise have
          // to re-derive. See sh7BinaryImport.parsedStitchFileToManualProject
          // for the mapping.
          // Adopt the suggested-foot byte from the binary file. Unknown
          // bytes fall through to DEFAULT_FOOT_ID (see footFromByte).
          const importedFoot = footFromByte(design.metadata.footByte);
          proj = parsedStitchFileToManualProject(design, {
            name,
            suggestedFoot: importedFoot.id,
          });
        }
        const ui = uiStore.getState();
        uiStore.update({ projects: [proj, ...ui.projects] });
        switchToProject(proj);
        showToast(`Imported "${proj.name}"`);
      } catch (err) {
        showToast(`Import failed: ${(err as Error).message}`);
      }
    },
    onExport: () => {
      showExportDialog({
        onChoose: async (choice) => {
          const project = projectStore.getState();
          const baseName = project.name || 'project';
          try {
            if (choice === 'sh7') {
              const bytes = exportProjectBinary(project);
              // TS narrows Uint8Array<ArrayBufferLike> away from BlobPart's
              // ArrayBuffer requirement; the runtime accepts Uint8Array.
              downloadBlob(
                new Blob([bytes as BlobPart], { type: 'application/octet-stream' }),
                baseName + '.sh7',
              );
              showToast(`Saved ${baseName}.sh7`);
            } else {
              // exportProjectJson is async because the wire format
              // converts BgImage.blob → base64 dataUrl via arrayBuffer().
              const text = await exportProjectJson(project);
              downloadBlob(
                new Blob([text], { type: 'application/json' }),
                baseName + SH7C_FILE_EXT,
              );
              showToast(`Saved ${baseName}${SH7C_FILE_EXT}`);
            }
          } catch (err) {
            showToast(`Export failed: ${(err as Error).message}`);
          }
        },
      });
    },
    onDelete: (id: string) => {
      // eslint-disable-next-line no-alert
      if (!confirm('Delete this project?')) return;
      const ui = uiStore.getState();
      // Drop the IDB record up-front; persist's saveAll won't recreate
      // it because we strip it from ui.projects below.
      deleteProject(id);
      const remaining = ui.projects.filter((p) => p.id !== id);
      if (remaining.length === 0) {
        const fresh = newProject('Untitled');
        uiStore.update({ projects: [fresh] });
        switchToProject(fresh);
        return;
      }
      uiStore.update({ projects: remaining });
      if (id === ui.currentId) {
        switchToProject(remaining[0]!);
      } else {
        // Non-active project deletion: persist the new list. The
        // sidebar's subscription rebuilds the projects region from
        // uiStore.projects automatically.
        persist();
      }
    },
    onRename: (id: string, name: string) => {
      const ui = uiStore.getState();
      uiStore.update({
        projects: ui.projects.map((p) => p.id === id ? { ...p, name, updatedAt: Date.now() } : p),
      });
      if (id === ui.currentId) {
        projectStore.setState((p) => setProjectName(p, name));
      } else {
        // Non-active rename: the projectStore subscriber in
        // mountCreator doesn't fire (we didn't touch the active
        // project), so call persist() explicitly. The sidebar's
        // uiStore subscription handles the DOM refresh.
        persist();
      }
    },
    onBgChange: (patch: Partial<BgImage>) => {
      projectStore.setState((p) => updateBgImage(p, patch));
    },
    onBgRemove: () => {
      projectStore.setState((p) => clearBgImage(p));
    },
    onToggleBg: (bg: BgImage) => {
      projectStore.setState((p) => setBgImage(p, bg));
    },
    onShowDisclaimer: () => showDisclaimer(storage),
    onShowGlossary: () => showGlossary(),
    onThreadTension: (value: number) => {
      projectStore.setState((p) => setThreadTension(p, value));
    },
    // Preview-only knobs. Each callback writes the store; the preview
    // pane's scheduler subscription rebuilds the canvas, and the
    // sidebar's subscription updates the preview-settings region
    // (unless its colour picker is focused, in which case the region
    // is skipped until blur — see attachSidebar).
    onPreviewNeedleChange: (sizeNm: number) => {
      uiStore.update({ needleSizeNm: sizeNm });
    },
    onPreviewThreadChange: (diameterMm: number) => {
      uiStore.update({ threadDiameterMm: diameterMm });
    },
    onPreviewThreadColorChange: (color: string) => {
      uiStore.update({ threadColor: color });
    },
    onPreviewBgColorChange: (color: string) => {
      uiStore.update({ bgColor: color });
    },
    onPreviewToggleHistory: (show: boolean) => {
      uiStore.update({ showHistory: show });
    },
    onPreviewToggleFoot: (show: boolean) => {
      uiStore.update({ showFoot: show });
    },
    onToggleLeftCollapse: toggleLeftCollapse,
  };
}

/** Trigger a download from a Blob. Pulled out so the export callback
 *  doesn't have to inline the URL.createObjectURL boilerplate. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
