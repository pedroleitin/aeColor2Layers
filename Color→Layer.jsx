// @target after_effects
// =============================================================================
// Color→Layer — combined After Effects ScriptUI Panel
//
// Hosts two independent tools stacked vertically in one window:
//   1) Color→Layer      (from Color→Layer.jsx)
//   2) Vector Color Swatches / Dynamic Color Palette (from Dynamic Color Palette.jsx)
//
// The logic of each tool is untouched — each is wrapped in its own module
// function so their internal helpers and state stay isolated, and each renders
// into its own container inside the shared window.
// =============================================================================

(function (thisObj) {

  var PANEL_TITLE = "Color\u2192Layer";
  var PANEL_VERSION = "v0.16";

  var win = (thisObj instanceof Panel)
    ? thisObj
    : new Window("palette", PANEL_TITLE, undefined, { resizeable: true });

  win.orientation = "column";
  win.alignChildren = ["fill", "top"];
  win.spacing = 8;
  win.margins = [0, 0, 0, 6];

  // ----- Full-bleed rainbow strip -----
  // Thin decorative gradient bar flush against the top and side edges of the
  // whole window. Drawn band-by-band in a custom onDraw handler because
  // ScriptUI has no native gradient brush; best-effort and wrapped in
  // try/catch so the panel works even if nothing paints.
  var RAINBOW = [
    [0.90, 0.20, 0.20],   // red
    [1.00, 0.55, 0.10],   // orange
    [0.95, 0.85, 0.20],   // yellow
    [0.30, 0.75, 0.35],   // green
    [0.20, 0.55, 0.90],   // blue
    [0.35, 0.30, 0.80],   // indigo
    [0.60, 0.30, 0.85]    // violet
  ];
  var rainbow = win.add("group");
  rainbow.alignment = ["fill", "top"];
  rainbow.minimumSize.height = 5;
  rainbow.maximumSize.height = 5;
  rainbow.onDraw = function () {
    try {
      var g = this.graphics;
      var w = this.size.width;
      var h = this.size.height;
      var bands = RAINBOW.length;
      var i;
      for (i = 0; i < bands; i++) {
        var x0 = Math.floor(w * i / bands);
        var x1 = Math.floor(w * (i + 1) / bands);
        var brush = g.newBrush(g.BrushType.SOLID_COLOR,
          [RAINBOW[i][0], RAINBOW[i][1], RAINBOW[i][2], 1]);
        g.newPath();
        g.rectPath(x0, 0, x1 - x0, h);
        g.fillPath(brush);
      }
    } catch (eRainbow) {}
  };

  // ----- Section 1: Vector Color Swatches -----
  var host2 = win.add("group");
  host2.orientation = "column";
  host2.alignment = ["fill", "top"];

  // ----- Section 2: Color→Layer -----
  var host1 = win.add("group");
  host1.orientation = "column";
  host1.alignment = ["fill", "top"];

  // Flexible spacer that absorbs the leftover vertical room so the footer
  // below stays pinned to the bottom edge of the window. An explicit minimal
  // preferredSize makes ScriptUI treat the empty group as a proper spring.
  var spacer = win.add("group");
  spacer.alignment = ["fill", "fill"];
  spacer.minimumSize = [0, 0];
  spacer.preferredSize = [1, 1];
  spacer.maximumSize.height = 4000;

  // ----- Shared status footer -----
  // Both tools report into this single status line at the bottom of the
  // window. Everything lives on one row so the footer stays short; when the
  // window gets too short the footer is hidden entirely so the swatch grid
  // keeps the room (see win.onResizing).
  var footer = win.add("group");
  footer.orientation = "row";
  footer.alignment = ["fill", "bottom"];
  footer.alignChildren = ["left", "bottom"];
  footer.spacing = 6;
  footer.margins = [10, 0, 10, 0];

  var sharedStatus = footer.add("statictext", undefined,
    "Select one or more shape layers and use the tools above.",
    { multiline: true });
  sharedStatus.alignment = ["fill", "bottom"];
  sharedStatus.minimumSize.height = 16;

  var versionText = footer.add("statictext", undefined, PANEL_VERSION);
  versionText.alignment = ["right", "bottom"];
  versionText.justify = "right";
  try {
    var vtg = versionText.graphics;
    vtg.foregroundColor = vtg.newPen(vtg.PenType.SOLID_COLOR, [0.5, 0.5, 0.55, 1], 1);
  } catch (eVer) {}

  // Build both tools, injecting the shared status control so their messages
  // land in the same footer.
  buildColorToLayerModule(host1, sharedStatus);
  buildDynamicPaletteModule(host2, sharedStatus);

  try { win.layout.layout(true); } catch (eLay) {}
  try { win.layout.resize(); } catch (eRes) {}

  // Re-flow both sections when the shared window/dock is resized.
  win.onResizing = win.onResize = function () {
    // When the window gets too short, hide the status footer so the swatch
    // grid keeps the available room, then re-layout so the space is reclaimed.
    try {
      var showFooter = true;
      try { showFooter = (this.size.height >= 300); } catch (eH) {}
      if (footer.visible !== showFooter) {
        footer.visible = showFooter;
        try { this.layout.layout(true); } catch (eLay2) {}
      }
    } catch (eFoot) {}
    try { this.layout.resize(); } catch (e0) {}
    try { if (host1.onResizing) host1.onResizing(); } catch (e1) {}
    try { if (host2.onResizing) host2.onResizing(); } catch (e2) {}
    return true;
  };

  if (win instanceof Window) {
    win.center();
    win.show();
  }

// =============================================================================
// Color→Layer — After Effects ScriptUI Panel
// v0.7 — fixes the split-groups action: each duplicated layer now keeps only
//        one top-level shape group (all others removed via live index lookup
//        instead of stale Property refs / unsupported cross-layer moveTo).
//        Duplicates each selected shape layer and creates one new layer per
//        top-level shape group; the original layer is preserved.
//
// Reads the fill colors of the selected shape layer(s), picks the dominant
// color (average of all enabled Fill items), and sets the layer's Label
// property to the closest match from AE's 16 preference label colors. The
// timeline color of the layer ends up tinted to match what the layer
// actually draws.
//
// Style: ES3 ExtendScript only. No `class`, `let`/`const`, arrow fns,
// template literals, `Map`/`Set`, `for...of`, spread, optional chaining,
// or modern Array/Object methods.
// =============================================================================

function buildColorToLayerModule(__host__, __status__) {

  var VERSION = "v0.16";

  // ---------- helpers ----------

  function safeProp(group, matchName) {
    if (!group) return null;
    try { var p = group.property(matchName); return p || null; } catch (e) { return null; }
  }

  function staticValue(prop) {
    if (!prop) return null;
    try { return prop.valueAtTime(0, false); } catch (e) { return null; }
  }

  // ---------- AE label colors ----------
  //
  // AE stores 16 user-customisable label colors. Reading them from prefs
  // works on some AE builds but the section/key names have shifted between
  // versions; rather than trust that, we ship the CC-default RGB values as
  // a fallback. A user who has customised their label colors in
  // Preferences > Labels will get a close-but-not-exact match — which is
  // still useful for the typical "tint to roughly the right hue" use case.
  // A future version can probe the prefs and overwrite this table at panel
  // launch when the section names are confirmed for the running AE build.
  //
  // Order matters: index 0 = label index 1, etc. Layer.label is 1-based;
  // 0 means "no label".
  var LABEL_COLORS = [
    [200,  85,  85],   //  1 Red
    [240, 200,  90],   //  2 Yellow
    [120, 200, 220],   //  3 Aqua
    [230, 160, 215],   //  4 Pink
    [180, 180, 245],   //  5 Lavender
    [250, 210, 170],   //  6 Peach
    [180, 220, 180],   //  7 Sea Foam
    [ 45,  95, 210],   //  8 Blue
    [ 95, 160,  60],   //  9 Green
    [130,  90, 200],   // 10 Purple
    [210, 115,  70],   // 11 Orange
    [120,  75,  70],   // 12 Brown
    [185,  70, 185],   // 13 Fuchsia
    [ 75, 155, 185],   // 14 Cyan
    [150, 120,  90],   // 15 Sandstone
    [  0, 102,   0]    // 16 Dark Green
  ];

  var LABEL_NAMES = [
    "Red", "Yellow", "Aqua", "Pink", "Lavender", "Peach", "Sea Foam",
    "Blue", "Green", "Purple", "Orange", "Brown", "Fuchsia", "Cyan",
    "Sandstone", "Dark Green"
  ];

  // ---------- color extraction ----------

  // Walk a shape layer's Contents tree and push each enabled Fill's color
  // into `out` as a [r, g, b] tuple in 0–255 space. AE stores Fill Color
  // as floats in 0–1; we scale once here so the rest of the pipeline can
  // compare against LABEL_COLORS in a single shared range.
  //
  // Strokes are optionally included — the typical "label should match the
  // shape" intent is fill-driven, but a stroke-only icon (line art) needs
  // strokes to be sampled too. Controlled by the `includeStrokes` flag.
  //
  // Additionally, even with strokes off, a layer with NO enabled fills falls
  // back to its stroke colors so a stroke-only layer still gets tinted rather
  // than skipped.
  function collectShapeColors(layer, includeStrokes) {
    var acc = { fills: [], strokes: [] };
    var root = safeProp(layer, "ADBE Root Vectors Group");
    if (!root) return { colors: [], usedStrokeFallback: false };
    walkGroup(root, acc);
    var usedStrokeFallback = false;
    var colors = acc.fills;
    if (includeStrokes) {
      // Sample fills and strokes together.
      colors = acc.fills.concat(acc.strokes);
    } else if (acc.fills.length === 0 && acc.strokes.length > 0) {
      // No fills defined — fall back to strokes so the layer still gets a color.
      colors = acc.strokes;
      usedStrokeFallback = true;
    }
    return { colors: colors, usedStrokeFallback: usedStrokeFallback };
  }

  function walkGroup(group, acc) {
    var i;
    for (i = 1; i <= group.numProperties; i++) {
      var item = group.property(i);
      try { if (item.enabled === false) continue; } catch (eEn) {}
      var mn = item.matchName;
      if (mn === "ADBE Vector Group") {
        var inner = safeProp(item, "ADBE Vectors Group");
        if (inner) walkGroup(inner, acc);
      } else if (mn === "ADBE Vector Graphic - Fill") {
        var fc = safeProp(item, "ADBE Vector Fill Color");
        var rgb = staticValue(fc);
        if (rgb && rgb.length >= 3) {
          acc.fills.push([rgb[0] * 255, rgb[1] * 255, rgb[2] * 255]);
        }
      } else if (mn === "ADBE Vector Graphic - Stroke") {
        var sc = safeProp(item, "ADBE Vector Stroke Color");
        var srgb = staticValue(sc);
        if (srgb && srgb.length >= 3) {
          acc.strokes.push([srgb[0] * 255, srgb[1] * 255, srgb[2] * 255]);
        }
      }
    }
  }

  // Collect the top-level ADBE Vector Group children of a root vectors group,
  // in document order. Used to find which top-level groups to keep/remove on
  // a duplicated layer.
  function collectTopLevelGroups(root) {
    var groups = [];
    if (!root) return groups;
    var i;
    for (i = 1; i <= root.numProperties; i++) {
      var item = root.property(i);
      try {
        if (item.matchName === "ADBE Vector Group") groups.push(item);
      } catch (eCollect) {}
    }
    return groups;
  }

  function getTopLevelShapeGroups(layer) {
    return collectTopLevelGroups(safeProp(layer, "ADBE Root Vectors Group"));
  }

  // Split a multi-group shape layer into one layer per top-level shape group.
  //
  // ExtendScript can't move/copy a shape property from one layer into another
  // (PropertyBase.moveTo only reorders within the same parent group), so the
  // earlier "clear root + clone group across layers" approach silently failed.
  // Instead we duplicate the whole layer once per group — each duplicate
  // already contains every group — and then delete all top-level groups except
  // the one we want to keep. All edits stay inside a single layer's property
  // tree, which AE fully supports. The original layer is left untouched.
  function splitShapeLayerGroups(layer) {
    var srcGroups = getTopLevelShapeGroups(layer);
    if (!srcGroups || srcGroups.length <= 1) {
      return { ok: false, reason: "no groups to split" };
    }
    var count = srcGroups.length;

    // Capture group names up front from the original layer.
    var names = [];
    var n;
    for (n = 0; n < count; n++) {
      var nm = "";
      try { nm = srcGroups[n].name; } catch (eName) {}
      if (!nm) nm = "Group " + (n + 1);
      names.push(nm);
    }

    var baseName = layer.name;
    var created = 0;
    var i;
    for (i = 0; i < count; i++) {
      var dup = layer.duplicate();
      var dupRoot = safeProp(dup, "ADBE Root Vectors Group");
      if (!dupRoot) {
        try { dup.remove(); } catch (eRemove) {}
        continue;
      }

      if (collectTopLevelGroups(dupRoot).length !== count) {
        // Layout didn't match expectations — drop this duplicate rather than
        // leave a half-split layer behind.
        try { dup.remove(); } catch (eMismatch) {}
        continue;
      }

      // Find the property index of the i-th top-level group (the keeper).
      // We work with live indices, not stored Property references: removing a
      // sibling invalidates any reference held to another property, so each
      // lookup must re-query property(j) fresh.
      var keepIndex = -1;
      var ord = 0;
      var j;
      for (j = 1; j <= dupRoot.numProperties; j++) {
        if (dupRoot.property(j).matchName === "ADBE Vector Group") {
          if (ord === i) { keepIndex = j; break; }
          ord++;
        }
      }

      // Remove every other top-level group, descending so indices above the
      // keeper collapse without shifting it before we get there.
      for (j = dupRoot.numProperties; j >= 1; j--) {
        if (j === keepIndex) continue;
        try {
          var doomed = dupRoot.property(j);
          if (doomed.matchName === "ADBE Vector Group") doomed.remove();
        } catch (eDel) {}
      }

      try {
        dup.name = baseName + " / " + names[i];
      } catch (eLayerName) {}
      created++;
    }
    return { ok: true, created: created, groupNames: names };
  }

  // Naïve dominant-color picker: arithmetic mean of all sampled colors.
  // Good enough for the common "one or two fills per shape layer" case.
  // For layers with many fills of varied hue, this can land on a desaturated
  // grey that doesn't match anything well; a future version could:
  //   - weight by shape area (requires sampling each shape's bbox)
  //   - cluster colors and pick the largest cluster (k-means-ish)
  //   - return the most-saturated color rather than the mean
  // For v0.1 the mean is simple, predictable, and fine for typical icons.
  function dominantColor(colors) {
    if (colors.length === 0) return null;
    if (colors.length === 1) return colors[0];
    var r = 0, g = 0, b = 0;
    var i;
    for (i = 0; i < colors.length; i++) {
      r += colors[i][0];
      g += colors[i][1];
      b += colors[i][2];
    }
    return [r / colors.length, g / colors.length, b / colors.length];
  }

  // sRGB → CIE Lab (D65 illuminant). The chain is sRGB → linear RGB
  // (gamma decode) → CIE XYZ → Lab. Numbers come from the canonical
  // sRGB-to-XYZ matrix and the standard f(t) cube-root transform with
  // the 6/29 cutoff. Returns [L, a, b] where L ∈ [0, 100] (lightness),
  // a is green↔red, b is blue↔yellow.
  function rgbToLab(r, g, b) {
    function linearize(c) {
      c = c / 255;
      return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
    }
    var rl = linearize(r), gl = linearize(g), bl = linearize(b);
    var x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
    var y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750;
    var z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041;
    x = x / 0.95047;
    y = y / 1.00000;
    z = z / 1.08883;
    function f(t) {
      return t > 0.008856 ? Math.pow(t, 1 / 3) : (7.787 * t + 16 / 116);
    }
    var fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  // CIE76 squared Lab distance (ΔE*ab without the sqrt — sqrt is monotonic
  // so we can skip it). Lab is designed so that Euclidean distance
  // approximates perceived color difference, which makes it the right
  // metric for matching a shape's color to AE's 16 label presets:
  //   - HSL v0.2/v0.3 needed bespoke weighting because hue/sat/lightness
  //     aren't independent perceptual dimensions; vibrant orange kept
  //     winning Peach because their lightness was close even though hue
  //     was clearly Orange. Lab handles that uniformly without weights.
  //   - CIEDE2000 is more accurate but a lot more code; CIE76 is good
  //     enough for this 16-target matcher and is dependency-free in ES3.
  function colorDistance(a, b) {
    var labA = rgbToLab(a[0], a[1], a[2]);
    var labB = rgbToLab(b[0], b[1], b[2]);
    var dL = labA[0] - labB[0];
    var da = labA[1] - labB[1];
    var db = labA[2] - labB[2];
    return dL * dL + da * da + db * db;
  }

  function closestLabelIndex(rgb) {
    var best = 1;
    var bestDist = Infinity;
    var i;
    for (i = 0; i < LABEL_COLORS.length; i++) {
      var d = colorDistance(rgb, LABEL_COLORS[i]);
      if (d < bestDist) {
        bestDist = d;
        best = i + 1;
      }
    }
    return best;
  }

  // ---------- per-layer action ----------
  //
  // Returns one of:
  //   { ok: true,  labelIdx, labelName, rgb }  — applied
  //   { ok: false, reason }                    — couldn't apply (e.g. no fills)

  function applyToLayer(layer, includeStrokes) {
    var res = collectShapeColors(layer, includeStrokes);
    var colors = res.colors;
    if (colors.length === 0) {
      return { ok: false, reason: "no enabled fills or strokes found" };
    }
    var dom = dominantColor(colors);
    var idx = closestLabelIndex(dom);
    layer.label = idx;
    return {
      ok: true,
      labelIdx: idx,
      labelName: LABEL_NAMES[idx - 1],
      rgb: dom,
      usedStrokeFallback: res.usedStrokeFallback
    };
  }

  // ---------- UI ----------

  function buildUI(thisObj) {
    var win = thisObj;

    win.orientation = "column";
    win.alignChildren = ["fill", "top"];
    win.spacing = 8;
    win.margins = 10;

    // Best-effort font/color styling. ScriptUI's graphics API is
    // supported inconsistently across OS / AE versions; wrap every
    // styling call in try/catch so a quirk in one setup never breaks
    // the panel.
    function fontBold(el, size) {
      try {
        var g = el.graphics;
        g.font = ScriptUI.newFont(g.font.name, ScriptUI.FontStyle.BOLD, size);
      } catch (eF) {}
    }
    function colorDim(el) {
      try {
        var g = el.graphics;
        g.foregroundColor = g.newPen(g.PenType.SOLID_COLOR, [0.55, 0.55, 0.6, 1], 1);
      } catch (eC) {}
    }
    function colorAccent(el) {
      try {
        var g = el.graphics;
        g.foregroundColor = g.newPen(g.PenType.SOLID_COLOR, [1.0, 0.55, 0.1, 1], 1);
      } catch (eC) {}
    }

    // ===== Rounded button helpers =====
    // ScriptUI's native "button" can't be given rounded corners, so the primary
    // actions are custom-drawn "iconbutton" toolbuttons: onDraw paints a rounded
    // rectangle background plus centered text. Corners are approximated with a
    // few straight segments per quarter-circle (no native arc primitive).
    function roundRectPoints(x, y, w, h, r) {
      if (r > w / 2) { r = w / 2; }
      if (r > h / 2) { r = h / 2; }
      var seg = 4;
      var corners = [
        [x + w - r, y + r, -Math.PI / 2, 0],           // top-right
        [x + w - r, y + h - r, 0, Math.PI / 2],        // bottom-right
        [x + r, y + h - r, Math.PI / 2, Math.PI],      // bottom-left
        [x + r, y + r, Math.PI, Math.PI * 1.5]         // top-left
      ];
      var pts = [];
      var i, j;
      for (i = 0; i < corners.length; i++) {
        var cx = corners[i][0], cy = corners[i][1];
        var a0 = corners[i][2], a1 = corners[i][3];
        for (j = 0; j <= seg; j++) {
          var a = a0 + (a1 - a0) * (j / seg);
          pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
      }
      return pts;
    }
    function roundRectPath(g, x, y, w, h, r) {
      var pts = roundRectPoints(x, y, w, h, r);
      g.newPath();
      g.moveTo(pts[0][0], pts[0][1]);
      var i;
      for (i = 1; i < pts.length; i++) { g.lineTo(pts[i][0], pts[i][1]); }
      g.closePath();
    }

    // Minimal Material-icon support for the rounded buttons. The palette module
    // has its own richer copy; this is a self-contained subset so this module
    // (a separate ExtendScript scope) can draw a glyph without depending on it.
    var BTN_ICONS = {
      // alt_route — split groups into layers
      "split": { vb: [0, -960, 960, 960], d: "M450-80v-200q0-48-16-79t-49-64l43-43q13 11 27.5 30t24.5 35q17-26 33.5-45t31.5-32q58-47 83.5-113.5T648-766l-90 90-42-42 162-162 162 162-42 42-90-90q5 126-24.5 198.5T585-432q-44 40-59.5 73T510-280v200h-60ZM258-636q-4-18-6.5-52.5T251-765l-89 89-42-42 162-162 162 162-42 42-90-90q-2 38-1 66.5t5 49.5l-58 14Zm84 171q-17-18-37.5-47.5T273-577l59-15q9 25 24 48t28 37l-42 42Z" },
      // colors — tint selected layers
      "tint": { vb: [0, -960, 960, 960], d: "M348-138 98-388q-9-9.12-13.5-20.06T80-430.7q0-11.7 4.5-22.5T98-473l250-250-114-114 43-43 406 407q9.47 9 13.74 19.8 4.26 10.8 4.26 22.5t-4.26 22.64Q692.47-397.12 683-388L433-138q-9 9-19.8 13.5t-22.5 4.5q-11.7 0-22.64-4.5Q357.12-129 348-138Zm43-542L141-430h500L391-680Zm408.66 560q-33.35 0-56.5-23.18Q720-166.36 720-200q0-26.28 10-49.64T756-293l44-57 44 57q15 20 25.5 43.36T880-200q0 33.64-23.5 56.82T799.66-120Z" }
    };
    function flattenIconPath(d, steps) {
      if (!steps) steps = 12;
      var subs = [];
      var cur = null;
      var cx = 0, cy = 0, sx = 0, sy = 0, px = 0, py = 0;
      var prevCmd = "";
      var toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
      if (!toks) return subs;
      var i = 0;
      function num() { return parseFloat(toks[i++]); }
      function start(x, y) { cur = [[x, y]]; subs.push(cur); sx = x; sy = y; cx = x; cy = y; }
      function line(x, y) { if (!cur) start(cx, cy); cur.push([x, y]); cx = x; cy = y; }
      function quad(x1, y1, x, y) {
        var x0 = cx, y0 = cy, s, t, mt;
        for (s = 1; s <= steps; s++) {
          t = s / steps; mt = 1 - t;
          cur.push([mt * mt * x0 + 2 * mt * t * x1 + t * t * x,
                    mt * mt * y0 + 2 * mt * t * y1 + t * t * y]);
        }
        px = x1; py = y1; cx = x; cy = y;
      }
      function cubic(x1, y1, x2, y2, x, y) {
        var x0 = cx, y0 = cy, s, t, mt;
        for (s = 1; s <= steps; s++) {
          t = s / steps; mt = 1 - t;
          cur.push([mt * mt * mt * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x,
                    mt * mt * mt * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y]);
        }
        px = x2; py = y2; cx = x; cy = y;
      }
      while (i < toks.length) {
        var c = toks[i];
        if (/[a-zA-Z]/.test(c)) { i++; }
        else { c = prevCmd; if (c === "M") c = "L"; else if (c === "m") c = "l"; }
        var up = c.toUpperCase();
        var rel = (c === c.toLowerCase());
        var bx = rel ? cx : 0, by = rel ? cy : 0;
        if (up === "M") { var mx = num() + bx, my = num() + by; start(mx, my); }
        else if (up === "L") { var lx = num() + bx, ly = num() + by; line(lx, ly); }
        else if (up === "H") { line(num() + bx, cy); }
        else if (up === "V") { line(cx, num() + by); }
        else if (up === "C") { var c1x = num() + bx, c1y = num() + by, c2x = num() + bx, c2y = num() + by, ex = num() + bx, ey = num() + by; cubic(c1x, c1y, c2x, c2y, ex, ey); }
        else if (up === "S") { var s1x, s1y; var pu = prevCmd.toUpperCase(); if (pu === "C" || pu === "S") { s1x = 2 * cx - px; s1y = 2 * cy - py; } else { s1x = cx; s1y = cy; } var s2x = num() + bx, s2y = num() + by, sex = num() + bx, sey = num() + by; cubic(s1x, s1y, s2x, s2y, sex, sey); }
        else if (up === "Q") { var q1x = num() + bx, q1y = num() + by, qex = num() + bx, qey = num() + by; quad(q1x, q1y, qex, qey); }
        else if (up === "T") { var t1x, t1y; var puT = prevCmd.toUpperCase(); if (puT === "Q" || puT === "T") { t1x = 2 * cx - px; t1y = 2 * cy - py; } else { t1x = cx; t1y = cy; } var tex = num() + bx, tey = num() + by; quad(t1x, t1y, tex, tey); }
        else if (up === "A") { num(); num(); num(); num(); num(); var ax = num() + bx, ay = num() + by; line(ax, ay); }
        else if (up === "Z") { if (cur) cur.push([sx, sy]); cx = sx; cy = sy; }
        else { i++; }
        prevCmd = c;
      }
      return subs;
    }
    // Draw a glyph def filling `size` px, its top-left at (ox, oy), in `color`.
    function drawIconAt(g, def, ox, oy, size, color) {
      if (!def._subs) def._subs = flattenIconPath(def.d, 12);
      var subs = def._subs;
      if (!subs || !subs.length) return false;
      var vb = def.vb;
      var scale = size / Math.max(vb[2], vb[3]);
      function mapX(x) { return ox + (x - vb[0]) * scale; }
      function mapY(y) { return oy + (y - vb[1]) * scale; }
      try {
        var brush = g.newBrush(g.BrushType.SOLID_COLOR, color);
        g.newPath();
        var s, p, pts;
        for (s = 0; s < subs.length; s++) {
          pts = subs[s];
          if (!pts.length) continue;
          g.moveTo(mapX(pts[0][0]), mapY(pts[0][1]));
          for (p = 1; p < pts.length; p++) { g.lineTo(mapX(pts[p][0]), mapY(pts[p][1])); }
        }
        g.fillPath(brush);
      } catch (eIcon) { return false; }
      return true;
    }

    function drawRoundButton(drawState) {
      var g = this.graphics;
      var w = (this.size && this.size[0]) ? this.size[0] : 120;
      var h = (this.size && this.size[1]) ? this.size[1] : 30;
      var over = drawState && drawState.mouseOver;
      var down = drawState && drawState.leftButtonPressed;
      var on = this.enabled;
      var bg = !on ? [0.18, 0.18, 0.20, 1]
        : (down ? [0.16, 0.16, 0.18, 1]
          : (over ? [0.30, 0.30, 0.34, 1] : [0.235, 0.235, 0.255, 1]));
      try {
        var brush = g.newBrush(g.BrushType.SOLID_COLOR, bg);
        roundRectPath(g, 0.5, 0.5, w - 1, h - 1, 6);
        g.fillPath(brush);
        var pen = g.newPen(g.PenType.SOLID_COLOR, [1, 1, 1, 0.10], 1);
        roundRectPath(g, 0.5, 0.5, w - 1, h - 1, 6);
        g.strokePath(pen);
      } catch (eBg) {}
      var tcol = on ? [0.93, 0.93, 0.95, 1] : [0.5, 0.5, 0.55, 1];
      var iconSize = 18;
      var iconPad = 10;
      var iconDef = (this._icon && BTN_ICONS[this._icon]) ? BTN_ICONS[this._icon] : null;
      try {
        var txt = this._label || "";
        var font = this._font || g.font;
        var tpen = g.newPen(g.PenType.SOLID_COLOR, tcol, 1);
        var dim = g.measureString(txt, font, w);
        var tw = (dim && dim.width) ? dim.width : (dim ? dim[0] : 0);
        var th = (dim && dim.height) ? dim.height : (dim ? dim[1] : 0);
        // Icon (if any) pinned to the left edge; label stays centered.
        if (iconDef) {
          drawIconAt(g, iconDef, iconPad, (h - iconSize) / 2, iconSize, tcol);
        }
        g.drawString(txt, tpen, (w - tw) / 2, (h - th) / 2, font);
      } catch (eTxt) {}
    }
    function makeRoundButton(parent, label, tip, handler) {
      var btn = parent.add("iconbutton", undefined, undefined,
        { style: "toolbutton", toggle: false });
      btn._label = label;
      btn.helpTip = tip;
      try { btn._font = ScriptUI.newFont(btn.graphics.font.name, ScriptUI.FontStyle.BOLD, 13); } catch (eF) {}
      btn.onDraw = drawRoundButton;
      btn.onClick = handler;
      return btn;
    }

    // ===== Primary actions =====
    // Tint button sits beside a compact "Strokes" toggle that controls whether
    // stroke colors are sampled alongside fills.
    var applyBtn = makeRoundButton(win, "Tint selected layers",
      "Walk each selected shape layer's enabled Fill items, "
      + "compute the mean color, and set the layer's Label color to the "
      + "closest of AE's 16 label presets. Layers with no fill fall back to "
      + "their stroke color.", null);
    applyBtn._icon = "tint";
    applyBtn.alignment = ["left", "top"];
    applyBtn.maximumSize.width = 290;
    applyBtn.preferredSize = [290, 34];
    applyBtn.minimumSize = [80, 34];

    // Strokes toggle is hidden for now: layers with no fill already fall back
    // to their stroke color automatically. This flag stands in for the old
    // checkbox so the click handler is unchanged; false = fills-only sampling.
    var includeStrokes = false;

    var splitBtn = makeRoundButton(win, "Split groups into layers",
      "Duplicate each selected shape layer and create one new layer per top-level shape group.",
      null);
    splitBtn._icon = "split";
    splitBtn.alignment = ["left", "top"];
    splitBtn.maximumSize.width = 290;
    splitBtn.preferredSize = [290, 34];
    splitBtn.minimumSize = [80, 34];

    // ===== Status area =====
    // Reuses the shared status control from the host window so this tool and
    // the palette tool report into the same footer line.
    var statusText = __status__;

    applyBtn.onClick = function () {
      var comp = app.project.activeItem;
      if (!comp || !(comp instanceof CompItem)) {
        statusText.text = "No active composition. Open or select a comp first.";
        return;
      }
      var selected = comp.selectedLayers;
      if (!selected || selected.length === 0) {
        statusText.text = "Nothing selected — pick one or more shape layers.";
        return;
      }
      var inclStrokes = !!includeStrokes;

      app.beginUndoGroup("Color\u2192Layer: tint labels");
      var tinted = 0;
      var skipped = 0;
      var summary = [];
      var i;
      for (i = 0; i < selected.length; i++) {
        var L = selected[i];
        if (L.matchName !== "ADBE Vector Layer") {
          skipped++;
          continue;
        }
        var res = applyToLayer(L, inclStrokes);
        if (res.ok) {
          tinted++;
          summary.push(L.name + " → " + res.labelName);
        } else {
          skipped++;
        }
      }
      app.endUndoGroup();

      var msg = "Tinted " + tinted + " layer(s)";
      if (skipped) msg += "; skipped " + skipped;
      msg += ".";
      if (summary.length && summary.length <= 5) {
        msg += "\n" + summary.join("\n");
      }
      statusText.text = msg;
    };

    splitBtn.onClick = function () {
      var comp = app.project.activeItem;
      if (!comp || !(comp instanceof CompItem)) {
        statusText.text = "No active composition. Open or select a comp first.";
        return;
      }
      var selected = comp.selectedLayers;
      if (!selected || selected.length === 0) {
        statusText.text = "Nothing selected — pick one or more shape layers.";
        return;
      }

      app.beginUndoGroup("Color\u2192Layer: split groups");
      var created = 0;
      var skipped = 0;
      var summary = [];
      var i;
      for (i = 0; i < selected.length; i++) {
        var L = selected[i];
        if (L.matchName !== "ADBE Vector Layer") {
          skipped++;
          continue;
        }
        var res = splitShapeLayerGroups(L);
        if (res.ok) {
          created += res.created;
          if (res.groupNames && res.groupNames.length > 0) {
            summary.push(L.name + " → " + res.groupNames.join(", "));
          }
        } else {
          skipped++;
        }
      }
      app.endUndoGroup();

      var msg = "Created " + created + " split layer(s)";
      if (skipped) msg += "; skipped " + skipped;
      msg += ".";
      if (summary.length && summary.length <= 5) {
        msg += "\n" + summary.join("\n");
      }
      statusText.text = msg;
    };

    win.layout.layout(true);
    win.layout.resize();

    // Docked-panel resize handler — re-flow children when AE resizes the
    // dock chrome after construction. Without this, the Tint button stays
    // at its intrinsic width on the left edge in docked mode.
    var BTN_MAX_W = 290;
    function fitButtons() {
      var avail = 0;
      try { if (win.size && win.size[0]) { avail = win.size[0] - 20; } } catch (eBW) {}
      if (avail <= 0) { return; }
      var w = avail < BTN_MAX_W ? avail : BTN_MAX_W;
      if (w < 80) { w = 80; }
      try {
        applyBtn.preferredSize = [w, 34];
        applyBtn.maximumSize = [w, 34];
        splitBtn.preferredSize = [w, 34];
        splitBtn.maximumSize = [w, 34];
      } catch (eFB) {}
    }
    win.onResizing = win.onResize = function () {
      fitButtons();
      try { this.layout.resize(); } catch (eR) {}
    };

    if (win instanceof Window) {
      win.center();
      win.show();
    }
    fitButtons();
    try { win.layout.resize(); } catch (eIR) {}
    return win;
  }

  buildUI(__host__);
}


/*
 * Vector Color Swatches
 *
 * Simple palette for Adobe After Effects vector layers.
 * Click a swatch to replace the selected fill/stroke color on the selected
 * vector layer. Choose Fill, Stroke, or Both in the panel.
 *
 * Usage:
 * - Select a vector layer in After Effects.
 * - Click a swatch to apply the color.
 * - Use the target mode to decide whether the color should affect Fill,
 *   Stroke, or both.
 * - Use "Extract" to grab existing fill/stroke colors from the selected
 *   layers and add them to the active palette.
 * - Use "Import ASE" to load Adobe Swatch Exchange palettes.
 */

function buildDynamicPaletteModule(__host__, __status__) {
    "use strict";

    var SCRIPT_NAME = "Vector Color Swatches";
    var SCRIPT_VERSION = "1.3";
    var SETTINGS_SECTION = "VectorColorSwatches";
    var SETTINGS_KEY = "palette";
    var SETTINGS_NAME_KEY = "paletteName";
    var SETTINGS_PALETTES_KEY = "paletteNames";
    var SETTINGS_ACTIVE_KEY = "activePalette";
    // Bumping DEFAULTS_VERSION clears the persisted palette cache ONCE on the
    // next open and reinstalls getDefaultSwatches(), so shipped default colors
    // actually reach existing installs (settings otherwise persist forever).
    var SETTINGS_DEFAULTS_VERSION_KEY = "defaultsVersion";
    var DEFAULTS_VERSION = "2";
    var CELL = 38;
    var COLUMNS = 6;
    var SEP_RECORD = "\u001E";
    var SEP_FIELD = "\u001F";

    var swatches = [];
    var paletteCatalog = [];
    var selectedIndex = -1;
    var paletteName = "Main Palette";
    var targetMode = "both";

    var swatchPanel;
    var statusText;
    var titleField;
    var paletteCombo;
    var removeBtn;
    var fillIconBtn;
    var strokeIconBtn;
    var bothIconBtn;
    var hexField;
    var reflowing = false;

    function sanitizeText(text) {
        return String(text || "").replace(/[\u001E\u001F]/g, " ");
    }

    function normalizePaletteName(text) {
        var name = sanitizeText(text || "Main Palette").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
        if (!name) {
            name = "Main Palette";
        }
        return name;
    }

    function rgbToArray(value) {
        if (!value || value.length < 3) {
            return [0.5, 0.5, 0.5];
        }
        return [value[0], value[1], value[2]];
    }

    function arrayToColor(rgb) {
        return [rgb[0], rgb[1], rgb[2], 1];
    }

    function intToRgb(value) {
        return [
            ((value >> 16) & 0xFF) / 255,
            ((value >> 8) & 0xFF) / 255,
            (value & 0xFF) / 255
        ];
    }

    function rgbToInt(rgb) {
        var r = Math.round(rgb[0] * 255);
        var g = Math.round(rgb[1] * 255);
        var b = Math.round(rgb[2] * 255);
        return (r << 16) | (g << 8) | b;
    }

    function rgbToHex(rgb) {
        function channel(v) {
            var n = Math.round(v * 255);
            if (n < 0) { n = 0; }
            if (n > 255) { n = 255; }
            var s = n.toString(16);
            return s.length < 2 ? "0" + s : s;
        }
        return "#" + channel(rgb[0]) + channel(rgb[1]) + channel(rgb[2]);
    }

    function hexToRgb(hex) {
        if (!hex) {
            return null;
        }
        var m = String(hex).replace(/^\s+|\s+$/g, "").replace(/^#/, "");
        if (/^[0-9a-fA-F]{3}$/.test(m)) {
            m = m.charAt(0) + m.charAt(0) + m.charAt(1) + m.charAt(1) + m.charAt(2) + m.charAt(2);
        }
        if (!/^[0-9a-fA-F]{6}$/.test(m)) {
            return null;
        }
        return [
            parseInt(m.substr(0, 2), 16) / 255,
            parseInt(m.substr(2, 2), 16) / 255,
            parseInt(m.substr(4, 2), 16) / 255
        ];
    }

    function pickColor(currentRgb) {
        // $.colorPicker() is the only script-accessible color picker in AE, and
        // which dialog it shows (the OS picker vs AE's own "Shape Fill Color"
        // picker) is governed by the "Use System Color Picker" preference.
        // Temporarily force it off so the AE-native picker appears, then restore
        // whatever the user had. Guarded by havePref/try-catch: if the pref
        // isn't present on this build, nothing changes and the OS picker shows.
        var KEY = "Use System Color Picker";
        var SECTIONS = ["Main Pref Section v2", "Main Pref Section", "General Section v2"];
        var TYPE = null;
        try { TYPE = PREFType.PREF_Type_MACHINE_INDEPENDENT; } catch (eT) {}
        var usedSection = null, prevVal = null;
        try {
            if (TYPE !== null && app.preferences && app.preferences.havePref) {
                var s;
                for (s = 0; s < SECTIONS.length; s++) {
                    if (app.preferences.havePref(SECTIONS[s], KEY, TYPE)) {
                        usedSection = SECTIONS[s];
                        prevVal = app.preferences.getPrefAsLong(usedSection, KEY, TYPE);
                        if (prevVal !== 0) {
                            app.preferences.savePrefAsLong(usedSection, KEY, 0, TYPE);
                        }
                        break;
                    }
                }
            }
        } catch (ePref) { usedSection = null; }

        var picked = $.colorPicker(currentRgb ? rgbToInt(currentRgb) : -1);

        try {
            if (usedSection !== null && prevVal !== null && prevVal !== 0) {
                app.preferences.savePrefAsLong(usedSection, KEY, prevVal, TYPE);
            }
        } catch (ePref2) {}

        if (picked < 0) {
            return null;
        }
        return intToRgb(picked);
    }

    function getActiveComp() {
        var item = app.project ? app.project.activeItem : null;
        if (!item || !(item instanceof CompItem)) {
            alert("Open a composition and select a vector layer first.", SCRIPT_NAME);
            return null;
        }
        return item;
    }

    function getPaletteKey(name) {
        return "palette_" + normalizePaletteName(name).replace(/[^A-Za-z0-9_]/g, "_");
    }

    function getDefaultSwatches() {
        // Imported from grid-palette-2026-07-09.ase (Adobe Swatch Exchange).
        return [
            { type: "solid", name: "Brown", color: [0.403922, 0.262745, 0.164706] },
            { type: "solid", name: "Red", color: [1, 0.003922, 0.003922] },
            { type: "solid", name: "Orange", color: [1, 0.615686, 0] },
            { type: "solid", name: "White", color: [1, 1, 1] }
        ];
    }

    // Clear the persisted palette cache ONCE per DEFAULTS_VERSION bump and
    // reinstall the shipped default swatches, so new default colors reach
    // existing installs whose AE settings would otherwise keep the old palette
    // forever. Runs before the first loadPalette(); no-op once the stored marker
    // matches, so a user's later edits are never wiped again.
    function resetDefaultsIfNeeded() {
        var stored = "";
        try {
            if (app.settings.haveSetting(SETTINGS_SECTION, SETTINGS_DEFAULTS_VERSION_KEY)) {
                stored = app.settings.getSetting(SETTINGS_SECTION, SETTINGS_DEFAULTS_VERSION_KEY);
            }
        } catch (eGet) {}
        if (stored === DEFAULTS_VERSION) {
            return;
        }
        try {
            var defaults = getDefaultSwatches();
            app.settings.saveSetting(SETTINGS_SECTION, SETTINGS_PALETTES_KEY, "Main Palette");
            app.settings.saveSetting(SETTINGS_SECTION, SETTINGS_ACTIVE_KEY, "Main Palette");
            app.settings.saveSetting(SETTINGS_SECTION, SETTINGS_NAME_KEY, "Main Palette");
            app.settings.saveSetting(SETTINGS_SECTION, getPaletteKey("Main Palette"), serializeSwatches(defaults));
            app.settings.saveSetting(SETTINGS_SECTION, SETTINGS_DEFAULTS_VERSION_KEY, DEFAULTS_VERSION);
        } catch (eSave) {}
    }

    function serializeSwatches(list) {
        var payload = [];
        for (var i = 0; i < list.length; i++) {
            var s = list[i];
            if (isGradient(s)) {
                var parts = ["G", sanitizeText(s.name || "Gradient"), s.gradType, s.stops.length];
                var k;
                for (k = 0; k < s.stops.length; k++) {
                    var st = s.stops[k];
                    parts.push(st.pos, (st.mid === undefined ? 0.5 : st.mid), st.r, st.g, st.b);
                }
                parts.push(s.alphaStops.length);
                for (k = 0; k < s.alphaStops.length; k++) {
                    var al = s.alphaStops[k];
                    parts.push(al.pos, (al.mid === undefined ? 0.5 : al.mid), al.a);
                }
                // Geometry (direction + highlight), appended so older records
                // still parse. Marker "GEO" then start x/y, end x/y, hlen, hang.
                if (s.geom && s.geom.start && s.geom.end) {
                    parts.push("GEO",
                        s.geom.start[0], s.geom.start[1],
                        s.geom.end[0], s.geom.end[1],
                        (s.geom.hlen === undefined ? 0 : s.geom.hlen),
                        (s.geom.hang === undefined ? 0 : s.geom.hang));
                }
                payload.push(parts.join(SEP_FIELD));
            } else {
                payload.push([
                    "S",
                    sanitizeText(s.name || "Swatch"),
                    s.color[0],
                    s.color[1],
                    s.color[2]
                ].join(SEP_FIELD));
            }
        }
        return payload.join(SEP_RECORD);
    }

    function deserializeSwatches(text) {
        var records = text ? text.split(SEP_RECORD) : [];
        var result = [];
        for (var i = 0; i < records.length; i++) {
            if (!records[i]) {
                continue;
            }
            var fields = records[i].split(SEP_FIELD);
            if (fields[0] === "G") {
                var gs = parseGradientRecord(fields);
                if (gs) {
                    result.push(gs);
                }
            } else if (fields[0] === "S") {
                if (fields.length < 5) {
                    continue;
                }
                result.push({
                    type: "solid",
                    name: fields[1],
                    color: [parseFloat(fields[2]), parseFloat(fields[3]), parseFloat(fields[4])]
                });
            } else {
                // Legacy format (pre-gradient): name + r + g + b, no type token.
                if (fields.length < 4) {
                    continue;
                }
                result.push({
                    type: "solid",
                    name: fields[0],
                    color: [parseFloat(fields[1]), parseFloat(fields[2]), parseFloat(fields[3])]
                });
            }
        }
        return result;
    }

    function parseGradientRecord(fields) {
        // fields: G, name, gradType, N, (pos,mid,r,g,b)xN, M, (pos,mid,a)xM
        if (fields.length < 4) {
            return null;
        }
        var name = fields[1];
        var gradType = Math.round(parseFloat(fields[2])) || 1;
        var n = Math.round(parseFloat(fields[3]));
        var idx = 4;
        if (n < 1 || (idx + n * 5) > fields.length) {
            return null;
        }
        var stops = [];
        var k;
        for (k = 0; k < n; k++) {
            stops.push({
                pos: parseFloat(fields[idx]), mid: parseFloat(fields[idx + 1]),
                r: parseFloat(fields[idx + 2]), g: parseFloat(fields[idx + 3]), b: parseFloat(fields[idx + 4])
            });
            idx += 5;
        }
        var alphaStops = [];
        var geom = null;
        if (idx < fields.length) {
            var m = Math.round(parseFloat(fields[idx])); idx += 1;
            for (k = 0; k < m && (idx + 2) < fields.length + 1; k++) {
                alphaStops.push({
                    pos: parseFloat(fields[idx]), mid: parseFloat(fields[idx + 1]), a: parseFloat(fields[idx + 2])
                });
                idx += 3;
            }
        }
        // Optional trailing geometry block: "GEO", startX, startY, endX, endY, hlen, hang.
        if (idx < fields.length && fields[idx] === "GEO" && (idx + 6) < fields.length + 1) {
            geom = {
                start: [parseFloat(fields[idx + 1]), parseFloat(fields[idx + 2])],
                end: [parseFloat(fields[idx + 3]), parseFloat(fields[idx + 4])],
                hlen: parseFloat(fields[idx + 5]),
                hang: parseFloat(fields[idx + 6])
            };
            idx += 7;
        }
        if (!alphaStops.length) {
            alphaStops = [{ pos: 0, mid: 0.5, a: 1 }, { pos: 1, mid: 0.5, a: 1 }];
        }
        return { type: "gradient", name: name, gradType: gradType, stops: stops, alphaStops: alphaStops, geom: geom };
    }

    function listContains(list, value) {
        for (var i = 0; i < list.length; i++) {
            if (list[i] === value) {
                return true;
            }
        }
        return false;
    }

    function saveCurrentPalette() {
        var safeName = normalizePaletteName(paletteName);
        if (safeName !== paletteName) {
            paletteName = safeName;
        }
        if (!listContains(paletteCatalog, paletteName)) {
            paletteCatalog.push(paletteName);
        }
        app.settings.saveSetting(SETTINGS_SECTION, SETTINGS_PALETTES_KEY, paletteCatalog.join(SEP_RECORD));
        app.settings.saveSetting(SETTINGS_SECTION, SETTINGS_ACTIVE_KEY, safeName);
        app.settings.saveSetting(SETTINGS_SECTION, SETTINGS_NAME_KEY, safeName);
        app.settings.saveSetting(SETTINGS_SECTION, getPaletteKey(safeName), serializeSwatches(swatches));
    }

    function loadPaletteCatalog() {
        paletteCatalog = [];
        if (app.settings.haveSetting(SETTINGS_SECTION, SETTINGS_PALETTES_KEY)) {
            var namesText = app.settings.getSetting(SETTINGS_SECTION, SETTINGS_PALETTES_KEY);
            var names = namesText ? namesText.split(SEP_RECORD) : [];
            for (var i = 0; i < names.length; i++) {
                var name = normalizePaletteName(names[i]);
                if (name && !listContains(paletteCatalog, name)) {
                    paletteCatalog.push(name);
                }
            }
        }
        if (!paletteCatalog.length) {
            paletteCatalog.push("Main Palette");
        }
        var activeName = "Main Palette";
        if (app.settings.haveSetting(SETTINGS_SECTION, SETTINGS_ACTIVE_KEY)) {
            activeName = normalizePaletteName(app.settings.getSetting(SETTINGS_SECTION, SETTINGS_ACTIVE_KEY));
        } else if (app.settings.haveSetting(SETTINGS_SECTION, SETTINGS_NAME_KEY)) {
            activeName = normalizePaletteName(app.settings.getSetting(SETTINGS_SECTION, SETTINGS_NAME_KEY));
        }
        if (!activeName) {
            activeName = "Main Palette";
        }
        if (!listContains(paletteCatalog, activeName)) {
            paletteCatalog.push(activeName);
        }
        paletteName = activeName;
    }

    function loadPalette(name) {
        var targetName = normalizePaletteName(name || paletteName || "Main Palette");
        loadPaletteCatalog();
        if (app.settings.haveSetting(SETTINGS_SECTION, getPaletteKey(targetName))) {
            swatches = deserializeSwatches(app.settings.getSetting(SETTINGS_SECTION, getPaletteKey(targetName)));
        } else {
            swatches = [];
        }
        if (!swatches.length) {
            swatches = getDefaultSwatches();
        }
        paletteName = targetName;
        selectedIndex = swatches.length ? 0 : -1;
        saveCurrentPalette();
        if (titleField) {
            titleField.text = paletteName;
        }
        refreshPaletteCombo();
        rebuildSwatches();
        updateStatus();
    }

    function switchPalette(name) {
        var targetName = normalizePaletteName(name || paletteName || "Main Palette");
        if (targetName === paletteName) {
            return;
        }
        saveCurrentPalette();
        loadPalette(targetName);
    }

    function clearChildren(container) {
        while (container.children.length > 0) {
            container.remove(container.children[0]);
        }
    }

    // Thin vertical divider used inside the action toolbar to set the
    // destructive "clear all" button apart from the rest.
    function drawDivider() {
        try {
            var g = this.graphics;
            var b = g.newBrush(g.BrushType.SOLID_COLOR, [1, 1, 1, 0.18]);
            g.newPath();
            g.rectPath(0, 0, 1, this.size.height);
            g.fillPath(b);
        } catch (eDiv) {}
    }

    // Minimal flow-layout engine. ScriptUI can't reparent controls and has no
    // native wrapping, so each "flow" owns a host column group and rebuilds its
    // children into as many single-line row sub-groups as fit `avail` px wide.
    // Items are described by an approximate width plus a create(row) callback
    // that builds the control fresh (and re-wires any shared module vars). A
    // layout signature guards against rebuilding when the wrapping is unchanged,
    // so dragging the panel doesn't flicker.
    function makeFlow(host, spacing) {
        var items = [];
        var flow = {
            host: host,
            _sig: "",
            add: function (w, create) {
                items.push({ w: w, create: create });
                return flow;
            },
            reset: function () { flow._sig = ""; },
            reflow: function (avail) {
                if (!avail || avail <= 0) { avail = 99999; }
                var breaks = [];
                var used = 0, rowStart = 0, k;
                for (k = 0; k < items.length; k++) {
                    var iw = items[k].w;
                    if (k === rowStart) {
                        used = iw;
                    } else if ((used + spacing + iw) > avail) {
                        breaks.push(k);
                        rowStart = k;
                        used = iw;
                    } else {
                        used = used + spacing + iw;
                    }
                }
                var sig = breaks.join(",") + "|" + items.length;
                if (sig === flow._sig) { return false; }
                flow._sig = sig;
                clearChildren(host);
                var row = null;
                for (k = 0; k < items.length; k++) {
                    var isBreak = false;
                    for (var b = 0; b < breaks.length; b++) {
                        if (breaks[b] === k) { isBreak = true; break; }
                    }
                    if (k === 0 || isBreak || !row) {
                        row = host.add("group");
                        row.orientation = "row";
                        row.alignChildren = ["left", "center"];
                        row.alignment = ["left", "top"];
                        row.spacing = spacing;
                        row.margins = 0;
                    }
                    items[k].create(row);
                }
                return true;
            }
        };
        return flow;
    }

    function makeModeClick(mode) {
        return function () { setTargetMode(mode); };
    }

    function makeModeBtn(row, mode, tip) {
        var b = row.add("iconbutton", undefined, undefined, { style: "toolbutton", toggle: true });
        b.mode = mode;
        b.size = [42, 34];
        b.preferredSize = [42, 34];
        b.helpTip = tip;
        b.onDraw = drawTargetIcon;
        b.onClick = makeModeClick(mode);
        return b;
    }

    function colorMatches(a, b) {
        return Math.round(a[0] * 100) === Math.round(b[0] * 100) &&
            Math.round(a[1] * 100) === Math.round(b[1] * 100) &&
            Math.round(a[2] * 100) === Math.round(b[2] * 100);
    }

    // ---------- Gradient support ----------
    //
    // AE stores a Gradient Fill / Stroke's stops in the "ADBE Vector Grad
    // Colors" property as a flat numeric array (PropertyValueType.CUSTOM_VALUE):
    //
    //   [ N,                                   // color-stop count
    //     pos, mid, r, g, b,  (x N)            // each color stop, 0..1
    //     M,                                   // alpha-stop count
    //     pos, mid, a,        (x M) ]          // each alpha stop, 0..1
    //
    // `mid` is the relative position (0..1) of the blend midpoint diamond
    // toward the next stop (0.5 = centered). Everything is 0..1, not 0..255.
    var GRAD_FILL_MATCH = "ADBE Vector Graphic - G-Fill";
    var GRAD_STROKE_MATCH = "ADBE Vector Graphic - G-Stroke";
    var GRAD_COLORS_MATCH = "ADBE Vector Grad Colors";
    var GRAD_TYPE_MATCH = "ADBE Vector Grad Type";
    var GRAD_START_MATCH = "ADBE Vector Grad Start Pt";
    var GRAD_END_MATCH = "ADBE Vector Grad End Pt";
    var GRAD_HLEN_MATCH = "ADBE Vector Grad HiLite Length";
    var GRAD_HANG_MATCH = "ADBE Vector Grad HiLite Angle";
    var STROKE_WIDTH_MATCH = "ADBE Vector Stroke Width";
    var GRAD_DEBUG = false;
    var gradDebugLog = [];
    var savedProjectStr;   // cached .aep text (sentinel: undefined = not read yet)

    function isGradient(sw) {
        return sw && sw.type === "gradient";
    }

    // ===== Gradient stop colours via saved-project parsing =====
    //
    // "ADBE Vector Grad Colors" is a NO_VALUE property in AE's scripting model
    // (.value / .keyValue() throw). The only way to read the stop colours is to
    // open the SAVED project file as text and pull the <prop.map> XML block AE
    // serialises after each "ADBE Vector Grad Colors" occurrence. Ported from
    // the Lottie-HTML AE→HTML exporter (itself a port of Bodymovin's
    // ProjectParser.getGradientData). The project MUST be saved; colours come
    // from the last saved state.

    // Read the saved project file as one text string (cached). BINARY encoding
    // so a binary .aep isn't truncated at its first null byte; the embedded
    // <prop.map> ASCII fragments stay searchable.
    function readSavedProjectString() {
        if (savedProjectStr !== undefined) {
            return savedProjectStr;
        }
        savedProjectStr = null;
        try {
            var ff = app.project ? app.project.file : null;
            if (ff) {
                var f = new File(ff.absoluteURI);
                f.encoding = "BINARY";
                if (f.open("r")) {
                    savedProjectStr = f.read();
                    f.close();
                }
            }
        } catch (e) {
            savedProjectStr = null;
        }
        return savedProjectStr;
    }

    function resetSavedProjectCache() {
        savedProjectStr = undefined;
    }

    // Position a search cursor just past a name path ([compName, layerName,
    // ...groupNames]). AE serialises each name as a length-prefixed "Utf8"
    // declaration; match that exact declaration and take the nearest one after
    // the parent. Falls back to a name+"LIST" heuristic for older AE / .aepx.
    function aepFindNav(fileString, nav) {
        var navigationIndex = 0;
        for (var i = 0; i < nav.length; i++) {
            if (nav[i] === null || nav[i] === undefined || nav[i] === "") {
                continue;
            }
            var name = String(nav[i]);
            var utf8 = unescape(encodeURIComponent(name));
            var len = utf8.length;
            var marker = "Utf8"
                + String.fromCharCode((len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff)
                + utf8;
            var idx = fileString.indexOf(marker, navigationIndex + 1);
            if (idx !== -1) {
                navigationIndex = idx + marker.length;
                continue;
            }
            var encoded = unescape(encodeURIComponent(name + "LIST"));
            idx = fileString.indexOf(encoded, navigationIndex + 1);
            if (idx === -1) {
                encoded = unescape(encodeURIComponent(name + " LIST"));
                idx = fileString.indexOf(encoded, navigationIndex + 1);
            }
            if (idx === -1) {
                encoded = utf8;
                idx = fileString.indexOf(encoded, navigationIndex + 1);
            }
            if (idx !== -1) {
                navigationIndex = idx;
            }
        }
        return navigationIndex;
    }

    // Pull the numbers out of one <array>…</array> block. The
    // <array.type><float/></array.type> header's self-closing <float/> has no
    // text, so the <float>X</float> pattern skips it automatically.
    function aepExtractFloats(arrayBlock) {
        var floats = [];
        var re = /<float>([^<]*)<\/float>/g;
        var m;
        while ((m = re.exec(arrayBlock)) !== null) {
            floats.push(Number(m[1]));
        }
        return floats;
    }

    // Collect the float arrays for every stop carrying `valueKey` ("Stops
    // Color" / "Stops Alpha") within a region, in document order.
    function aepParseStopList(region, valueKey) {
        var stops = [];
        if (!region) {
            return stops;
        }
        var marker = "<key>" + valueKey + "</key>";
        var idx = region.indexOf(marker);
        while (idx !== -1) {
            var aStart = region.indexOf("<array>", idx);
            if (aStart === -1) {
                break;
            }
            var aEnd = region.indexOf("</array>", aStart);
            if (aEnd === -1) {
                break;
            }
            stops.push(aepExtractFloats(region.substr(aStart, aEnd - aStart)));
            idx = region.indexOf(marker, aEnd);
        }
        return stops;
    }

    // Split one gradient <prop.map> block into raw colour + alpha stop arrays.
    // Colour entries: [offset, midpoint, R, G, B]; alpha: [offset, midpoint, a].
    function aepParsePropMap(block) {
        var colorKeyIdx = block.indexOf("<key>Color Stops</key>");
        var alphaKeyIdx = block.indexOf("<key>Alpha Stops</key>");
        var colorRegion = (colorKeyIdx !== -1) ? block.substr(colorKeyIdx) : "";
        var alphaRegion = "";
        if (alphaKeyIdx !== -1) {
            alphaRegion = (colorKeyIdx !== -1 && colorKeyIdx > alphaKeyIdx)
                ? block.substr(alphaKeyIdx, colorKeyIdx - alphaKeyIdx)
                : block.substr(alphaKeyIdx);
        }
        return {
            colors: aepParseStopList(colorRegion, "Stops Color"),
            alphas: aepParseStopList(alphaRegion, "Stops Alpha")
        };
    }

    // Read the static gradient stops for the container at name-path `nav` from
    // the saved project. Returns {stops:[{pos,mid,r,g,b}], alphaStops:[{pos,mid,a}]}
    // or null when unavailable.
    function readGradientStopsFromAep(nav) {
        var fileString = readSavedProjectString();
        if (!fileString) {
            if (GRAD_DEBUG) { gradDebugLog.push("no saved project string (project unsaved?)"); }
            return null;
        }
        if (fileString.indexOf(GRAD_COLORS_MATCH) === -1) {
            if (GRAD_DEBUG) { gradDebugLog.push("no Grad Colors marker in project file"); }
            return null;
        }
        try {
            var navigationIndex = aepFindNav(fileString, nav || []);
            var gradientIndex = fileString.indexOf(GRAD_COLORS_MATCH, navigationIndex);
            if (gradientIndex === -1) {
                gradientIndex = fileString.indexOf(GRAD_COLORS_MATCH);
                if (gradientIndex === -1) {
                    return null;
                }
            }
            var mapStart = fileString.indexOf("<prop.map", gradientIndex);
            if (mapStart === -1) {
                if (GRAD_DEBUG) { gradDebugLog.push("no <prop.map> after Grad Colors"); }
                return null;
            }
            var endMatch = "</prop.map>";
            var mapEnd = fileString.indexOf(endMatch, mapStart);
            if (mapEnd === -1) {
                return null;
            }
            var block = fileString.substr(mapStart, mapEnd + endMatch.length - mapStart);
            var parsed = aepParsePropMap(block);
            var rawColors = parsed.colors;   // [[offset, mid, R, G, B], …]
            var rawAlphas = parsed.alphas;   // [[offset, mid, a], …]
            if (GRAD_DEBUG) {
                var rawDump = [];
                for (var rc = 0; rc < rawColors.length; rc++) { rawDump.push("[" + rawColors[rc].join(",") + "]"); }
                gradDebugLog.push("raw color stops = " + rawDump.join(" "));
            }
            if (!rawColors.length) {
                if (GRAD_DEBUG) { gradDebugLog.push("prop.map had no colour stops"); }
                return null;
            }
            var stops = [];
            var i;
            for (i = 0; i < rawColors.length; i++) {
                var c = rawColors[i];
                stops.push({
                    pos: num01(c[0]), mid: (c[1] === undefined ? 0.5 : num01(c[1])),
                    r: num01(c[2]), g: num01(c[3]), b: num01(c[4])
                });
            }
            stops.sort(sortByPos);
            var alphaStops = [];
            for (i = 0; i < rawAlphas.length; i++) {
                var a = rawAlphas[i];
                alphaStops.push({
                    pos: num01(a[0]), mid: (a[1] === undefined ? 0.5 : num01(a[1])),
                    a: num01(a[2])
                });
            }
            alphaStops.sort(sortByPos);
            if (!alphaStops.length) {
                alphaStops = [{ pos: 0, mid: 0.5, a: 1 }, { pos: 1, mid: 0.5, a: 1 }];
            }
            if (GRAD_DEBUG) {
                var posList = [];
                for (var dbg = 0; dbg < stops.length; dbg++) { posList.push(stops[dbg].pos); }
                gradDebugLog.push("aep parse OK: " + stops.length + " stops, " + alphaStops.length + " alpha; color offsets = [" + posList.join(", ") + "]");
            }
            return { stops: stops, alphaStops: alphaStops };
        } catch (eParse) {
            if (GRAD_DEBUG) { gradDebugLog.push("aep parse threw: " + eParse.toString()); }
            return null;
        }
    }

    function num01(v) {
        var n = Number(v);
        if (isNaN(n)) {
            return 0;
        }
        return n;
    }

    function sortByPos(a, b) {
        if (a.pos === b.pos) {
            return 0;
        }
        return (a.pos < b.pos) ? -1 : 1;
    }

    // ===== Gradient WRITE via .ffx animation-preset injection =====
    //
    // "ADBE Vector Grad Colors" is NO_VALUE, so setValue can't write the stop
    // colours. The one technique that works in pure ExtendScript (used by
    // AEUX / Overlord) is to build an animation preset (.ffx) that carries the
    // stop colours in its <prop.map> XML and apply it with layer.applyPreset().
    //
    // GRAD_FFX_B64 is a real "Colors"-only preset captured from AE, base64'd.
    // We decode it, swap its <prop.map> XML for one built from the swatch's
    // stops, patch the RIFX chunk sizes, write a temp .ffx and applyPreset it
    // onto the target gradient's Colors property. The skeleton is independent
    // of stop count (the XML carries every stop), so one template covers 2..N.

    var GRAD_FFX_B64 = "UklGWAAAFGZGYUZYaGVhZAAAABAAAAADAAAAYAAAAAkAAAAATElTVAAAFEJiZXNjYmVzbwAAADgAAAABAAAAAQAAFAAAAHgAADwA"
        + "AAAAAAQAAQABAgACAD/wAAAAAAAAP/AAAAAAAAAAAAAA/////0xJU1QAAAE8dGRzcHRkb3QAAAAE/////3RkcGwAAAAEAAAABExJ"
        + "U1QAAABAdGRzaXRkaXgAAAAE/////3RkbW4AAAAoQURCRSBSb290IFZlY3RvcnMgR3JvdXAAAAAAAAAAAAAAAAAAAAAAAExJU1QA"
        + "AABAdGRzaXRkaXgAAAAEAAAAAHRkbW4AAAAoQURCRSBWZWN0b3IgR3JvdXAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAExJU1QAAABA"
        + "dGRzaXRkaXgAAAAE/////3RkbW4AAAAoQURCRSBWZWN0b3JzIEdyb3VwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAExJU1QAAABAdGRz"
        + "aXRkaXgAAAAEAAAAAXRkbW4AAAAoQURCRSBWZWN0b3IgR3JhcGhpYyAtIEctRmlsbAAAAAAAAAAAAAAAAHRkc24AAAAYVXRmOAAA"
        + "AA9HcmFkaWVudCBGaWxsIDEATElTVAAAAGR0ZHNwdGRvdAAAAAT/////dGRwbAAAAAQAAAABTElTVAAAAEB0ZHNpdGRpeAAAAAT/"
        + "////dGRtbgAAAChBREJFIEVuZCBvZiBwYXRoIHNlbnRpbmVsAAAAAAAAAAAAAAAAAAAATElTVAAAEiZ0ZGdwdGRzYgAAAAQAAAAB"
        + "dGRzbgAAABhVdGY4AAAAD0dyYWRpZW50IEZpbGwgMQB0ZG1uAAAAKEFEQkUgVmVjdG9yIEJsZW5kIE1vZGUAAAAAAAAAAAAAAAAA"
        + "AAAAAABMSVNUAAAA2nRkYnN0ZHNiAAAABAAAAAN0ZHNuAAAADlV0ZjgAAAAGLV8wXy8tdGRiNAAAAHzbmQABAAEAAAACAAAAAHgA"
        + "Pxo24uscQy0/8AAAAAAAAD/wAAAAAAAAP/AAAAAAAAA/8AAAAAAAAAAAAAQEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        + "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY2RhdAAAACg/8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        + "AAAAAAAAdGRtbgAAAChBREJFIFZlY3RvciBDb21wb3NpdGUgT3JkZXIAAAAAAAAAAAAAAAAATElTVAAAANp0ZGJzdGRzYgAAAAQA"
        + "AAABdGRzbgAAAA5VdGY4AAAABi1fMF8vLXRkYjQAAAB825kAAQABAAAAAgAAAAB4AD8aNuLrHEMtP/AAAAAAAAA/8AAAAAAAAD/w"
        + "AAAAAAAAP/AAAAAAAAAAAAAEBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        + "AAAAAAAAAGNkYXQAAAAoP/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHRkbW4AAAAoQURCRSBWZWN0b3Ig"
        + "RmlsbCBSdWxlAAAAAAAAAAAAAAAAAAAAAAAAAExJU1QAAADadGRic3Rkc2IAAAAEAAAAAXRkc24AAAAOVXRmOAAAAAYtXzBfLy10"
        + "ZGI0AAAAfNuZAAEAAQAAAAIAAAAAeAA/Gjbi6xxDLT/wAAAAAAAAP/AAAAAAAAA/8AAAAAAAAD/wAAAAAAAAAAAABAQAAAAAAAAA"
        + "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABjZGF0AAAAKD/wAAAAAAAAAAAA"
        + "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB0ZG1uAAAAKEFEQkUgVmVjdG9yIEdyYWQgVHlwZQAAAAAAAAAAAAAAAAAAAAAA"
        + "AABMSVNUAAAA2nRkYnN0ZHNiAAAABAAAAAF0ZHNuAAAADlV0ZjgAAAAGLV8wXy8tdGRiNAAAAHzbmQABAAEAAAACAAAAAHgAPxo2"
        + "4uscQy0/8AAAAAAAAD/wAAAAAAAAP/AAAAAAAAA/8AAAAAAAAAAAAAQEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        + "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY2RhdAAAACg/8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        + "AAAAdGRtbgAAAChBREJFIFZlY3RvciBHcmFkIFN0YXJ0IFB0AAAAAAAAAAAAAAAAAAAATElTVAAAAOJ0ZGJzdGRzYgAAAAQAAAAB"
        + "dGRzbgAAAA5VdGY4AAAABi1fMF8vLXRkYjQAAAB825kAAgAPAAP/////AAB4AD8aNuLrHEMtP/AAAAAAAAA/8AAAAAAAAD/wAAAA"
        + "AAAAP/AAAAAAAAAAAAAICQAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        + "AAAAAGNkYXQAAAAwwFU4bQAAAADARH8rAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAdGRtbgAAAChBREJFIFZl"
        + "Y3RvciBHcmFkIEVuZCBQdAAAAAAAAAAAAAAAAAAAAAAATElTVAAAAOJ0ZGJzdGRzYgAAAAQAAAABdGRzbgAAAA5VdGY4AAAABi1f"
        + "MF8vLXRkYjQAAAB825kAAgAPAAP/////AAB4AD8aNuLrHEMtP/AAAAAAAAA/8AAAAAAAAD/wAAAAAAAAP/AAAAAAAAAAAAAICQAA"
        + "AAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGNkYXQAAAAwQGD3TqAA"
        + "AABAXaokgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAdGRtbgAAAChBREJFIFZlY3RvciBHcmFkIEhpTGl0ZSBM"
        + "ZW5ndGgAAAAAAAAAAAAATElTVAAAAPp0ZGJzdGRzYgAAAAQAAAADdGRzbgAAAA5VdGY4AAAABi1fMF8vLXRkYjQAAAB825kAAQAB"
        + "AAD/////AAB4AD8aNuLrHEMtP/AAAAAAAAA/8AAAAAAAAD/wAAAAAAAAP/AAAAAAAAAAAAAECAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        + "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGNkYXQAAAAoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        + "AAAAAAAAAAAAAAAAAAAAAHRkdW0AAAAIwFkAAAAAAAB0ZHVNAAAACEBZAAAAAAAAdGRtbgAAAChBREJFIFZlY3RvciBHcmFkIEhp"
        + "TGl0ZSBBbmdsZQAAAAAAAAAAAAAATElTVAAAANp0ZGJzdGRzYgAAAAQAAAADdGRzbgAAAA5VdGY4AAAABi1fMF8vLXRkYjQAAAB8"
        + "25kAAQABAAAAAv//AAB4AD8aNuLrHEMtP/AAAAAAAAA/8AAAAAAAAD/wAAAAAAAAP/AAAAAAAAAAAAAICQAAAAAAAAAAAAAAAAAA"
        + "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGNkYXQAAAAoAAAAAAAAAAAAAAAAAAAAAAAA"
        + "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAHRkbW4AAAAoQURCRSBWZWN0b3IgR3JhZCBDb2xvcnMAAAAAAAAAAAAAAAAAAAAAAExJU1QA"
        + "AAecR0NzdExJU1QAAAC2dGRic3Rkc2IAAAAEAAAAAXRkc24AAAAOVXRmOAAAAAYtXzBfLy10ZGI0AAAAfNuZAAEABwAA/////wAA"
        + "eAA/Gjbi6xxDLT/wAAAAAAAAP/AAAAAAAAA/8AAAAAAAAD/wAAAAAAAAAAEACAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAA"
        + "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABjZGF0AAAABAAAAABMSVNUAAAG0kdDa3lVdGY4AAAGxTw/eG1sIHZl"
        + "cnNpb249JzEuMCc/Pgo8cHJvcC5tYXAgdmVyc2lvbj0nNCc+Cjxwcm9wLmxpc3Q+Cjxwcm9wLnBhaXI+CjxrZXk+R3JhZGllbnQg"
        + "Q29sb3IgRGF0YTwva2V5Pgo8cHJvcC5saXN0Pgo8cHJvcC5wYWlyPgo8a2V5PkFscGhhIFN0b3BzPC9rZXk+Cjxwcm9wLmxpc3Q+"
        + "Cjxwcm9wLnBhaXI+CjxrZXk+U3RvcHMgTGlzdDwva2V5Pgo8cHJvcC5saXN0Pgo8cHJvcC5wYWlyPgo8a2V5PlN0b3AtMDwva2V5"
        + "Pgo8cHJvcC5saXN0Pgo8cHJvcC5wYWlyPgo8a2V5PlN0b3BzIEFscGhhPC9rZXk+CjxhcnJheT4KPGFycmF5LnR5cGU+PGZsb2F0"
        + "Lz48L2FycmF5LnR5cGU+CjxmbG9hdD4wPC9mbG9hdD4KPGZsb2F0PjAuNTwvZmxvYXQ+CjxmbG9hdD4xPC9mbG9hdD4KPC9hcnJh"
        + "eT4KPC9wcm9wLnBhaXI+CjwvcHJvcC5saXN0Pgo8L3Byb3AucGFpcj4KPHByb3AucGFpcj4KPGtleT5TdG9wLTE8L2tleT4KPHBy"
        + "b3AubGlzdD4KPHByb3AucGFpcj4KPGtleT5TdG9wcyBBbHBoYTwva2V5Pgo8YXJyYXk+CjxhcnJheS50eXBlPjxmbG9hdC8+PC9h"
        + "cnJheS50eXBlPgo8ZmxvYXQ+MTwvZmxvYXQ+CjxmbG9hdD4wLjU8L2Zsb2F0Pgo8ZmxvYXQ+MTwvZmxvYXQ+CjwvYXJyYXk+Cjwv"
        + "cHJvcC5wYWlyPgo8L3Byb3AubGlzdD4KPC9wcm9wLnBhaXI+CjwvcHJvcC5saXN0Pgo8L3Byb3AucGFpcj4KPHByb3AucGFpcj4K"
        + "PGtleT5TdG9wcyBTaXplPC9rZXk+CjxpbnQgdHlwZT0ndW5zaWduZWQnIHNpemU9JzMyJz4yPC9pbnQ+CjwvcHJvcC5wYWlyPgo8"
        + "L3Byb3AubGlzdD4KPC9wcm9wLnBhaXI+Cjxwcm9wLnBhaXI+CjxrZXk+Q29sb3IgU3RvcHM8L2tleT4KPHByb3AubGlzdD4KPHBy"
        + "b3AucGFpcj4KPGtleT5TdG9wcyBMaXN0PC9rZXk+Cjxwcm9wLmxpc3Q+Cjxwcm9wLnBhaXI+CjxrZXk+U3RvcC0wPC9rZXk+Cjxw"
        + "cm9wLmxpc3Q+Cjxwcm9wLnBhaXI+CjxrZXk+U3RvcHMgQ29sb3I8L2tleT4KPGFycmF5Pgo8YXJyYXkudHlwZT48ZmxvYXQvPjwv"
        + "YXJyYXkudHlwZT4KPGZsb2F0PjA8L2Zsb2F0Pgo8ZmxvYXQ+MC41PC9mbG9hdD4KPGZsb2F0PjAuMzYwNzg0MzI8L2Zsb2F0Pgo8"
        + "ZmxvYXQ+MC41NTI5NDEyPC9mbG9hdD4KPGZsb2F0PjAuOTcyNTQ5MDg8L2Zsb2F0Pgo8ZmxvYXQ+MTwvZmxvYXQ+CjwvYXJyYXk+"
        + "CjwvcHJvcC5wYWlyPgo8L3Byb3AubGlzdD4KPC9wcm9wLnBhaXI+Cjxwcm9wLnBhaXI+CjxrZXk+U3RvcC0xPC9rZXk+Cjxwcm9w"
        + "Lmxpc3Q+Cjxwcm9wLnBhaXI+CjxrZXk+U3RvcHMgQ29sb3I8L2tleT4KPGFycmF5Pgo8YXJyYXkudHlwZT48ZmxvYXQvPjwvYXJy"
        + "YXkudHlwZT4KPGZsb2F0PjE8L2Zsb2F0Pgo8ZmxvYXQ+MC41PC9mbG9hdD4KPGZsb2F0PjAuMTYwNzg0MzI8L2Zsb2F0Pgo8Zmxv"
        + "YXQ+MC4yNjY2NjY2ODwvZmxvYXQ+CjxmbG9hdD4wLjUwOTgwMzk1PC9mbG9hdD4KPGZsb2F0PjE8L2Zsb2F0Pgo8L2FycmF5Pgo8"
        + "L3Byb3AucGFpcj4KPC9wcm9wLmxpc3Q+CjwvcHJvcC5wYWlyPgo8L3Byb3AubGlzdD4KPC9wcm9wLnBhaXI+Cjxwcm9wLnBhaXI+"
        + "CjxrZXk+U3RvcHMgU2l6ZTwva2V5Pgo8aW50IHR5cGU9J3Vuc2lnbmVkJyBzaXplPSczMic+MjwvaW50Pgo8L3Byb3AucGFpcj4K"
        + "PC9wcm9wLmxpc3Q+CjwvcHJvcC5wYWlyPgo8L3Byb3AubGlzdD4KPC9wcm9wLnBhaXI+Cjxwcm9wLnBhaXI+CjxrZXk+R3JhZGll"
        + "bnQgQ29sb3JzPC9rZXk+CjxzdHJpbmc+MS4wPC9zdHJpbmc+CjwvcHJvcC5wYWlyPgo8L3Byb3AubGlzdD4KPC9wcm9wLm1hcD4K"
        + "AHRkbW4AAAAoQURCRSBWZWN0b3IgRmlsbCBPcGFjaXR5AAAAAAAAAAAAAAAAAAAAAExJU1QAAAD6dGRic3Rkc2IAAAAEAAAAAXRk"
        + "c24AAAAOVXRmOAAAAAYtXzBfLy10ZGI0AAAAfNuZAAEAAQAA/////wAAeAA/Gjbi6xxDLT/wAAAAAAAAP/AAAAAAAAA/8AAAAAAA"
        + "AD/wAAAAAAAAAAAABAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        + "AABjZGF0AAAAKEBZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB0ZHVtAAAACAAAAAAAAAAAdGR1TQAAAAhA"
        + "WQAAAAAAAHRkbW4AAAAoQURCRSBHcm91cCBFbmQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/"
        + "IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+Cjx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1w"
        + "dGs9IkFkb2JlIFhNUCBDb3JlIDkuMS1jMDAzIDc5Ljk2OTBhODcsIDIwMjUvMDMvMDYtMTk6MTI6MDMgICAgICAgICI+CiAgIDxy"
        + "ZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+CiAgICAgIDxyZGY6"
        + "RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiCiAgICAgICAgICAgIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMv"
        + "MS4xLyIKICAgICAgICAgICAgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIgogICAgICAgICAgICB4bWxu"
        + "czp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIKICAgICAgICAgICAgeG1sbnM6c3RFdnQ9Imh0dHA6Ly9u"
        + "cy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZUV2ZW50IyI+CiAgICAgICAgIDxkYzpmb3JtYXQ+YXBwbGljYXRpb24v"
        + "dm5kLmFkb2JlLmFmdGVyZWZmZWN0cy5wcmVzZXQtYW5pbWF0aW9uPC9kYzpmb3JtYXQ+CiAgICAgICAgIDx4bXA6Q3JlYXRvclRv"
        + "b2w+QWRvYmUgQWZ0ZXIgRWZmZWN0cyAyMDI1IChNYWNpbnRvc2gpPC94bXA6Q3JlYXRvclRvb2w+CiAgICAgICAgIDx4bXA6Q3Jl"
        + "YXRlRGF0ZT4yMDI2LTA3LTA5VDEzOjQ0OjAxLTAzOjAwPC94bXA6Q3JlYXRlRGF0ZT4KICAgICAgICAgPHhtcDpNZXRhZGF0YURh"
        + "dGU+MjAyNi0wNy0wOVQxMzo0NDowMS0wMzowMDwveG1wOk1ldGFkYXRhRGF0ZT4KICAgICAgICAgPHhtcDpNb2RpZnlEYXRlPjIw"
        + "MjYtMDctMDlUMTM6NDQ6MDEtMDM6MDA8L3htcDpNb2RpZnlEYXRlPgogICAgICAgICA8eG1wTU06SW5zdGFuY2VJRD54bXAuaWlk"
        + "OjdiZjI1NjIwLTBkMGMtNDA1OS05ZWY2LTRmYzQwNTE1NGIzZDwveG1wTU06SW5zdGFuY2VJRD4KICAgICAgICAgPHhtcE1NOkRv"
        + "Y3VtZW50SUQ+eG1wLmRpZDo3YmYyNTYyMC0wZDBjLTQwNTktOWVmNi00ZmM0MDUxNTRiM2Q8L3htcE1NOkRvY3VtZW50SUQ+CiAg"
        + "ICAgICAgIDx4bXBNTTpPcmlnaW5hbERvY3VtZW50SUQ+eG1wLmRpZDo3YmYyNTYyMC0wZDBjLTQwNTktOWVmNi00ZmM0MDUxNTRi"
        + "M2Q8L3htcE1NOk9yaWdpbmFsRG9jdW1lbnRJRD4KICAgICAgICAgPHhtcE1NOkhpc3Rvcnk+CiAgICAgICAgICAgIDxyZGY6U2Vx"
        + "PgogICAgICAgICAgICAgICA8cmRmOmxpIHJkZjpwYXJzZVR5cGU9IlJlc291cmNlIj4KICAgICAgICAgICAgICAgICAgPHN0RXZ0"
        + "OmFjdGlvbj5jcmVhdGVkPC9zdEV2dDphY3Rpb24+CiAgICAgICAgICAgICAgICAgIDxzdEV2dDppbnN0YW5jZUlEPnhtcC5paWQ6"
        + "N2JmMjU2MjAtMGQwYy00MDU5LTllZjYtNGZjNDA1MTU0YjNkPC9zdEV2dDppbnN0YW5jZUlEPgogICAgICAgICAgICAgICAgICA8"
        + "c3RFdnQ6d2hlbj4yMDI2LTA3LTA5VDEzOjQ0OjAxLTAzOjAwPC9zdEV2dDp3aGVuPgogICAgICAgICAgICAgICAgICA8c3RFdnQ6"
        + "c29mdHdhcmVBZ2VudD5BZG9iZSBBZnRlciBFZmZlY3RzIDIwMjUgKE1hY2ludG9zaCk8L3N0RXZ0OnNvZnR3YXJlQWdlbnQ+CiAg"
        + "ICAgICAgICAgICAgIDwvcmRmOmxpPgogICAgICAgICAgICA8L3JkZjpTZXE+CiAgICAgICAgIDwveG1wTU06SGlzdG9yeT4KICAg"
        + "ICAgPC9yZGY6RGVzY3JpcHRpb24+CiAgIDwvcmRmOlJERj4KPC94OnhtcG1ldGE+CiAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAK"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAKPD94"
        + "cGFja2V0IGVuZD0idyI/Pg==";

    // Stroke gradients need their OWN preset: applyPreset matches the full
    // parent chain (...G-Fill vs ...G-Stroke), so the fill template can't be
    // reused for a stroke's Colors. Capture a "Gradient Stroke > Colors" preset
    // the same way and paste its base64 here to enable stroke gradients.
    var GRAD_FFX_STROKE_B64 = "UklGWAAACe5GYUZYaGVhZAAAABAAAAADAAAAYAAAAAkAAAAATElTVAAACcpiZXNjYmVzbwAAADgAAAABAAAAAQAAAAAAAHgAAB4A"
        + "AAAAAAQAAQABBDgEOD/wAAAAAAAAP/AAAAAAAAAAAAAA/////0xJU1QAAAGEdGRzcHRkb3QAAAAE/////3RkcGwAAAAEAAAABUxJ"
        + "U1QAAABAdGRzaXRkaXgAAAAE/////3RkbW4AAAAoQURCRSBSb290IFZlY3RvcnMgR3JvdXAAAAAAAAAAAAAAAAAAAAAAAExJU1QA"
        + "AABAdGRzaXRkaXgAAAAEAAAAAHRkbW4AAAAoQURCRSBWZWN0b3IgR3JvdXAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAExJU1QAAABA"
        + "dGRzaXRkaXgAAAAE/////3RkbW4AAAAoQURCRSBWZWN0b3JzIEdyb3VwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAExJU1QAAABAdGRz"
        + "aXRkaXgAAAAEAAAAAXRkbW4AAAAoQURCRSBWZWN0b3IgR3JhcGhpYyAtIEctU3Ryb2tlAAAAAAAAAAAAAExJU1QAAABAdGRzaXRk"
        + "aXgAAAAE/////3RkbW4AAAAoQURCRSBWZWN0b3IgR3JhZCBDb2xvcnMAAAAAAAAAAAAAAAAAAAAAAHRkc24AAAAOVXRmOAAAAAZD"
        + "b2xvcnNMSVNUAAAAZHRkc3B0ZG90AAAABP////90ZHBsAAAABAAAAAFMSVNUAAAAQHRkc2l0ZGl4AAAABP////90ZG1uAAAAKEFE"
        + "QkUgRW5kIG9mIHBhdGggc2VudGluZWwAAAAAAAAAAAAAAAAAAABMSVNUAAAHcEdDc3RMSVNUAAAAtnRkYnN0ZHNiAAAABAAAAAF0"
        + "ZHNuAAAADlV0ZjgAAAAGQ29sb3JzdGRiNAAAAHzbmQABAAcAAP////8AAHgAPxo24uscQy0/8AAAAAAAAD/wAAAAAAAAP/AAAAAA"
        + "AAA/8AAAAAAAAAABAAgAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        + "AAAAY2RhdAAAAAQAAAAATElTVAAABqZHQ2t5VXRmOAAABpk8P3htbCB2ZXJzaW9uPScxLjAnPz4KPHByb3AubWFwIHZlcnNpb249"
        + "JzQnPgo8cHJvcC5saXN0Pgo8cHJvcC5wYWlyPgo8a2V5PkdyYWRpZW50IENvbG9yIERhdGE8L2tleT4KPHByb3AubGlzdD4KPHBy"
        + "b3AucGFpcj4KPGtleT5BbHBoYSBTdG9wczwva2V5Pgo8cHJvcC5saXN0Pgo8cHJvcC5wYWlyPgo8a2V5PlN0b3BzIExpc3Q8L2tl"
        + "eT4KPHByb3AubGlzdD4KPHByb3AucGFpcj4KPGtleT5TdG9wLTA8L2tleT4KPHByb3AubGlzdD4KPHByb3AucGFpcj4KPGtleT5T"
        + "dG9wcyBBbHBoYTwva2V5Pgo8YXJyYXk+CjxhcnJheS50eXBlPjxmbG9hdC8+PC9hcnJheS50eXBlPgo8ZmxvYXQ+MDwvZmxvYXQ+"
        + "CjxmbG9hdD4wLjU8L2Zsb2F0Pgo8ZmxvYXQ+MTwvZmxvYXQ+CjwvYXJyYXk+CjwvcHJvcC5wYWlyPgo8L3Byb3AubGlzdD4KPC9w"
        + "cm9wLnBhaXI+Cjxwcm9wLnBhaXI+CjxrZXk+U3RvcC0xPC9rZXk+Cjxwcm9wLmxpc3Q+Cjxwcm9wLnBhaXI+CjxrZXk+U3RvcHMg"
        + "QWxwaGE8L2tleT4KPGFycmF5Pgo8YXJyYXkudHlwZT48ZmxvYXQvPjwvYXJyYXkudHlwZT4KPGZsb2F0PjE8L2Zsb2F0Pgo8Zmxv"
        + "YXQ+MC41PC9mbG9hdD4KPGZsb2F0PjE8L2Zsb2F0Pgo8L2FycmF5Pgo8L3Byb3AucGFpcj4KPC9wcm9wLmxpc3Q+CjwvcHJvcC5w"
        + "YWlyPgo8L3Byb3AubGlzdD4KPC9wcm9wLnBhaXI+Cjxwcm9wLnBhaXI+CjxrZXk+U3RvcHMgU2l6ZTwva2V5Pgo8aW50IHR5cGU9"
        + "J3Vuc2lnbmVkJyBzaXplPSczMic+MjwvaW50Pgo8L3Byb3AucGFpcj4KPC9wcm9wLmxpc3Q+CjwvcHJvcC5wYWlyPgo8cHJvcC5w"
        + "YWlyPgo8a2V5PkNvbG9yIFN0b3BzPC9rZXk+Cjxwcm9wLmxpc3Q+Cjxwcm9wLnBhaXI+CjxrZXk+U3RvcHMgTGlzdDwva2V5Pgo8"
        + "cHJvcC5saXN0Pgo8cHJvcC5wYWlyPgo8a2V5PlN0b3AtMDwva2V5Pgo8cHJvcC5saXN0Pgo8cHJvcC5wYWlyPgo8a2V5PlN0b3Bz"
        + "IENvbG9yPC9rZXk+CjxhcnJheT4KPGFycmF5LnR5cGU+PGZsb2F0Lz48L2FycmF5LnR5cGU+CjxmbG9hdD4wPC9mbG9hdD4KPGZs"
        + "b2F0PjAuNTwvZmxvYXQ+CjxmbG9hdD4xPC9mbG9hdD4KPGZsb2F0PjA8L2Zsb2F0Pgo8ZmxvYXQ+MDwvZmxvYXQ+CjxmbG9hdD4x"
        + "PC9mbG9hdD4KPC9hcnJheT4KPC9wcm9wLnBhaXI+CjwvcHJvcC5saXN0Pgo8L3Byb3AucGFpcj4KPHByb3AucGFpcj4KPGtleT5T"
        + "dG9wLTE8L2tleT4KPHByb3AubGlzdD4KPHByb3AucGFpcj4KPGtleT5TdG9wcyBDb2xvcjwva2V5Pgo8YXJyYXk+CjxhcnJheS50"
        + "eXBlPjxmbG9hdC8+PC9hcnJheS50eXBlPgo8ZmxvYXQ+MTwvZmxvYXQ+CjxmbG9hdD4wLjU8L2Zsb2F0Pgo8ZmxvYXQ+MDwvZmxv"
        + "YXQ+CjxmbG9hdD4wLjM3ODg2MDIxPC9mbG9hdD4KPGZsb2F0PjE8L2Zsb2F0Pgo8ZmxvYXQ+MTwvZmxvYXQ+CjwvYXJyYXk+Cjwv"
        + "cHJvcC5wYWlyPgo8L3Byb3AubGlzdD4KPC9wcm9wLnBhaXI+CjwvcHJvcC5saXN0Pgo8L3Byb3AucGFpcj4KPHByb3AucGFpcj4K"
        + "PGtleT5TdG9wcyBTaXplPC9rZXk+CjxpbnQgdHlwZT0ndW5zaWduZWQnIHNpemU9JzMyJz4yPC9pbnQ+CjwvcHJvcC5wYWlyPgo8"
        + "L3Byb3AubGlzdD4KPC9wcm9wLnBhaXI+CjwvcHJvcC5saXN0Pgo8L3Byb3AucGFpcj4KPHByb3AucGFpcj4KPGtleT5HcmFkaWVu"
        + "dCBDb2xvcnM8L2tleT4KPHN0cmluZz4xLjA8L3N0cmluZz4KPC9wcm9wLnBhaXI+CjwvcHJvcC5saXN0Pgo8L3Byb3AubWFwPgoA"
        + "PD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQiPz4KPHg6eG1wbWV0YSB4bWxuczp4PSJh"
        + "ZG9iZTpuczptZXRhLyIgeDp4bXB0az0iQWRvYmUgWE1QIENvcmUgOS4xLWMwMDMgNzkuOTY5MGE4NywgMjAyNS8wMy8wNi0xOTox"
        + "MjowMyAgICAgICAgIj4KICAgPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50"
        + "YXgtbnMjIj4KICAgICAgPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIKICAgICAgICAgICAgeG1sbnM6ZGM9Imh0dHA6Ly9w"
        + "dXJsLm9yZy9kYy9lbGVtZW50cy8xLjEvIgogICAgICAgICAgICB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEu"
        + "MC8iCiAgICAgICAgICAgIHhtbG5zOnhtcE1NPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvbW0vIgogICAgICAgICAgICB4"
        + "bWxuczpzdEV2dD0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL3NUeXBlL1Jlc291cmNlRXZlbnQjIj4KICAgICAgICAgPGRj"
        + "OmZvcm1hdD5hcHBsaWNhdGlvbi92bmQuYWRvYmUuYWZ0ZXJlZmZlY3RzLnByZXNldC1hbmltYXRpb248L2RjOmZvcm1hdD4KICAg"
        + "ICAgICAgPHhtcDpDcmVhdG9yVG9vbD5BZG9iZSBBZnRlciBFZmZlY3RzIDIwMjUgKE1hY2ludG9zaCk8L3htcDpDcmVhdG9yVG9v"
        + "bD4KICAgICAgICAgPHhtcDpDcmVhdGVEYXRlPjIwMjYtMDctMDlUMTQ6NTA6MjItMDM6MDA8L3htcDpDcmVhdGVEYXRlPgogICAg"
        + "ICAgICA8eG1wOk1ldGFkYXRhRGF0ZT4yMDI2LTA3LTA5VDE0OjUwOjIyLTAzOjAwPC94bXA6TWV0YWRhdGFEYXRlPgogICAgICAg"
        + "ICA8eG1wOk1vZGlmeURhdGU+MjAyNi0wNy0wOVQxNDo1MDoyMi0wMzowMDwveG1wOk1vZGlmeURhdGU+CiAgICAgICAgIDx4bXBN"
        + "TTpJbnN0YW5jZUlEPnhtcC5paWQ6MmQxNDFmYmQtZDc5NS00MGRiLWE0MGYtYmZlYzEwOTJkYzU0PC94bXBNTTpJbnN0YW5jZUlE"
        + "PgogICAgICAgICA8eG1wTU06RG9jdW1lbnRJRD54bXAuZGlkOjJkMTQxZmJkLWQ3OTUtNDBkYi1hNDBmLWJmZWMxMDkyZGM1NDwv"
        + "eG1wTU06RG9jdW1lbnRJRD4KICAgICAgICAgPHhtcE1NOk9yaWdpbmFsRG9jdW1lbnRJRD54bXAuZGlkOjJkMTQxZmJkLWQ3OTUt"
        + "NDBkYi1hNDBmLWJmZWMxMDkyZGM1NDwveG1wTU06T3JpZ2luYWxEb2N1bWVudElEPgogICAgICAgICA8eG1wTU06SGlzdG9yeT4K"
        + "ICAgICAgICAgICAgPHJkZjpTZXE+CiAgICAgICAgICAgICAgIDxyZGY6bGkgcmRmOnBhcnNlVHlwZT0iUmVzb3VyY2UiPgogICAg"
        + "ICAgICAgICAgICAgICA8c3RFdnQ6YWN0aW9uPmNyZWF0ZWQ8L3N0RXZ0OmFjdGlvbj4KICAgICAgICAgICAgICAgICAgPHN0RXZ0"
        + "Omluc3RhbmNlSUQ+eG1wLmlpZDoyZDE0MWZiZC1kNzk1LTQwZGItYTQwZi1iZmVjMTA5MmRjNTQ8L3N0RXZ0Omluc3RhbmNlSUQ+"
        + "CiAgICAgICAgICAgICAgICAgIDxzdEV2dDp3aGVuPjIwMjYtMDctMDlUMTQ6NTA6MjItMDM6MDA8L3N0RXZ0OndoZW4+CiAgICAg"
        + "ICAgICAgICAgICAgIDxzdEV2dDpzb2Z0d2FyZUFnZW50PkFkb2JlIEFmdGVyIEVmZmVjdHMgMjAyNSAoTWFjaW50b3NoKTwvc3RF"
        + "dnQ6c29mdHdhcmVBZ2VudD4KICAgICAgICAgICAgICAgPC9yZGY6bGk+CiAgICAgICAgICAgIDwvcmRmOlNlcT4KICAgICAgICAg"
        + "PC94bXBNTTpIaXN0b3J5PgogICAgICA8L3JkZjpEZXNjcmlwdGlvbj4KICAgPC9yZGY6UkRGPgo8L3g6eG1wbWV0YT4KICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAK"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAg"
        + "ICAgICAgICAgICAgICAgIAo8P3hwYWNrZXQgZW5kPSJ3Ij8+";

    var ffxTemplateFill;       // cached decoded fill template (binary string)
    var ffxTemplateStroke;     // cached decoded stroke template (binary string)
    var gradApplyMsg = "";     // status message set by the apply path

    function ffxDecodeB64(b64) {
        var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        var out = "", i = 0, e1, e2, e3, e4, ch3, ch4;
        b64 = b64.replace(/[^A-Za-z0-9\+\/\=]/g, "");
        while (i < b64.length) {
            ch3 = b64.charAt(i + 2);
            ch4 = b64.charAt(i + 3);
            e1 = chars.indexOf(b64.charAt(i)); i++;
            e2 = chars.indexOf(b64.charAt(i)); i++;
            e3 = (ch3 === "=") ? 64 : chars.indexOf(b64.charAt(i)); i++;
            e4 = (ch4 === "=") ? 64 : chars.indexOf(b64.charAt(i)); i++;
            out += String.fromCharCode((e1 << 2) | (e2 >> 4));
            if (e3 !== 64) { out += String.fromCharCode(((e2 & 15) << 4) | (e3 >> 2)); }
            if (e4 !== 64) { out += String.fromCharCode(((e3 & 3) << 6) | e4); }
        }
        return out;
    }

    function ffxReadU32(s, o) {
        return s.charCodeAt(o) * 16777216 + s.charCodeAt(o + 1) * 65536 +
               s.charCodeAt(o + 2) * 256 + s.charCodeAt(o + 3);
    }

    function ffxU32Str(n) {
        var b0 = Math.floor(n / 16777216) % 256;
        var b1 = Math.floor(n / 65536) % 256;
        var b2 = Math.floor(n / 256) % 256;
        var b3 = n % 256;
        return String.fromCharCode(b0) + String.fromCharCode(b1) +
               String.fromCharCode(b2) + String.fromCharCode(b3);
    }

    function ffxFmtFloat(x) {
        var s = x.toFixed(8);
        s = s.replace(/0+$/, "").replace(/\.$/, "");
        if (s === "" || s === "-0") { s = "0"; }
        return s;
    }

    function ffxFloatTag(v) { return "<float>" + ffxFmtFloat(v) + "</float>\n"; }

    // Build the <prop.map> XML for the given stops. Colour stop array =
    // [offset, midpoint, R, G, B, 1.0]; alpha stop = [offset, midpoint, opacity].
    function ffxBuildXml(stops, alphaStops) {
        var i, cstr = "", astr = "";
        for (i = 0; i < alphaStops.length; i++) {
            var a = alphaStops[i];
            var am = (a.mid === undefined ? 0.5 : a.mid);
            astr += "<prop.pair>\n<key>Stop-" + i + "</key>\n<prop.list>\n<prop.pair>\n<key>Stops Alpha</key>\n"
                + "<array>\n<array.type><float/></array.type>\n"
                + ffxFloatTag(a.pos) + ffxFloatTag(am) + ffxFloatTag(a.a)
                + "</array>\n</prop.pair>\n</prop.list>\n</prop.pair>\n";
        }
        for (i = 0; i < stops.length; i++) {
            var s = stops[i];
            var sm = (s.mid === undefined ? 0.5 : s.mid);
            cstr += "<prop.pair>\n<key>Stop-" + i + "</key>\n<prop.list>\n<prop.pair>\n<key>Stops Color</key>\n"
                + "<array>\n<array.type><float/></array.type>\n"
                + ffxFloatTag(s.pos) + ffxFloatTag(sm) + ffxFloatTag(s.r) + ffxFloatTag(s.g) + ffxFloatTag(s.b) + ffxFloatTag(1)
                + "</array>\n</prop.pair>\n</prop.list>\n</prop.pair>\n";
        }
        return "<?xml version='1.0'?>\n<prop.map version='4'>\n<prop.list>\n<prop.pair>\n"
            + "<key>Gradient Color Data</key>\n<prop.list>\n<prop.pair>\n<key>Alpha Stops</key>\n<prop.list>\n"
            + "<prop.pair>\n<key>Stops List</key>\n<prop.list>\n" + astr + "</prop.list>\n</prop.pair>\n"
            + "<prop.pair>\n<key>Stops Size</key>\n<int type='unsigned' size='32'>" + alphaStops.length + "</int>\n</prop.pair>\n</prop.list>\n</prop.pair>\n"
            + "<prop.pair>\n<key>Color Stops</key>\n<prop.list>\n"
            + "<prop.pair>\n<key>Stops List</key>\n<prop.list>\n" + cstr + "</prop.list>\n</prop.pair>\n"
            + "<prop.pair>\n<key>Stops Size</key>\n<int type='unsigned' size='32'>" + stops.length + "</int>\n</prop.pair>\n</prop.list>\n</prop.pair>\n"
            + "</prop.list>\n</prop.pair>\n<prop.pair>\n<key>Gradient Colors</key>\n<string>1.0</string>\n</prop.pair>\n</prop.list>\n</prop.map>\n";
    }

    // Find the Utf8 chunk whose body is the <?xml ...> prop.map.
    function ffxFindXmlChunk(s) {
        var i = s.indexOf("Utf8");
        while (i !== -1) {
            if (s.substr(i + 8, 5) === "<?xml") { return i; }
            i = s.indexOf("Utf8", i + 1);
        }
        return -1;
    }

    // Collect the size-field offsets of every chunk whose data range contains
    // the XML chunk (its RIFX ancestors) — these grow/shrink with the XML.
    function ffxAncestorSizeFields(s, target, uoff) {
        var res = [];
        function walk(off, end) {
            while (off + 8 <= end) {
                var ct = s.substr(off, 4);
                var sz = ffxReadU32(s, off + 4);
                var body = off + 8;
                if (body <= target && target < body + sz && off !== uoff) {
                    res.push(off + 4);
                }
                if (ct === "RIFX" || ct === "LIST") { walk(body + 4, body + sz); }
                off = body + sz + (sz & 1);
            }
        }
        walk(0, 8 + ffxReadU32(s, 4));
        return res;
    }

    // Build a complete .ffx binary string carrying the swatch's stop colours.
    function ffxGenerate(stops, alphaStops, isFill) {
        var tmpl;
        if (isFill) {
            if (ffxTemplateFill === undefined) {
                ffxTemplateFill = GRAD_FFX_B64 ? ffxDecodeB64(GRAD_FFX_B64) : "";
            }
            tmpl = ffxTemplateFill;
        } else {
            if (ffxTemplateStroke === undefined) {
                ffxTemplateStroke = GRAD_FFX_STROKE_B64 ? ffxDecodeB64(GRAD_FFX_STROKE_B64) : "";
            }
            tmpl = ffxTemplateStroke;
        }
        if (!tmpl) { return null; }
        var uoff = ffxFindXmlChunk(tmpl);
        if (uoff === -1) { return null; }
        var usize = ffxReadU32(tmpl, uoff + 4);
        var ubody = uoff + 8;
        var anc = ffxAncestorSizeFields(tmpl, ubody, uoff);
        var alphas = (alphaStops && alphaStops.length)
            ? alphaStops : [{ pos: 0, mid: 0.5, a: 1 }, { pos: 1, mid: 0.5, a: 1 }];
        var newXml = ffxBuildXml(stops, alphas);
        var oldPad = usize & 1, newSize = newXml.length, newPad = newSize & 1;
        var ancDelta = (newSize + newPad) - (usize + oldPad);
        var s = tmpl.substr(0, uoff + 4) + ffxU32Str(newSize) + tmpl.substr(uoff + 8);
        var k;
        for (k = 0; k < anc.length; k++) {
            var cur = ffxReadU32(s, anc[k]);
            s = s.substr(0, anc[k]) + ffxU32Str(cur + ancDelta) + s.substr(anc[k] + 4);
        }
        var pad = newPad ? String.fromCharCode(0) : "";
        s = s.substr(0, ubody) + newXml + pad + s.substr(ubody + usize + oldPad);
        return s;
    }

    // Write a binary string to a temp .ffx file. Returns the File or null.
    function ffxWriteTemp(binStr) {
        try {
            var f = new File(Folder.temp.fsName + "/c2l_grad_" + (new Date()).getTime() + ".ffx");
            f.encoding = "BINARY";
            if (!f.open("w")) { return null; }
            var ok = f.write(binStr);
            f.close();
            return ok ? f : null;
        } catch (e) {
            return null;
        }
    }

    // Apply the swatch's stop colours to a gradient's Colors property by
    // building a temp .ffx and applyPreset-ing it. isFill picks the fill vs
    // stroke template (their parent chains differ). Returns true on success.
    function ffxApplyColors(layer, colorsProp, sw, isFill) {
        if (GRAD_DEBUG) {
            var ap = [];
            for (var d = 0; d < sw.stops.length; d++) { ap.push(sw.stops[d].pos); }
            gradDebugLog.push("APPLY " + (isFill ? "fill" : "stroke") + ": swatch offsets = [" + ap.join(", ") + "]");
        }
        var bin = ffxGenerate(sw.stops, sw.alphaStops, isFill);
        if (!bin) {
            gradApplyMsg = "Couldn't build gradient preset.";
            return false;
        }
        var file = ffxWriteTemp(bin);
        if (!file) {
            gradApplyMsg = "Enable Preferences > Scripting & Expressions > Allow Scripts to Write Files, then retry.";
            return false;
        }
        var applied = false;
        try {
            var comp = layer.containingComp;
            var prev = comp ? comp.selectedProperties : null;
            var i;
            if (prev) {
                for (i = 0; i < prev.length; i++) {
                    try { prev[i].selected = false; } catch (eD) {}
                }
            }
            try { colorsProp.selected = true; } catch (eSel) {}
            layer.applyPreset(file);
            applied = true;
        } catch (eApply) {
            gradApplyMsg = "applyPreset failed: " + eApply.toString();
            applied = false;
        }
        try { file.remove(); } catch (eRm) {}
        return applied;
    }

    // Read a gradient swatch payload {gradType, stops, alphaStops, geom} from a
    // gradient fill/stroke. The gradient TYPE and geometry (start/end points =
    // direction, highlight) are scriptable, but the stop COLORS are a NO_VALUE
    // property — those are read from the saved project file via
    // readGradientStopsFromAep, located by the container's name path.
    function readGradientFromContainer(container, kind, nav) {
        if (!container || !container.property) {
            return null;
        }
        var typeProp = null;
        try { typeProp = container.property(GRAD_TYPE_MATCH); } catch (eT) {}
        var parsed = readGradientStopsFromAep(nav);
        if (!parsed) {
            return null;
        }
        var gradType = 1;
        try { if (typeProp) { gradType = Math.round(typeProp.value) || 1; } } catch (eGT) {}
        return {
            type: "gradient",
            kind: kind,
            gradType: gradType,
            stops: parsed.stops,
            alphaStops: parsed.alphaStops,
            geom: readGradientGeometry(container)
        };
    }

    // Read a gradient's DIRECTION + highlight (the scriptable geometry we want a
    // swatch to reproduce): start point [x,y], end point [x,y], highlight length
    // and angle. Returns null if start/end are unavailable, so applying a swatch
    // without geometry (e.g. an older saved one) leaves the shape's own
    // direction untouched. Stroke width is NOT captured — it belongs to the
    // stroke, not the color, and is preserved separately on apply.
    function readGradientGeometry(container) {
        var g = {};
        var got = false;
        var pairs = [
            ["start", GRAD_START_MATCH],
            ["end", GRAD_END_MATCH],
            ["hlen", GRAD_HLEN_MATCH],
            ["hang", GRAD_HANG_MATCH]
        ];
        for (var i = 0; i < pairs.length; i++) {
            var p = null;
            try { p = container.property(pairs[i][1]); } catch (eP) { p = null; }
            if (!p) { continue; }
            try {
                if (p.numKeys > 0) { continue; }
                g[pairs[i][0]] = p.value;
                if (pairs[i][0] === "start" || pairs[i][0] === "end") { got = true; }
            } catch (eV) {}
        }
        return got ? g : null;
    }

    // Walk the shape tree collecting gradient fill/stroke containers, tracking
    // the name path (comp → layer → group names) each one lives under so its
    // colours can be located in the saved .aep. Only "ADBE Vector Group" named
    // shape groups contribute a name segment (matching AE's serialisation).
    function collectGradientContainers(group, out, nav) {
        for (var i = 1; i <= group.numProperties; i++) {
            var prop = group.property(i);
            if (!prop) {
                continue;
            }
            if (prop.matchName === GRAD_FILL_MATCH) {
                out.push({ container: prop, kind: "fill", nav: nav });
            } else if (prop.matchName === GRAD_STROKE_MATCH) {
                out.push({ container: prop, kind: "stroke", nav: nav });
            } else if (prop.matchName === "ADBE Vector Group") {
                var gName = "";
                try { gName = prop.name; } catch (eGn) {}
                var childNav = gName ? nav.concat([gName]) : nav;
                collectGradientContainers(prop, out, childNav);
            } else if (prop.propertyType === PropertyType.INDEXED_GROUP ||
                       prop.propertyType === PropertyType.NAMED_GROUP) {
                collectGradientContainers(prop, out, nav);
            }
        }
    }

    function getGradientContainersForLayer(layer, comp) {
        var out = [];
        if (!layer || !layer.property) {
            return out;
        }
        var root = layer.property("ADBE Root Vectors Group");
        if (!root) {
            return out;
        }
        var compName = "";
        var layerName = "";
        try { compName = comp ? comp.name : ""; } catch (eCn) {}
        try { layerName = layer.name; } catch (eLn) {}
        collectGradientContainers(root, out, [compName, layerName]);
        return out;
    }

    // Sample a gradient's color-stop list at t in [0,1] for on-screen preview.
    // Linear interpolation between the two surrounding stops (midpoint diamond
    // ignored — close enough for a 38px chip).
    function gradientColorAt(stops, t) {
        if (!stops || !stops.length) {
            return [0.5, 0.5, 0.5];
        }
        if (t <= stops[0].pos) {
            return [stops[0].r, stops[0].g, stops[0].b];
        }
        var last = stops[stops.length - 1];
        if (t >= last.pos) {
            return [last.r, last.g, last.b];
        }
        for (var i = 0; i < stops.length - 1; i++) {
            var a = stops[i], b = stops[i + 1];
            if (t >= a.pos && t <= b.pos) {
                var span = b.pos - a.pos;
                var f = span > 0 ? (t - a.pos) / span : 0;
                return [
                    a.r + (b.r - a.r) * f,
                    a.g + (b.g - a.g) * f,
                    a.b + (b.b - a.b) * f
                ];
            }
        }
        return [last.r, last.g, last.b];
    }

    // Signature used to dedupe gradient swatches on extract.
    function gradientSignature(sw) {
        var parts = [sw.gradType];
        var i;
        for (i = 0; i < sw.stops.length; i++) {
            var s = sw.stops[i];
            parts.push(Math.round(s.pos * 1000), Math.round(s.r * 255),
                Math.round(s.g * 255), Math.round(s.b * 255));
        }
        for (i = 0; i < sw.alphaStops.length; i++) {
            var a = sw.alphaStops[i];
            parts.push("a", Math.round(a.pos * 1000), Math.round(a.a * 255));
        }
        return parts.join(",");
    }


    function addSwatch(color, label) {
        if (!color) {
            return;
        }
        for (var i = 0; i < swatches.length; i++) {
            if (!isGradient(swatches[i]) && colorMatches(swatches[i].color, color)) {
                selectedIndex = i;
                rebuildSwatches();
                updateStatus();
                return;
            }
        }
        swatches.push({ type: "solid", name: label || "Swatch", color: color });
        selectedIndex = swatches.length - 1;
        saveCurrentPalette();
        rebuildSwatches();
        updateStatus();
    }

    function removeSwatch(index) {
        if (index < 0 || !swatches[index]) {
            return;
        }
        swatches.splice(index, 1);
        if (selectedIndex >= swatches.length) {
            selectedIndex = swatches.length - 1;
        }
        saveCurrentPalette();
        rebuildSwatches();
        updateStatus();
    }

    function collectColorProperties(group, out) {
        for (var i = 1; i <= group.numProperties; i++) {
            var prop = group.property(i);
            if (!prop) {
                continue;
            }
            if (prop.matchName === "ADBE Vector Graphic - Fill") {
                out.push({ property: prop.property("ADBE Vector Fill Color"), kind: "fill" });
            } else if (prop.matchName === "ADBE Vector Graphic - Stroke") {
                out.push({ property: prop.property("ADBE Vector Stroke Color"), kind: "stroke" });
            } else if (prop.propertyType === PropertyType.INDEXED_GROUP ||
                       prop.propertyType === PropertyType.NAMED_GROUP) {
                collectColorProperties(prop, out);
            }
        }
    }

    function getColorPropertiesForLayer(layer) {
        var out = [];
        if (!layer || !layer.property) {
            return out;
        }
        var root = layer.property("ADBE Root Vectors Group");
        if (!root) {
            return out;
        }
        collectColorProperties(root, out);
        return out;
    }

    function getSelectedColorProps(layer) {
        var selected = layer.selectedProperties || [];
        var selectedColorProps = [];
        for (var i = 0; i < selected.length; i++) {
            var prop = selected[i];
            if (!prop) {
                continue;
            }
            if (prop.matchName === "ADBE Vector Fill Color" ||
                prop.matchName === "ADBE Vector Stroke Color") {
                selectedColorProps.push({ property: prop, kind: prop.matchName === "ADBE Vector Fill Color" ? "fill" : "stroke" });
            }
        }
        return selectedColorProps;
    }

    function setSolidColorProp(layer, prop, color) {
        if (!prop || !prop.canSetExpression) {
            return;
        }
        var value = arrayToColor(color);
        if (prop.numKeys > 0) {
            var comp = layer.containingComp;
            var time = comp ? comp.time : 0;
            prop.setValueAtTime(time, value);
        } else {
            prop.setValue(value);
        }
    }

    // Apply a solid swatch to a layer. Honors an explicit Fill/Stroke color
    // selection; otherwise, for each wanted kind (per targetMode), makes the
    // shape end up with a solid of `color`: it sets existing solids, removes any
    // gradient of that kind, and creates a solid if the shape has none.
    function applyColorToLayer(layer, color) {
        if (!layer || !layer.property || !color) {
            return false;
        }
        var root = layer.property("ADBE Root Vectors Group");
        if (!root) {
            return false;
        }
        var applied = false;
        app.beginUndoGroup("Apply vector swatch");
        try {
            var selected = getSelectedColorProps(layer);
            if (selected.length) {
                for (var s = 0; s < selected.length; s++) {
                    setSolidColorProp(layer, selected[s].property, color);
                    applied = true;
                }
            } else {
                var wantFill = (targetMode === "fill" || targetMode === "both");
                var wantStroke = (targetMode === "stroke" || targetMode === "both");
                if (wantFill && applySolidForKind(layer, root, color, true)) { applied = true; }
                if (wantStroke && applySolidForKind(layer, root, color, false)) { applied = true; }
            }
        } finally {
            app.endUndoGroup();
        }
        return applied;
    }

    // Ensure the shape carries a solid Fill / Stroke of `color` for one kind:
    //   1. Set the color on every existing solid of that kind.
    //   2. Remove every gradient of that kind (a solid swatch must beat the
    //      gradient it's covering).
    //   3. If the shape had neither a solid nor a gradient of that kind, create
    //      a fresh solid so applying a color to a bare shape still shows up.
    function applySolidForKind(layer, root, color, isFill) {
        var did = false;
        var all = getColorPropertiesForLayer(layer);
        var i;
        for (i = 0; i < all.length; i++) {
            if (all[i] && all[i].kind === (isFill ? "fill" : "stroke") && all[i].property) {
                setSolidColorProp(layer, all[i].property, color);
                did = true;
            }
        }
        var grads = getGradientContainersForLayer(layer, layer.containingComp);
        var hadGrad = false;
        var gradLook = null;
        for (i = 0; i < grads.length; i++) {
            if (grads[i].kind !== (isFill ? "fill" : "stroke")) {
                continue;
            }
            hadGrad = true;
            // Carry the gradient's width/opacity/other params onto the solid
            // that replaces it, so converting a gradient to a solid changes only
            // the color (a solid shares Stroke Width / opacity matchNames).
            if (gradLook === null) { gradLook = readGradientAppearance(grads[i].container); }
            var parent = null;
            try { parent = grads[i].container.parentProperty; } catch (eP) {}
            try { grads[i].container.remove(); } catch (eR) {}
            if (!did) {
                if (createSolidGraphic(layer, parent, color, isFill, gradLook)) { did = true; }
            }
        }
        if (!did && !hadGrad) {
            if (createSolidGraphic(layer, findShapeContents(root) || root, color, isFill, null)) { did = true; }
        }
        return did;
    }

    // Add a solid Fill / Stroke of `color` into `group` and return true on
    // success. Used when a shape has no solid of the wanted kind (bare shape or
    // one that only had a gradient we just removed). When `look` is provided
    // (from the replaced gradient), its shared params (stroke width, opacity…)
    // are copied over so the conversion changes only the color.
    function createSolidGraphic(layer, group, color, isFill, look) {
        try {
            if (!group || !group.canAddProperty) {
                return false;
            }
            var solidMatch = isFill ? "ADBE Vector Graphic - Fill" : "ADBE Vector Graphic - Stroke";
            var colorMatch = isFill ? "ADBE Vector Fill Color" : "ADBE Vector Stroke Color";
            if (!group.canAddProperty(solidMatch)) {
                return false;
            }
            var solid = group.addProperty(solidMatch);
            var cprop = null;
            try { cprop = solid.property(colorMatch); } catch (eCp) {}
            if (cprop) { setSolidColorProp(layer, cprop, color); }
            if (look) { writeGradientAppearance(solid, look); }
            return true;
        } catch (e) {
            return false;
        }
    }

    // Remove Fill / Stroke paint (solid AND gradient graphics) of the wanted
    // kinds from a group, recursing into nested groups. Walks descending by live
    // index because removing a property invalidates sibling references.
    function removePaintFromGroup(group, removeFill, removeStroke) {
        var removed = 0;
        try {
            for (var j = group.numProperties; j >= 1; j--) {
                var p = null;
                try { p = group.property(j); } catch (eP) { continue; }
                if (!p) { continue; }
                var mn = p.matchName;
                var isFillPaint = (mn === "ADBE Vector Graphic - Fill" || mn === "ADBE Vector Graphic - G-Fill");
                var isStrokePaint = (mn === "ADBE Vector Graphic - Stroke" || mn === "ADBE Vector Graphic - G-Stroke");
                if ((removeFill && isFillPaint) || (removeStroke && isStrokePaint)) {
                    try { p.remove(); removed++; } catch (eR) {}
                } else if (p.propertyType === PropertyType.INDEXED_GROUP ||
                           p.propertyType === PropertyType.NAMED_GROUP) {
                    removed += removePaintFromGroup(p, removeFill, removeStroke);
                }
            }
        } catch (e) {}
        return removed;
    }

    // Strip Fill / Stroke / Both paint from the selected vector layers, honoring
    // the Fill/Stroke/Both target mode. Removes both solid and gradient graphics.
    function removePaintFromSelection() {
        var comp = getActiveComp();
        if (!comp) {
            return;
        }
        var layers = comp.selectedLayers;
        if (!layers || !layers.length) {
            if (statusText) { statusText.text = "Select one or more vector layers first."; }
            return;
        }
        var removeFill = (targetMode === "fill" || targetMode === "both");
        var removeStroke = (targetMode === "stroke" || targetMode === "both");
        var totalRemoved = 0, touched = 0;
        app.beginUndoGroup("Remove vector paint");
        try {
            for (var i = 0; i < layers.length; i++) {
                var layer = layers[i];
                if (layer.matchName !== "ADBE Vector Layer") { continue; }
                var root = null;
                try { root = layer.property("ADBE Root Vectors Group"); } catch (eRt) {}
                if (!root) { continue; }
                var n = removePaintFromGroup(root, removeFill, removeStroke);
                totalRemoved += n;
                if (n > 0) { touched++; }
            }
        } finally {
            app.endUndoGroup();
        }
        if (statusText) {
            var kindLabel = (removeFill && removeStroke) ? "fill + stroke" : (removeFill ? "fill" : "stroke");
            if (totalRemoved > 0) {
                statusText.text = "Removed " + kindLabel + " from " + touched + " layer" + (touched === 1 ? "" : "s") + ".";
            } else {
                statusText.text = "No " + kindLabel + " paint to remove on the selected layer(s).";
            }
        }
    }

    function applySwatch(index) {
        if (index < 0 || !swatches[index]) {
            return;
        }
        var item = app.project ? app.project.activeItem : null;
        if (!item || !(item instanceof CompItem)) {
            return;
        }
        var layers = item.selectedLayers;
        if (!layers || !layers.length) {
            return;
        }
        var gradColorsFailed = false;
        var appliedGrad = false;
        var appliedSolid = false;
        var solidCount = 0;
        gradApplyMsg = "";
        gradDebugLog = [];
        for (var i = 0; i < layers.length; i++) {
            var layer = layers[i];
            if (layer.matchName === "ADBE Vector Layer") {
                if (isGradient(swatches[index])) {
                    var res = applyGradientToLayer(layer, swatches[index]);
                    appliedGrad = true;
                    if (res && !res.wroteColors) {
                        gradColorsFailed = true;
                    }
                } else {
                    if (applyColorToLayer(layer, swatches[index].color)) {
                        appliedSolid = true;
                        solidCount++;
                    }
                }
            }
        }
        if (statusText) {
            if (appliedGrad) {
                if (gradColorsFailed) {
                    statusText.text = gradApplyMsg || "Couldn't apply gradient colors.";
                } else {
                    statusText.text = "Gradient applied.";
                }
            } else if (appliedSolid) {
                statusText.text = "Color applied to " + solidCount + " layer" + (solidCount === 1 ? "" : "s") + ".";
            } else {
                statusText.text = "Nothing to color on the selected layer(s).";
            }
        }
        if (GRAD_DEBUG && appliedGrad && gradDebugLog.length) {
            alert("Gradient apply diagnostics:\n\n" + gradDebugLog.join("\n"), SCRIPT_NAME);
        }
        // Removing a gradient graphic that happened to be the layer's only
        // selected property (the .ffx apply selects the Colors property) drops
        // the layer's selection. Re-assert the layers we started with so the
        // user's selection survives applying a swatch.
        try {
            for (var rs = 0; rs < layers.length; rs++) {
                try { if (!layers[rs].selected) { layers[rs].selected = true; } } catch (eRs) {}
            }
        } catch (eSel) {}
    }

    // Apply a gradient swatch to a layer. Sets the Grad Type (scriptable) and
    // writes the stop Colors via .ffx preset injection on every gradient
    // fill/stroke matching the target mode; if the layer has no gradient of the
    // requested kind, adds a fresh Gradient Fill / Stroke INSIDE the shape's
    // group (replacing the solid fill/stroke there) so the swatch always lands
    // in the right place. Returns { wroteColors: bool }.
    function applyGradientToLayer(layer, sw) {
        if (!layer || !layer.property) {
            return { wroteColors: false };
        }
        var root = layer.property("ADBE Root Vectors Group");
        if (!root) {
            return { wroteColors: false };
        }
        var wantFill = (targetMode === "fill" || targetMode === "both");
        var wantStroke = (targetMode === "stroke" || targetMode === "both");
        var wroteColors = false;

        app.beginUndoGroup("Apply gradient swatch");
        try {
            if (wantFill && applyGradientForKind(layer, root, sw, true)) { wroteColors = true; }
            if (wantStroke && applyGradientForKind(layer, root, sw, false)) { wroteColors = true; }
        } finally {
            app.endUndoGroup();
        }
        return { wroteColors: wroteColors };
    }

    // Apply the gradient for one kind (fill/stroke). If the layer already has a
    // gradient of this kind, UPDATE IT IN PLACE; otherwise add a fresh one inside
    // the shape (replacing the solid there). After writing the swatch's stop
    // colors via applyPreset we set: the swatch's grad TYPE, the swatch's saved
    // DIRECTION (start/end points + highlight) when it has one, and finally we
    // RESTORE the shape's original STROKE WIDTH — captured before any change — so
    // converting a solid stroke to a gradient (or reapplying) never resets the
    // width to the template's 2px default. Extra gradients (leftover pileup) are
    // deduped to keep exactly one so the preset lands cleanly.
    function applyGradientForKind(layer, root, sw, isFill) {
        if (!ffxHaveTemplate(isFill)) {
            gradApplyMsg = "Couldn't build gradient preset.";
            return false;
        }
        var kind = isFill ? "fill" : "stroke";
        var matchName = isFill ? GRAD_FILL_MATCH : GRAD_STROKE_MATCH;

        // Capture the CURRENT stroke width (from an existing gradient OR solid
        // stroke) before any change, so it survives a solid→gradient conversion
        // or the template's defaults. Stroke width belongs to the stroke, not the
        // color, so it is always preserved from the shape.
        var preserveWidth = isFill ? null : readCurrentStrokeWidth(root);

        var have = countGradientsOfKind(layer, kind);
        var look = null;
        var curDir = null;

        if (have > 0) {
            // UPDATE IN PLACE. Capture the first existing gradient's appearance
            // (fill opacity, and its direction as a fallback) and its CURRENT
            // direction (for the toggle below), then dedupe any extras (leftover
            // pileup) so exactly one remains — re-querying between removes because
            // removing a property invalidates references.
            var first = findFirstGradientOfKind(layer, kind);
            if (first) {
                look = readGradientAppearance(first);
                curDir = readGradientGeometry(first);
            }
            while (countGradientsOfKind(layer, kind) > 1) {
                if (!removeLastGradientOfKind(layer, kind)) { break; }
            }
        } else {
            // CREATE FRESH inside the shape's contents (replacing the solid there
            // the user was covering).
            var group = findShapeContents(root) || root;
            try {
                removeSolidGraphic(group, isFill);
                if (!group.canAddProperty || !group.canAddProperty(matchName)) {
                    return false;
                }
                group.addProperty(matchName);
            } catch (eAdd) {
                return false;
            }
        }

        // TOGGLE the direction: apply the swatch's saved direction, but if the
        // gradient ALREADY has that direction (i.e. this is a second click),
        // reset it to horizontal instead — start at the shape's leftmost point,
        // end at its rightmost point. The actual horizontal geometry is computed
        // after the container is rebuilt (it needs the container to convert the
        // layer-space bounds into the gradient's group coordinate space).
        var resetHorizontal = (sw.geom && curDir && sameDirection(curDir, sw.geom));

        // Write the swatch's stop colors (+ type) onto the single surviving
        // gradient. applyPreset matches the full parent path and writes in place;
        // re-find the container since refs may be stale after edits.
        var target = findFirstGradientOfKind(layer, kind);
        if (!target) { return false; }
        var r = applyGradientPaint(target, sw, layer, isFill);

        var rebuilt = findFirstGradientOfKind(layer, kind);
        if (rebuilt) {
            var tp = null;
            try { tp = rebuilt.property(GRAD_TYPE_MATCH); } catch (eTp2) {}
            try { if (tp && tp.canSetExpression) { tp.setValue(sw.gradType); } } catch (eTs) {}
            // Restore the original appearance first (fill opacity, original
            // direction as fallback), then override the DIRECTION with the
            // toggle result (swatch direction, or horizontal on the second click).
            if (look) { writeGradientAppearance(rebuilt, look); }
            var dirToApply = resetHorizontal
                ? horizontalDirection(layer, rebuilt)
                : (sw.geom || null);
            if (dirToApply) { writeGradientGeometry(rebuilt, dirToApply); }
            // Finally, force the preserved stroke width back on (never reset it).
            if (!isFill && preserveWidth !== null) {
                var wp = null;
                try { wp = rebuilt.property(STROKE_WIDTH_MATCH); } catch (eWp) {}
                try { if (wp && wp.canSetExpression) { wp.setValue(preserveWidth); } } catch (eWs) {}
            }
            if (GRAD_DEBUG) {
                gradDebugLog.push("KIND " + kind + ": had=" + have +
                    ", swatchGeom=" + (sw.geom ? "yes" : "no") +
                    ", toggle=" + (resetHorizontal ? "reset-horizontal" : "swatch-dir") +
                    ", preserveWidth=" + preserveWidth);
            }
        }
        return r.wroteColors;
    }

    // Find the layer's current stroke width by locating the first stroke graphic
    // (gradient G-Stroke or solid Stroke) under root and reading its Stroke Width
    // leaf. Returns null if there is no stroke or it is animated.
    function readCurrentStrokeWidth(root) {
        var found = { w: null };
        walkStrokeWidth(root, found);
        return found.w;
    }

    function walkStrokeWidth(group, found) {
        if (found.w !== null) { return; }
        try {
            for (var i = 1; i <= group.numProperties; i++) {
                var p = null;
                try { p = group.property(i); } catch (eP) { continue; }
                if (!p) { continue; }
                if (p.matchName === GRAD_STROKE_MATCH ||
                    p.matchName === "ADBE Vector Graphic - Stroke") {
                    var wp = null;
                    try { wp = p.property(STROKE_WIDTH_MATCH); } catch (eW) {}
                    try {
                        if (wp && wp.numKeys === 0) { found.w = wp.value; return; }
                    } catch (eV) {}
                } else if (p.propertyType === PropertyType.INDEXED_GROUP ||
                           p.propertyType === PropertyType.NAMED_GROUP) {
                    walkStrokeWidth(p, found);
                    if (found.w !== null) { return; }
                }
            }
        } catch (e) {}
    }

    // Apply a swatch's saved DIRECTION (start/end points + highlight) onto a
    // gradient container, so applying it reproduces the extracted direction.
    function writeGradientGeometry(container, geom) {
        if (!geom) { return; }
        var sets = [
            [GRAD_START_MATCH, geom.start],
            [GRAD_END_MATCH, geom.end],
            [GRAD_HLEN_MATCH, geom.hlen],
            [GRAD_HANG_MATCH, geom.hang]
        ];
        for (var i = 0; i < sets.length; i++) {
            if (sets[i][1] === undefined || sets[i][1] === null) { continue; }
            var p = null;
            try { p = container.property(sets[i][0]); } catch (eP) { p = null; }
            if (!p) { continue; }
            try { if (p.canSetExpression) { p.setValue(sets[i][1]); } } catch (eS) {}
        }
    }

    // True when two gradient directions have the same start and end points
    // (within a small tolerance), used to detect a repeat apply for the toggle.
    function sameDirection(a, b) {
        if (!a || !b || !a.start || !a.end || !b.start || !b.end) { return false; }
        var eps = 0.5;
        return Math.abs(a.start[0] - b.start[0]) < eps &&
               Math.abs(a.start[1] - b.start[1]) < eps &&
               Math.abs(a.end[0] - b.end[0]) < eps &&
               Math.abs(a.end[1] - b.end[1]) < eps;
    }

    // Build a HORIZONTAL gradient direction spanning the shape layer's bounds:
    // start at the leftmost point, end at the rightmost, both at the vertical
    // center. sourceRectAtTime reports LAYER-space bounds, but a gradient's
    // start/end points live in the coordinate space of the shape GROUP that
    // contains it — so we convert the layer-space endpoints down through the
    // inverse of every enclosing group's transform (position / anchor / scale /
    // rotation). Returns null if the bounds can't be read.
    function horizontalDirection(layer, container) {
        try {
            var comp = layer.containingComp;
            var t = comp ? comp.time : 0;
            var rect = layer.sourceRectAtTime(t, false);
            if (!rect) { return null; }
            var cy = rect.top + rect.height / 2;
            var startL = [rect.left, cy];
            var endL = [rect.left + rect.width, cy];
            var chain = groupTransformChain(container);
            var start = layerToGroupSpace(startL, chain);
            var end = layerToGroupSpace(endL, chain);
            return { start: start, end: end, hlen: 0, hang: 0 };
        } catch (e) { return null; }
    }

    // Collect the transforms of every enclosing "ADBE Vector Group" from the
    // gradient container up to the layer root, ordered OUTERMOST → innermost
    // (the order in which their inverses must be applied to map a layer-space
    // point into the container's local space).
    function groupTransformChain(container) {
        var stack = [];
        var p = container;
        try {
            while (p) {
                var par = null;
                try { par = p.parentProperty; } catch (ePP) { par = null; }
                if (!par) { break; }
                if (par.matchName === "ADBE Vector Group") {
                    var tf = readGroupTransform(par);
                    if (tf) { stack.push(tf); }
                }
                p = par;
            }
        } catch (e) {}
        stack.reverse(); // was innermost→outermost; want outermost→innermost
        return stack;
    }

    // Read a shape group's transform into {anchor, position, scale, rotation}.
    // Returns null if the transform group is missing.
    function readGroupTransform(group) {
        var tg = null;
        try { tg = group.property("ADBE Vector Transform Group"); } catch (eTG) {}
        if (!tg) { return null; }
        var tf = { anchor: [0, 0], position: [0, 0], scale: [100, 100], rotation: 0 };
        readLeafInto(tg, "ADBE Vector Anchor", tf, "anchor");
        readLeafInto(tg, "ADBE Vector Position", tf, "position");
        readLeafInto(tg, "ADBE Vector Scale", tf, "scale");
        readLeafInto(tg, "ADBE Vector Rotation", tf, "rotation");
        return tf;
    }

    function readLeafInto(group, matchName, obj, key) {
        var p = null;
        try { p = group.property(matchName); } catch (eP) { return; }
        if (!p) { return; }
        try { if (p.numKeys === 0) { obj[key] = p.value; } } catch (eV) {}
    }

    // Map a layer-space point down through a chain of group transforms (each
    // outermost→innermost) into the innermost group's local (gradient) space by
    // applying each transform's inverse in order. Group transform (local→parent)
    // is: parent = position + Rot(rotation) * (scale/100 .* (local - anchor)).
    function layerToGroupSpace(pt, chain) {
        var x = pt[0], y = pt[1];
        for (var i = 0; i < chain.length; i++) {
            var tf = chain[i];
            var dx = x - tf.position[0];
            var dy = y - tf.position[1];
            var rad = -tf.rotation * Math.PI / 180;
            var c = Math.cos(rad), s = Math.sin(rad);
            var rx = dx * c - dy * s;
            var ry = dx * s + dy * c;
            var sx = (tf.scale[0] || 100) / 100;
            var sy = (tf.scale[1] || 100) / 100;
            x = (sx !== 0 ? rx / sx : rx) + tf.anchor[0];
            y = (sy !== 0 ? ry / sy : ry) + tf.anchor[1];
        }
        return [x, y];
    }
    function countGradientsOfKind(layer, kind) {
        var all = getGradientContainersForLayer(layer);
        var n = 0;
        for (var i = 0; i < all.length; i++) { if (all[i].kind === kind) { n++; } }
        return n;
    }

    // Return the first gradient container of a kind, freshly queried (never a
    // stale reference held across edits).
    function findFirstGradientOfKind(layer, kind) {
        var all = getGradientContainersForLayer(layer);
        for (var i = 0; i < all.length; i++) {
            if (all[i].kind === kind) { return all[i].container; }
        }
        return null;
    }

    // Remove the LAST gradient container of a kind (used to dedupe pileup while
    // keeping the first). Returns true if one was removed.
    function removeLastGradientOfKind(layer, kind) {
        var all = getGradientContainersForLayer(layer);
        var last = null;
        for (var i = 0; i < all.length; i++) {
            if (all[i].kind === kind) { last = all[i].container; }
        }
        if (!last) { return false; }
        try { last.remove(); return true; } catch (e) { return false; }
    }

    // Remove every gradient Fill / Stroke of the given kind under `group`,
    // recursing into nested shape groups. Walks descending by live index since
    // removing a property invalidates sibling references.
    function removeGradientsOfKind(group, isFill) {
        var target = isFill ? GRAD_FILL_MATCH : GRAD_STROKE_MATCH;
        try {
            for (var j = group.numProperties; j >= 1; j--) {
                var p = null;
                try { p = group.property(j); } catch (eP) { continue; }
                if (!p) { continue; }
                if (p.matchName === target) {
                    try { p.remove(); } catch (eR) {}
                } else if (p.propertyType === PropertyType.INDEXED_GROUP ||
                           p.propertyType === PropertyType.NAMED_GROUP) {
                    removeGradientsOfKind(p, isFill);
                }
            }
        } catch (e) {}
    }

    // Set the gradient TYPE (scriptable) and write the stop Colors via .ffx
    // preset injection on a gradient container.
    function applyGradientPaint(container, sw, layer, isFill) {
        var colorsProp = null, typeProp = null;
        try { colorsProp = container.property(GRAD_COLORS_MATCH); } catch (eC) {}
        try { typeProp = container.property(GRAD_TYPE_MATCH); } catch (eT) {}
        if (!colorsProp) {
            return { found: false, wroteColors: false };
        }
        try { if (typeProp && typeProp.canSetExpression) { typeProp.setValue(sw.gradType); } } catch (eTy) {}
        var wroteColors = ffxApplyColors(layer, colorsProp, sw, isFill);
        return { found: true, wroteColors: wroteColors };
    }

    // Read a gradient graphic's settable, non-animated leaf values into a plain
    // {matchName: value} object so they survive the container being rebuilt by
    // applyPreset. Captures GEOMETRY/appearance to preserve (start/end points,
    // stroke width, highlight, opacity…) — but skips the NO_VALUE Grad Colors
    // (written by the preset) and the Grad Type (taken from the swatch), so
    // restoring this look never overrides the applied colors or type.
    function readGradientAppearance(container) {
        var look = {};
        try {
            for (var i = 1; i <= container.numProperties; i++) {
                var sp = null;
                try { sp = container.property(i); } catch (eSp) { continue; }
                if (!sp || sp.matchName === GRAD_COLORS_MATCH || sp.matchName === GRAD_TYPE_MATCH) { continue; }
                if (sp.propertyType !== PropertyType.PROPERTY) { continue; }
                if (sp.propertyValueType === PropertyValueType.NO_VALUE) { continue; }
                if (sp.numKeys > 0) { continue; }
                try { look[sp.matchName] = sp.value; } catch (eV) {}
            }
        } catch (e) {}
        return look;
    }

    // Restore appearance values captured by readGradientAppearance onto a fresh
    // gradient graphic, so replacing a gradient keeps its geometry and look.
    function writeGradientAppearance(container, look) {
        if (!look) { return; }
        try {
            for (var mn in look) {
                if (!look.hasOwnProperty(mn)) { continue; }
                var tp = null;
                try { tp = container.property(mn); } catch (eTp) { tp = null; }
                if (!tp) { continue; }
                try { tp.setValue(look[mn]); } catch (eCopy) {}
            }
        } catch (e) {}
    }

    // Return the contents group ("ADBE Vectors Group") of the first shape group
    // ("ADBE Vector Group") under root, so a fresh gradient lands INSIDE the
    // shape (where it fills correctly) instead of at the layer root (where it
    // sits outside the shape). Returns null if the layer has no shape group.
    function findShapeContents(root) {
        try {
            for (var i = 1; i <= root.numProperties; i++) {
                var p = root.property(i);
                if (p && p.matchName === "ADBE Vector Group") {
                    var c = null;
                    try { c = p.property("ADBE Vectors Group"); } catch (eC) {}
                    if (c) { return c; }
                }
            }
        } catch (e) {}
        return null;
    }

    // Remove the solid Fill / Stroke of the given kind from a contents group, so
    // applying a gradient replaces the flat color the user was covering (this is
    // the manual "delete the Fill" step). Walks descending by live index since
    // removing a property invalidates sibling references.
    function removeSolidGraphic(contents, isFill) {
        var target = isFill ? "ADBE Vector Graphic - Fill" : "ADBE Vector Graphic - Stroke";
        try {
            for (var j = contents.numProperties; j >= 1; j--) {
                var p = contents.property(j);
                if (p && p.matchName === target) {
                    try { p.remove(); } catch (eR) {}
                }
            }
        } catch (e) {}
    }

    // True when a .ffx template is embedded for the requested kind.
    function ffxHaveTemplate(isFill) {
        return isFill ? (GRAD_FFX_B64 !== "") : (GRAD_FFX_STROKE_B64 !== "");
    }

    // Save the project to disk before reading gradients: gradient colors are
    // parsed from the last-saved .aep (the live API can't read NO_VALUE grad
    // colors), so an unsaved edit would be invisible. Acts like Ctrl+S. If the
    // project was never saved, save() opens a Save As dialog once.
    function saveProjectForRead() {
        try {
            if (app.project) { app.project.save(); }
        } catch (e) {}
    }

    function extractFromLayers() {
        var comp = getActiveComp();
        if (!comp) {
            return;
        }
        var layers = comp.selectedLayers;
        if (!layers || !layers.length) {
            alert("Select one or more vector layers first.", SCRIPT_NAME);
            return;
        }

        var addedSolid = 0;
        var addedGrad = 0;
        var foundGradContainers = 0;
        var vectorLayers = 0;
        gradDebugLog = [];
        saveProjectForRead();
        resetSavedProjectCache();
        if (GRAD_DEBUG) { gradDebugLog.push("AE version: " + app.version); }
        app.beginUndoGroup("Extract palette from layers");
        try {
            for (var i = 0; i < layers.length; i++) {
                var layer = layers[i];
                if (layer.matchName !== "ADBE Vector Layer") {
                    continue;
                }
                vectorLayers++;
                var props = getColorPropertiesForLayer(layer);
                for (var j = 0; j < props.length; j++) {
                    var entry = props[j];
                    if (!entry || !entry.property) {
                        continue;
                    }
                    var value = entry.property.value;
                    if (!value || value.length < 3) {
                        continue;
                    }
                    var rgb = [value[0], value[1], value[2]];
                    var already = false;
                    for (var k = 0; k < swatches.length; k++) {
                        if (!isGradient(swatches[k]) && colorMatches(swatches[k].color, rgb)) {
                            already = true;
                            break;
                        }
                    }
                    if (!already) {
                        var label = layer.name + " " + (entry.kind === "stroke" ? "Stroke" : "Fill");
                        swatches.push({ type: "solid", name: label, color: rgb });
                        addedSolid++;
                    }
                }
                // Gradient fills / strokes
                var grads = getGradientContainersForLayer(layer, comp);
                foundGradContainers += grads.length;
                for (var gi = 0; gi < grads.length; gi++) {
                    var gsw = readGradientFromContainer(grads[gi].container, grads[gi].kind, grads[gi].nav);
                    if (!gsw) {
                        continue;
                    }
                    var gsig = gradientSignature(gsw);
                    var gdup = false;
                    for (var gk = 0; gk < swatches.length; gk++) {
                        if (isGradient(swatches[gk]) && gradientSignature(swatches[gk]) === gsig) {
                            gdup = true;
                            break;
                        }
                    }
                    if (!gdup) {
                        gsw.name = layer.name + " " + (gsw.kind === "stroke" ? "Grad Stroke" : "Grad Fill");
                        swatches.push(gsw);
                        addedGrad++;
                    }
                }
            }
        } finally {
            app.endUndoGroup();
        }

        selectedIndex = swatches.length ? swatches.length - 1 : -1;
        saveCurrentPalette();
        rebuildSwatches();
        updateStatus();
        if (statusText) {
            if (!vectorLayers) {
                statusText.text = "Extract: no shape layers selected.";
            } else if (addedSolid || addedGrad) {
                statusText.text = "Extracted " + addedSolid + " color" + (addedSolid === 1 ? "" : "s") +
                    ", " + addedGrad + " gradient" + (addedGrad === 1 ? "" : "s") + ".";
            } else if (foundGradContainers) {
                var unsaved = false;
                try { unsaved = !app.project.file; } catch (eUf) {}
                if (unsaved) {
                    statusText.text = "Found " + foundGradContainers + " gradient(s) — save the project first (colors are read from the saved .aep).";
                } else {
                    statusText.text = "Found " + foundGradContainers + " gradient(s) but couldn't read colors — save the project (Cmd/Ctrl+S) and retry; colors come from the saved .aep.";
                }
                if (GRAD_DEBUG && gradDebugLog.length) {
                    alert("Gradient read diagnostics:\n\n" + gradDebugLog.join("\n"), SCRIPT_NAME);
                }
            } else {
                statusText.text = "Extract: nothing new found on the selected layer(s).";
            }
        }
    }

    function readAseFile(file) {
        var result = [];
        if (!file || !file.exists) {
            return result;
        }
        file.encoding = "BINARY";
        if (!file.open("r")) {
            return result;
        }
        var data = file.read();
        file.close();

        var bytes = [];
        for (var i = 0; i < data.length; i++) {
            bytes.push(data.charCodeAt(i) & 0xFF);
        }

        function parseTextFallback() {
            var fallback = [];
            var text = data;
            var regex = /([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})/g;
            var match;
            while ((match = regex.exec(text)) !== null) {
                var r = parseInt(match[1], 10) / 255;
                var g = parseInt(match[2], 10) / 255;
                var b = parseInt(match[3], 10) / 255;
                fallback.push({ name: "Fallback Swatch", color: [r, g, b] });
            }
            return fallback;
        }

        function parseBytes(littleEndian) {
            var parsed = [];
            var pos = 0;
            function readByte() {
                var b = bytes[pos];
                pos += 1;
                return b;
            }
            function readUInt16() {
                var hi = readByte();
                var lo = readByte();
                return littleEndian ? (lo << 8) | hi : (hi << 8) | lo;
            }
            function readUInt32() {
                var b0 = readByte();
                var b1 = readByte();
                var b2 = readByte();
                var b3 = readByte();
                return littleEndian ? (b3 << 24) | (b2 << 16) | (b1 << 8) | b0 : (b0 << 24) | (b1 << 16) | (b2 << 8) | b3;
            }
            function readFloat32() {
                var b0 = readByte();
                var b1 = readByte();
                var b2 = readByte();
                var b3 = readByte();
                var sign = (b0 & 0x80) ? -1 : 1;
                var exponent = ((b0 & 0x7F) << 1) | (b1 >> 7);
                var mantissa = ((b1 & 0x7F) << 16) | (b2 << 8) | b3;
                if (exponent === 0) {
                    return 0;
                }
                if (exponent === 255) {
                    return sign * Infinity;
                }
                return sign * Math.pow(2, exponent - 127) * (1 + mantissa / 0x800000);
            }
            function readUtf16String(byteLength) {
                var out = "";
                for (var i = 0; i < byteLength; i += 2) {
                    if (pos + 1 >= bytes.length) {
                        break;
                    }
                    var code = readByte();
                    var next = readByte();
                    if (littleEndian) {
                        out += String.fromCharCode(code | (next << 8));
                    } else {
                        out += String.fromCharCode((code << 8) | next);
                    }
                }
                return out.replace(/\u0000/g, "");
            }
            function readColorValues(model) {
                var valueCount = 3;
                var values = [];
                if (model === "CMYK") {
                    valueCount = 4;
                } else if (model === "Gray") {
                    valueCount = 1;
                }
                var startPos = pos;
                if (bytes.length - pos >= valueCount * 4) {
                    var floatValues = [];
                    var floatOk = true;
                    for (var k = 0; k < valueCount; k++) {
                        var value = readFloat32();
                        if (!isFinite(value) || value < -1 || value > 1) {
                            floatOk = false;
                            break;
                        }
                        floatValues.push(value);
                    }
                    if (floatOk) {
                        return floatValues;
                    }
                    pos = startPos;
                }
                for (var k = 0; k < valueCount; k++) {
                    values.push(readUInt16());
                }
                return values;
            }

            var signature = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
            if (signature !== "ASEF") {
                return parsed;
            }

            pos = 4;
            readUInt16();
            readUInt16();
            var blockCount = readUInt32();
            for (var blockIndex = 0; blockIndex < blockCount; blockIndex++) {
                if (pos + 6 > bytes.length) {
                    break;
                }
                var blockType = readUInt16();
                var blockLength = readUInt32();
                var blockStart = pos;
                if (blockType === 1) {
                    if (pos + 2 > bytes.length) {
                        break;
                    }
                    var nameLength = readUInt16();
                    var nameBytes = Math.max(2, nameLength * 2);
                    if (pos + nameBytes + 4 > bytes.length) {
                        break;
                    }
                    var name = readUtf16String(nameBytes);
                    var model = "";
                    for (var i = 0; i < 4; i++) {
                        var ch = readByte();
                        if (ch) {
                            model += String.fromCharCode(ch);
                        }
                    }
                    model = model.replace(/\u0000/g, "");
                    var values = readColorValues(model);
                    if (values.length) {
                        var rgb = [0.5, 0.5, 0.5];
                        if (model === "RGB " || model === "RGB" || model === "RGB\0") {
                            if (values.length === 3 && values[0] <= 1 && values[1] <= 1 && values[2] <= 1) {
                                rgb = [values[0], values[1], values[2]];
                            } else {
                                rgb = [values[0] / 65535, values[1] / 65535, values[2] / 65535];
                            }
                        } else if (model === "CMYK") {
                            var c = values[0];
                            var m = values[1];
                            var y = values[2];
                            var k = values[3];
                            if (c > 1 || m > 1 || y > 1 || k > 1) {
                                c /= 65535;
                                m /= 65535;
                                y /= 65535;
                                k /= 65535;
                            }
                            rgb = [
                                Math.max(0, 1 - Math.min(1, c * (1 - k) + k)),
                                Math.max(0, 1 - Math.min(1, m * (1 - k) + k)),
                                Math.max(0, 1 - Math.min(1, y * (1 - k) + k))
                            ];
                        } else if (model === "Gray") {
                            var gray = values[0];
                            if (gray > 1) {
                                gray /= 65535;
                            }
                            rgb = [gray, gray, gray];
                        }
                        parsed.push({ name: name || "ASE Swatch", color: rgb });
                    }
                }
                pos = blockStart + blockLength;
                if (pos < blockStart || pos > bytes.length) {
                    break;
                }
            }
            return parsed;
        }

        var parsed = parseBytes(false);
        if (parsed.length) {
            return parsed;
        }
        parsed = parseBytes(true);
        if (parsed.length) {
            return parsed;
        }
        return parseTextFallback();
    }

    function importAse() {
        var file = File.openDialog("Import ASE palette", "ASE Files:*.ase");
        if (!file) {
            return;
        }
        var imported = readAseFile(file);
        if (!imported.length) {
            var info = "The selected file could not be parsed as a standard ASE palette.";
            if (file && file.name) {
                info += "\nFile: " + file.name;
            }
            info += "\n\nThis usually means the file is not a standard ASE palette or uses a less common variant.";
            info += "\n\nThe file may also be an unsupported palette format. If you share the file, I can adapt the parser to it.";
            alert(info, SCRIPT_NAME);
            return;
        }

        var fileName = decodeURI(file.name).replace(/\.[Aa][Ss][Ee]$/, "");
        var baseName = normalizePaletteName(fileName);
        var newName = baseName;
        var counter = 2;
        while (listContains(paletteCatalog, newName)) {
            newName = baseName + " " + counter;
            counter += 1;
        }

        saveCurrentPalette();

        swatches = [];
        for (var i = 0; i < imported.length; i++) {
            swatches.push({ type: "solid", name: imported[i].name || "ASE Swatch", color: imported[i].color });
        }
        paletteName = newName;
        if (!listContains(paletteCatalog, newName)) {
            paletteCatalog.push(newName);
        }
        selectedIndex = swatches.length ? 0 : -1;
        saveCurrentPalette();
        if (titleField) {
            titleField.text = paletteName;
        }
        refreshPaletteCombo();
        rebuildSwatches();
        updateStatus();
    }

    function drawSwatch(drawState) {
        var g = this.graphics;
        var swatch = swatches[this.swatchIndex];
        if (!swatch) {
            return;
        }
        var w = (this.size && this.size[0]) ? this.size[0] : CELL;
        var h = (this.size && this.size[1]) ? this.size[1] : CELL;
        if (isGradient(swatch)) {
            var bands = w;
            for (var bx = 0; bx < bands; bx++) {
                var t = bands > 1 ? (bx / (bands - 1)) : 0;
                var c = gradientColorAt(swatch.stops, t);
                var gb = g.newBrush(g.BrushType.SOLID_COLOR, [c[0], c[1], c[2], 1]);
                g.newPath();
                g.rectPath(bx, 0, 1, h);
                g.fillPath(gb);
            }
        } else {
            var brush = g.newBrush(g.BrushType.SOLID_COLOR, [swatch.color[0], swatch.color[1], swatch.color[2], 1]);
            g.newPath();
            g.rectPath(0, 0, w, h);
            g.fillPath(brush);
        }
        if (this.swatchIndex === selectedIndex) {
            var outer = g.newPen(g.PenType.SOLID_COLOR, [1, 1, 1, 1], 2);
            g.newPath();
            g.rectPath(1, 1, w - 2, h - 2);
            g.strokePath(outer);
            var inner = g.newPen(g.PenType.SOLID_COLOR, [0.12, 0.55, 1, 1], 2);
            g.newPath();
            g.rectPath(3, 3, w - 6, h - 6);
            g.strokePath(inner);
        }
    }

    // ---------- Google Material SVG icons ----------
    //
    // ScriptUI can't load SVG files and its graphics API has no Bézier
    // primitives, so we ship the icon `path` data inline and render it by
    // flattening every curve command into short line segments, then filling
    // the resulting polygon(s) with `fillPath`. This reproduces the Material
    // glyph faithfully, stays a single self-contained .jsx (no PNGs / no
    // external `icons/` folder), and remains ES3.
    //
    // Each entry: { vb: [minX, minY, width, height], d: "<path d attribute>" }.
    // Material Symbols use viewBox "0 -960 960 960" (y grows downward from
    // -960 to 0). Drop a new Material SVG's path string here to add an icon.
    var MATERIAL_ICONS = {
        // add_2 — plus
        "add": { vb: [0, -960, 960, 960], d: "M450-120v-330H120v-60h330v-330h60v330h330v60H510v330h-60Z" },
        // colorize (eyedropper) — pick a color from the screen.
        "pick": {
            vb: [0, -960, 960, 960],
            d: "M120-120v-190l358-358-58-56 58-56 76 76 124-124q5-5 12.5-8t15.5-3q8 0 15 3t13 8l94 94q5 6 8 13t3 15q0 8-3 15.5t-8 12.5L705-555l76 78-57 57-56-58-358 358H120Zm80-80h78l332-334-76-76-334 332v78Zm447-410 96-96-37-37-96 96 37 37Zm0 0-37-37 37 37Z"
        },
        // chip_extraction — extract colors from selected layers.
        "extract": {
            vb: [0, -960, 960, 960],
            d: "M480-121q-75 0-140.5-28.5t-114-77q-48.5-48.5-77-114T120-481q0-75 28.5-140.5t77-114q48.5-48.5 114-77T480-841v60q-124 0-212 88t-88 212q0 125.36 88 212.68Q356-181 480-181v60Zm173-173-42-43 113-113H360v-60h364L611-624l42-42 186 186-186 186Z"
        },
        // download — import ASE palette
        "import": { vb: [0, -960, 960, 960], d: "M480-313 287-506l43-43 120 120v-371h60v371l120-120 43 43-193 193ZM220-160q-24 0-42-18t-18-42v-143h60v143h520v-143h60v143q0 24-18 42t-42 18H220Z" },
        // backspace — remove selected swatch
        "remove": { vb: [0, -960, 960, 960], d: "m448-326 112-112 112 112 43-43-113-111 111-111-43-43-110 112-112-112-43 43 113 111-113 111 43 43Zm-98 166q-14.25 0-27-6.38-12.75-6.37-21-17.62L80-480l221-296q8.25-11.25 21-17.63 12.75-6.37 27-6.37h472q24.75 0 42.38 17.62Q881-764.75 881-740v520q0 24.75-17.62 42.37Q845.75-160 821-160H350ZM155-480l195 260h471v-520H350L155-480Zm431 0Z" },
        // cancel_presentation — clear all swatches
        "clear": { vb: [0, -960, 960, 960], d: "m358-316 122-122 122 122 42-42-122-122 122-122-42-42-122 122-122-122-42 42 122 122-122 122 42 42ZM140-160q-24 0-42-18t-18-42v-520q0-24 18-42t42-18h680q24 0 42 18t18 42v520q0 24-18 42t-42 18H140Zm0-60h680v-520H140v520Zm0 0v-520 520Z" },
        // open_in_new_off — strip Fill / Stroke paint from selected shapes
        "removepaint": { vb: [0, -960, 960, 960], d: "m791-55-65-65H200q-33 0-56.5-23.5T120-200v-526l-65-65 57-57 736 736-57 57ZM200-200h446L451-395l-63 63-56-56 63-63-195-195v446Zm114-560-80-80h246v80H314Zm251 251-56-56 195-195H560v-80h280v280h-80v-144L565-509Zm275 275-80-80v-166h80v246Z" },
        // dialogs — apply to Fill only (filled square)
        "fill": { vb: [0, -960, 960, 960], d: "M264-264h432v-432H264v432Zm-84 144q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h600q24 0 42 18t18 42v600q0 24-18 42t-42 18H180Zm0-60h600v-600H180v600Zm0-600v600-600Z" },
        // crop_square — apply to Stroke only (outline square)
        "stroke": { vb: [0, -960, 960, 960], d: "M180-120q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h600q24 0 42 18t18 42v600q0 24-18 42t-42 18H180Zm0-60h600v-600H180v600Zm0 0v-600 600Z" },
        // colors — apply to Fill and Stroke
        "both": { vb: [0, 0, 24, 24], d: "M18 14V16H20C20.55 16 21.0208 15.8042 21.4125 15.4125C21.8042 15.0208 22 14.55 22 14V4C22 3.45 21.8042 2.97917 21.4125 2.5875C21.0208 2.19583 20.55 2 20 2H10C9.45 2 8.97917 2.19583 8.5875 2.5875C8.19583 2.97917 8 3.45 8 4V6H10V4H20V14H18ZM14 22C14.55 22 15.0208 21.8042 15.4125 21.4125C15.8042 21.0208 16 20.55 16 20V10C16 9.45 15.8042 8.97917 15.4125 8.5875C15.0208 8.19583 14.55 8 14 8H4C3.45 8 2.97917 8.19583 2.5875 8.5875C2.19583 8.97917 2 9.45 2 10V20C2 20.55 2.19583 21.0208 2.5875 21.4125C2.97917 21.8042 3.45 22 4 22H14Z" }
    };

    // Flatten an SVG path `d` string into an array of subpaths, each an array
    // of [x, y] points in viewBox coordinates. Supports M/L/H/V/C/S/Q/T/A/Z
    // in both absolute and relative form; curves are sampled into `steps`
    // straight segments. Result is cached on the icon def as `_subs`.
    function flattenSvgPath(d, steps) {
        if (!steps) steps = 12;
        var subs = [];
        var cur = null;
        var cx = 0, cy = 0, sx = 0, sy = 0, px = 0, py = 0;
        var prevCmd = "";
        var toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
        if (!toks) return subs;
        var i = 0;
        function num() { return parseFloat(toks[i++]); }
        function start(x, y) { cur = [[x, y]]; subs.push(cur); sx = x; sy = y; cx = x; cy = y; }
        function line(x, y) { if (!cur) start(cx, cy); cur.push([x, y]); cx = x; cy = y; }
        function quad(x1, y1, x, y) {
            var x0 = cx, y0 = cy, s, t, mt;
            for (s = 1; s <= steps; s++) {
                t = s / steps; mt = 1 - t;
                cur.push([mt * mt * x0 + 2 * mt * t * x1 + t * t * x,
                          mt * mt * y0 + 2 * mt * t * y1 + t * t * y]);
            }
            px = x1; py = y1; cx = x; cy = y;
        }
        function cubic(x1, y1, x2, y2, x, y) {
            var x0 = cx, y0 = cy, s, t, mt;
            for (s = 1; s <= steps; s++) {
                t = s / steps; mt = 1 - t;
                cur.push([mt * mt * mt * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x,
                          mt * mt * mt * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y]);
            }
            px = x2; py = y2; cx = x; cy = y;
        }
        while (i < toks.length) {
            var c = toks[i];
            if (/[a-zA-Z]/.test(c)) { i++; }
            else { c = prevCmd; if (c === "M") c = "L"; else if (c === "m") c = "l"; }
            var up = c.toUpperCase();
            var rel = (c === c.toLowerCase());
            var bx = rel ? cx : 0, by = rel ? cy : 0;
            if (up === "M") { var mx = num() + bx, my = num() + by; start(mx, my); }
            else if (up === "L") { var lx = num() + bx, ly = num() + by; line(lx, ly); }
            else if (up === "H") { line(num() + bx, cy); }
            else if (up === "V") { line(cx, num() + by); }
            else if (up === "C") { var c1x = num() + bx, c1y = num() + by, c2x = num() + bx, c2y = num() + by, ex = num() + bx, ey = num() + by; cubic(c1x, c1y, c2x, c2y, ex, ey); }
            else if (up === "S") { var s1x, s1y; var pu = prevCmd.toUpperCase(); if (pu === "C" || pu === "S") { s1x = 2 * cx - px; s1y = 2 * cy - py; } else { s1x = cx; s1y = cy; } var s2x = num() + bx, s2y = num() + by, sex = num() + bx, sey = num() + by; cubic(s1x, s1y, s2x, s2y, sex, sey); }
            else if (up === "Q") { var q1x = num() + bx, q1y = num() + by, qex = num() + bx, qey = num() + by; quad(q1x, q1y, qex, qey); }
            else if (up === "T") { var t1x, t1y; var puT = prevCmd.toUpperCase(); if (puT === "Q" || puT === "T") { t1x = 2 * cx - px; t1y = 2 * cy - py; } else { t1x = cx; t1y = cy; } var tex = num() + bx, tey = num() + by; quad(t1x, t1y, tex, tey); }
            else if (up === "A") { num(); num(); num(); num(); num(); var ax = num() + bx, ay = num() + by; line(ax, ay); }
            else if (up === "Z") { if (cur) cur.push([sx, sy]); cx = sx; cy = sy; }
            else { i++; }
            prevCmd = c;
        }
        return subs;
    }

    // Target glyph box in pixels. All Material icons render at this fixed
    // size regardless of the host button's dimensions, so every icon looks
    // the same size across the panel. Clamped down for very small buttons.
    var ICON_PX = 20;

    // Render a Material icon def centered in a w×h button using `color`. The
    // glyph keeps its aspect ratio and is drawn at a fixed target size
    // (ICON_PX) so all icons share one visual size.
    function drawMaterialIcon(g, w, h, def, color) {
        if (!def._subs) def._subs = flattenSvgPath(def.d, 12);
        var subs = def._subs;
        if (!subs || !subs.length) return false;
        var vb = def.vb;
        var target = ICON_PX;
        if (target > w - 2) target = w - 2;
        if (target > h - 2) target = h - 2;
        var scale = target / Math.max(vb[2], vb[3]);
        var offX = (w - vb[2] * scale) / 2;
        var offY = (h - vb[3] * scale) / 2;
        function mapX(x) { return offX + (x - vb[0]) * scale; }
        function mapY(y) { return offY + (y - vb[1]) * scale; }
        var brush = g.newBrush(g.BrushType.SOLID_COLOR, color);
        g.newPath();
        var s, p, pts;
        for (s = 0; s < subs.length; s++) {
            pts = subs[s];
            if (!pts.length) continue;
            g.moveTo(mapX(pts[0][0]), mapY(pts[0][1]));
            for (p = 1; p < pts.length; p++) {
                g.lineTo(mapX(pts[p][0]), mapY(pts[p][1]));
            }
        }
        g.fillPath(brush);
        return true;
    }

    // Subtle rounded highlight painted behind an icon button while the mouse
    // is over it. drawState.mouseOver is provided by ScriptUI to onDraw.
    function drawHoverBg(g, w, h, drawState) {
        if (!drawState || !drawState.mouseOver) return;
        try {
            var b = g.newBrush(g.BrushType.SOLID_COLOR, [1, 1, 1, 0.14]);
            g.newPath();
            g.rectPath(1, 1, w - 2, h - 2);
            g.fillPath(b);
        } catch (eHover) {}
    }

    function drawTargetIcon(drawState) {
        var g = this.graphics;
        var w = (this.size && this.size[0]) ? this.size[0] : 28;
        var h = (this.size && this.size[1]) ? this.size[1] : 24;
        drawHoverBg(g, w, h, drawState);
        // Selected mode is highlighted blue; unselected is dimmed grey.
        var col = this.value ? [0.35, 0.62, 1.0, 1] : [0.7, 0.7, 0.7, 1];
        if (MATERIAL_ICONS[this.mode] && drawMaterialIcon(g, w, h, MATERIAL_ICONS[this.mode], col)) {
            return;
        }
        var fillColor = this.value ? [0.2, 0.45, 0.95, 1] : [0.7, 0.7, 0.7, 1];
        var baseColor = this.value ? [0.95, 0.95, 0.95, 1] : [0.25, 0.25, 0.25, 1];
        var brush = g.newBrush(g.BrushType.SOLID_COLOR, fillColor);
        var outline = g.newPen(g.PenType.SOLID_COLOR, baseColor, 1.5);
        g.newPath();
        if (this.mode === "fill") {
            g.rectPath(4, 4, w - 8, h - 8);
            g.fillPath(brush);
            g.strokePath(outline);
        } else if (this.mode === "stroke") {
            g.rectPath(4, 4, w - 8, h - 8);
            g.strokePath(outline);
        } else {
            g.rectPath(4, 4, w - 8, h - 8);
            g.fillPath(brush);
            g.strokePath(outline);
            var inner = g.newPen(g.PenType.SOLID_COLOR, [1, 1, 1, 0.8], 2);
            g.newPath();
            g.rectPath(8, 8, w - 16, h - 16);
            g.strokePath(inner);
        }
    }

    function strokeLine(g, pen, x1, y1, x2, y2) {
        g.newPath();
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
        g.strokePath(pen);
    }

    function drawActionIcon(drawState) {
        var g = this.graphics;
        var w = (this.size && this.size[0]) ? this.size[0] : 34;
        var h = (this.size && this.size[1]) ? this.size[1] : 26;
        drawHoverBg(g, w, h, drawState);
        var col = this.enabled ? [0.86, 0.86, 0.86, 1] : [0.45, 0.45, 0.45, 1];
        var type = this.iconType;
        // Prefer a Google Material glyph when one is registered for this action.
        if (MATERIAL_ICONS[type] && drawMaterialIcon(g, w, h, MATERIAL_ICONS[type], col)) {
            return;
        }
        var cx = w / 2;
        var cy = h / 2;
        var pen = g.newPen(g.PenType.SOLID_COLOR, col, 2);
        if (type === "add") {
            strokeLine(g, pen, cx - 6, cy, cx + 6, cy);
            strokeLine(g, pen, cx, cy - 6, cx, cy + 6);
        } else if (type === "pick") {
            strokeLine(g, pen, cx + 6, cy - 7, cx - 4, cy + 3);
            g.newPath();
            g.rectPath(cx + 4, cy - 9, 5, 5);
            g.strokePath(pen);
            strokeLine(g, pen, cx - 5, cy + 2, cx - 2, cy + 5);
        } else if (type === "extract") {
            g.newPath();
            g.rectPath(cx - 8, cy - 6, 10, 12);
            g.strokePath(pen);
            strokeLine(g, pen, cx - 2, cy, cx + 8, cy);
            strokeLine(g, pen, cx + 4, cy - 4, cx + 8, cy);
            strokeLine(g, pen, cx + 4, cy + 4, cx + 8, cy);
        } else if (type === "import") {
            strokeLine(g, pen, cx, cy - 7, cx, cy + 2);
            strokeLine(g, pen, cx - 4, cy - 2, cx, cy + 2);
            strokeLine(g, pen, cx + 4, cy - 2, cx, cy + 2);
            strokeLine(g, pen, cx - 7, cy + 4, cx - 7, cy + 7);
            strokeLine(g, pen, cx - 7, cy + 7, cx + 7, cy + 7);
            strokeLine(g, pen, cx + 7, cy + 7, cx + 7, cy + 4);
        } else if (type === "remove") {
            strokeLine(g, pen, cx - 7, cy - 5, cx + 7, cy - 5);
            strokeLine(g, pen, cx - 3, cy - 7, cx + 3, cy - 7);
            strokeLine(g, pen, cx - 3, cy - 7, cx - 3, cy - 5);
            strokeLine(g, pen, cx + 3, cy - 7, cx + 3, cy - 5);
            strokeLine(g, pen, cx - 5, cy - 5, cx - 4, cy + 7);
            strokeLine(g, pen, cx + 5, cy - 5, cx + 4, cy + 7);
            strokeLine(g, pen, cx - 4, cy + 7, cx + 4, cy + 7);
        } else if (type === "clear") {
            strokeLine(g, pen, cx - 6, cy - 6, cx + 6, cy + 6);
            strokeLine(g, pen, cx - 6, cy + 6, cx + 6, cy - 6);
        }
    }

    function makeActionButton(group, type, tip, handler) {
        var btn = group.add("iconbutton", undefined, undefined, { style: "toolbutton", toggle: false });
        btn.size = [34, 26];
        btn.preferredSize = [34, 26];
        btn.iconType = type;
        btn.helpTip = tip;
        btn.onDraw = drawActionIcon;
        btn.onClick = handler;
        return btn;
    }

    function makeSwatchClick(index) {
        return function () {
            selectedIndex = index;
            applySwatch(index);
            rebuildSwatches();
            updateStatus();
        };
    }

    function computeColumns() {
        var available = 0;
        if (swatchPanel) {
            // Use whichever laid-out width is available, but never trust a
            // value larger than the panel's logical size (avoids overreporting
            // mid-resize, which is what pushed an extra column off-edge).
            var bw = (swatchPanel.bounds && swatchPanel.bounds.width) ? swatchPanel.bounds.width : 0;
            var sw = (swatchPanel.size && swatchPanel.size[0]) ? swatchPanel.size[0] : 0;
            if (bw > 0 && sw > 0) {
                available = Math.min(bw, sw);
            } else {
                available = bw > 0 ? bw : sw;
            }
        }
        // Container is now a plain group with 0 margins, so only a small
        // safety gutter is reserved on each side.
        var pad = 4;
        if (swatchPanel && swatchPanel.margins && typeof swatchPanel.margins.left === "number") {
            pad = swatchPanel.margins.left + swatchPanel.margins.right + 2;
        }
        // A toolbutton-styled iconbutton renders slightly wider than its `size`
        // (frame/padding), plus 2px row spacing between cells. Budget CELL+4
        // per cell — enough to avoid cropping the last swatch without wasting
        // a whole column of room.
        var SAFETY = 4;
        available -= (pad + SAFETY);
        if (available <= 0) {
            return 1;
        }
        var cellTotal = CELL + 4;
        var cols = Math.floor((available + 4) / cellTotal);
        if (cols < 1) {
            cols = 1;
        }
        return cols;
    }

    function rebuildSwatches() {
        if (!swatchPanel) {
            return;
        }
        clearChildren(swatchPanel);
        var columns = computeColumns();
        var rowGroup = null;
        for (var i = 0; i < swatches.length; i++) {
            if (i % columns === 0) {
                rowGroup = swatchPanel.add("group");
                rowGroup.spacing = 2;
                rowGroup.alignment = ["left", "top"];
            }
            var cell = rowGroup.add("iconbutton", undefined, undefined, { style: "toolbutton", toggle: false });
            cell.size = [CELL, CELL];
            cell.preferredSize = [CELL, CELL];
            cell.swatchIndex = i;
            if (isGradient(swatches[i])) {
                cell.helpTip = swatches[i].name + "\n" + swatches[i].stops.length + " stops • " +
                    (swatches[i].gradType === 2 ? "radial" : "linear");
            } else {
                cell.helpTip = swatches[i].name + "\n" + Math.round(swatches[i].color[0] * 255) + "," +
                    Math.round(swatches[i].color[1] * 255) + "," + Math.round(swatches[i].color[2] * 255);
            }
            cell.onDraw = drawSwatch;
            cell.onClick = makeSwatchClick(i);
        }
        if (swatchPanel.layout) {
            swatchPanel.layout.layout(true);
        }
        updateStatus();
        updateButtonState();
    }

    function updateStatus() {
        if (!statusText) {
            return;
        }
        updateHexField();
        if (selectedIndex >= 0 && swatches[selectedIndex]) {
            var s = swatches[selectedIndex];
            statusText.text = "Selected: " + s.name + " • " + swatches.length + " swatches";
        } else {
            statusText.text = swatches.length + " swatches";
        }
    }

    function updateButtonState() {
        if (removeBtn) {
            removeBtn.enabled = selectedIndex >= 0 && swatches[selectedIndex] ? true : false;
        }
    }

    function updateHexField() {
        if (!hexField) {
            return;
        }
        if (selectedIndex >= 0 && swatches[selectedIndex]) {
            if (isGradient(swatches[selectedIndex])) {
                hexField.text = "(gradient)";
                hexField.enabled = false;
            } else {
                hexField.text = rgbToHex(swatches[selectedIndex].color);
                hexField.enabled = true;
            }
        } else {
            hexField.text = "";
            hexField.enabled = true;
        }
    }

    function applyHexToSelected() {
        if (selectedIndex < 0 || !swatches[selectedIndex]) {
            return;
        }
        if (isGradient(swatches[selectedIndex])) {
            updateHexField();
            return;
        }
        var rgb = hexToRgb(hexField ? hexField.text : "");
        if (!rgb) {
            updateHexField();
            return;
        }
        swatches[selectedIndex].color = rgb;
        saveCurrentPalette();
        rebuildSwatches();
        updateStatus();
    }

    function addColor() {
        var color = pickColor(null);
        if (!color) {
            return;
        }
        addSwatch(color, "Swatch");
    }

    // Grab a color with the eyedropper. Opens AE's color picker (forced native
    // by pickColor), whose eyedropper tool samples any pixel on screen, and
    // stores the result as a new swatch. ExtendScript has no API to sample a
    // raw screen pixel directly, so the picker's built-in eyedropper is the
    // route to a screen color.
    function pickFromScreen() {
        var color = pickColor(null);
        if (!color) {
            return;
        }
        addSwatch(color, "Picked");
    }

    function setTargetMode(mode) {
        targetMode = mode;
        if (fillIconBtn) {
            fillIconBtn.value = mode === "fill";
        }
        if (strokeIconBtn) {
            strokeIconBtn.value = mode === "stroke";
        }
        if (bothIconBtn) {
            bothIconBtn.value = mode === "both";
        }
        updateStatus();
    }

    function setPaletteName() {
        var newName = normalizePaletteName(titleField ? titleField.text : paletteName);
        if (!newName || newName === paletteName) {
            return;
        }
        if (!listContains(paletteCatalog, newName)) {
            paletteCatalog.push(newName);
        }
        paletteName = newName;
        saveCurrentPalette();
        refreshPaletteCombo();
    }

    function refreshPaletteCombo() {
        if (!paletteCombo) {
            return;
        }
        if (paletteCombo.removeAll) {
            paletteCombo.removeAll();
        }
        for (var i = 0; i < paletteCatalog.length; i++) {
            paletteCombo.add("item", paletteCatalog[i]);
        }
        for (var j = 0; j < paletteCombo.items.length; j++) {
            if (paletteCombo.items[j].text === paletteName) {
                paletteCombo.selection = paletteCombo.items[j];
                break;
            }
        }
        if (!paletteCombo.selection) {
            paletteCombo.selection = paletteCombo.items[0];
        }
    }

    function buildUI(root) {
        var win = root;
        win.orientation = "column";
        win.alignChildren = ["fill", "top"];
        win.spacing = 8;
        win.margins = 10;

        // ===== Wrapping toolbars =====
        // Three flow hosts: action buttons, the palette name/selector, and the
        // fill/stroke/both + hex controls. Each wraps into extra rows when the
        // panel is too narrow to hold its items on one line (see reflowToolbars).
        var actionHost = win.add("group");
        actionHost.orientation = "column";
        actionHost.alignment = ["fill", "top"];
        actionHost.alignChildren = ["left", "top"];
        actionHost.spacing = 4;
        actionHost.margins = 0;

        var paletteHost = win.add("group");
        paletteHost.orientation = "column";
        paletteHost.alignment = ["fill", "top"];
        paletteHost.alignChildren = ["left", "top"];
        paletteHost.spacing = 4;
        paletteHost.margins = 0;

        var modeHost = win.add("group");
        modeHost.orientation = "column";
        modeHost.alignment = ["fill", "top"];
        modeHost.alignChildren = ["left", "top"];
        modeHost.spacing = 4;
        modeHost.margins = 0;

        var actionFlow = makeFlow(actionHost, 4);
        actionFlow.add(34, function (row) {
            makeActionButton(row, "extract", "Extract colors from selected layers", extractFromLayers);
        });
        actionFlow.add(34, function (row) {
            makeActionButton(row, "removepaint", "Remove Fill / Stroke / Both from selected layers (per target mode)", removePaintFromSelection);
        });
        actionFlow.add(34, function (row) {
            makeActionButton(row, "add", "Add Color", addColor);
        });
        // Screen color picker hidden for now (eyedropper via AE's color picker).
        actionFlow.add(34, function (row) {
            makeActionButton(row, "import", "Import ASE palette (creates a new palette)", importAse);
        });
        actionFlow.add(34, function (row) {
            removeBtn = makeActionButton(row, "remove", "Remove selected swatch", function () {
                removeSwatch(selectedIndex);
            });
            updateButtonState();
        });
        // Divider + "clear all" travel together as one item so the divider
        // never dangles at the end of a wrapped row.
        actionFlow.add(47, function (row) {
            var preGap = row.add("group");
            preGap.minimumSize.width = 6;
            preGap.maximumSize.width = 6;
            var divider = row.add("group");
            divider.minimumSize = [1, 22];
            divider.maximumSize = [1, 22];
            divider.onDraw = drawDivider;
            var postGap = row.add("group");
            postGap.minimumSize.width = 6;
            postGap.maximumSize.width = 6;
            makeActionButton(row, "clear", "Clear all swatches in this palette", function () {
                swatches = [];
                selectedIndex = -1;
                saveCurrentPalette();
                rebuildSwatches();
            });
        });

        var paletteFlow = makeFlow(paletteHost, 6);
        paletteFlow.add(46, function (row) {
            row.add("statictext", undefined, "Palette:");
        });
        paletteFlow.add(120, function (row) {
            titleField = row.add("edittext", undefined, paletteName);
            titleField.preferredSize = [120, 24];
            titleField.onChange = function () {
                setPaletteName();
            };
        });
        paletteFlow.add(120, function (row) {
            paletteCombo = row.add("dropdownlist");
            paletteCombo.preferredSize = [120, 24];
            paletteCombo.onChange = function () {
                if (this.selection) {
                    switchPalette(this.selection.text);
                }
            };
            refreshPaletteCombo();
        });

        var modeFlow = makeFlow(modeHost, 8);
        modeFlow.add(42, function (row) {
            fillIconBtn = makeModeBtn(row, "fill", "Apply to Fill only");
        });
        modeFlow.add(42, function (row) {
            strokeIconBtn = makeModeBtn(row, "stroke", "Apply to Stroke only");
        });
        modeFlow.add(42, function (row) {
            bothIconBtn = makeModeBtn(row, "both", "Apply to Fill and Stroke");
        });
        modeFlow.add(30, function (row) {
            row.add("statictext", undefined, "Hex:");
        });
        modeFlow.add(90, function (row) {
            hexField = row.add("edittext", undefined, "");
            hexField.preferredSize = [90, 24];
            hexField.helpTip = "Hex of the selected swatch (editable)";
            hexField.onChange = function () {
                applyHexToSelected();
            };
            updateHexField();
        });

        function toolbarWidth() {
            var w = 0;
            try {
                if (win.size && win.size[0]) { w = win.size[0]; }
            } catch (eW) {}
            w -= 20;
            return w;
        }

        function reflowToolbars() {
            if (reflowing) { return; }
            reflowing = true;
            var avail = toolbarWidth();
            var changed = false;
            if (actionFlow.reflow(avail)) { changed = true; }
            if (paletteFlow.reflow(avail)) { changed = true; }
            if (modeFlow.reflow(avail)) { changed = true; }
            if (changed) {
                setTargetMode(targetMode);
                try { if (win.layout) { win.layout.layout(true); } } catch (eL) {}
            }
            reflowing = false;
        }

        swatchPanel = win.add("group");
        swatchPanel.orientation = "column";
        swatchPanel.alignChildren = ["left", "top"];
        swatchPanel.alignment = ["fill", "top"];
        swatchPanel.spacing = 2;
        swatchPanel.margins = 0;
        // When the panel itself changes width (e.g. docked panel resized),
        // recompute the column count so swatches re-flow instead of cropping.
        // Guarded by `reflowing` so the layout pass inside rebuildSwatches
        // can't re-enter this handler.
        swatchPanel.onResizing = swatchPanel.onResize = function () {
            if (reflowing) { return true; }
            reflowing = true;
            try { rebuildSwatches(); relayoutTree(); } catch (eSwR) {}
            reflowing = false;
            return true;
        };

        statusText = __status__;

        function relayoutTree() {
            // Re-layout this host and every ancestor so that when the swatch
            // grid gains or loses a row the sibling sections (e.g. the Tint /
            // Split buttons) move back up instead of staying pushed down.
            var node = win;
            var top = win;
            var guard = 0;
            while (node && guard < 8) {
                try { if (node.layout) { node.layout.layout(true); } } catch (eRL) {}
                top = node;
                node = node.parent;
                guard++;
            }
            // layout(true) packs to the *preferred* (content) height, which
            // leaves the flexible footer spacer collapsed. resize() on the top
            // window redistributes the leftover room into the spring so the
            // footer stays pinned to the bottom edge.
            try { if (top && top.layout) { top.layout.resize(); } } catch (eRz) {}
        }

        function reflowSwatches() {
            if (reflowing) {
                return;
            }
            reflowing = true;
            rebuildSwatches();
            relayoutTree();
            reflowing = false;
        }

        win.onResizing = win.onResize = function () {
            reflowToolbars();
            reflowSwatches();
            return true;
        };

        // Build the toolbars once so their controls exist before palette data
        // is loaded into them, then load state.
        reflowToolbars();
        resetDefaultsIfNeeded();
        loadPalette();
        setTargetMode(targetMode);

        if (win instanceof Window) {
            win.center();
            win.show();
            reflowToolbars();
            reflowSwatches();
        } else {
            win.layout.layout(true);
            win.layout.resize();
            reflowToolbars();
            reflowSwatches();
        }
        return win;
    }

    buildUI(__host__);
}

})(this);
