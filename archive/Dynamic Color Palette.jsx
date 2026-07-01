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

(function vectorColorSwatches(thisObj) {
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
        var picked = $.colorPicker(currentRgb ? rgbToInt(currentRgb) : -1);
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

    function drawTargetIcon(drawState) {
        var g = this.graphics;
        var w = (this.size && this.size[0]) ? this.size[0] : 28;
        var h = (this.size && this.size[1]) ? this.size[1] : 24;
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
        var cx = w / 2;
        var cy = h / 2;
        var col = this.enabled ? [0.86, 0.86, 0.86, 1] : [0.45, 0.45, 0.45, 1];
        var pen = g.newPen(g.PenType.SOLID_COLOR, col, 2);
        var type = this.iconType;
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
            if (swatchPanel.size && swatchPanel.size[0]) {
                available = swatchPanel.size[0];
            } else if (swatchPanel.bounds && swatchPanel.bounds.width) {
                available = swatchPanel.bounds.width;
            }
        }
        var pad = 18;
        if (swatchPanel && swatchPanel.margins && typeof swatchPanel.margins.left === "number") {
            pad = swatchPanel.margins.left + swatchPanel.margins.right + 2;
        }
        available -= pad;
        if (available <= 0) {
            return COLUMNS;
        }
        var cellTotal = CELL + 2;
        var cols = Math.floor((available + 2) / cellTotal);
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
        var win = (root instanceof Panel)
            ? root
            : new Window("palette", SCRIPT_NAME + " v" + SCRIPT_VERSION, undefined, { resizeable: true });
        win.orientation = "column";
        win.alignChildren = ["fill", "top"];
        win.spacing = 8;
        win.margins = 10;

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

        var buttons = win.add("group");
        buttons.orientation = "row";
        buttons.alignChildren = ["left", "center"];
        buttons.spacing = 4;
        makeActionButton(buttons, "add", "Add Color", addColor);
        makeActionButton(buttons, "extract", "Extract colors from selected layers", extractFromLayers);
        makeActionButton(buttons, "import", "Import ASE palette (creates a new palette)", importAse);
        removeBtn = makeActionButton(buttons, "remove", "Remove selected swatch", function () {
            removeSwatch(selectedIndex);
        });
        makeActionButton(buttons, "clear", "Clear all swatches in this palette", function () {
            swatches = [];
            selectedIndex = -1;
            saveCurrentPalette();
            rebuildSwatches();
        });

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

        swatchPanel = win.add("panel", undefined, "Swatches");
        swatchPanel.orientation = "column";
        swatchPanel.alignChildren = ["left", "top"];
        swatchPanel.alignment = ["fill", "fill"];
        swatchPanel.spacing = 2;
        swatchPanel.margins = 8;

        statusText = win.add("statictext", undefined, "0 swatches");

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

    buildUI(thisObj);
})(this);
