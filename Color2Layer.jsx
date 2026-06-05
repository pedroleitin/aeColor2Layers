// @target after_effects
// =============================================================================
// Color2Layer — After Effects ScriptUI Panel
// v0.3 — hue importance now driven by SOURCE saturation only (was min of source/label),
//        plus stronger hue weighting overall — fixes vibrant orange→Peach and
//        vibrant blue→Lavender mismatches reported on v0.2
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

(function (thisObj) {

  var VERSION = "v0.3";

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

  // RGB → HSL. h in degrees [0, 360), s and l in [0, 1].
  function rgbToHsl(r, g, b) {
    r = r / 255; g = g / 255; b = b / 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var l = (max + min) / 2;
    var h, s;
    if (max === min) {
      h = 0; s = 0;
    } else {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
      else if (max === g) h = ((b - r) / d + 2) * 60;
      else h = ((r - g) / d + 4) * 60;
    }
    return [h, s, l];
  }

  // Distance in HSL space, hue-weighted. v0.2 used `3 × min(satA, satB)`
  // for hue weight, which had a subtle failure mode: when a label was
  // less saturated than expected (e.g. AE's Blue at ~50% saturation), it
  // would drag the hue weight down even for a vibrant source — so vibrant
  // blue (#4894FE, s=99 %) ended up matching pastel Lavender (s=66 %,
  // closer in s/l) instead of Blue (perfect hue match). Same shape:
  // vibrant peach-orange (#FF9C70) matched Peach instead of Orange.
  //
  // v0.3 fix: hue importance reads ONLY the SOURCE color's saturation,
  // and the multiplier is bumped to 8× so a clean hue match overrides
  // s/l mismatches by a wide margin. s/l contribute proportionally less
  // when the source is vibrant (slWeight slides from 1 down to 0.5 as
  // sat rises). Near-grey sources still let s/l drive the match.
  function colorDistance(a, b) {
    var hslA = rgbToHsl(a[0], a[1], a[2]);
    var hslB = rgbToHsl(b[0], b[1], b[2]);
    var dh = Math.abs(hslA[0] - hslB[0]);
    if (dh > 180) dh = 360 - dh;
    dh = dh / 180;
    var ds = hslA[1] - hslB[1];
    var dl = hslA[2] - hslB[2];
    var sourceSat = hslA[1];
    var hueImportance = sourceSat * 8;
    var slWeight = 1 - sourceSat * 0.5;
    var weightedDh = dh * hueImportance;
    return weightedDh * weightedDh + (ds * ds + dl * dl) * slWeight;
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
    var win = (thisObj instanceof Panel)
      ? thisObj
      : new Window("palette", "Color2Layer " + VERSION,
                   undefined, { resizeable: true });

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
        g.foregroundColor = g.newPen(g.PenType.SOLID_COLOR, [0.62, 0.42, 0.95, 1], 1);
      } catch (eC) {}
    }

    // ===== Header =====
    var header = win.add("group");
    header.orientation = "column";
    header.alignment = ["fill", "top"];
    header.alignChildren = ["center", "center"];
    header.spacing = 1;
    header.margins = [0, 6, 0, 8];

    var titleText = header.add("statictext", undefined, "Color2Layer");
    fontBold(titleText, 16);
    colorAccent(titleText);

    var subtitleText = header.add("statictext", undefined,
      VERSION + "  ·  for After Effects");
    colorDim(subtitleText);

    // ===== Options =====
    var optsPanel = win.add("panel", undefined, "Options");
    optsPanel.alignment = ["fill", "top"];
    optsPanel.orientation = "column";
    optsPanel.alignChildren = ["left", "center"];
    optsPanel.margins = [12, 16, 12, 12];
    optsPanel.spacing = 6;

    var includeStrokesCb = optsPanel.add("checkbox", undefined, "Include stroke colors");
    includeStrokesCb.helpTip = "When on, stroke colors are sampled alongside fills. "
      + "Useful for line-art / outline-only icons where the stroke IS the color.";

    // Breathing room before the primary action.
    var spacer = win.add("group");
    spacer.alignment = ["fill", "top"];
    spacer.minimumSize.height = 4;

    // ===== Primary action =====
    var applyBtn = win.add("button", undefined, "Tint selected layers");
    applyBtn.alignment = ["fill", "top"];
    applyBtn.maximumSize.width = 10000;
    applyBtn.preferredSize = [220, 34];
    fontBold(applyBtn, 13);
    applyBtn.helpTip = "Walk each selected shape layer's enabled Fill items, "
      + "compute the mean color, and set the layer's Label color to the "
      + "closest of AE's 16 label presets.";

    // ===== Status area =====
    var statusGroup = win.add("group");
    statusGroup.orientation = "column";
    statusGroup.alignment = ["fill", "bottom"];
    statusGroup.alignChildren = ["fill", "top"];
    statusGroup.spacing = 3;
    statusGroup.margins = [0, 10, 0, 0];

    var statusLabel = statusGroup.add("statictext", undefined, "STATUS");
    fontBold(statusLabel, 10);
    colorDim(statusLabel);

    var statusText = statusGroup.add("statictext", undefined,
      "Select one or more shape layers and click “Tint”.",
      { multiline: true });
    statusText.alignment = ["fill", "fill"];
    statusText.minimumSize.height = 36;

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

      app.beginUndoGroup("Color2Layer: tint labels");
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

  buildUI(thisObj);

})(this);
