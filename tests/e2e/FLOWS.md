# sh7pad E2E flow manifest

Source of truth for the Playwright suite and the user guides. Every flow starts from a freshly loaded page at `/sh7pad/` unless noted. The disclaimer auto-opens on first load and must be dismissed before the rest of the UI is interactive.

Selector conventions used below:
- `data-action="X"` is the canonical attribute on buttons and form controls inside dialogs and panels.
- `data-component="X"` identifies the active modal backdrop.
- `data-control="X"` identifies form inputs the inspector and sidebar own.
- `data-testid="X"` is reserved for surfaces that are not otherwise reachable by a stable role plus a stable label.
- `data-project-id`, `data-segment-id`, `data-manual-idx`, `data-row` are runtime-stamped identity hooks on list rows.

The seeded "Wave sample" project has 9 points, 8 segments (two of them satin), 135 drops at the encoder default. Tests that rely on those counts must seed the same sample.

## Flow: Dismiss the first-load disclaimer

**Where:** Fresh browser context, app just loaded.
**Goal:** User reads the disclaimer once and continues into the editor.
**Steps:**
1. Page loads, dialog with `data-component="disclaimer"` shows automatically, focus lands on the Got it button.
2. Click `button[data-action="disclaimer-dismiss"]` -> dialog removed, `localStorage["sh7_disclaimer_seen_v1"]` set to `"1"`.
3. Reload the page -> dialog does not reappear.
**Verifies:** Disclaimer auto-open, localStorage persistence, dismissal does not block the sample seed.
**Screenshots needed (for doc-writer):**
- Disclaimer modal centered on the editor.
- Editor immediately after dismissal showing the Wave sample on the canvas.

## Flow: Reopen the About and Glossary modals

**Where:** Disclaimer already dismissed; sidebar visible.
**Goal:** Confirm the sidebar's two info links re-open the same modals shown during onboarding.
**Steps:**
1. Click `button[data-action="show-disclaimer"]` -> `dialog[data-component="disclaimer"]` becomes visible again, contains a link to `https://github.com/Vortiago/sh7pad`.
2. Press Escape or click Got it -> dialog removed.
3. Click `button[data-action="show-glossary"]` -> `dialog[data-component="glossary"]` becomes visible, first section heading reads "Concepts".
4. Click `button[data-action="glossary-close"]` -> dialog removed.
**Verifies:** The two persistent sidebar info entry points, single-instance enforcement of each dialog, focus restoration after close.
**Screenshots needed (for doc-writer):**
- Glossary modal with Concepts section visible.

## Flow: Create a new design project from the sidebar

**Where:** Sidebar showing the seeded Wave sample as the only project.
**Goal:** User adds a second project, accepts the auto-name, and lands on the new project.
**Steps:**
1. Read project count from `#sidebar [data-project-id]` (start = 1).
2. Click `button[data-action="new"]` -> `dialog[data-component="new-project"]` opens; `input[data-testid="new-project-name"]` is focused with a placeholder like "Stitch 2".
3. Confirm Mode radio "design" and Foot radio "S" are selected by default.
4. Click `button[data-action="np-create"]` -> dialog closes, sidebar project row count grows by 1, the new row is `data-active="true"`.
5. Toolbar stats `[data-testid="toolbar-stats"]` updates to `0 pts · 0 seg · ...` for the new project.
**Verifies:** Project creation, sidebar list rebuild, active-row swap, store-driven toolbar.
**Screenshots needed (for doc-writer):**
- New-project dialog with default Mode and Foot radios.
- Sidebar after creation showing both projects, the new one selected.

## Flow: Create a manual-mode project on Foot B

