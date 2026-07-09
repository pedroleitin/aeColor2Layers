# CLAUDE.md — Color→Layer

After Effects ScriptUI panel for shape layers. One file, `Color→Layer.jsx`, no build, no
tests. It hosts **two tools stacked in one dockable window**, sharing a single status footer:

- **Color→Layer** — two batch actions: **Tint** (set the layer Label color to the closest of
  AE's 16 label presets) and **Split groups into layers** (one layer per top-level shape group).
- **Vector Color Swatches** — a persistent color palette: add / extract / import colors and
  apply a swatch to the Fill / Stroke / Both of selected shape layers.

Each tool is wrapped in its own module function (`buildColorToLayerModule`,
`buildDynamicPaletteModule`) so their helpers and state stay isolated; an outer envelope
`(function(thisObj){…})(this)` builds the window, the top rainbow strip, the two host
containers, and the shared footer, then injects that footer into each module.

`copilot.md` and `README.md` hold the full architecture, the matchName table, and the
changelog — read them before changing behavior. The essentials:

## Hard constraints

- **ES3 ExtendScript only.** No `class`, `let`/`const`, arrow functions, template literals,
  `Map`/`Set`, `for...of`, spread, optional chaining, or modern Array/Object methods. Anything
  modern throws at load time in AE. Write it the way the existing code does.
- **Address properties by matchName, never display name** (display names are localized and
  user-editable). Guard every AE API call with the existing `safeProp` / `staticValue`
  helpers or `try/catch` — properties may be absent on a given layer/build.
- **Only `matchName === "ADBE Vector Layer"` is processed**; other layers are skipped
  silently and counted in the status line, never errored on.

## Two bugs not to reintroduce (the v0.6 → v0.7 fix)

`splitShapeLayerGroups` learned both the hard way:

1. ExtendScript **cannot move or copy a property across layers** — `PropertyBase.moveTo`
   only reorders within one parent group. So splitting duplicates the whole layer and
   *deletes* the unwanted groups; it never clones a group onto a fresh layer.
2. Removing a property **invalidates any stored `Property` reference** to its siblings. So
   deletion re-queries `property(j)` by live index each pass, walking descending and skipping
   the keeper — it never holds an array of `Property` objects across `.remove()` calls.

## Gradient palette (the fragile part — read before touching)

Gradient swatches store `{gradType, stops, alphaStops, geom}` and apply via **animation-preset
injection**, because `ADBE Vector Grad Colors` is a `NO_VALUE` property that `setValue` can't
touch on any AE build. Landmines:

- **`ADBE Vector Grad Colors` is written only by `.ffx` `applyPreset`.** The script carries two
  captured templates as embedded base64 (`GRAD_FFX_B64` = full fill preset, `GRAD_FFX_STROKE_B64`
  = colors-only stroke preset), rebuilds the `<prop.map>` XML from the swatch's stops, patches the
  RIFX chunk sizes, and `applyPreset`s a temp `.ffx`. Reading stop colors goes the other way —
  parse the last-saved `.aep` (`readGradientStopsFromAep`), since the live property is NO_VALUE.
- **`applyPreset` matches the full parent path** and writes in place. Fill and stroke need
  **separate** templates (their parent chains end in `G-Fill` vs `G-Stroke`). A gradient added at
  the layer root instead of inside `ADBE Vectors Group` spawns a black-and-white phantom.
- **The fill preset is COMPLETE**, so `applyPreset` resets that container's geometry (start/end
  points, highlight, opacity) to template defaults. `applyGradientForKind` therefore updates an
  existing gradient **in place** (never remove+recreate), captures geometry/width before, and
  restores them after — applying a swatch must change ONLY color + saved direction + type.
- **Stroke width belongs to the stroke, not the color** — captured before apply and forced back,
  so solid→gradient never resets it to the template's 2px.
- **Direction toggle**: a swatch stores its extracted direction (`geom`); first apply reproduces
  it, second apply resets to horizontal spanning the shape's bounds. Gradient start/end live in
  the shape **group's** coordinate space, so the horizontal reset maps `sourceRectAtTime`
  (layer-space) bounds through the **inverse of every enclosing group's transform**.
- **Removing the selected gradient drops the layer's selection** (the `.ffx` apply selects the
  Colors property). `applySwatch` re-asserts the originally-selected layers at the end.
- **Default palette / cache**: `getDefaultSwatches` ships imported ASE colors; bumping
  `DEFAULTS_VERSION` clears the persisted palette in `app.settings` **once** and reinstalls them.

## Verifying (no test suite)

Install into AE's `Scripts/ScriptUI Panels/` and restart, or `File → Scripts → Run Script
File…` for fast reload. Tint: known-color shape layer → expected label color. Split: a layer
with several groups → each new layer holds exactly one group. Gradient: extract a gradient
(with a custom direction) → apply to another shape → direction reproduced; click again →
horizontal reset; apply to a stroke → width preserved.

## Releasing a change

Bump the version in the `.jsx` (`PANEL_VERSION` in the outer envelope — shown in the footer
— and the module's own `VERSION`) and add a `## Changelog` entry in `README.md` saying what
it fixes. When changing the shipped default palette, also bump `DEFAULTS_VERSION` so existing
installs pick it up. Commit/push only when asked.
