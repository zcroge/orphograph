// Shared glyph rendering -- one small module both the wheel canvas and
// the DOM-based keyboard/legend panels draw from, so a real hand-drawn
// letterform (baked from a glyph-studio export, see
// tools/import-glyphs.mjs/src/glyphData.js) renders identically
// wherever it appears. Every function reports "no glyph" for a token
// that hasn't been drawn yet (or was dropped by a later re-import) so
// callers keep their existing plain-text fallback -- nothing breaks for
// an undrawn letter.
import { GLYPH_OUTLINES, GLYPH_BBOX, GLYPH_PIXEL_GRIDS } from "./glyphData.js";

export function hasGlyph(token) {
  return token in GLYPH_OUTLINES;
}

export function glyphBBox(token) {
  return GLYPH_BBOX[token] || null;
}

export function hasPixelGlyph(token) {
  return token in GLYPH_PIXEL_GRIDS;
}

// Canvas path -- draws `token`'s own outline polygons centered at
// (x, y), rotated by `angle` (radians), scaled so the glyph's own
// authoring em (1200 units) maps to `heightPx` on screen. Caller sets
// `ctx.fillStyle` beforehand (or pass `color`) -- this only handles
// geometry, the same division of responsibility view.js's drawRadialGlyph
// already has with its own caller-set ctx.font/fillStyle.
export function drawGlyph(ctx, token, { x, y, angle = 0, heightPx, color } = {}) {
  const outlines = GLYPH_OUTLINES[token];
  if (!outlines) return false;
  const scale = heightPx / 1200;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  if (color) ctx.fillStyle = color;
  for (const outline of outlines) {
    if (outline.length < 3) continue;
    ctx.beginPath();
    ctx.moveTo(outline[0].x, outline[0].y);
    for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i].x, outline[i].y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  return true;
}

// DOM path -- an inline <svg> string, same outline polygons as <path>
// elements. `color` defaults to "currentColor" so it inherits whatever
// color the surrounding button/cell already uses (themes for free, no
// separate light/dark handling needed here). Always frames the FULL
// 1200-unit em-square (viewBox -600,-600,1200,1200 -- outlines are
// already centered on that same origin, see glyphData.js's own header)
// rather than each glyph's own ink bounding box -- every letter then
// sits at its own natural position within one consistent frame, the
// same "every glyph relates to one shared em" convention a real type
// specimen sheet already uses, instead of each button cropping tighter
// or looser depending on how much of the square that particular letter
// happens to fill.
export function glyphSVGMarkup(token, { heightPx, color = "currentColor" } = {}) {
  const outlines = GLYPH_OUTLINES[token];
  if (!outlines) return null;
  const size = Math.max(1, Math.round(heightPx));
  const paths = outlines
    .map((outline) => {
      if (outline.length < 3) return "";
      const d = outline.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") + " Z";
      return `<path d="${d}" fill="${color}"/>`;
    })
    .join("");
  return `<svg width="${size}" height="${size}" viewBox="-600 -600 1200 1200" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
}

// The pixel-font path -- a genuinely blocky bitmap, not the smooth vector
// outline above. Renders GLYPH_PIXEL_GRIDS' own NxN boolean grid (glyph-
// studio's, hand-painted or derived -- see tools/import-glyphs.mjs) as one
// <rect> per lit cell in a 0..N/0..N viewBox (unlike glyphSVGMarkup's
// centered em-square, since the grid itself is already a plain top-left-
// origin bitmap, not font-metric coordinates), with `shape-rendering:
// crispEdges` so it reads as pixel art at small sizes instead of getting
// antialiased into a blur.
//
// `preserveAspectRatio="none"` is deliberate, not an oversight: the input
// backdrop (see main.js's updateInputBackdrop) sizes each glyph's own
// containing box to EXACTLY match that token's character count in
// monospace `ch` units, which is narrower than one square NxN cell for
// every single-character token (a monospace character cell is roughly
// half as wide as it is tall) -- so a square-preserved glyph would get
// silently CROPPED to a sliver by the container's own overflow:hidden.
// Stretching non-uniformly instead keeps every cell of real drawn data
// visible, at the cost of a slightly narrow/tall aspect for single-letter
// tokens -- the same tradeoff a real fixed-width bitmap terminal font
// already makes (an 8x16 VGA cell isn't square either). Width/height
// attributes here are just a sane default for any OTHER caller; the
// input backdrop's own CSS (.pixel-glyph-slot svg) overrides both to
// fill its exact container box.
export function pixelGlyphSVGMarkup(token, { heightPx, color = "currentColor" } = {}) {
  const grid = GLYPH_PIXEL_GRIDS[token];
  if (!grid || grid.length === 0) return null;
  const n = grid.length;
  const size = Math.max(1, Math.round(heightPx));
  const rects = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < grid[row].length; col++) {
      if (grid[row][col]) rects.push(`<rect x="${col}" y="${row}" width="1" height="1" fill="${color}"/>`);
    }
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${n} ${n}" preserveAspectRatio="none" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${rects.join("")}</svg>`;
}
