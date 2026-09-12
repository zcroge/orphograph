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
// weight tuned for a full 1200-unit canvas. Raised again (40 -> 58) --
// "increasing line weight... for all of the hand-drawn vector style
// glyph forms" -- ~45% heavier still.
const GLYPH_BAKE_STROKE_WIDTH = 58;

// "Normalizing letter heights/alignments" -- real measured baked heights
// ranged from 1069 (I) down to 89 (vowel.horizontal) units, a >12x spread
// even before counting the two smallest as outliers; every OTHER token
// (real letters/ligatures/compounds) still ranged 326-1069, a real >3x
// spread on its own. Each such token is rescaled to share one common
// `max(width, height)` extent -- deliberately the MAX of the two
// dimensions, not height alone: several of the shortest outliers (K,
// OO, ŋ) are already-wide, deliberately horizontal letterforms, and
// scaling those by height alone would blow their width out past 1500
// units. One uniform factor per glyph, so nothing ever stretches.
const NORMALIZE_TARGET_EXTENT = 900;
// The two still-unnamed, unsettled vowel primes -- "leave these two at
// their current small scale, in case their smallness is deliberate."
// Skipped entirely (scale factor 1) while every other token normalizes.
const NORMALIZE_EXEMPT_TOKENS = new Set(["vowel.horizontal", "vowel.nub"]);

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

// Shared min/max walk over any list of outlines (arrays of {x,y} points) --
// used both to measure a glyph's raw stroke centerlines (to derive its
// normalization scale) and its final baked outline (to recenter/report
// GLYPH_BBOX), so the two never drift apart via separate implementations.
function extentOf(outlines) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const outline of outlines) {
    for (const p of outline) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX, minY, maxX, maxY };
}

// Recenters a glyph's own FINAL outline set on its own ink -- the actual
// bounding-box center of what got drawn -- rather than the fixed grid
// constant (600,600) every token used to be centered on regardless of
// where its own strokes actually sat within that grid. Fixes real
// per-glyph alignment drift the fixed-origin approach never corrected,
// for normalized and exempt tokens alike (the two exempt vowel primes
// still get centered here, they just skip the scale step beforehand).
function recenterOnOwnInk(outlines) {
  const { minX, minY, maxX, maxY } = extentOf(outlines);
  if (minX === Infinity) return outlines;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return outlines.map((outline) =>
    outline.map((p) => ({ x: Math.round((p.x - centerX) * 100) / 100, y: Math.round((p.y - centerY) * 100) / 100 }))
  );
}

function bbox(outlines) {
  const { minX, minY, maxX, maxY } = extentOf(outlines);
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

  // Normalization scale, derived from the RAW stroke centerlines (before
  // strokeToOutline expands them) -- so the shared GLYPH_BAKE_STROKE_WIDTH
  // above lands at the same relative weight on every normalized glyph,
  // rather than reading thick on a glyph that got scaled down and thin on
  // one that got scaled up.
  const exempt = NORMALIZE_EXEMPT_TOKENS.has(token);
  const rawExtent = extentOf(rec.vectorStrokes);
  const rawMax = rawExtent.minX === Infinity ? 0 : Math.max(rawExtent.maxX - rawExtent.minX, rawExtent.maxY - rawExtent.minY);
  const scale = exempt || rawMax === 0 ? 1 : NORMALIZE_TARGET_EXTENT / rawMax;
  const scaledStrokes = rec.vectorStrokes.map((stroke) => stroke.map((p) => ({ x: p.x * scale, y: p.y * scale, pressure: p.pressure })));

  const rawOutlines = scaledStrokes
    .map((stroke) => strokeToOutline(stroke, GLYPH_BAKE_STROKE_WIDTH))
    .filter((o) => o.length >= 3);
  if (rawOutlines.length === 0) continue;
  const outlines = recenterOnOwnInk(rawOutlines);
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
// centered on each glyph's OWN final ink -- its own baked outline's
// bounding-box center, not glyph-studio's fixed grid origin -- so every
// letter sits centered on what it actually drew, not on the fixed grid
// cell it happened to be authored inside. Most tokens are also
// uniformly rescaled (their own raw stroke centerlines, before outline
// expansion) so every letter/ligature/compound shares one common
// max(width,height) extent -- "normalizing letter heights/alignments"
// -- except NORMALIZE_EXEMPT_TOKENS (see tools/import-glyphs.mjs),
// which stay at their original authored scale. A renderer applies one
// further shared scale factor on top of this (see src/glyphRender.js).
// Outlines are already baked at GLYPH_BAKE_STROKE_WIDTH (see
// tools/import-glyphs.mjs) -- a heavier weight than glyph-studio's own
// authoring default, since these render small (a wheel-spoke label, a
// keyboard key).
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
