# Copilot instructions — Color→Layer

After Effects ScriptUI panel that reads a shape layer's fill colors and sets the layer's
timeline **Label color** to the closest of AE's 16 preference label presets. Single file,
no build, no tests.

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

Everything lives in one IIFE `(function (thisObj) { ... })(this)`. Pipeline per layer:

1. **`collectShapeColors`** → walks `ADBE Root Vectors Group` recursively via `walkGroup`,
   pushing each **enabled** Fill (and Stroke, when opted in) color as `[r,g,b]` in 0–255.
   AE stores color as 0–1 floats; scale to 255 once here.
2. **`dominantColor`** → arithmetic mean of all sampled colors.
3. **`rgbToLab`** → sRGB → linear RGB → CIE XYZ → CIE Lab (D65).
4. **`colorDistance`** → squared CIE76 ΔE (no sqrt — monotonic, so skipped).
5. **`closestLabelIndex`** → nearest of the 16 `LABEL_COLORS`, returns 1-based index.
6. **`applyToLayer`** sets `layer.label = idx`. `0` means "no label".

UI is built in `buildUI`; the action runs inside `app.beginUndoGroup` / `app.endUndoGroup`
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
floating window). Then open a comp with a known-color shape layer, click **Tint selected
layers**, and confirm the timeline row turns the expected label color.

## When changing the color math

Bump `VERSION` and add a `## Changelog` entry in `README.md` explaining what edge case the
change fixes — the changelog there documents why HSL was abandoned for Lab (v0.1→v0.4) and
is the institutional memory for this matcher.
