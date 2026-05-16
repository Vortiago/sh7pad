# Place stitches in Manual Mode

Manual Mode lets you place individual needle drops, jumps, and satin segments one at a time. The foot tracks the running carriage frame from the stitches you have already placed, so the editor only accepts clicks that the machine can physically execute from the current frame.

This guide assumes you have already [created a Manual Mode project](create-design.md#create-a-manual-mode-project). The toolbar shows `Needle · Satin · Jump` instead of `Straight · Satin`, the Move tool is hidden, and the right-rail stitch list is empty with a `No stitches yet — click in the editor to place one.` placeholder.

## The Add tool

The `+ Add` tool button in the editor toolbar puts the canvas into placement mode. Combined with a stitch kind (`Needle`, `Satin`, or `Jump`), a click on the canvas inserts that kind of stitch at the click position.

1. Click the `+ Add` tool button. The button highlights and the cursor changes to crosshair over the touchable area.
2. Click one of the stitch kinds (`Needle`, `Satin`, `Jump`) to choose what the next click will place.

You can switch stitch kinds at any time without losing the Add tool — only the `Satin` two-click gesture (below) keeps state between clicks.

## The live window: where the next click is allowed

The Add tool draws a coloured rectangle on the canvas that shows where the next click can land. Anywhere outside the rectangle the cursor flips to `not-allowed` and a small ⊘ glyph paints on hover, so you can tell at a glance that a click there would be a no-op.

- **Needle**: a 7 mm rectangle around the **Carriage Start** position (the dashed foot icon). This is the Needle Slot — the firmware only lets the needle reach within ±3.5 mm of the carriage.
- **Jump**: a 2 mm rectangle around the **current needle position** (the last drop, or the Start Stitch for an empty project). This is the firmware's per-record jump cap of ±1 mm.

Both rectangles also have a 4 mm vertical reach around the current needle Y — the firmware's per-record `|dy|` cap. The bottom edge clamps to the hoop's top so a fresh project shows a half-height window.

The live window slides as you place stitches: a Jump advances the carriage, which moves the Needle window; a Needle drop moves the needle, which moves the Jump window.

## Place a Needle stitch

1. With `+ Add` and `Needle` active, hover over the canvas. The 7 mm Needle window paints around the foot.
2. Click anywhere inside the window. A needle drop lands at the click position and the right-rail stitch list grows by one row.
3. The window stays in the same place: a Needle drop does not move the carriage.

You can click anywhere over the foot itself: the foot icon and the Start Stitch diamond are click-through while the Add tool is active, so the Needle Slot is fully usable for placing stitches.

## Place a Jump stitch

1. With `+ Add` and `Jump` active, hover over the canvas. A narrow 2 mm Jump window paints around the current needle (or the Start Stitch on an empty project).
2. Click inside the window. The carriage walks by the click's X offset (capped at ±1 mm) and the needle drops at the new position.
3. The Needle and Jump windows both slide with the new carriage / needle position. To walk the foot further, chain more Jumps.

A Jump is a real machine record, not a metadata hint: the firmware moves the carriage by the recorded `dx` and the needle drops at the destination.

## Place a Satin segment

Satin placement is a two-click gesture: the first click stakes the spine start, the second click stakes the spine end. The cone width and density come from defaults that you can retune from the segment inspector after the spine is placed.

1. With `+ Add` and `Satin` active, click the spine start position.
2. Click again at the spine end. A satin cone is added with default widths and density.
3. The new satin row appears in the right rail. Click it to open the inspector and adjust `W START`, `W END`, `DENSITY`, and `END AT`.

If you switch tools or stitch kinds mid-gesture (after the first click but before the second), the half-staged spine is discarded.

## The Start Lock

Once you place the first user Stitch, the Start Lock engages: the Carriage Start foot icon and the Start Stitch diamond both freeze. The first Stitch was validated against the foot frame at the moment of placement, so moving either handle retroactively would invalidate the records that followed. See [Start Stitch and Carriage Start](start-stitch.md#the-start-lock-manual-mode-only) for the full rule.

To unlock, delete every user Stitch (the right-rail × buttons remove rows one at a time) or create a fresh Manual project.

## Troubleshooting

- A click outside the foot drops nothing: that area is outside the live window. The cursor goes `not-allowed` and the ⊘ glyph paints to confirm. Slide the carriage with Jumps until the window covers the spot you want.
- The Jump window is centred on the wrong spot for a fresh project: confirm the Start Stitch sits where you expect (`startStitch.x`). The Jump window centres on the current needle position, which on an empty project is the Start Stitch — drag the diamond first if you want the window elsewhere.
- The Satin click did nothing: the first click of a Satin gesture only stages the spine start; place the second click to commit the segment.
- The carriage will not move after the first Stitch: the Start Lock is on. That's by design — see the link above.
