# Color2Layer — After Effects ScriptUI Panel

Tints an After Effects layer's **Label color** (the timeline-row color) to match what the layer actually draws. Walks the layer's shape Contents, collects every enabled Fill color, picks the mean, and sets the layer's `.label` to the closest of AE's 16 preference label colors.

**Current version: v0.3.**

## Why

When a project grows past 30–40 layers, scanning the timeline by name alone becomes slow. Color-coding helps — but doing it by hand (right-click layer → Label → pick from menu, for every layer) doesn't scale, and the choices stop matching what the layer actually looks like as the design evolves. Color2Layer reads the actual colors off the layer and assigns the closest label preset in one click.

## Install

1. Quit After Effects.
2. Copy `Color2Layer.jsx` into the AE Scripts folder:
   - **macOS**: `/Applications/Adobe After Effects <version>/Scripts/ScriptUI Panels/`
   - **Windows**: `C:\Program Files\Adobe\Adobe After Effects <version>\Scripts\ScriptUI Panels\`
3. Restart After Effects.
4. `Window` menu → `Color2Layer` → the panel appears. Dock it next to Project / Effects / wherever.

## Use

1. In a comp, select one or more **shape layers** (`Vector` layers — solids / nulls / etc. are skipped).
2. Optionally tick **Include stroke colors** if the layer's design lives in its strokes rather than its fills (typical for line-art / outline icons).
3. Click **Tint selected layers**.
4. The timeline rows update to the closest label color. The status panel reports which label each layer landed on.

The action is wrapped in an Undo group, so a single Cmd/Ctrl-Z reverts every layer in the batch.

## How the matching works

For each layer:

1. Walk `ADBE Root Vectors Group` recursively, collecting the value of every `ADBE Vector Fill Color` (and `ADBE Vector Stroke Color` when **Include strokes** is on) whose enclosing Fill / Stroke item has its eye icon on. Disabled items are ignored.
2. Compute the **arithmetic mean** of all sampled RGBs. For the typical one- or two-fill icon this is just the fill color back; for multi-fill layers it's a representative average.
3. Convert both the mean and each of AE's 16 label presets to **HSL**, then compute a **hue-weighted distance** driven by the source's saturation. When the source is vibrant, hue match dominates (so a vibrant blue maps to Blue, not Lavender). When the source is near-grey, saturation and lightness drive the match instead since hue is unreliable for grey. v0.1 used Euclidean RGB and mis-classified dark / desaturated purples as brown; v0.2 used HSL but its weight depended on the lower of source/label saturation, which let pastel labels win against vibrant sources — v0.3 reads only the source saturation.
4. Set `layer.label = winningIndex` (1–16).

The label RGB table currently ships **AE CC's default** label colors. Users who have customised their label colors in `Preferences > Labels` will get a close-but-not-identical match. v0.2+ may probe AE's preference store at panel launch to pick up the user's actual labels.

## What it does NOT (yet) do

- **Gradient fills** — gradients are skipped; only solid-color Fill items are sampled.
- **Animated fill / stroke color** — read as `valueAtTime(0)` (the value at the start of the comp). If the design relies on a mid-animation color, the chosen label may not match what's visible later.
- **Weight by shape area** — the mean treats a 5-pixel accent the same as a 500-pixel background. For most icons this lands on the right hue anyway; for layered comps with one large background and several small accents it can drift toward grey.
- **Custom user label colors** — see above. The defaults table is hard-coded.
- **Non-shape layers** — solids, nulls, images, precomps, text are silently skipped (reported in the status line as "skipped").
- **Color-space-aware distance** — Euclidean RGB is used. Good enough for AE's 16 spread-across-the-hue-circle presets; would be tighter with a Lab / Oklch metric.

## Working in this repo

- **No tests / no build.** To verify a change: install the `.jsx` into AE's `Scripts/ScriptUI Panels/`, restart AE, open a comp with a known-color shape layer, click Tint, check the label color.
- **Fast iteration**: `File → Scripts → Run Script File…` and pick the updated `.jsx`. Runs as a floating window (not docked) but reloads every time without an AE restart.
- **Style**: ES3 ExtendScript only. No `class`, `let`/`const`, arrow functions, template literals, `Map`/`Set`, `for...of`, spread, optional chaining, or modern Array/Object methods.

## matchName trivia

| Property | matchName |
|---|---|
| Shape layer Contents | `ADBE Root Vectors Group` |
| A shape group | `ADBE Vector Group` |
| Group's Contents | `ADBE Vectors Group` |
| Fill item | `ADBE Vector Graphic - Fill` |
| Fill color | `ADBE Vector Fill Color` |
| Stroke item | `ADBE Vector Graphic - Stroke` |
| Stroke color | `ADBE Vector Stroke Color` |
