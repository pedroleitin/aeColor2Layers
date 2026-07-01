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
  var PANEL_VERSION = "v0.8";

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

  // ----- Section 1: Color→Layer -----
  var host1 = win.add("group");
  host1.orientation = "column";
  host1.alignment = ["fill", "top"];

  // ----- Section 2: Vector Color Swatches -----
  var host2 = win.add("group");
  host2.orientation = "column";
  host2.alignment = ["fill", "fill"];

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

  var VERSION = "v0.8";

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
    [ 85, 100, 200],   //  8 Blue
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
  function collectShapeColors(layer, includeStrokes) {
    var out = [];
    var root = safeProp(layer, "ADBE Root Vectors Group");
    if (!root) return out;
    walkGroup(root, out, includeStrokes);
    return out;
  }

  function walkGroup(group, out, includeStrokes) {
    var i;
    for (i = 1; i <= group.numProperties; i++) {
      var item = group.property(i);
      try { if (item.enabled === false) continue; } catch (eEn) {}
      var mn = item.matchName;
      if (mn === "ADBE Vector Group") {
        var inner = safeProp(item, "ADBE Vectors Group");
        if (inner) walkGroup(inner, out, includeStrokes);
      } else if (mn === "ADBE Vector Graphic - Fill") {
        var fc = safeProp(item, "ADBE Vector Fill Color");
        var rgb = staticValue(fc);
        if (rgb && rgb.length >= 3) {
          out.push([rgb[0] * 255, rgb[1] * 255, rgb[2] * 255]);
        }
      } else if (includeStrokes && mn === "ADBE Vector Graphic - Stroke") {
        var sc = safeProp(item, "ADBE Vector Stroke Color");
        var srgb = staticValue(sc);
        if (srgb && srgb.length >= 3) {
          out.push([srgb[0] * 255, srgb[1] * 255, srgb[2] * 255]);
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
    var colors = collectShapeColors(layer, includeStrokes);
    if (colors.length === 0) {
      return { ok: false, reason: "no enabled fills found" };
    }
    var dom = dominantColor(colors);
    var idx = closestLabelIndex(dom);
    layer.label = idx;
    return { ok: true, labelIdx: idx, labelName: LABEL_NAMES[idx - 1], rgb: dom };
  }

  // ---------- UI ----------

  function buildUI(thisObj) {
    var win = thisObj;

    win.orientation = "column";
    win.alignChildren = ["fill", "top"];
    win.spacing = 8;
    win.margins = 12;

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
      "split": { vb: [0, -960, 960, 960], d: "M450-80v-200q0-48-16-79t-49-64l43-43q13 11 27.5 30t24.5 35q17-26 33.5-45t31.5-32q58-47 83.5-113.5T648-766l-90 90-42-42 162-162 162 162-42 42-90-90q5 126-24.5 198.5T585-432q-44 40-59.5 73T510-280v200h-60ZM258-636q-4-18-6.5-52.5T251-765l-89 89-42-42 162-162 162 162-42 42-90-90q-2 38-1 66.5t5 49.5l-58 14Zm84 171q-17-18-37.5-47.5T273-577l59-15q9 25 24 48t28 37l-42 42Z" }
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
      var iconGap = 6;
      var iconDef = (this._icon && BTN_ICONS[this._icon]) ? BTN_ICONS[this._icon] : null;
      try {
        var txt = this._label || "";
        var font = this._font || g.font;
        var tpen = g.newPen(g.PenType.SOLID_COLOR, tcol, 1);
        var dim = g.measureString(txt, font, w);
        var tw = (dim && dim.width) ? dim.width : (dim ? dim[0] : 0);
        var th = (dim && dim.height) ? dim.height : (dim ? dim[1] : 0);
        // Center the icon+text block as a unit when an icon is present.
        var blockW = iconDef ? (iconSize + iconGap + tw) : tw;
        var startX = (w - blockW) / 2;
        if (iconDef) {
          drawIconAt(g, iconDef, startX, (h - iconSize) / 2, iconSize, tcol);
          g.drawString(txt, tpen, startX + iconSize + iconGap, (h - th) / 2, font);
        } else {
          g.drawString(txt, tpen, (w - tw) / 2, (h - th) / 2, font);
        }
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

    // ===== Header =====
    var header = win.add("group");
    header.orientation = "column";
    header.alignment = ["fill", "top"];
    header.alignChildren = ["center", "center"];
    header.spacing = 1;
    header.margins = [0, 6, 0, 8];

    var titleText = header.add("statictext", undefined, "Color\u2192Layer");
    fontBold(titleText, 16);
    colorAccent(titleText);

    // ===== Primary actions =====
    // Tint button sits beside a compact "Strokes" toggle that controls whether
    // stroke colors are sampled alongside fills.
    var applyRow = win.add("group");
    applyRow.orientation = "row";
    applyRow.alignment = ["fill", "top"];
    applyRow.alignChildren = ["left", "center"];
    applyRow.spacing = 8;

    var applyBtn = makeRoundButton(applyRow, "Tint selected layers",
      "Walk each selected shape layer's enabled Fill items, "
      + "compute the mean color, and set the layer's Label color to the "
      + "closest of AE's 16 label presets.", null);
    applyBtn.alignment = ["fill", "center"];
    applyBtn.maximumSize.width = 10000;
    applyBtn.preferredSize = [180, 34];
    applyBtn.minimumSize = [120, 34];

    var includeStrokesCb = applyRow.add("checkbox", undefined, "Strokes");
    includeStrokesCb.alignment = ["right", "center"];
    includeStrokesCb.helpTip = "When on, stroke colors are sampled alongside fills. "
      + "Useful for line-art / outline-only icons where the stroke IS the color.";

    var splitBtn = makeRoundButton(win, "Split groups into layers",
      "Duplicate each selected shape layer and create one new layer per top-level shape group.",
      null);
    splitBtn._icon = "split";
    splitBtn.alignment = ["fill", "top"];
    splitBtn.maximumSize.width = 10000;
    splitBtn.preferredSize = [220, 34];
    splitBtn.minimumSize = [140, 34];

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
      var inclStrokes = !!includeStrokesCb.value;

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
    win.onResizing = win.onResize = function () {
      try { this.layout.resize(); } catch (eR) {}
    };

    if (win instanceof Window) {
      win.center();
      win.show();
    }
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
        return [
            { name: "Red", color: [1, 0.1, 0.1] },
            { name: "Green", color: [0.1, 0.8, 0.2] },
            { name: "Blue", color: [0.1, 0.4, 1] },
            { name: "Yellow", color: [1, 0.9, 0.1] },
            { name: "Magenta", color: [1, 0.2, 0.8] },
            { name: "Cyan", color: [0.2, 0.8, 0.9] }
        ];
    }

    function serializeSwatches(list) {
        var payload = [];
        for (var i = 0; i < list.length; i++) {
            var s = list[i];
            payload.push([
                sanitizeText(s.name || "Swatch"),
                s.color[0],
                s.color[1],
                s.color[2]
            ].join(SEP_FIELD));
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
            if (fields.length < 4) {
                continue;
            }
            result.push({
                name: fields[0],
                color: [parseFloat(fields[1]), parseFloat(fields[2]), parseFloat(fields[3])]
            });
        }
        return result;
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

    function colorMatches(a, b) {
        return Math.round(a[0] * 100) === Math.round(b[0] * 100) &&
            Math.round(a[1] * 100) === Math.round(b[1] * 100) &&
            Math.round(a[2] * 100) === Math.round(b[2] * 100);
    }

    function addSwatch(color, label) {
        if (!color) {
            return;
        }
        for (var i = 0; i < swatches.length; i++) {
            if (colorMatches(swatches[i].color, color)) {
                selectedIndex = i;
                rebuildSwatches();
                updateStatus();
                return;
            }
        }
        swatches.push({ name: label || "Swatch", color: color });
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

    function getTargetProperties(layer) {
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
        if (selectedColorProps.length) {
            return selectedColorProps;
        }
        var allProps = getColorPropertiesForLayer(layer);
        if (targetMode === "fill" || targetMode === "stroke") {
            var filtered = [];
            for (var j = 0; j < allProps.length; j++) {
                if (allProps[j] && allProps[j].kind === targetMode) {
                    filtered.push(allProps[j]);
                }
            }
            return filtered;
        }
        return allProps;
    }

    function applyColorToLayer(layer, color) {
        if (!layer || !layer.property || !color) {
            return false;
        }
        var props = getTargetProperties(layer);
        if (!props.length) {
            return false;
        }
        app.beginUndoGroup("Apply vector swatch");
        try {
            for (var i = 0; i < props.length; i++) {
                var entry = props[i];
                if (entry && entry.property && entry.property.canSetExpression) {
                    var prop = entry.property;
                    var value = arrayToColor(color);
                    if (prop.numKeys > 0) {
                        var comp = layer.containingComp;
                        var time = comp ? comp.time : 0;
                        prop.setValueAtTime(time, value);
                    } else {
                        prop.setValue(value);
                    }
                }
            }
        } finally {
            app.endUndoGroup();
        }
        return true;
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
        for (var i = 0; i < layers.length; i++) {
            var layer = layers[i];
            if (layer.matchName === "ADBE Vector Layer") {
                applyColorToLayer(layer, swatches[index].color);
            }
        }
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

        app.beginUndoGroup("Extract palette from layers");
        try {
            for (var i = 0; i < layers.length; i++) {
                var layer = layers[i];
                if (layer.matchName !== "ADBE Vector Layer") {
                    continue;
                }
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
                        if (colorMatches(swatches[k].color, rgb)) {
                            already = true;
                            break;
                        }
                    }
                    if (!already) {
                        var label = layer.name + " " + (entry.kind === "stroke" ? "Stroke" : "Fill");
                        swatches.push({ name: label, color: rgb });
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
            swatches.push({ name: imported[i].name || "ASE Swatch", color: imported[i].color });
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
        var brush = g.newBrush(g.BrushType.SOLID_COLOR, [swatch.color[0], swatch.color[1], swatch.color[2], 1]);
        g.newPath();
        g.rectPath(0, 0, w, h);
        g.fillPath(brush);
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
        // colorize (eyedropper) — used for "extract colors from layers".
        "extract": {
            vb: [0, -960, 960, 960],
            d: "M120-120v-190l358-358-58-56 58-56 76 76 124-124q5-5 12.5-8t15.5-3q8 0 15 3t13 8l94 94q5 6 8 13t3 15q0 8-3 15.5t-8 12.5L705-555l76 78-57 57-56-58-358 358H120Zm80-80h78l332-334-76-76-334 332v78Zm447-410 96-96-37-37-96 96 37 37Zm0 0-37-37 37 37Z"
        },
        // upload — import ASE palette
        "import": { vb: [0, -960, 960, 960], d: "M450-313v-371L330-564l-43-43 193-193 193 193-43 43-120-120v371h-60ZM220-160q-24 0-42-18t-18-42v-143h60v143h520v-143h60v143q0 24-18 42t-42 18H220Z" },
        // backspace — remove selected swatch
        "remove": { vb: [0, -960, 960, 960], d: "m448-326 112-112 112 112 43-43-113-111 111-111-43-43-110 112-112-112-43 43 113 111-113 111 43 43Zm-98 166q-14.25 0-27-6.38-12.75-6.37-21-17.62L80-480l221-296q8.25-11.25 21-17.63 12.75-6.37 27-6.37h472q24.75 0 42.38 17.62Q881-764.75 881-740v520q0 24.75-17.62 42.37Q845.75-160 821-160H350ZM155-480l195 260h471v-520H350L155-480Zm431 0Z" },
        // cancel_presentation — clear all swatches
        "clear": { vb: [0, -960, 960, 960], d: "m358-316 122-122 122 122 42-42-122-122 122-122-42-42-122 122-122-122-42 42 122 122-122 122 42 42ZM140-160q-24 0-42-18t-18-42v-520q0-24 18-42t42-18h680q24 0 42 18t18 42v520q0 24-18 42t-42 18H140Zm0-60h680v-520H140v520Zm0 0v-520 520Z" },
        // dialogs — apply to Fill only (filled square)
        "fill": { vb: [0, -960, 960, 960], d: "M264-264h432v-432H264v432Zm-84 144q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h600q24 0 42 18t18 42v600q0 24-18 42t-42 18H180Zm0-60h600v-600H180v600Zm0-600v600-600Z" },
        // crop_square — apply to Stroke only (outline square)
        "stroke": { vb: [0, -960, 960, 960], d: "M180-120q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h600q24 0 42 18t18 42v600q0 24-18 42t-42 18H180Zm0-60h600v-600H180v600Zm0 0v-600 600Z" },
        // colors — apply to Fill and Stroke
        "both": { vb: [0, -960, 960, 960], d: "M348-138 98-388q-9-9.12-13.5-20.06T80-430.7q0-11.7 4.5-22.5T98-473l250-250-114-114 43-43 406 407q9.47 9 13.74 19.8 4.26 10.8 4.26 22.5t-4.26 22.64Q692.47-397.12 683-388L433-138q-9 9-19.8 13.5t-22.5 4.5q-11.7 0-22.64-4.5Q357.12-129 348-138Zm43-542L141-430h500L391-680Zm408.66 560q-33.35 0-56.5-23.18Q720-166.36 720-200q0-26.28 10-49.64T756-293l44-57 44 57q15 20 25.5 43.36T880-200q0 33.64-23.5 56.82T799.66-120Z" }
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
        } else if (type === "extract") {
            strokeLine(g, pen, cx + 6, cy - 7, cx - 4, cy + 3);
            g.newPath();
            g.rectPath(cx + 4, cy - 9, 5, 5);
            g.strokePath(pen);
            strokeLine(g, pen, cx - 5, cy + 2, cx - 2, cy + 5);
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
            cell.helpTip = swatches[i].name + "\n" + Math.round(swatches[i].color[0] * 255) + "," +
                Math.round(swatches[i].color[1] * 255) + "," + Math.round(swatches[i].color[2] * 255);
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
            hexField.text = rgbToHex(swatches[selectedIndex].color);
        } else {
            hexField.text = "";
        }
    }

    function applyHexToSelected() {
        if (selectedIndex < 0 || !swatches[selectedIndex]) {
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

        var buttons = win.add("group");
        buttons.orientation = "row";
        buttons.alignment = ["fill", "top"];
        buttons.alignChildren = ["left", "center"];
        buttons.spacing = 4;
        makeActionButton(buttons, "add", "Add Color", addColor);
        makeActionButton(buttons, "extract", "Extract colors from selected layers", extractFromLayers);
        makeActionButton(buttons, "import", "Import ASE palette (creates a new palette)", importAse);
        removeBtn = makeActionButton(buttons, "remove", "Remove selected swatch", function () {
            removeSwatch(selectedIndex);
        });
        // Flexible spacer pushes the "clear" button to the right edge.
        var btnSpacer = buttons.add("group");
        btnSpacer.alignment = ["fill", "center"];
        makeActionButton(buttons, "clear", "Clear all swatches in this palette", function () {
            swatches = [];
            selectedIndex = -1;
            saveCurrentPalette();
            rebuildSwatches();
        });

        var titleGroup = win.add("group");
        titleGroup.orientation = "row";
        titleGroup.alignChildren = ["left", "center"];
        titleGroup.spacing = 6;
        titleGroup.add("statictext", undefined, "Palette:");
        titleField = titleGroup.add("edittext", undefined, paletteName);
        titleField.preferredSize = [120, 24];
        titleField.onChange = function () {
            setPaletteName();
        };

        paletteCombo = titleGroup.add("dropdownlist");
        paletteCombo.preferredSize = [120, 24];
        paletteCombo.onChange = function () {
            if (this.selection) {
                switchPalette(this.selection.text);
            }
        };

        var modeGroup = win.add("group");
        modeGroup.orientation = "row";
        modeGroup.alignChildren = ["left", "center"];
        modeGroup.spacing = 8;
        fillIconBtn = modeGroup.add("iconbutton", undefined, undefined, { style: "toolbutton", toggle: true });
        fillIconBtn.mode = "fill";
        fillIconBtn.size = [42, 34];
        fillIconBtn.preferredSize = [42, 34];
        fillIconBtn.helpTip = "Apply to Fill only";
        fillIconBtn.onDraw = drawTargetIcon;
        fillIconBtn.onClick = function () { setTargetMode("fill"); };
        strokeIconBtn = modeGroup.add("iconbutton", undefined, undefined, { style: "toolbutton", toggle: true });
        strokeIconBtn.mode = "stroke";
        strokeIconBtn.size = [42, 34];
        strokeIconBtn.preferredSize = [42, 34];
        strokeIconBtn.helpTip = "Apply to Stroke only";
        strokeIconBtn.onDraw = drawTargetIcon;
        strokeIconBtn.onClick = function () { setTargetMode("stroke"); };
        bothIconBtn = modeGroup.add("iconbutton", undefined, undefined, { style: "toolbutton", toggle: true });
        bothIconBtn.mode = "both";
        bothIconBtn.size = [42, 34];
        bothIconBtn.preferredSize = [42, 34];
        bothIconBtn.helpTip = "Apply to Fill and Stroke";
        bothIconBtn.onDraw = drawTargetIcon;
        bothIconBtn.onClick = function () { setTargetMode("both"); };

        modeGroup.add("statictext", undefined, "Hex:");
        hexField = modeGroup.add("edittext", undefined, "");
        hexField.preferredSize = [90, 24];
        hexField.helpTip = "Hex of the selected swatch (editable)";
        hexField.onChange = function () {
            applyHexToSelected();
        };

        swatchPanel = win.add("group");
        swatchPanel.orientation = "column";
        swatchPanel.alignChildren = ["left", "top"];
        swatchPanel.alignment = ["fill", "fill"];
        swatchPanel.spacing = 2;
        swatchPanel.margins = 0;
        // When the panel itself changes width (e.g. docked panel resized),
        // recompute the column count so swatches re-flow instead of cropping.
        // Guarded by `reflowing` so the layout pass inside rebuildSwatches
        // can't re-enter this handler.
        swatchPanel.onResizing = swatchPanel.onResize = function () {
            if (reflowing) { return true; }
            reflowing = true;
            try { rebuildSwatches(); } catch (eSwR) {}
            reflowing = false;
            return true;
        };

        statusText = __status__;

        function reflowSwatches() {
            if (reflowing) {
                return;
            }
            reflowing = true;
            if (win.layout) {
                win.layout.resize();
            }
            rebuildSwatches();
            reflowing = false;
        }

        win.onResizing = win.onResize = function () {
            reflowSwatches();
            return true;
        };

        loadPalette();
        setTargetMode(targetMode);

        if (win instanceof Window) {
            win.center();
            win.show();
            reflowSwatches();
        } else {
            win.layout.layout(true);
            win.layout.resize();
            reflowSwatches();
        }
        return win;
    }

    buildUI(__host__);
}

})(this);
