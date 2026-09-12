#!/usr/bin/env node
// Bakes a glyph-studio backup export (github.com/zcroge/glyph-studio,
// which stores raw {x,y,pressure} vector strokes per letter token) into
// this repo's own src/glyphData.js. A deliberate BAKE, not a live
// cross-repo load: orphograph and glyph-studio are separate,
// independently-deployed public repos (glyph-studio's own data lives in
// the author's browser localStorage, not a file either repo could fetch
// live), so re-run this script by hand whenever a fresh export exists.
//
// Usage: node tools/import-glyphs.mjs path/to/glyph-studio-backup.json
//
// The outline algorithm below is a direct port of glyph-studio's own
// src/vectorPen.js `strokeToOutline` (a pure function, no DOM/canvas
// dependency there either) -- glyph-studio remains the source of truth
// for the algorithm; this is a copy so orphograph's own render path has
// zero runtime dependency on a second repo.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Heavier than glyph-studio's own 24-unit authoring default -- "the
// vector line forms getting a heavier line weight" -- since these are
// rendered small (a wheel-spoke label, a keyboard key), a thicker
// stroke reads far more reliably at that scale than the authoring-space
// weight tuned for a full 1200-unit canvas.
const GLYPH_BAKE_STROKE_WIDTH = 40;
const GRID_CENTER = 600; // glyph-studio's own 1200-UPM grid center

function smoothPoints(points) {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    out.push({ x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3, pressure: b.pressure });
  }
  out.push(points[points.length - 1]);
  return out;
}

function strokeToOutline(points, baseWidth, minWidthFrac = 0.25) {
  const pts = smoothPoints(points);
  if (pts.length === 0) return [];
  if (pts.length === 1) {
    const r = Math.max(2, (baseWidth * (minWidthFrac + (1 - minWidthFrac) * pts[0].pressure)) / 2);
    const c = pts[0];
    const dot = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      dot.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
    }
    return dot;
  }
  const halfWidthAt = (p) => Math.max(1, (baseWidth * (minWidthFrac + (1 - minWidthFrac) * p.pressure)) / 2);
  const left = [], right = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const prev = pts[i - 1] || p, next = pts[i + 1] || p;
    let dx = next.x - prev.x, dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const nx = -dy, ny = dx;
    const hw = halfWidthAt(p);
    left.push({ x: p.x + nx * hw, y: p.y + ny * hw });
    right.push({ x: p.x - nx * hw, y: p.y - ny * hw });
  }
  return [...left, ...right.reverse()];
}

function recenter(outline) {
  return outline.map((p) => ({ x: Math.round((p.x - GRID_CENTER) * 100) / 100, y: Math.round((p.y - GRID_CENTER) * 100) / 100 }));
}

function bbox(outlines) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const outline of outlines) {
    for (const p of outline) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (minX === Infinity) return { width: 0, height: 0 };
  return { width: Math.round((maxX - minX) * 100) / 100, height: Math.round((maxY - minY) * 100) / 100 };
}

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node tools/import-glyphs.mjs path/to/glyph-studio-backup.json");
  process.exit(1);
}
const backup = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const glyphs = backup.glyphs || {};

const outlinesByToken = {};
const bboxByToken = {};
let drawnCount = 0;
for (const [token, rec] of Object.entries(glyphs)) {
  if (!rec.vectorStrokes || rec.vectorStrokes.length === 0) continue;
  const outlines = rec.vectorStrokes
    .map((stroke) => recenter(strokeToOutline(stroke, GLYPH_BAKE_STROKE_WIDTH)))
    .filter((o) => o.length >= 3);
  if (outlines.length === 0) continue;
  outlinesByToken[token] = outlines;
  bboxByToken[token] = bbox(outlines);
  drawnCount++;
}

// Pixel-grid bake -- glyph-studio's backup already carries real 16x16
// boolean grids per token (store.js's own record shape), either hand-
// painted or derived from the vector strokes -- either way it's already a
// finished bitmap, so this is a straight copy, not a second rasterization
// pass. Skipped for a token with no real data (an all-false grid, or no
// grid at all), same "only bake what's actually drawn" bar the vector
// outlines above use.
const pixelGridsByToken = {};
let pixelCount = 0;
for (const [token, rec] of Object.entries(glyphs)) {
  if (!rec.pixelGrid || rec.pixelGrid.length === 0) continue;
  const hasInk = rec.pixelGrid.some((row) => row.some(Boolean));
  if (!hasInk) continue;
  pixelGridsByToken[token] = rec.pixelGrid;
  pixelCount++;
}

const header = `// GENERATED by tools/import-glyphs.mjs from a glyph-studio export
// (github.com/zcroge/glyph-studio) -- do not hand-edit. Re-run the
// script against a fresh backup export to update. Coordinates are
// centered on each glyph's own origin (glyph-studio's grid center,
// 600,600, subtracted out) at the original 1200-unit-per-em scale, so
// every letter's own real proportions survive; a renderer applies one
// shared scale factor (see src/glyphRender.js). Outlines are already
// baked at GLYPH_BAKE_STROKE_WIDTH (see tools/import-glyphs.mjs) -- a
// heavier weight than glyph-studio's own authoring default, since these
// render small (a wheel-spoke label, a keyboard key).
//
// GLYPH_PIXEL_GRIDS is a separate, unrelated representation -- glyph-
// studio's own 16x16 boolean bitmap per token (hand-painted or derived,
// see that repo's pixelGrid.js), copied verbatim (row-major,
// grid[row][col], screen-space y-down). Used for the pixel-font display
// in the phrase input field (see glyphRender.js's pixelGlyphSVGMarkup),
// not the smooth vector rendering GLYPH_OUTLINES/GLYPH_BBOX serve.
`;
const body =
  `export const GLYPH_OUTLINES = ${JSON.stringify(outlinesByToken)};\n\n` +
  `export const GLYPH_BBOX = ${JSON.stringify(bboxByToken)};\n\n` +
  `export const GLYPH_PIXEL_GRIDS = ${JSON.stringify(pixelGridsByToken)};\n`;

const outPath = path.join(__dirname, "..", "src", "glyphData.js");
fs.writeFileSync(outPath, header + "\n" + body);
console.log(`Wrote ${outPath} -- ${drawnCount} of ${Object.keys(glyphs).length} tokens have real outline data, ${pixelCount} have real pixel-grid data.`);