**Where:** Sidebar visible.
**Goal:** User picks the non-default mode and foot, gives a name, then lands in manual mode.
**Steps:**
1. Click `button[data-action="new"]`.
2. Type "Manual demo" into `input[data-testid="new-project-name"]`.
3. Click the radio inside `label[data-option="manual"]` (or click the label).
4. Click the radio inside `label[data-option="B"]`.
5. Click `button[data-action="np-create"]` -> dialog closes, sidebar Stitch Settings shows Mode = Manual and Suggested Foot = Foot B (Decorative).
6. Toolbar STITCH group now shows Needle, Satin, Jump buttons; the Move tool is hidden.
7. Stitch-list panel renders `[data-testid="stitch-list-empty"]` with the manual placeholder copy.
**Verifies:** Mode plus foot lock at creation time, toolbar adapts to manual mode, stitch list empty state for manual projects.
**Screenshots needed (for doc-writer):**
- New-project dialog with Manual and Foot B selected.
- Empty editor after creation, toolbar showing Needle/Satin/Jump.

## Flow: Rename, then delete the active project

**Where:** Two projects exist (e.g. after running the previous flow).
**Goal:** User renames the active project inline and then removes it.
**Steps:**
1. Locate the active row via `#sidebar [data-project-id][data-active="true"]`.
2. Focus its `input[data-control="project-name"]`, clear, type "Renamed", press Enter -> row text and tab title update; reload shows the new name persisted.
3. Click `button[data-action="delete"]` inside the same row -> the row disappears, another project becomes active, sidebar count decrements.
**Verifies:** Inline rename via Enter blur, store persistence to IndexedDB, delete-then-pick-next behaviour, persistence after reload.
**Screenshots needed (for doc-writer):**
- Sidebar mid-rename with the text input focused.
- Sidebar after delete with the remaining project active.

## Flow: Switch to Preview, play, scrub, and return to Edit

**Where:** Wave sample is active.
**Goal:** User watches the design stitch out, scrubs partway, then returns to edit.
**Steps:**
1. Click `button[data-mode="preview"]` (or press `2`) -> `body[data-mode="preview"]`, `#pane-preview` becomes visible, `#pane-edit` hidden.
2. Confirm `[data-testid="preview-drop-count"]` reads `Preview · 0/135 drops`.
3. Click `button[data-action="play"]` in the transport -> the same button now has `data-action="pause"` and shows `❚❚`; the X/Y readout updates each tick.
4. Click the same button (now pause) -> playback halts; scrub slider `input[data-action="scrub"]` holds the current step.
5. Set `input[data-action="scrub"]` to `0` -> drop count returns to `0/135`, X/Y returns to the start anchor.
6. Click `button[data-mode="edit"]` (or press `1`) -> `body[data-mode="edit"]`, transport hidden.
**Verifies:** Mode swap, playback start and stop, scrub binding to the playback controller, live tick updates of the readouts.
**Screenshots needed (for doc-writer):**
- Preview pane mid-playback with the carriage partway across the design.
- Transport row with the scrub slider near 50 percent.

## Flow: Adjust playback speed and zoom in preview

**Where:** Preview mode, sample loaded, playback paused.
**Goal:** User dials in a faster playback and zooms into the design.
**Steps:**
1. Move `input[data-action="speed"]` to 20 -> the speed readout updates to `20/s`.
2. Click `button[data-zoom="in"]` in the transport row twice -> preview canvas zooms; `button[data-zoom="reset"]` returns to the fit-to-pane view.
3. Click `button[data-action="play"]` -> playback now advances roughly twice as fast as the default `8/s`.
**Verifies:** Speed slider routes through the playback controller, transport zoom buttons share the camera with wheel zoom, reset zoom restores the fit view.
**Screenshots needed (for doc-writer):**
- Transport row with the speed slider at 20.
- Preview canvas zoomed in on a satin segment.

## Flow: Edit a satin segment from the stitch list

