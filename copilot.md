# Copilot instructions — Color→Layer

After Effects ScriptUI panel for shape layers. It hosts **two tools stacked in one dockable
window**, sharing a single status footer:

- **Color→Layer** — two batch actions: **Tint** (set the timeline **Label color** to the
  closest of AE's 16 preference label presets) and **Split groups into layers** (duplicate a
  layer into one layer per top-level shape group).
- **Vector Color Swatches** — a persistent color palette: add / extract / import colors and
  apply a swatch to the Fill / Stroke / Both of selected shape layers.

Single file (`Color→Layer.jsx`), no build, no tests.

## The one rule that breaks everything: ES3 ExtendScript only

This runs in After Effects' ExtendScript engine, which is **ES3**. Do **not** suggest:

- `class`, `let`/`const` (use `var`)
- arrow functions (`=>`) — use `function () {}`
- template literals — use `"a" + b` string concatenation
- `Map`, `Set`, `for...of`, spread/rest, optional chaining (`?.`), nullish (`??`)
- modern Array/Object methods: `forEach`, `map`, `filter`, `reduce`, `Object.keys`,
  `Array.isArray`, `includes`, etc. — use classic `for (var i = 0; ...)` loops

If a snippet uses any of the above it will throw at load time in AE. When unsure, write it
the way the existing code does.

## Architecture (single file: `Color→Layer.jsx`)

The file is an outer envelope `(function (thisObj) { ... })(this)` that builds the window
(the top rainbow strip, two host containers, and one shared status footer), then calls two
**module functions** — `buildColorToLayerModule(host, sharedStatus)` and
`buildDynamicPaletteModule(host, sharedStatus)`. Each module keeps the original tool's logic
in its own scope, so same-named helpers (`buildUI`, `safeProp`, etc.) don't collide. When
editing a tool, work inside its module; shared chrome (window, footer, rainbow) lives in the
envelope. The palette module renders its icons from flattened Material SVG paths (ScriptUI
has no SVG/Bézier support) and forces AE's native color picker by temporarily toggling the
"Use System Color Picker" preference.

**Tint pipeline (per layer):**

1. **`collectShapeColors`** → walks `ADBE Root Vectors Group` recursively via `walkGroup`,
   pushing each **enabled** Fill (and Stroke, when opted in) color as `[r,g,b]` in 0–255.
   AE stores color as 0–1 floats; scale to 255 once here.
2. **`dominantColor`** → arithmetic mean of all sampled colors.
3. **`rgbToLab`** → sRGB → linear RGB → CIE XYZ → CIE Lab (D65).
4. **`colorDistance`** → squared CIE76 ΔE (no sqrt — monotonic, so skipped).
5. **`closestLabelIndex`** → nearest of the 16 `LABEL_COLORS`, returns 1-based index.
6. **`applyToLayer`** sets `layer.label = idx`. `0` means "no label".

**Split pipeline (per layer): `splitShapeLayerGroups`**

Duplicates the layer once per top-level `ADBE Vector Group`, then on each duplicate keeps
only the target group and removes the rest. Critical constraint: ExtendScript **cannot move
or copy a property across layers** (`PropertyBase.moveTo` only reorders within one parent),
and removing a sibling **invalidates any stored `Property` reference**. So deletion must
re-query `property(j)` by live index each time (`collectTopLevelGroups` finds them, the
loop walks descending and skips the keeper's index). Don't refactor this back into
clone-and-move or stored-reference deletion — that's exactly the v0.6 bug.

UI is built in `buildUI`; each action runs inside `app.beginUndoGroup` / `app.endUndoGroup`
so the whole batch reverts with one undo.

## Conventions to preserve

- **matchName, not display name** — AE properties are addressed by matchName strings
  (e.g. `"ADBE Vector Fill Color"`). See the table in `README.md`. Never rely on layer/
  property display names, which are localized and user-editable.
- **Guard every AE API call** — properties may not exist on a given layer/build. Use the
  existing `safeProp` / `staticValue` helpers and wrap risky reads in `try/catch`.
- **ScriptUI styling is best-effort** — graphics API support varies by OS/AE version;
  every `fontBold` / `colorDim` / `colorAccent` call is wrapped in `try/catch` and must
  stay that way so one quirk never breaks the panel.
- **Non-shape layers are skipped silently** — only `matchName === "ADBE Vector Layer"` is
  processed; report counts in the status line, don't error.
- Read animated values with `valueAtTime(0, false)` (value at comp start).

## Known limitations (don't "fix" silently — they're documented choices)

Gradients skipped, mean isn't area-weighted, label table is AE CC defaults (not the user's
customized labels), CIE76 not CIEDE2000. See `README.md` → "What it does NOT do".

## Verifying a change (no test suite)

Install `Color→Layer.jsx` into AE's `Scripts/ScriptUI Panels/` and restart AE, **or** for
fast iteration use `File → Scripts → Run Script File…` (reloads without restart, opens as a
floating window). Then open a comp with a known-color shape layer: click **Tint selected
layers** and confirm the timeline row turns the expected label color; or select a layer with
several groups, click **Split groups into layers**, and confirm each new layer holds exactly
one group.

## When changing the color math

Bump the version (`PANEL_VERSION` in the outer envelope and the module's own `VERSION`) and
add a `## Changelog` entry in `README.md` explaining what edge case the
change fixes — the changelog there documents why HSL was abandoned for Lab (v0.1→v0.4) and
is the institutional memory for this matcher.
