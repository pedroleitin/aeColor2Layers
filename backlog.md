# Backlog — Color→Layer

Ideas not yet implemented, roughly in priority order.

## Palette

- **Store full gradient configuration in swatches** — _done (v0.10, extended v0.12)._ Swatches persist type + color stops (offset/midpoint/RGB) + alpha stops + **direction** (start/end points + highlight), and apply writes all of them back via `.ffx` preset injection.
- **Stroke gradient apply** — _done (v0.11)._ Stroke-specific `.ffx` template embedded; gradients now apply to strokes as well as fills.
- **Auto-save on Extract** — _done (v0.11)._ Extract saves the project first (Ctrl+S-style) so freshly-made gradients are read from disk without a manual save.
- **Remove paint button** — _done (v0.11)._ Strips Fill / Stroke / Both (solid + gradient) from selected shape layers per the target mode.
- **Gradient stop positions on replace** — _done (v0.11)._ Replacing an existing gradient now swaps in a fresh one (preserving geometry) so the preset's stop offsets apply instead of the old gradient's.
- **Preserve stroke width on apply** — _done (v0.12/v0.15)._ Applying a swatch changes only the color/direction; stroke width (and layer selection) survive solid↔gradient swaps.
- **Apply gradient with click-to-toggle behavior** — _done (v0.13, transform-correct v0.14)._ First click applies the swatch's colors + saved direction; clicking the same swatch again resets the direction to **horizontal** (start at the shape's leftmost point, end at its rightmost), correct even under group transforms.
- **Ship a default palette + cache reset** — _done (v0.16)._ Defaults imported from an ASE file; `DEFAULTS_VERSION` clears the persisted palette once so new defaults reach existing installs.

### Still open

- **Toggle stop-offset spacing** — the direction toggle resets *direction*; a separate idea is a toggle that resets the stop *offsets* to even spacing (keeping colors). Not yet built.
- **Save/restore more gradient params** — highlight length/angle are captured with direction, but per-swatch opacity and blend mode are not persisted yet.

## Tint

- **Custom user label colors** — probe AE's preference store at launch so tinting matches the user's edited `Preferences > Labels` colors instead of the hard-coded CC defaults.