**Where:** Edit mode, Wave sample, stitch list visible.
**Goal:** User opens a satin segment, retunes its taper widths, then subdivides it.
**Steps:**
1. Click the `li[data-row="2"]` row (the `#03 satin 2.4->4.5mm` entry) -> the row gets the `current` style, the segment inspector at `#ed-inspector` renders with `data-segment-id` set.
2. Read `[data-testid="inspector-length"]` for the current segment length in mm.
3. Confirm `select[data-control="type"]` is `satin` and `select[data-control="endAt"]` is `right`.
4. Drag `input[data-control="widthStart"]` to 3.0 -> `[data-testid="inspector-widthStart-value"]` reads `3.0mm`, the canvas updates live, the row label rebuilds to `#03 satin 3.0->4.5mm`.
5. Click `button[data-action="subdivide"]` -> two satin rows replace the original one; toolbar stats jump by one segment and one point.
6. Click `button[data-action="delete"]` -> the selected segment is removed, the next row becomes selected automatically.
**Verifies:** List-to-inspector wiring, slider drag survives re-renders, type select swap, subdivide and delete paths, store-driven toolbar stats.
**Screenshots needed (for doc-writer):**
- Inspector showing the satin segment with W START and W END sliders.
- Stitch list immediately after subdivide showing the two new rows.

## Flow: Flip a straight segment to satin from the inspector

**Where:** Edit mode, Wave sample, a straight segment row selected (e.g. `#01 straight`).
**Goal:** User converts a straight segment to satin and confirms the new sliders appear.
**Steps:**
1. Click `li[data-row="0"]` -> inspector shows a straight segment, no width sliders.
2. Change `select[data-control="type"]` to `satin` -> the inspector rebuilds: W START, W END, END AT, Subdivide, Delete are now present.
3. Confirm the stitch-list row text updates from `#01 straight ...mm` to `#01 satin 2.4->2.4mm`.
4. Change `select[data-control="type"]` back to `straight` -> sliders disappear, label returns to its straight form with the needle/jump suffix.
**Verifies:** Type swap rebuilds the inspector body, store mutation cascades to the stitch list label, the slider DOM survives no-op renders elsewhere.
**Screenshots needed (for doc-writer):**
- Inspector for the converted satin segment showing both width sliders.

## Flow: Toggle DENSITY and watch drop counts change

**Where:** Edit mode, Wave sample.
**Goal:** Confirm the design-mode encoder toggle changes how segments are sliced into needle drops.
**Steps:**
1. Click `button[data-mode="preview"]` -> read `[data-testid="preview-drop-count"]` (Compact default = 135/135 drops).
2. Click `button[data-mode="edit"]`, then click `button[data-mode="uniform"]` in the DENSITY toolgroup.
3. Click `button[data-mode="preview"]` again -> drop count differs from the Compact baseline; the segment row labels also include the new needle/jump counts.
4. Click `button[data-mode="edit"]`, click `button[data-mode="compact"]` -> drop count returns to the original 135.
**Verifies:** Density toggle reaches the encoder, the change propagates through the sequence into both the preview and the stitch list labels, the value persists per project.
**Screenshots needed (for doc-writer):**
- Toolbar DENSITY group with Uniform pressed.

## Flow: Export the project in both formats

**Where:** Edit mode, Wave sample, sidebar visible.
**Goal:** User picks a file format from the export dialog.
**Steps:**
1. Click `button[data-action="export"]` -> `dialog[data-component="export"]` opens, two `button.ex-option` rows visible, intro text "Pick how you want to save it.".
2. Confirm body contains both `.sh7` and `.sh7c.json` copy.
3. Click `button[data-action="export-sh7"]` -> dialog closes, browser receives a download whose filename ends in `.sh7`.
4. Reopen via `button[data-action="export"]`, click `button[data-action="export-sh7c-json"]` -> download filename ends in `.sh7c.json`.
5. Reopen, press Escape (or click `button[data-action="export-cancel"]`) -> dialog removed, no download triggered.
**Verifies:** Dialog open and close, both export branches reach the file writer, Cancel and Escape both close without exporting.
**Screenshots needed (for doc-writer):**
- Export dialog showing the two option buttons.

## Flow: Add and remove a background tracing image

