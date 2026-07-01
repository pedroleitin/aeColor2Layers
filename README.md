# Color→Layer — After Effects ScriptUI Panel

Two batch helpers for shape layers, plus a color-swatch palette, in one dockable panel:

- **Tint** — sets a layer's **Label color** (the timeline-row color) to match what the layer actually draws. Walks the layer's shape Contents, collects every enabled Fill color, picks the mean, and sets the layer's `.label` to the closest of AE's 16 preference label colors.
- **Split groups into layers** — duplicates each selected shape layer and creates one new layer per top-level shape group, so grouped objects can be separated and arranged independently. The original layer is preserved.
- **Vector Color Swatches** — a reusable color palette. Add colors (via AE's native color picker), extract colors from selected layers, import ASE palettes, and apply a swatch to the Fill / Stroke / both of selected shape layers. Palettes persist between sessions.

**Current version: v0.8.** Installed as `Color→Layer.jsx`.

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

- **Gradient fills** — gradients are skipped; only solid-color Fill items are sampled.
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

## Changelog

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
