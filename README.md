# Color→Layer — After Effects ScriptUI Panel

Two batch helpers for shape layers, plus a color-swatch palette, in one dockable panel:

- **Tint** — sets a layer's **Label color** (the timeline-row color) to match what the layer actually draws. Walks the layer's shape Contents, collects every enabled Fill color, picks the mean, and sets the layer's `.label` to the closest of AE's 16 preference label colors.
- **Split groups into layers** — duplicates each selected shape layer and creates one new layer per top-level shape group, so grouped objects can be separated and arranged independently. The original layer is preserved.
- **Vector Color Swatches** — a reusable color palette. Add colors (via AE's native color picker), extract solid **and gradient** colors from selected layers, import ASE palettes, and apply a swatch to the Fill / Stroke / both of selected shape layers. Gradient swatches carry their stops, type, and direction, and applying one toggles its direction (see the changelog). Palettes persist between sessions.

**Current version: v0.16.** Installed as `Color→Layer.jsx`.

## Why

When a project grows past 30–40 layers, scanning the timeline by name alone becomes slow. Color-coding helps — but doing it by hand (right-click layer → Label → pick from menu, for every layer) doesn't scale, and the choices stop matching what the layer actually looks like as the design evolves. Color→Layer reads the actual colors off the layer and assigns the closest label preset in one click. And when a single shape layer holds dozens of grouped objects, **Split groups into layers** explodes them into one layer each without redrawing anything.

## Install

1. Quit After Effects.
2. Copy `Color→Layer.jsx` into the AE Scripts folder:
   - **macOS**: `/Applications/Adobe After Effects <version>/Scripts/ScriptUI Panels/`
   - **Windows**: `C:\Program Files\Adobe\Adobe After Effects <version>\Scripts\ScriptUI Panels\`
3. Restart After Effects.
4. `Window` menu → `Color→Layer.jsx` → the panel appears. Dock it next to Project / Effects / wherever.

## Use

1. In a comp, select one or more **shape layers** (`Vector` layers — solids / nulls / etc. are skipped).
2. Optionally tick **Include stroke colors** if the layer's design lives in its strokes rather than its fills (typical for line-art / outline icons).
3. Click **Tint selected layers** to tint each shape layer to the closest AE label color.
4. Click **Split groups into layers** to duplicate each selected shape layer and create one new layer per top-level shape group, preserving the original layer.
5. Use the **Vector Color Swatches** section below to build a palette (add / extract / import), pick a Fill / Stroke / Both target, and click a swatch to apply it to the selected layers.
6. The shared status line at the bottom reports what happened for each action.

The actions are wrapped in Undo groups, so a single Cmd/Ctrl-Z reverts every layer in the batch.

## How tinting works

For each layer:

1. Walk `ADBE Root Vectors Group` recursively, collecting the value of every `ADBE Vector Fill Color` (and `ADBE Vector Stroke Color` when **Include strokes** is on) whose enclosing Fill / Stroke item has its eye icon on. Disabled items are ignored.
2. Compute the **arithmetic mean** of all sampled RGBs. For the typical one- or two-fill icon this is just the fill color back; for multi-fill layers it's a representative average.
3. Convert both the mean and each of AE's 16 label presets to **CIE Lab** (D65) via the canonical sRGB → linear-RGB → XYZ → Lab chain, then compute the squared CIE76 distance (`ΔL² + Δa² + Δb²`). The label with the smallest distance wins. Lab is designed so that Euclidean distance approximates perceived color difference, which means a single uniform metric handles the whole color space — no manual weighting of hue vs saturation vs lightness needed.
4. Set `layer.label = winningIndex` (1–16).

The label RGB table currently ships **AE CC's default** label colors. Users who have customised their label colors in `Preferences > Labels` will get a close-but-not-identical match. A future version may probe AE's preference store at panel launch to pick up the user's actual labels.

## How splitting works

ExtendScript can't move or copy a shape property from one layer into another — `PropertyBase.moveTo` only reorders within the same parent group. So instead of cloning a group across layers (which silently failed in v0.6), the panel:

1. Duplicates the whole layer once per top-level group — each duplicate already contains **every** group.
2. On each duplicate, deletes all top-level groups **except** the one to keep, found via a live property-index lookup (re-querying `property(j)` each time, because removing a sibling invalidates any stored `Property` reference).
3. Renames the new layer `Original / GroupName`.

All edits stay inside a single layer's property tree, which AE fully supports. The original layer is left untouched.

## What it does NOT (yet) do

- **Gradient fills (Tint only)** — the **Tint** matcher samples only solid Fill colors; gradient-filled shapes are skipped for tinting. (The **Vector Color Swatches** palette fully supports gradients — extract, store, and apply them.)
- **Animated fill / stroke color** — read as `valueAtTime(0)` (the value at the start of the comp). If the design relies on a mid-animation color, the chosen label may not match what's visible later.
- **Weight by shape area** — the mean treats a 5-pixel accent the same as a 500-pixel background. For most icons this lands on the right hue anyway; for layered comps with one large background and several small accents it can drift toward grey.
- **Custom user label colors** — see above. The defaults table is hard-coded.
- **Non-shape layers** — solids, nulls, images, precomps, text are silently skipped (reported in the status line as "skipped").
- **CIEDE2000 accuracy** — CIE76 (used here) is the simplest perceptual metric and good enough for AE's 16 spread-out presets. CIEDE2000 corrects CIE76's known weaknesses around blues and greys but is ~20× the code; revisit if specific mismatches show up.

## Working in this repo

- **No tests / no build.** To verify a change: install the `.jsx` into AE's `Scripts/ScriptUI Panels/`, restart AE, open a comp with a known-color shape layer, click **Tint selected layers** or **Split groups into layers**, and check the result.
- **Fast iteration**: `File → Scripts → Run Script File…` and pick the updated `.jsx`. Runs as a floating window (not docked) but reloads every time without an AE restart.
- **Style**: ES3 ExtendScript only. No `class`, `let`/`const`, arrow functions, template literals, `Map`/`Set`, `for...of`, spread, optional chaining, or modern Array/Object methods.

## matchName trivia

| Property | matchName |
|---|---|
| Shape layer | `ADBE Vector Layer` |
| Shape layer Contents | `ADBE Root Vectors Group` |
| A shape group | `ADBE Vector Group` |
| Group's Contents | `ADBE Vectors Group` |
| Fill item | `ADBE Vector Graphic - Fill` |
| Fill color | `ADBE Vector Fill Color` |
| Stroke item | `ADBE Vector Graphic - Stroke` |
| Stroke color | `ADBE Vector Stroke Color` |
| Stroke width | `ADBE Vector Stroke Width` |
| Gradient fill item | `ADBE Vector Graphic - G-Fill` |
| Gradient stroke item | `ADBE Vector Graphic - G-Stroke` |
| Gradient stop colors | `ADBE Vector Grad Colors` (NO_VALUE — written via `.ffx` preset injection) |
| Gradient type (linear/radial) | `ADBE Vector Grad Type` |
| Gradient start point | `ADBE Vector Grad Start Pt` |
| Gradient end point | `ADBE Vector Grad End Pt` |
| Group transform | `ADBE Vector Transform Group` |

## Changelog

- **v0.16** — **New default palette + cache reset.** The starter swatches are now imported from `grid-palette-2026-07-09.ase` (Brown, Red, Orange, White) instead of the old rainbow set. Because the palette is persisted in AE's settings and would otherwise stick forever, a `DEFAULTS_VERSION` marker clears the persisted palette cache **once** on the next open and reinstalls these defaults — so the new colors actually appear on existing installs. It's a one-time reset: any edits you make afterward are kept and never wiped again.
- **v0.15** — **Applying a swatch no longer deselects the layer.** Converting a gradient to a solid removes the gradient graphic, but the gradient's Colors property is what the `.ffx` apply had selected — removing the layer's only selected property dropped the whole layer's selection (so a following apply had nothing to act on). Apply now re-asserts the originally-selected layers when it finishes, so the selection survives any solid↔gradient sequence.
- **v0.14** — **Horizontal reset now respects group transforms.** The direction toggle's horizontal reset computes the shape's left/right edges in layer space (`sourceRectAtTime`), but a gradient's start/end points live in the coordinate space of the shape **group** that holds it. When that group (or any enclosing group) has a non-default transform — position offset, scale, rotation, anchor — the reset landed in the wrong place. The endpoints are now mapped down through the **inverse of every enclosing group's transform**, so the horizontal reset lands correctly on the shape's actual left and right edges regardless of group transforms.
- **v0.13** — **Direction toggle.** Applying a gradient swatch now toggles its direction: the **first** click applies the swatch's saved colors *and* direction (start/end points); clicking **again** on the same shape resets the direction to **horizontal** — start at the shape's leftmost point, end at its rightmost point (spanning `sourceRectAtTime` bounds, at the vertical center). A third click restores the swatch direction, and so on. The toggle reads the gradient's current direction and compares it to the swatch's, so it needs no stored state and works per shape.
- **v0.12** — **Gradient swatches now capture and reproduce the DIRECTION** (start/end points) plus highlight length/angle. On **Extract**, the gradient's start point, end point and highlight are read and stored in the swatch (persisted alongside the colors/offsets); on **Apply**, that saved direction is written back onto the target gradient, so applying a swatch reproduces the extracted gradient's angle/spread — not just its colors. Swatches saved before this version simply carry no direction and leave the shape's own direction untouched. **Stroke width is now always preserved.** It belongs to the stroke, not the color, so the current stroke width (from an existing gradient *or* solid stroke) is captured before applying and forced back afterward — converting a **solid stroke to a gradient** no longer resets the width to the template's 2px default, and reapplying a gradient keeps the width you set. Applying a swatch changes only the color + saved direction; everything else on the stroke stays put.
- **v0.11** — **Stroke gradients** now work: a stroke-specific `.ffx` template (its own `G-Stroke` parent chain) is embedded, so applying a gradient swatch in Stroke / Both mode writes stop colors on strokes too. **Extract now auto-saves the project first** (like Ctrl+S) — gradient colors are read from the last-saved `.aep`, so you no longer have to manually save before extracting a freshly-made gradient. **Solid-over-gradient** is more robust: applying a solid swatch to a shape now always removes any gradient of that kind and, if the shape has **no fill/stroke at all**, creates one — so a solid color reliably shows up on a bare shape or one that only had a gradient. New **Remove paint** button (Material `open_in_new_off` icon) strips Fill / Stroke / Both (solid *and* gradient graphics) from the selected shape layers, honoring the Fill/Stroke/Both target mode. **Gradient apply now carries the swatch's stop positions** (not just colors): the `.ffx` `<prop.map>` encodes each stop's `[offset, midpoint, R, G, B]`, so applying a swatch reproduces the original ramp's spacing (e.g. stops at 0 / 34.9 / 44.3 / 100%), for both fresh gradients and shapes that already had one. **Gradients no longer pile up**: `applyPreset` spawns a stray black-and-white phantom gradient whenever two gradient graphics of the same kind coexist under one group when the preset lands, so applying repeatedly (or to an already-polluted shape) used to stack `Gradient Fill 1, 2, 3…`. Apply now keeps exactly one gradient of the target kind (updating it **in place** when present, deduping any extras), so there is only ever a single gradient present when the preset is applied — one clean gradient per apply, even on shapes that already accumulated several.
- **v0.10** — **Gradient apply** now writes stop colors for real. `ADBE Vector Grad Colors` is a `NO_VALUE` property, so `setValue` can't touch it on any AE build; the only pure-ExtendScript way to write it is **animation-preset injection** (the technique used by AEUX/Overlord). The script carries a real "Colors"-only `.ffx` preset captured from AE (embedded base64, so the tool stays a single file), rebuilds its `<prop.map>` XML from the swatch's stops, patches the RIFX chunk sizes, writes a temp `.ffx` and `applyPreset`s it onto the target gradient's Colors property. This writes **colors + stop positions/midpoints + alpha stops** in one shot; the linear/radial type is still set directly (that property is scriptable). Applies to Fill / Stroke / Both per the target mode; if the layer has no gradient of that kind yet, one is added **inside the shape's group** (replacing the solid fill/stroke there) so it lands in the right place instead of at the layer root. Applying a **solid** swatch over a gradient now swaps the gradient back for a solid fill/stroke of that color. **Stroke** gradients need their own captured template (the preset's parent chain is fill-specific), tracked separately. Requires **Preferences > Scripting & Expressions > Allow Scripts to Write Files** (the status line prompts if it's off).
- **v0.9** — **Gradient swatches** in the palette. A swatch can now hold a gradient (color stops + alpha stops + linear/radial type), not just a solid color.
  - **Extract** detects `ADBE Vector Graphic - G-Fill` / `G-Stroke` ramps on the selected layers and pulls their stops into the palette as gradient swatches (deduplicated by their stop signature). Because `ADBE Vector Grad Colors` is a `NO_VALUE` property (unreadable via the scripting API), the stop colors are read by parsing the **saved project file** (`.aep`) — so the project must be saved for gradient extraction to work; colors come from the last saved state. (Technique ported from the Lottie-HTML AE→HTML exporter / Bodymovin's `ProjectParser`.) The gradient type is read directly from the property.
  - Gradient swatches render as a live multi-band preview in the grid, persist with the palette (backward-compatible with existing solid-only saved palettes), and disable the Hex field (which only applies to solids).
  - **Apply** of a gradient swatch sets the gradient type on matching Fill/Stroke gradients, but the stop **colors cannot be written** on current AE builds (same `NO_VALUE` limitation — the status line says so). Full color apply is tracked in the backlog. _(Superseded by v0.10, which applies colors via `.ffx` injection.)_
- **v0.8** — Combined the standalone **Vector Color Swatches / Dynamic Color Palette** tool into the same panel, stacked below the Tint / Split actions. Each tool is wrapped in its own isolated module function so their helpers and state don't collide, and both report into a single shared status footer. Also in this release:
  - **Google Material icons** for the palette's action and Fill/Stroke/Both buttons, rendered from their SVG paths (ScriptUI has no SVG/Bézier support, so paths are flattened to line segments and filled), all at a uniform size with a hover highlight.
  - **Rounded primary buttons** — Tint / Split are now custom-drawn rounded rectangles; Split gained an `alt_route` split icon to the left of its label.
  - **Full-bleed rainbow strip** flush to the top and side edges of the window.
  - **Footer** consolidated to a single line (status message + version), pinned to the bottom, and auto-hidden when the window is too short so the swatch grid keeps the room.
  - **Swatch grid** re-flows to the panel width instead of cropping.
  - **AE-native color picker** — the palette's Add/Edit now force AE's own color picker (temporarily toggling the "Use System Color Picker" preference and restoring it afterward) instead of the OS picker.
- **v0.7** — Fixed **Split groups into layers**: every split layer previously came out containing all groups. The old approach cloned a group and `moveTo`'d it onto a fresh layer (an unsupported cross-layer move) and then held stale `Property` references through deletes. Now each duplicate keeps only its target group, with all others removed via live property-index lookup.
- **v0.6** — Added a **Split groups into layers** action. It duplicates each selected shape layer and creates one new layer per top-level shape group, so grouped shapes can be separated and arranged independently while the original layer is preserved.
- **v0.5** — UI refresh. Renamed the panel to **Color→Layer** (window title, header, undo-group label). Recolored the header accent from purple to orange. Added a thin rainbow strip across the top of the panel, painted band-by-band in a best-effort `onDraw` handler (ScriptUI has no native gradient brush). No color-matching behavior changed.
- **v0.4** — Switched the matcher to **CIE76 Lab distance**. HSL kept producing wrong-looking results on edge cases where the source's hue was closer to a pale label than to its perceptually-correct match (e.g. mid green `#4AA647` mapped to pale Sea Foam because their hues were 2° apart, while Green's hue was 17° off). Lab is perceptually uniform — `ΔL² + Δa² + Δb²` between a shape's color and a label's color is roughly proportional to how different they look, with no manual weighting needed. Resolves vibrant-orange→Peach, vibrant-blue→Lavender, and mid-green→Sea Foam mismatches reported on v0.1–v0.3 in a single change.
- **v0.3** — HSL hue importance now reads only the source's saturation (was the min of source/label) and the multiplier was bumped to 8×. Fixed vibrant blue `#4894FE` matching pastel Lavender instead of Blue. Did not fix `#FF9C70`→Orange or `#4AA647`→Green — those needed the v0.4 algorithm switch.
- **v0.2** — Replaced Euclidean RGB with a hue-weighted HSL distance to fix dark/desaturated purples mapping to Brown. Worked for the hue family but still leaned on tunable weights for vibrant sources, leaving the edge cases that drove v0.3 and v0.4.
- **v0.1** — Initial release. Walk Contents, average fill colors, Euclidean RGB distance to the 16 hard-coded AE CC default label colors, set `layer.label`.