**Where:** Sidebar's Background Guide section, no image attached.
**Goal:** User loads a reference image, repositions and locks it, then removes it.
**Steps:**
1. Click `button[data-action="bg-add"]` -> hidden `input[type="file"]` opens; provide a small PNG via Playwright's `setInputFiles`.
2. Sidebar swaps to the controls block: Opacity, Scale, Rotate sliders, X and Y number inputs, Lock checkbox, Remove image button.
3. Drag `input[data-bg-control="opacity"]` to 0.3 -> opacity readout reflects the change; canvas image becomes more transparent.
4. Set `input[data-bg-control="locked"]` to checked -> the editor's pointer drags for the bg image are suppressed.
5. Click `button[data-action="bg-remove"]` -> controls collapse back to the Add image button.
**Verifies:** File input wiring, blob persistence via IndexedDB, lock state suppresses bg drag, remove restores the empty state.
**Screenshots needed (for doc-writer):**
- Background Guide section after loading an image, with the Lock checkbox visible.

## Flow: Tune Preview Settings (needle, thread, colours, repeats, foot)

**Where:** Preview mode, sidebar showing the Preview Settings section.
**Goal:** User customises the simulated thread and toggles the auxiliary overlays.
**Steps:**
1. Switch to preview via `button[data-mode="preview"]` -> Preview Settings section appears in the sidebar.
2. Change `select[data-action="needle"]` from 80 to 100 -> preview canvas re-renders with a thicker needle representation.
3. Change `select[data-action="thread"]` to the `20wt` option -> thread strokes thicken.
4. Set `input[data-action="thread-color"]` (a colour input) to `#aa0000` and `input[data-action="bg-color"]` to `#ffffff` -> canvas updates live.
5. Click `button[data-action="toggle-history"]` -> button toggles `aria-pressed`; preview hides or shows the already-stitched trail.
6. Click `button[data-action="toggle-foot"]` -> the glass-foot overlay disappears or reappears.
**Verifies:** Preview Settings selects, colour inputs, toggle buttons, surgical sync that keeps the colour-picker dialog open across rerenders.
**Screenshots needed (for doc-writer):**
- Sidebar Preview Settings panel with a red thread colour selected.
- Preview canvas with Show foot off, exposing the raw stitch path.

## Flow: Collapse and expand the side rails

**Where:** Desktop layout, Wave sample, both rails open.
**Goal:** User stows the project sidebar and the stitch list to maximise canvas room.
**Steps:**
1. Click `button[data-action="toggle-left-collapse"]` -> `body[data-left-collapsed="true"]`, the sidebar narrows to a rail, `localStorage["sh7.ui.leftCollapsed"]` becomes `"1"`.
2. Click `button[data-action="toggle-right-collapse"]` -> `body[data-right-collapsed="true"]`, stitch list narrows likewise.
3. Reload -> both rails remain collapsed on first paint.
4. Click `button[data-action="toggle-left-collapse"]` and `button[data-action="toggle-right-collapse"]` again -> both rails expand, localStorage keys are removed.
**Verifies:** Collapse toggles drive uiStore, attachLayoutAttrs writes the body attributes, sentinel storage round-trips across a reload.
**Screenshots needed (for doc-writer):**
- Editor with both rails collapsed, the canvas filling the available width.

## Flow: Adjust Thread Tension from the sidebar

**Where:** Edit mode, Wave sample, sidebar Stitch Settings visible.
**Goal:** Confirm the paired range plus number control writes the tension through to the project record.
**Steps:**
1. Read `input[data-control="threadTensionRange"]` and `input[data-control="threadTensionNumber"]` -> both report the same starting value (4).
2. Drag the range to 2 -> the number input mirrors the value, the project record persists to IndexedDB.
3. Type 6 into the number input and blur -> the range slider also moves to 6.
4. Reload -> both controls still read 6.
**Verifies:** Two-way binding of the paired controls, persistence round-trip, value clamps inside `TENSION_MIN..TENSION_MAX`.
**Screenshots needed (for doc-writer):**
- Stitch Settings panel with the tension range at 6.
