// Canvas rendering: the wheel (rings, hub, poles), and three independent
// position markers + hulls, one per ring, drawn at that ring's own radius
// band and color.
//
// Dark-theme rewrite: "spoke and ring marks should circumscribe the
// note-spoke places... this will read better and better represent the
// letter/note-space itself than having wheel spokes always overlapping the
// letters that occupy the space." The long radial spoke lines (hub to rim,
// passing straight through every label) are gone -- each letter-bearing
// (ring, spoke) position is instead framed by its own thin circle, and the
// 12-spoke grid is marked only by short rim ticks that never cross any
// label. Active hulls/cursors are the one deliberately loud thing on the
// page -- vivid, glowing, moving -- against everything else's restraint.
//
// "The 3 shaded rings are too much color... cleaner, more graphically
// satisfying, esoteric/occult-adjacent, lofi digital." The philosophy
// above (active = loud, everything else = quiet) was already the right
// call -- it just wasn't fully executed: the resting structure was ALSO
// tinted three separate ways (a translucent band wash per ring, plus a
// dim per-ring tint on every letter's circumscribing circle), on top of
// the ring hue itself being LAW-declared (00-laws.md/lexicon: given=
// yellow, received=blue, made=green -- see RING_MARKER_COLOR), not an
// arbitrary UI choice this pass is free to erase. So the law stays, but
// it's now spent in exactly one place: the moving cursor/hull, which is
// genuinely the only colored thing on the page at rest. Everything
// structural -- ring boundaries, ticks, circumscribing circles, labels,
// the hull, the hub -- is one warm-neutral (brass/parchment) family at
// different lightness levels instead of three hues plus assorted cool
// grays: engraved line-work over color fills, the actual visual
// difference between an alchemical/astrological chart and a modern UI
// widget, and "lofi digital" in the sense of a genuinely limited palette
// rather than a decorative theme skin.
// "The underlying 2D trace and wheel demarcations should be a little bit
// fainter" -- now that the hull-trail/tracer is a genuinely loud, glowing
// object, the flat structure around it (boundaries, ticks, bezels, the
// master hull) needs to recede further so the trace reads as THE focal
// element, not one bright thing among equals. structureDim/structure/
// structureBright/hull darkened ~25-28% from their prior values; label
// stays as-is (content, not demarcation).
const WHEEL_PALETTE = {
  structureDim: "#2a2620",     // emptiest/faintest structure: dashed placeholder rings
  structure: "#4d463b",        // normal structure: ring boundaries, ticks, circumscribing circles
  structureBright: "#7a6f5c",  // emphasized structure: the two pole ticks only
  label: "#cabfa9",            // letter labels
  labelUnassigned: "#8a7f6c",  // unassigned-letter labels
  emptySpokeNumber: "#726a58", // fallback spoke-number text on a truly empty spoke
};

import { SPOKE_COUNT, RINGS, spokePoint, spokeAngle, isPole, rotateSpoke, GRAND_CONVERGENCE_PULSES } from "./wheel.js";
import { hasGlyph, glyphBBox, drawGlyph } from "./glyphRender.js";

// "Granular parametric control over the visuals now, especially the echo
// settings." Every number here has a real, currently-hardcoded twin
// somewhere in this file's echo/standing-generation machinery -- moved out
// so a live control panel (main.js's wireTimbrePanel, the same pattern
// already driving note/drone timbre) can retune them without a code
// change. See WheelView's own setViewParam.
export const DEFAULT_VIEW_PARAMS = {
  standingMaxGenerations: 20,     // "a greater accumulation of standing echoes visible at a given time"
  standingAdvanceMs: 2800,        // ms to settle into a new rank when pushed by a fresh capture (not a continuous crawl rate -- see captureStandingGeneration)
  standingStep: 0.19,            // radial reach per rank
  standingFadeRate: 0.53,        // exponential decay rate -- lower = longer, more gradual tail
  standingBaseAlpha: 0.45,
  hullEchoLife: 4200,             // one brief pass, both directions -- not a standing/accumulating tunnel
  hullEchoStrength: 0.24,
  // The inward pass travels from outerR down to outerR*(1-hullEchoReach).
  // The live trace's own plane sits at outerR*0.42 (_traceRadius) -- this
  // needs to reach AT LEAST 0.58 for the inward pass to ever genuinely
  // reach it at all (see render()'s own crossing-detection comment and
  // hullCheckpointLife/Strength below); 0.65 gives real margin so it
  // reliably crosses even with the small breathPulse wobble layered on
  // top, rather than the "leave a frozen copy" event silently never
  // firing. Lowering this far enough will suppress that event again --
  // an honest, real consequence of how far the pass actually travels, not
  // a hidden bug.
  hullEchoReach: 1.5,
  // "The white master hull echo should leave a full frozen copy of itself
  // in place when it perfectly overlays the active trace plane, which
  // should linger and fade." Fires the ONE real moment the inward pass
  // above's own live radius actually crosses the trace's own baseRadius
  // (detected in render(), see hullEchoReach's comment) -- a real
  // geometric event, not a per-hit stamp. Deliberately longer-lived than
  // a propagating echo -- a lingering mark, not another ripple.
  hullCheckpointLife: 1000,
  hullCheckpointStrength: 0.43,
  echoHitLife: 1950,
  echoHitStrength: 0.69,
  echoBurstLife: 2650,
  echoBurstStrength: 1,
  echoReachOut: 1.2,
  echoReachIn: 0.28,
  echoFadeExponent: 5,         // >1 = "fade to black more gradually," not an abrupt cutoff
  breathPulseAmount: 0.14,      // "pulsate in scale slightly along with the low drones"
  // Per-ring phase bar -- "a continuous, interval-based timekeeping visual
  // indicator... a white bar that continuously travels around every ring
  // according to its phase." One per ring, real-time, not event-stepped.
  phaseBarArcWidth: 0.35,         // how wide the bar/its echoes are, in spokes
  phaseBarEchoLife: 2050,         // brief -- "won't be too distracting"
  phaseBarEchoStrength: 0.22,
  // "The temporary trace paths... should fade away in a linear fashion as
  // they're drawn" -- see recordVisit/_provisionalSegments. Short on
  // purpose: a merely-passed connection is meant to read as fleeting, not
  // linger anywhere near as long as a real owned segment does.
  provisionalSegmentLife: 950,
  provisionalSegmentStrength: 1.2,
  // "A slight z-space offset between the three [rings], 3d-anaglyph-esque,
  // to allow for ease of differentiation" -- all three rings' persistent
  // trace + standing-tunnel content used to share the EXACT same radius,
  // so overlapping same-spoke content from different rings blended into
  // one indistinct line/mess. A small per-ring radius nudge as a fraction
  // of the shared base radius (see _ringDepthOffset) -- given pulled
  // slightly in, made pushed slightly out, received centered -- lets
  // overlapping content separate into legible parallel traces instead.
  ringDepthOffset: 0.016,
  // "A lot of partial or hit-based echoes only create a fully
  // dissipating, non-stacking, non-incremented echo... we should still
  // push an echo increment into the pattern/stack on these events, but
  // those elements should be more subtle." How much weight a routine
  // per-hit standing-generation push carries, relative to a real
  // synchronizing event's full weight (1) -- see captureStandingGeneration.
  standingHitIncrementStrength: 0.36,
};

// Shortest-arc interpolation between two (possibly fractional) spoke
// positions -- the continuous analog of main.js's own nextTraceHit
// cw/ccw shortest-arc convention, used ONLY by the transform echo below so
// a morph never visibly takes the long way around the wheel.
function lerpSpokeShortest(from, to, t) {
  const diff = ((to - from + SPOKE_COUNT / 2) % SPOKE_COUNT + SPOKE_COUNT) % SPOKE_COUNT - SPOKE_COUNT / 2;
  return from + diff * t;
}

// "When a ring containing letters/numbers rotates, they should follow both
// in position AND rotation." Draws text at (x, y) rotated so its own local
// "up" points radially outward from the wheel's center at `effectiveSpoke`
// -- the exact same spoke value already used to compute (x, y) via
// spokePoint, so a glyph's rotation is always derived from the identical
// position it's drawn at, never a separate signal that could drift out of
// sync. `spokeAngle(effectiveSpoke)` alone is the correct rotation (not
// `spokeAngle(...) - PI/2`, the canvas-shifted angle spokePoint itself
// uses internally) -- verified directly: at spoke 1 (top, angle 0) this is
// 0 (upright, matching today's unrotated default look); at spoke 4 (right)
// it's +90 deg (text's own "up" now points right, i.e., outward); at spoke
// 7 (bottom) it's 180 deg (text reads upside-down, its "up" pointing down,
// i.e., outward) -- genuinely correct at every position, not a
// readability-preserving flip trick, since "rotational ACCURACY" was the
// explicit ask.
function drawRadialText(ctx, text, x, y, effectiveSpoke) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spokeAngle(effectiveSpoke));
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

// Real hand-drawn letterforms (baked from a glyph-studio export, see
// tools/import-glyphs.mjs/src/glyphData.js), sibling to drawRadialText
// above and falling back to it token-by-token for anything not yet
// drawn -- so a phrase mixing drawn and undrawn letters (real today,
// while coverage is partial) reads as glyph+text side by side rather
// than breaking. `tokens` is an array (a single-letter label just
// passes a 1-element array) since a spoke can carry more than one
// letter (e.g. a rotation-twin pair sharing a spoke) -- laid out
// left-to-right and centered as a whole around (x,y), the same overall
// centering `ctx.textAlign = "center"` gave the old joined-string
// version. Caller still sets ctx.font (for the text-fallback path) and
// ctx.fillStyle (used for both text and glyph fill) beforehand, exactly
// as it already did for drawRadialText -- this doesn't touch either.
// A thin "/" still separates adjacent letters sharing one spoke label --
// the same separator the old `letters.join("/")` string always drew --
// regardless of whether either side ends up a real glyph or a text
// fallback, so a still-undrawn pair (most tokens sharing a spoke, while
// coverage is partial) doesn't visually run together the way two bare
// fillText calls back to back would.
const RADIAL_GLYPH_SEP = "/";
function drawRadialGlyph(ctx, tokens, x, y, effectiveSpoke, heightPx) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spokeAngle(effectiveSpoke));
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const PAD = heightPx * 0.15;
  const sepWidth = tokens.length > 1 ? ctx.measureText(RADIAL_GLYPH_SEP).width : 0;
  const widths = tokens.map((t) => (hasGlyph(t) ? (glyphBBox(t).width / 1200) * heightPx : ctx.measureText(t).width));
  const totalWidth = widths.reduce((a, b) => a + b, 0) + (sepWidth + PAD * 2) * Math.max(0, tokens.length - 1);
  let cursorX = -totalWidth / 2;
  tokens.forEach((t, i) => {
    const w = widths[i];
    if (hasGlyph(t)) drawGlyph(ctx, t, { x: cursorX + w / 2, y: 0, heightPx });
    else ctx.fillText(t, cursorX, 0);
    cursorX += w;
    if (i < tokens.length - 1) {
      cursorX += PAD;
      ctx.fillText(RADIAL_GLYPH_SEP, cursorX, 0);
      cursorX += sepWidth + PAD;
    }
  });
  ctx.restore();
}

// Total on-screen width `drawRadialGlyph` above would actually draw
// `tokens` at, in px -- the ctx.measureText(joinedLabel).width
// replacement for anything sizing itself around a label (e.g. the
// unassigned-ring dashed circle below), since a vector glyph has no
// measureText equivalent of its own. Needs the SAME ctx (for the
// text-fallback measurement path and whatever ctx.font is currently
// set) but doesn't draw anything.
function radialGlyphWidth(ctx, tokens, heightPx) {
  const PAD = heightPx * 0.15;
  const sepWidth = tokens.length > 1 ? ctx.measureText(RADIAL_GLYPH_SEP).width : 0;
  const widths = tokens.map((t) => (hasGlyph(t) ? (glyphBBox(t).width / 1200) * heightPx : ctx.measureText(t).width));
  return widths.reduce((a, b) => a + b, 0) + (sepWidth + PAD * 2) * Math.max(0, tokens.length - 1);
}

// Ring hues are law-declared (00-laws.md/lexicon: given=yellow, received=
// blue, made=green) -- identity untouched, pushed to saturated/luminous
// variants here so the ACTIVE hull/cursor per ring reads as the brightest
// thing on a black field, not the pastel-on-white tone tuned previously.
// This is now the ONLY place ring hue appears anywhere in the drawing --
// see WHEEL_PALETTE above for the full "why."
const RING_MARKER_COLOR = {
  // "The yellow color needs to be more of a true yellow than the current
  // orange." #ffcf3d sits at hue ~45 deg (amber/gold, reading as orange
  // against the black field) -- shifted to hue ~54 deg, unmistakably
  // yellow, same luminous full-saturation treatment as the other two.
  given: "#ffe022",
  received: "#34b3ff",
  made: "#3ee87a",
};

// The cyclic transposition ring's own dedicated color -- a 4th concept,
// distinct from the three ring markers above (so it can never be mistaken
// for "made" or "given" moving) -- a cool violet, the one hue elsewhere
// unused on this wheel.
const TRANSPOSITION_MARKER_COLOR = "#b98cff";

// Where each ring's own letter labels sit, as a fraction of that ring's own
// [rFrom, rTo] band (see wheel.js's RINGS) -- near that band's OUTER edge
// rather than dead-center, so a static label doesn't sit directly on top of
// where that ring's own moving position marker renders (ring mid-radius).
const RING_LABEL_BAND_FRACTION = 0.72;

// The original, hand-tuned design this whole file's proportions were
// built against: a 700x700 canvas, margin 94px, outerR 256px (so
// Math.min(cx,cy) was 350). See resize()'s own comment -- every new size
// is expressed as a uniform scale factor against THESE three numbers, so
// growing the wheel is the same picture, uniformly bigger, not a
// re-derivation of its proportions.
const BASE_HALF_EXTENT = 350;
const BASE_OUTER_R = 256;

export class WheelView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this._viewParams = { ...DEFAULT_VIEW_PARAMS };
    // Was 24 (canvas 560x560) -- already over-subscribed even before the
    // transposition ring (unassigned-letter label circles already reached
    // outerR+37, clipping ~13px past the canvas edge at the cardinal
    // spokes -- there was no room left for anything further out at all).
    // Canvas grew to 700x700 (index.html) specifically so this margin could
    // grow to genuinely fit BOTH the existing decorations (~37px) and the
    // new transposition ring/glow beyond them, while keeping outerR --
    // the given ring's own outer edge, and every existing radius that's a
    // fraction of it -- at the EXACT SAME 256px it always was, so nothing
    // about the diagram's own existing size/proportions changes.
    //
    // "It's the focal point of our whole build" -- that 700x700/256px
    // design is now just the BASE case (see BASE_HALF_EXTENT/BASE_OUTER_R
    // above); resize() (below) recomputes everything from the canvas's
    // real current CSS size instead of reading fixed canvas.width/height
    // once here, so the wheel can actually grow (see main.js's
    // ResizeObserver) and stay crisp (real devicePixelRatio-aware backing-
    // store sizing, not a CSS stretch of the same fixed raster) --
    // infrastructure that plainly didn't exist before this round.
    this.resize(canvas.clientWidth || canvas.width, canvas.clientHeight || canvas.height);
    this.masterHull = [];
    this.masterHullLetters = [];
    // "A continuous outer ring that slowly makes a turn per full
    // operation procession cycle, a cyclical readout/record of the
    // letters/notes played." Unlike masterHull (the typed phrase's own
    // KNOWN shape, set once when a phrase loads) or persistentTraceByRing
    // (per-ring, wiped on every given-ring lap), this accumulates live,
    // one entry per REAL sounded note across all three rings (see
    // recordCycleReadoutLetter/main.js's onNoteHit), and ages out on its
    // own -- see the render()-time draw block for the rotation math.
    // { letter, capturedAtPulse } -- capturedAtPulse is the raw,
    // never-wrapping sequencer.masterPulseCount at the moment it was
    // stamped, so "how far around the ring has this drifted" is always
    // just (liveCount - capturedAtPulse), no modular bookkeeping needed
    // at capture time.
    this._cycleReadout = [];
    // "There should be some level of flat-plane persistence to give a
    // readable trace the user can see clearly." Capacity-bound, not time-
    // bound (see setTraceCapacity), stays at the ring's own full base
    // radius (the same flat plane, never shrinking), quiet/dim -- the one
    // stable, always-readable record of what's actually been traced.
    this.persistentTraceByRing = { given: [], received: [], made: [] };
    this._persistentCapacity = WheelView.MAX_PERSISTENT_POINTS;
    // "I only really see the green traces represented in the echoes --
    // make sure all three rings are producing echoes properly." Real bug,
    // root-caused: every echo-spawning path (hit-echo, burst waves,
    // standing-generation snapshots) read its trail from
    // `persistentTraceByRing`, which only ever receives a ring's OWNED
    // hits (recordVisit's own "3 congruent traces" fix, phase history
    // above). `_spawnEcho`/`captureStandingGeneration` both require
    // `trail.length >= 2` -- so any ring whose tier owns few or no
    // letters in a given phrase (a real, common case: letters cluster by
    // place-of-articulation, not evenly across given/received/made) never
    // reaches 2 points and silently never echoes AT ALL, for the entire
    // phrase. This is that separate, always-appended full sweep (every
    // real hit, owned or merely passed) -- exactly what "one whole trace,
    // read three ways" already established every ring geometrically
    // walks -- used ONLY as the echo/standing-generation SOURCE from here
    // on, so every ring's own real activity keeps producing echoes
    // regardless of how sparse its OWNED subset is. persistentTraceByRing
    // itself is untouched -- the solid flat-plane line stays owned-only,
    // preserving the differentiation that fix was for.
    this._ringSweepTrail = { given: [], received: [], made: [] };
    // "The temporary trace paths drawn between two points that don't
    // actually comprise the true trace... currently just vanish
    // immediately... their visual rendering should reflect their
    // transience/provisionality, fading away linearly as they're drawn."
    // One entry per merely-passed (unowned) hit -- see recordVisit --
    // rendered dashed, fading LINEARLY (not eased, unlike everything else
    // in this file) over a short life, then dropped for good. Genuinely
    // temporary: never promoted into persistentTraceByRing, never
    // captured into a standing generation as its own dashed segment --
    // only its ENDPOINT lives on, as an ordinary point in
    // `_ringSweepTrail` above, which is what makes it "reflected
    // accurately" in the next echo without needing every echo to carry a
    // dashed/solid distinction of its own.
    this._provisionalSegments = [];
    // Each ring's own CURRENT real-time phase position (a plain spoke
    // number, continuously updated every render() call from the same
    // hullCursorByRing interpolation the tracer already uses) -- "a
    // continuous, interval-based timekeeping visual indicator... a white
    // bar that continuously travels around every ring according to its
    // phase." Read back by pulsePhaseBarPulse/captureStandingGeneration
    // (both fire OUTSIDE render()) so an echo always spawns from wherever
    // the bar genuinely was as of the most recent frame, never a
    // separately-tracked or stale value.
    this._ringPhaseSpoke = { given: 1, received: 1, made: 1 };
    // Live rim-dial rotation, updated every render() call -- see its own
    // comment where render() sets it. Guarded here so a spawn method
    // called before the first real render() has something sane to freeze.
    this._currentRimOffset = 0;
    // Same idea, per-ring (the bezel/phase-bar's own dials, distinct from
    // the rim) -- a phase-bar echo needs to freeze ITS OWN ring's
    // rotation, not the rim's, since the cursor it echoes rotates with
    // the bezel, not the hull.
    this._currentRingDialOffsets = { given: 0, received: 0, made: 0 };
    // "Luminosity of the projected/receding trace could correspond to
    // note hits or events, to create a continual, subtle and unified
    // visual feedback system." The shared anchor for the two rare,
    // structurally-real events (breath cycle, grand convergence) -- a
    // brief brightness boost, linearly decaying. See pulseFigure.
    this._eventPulse = { amount: 0, startedAt: 0, life: 1 };
    // "Far more frequency in the segments/figures being echoed... make
    // sure all of our trace segments are persistent" -- the persistent
    // layer above (recordVisit) already guarantees this unconditionally,
    // every frame, regardless of anything below. Everything from here down
    // is the MOVING echo layer, now three distinct, deliberately narrow
    // roles rather than one overloaded mechanism:
    //
    // `_echoes` -- short-lived, one-shot radial sweeps. Two real triggers:
    // a `hit` (a real note landing -- "activated letters... echoed
    // backward fully into the echo space... ripple backward through the
    // live trace's plane and into the vanishing point," always INWARD) and
    // a `burst` (a synchronizing event -- breath/convergence/transposition/
    // stage -- several staggered concentric waves, BOTH directions, see
    // pulseFigure). No per-raw-pulse spawning any more -- that was the
    // "too frequent, not meaningful" texture; real note hits and real
    // structural events are the only triggers left.
    this._echoes = [];
    // `_standingGenerations` -- "a standing set of echoes emanating inward
    // and outward... advance incrementally, REPLACING EACH OTHER with each
    // advancement of the wheel/given ring." A real shift register, not a
    // spawn-and-decay list: once per given-ring transform (never per beat
    // -- see captureStandingGeneration, called from main.js's onTraceLoop,
    // the SAME event that steps the rim dial), the CURRENT trace is
    // snapshotted and pushed in as generation 0; every older generation
    // eases one step further out AND one step further in at once (two
    // symmetric echoes per generation), fading with depth -- literally the
    // "one-way mirror... perpetual receding frame of thresholds in time"
    // image from early in this design, now actually built.
    this._standingGenerations = [];
    // `_hullEchoAges` -- the master hull's OWN parallel shift register.
    // Unlike a per-ring generation (which snapshots a growing trail),
    // `masterHull` is fixed for the whole phrase, so only the AGE of each
    // capture needs remembering; render() always draws the CURRENT
    // masterHull/masterHullLetters at each age's own depth. Captured on
    // the exact same real event as the per-ring generations (see
    // captureStandingGeneration) -- "a unified projection," one shared
    // cadence.
    this._hullEchoAges = [];
    // `_transformEchoes` -- "animating an echoing visual transform of the
    // trace, which should help ground and visually represent the
    // transpositions, mirrors and other steps." Each point morphs
    // ANGULARLY (not radially) from its old spoke to its new one -- see
    // spawnTransformEcho/spawnTransposeEcho. A short-lived list; a
    // transposition step or a procession stage crossing is rare.
    this._transformEchoes = [];
    // `_hullFrozenCopies` -- "the white master hull echo should leave a
    // FULL FROZEN COPY of itself in place when it perfectly overlays the
    // active trace plane, which should linger and fade." The hull is
    // otherwise invisible at rest, only ever passing back through
    // visibility as its own brief traveling echo pass (pulseHullEcho) --
    // its INWARD pass genuinely travels from outerR down toward the live
    // trace's own baseRadius; the exact real moment its own radius
    // crosses baseRadius (detected frame-to-frame in render(), a real
    // geometric event, not a guessed timing) is when the WHOLE hull shape
    // (every point, matching what a real overlay actually is, not a
    // per-ring stamp) gets copied here, frozen, to linger and fade on its
    // own -- distinct from the brief travelling pass that spawned it.
    this._hullFrozenCopies = [];
  }

  // Real resize infrastructure -- "make the orphograph display itself
  // larger, it's the focal point of our whole build." Before this round
  // there was none anywhere: the constructor read canvas.width/height
  // ONCE and never again, so changing CSS size alone would just blurrily
  // stretch the same fixed 700x700 raster, no new detail. Called by the
  // constructor once, and by main.js's ResizeObserver on every real size
  // change afterward (window resize, zoom, and -- built so it reuses
  // cleanly -- a future fullscreen mode, since fullscreen is just another
  // container size for that same observer to react to).
  //
  // Real devicePixelRatio-aware backing-store sizing, not a CSS stretch:
  // ONLY canvas.width/height (the backing store, a DOM property -- an
  // integer pixel count for the drawing buffer, not a style) is set here,
  // to cssSize*dpr. A real bug found while building this: setting
  // canvas.style.width/height too seemed harmless (matches the CSS size
  // at the moment it's set) but is NOT -- an inline style always wins
  // over the external stylesheet's own #wheel{width:clamp(...)} rule for
  // every future layout, so the FIRST resize() call would permanently
  // freeze the canvas's on-screen size at whatever it was that one time,
  // silently breaking the whole responsive/shrink-on-narrow-viewport
  // behavior clamp() is there for. CSS alone owns the on-screen box size;
  // this method only ever reads it (via the cssWidth/cssHeight the
  // caller already measured, e.g. main.js's ResizeObserver) and reacts.
  // A single ctx.setTransform(dpr,...) means every existing drawing call
  // (already written in plain CSS-pixel coordinates throughout this
  // file) keeps working completely unchanged; nothing downstream needs
  // to know dpr exists.
  //
  // The scale factor is derived from the ORIGINAL hand-tuned design (a
  // 700x700 canvas, margin 94, outerR 256 -- so Math.min(cx,cy) was 350,
  // see BASE_HALF_EXTENT/BASE_OUTER_R above), not re-derived from
  // scratch, so growing the wheel is the SAME picture, uniformly bigger --
  // every ring/band radius elsewhere in this file is already a fraction
  // of outerR and scales for free; this._scale additionally drives the
  // handful of literal-pixel decorations that don't (label/hull-trace
  // font sizes -- see their own call sites) so those grow with everything
  // else instead of becoming proportionally tinier on a much bigger wheel.
  resize(cssWidth, cssHeight) {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.cx = cssWidth / 2;
    this.cy = cssHeight / 2;
    const scale = Math.min(this.cx, this.cy) / BASE_HALF_EXTENT;
    this._scale = scale;
    this.outerR = scale * BASE_OUTER_R;

    // Precomputed once here (not recomputed inline at every render()
    // call site) -- same values the per-ring spoke-label loop and the
    // hull-trace loops already used as bare literals before this round
    // (16/17px labels, 13px hull trace), just scaled now.
    this._labelHeightPx = 16 * scale;
    this._poleLabelHeightPx = 17 * scale;
    this._hullHeightPx = 13 * scale;
    // Kept small on purpose -- this ring's own free radius band
    // (outerR+73..+94) is narrower than the hull-trace's, and a genuine
    // readout of "everything played this cycle" can carry a lot of
    // simultaneous entries; a modest glyph height keeps it legible
    // without letters overlapping their own neighbors as they drift.
    this._cycleReadoutHeightPx = 12 * scale;
  }

  reset() {
    this.persistentTraceByRing = { given: [], received: [], made: [] };
    this._ringSweepTrail = { given: [], received: [], made: [] };
    this._provisionalSegments = [];
    this.masterHull = [];
    this.masterHullLetters = [];
    this._cycleReadout = [];
    this._hullEchoAges = [];
    this._hullFrozenCopies = [];
    this._eventPulse = { amount: 0, startedAt: 0, life: 1 };
    this._echoes = [];
    this._standingGenerations = [];
    this._transformEchoes = [];
    this._ringPhaseSpoke = { given: 1, received: 1, made: 1 };
  }

  // Same shape as synth.js's setNoteParam/setDroneParam -- a live-tunable
  // numeric knob, written straight into `_viewParams`, read fresh by
  // whichever render/spawn call needs it next frame. Unknown keys are
  // silently ignored (matches the synth.js precedent exactly).
  setViewParam(key, value) {
    if (!(key in this._viewParams)) return;
    this._viewParams[key] = value;
  }

  // Propagating echoes -- two real kinds now, one shared primitive
  // (_spawnEcho). `hit` -- a LOCAL segment (the last few points of that
  // ring's own trail), born on every real note hit, ALWAYS inward --
  // "activated letters... echoed backward fully into the echo space...
  // ripple backward through the live trace's plane and into the vanishing
  // point." `burst` -- born only on a real synchronizing event (breath,
  // convergence, a transposition step, a procession stage crossing -- see
  // pulseFigure), several staggered concentric waves at once, both
  // directions: "higher resolution echo sequences that fully emanate
  // inward and outward... a more powerful ripple/wake." No per-raw-pulse
  // spawning any more -- that was the noisy, not-meaningful texture (see
  // _standingGenerations below for what actually IS continuous and
  // beat-driven now). Only `count` (how many trail points a wave carries)
  // stays a structural constant -- `life`/`strength` are live-tunable, see
  // DEFAULT_VIEW_PARAMS' echoHitLife/echoHitStrength/echoBurstLife/
  // echoBurstStrength. `count: Infinity` is a sentinel meaning "don't trim
  // the trail" (see _spawnEcho's own slice), not a literal used elsewhere.
  static ECHO_COUNT = { hit: 3, burst: Infinity };

  // Hard cap so a long, dense phrase can't grow this unboundedly -- oldest
  // dropped first, same "genuinely closed, not open-ended" discipline as
  // every other bounded collection in this file.
  static ECHO_CAP = 40;

  // `direction`: "in" (toward the hub -- "receding... into the distance")
  // or "out" (toward the frame edge -- "emanating... to the edges").
  // `reach` (0-1) sets how far THIS wave travels -- a burst's several waves
  // each get a different reach, so they read as real concentric ripples at
  // different radii, not one shape. `bornAt` may be given a small future
  // offset by the caller (see pulseFigure) to stagger a burst's own waves
  // so they trail out smoothly rather than all animating in lockstep --
  // `_spawnEcho` treats "not yet born" as simply invisible until reached
  // (see render()'s own alpha guard).
  // `baseR`: the absolute reference radius this echo travels from -- null
  // (default) means "the shared trace baseRadius, computed fresh each
  // frame at render time" (every hit/burst echo). Phase-bar echoes pass a
  // real, fixed value instead (that ring's own outer band edge), since
  // they emanate from the RING's own radius, not the trace's.
  // `rotationAtCapture`: frozen at spawn (defaults to the live rim dial,
  // right for hit/burst echoes -- trace-derived, should match the hull);
  // _spawnPhaseBarEcho overrides it with that ring's OWN dial instead
  // (cursor-derived, should match the bezel it rides on). Either way, an
  // echo's own rotation is fixed the instant it's born and never drifts
  // afterward -- same "old traces remain in their drawn configuration"
  // principle as captureStandingGeneration's own frozen offset.
  _spawnEcho(ring, trail, style, styleKind, direction, reach = 1, bornAt = performance.now(), baseR = null, rotationAtCapture = this._currentRimOffset) {
    if (trail.length < 2) return;
    const spokes = (Number.isFinite(style.count) ? trail.slice(-style.count) : trail).map((v) => v.spoke);
    if (spokes.length < 2) return;
    // "Emanate/recede farther... too static and too contained" -- live
    // tunable (echoReachOut/echoReachIn) so a full-strength echo's real
    // travel distance can be dialed in rather than baked in.
    const vp = this._viewParams;
    const to = direction === "in" ? 1 - reach * vp.echoReachIn : 1 + reach * vp.echoReachOut;
    this._echoes.push({ ring, spokes, styleKind, bornAt, life: style.life, from: 1, to, strength: style.strength, baseR, rotationAtCapture });
    if (this._echoes.length > WheelView.ECHO_CAP) this._echoes.shift();
  }

  // Transform echo -- "animating an echoing visual transform of the trace,
  // which should help ground and visually represent the transpositions,
  // mirrors and other steps as they truly affect the sound and its trace."
  // `fromSpokes`/`toSpokes` are the REAL before/after spoke arrays (main.js
  // computes them from the engine's own rotateSpoke, or reads them directly
  // off transform.js's own already-computed stage data for mirror/rotate/
  // retrograde -- never reimplemented here). Each point morphs ANGULARLY,
  // via shortest-arc, at the trace's own fixed base radius (not traveling
  // in/out -- that depth cue stays reserved for the plain propagating
  // echoes; this one is purely "here is what just happened to these
  // positions").
  spawnTransformEcho(ring, fromSpokes, toSpokes, life = 900, strength = 0.8) {
    if (fromSpokes.length < 2 || fromSpokes.length !== toSpokes.length) return;
    this._transformEchoes.push({ ring, fromSpokes, toSpokes, bornAt: performance.now(), life, strength });
    if (this._transformEchoes.length > 12) this._transformEchoes.shift();
  }

  // Transposition applies UNIFORMLY to all three rings at once (unlike a
  // procession stage, which is per-ring), so this reads its OWN
  // persistentTraceByRing directly rather than main.js passing trails in --
  // "here is what just happened to every ring's own currently-visible
  // trace." `rotateSpoke` is the engine's real transposition operator
  // (wheel.js), the same one audio.setTranspositionOffset's own pitch jump
  // is built on.
  spawnTransposeEcho(deltaSpokes) {
    for (const ring of Object.keys(this.persistentTraceByRing)) {
      const trail = this.persistentTraceByRing[ring];
      if (trail.length < 2) continue;
      const fromSpokes = trail.map((v) => v.spoke);
      const toSpokes = fromSpokes.map((s) => rotateSpoke(s, deltaSpokes));
      this.spawnTransformEcho(ring, fromSpokes, toSpokes, 1400, 0.75);
    }
  }

  // `kind`: which real, structural event this is -- "breath" (the steady,
  // subtle anchor, every breath cycle), "convergence" (the rare, bigger
  // climax -- all three rings aligning on I), "transposition" (a real
  // pitch-offset step), or "stage" (the procession crossing into a
  // mirror/rotate/retrograde stage). "More monumental/grand events... can
  // be given more time to make deliberate, cosmologically proportional
  // motions instead of being hurried" -- life durations now scale with real
  // structural weight (breath, the routine ~10s heartbeat, stays quick and
  // subtle; convergence, the rare ~20s climax, gets the longest, most
  // deliberate decay of all). `burstWaves` -- how many concentric ripples a
  // sync event spawns at once (see pulseFigure): "live transforms should
  // elicit higher resolution echo sequences... a more powerful ripple/wake"
  // -- transposition/stage (a real upheaval of the underlying structure)
  // get more, stronger waves than a routine breath. Drives three things: a
  // brief brightness boost on the trace/tracer (`_eventPulse`), the master
  // hull's own brief traveling echo pass (`hull` weights its strength --
  // see pulseHullEcho), and the burst echoes themselves.
  static PULSE_KIND = {
    breath: { boost: 0.4, boostLife: 550, hull: 0.55, burstWaves: 1 },
    convergence: { boost: 1, boostLife: 1600, hull: 0.9, burstWaves: 3 },
    transposition: { boost: 0.6, boostLife: 1000, hull: 0.7, burstWaves: 4 },
    stage: { boost: 0.75, boostLife: 1100, hull: 0.8, burstWaves: 4 },
  };

  // Milliseconds between each burst wave's own birth -- "velocity-to-echo
  // frequency being a viable and efficient tool to make this... not a
  // jarring departure from the overall echo tunnel effect." Staggering the
  // waves' birth times (rather than spawning all of them at once) makes a
  // burst trail out the way the ambient hit-echo texture already does,
  // instead of reading as one lockstep pulse dropped into the tunnel.
  static BURST_STAGGER_MS = 90;

  pulseFigure(kind = "breath") {
    const w = WheelView.PULSE_KIND[kind] || WheelView.PULSE_KIND.breath;
    const startedAt = performance.now();
    this._eventPulse = { amount: w.boost, startedAt, life: w.boostLife };
    // "Higher resolution echo sequences that will fully emanate inward and
    // outward, just like a full trace echo, but more dynamic and
    // transient, almost like a more powerful ripple/wake" -- `burstWaves`
    // concentric ripples per ring, each reaching a progressively farther
    // radius (`reach`) and staggered in birth time, both directions at
    // once. Strength weighted by this event's own hull weight AND fades
    // wave-to-wave, so the innermost/outermost ripple of a big burst still
    // reads as the loudest.
    const vp = this._viewParams;
    // Sourced from the full sweep -- see `_ringSweepTrail`'s own comment;
    // same reasoning as captureStandingGeneration above.
    for (const ring of Object.keys(this._ringSweepTrail)) {
      const trail = this._ringSweepTrail[ring];
      if (trail.length < 2) continue;
      for (let wave = 0; wave < w.burstWaves; wave++) {
        const reach = (wave + 1) / w.burstWaves;
        const waveStyle = { life: vp.echoBurstLife, strength: vp.echoBurstStrength * w.hull * (1 - wave * 0.12), count: WheelView.ECHO_COUNT.burst };
        const waveBornAt = startedAt + wave * WheelView.BURST_STAGGER_MS;
        this._spawnEcho(ring, trail, waveStyle, "burst", "out", reach, waveBornAt);
        this._spawnEcho(ring, trail, waveStyle, "burst", "in", reach, waveBornAt);
      }
    }
    // "The brief flashes of the trace schematic/blueprint outline should
    // emanate outward, not linger in space" -- fires on EVERY real
    // synchronizing event now (all four kinds), weighted by this event's
    // own real structural weight, same as the burst waves above.
    this.pulseHullEcho(w.hull);
  }

  // "A standing set of echoes emanating inward and outward... advance
  // incrementally, replacing each other" -- but "more continuously
  // advancing outward/receding, with a more clear procession... it's too
  // static and too contained." Two distinct axes, now handled separately:
  // WHEN a new generation is captured (rare, real, event-driven -- see
  // below) vs. HOW each captured generation moves once alive (now a real,
  // continuous, unbounded crawl for as long as it's visible -- no
  // dial/settle/hold at all, just elapsed real time, so it never once
  // reads as parked). "The constant procession of echoes should more
  // accurately reflect the current trace progress" -- captured from
  // `recordVisit` itself, on every real hit across all three rings (not
  // just the much rarer full given-loop wrap/transposition/stage, which
  // could be 20-60+ seconds on a real phrase and read as dead most of the
  // time; still a real content event, still never per raw beat/pulse).
  //
  // "A lot of partial or hit-based echoes only create a fully
  // dissipating, non-stacking, non-incremented echo... we should still
  // push an echo INCREMENT into the pattern/stack on these events,
  // otherwise we end up with blank moments and it destroys the
  // persistent breathing-tunnel effect." Real design gap: this used to
  // fire ONLY on a given-ring OWNED hit -- if a phrase's letters happen
  // to cluster into received/made tiers (a common, real case, same root
  // cause as the "only green echoes" bug), given's own owned hits could
  // be rare-to-nonexistent, so the entire standing tunnel would almost
  // never advance, sitting stale between the much rarer structural
  // events (retireTrace) that also push a capture. Now called on EVERY
  // real hit, any ring, owned or merely passed -- the tunnel keeps
  // continuously breathing/incrementing, never blank. `strengthMult`
  // (defaults to full weight, 1 -- what retireTrace's own structural-
  // event captures still use) lets a routine per-hit push read as
  // genuinely SUBTLER than a real synchronizing event's, so becoming
  // more frequent doesn't also mean becoming more visually loud --
  // stored per-generation and applied at render time (see the standing-
  // tunnel render loop), the same "real events get real weight"
  // convention burst waves/hull echoes already use.
  captureStandingGeneration(strengthMult = 1) {
    const now = performance.now();
    const maxGen = this._viewParams.standingMaxGenerations;
    // "No layering/buildup of standing waves... every echo multiplies
    // itself and they all dissipate simultaneously... an incremental march
    // of wavering, propagating waves, pushed out as each new echo comes to
    // replace it." Root cause of the old pure-elapsed-time model: two
    // captures born close together in real time land at nearly IDENTICAL
    // depths (depth was just age/advanceMs), so a burst of real hits
    // produced a bunched cluster that later faded out together, instead of
    // a genuinely staggered queue. Depth is an authoritative INTEGER rank
    // now -- every existing generation is pushed exactly one rank farther
    // out by every new real capture, guaranteed visual separation
    // regardless of how close together in time two captures happen -- and
    // eases smoothly into its new rank (see _standingDepth) rather than
    // snapping, so the push itself still reads as motion, not a pop.
    for (const gen of this._standingGenerations) {
      gen.depthFrom = this._standingDepth(gen, now);
      gen.rank += 1;
      gen.depthEaseStartedAt = now;
    }
    const snapshot = {};
    // Sourced from the full sweep, not the owned-only persistent line --
    // see `_ringSweepTrail`'s own comment. Otherwise a ring whose tier
    // owns few or no letters in this phrase would never reach 2 points
    // and would silently drop out of every standing generation entirely.
    for (const ring of Object.keys(this._ringSweepTrail)) {
      const trail = this._ringSweepTrail[ring];
      if (trail.length >= 2) snapshot[ring] = trail.map((v) => v.spoke);
    }
    if (Object.keys(snapshot).length > 0) {
      // "Old traces remaining in their played/drawn configuration" -- a
      // generation freezes the LIVE rim rotation at the moment it's
      // captured (`rimOffsetAtCapture`), not the ever-changing current
      // one. Without this, history would keep silently re-rotating to
      // match whatever transposition state is true NOW, which is exactly
      // the kind of drift this whole fix exists to prevent -- a snapshot
      // of the past should stay anchored to the past.
      this._standingGenerations.unshift({ snapshot, rank: 0, depthFrom: -1, depthEaseStartedAt: now, rimOffsetAtCapture: this._currentRimOffset, strengthMult });
      if (this._standingGenerations.length > maxGen) this._standingGenerations.pop();
    }
    // "[Phase bars] emanate echoes... inward at diagram-echo-level
    // intervals" -- the SAME real cadence as everything else in the
    // tunnel (this method's own trigger), one inward pulse per ring, from
    // wherever that ring's own phase bar currently is.
    for (const ring of Object.keys(this._ringPhaseSpoke)) {
      this._spawnPhaseBarEcho(ring, "in");
    }
  }

  // "The time cursors' echoes should directly reference their true shape
  // and orientation/position, not an arbitrary horizontal bar." Real bug:
  // this used to build a two-point TANGENTIAL arc (`{spoke: spoke-width},
  // {spoke: spoke+width}`) and hand it to the same trail-of-spokes-at-one-
  // radius renderer hit/burst echoes use -- which draws a short horizontal-
  // ish chord across neighboring spokes, nothing like the cursor's own
  // actual shape (a RADIAL line spanning this ring's full band, tip to
  // hub-ward edge). Fixed by giving the phasebar kind its own geometry --
  // one spoke plus that ring's own [rFrom, rTo] band -- and its own render
  // branch (see render()) that draws the SAME radial-line shape as the
  // live cursor, scaled as a rigid unit toward/away from center as it
  // propagates, instead of reusing the tangential-arc shape built for a
  // curved trace segment. `direction`: "out" on a real time-based event (a
  // spoke pass, or a reversal -- see pulsePhaseBarPulse/
  // pulsePhaseBarReversal below) or "in" at diagram-echo-level intervals
  // (captureStandingGeneration, above). `strengthMult` scales brightness;
  // `widthMult` now scales the radial line's own stroke THICKNESS (there's
  // no tangential "width" left to widen) so a reversal still reads as a
  // distinctly bigger moment than a routine spoke pass.
  _spawnPhaseBarEcho(ring, direction, strengthMult = 1, widthMult = 1) {
    const spoke = this._ringPhaseSpoke[ring];
    if (spoke == null) return;
    const ringDef = RINGS.find((r) => r.name === ring);
    if (!ringDef) return;
    const vp = this._viewParams;
    const to = direction === "in" ? 1 - vp.echoReachIn : 1 + vp.echoReachOut;
    this._echoes.push({
      ring, styleKind: "phasebar", spoke, ringFrom: ringDef.rFrom, ringTo: ringDef.rTo,
      bornAt: performance.now(), life: vp.phaseBarEchoLife, from: 1, to,
      strength: vp.phaseBarEchoStrength * strengthMult, widthMult,
      // Freezes THIS ring's own dial (not the rim) -- the cursor it echoes
      // rides on the bezel, not the hull.
      rotationAtCapture: this._currentRingDialOffsets[ring] || 0,
    });
    if (this._echoes.length > WheelView.ECHO_CAP) this._echoes.shift();
  }

  // Called from main.js's onPulse -- one real raw pulse IS this ring's own
  // spoke pass (RingRunner.advance: a pulse is genuinely one spoke step),
  // so an outward echo here is a real, routine tick, kept subtle.
  pulsePhaseBarPulse(ring) {
    this._spawnPhaseBarEcho(ring, "out");
  }

  // Called from main.js's onDirectionReversal -- a real, comparatively
  // rare event (this ring's own sweep direction genuinely flipping), so
  // its echo reads as a distinctly bigger moment than a routine spoke
  // pass: stronger and wider, the same "real events get real weight"
  // convention as everywhere else in this file.
  pulsePhaseBarReversal(ring) {
    this._spawnPhaseBarEcho(ring, "out", 2.2, 2.5);
  }

  // "The brief flashes of the trace schematic/blueprint outline should
  // emanate outward, not linger in space... all trace marks/hulls are
  // contained within the same space-time-tunnel continuum and should
  // reflect that cohesively." A real correction: the master hull (the
  // whole-phrase blueprint, fixed and static -- never "in motion" the way
  // a ring's own actively-growing trace is) doesn't get a standing,
  // accumulating shift register like the per-ring tunnel above -- just ONE
  // brief one-shot pass, BOTH directions, genuinely traveling (not a
  // stationary brightness flash), spawned on every real synchronizing
  // event (see pulseFigure) or a full-trace/transform completing (see
  // retireTrace). `strengthMult` lets a real event's own structural weight
  // (PULSE_KIND's `hull`) carry through to how bright this specific pass
  // reads, the same convention burst waves already use.
  pulseHullEcho(strengthMult = 1) {
    if (this.masterHull.length < 2) return;
    const vp = this._viewParams;
    const now = performance.now();
    // Frozen at spawn, same "old traces remain in their drawn
    // configuration" principle as every other echo -- this pass shows the
    // trace as it WAS at this real moment, not silently re-rotating with
    // whatever the live rim dial does during its own ~2s flight.
    const rimOffsetAtCapture = this._currentRimOffset;
    // "The white master hull echo should leave a full frozen copy of
    // itself in place when it perfectly overlays the active trace plane,
    // which should linger and fade." Not spawned here -- the "in"
    // direction pass above genuinely travels from outerR down toward the
    // trace's own baseRadius over its life; the render loop tracks that
    // pass's own live radius frame to frame and fires the frozen copy at
    // the exact moment it actually crosses baseRadius (a real geometric
    // event, not a guess at timing) -- see render()'s own hull-echo block.
    this._hullEchoAges = [
      { bornAt: now, life: vp.hullEchoLife, direction: "out", strengthMult, rimOffsetAtCapture },
      { bornAt: now, life: vp.hullEchoLife, direction: "in", strengthMult, rimOffsetAtCapture, _crossedTracePlane: false, _lastR: null },
    ];
  }

  // "A full-trace or transform should propagate out and erase the
  // completed trace within the active draw plane." Called when a real
  // pass or transform completes (given's own full loop, a transposition
  // step) -- captures everything CURRENTLY on the flat plane into the
  // tunnel (the same real snapshot captureStandingGeneration already
  // takes), fires the master hull's own brief echo pass (covers the one
  // real case with no accompanying pulseFigure call -- a given-loop
  // completing while transposition is off), then clears the flat plane so
  // the next segment reads as genuinely fresh rather than an
  // ever-thickening overlay of every hit since Play. Harmless to also fire
  // alongside pulseFigure's own call for the same event -- pulseHullEcho
  // overwrites `_hullEchoAges` wholesale rather than appending, so a
  // near-simultaneous double call just restarts the same one pass, not two.
  retireTrace() {
    this.captureStandingGeneration();
    this.pulseHullEcho();
    this.persistentTraceByRing = { given: [], received: [], made: [] };
  }

  // Same idea, scoped to ONE ring -- a procession stage crossing happens
  // per-ring, asynchronously (each ring's own playhead reaches it at its
  // own pace), so clearing all three would wipe out the other rings'
  // still-in-progress traces for no real reason. Still captures the FULL
  // current state of all three into the tunnel (more context is free),
  // just only clears the one ring whose stage actually just changed.
  retireRingTrace(ring) {
    this.captureStandingGeneration();
    this.persistentTraceByRing[ring] = [];
  }

  // Eased settle toward the authoritative integer `rank` -- same settle
  // shape as every other dial in this engine. At rank 0, fresh depthFrom
  // -1 means both the outward and inward instances sit exactly at the live
  // trace's own radius (invisible against it); each subsequent push eases
  // from wherever it currently was toward its new rank, so the march is
  // visibly a push, not a teleport.
  _standingDepth(gen, now) {
    const t = Math.min(1, (now - gen.depthEaseStartedAt) / this._viewParams.standingAdvanceMs);
    const eased = 1 - Math.pow(1 - t, 3);
    return gen.depthFrom + (gen.rank - gen.depthFrom) * eased;
  }

  // Every ring's own trail shares ONE base radius -- "the direct overlap
  // between the rings at the same scale should give interesting results."
  // Independent of RINGS on purpose: the glyph bands are compressed into
  // the outer rim (wheel.js's RINGS, 0.76-1.0) to "circumscribe an empty
  // circular space" -- this sits well inside that open field.
  _traceRadius() {
    return this.outerR * 0.42;
  }

  // See DEFAULT_VIEW_PARAMS' own ringDepthOffset comment -- a small,
  // fixed per-ring fraction (given negative/inward, received zero/
  // centered, made positive/outward) applied to whatever shared radius a
  // multi-ring layer is about to draw at, so same-spoke content from
  // different rings separates into legible parallel traces instead of
  // blending into one line.
  static RING_DEPTH_SIGN = { given: -1, received: 0, made: 1 };
  _ringDepthRadius(baseRadius, ring) {
    const sign = WheelView.RING_DEPTH_SIGN[ring] ?? 0;
    return baseRadius * (1 + sign * this._viewParams.ringDepthOffset);
  }

  // Master hull -- the whole typed phrase's own shape, every non-rest
  // letter connected in order, regardless of which ring actually voices
  // it. A word whose letters happen to disperse across all three tiers can
  // leave every PER-RING hull with too few points of its own to draw
  // anything (each ring might get only one letter from it) -- this
  // guarantees a real shape is always visible for what was typed. Unlike
  // the per-ring hulls (built live from real sound events as playback
  // unfolds), this is a property of the INPUT itself, fully known the
  // instant a phrase is loaded -- so it's set once, statically, rather than
  // accumulated pulse by pulse. Precedented directly by sequencer.js's own
  // wordArc, which already treats a word as one continuous path through
  // every letter in order, independent of ring -- this just draws that
  // same path instead of only using it for timing.
  setMasterHull(spokes, letters = []) {
    this.masterHull = spokes;
    // "The trace template (white/dashed-line blueprint) propagate an echo
    // back into space, along with the activated corresponding glyphs, all
    // as a unified projection." Parallel to `spokes`, same order -- used
    // only by the hull-echo render pass (see captureStandingGeneration /
    // _hullEchoAges) to draw each receding shell's own letters, not just
    // its bare geometry.
    this.masterHullLetters = letters;
  }

  // "A cyclical readout/record of the letters/notes played" -- called
  // once per REAL sounded note (main.js's onNoteHit, the same condition
  // that gates audio.playNote itself, deliberately not the "every ring,
  // owned or merely passed" recordVisit hook -- a shared trace's content
  // is hit by all three tempo-offset rings, so hooking there would
  // triple-stamp one conceptual note). Just appends -- the render()-time
  // draw block below is what ages entries out and drops them, this
  // method doesn't need to know anything about that lifecycle.
  recordCycleReadoutLetter(letter, capturedAtPulse) {
    this._cycleReadout.push({ letter, capturedAtPulse });
  }

  // "The trace should also be less persistent... not just a constantly
  // washed-out white outline" -- and still "isn't fading nearly as quick
  // as it should." Cut again (18 -> 12 default, 64 -> 40 cap) -- main.js's
  // Play handler still calls setTraceCapacity with the phrase's own real
  // length, but clamped tighter still, so the persistent layer stays a
  // genuinely recent record.
  static MAX_PERSISTENT_POINTS = 12;

  setTraceCapacity(n) {
    this._persistentCapacity = Math.min(40, Math.max(WheelView.MAX_PERSISTENT_POINTS, n || 0));
  }

  // "3 congruent traces being made overtop of one another... redundant
  // and uninformative." Real structural cause, not just a decay-rate
  // issue: "one whole trace, read three ways" had every ring recording
  // the COMPLETE phrase (owned hits and merely-passed ones alike), so all
  // three persistent traces ended up showing nearly the same shape at the
  // same shared radius. Fixed by specializing: the persistent layer now
  // only records a ring's own OWNED hits (the letters that ring actually
  // voices) -- three genuinely different shapes per ring, since tiers
  // assign different letters to different rings. "The whole phrase" is
  // still shown -- that's what masterHull (the dashed outer-rim outline,
  // set once per phrase) is actually for; this is no longer duplicating it
  // three times.
  recordVisit(ring, spoke, owned = true) {
    const persistent = this.persistentTraceByRing[ring];
    // See `_ringSweepTrail`'s own comment (constructor) -- every real hit,
    // owned or not, so this ring's echo/standing-generation activity never
    // silently goes dark just because its tier owns few or no letters in
    // this particular phrase.
    const sweep = this._ringSweepTrail[ring];
    const previousSweepPoint = sweep.length ? sweep[sweep.length - 1] : null;
    sweep.push({ spoke });
    if (sweep.length > this._persistentCapacity) sweep.shift();
    if (owned) {
      persistent.push({ spoke });
      if (persistent.length > this._persistentCapacity) persistent.shift();
    } else if (previousSweepPoint) {
      // "The temporary trace paths drawn between two points that don't
      // actually comprise the true trace... currently just vanish
      // immediately on being fully drawn... their visual rendering should
      // reflect their transience/provisionality, fading away linearly as
      // they're drawn." The connecting segment this merely-passed hit just
      // swept through -- provisional because it never earns a place in
      // the solid persistent line above, but it DID just genuinely
      // happen, so it gets an honestly-temporary mark of its own instead
      // of nothing at all. See render()'s own dashed, linear-fade branch.
      this._provisionalSegments.push({
        ring, fromSpoke: previousSweepPoint.spoke, toSpoke: spoke,
        bornAt: performance.now(), life: this._viewParams.provisionalSegmentLife,
      });
      if (this._provisionalSegments.length > 24) this._provisionalSegments.shift();
    }
    // "Every hit (even percussion hits) should be reflected by an
    // echo/emanation of some kind, with each echo always being a fresh,
    // accurate representation of the current state." Spawns regardless of
    // `owned` now -- a passed/ghost letter still fires a real percussion
    // hit (main.js's onNoteHit/onChordHit call audio.playPercussionHit
    // unconditionally), so it gets a real echo too. Drawn from this ring's
    // own full sweep (not the owned-only persistent line -- see
    // `_ringSweepTrail`) so it's never starved for lack of owned points --
    // "activated letters... echoed backward fully into the echo space...
    // ripple backward... into the vanishing point," always inward.
    const vp = this._viewParams;
    this._spawnEcho(ring, sweep, { life: vp.echoHitLife, strength: vp.echoHitStrength, count: WheelView.ECHO_COUNT.hit }, "hit", "in");
    // "A cohesive approach to our incremental echo/standing wave pattern
    // -- hit-based echoes should still push an increment into the
    // pattern/stack, more subtly, otherwise we end up with blank moments
    // and it destroys the persistent breathing-tunnel effect." Every real
    // hit, any ring, owned or merely passed -- see
    // captureStandingGeneration's own comment for the full "why" (this
    // used to be given-owned-only, which could stay silent for the whole
    // phrase if given's tier rarely owns anything).
    this.captureStandingGeneration(vp.standingHitIncrementStrength);
  }

  render({ ringLabelsAtSpoke, transposition, hullCursorByRing, ringHitFlash, masterRotationOffset, ringDialOffsets, droneBreathHz = 0, masterPulseCount = 0 }) {
    const { ctx, cx, cy, outerR } = this;
    const scale = this._scale;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Ring boundaries -- engraved lines, not a color wash. Drawn at each
    // UNIQUE radius (adjacent rings share a boundary) rather than three
    // independent filled bands, since the fill was the actual "too much
    // color" -- radius alone already tells given/received/made apart, the
    // way concentric rings on an astrological chart do.
    const ringBoundaries = [...new Set(RINGS.flatMap((r) => [r.rFrom, r.rTo]))];
    ctx.strokeStyle = WHEEL_PALETTE.structureDim;
    ctx.lineWidth = 1;
    for (const rFrac of ringBoundaries) {
      ctx.beginPath();
      ctx.arc(cx, cy, outerR * rFrac, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 12-spoke reference grid -- short rim ticks only, never crossing a
    // ring band or a label (the long hub-to-rim lines this replaced always
    // ran straight through whichever letters sat on that spoke). The two
    // poles (I, O) get a longer, brighter tick, the way a chart marks its
    // own cardinal axis; a second, fainter tick at each spoke MIDPOINT
    // marks house boundaries between them, the standard astrological-wheel
    // convention this diagram otherwise already resembles structurally.
    for (let s = 1; s <= SPOKE_COUNT; s++) {
      const tickIn = spokePoint(s, outerR + 2, cx, cy);
      const tickOut = spokePoint(s, outerR + (isPole(s) ? 10 : 6), cx, cy);
      ctx.beginPath();
      ctx.moveTo(tickIn.x, tickIn.y);
      ctx.lineTo(tickOut.x, tickOut.y);
      ctx.strokeStyle = isPole(s) ? WHEEL_PALETTE.structureBright : WHEEL_PALETTE.structure;
      ctx.lineWidth = isPole(s) ? 2 : 1;
      ctx.stroke();

      const midIn = spokePoint(s + 0.5, outerR - 8, cx, cy);
      const midOut = spokePoint(s + 0.5, outerR, cx, cy);
      ctx.beginPath();
      ctx.moveTo(midIn.x, midIn.y);
      ctx.lineTo(midOut.x, midOut.y);
      ctx.strokeStyle = WHEEL_PALETTE.structureDim;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // The outer procession ring -- "the rotating rim should probably stay
    // static and only advance/rotate to its new transpose state/offset on
    // the transpose or given step." Genuinely circumscribed (two boundary
    // arcs, not a bare line) and divided into its own 12 segments the same
    // way the letter rings below are, each inscribed with its spoke number
    // in the wheel's own fixed canonical order. Rotates on
    // `masterRotationOffset` -- main.js's rim DIAL, which holds perfectly
    // still and steps (with an eased settle) only on the given ring's own
    // trace loop, not a continuous per-frame spin. Kept entirely separate
    // from the transposition ring just below -- that one shows the
    // interpolated PITCH offset itself; this one shows the given-ring's own
    // step mechanism.
    {
      const ringIn = outerR + 14;
      const ringOut = outerR + 26;
      const ringMid = (ringIn + ringOut) / 2;
      const offset = masterRotationOffset || 0;
      ctx.strokeStyle = WHEEL_PALETTE.structure;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, ringIn, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, ringOut, 0, Math.PI * 2);
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let s = 1; s <= SPOKE_COUNT; s++) {
        const divIn = spokePoint(s + 0.5 - offset, ringIn, cx, cy);
        const divOut = spokePoint(s + 0.5 - offset, ringOut, cx, cy);
        ctx.beginPath();
        ctx.moveTo(divIn.x, divIn.y);
        ctx.lineTo(divOut.x, divOut.y);
        ctx.strokeStyle = WHEEL_PALETTE.structureDim;
        ctx.lineWidth = 1;
        ctx.stroke();

        const labelP = spokePoint(s - offset, ringMid, cx, cy);
        ctx.font = "9px sans-serif";
        ctx.fillStyle = WHEEL_PALETTE.label;
        drawRadialText(ctx, String(s), labelP.x, labelP.y, s - offset);
      }
    }

    // The cyclic transposition ring -- circumscribing the outermost (given)
    // ring, denoting the transposition state/offset/modal shift currently
    // at play. A thin static track (always visible, faint, so its own
    // "home" position -- offset 0, spoke 1 -- reads as a real reference
    // circle) plus one glowing marker revolving to the CURRENT offset,
    // gradually -- `transposition.offset` arrives already interpolated
    // (main.js's transpositionGlideProgress, the same time-based idiom as
    // the hull cursor below), so this draws a snapshot, it doesn't animate
    // anything itself.
    const transpositionRadius = outerR + 55;
    ctx.beginPath();
    ctx.arc(cx, cy, transpositionRadius, 0, Math.PI * 2);
    ctx.strokeStyle = WHEEL_PALETTE.structureDim;
    ctx.lineWidth = 1;
    ctx.stroke();
    if (transposition) {
      const p = spokePoint(1 + transposition.offset, transpositionRadius, cx, cy);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.shadowColor = TRANSPOSITION_MARKER_COLOR;
      ctx.shadowBlur = 12;
      ctx.fillStyle = TRANSPOSITION_MARKER_COLOR;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
    }

    // The cycle-readout ring -- "a continuous outer ring that slowly
    // makes a turn per full operation procession cycle, a cyclical
    // readout/record of the letters/notes played." A real rotating
    // record, not a fill-then-reset gauge: every entry is stamped at a
    // fixed write-head position (spoke 1, the wheel's own pole) the
    // instant it's played (see recordCycleReadoutLetter), then visually
    // drifts clockwise away from that head as time passes, completing
    // exactly one lap over exactly one grand-convergence cycle
    // (wheel.js's GRAND_CONVERGENCE_PULSES, a fixed 20.0s at the locked
    // 72 BPM anchor) before arriving back at the head and being dropped
    // -- a genuine rolling window onto "what's just been played," always
    // current, never a hard cut. This is the "stable record" palette
    // (WHEEL_PALETTE.label), not the bright active/echo one (#f4ead0) --
    // a quiet, always-legible readout, same visual role
    // persistentTraceByRing already plays for its own per-ring trace,
    // just unified across all three rings and rim-mounted instead.
    {
      const cycleReadoutRadius = outerR + 82 * scale;
      // Static track, always visible -- same "a real lane exists here
      // even when nothing's on it" treatment the transposition ring's
      // own track uses just above.
      ctx.beginPath();
      ctx.arc(cx, cy, cycleReadoutRadius, 0, Math.PI * 2);
      ctx.strokeStyle = WHEEL_PALETTE.structureDim;
      ctx.lineWidth = 1;
      ctx.stroke();
      // The write head itself -- a small fixed tick at spoke 1, not a
      // glowing marker (this isn't an active cursor, just where new
      // content currently appears).
      const headIn = spokePoint(1, cycleReadoutRadius - 4 * scale, cx, cy);
      const headOut = spokePoint(1, cycleReadoutRadius + 4 * scale, cx, cy);
      ctx.beginPath();
      ctx.moveTo(headIn.x, headIn.y);
      ctx.lineTo(headOut.x, headOut.y);
      ctx.strokeStyle = WHEEL_PALETTE.structure;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.font = `${this._cycleReadoutHeightPx}px sans-serif`;
      ctx.fillStyle = WHEEL_PALETTE.label;
      this._cycleReadout = this._cycleReadout.filter((entry) => {
        const elapsedPulses = masterPulseCount - entry.capturedAtPulse;
        if (elapsedPulses >= GRAND_CONVERGENCE_PULSES) return false;
        const screenSpoke = 1 + (elapsedPulses / GRAND_CONVERGENCE_PULSES) * SPOKE_COUNT;
        // Graceful fade over the last ~15% of the lap, approaching the
        // write head, rather than an abrupt disappearance -- the same
        // fade shape (Math.pow(1-t, exponent)) the hull's own frozen
        // copies already use.
        const lifeFrac = elapsedPulses / GRAND_CONVERGENCE_PULSES;
        const fadeStart = 0.85;
        const alpha = lifeFrac <= fadeStart ? 1 : Math.pow(1 - (lifeFrac - fadeStart) / (1 - fadeStart), 2);
        ctx.globalAlpha = alpha;
        const p = spokePoint(screenSpoke, cycleReadoutRadius, cx, cy);
        drawRadialGlyph(ctx, [entry.letter], p.x, p.y, screenSpoke, this._cycleReadoutHeightPx);
        ctx.globalAlpha = 1;
        return true;
      });
    }

    // Engraved-bezel segment dividers -- "the rings and their symbol
    // registers should be circumscribed rings, not concentric rings of
    // circular planetary objects." A per-letter circumscribing circle made
    // each letter read as its own floating, orbiting object; this is the
    // actual fix -- each ring drawn as ONE coherent bounded band, divided
    // into all 12 of its own canonical segments (populated or not, so it
    // reads as a complete bezel, not just where content happens to sit --
    // the same "explained emptiness reads as design" principle already
    // governing this diagram), with letters inscribed IN their segment
    // rather than each wearing its own circle.
    // "Each successive concentric ring should travel at their own
    // prescribed rate, like an orrery being adjusted." Only the bezel's own
    // divisions rotate, per ring, by that ring's own dial offset
    // (main.js's ringDialOffsets -- discretely stepped on that ring's real
    // pulses, eased between steps, never continuous) -- the letters
    // themselves stay fixed just below (they're the alphabet being read
    // against, not part of the turning mechanism), so this reads as a
    // rotating gear-band behind a static zodiac, the same relationship a
    // real orrery or astrolabe has between its dial and its fixed scale.
    for (const ring of RINGS) {
      const rIn = outerR * ring.rFrom;
      const rOut = outerR * ring.rTo;
      const ringOffset = ringDialOffsets?.[ring.name] || 0;
      ctx.strokeStyle = WHEEL_PALETTE.structureDim;
      ctx.lineWidth = 1;
      for (let s = 1; s <= SPOKE_COUNT; s++) {
        const divIn = spokePoint(s + 0.5 - ringOffset, rIn, cx, cy);
        const divOut = spokePoint(s + 0.5 - ringOffset, rOut, cx, cy);
        ctx.beginPath();
        ctx.moveTo(divIn.x, divIn.y);
        ctx.lineTo(divOut.x, divOut.y);
        ctx.stroke();
      }
    }

    // "The letters still need to be properly rotated according to their
    // position on their ring... each ring's trace can follow its
    // corresponding ring-character diagram sibling in its motion through
    // transposition/transformation." Letters now follow the SAME per-ring
    // dial (`ringDialOffsets`) the bezel divisions just used -- both are
    // now driven by the same real transposition events (see main.js's
    // onTraceLoop), just arriving at their own ring's tempo-relative pace.
    // A letter therefore stays visually locked to its own ring's bezel
    // segment (bezel + letters + that ring's own drawn trace all reading
    // as one coherent, moving unit), not a separately-paced signal.
    // Unassigned/empty-spoke content has no ring to inherit from, so it
    // follows the outer rim's own dial instead -- the nearest ring it's
    // actually drawn beside. Reused below for the master hull too (see its
    // own comment) -- same rim dial, same real transposition-event trigger.
    const rimOffset = masterRotationOffset || 0;
    // "They shouldn't be allowed to drift" -- stored on `this` so
    // captureStandingGeneration/_spawnEcho/pulseHullEcho (all called from
    // OUTSIDE render(), e.g. from recordVisit) can freeze the rotation
    // that was genuinely live at the moment something is captured, rather
    // than reading a stale value or none at all.
    this._currentRimOffset = rimOffset;
    // Same freezing purpose as _currentRimOffset above, but per-ring --
    // read fresh from the SAME ringDialOffsets param the bezel/letters
    // loop below uses, so it can never drift from what's actually drawn.
    for (const ring of RINGS) {
      this._currentRingDialOffsets[ring.name] = ringDialOffsets?.[ring.name] || 0;
    }
    for (let s = 1; s <= SPOKE_COUNT; s++) {
      const groups = ringLabelsAtSpoke ? ringLabelsAtSpoke(s) : {};
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const ring of RINGS) {
        const letters = groups[ring.name];
        if (!letters || !letters.length) continue;
        const ringOffset = ringDialOffsets?.[ring.name] || 0;
        const bandR = outerR * (ring.rFrom + RING_LABEL_BAND_FRACTION * (ring.rTo - ring.rFrom));
        const p = spokePoint(s - ringOffset, bandR, cx, cy);
        const labelHeightPx = isPole(s) ? this._poleLabelHeightPx : this._labelHeightPx;
        ctx.font = isPole(s) ? `bold ${labelHeightPx}px sans-serif` : `${labelHeightPx}px sans-serif`;
        ctx.fillStyle = WHEEL_PALETTE.label;
        drawRadialGlyph(ctx, letters, p.x, p.y, s - ringOffset, labelHeightPx);
      }
      if (groups.unassigned && groups.unassigned.length) {
        const p = spokePoint(s - rimOffset, outerR + 26 * scale, cx, cy);
        const unassignedHeightPx = isPole(s) ? this._poleLabelHeightPx : this._labelHeightPx;
        ctx.font = isPole(s) ? `italic bold ${unassignedHeightPx}px sans-serif` : `italic ${unassignedHeightPx}px sans-serif`;
        const circumR = Math.max(11 * scale, radialGlyphWidth(ctx, groups.unassigned, unassignedHeightPx) / 2 + 6 * scale);
        ctx.beginPath();
        ctx.arc(p.x, p.y, circumR, 0, Math.PI * 2);
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = WHEEL_PALETTE.structureDim;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = WHEEL_PALETTE.labelUnassigned;
        drawRadialGlyph(ctx, groups.unassigned, p.x, p.y, s - rimOffset, unassignedHeightPx);
      }
      if (!Object.keys(groups).length) {
        // No table entry at all for this spoke -- fall back to the raw
        // number so an empty spoke still reads as something.
        const p = spokePoint(s - rimOffset, outerR + 18 * scale, cx, cy);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10 * scale, 0, Math.PI * 2);
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = WHEEL_PALETTE.structureDim;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = WHEEL_PALETTE.emptySpokeNumber;
        ctx.font = isPole(s) ? `bold ${13 * scale}px sans-serif` : `${12 * scale}px sans-serif`;
        drawRadialText(ctx, String(s), p.x, p.y, s - rimOffset);
      }
    }

    const now = performance.now();
    const baseRadius = this._traceRadius();
    // "The echoes should all pulsate in scale slightly along with the low
    // drones of our soundscape" -- a small (+-3.5%) shared multiplier on
    // every echo/standing-generation radius, oscillating at the SAME real
    // rate a drone voice's own breath LFO runs at (main.js's
    // droneBreathHz). One shared value, not a separate one per echo, so
    // the whole tunnel visibly breathes together.
    const breathPulse = 1 + Math.sin(2 * Math.PI * droneBreathHz * (now / 1000)) * this._viewParams.breathPulseAmount;

    // "Luminosity... correspond to note hits or events, a continual,
    // subtle and unified visual feedback system" -- the shared brightness
    // boost from a recent breath-cycle/grand-convergence pulse (see
    // pulseFigure), linearly decaying back to 1.
    const pulseT = Math.max(0, 1 - (now - this._eventPulse.startedAt) / this._eventPulse.life);
    const brightnessBoost = 1 + this._eventPulse.amount * pulseT * 0.6;

    // Everything from here down is soft, additive glow -- "the additive
    // approach to lighting/coloration" -- overlapping glows (including
    // between DIFFERENT rings, now that all three share one scale) genuinely
    // brighten each other, instead of flat shapes stacking with hard edges.
    // Reset to normal compositing right after so it can't bleed into a
    // later frame's structural drawing.
    ctx.globalCompositeOperation = "lighter";

    // Master hull -- no longer drawn here at all. "The brief flashes of
    // the trace schematic/blueprint outline should emanate outward, not
    // linger in space" -- a stationary in-place brightness flash (the old
    // `_hullFlash`) was exactly that lingering. The hull is now ONLY ever
    // visible via its own brief, genuinely traveling echo pass
    // (pulseHullEcho/_hullEchoAges, rendered further down, unclipped,
    // rotated by `rimOffset` the same as everything else that tracks
    // transposition) -- consistent with "all trace marks/hulls are
    // contained within the same space-time-tunnel continuum."

    // The PERSISTENT layer -- "flat-plane persistence to give a readable
    // trace the user can see clearly," but "less persistent, allowing for
    // more dynamic coloration/brightness according to the active trace
    // process, not just a constantly washed-out white outline." Every
    // point still sits at the ring's own full base radius (never
    // shrinking -- still the flat plane itself), but brightness now
    // genuinely varies by RECENCY within the trail -- the newest segment
    // reads close to the ring's own full color, older ones fade toward
    // the quiet background, instead of one flat dim alpha painted across
    // the whole shape regardless of age. Rotated by `rimOffset` -- the
    // SAME live dial the master hull uses (see main.js's own fix
    // comment on recordVisit) -- so the live trace and the hull can never
    // drift apart; they read the identical number every frame.
    // "Build up the density of the true drawn trace layer by giving it 3
    // simultaneous levels of render, with two fainter, slightly breathing/
    // wavering color-accurate echoes and a central, brighter true center."
    // Two free-running (NOT tempo-locked -- deliberately independent of
    // each other and of the shared, lockstep `breathPulse` every other
    // echo in this file uses, so this reads as its own organic shimmer,
    // the same "vocalization wander" idiom synth.js's growl formants
    // already use for exactly this reason) small radius wobbles, out of
    // phase with each other so the two echo copies visibly diverge rather
    // than moving as one. Still fully color-accurate (glowColor, not a
    // desaturated/near-white ghost) -- these are echoes of the SAME line,
    // just fainter and gently offset, not a different kind of mark.
    const densityWobble1 = Math.sin(2 * Math.PI * 0.11 * (now / 1000)) * 0.014;
    const densityWobble2 = Math.sin(2 * Math.PI * 0.17 * (now / 1000) + 2.3) * 0.017;
    const TRACE_DENSITY_LEVELS = [
      { radiusMult: 1, alphaMult: 1 },               // central, true center
      { radiusMult: 1 + densityWobble1, alphaMult: 0.4 },
      { radiusMult: 1 - densityWobble2, alphaMult: 0.4 },
    ];

    for (const ringName of Object.keys(this.persistentTraceByRing)) {
      const trail = this.persistentTraceByRing[ringName];
      if (trail.length < 1) continue;
      const glowColor = RING_MARKER_COLOR[ringName];
      const ringRadius = this._ringDepthRadius(baseRadius, ringName);
      const at = (v, radiusMult) => spokePoint(v.spoke - rimOffset, ringRadius * radiusMult, cx, cy);
      const recencyOf = (i) => trail.length > 1 ? i / (trail.length - 1) : 1; // 0 = oldest, 1 = newest
      // "The circular vertex-markers are more of a distraction than a
      // source of information" -- removed; the connecting lines alone
      // carry the shape, same reasoning that already dropped vertex
      // circles everywhere else the echo/extrusion system touches.
      for (const level of TRACE_DENSITY_LEVELS) {
        for (let i = 1; i < trail.length; i++) {
          const a = at(trail[i - 1], level.radiusMult);
          const b = at(trail[i], level.radiusMult);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = glowColor;
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = (0.12 + 0.35 * recencyOf(i)) * level.alphaMult;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }

    // Provisional segments -- "the temporary trace paths drawn between two
    // points that don't actually comprise the true trace... should reflect
    // their transience/provisionality, fading away linearly as they're
    // drawn, instead of just vanishing." See recordVisit -- one per
    // merely-passed hit, dashed (not solid, marking it as never destined
    // for the persistent line), fading LINEARLY (unlike every eased fade
    // elsewhere in this file -- deliberately plain and honest about being
    // temporary, not softened). Dropped for good once its short life ends;
    // its endpoint lives on only as an ordinary point in `_ringSweepTrail`.
    this._provisionalSegments = this._provisionalSegments.filter((seg) => now - seg.bornAt < seg.life);
    for (const seg of this._provisionalSegments) {
      const t = (now - seg.bornAt) / seg.life;
      const alpha = this._viewParams.provisionalSegmentStrength * (1 - t);
      if (alpha <= 0.003) continue;
      const r = this._ringDepthRadius(baseRadius, seg.ring);
      const a = spokePoint(seg.fromSpoke - rimOffset, r, cx, cy);
      const b = spokePoint(seg.toSpoke - rimOffset, r, cx, cy);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = RING_MARKER_COLOR[seg.ring];
      ctx.lineWidth = 1.25;
      ctx.setLineDash([3, 3]);
      ctx.globalAlpha = alpha;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // The tracer -- "a fading oscilloscope-like tracer following the
    // stylus across the traces." Glides in a straight line, always at the
    // ring's own fixed base radius (no more per-point decay math feeding
    // its position -- that was the actual source of "strange, pseudo-3D
    // bouncing": the old fast layer's wormhole pass-through-center effect
    // was leaking into the tracer's own departure point). Falls back to a
    // plain dot at this ring's own rest position (spoke 1) until its first
    // real hit of the phrase. ringHitFlash briefly boosts it right as it
    // crosses a real letter. Rotated by `rimOffset`, same as the
    // persistent layer just above -- the tracer's own position must never
    // read differently from the segment it's about to draw.
    for (const ringName of Object.keys(this.persistentTraceByRing)) {
      const glowColor = RING_MARKER_COLOR[ringName];
      const cursor = hullCursorByRing?.[ringName];
      let p = null;
      let fromP = null;
      if (cursor) {
        fromP = spokePoint(cursor.fromSpoke - rimOffset, baseRadius, cx, cy);
        const toP = spokePoint(cursor.toSpoke - rimOffset, baseRadius, cx, cy);
        p = {
          x: fromP.x + (toP.x - fromP.x) * cursor.progress,
          y: fromP.y + (toP.y - fromP.y) * cursor.progress,
        };
      } else {
        p = spokePoint(1 - rimOffset, baseRadius, cx, cy);
      }

      // Real-time phase position, as a fractional SPOKE value (shortest-arc
      // interpolated -- sweeps along the ring's own arc, not a chord cut
      // through it) -- "a continuous, interval-based timekeeping visual
      // indicator... according to its phase." Stored for
      // pulsePhaseBarPulse/captureStandingGeneration (both fire outside
      // render()) to read back; drawn as the bar itself further down.
      this._ringPhaseSpoke[ringName] = cursor ? lerpSpokeShortest(cursor.fromSpoke, cursor.toSpoke, cursor.progress) : 1;

      const flash = ringHitFlash?.[ringName];
      const age = flash ? now - flash.firedAt : Infinity;
      const flashT = flash && age < flash.life ? 1 - age / flash.life : 0;

      // "The trace is no longer live created, and is back to appearing
      // fully segment by segment after the trace is made." A real
      // regression: simplifying the tracer down to a plain dot dropped the
      // live edge that used to visibly draw a segment AS the tracer
      // crossed it -- so the persistent layer's own matching segment
      // (recordVisit, once the hit lands) popped in fully-formed instead
      // of having been anticipated. Restored here as a thin, precise
      // stroke (not the old soft gradient glow -- keeping the engraved-
      // diagram look) from the departure point to the tracer's CURRENT
      // live position, so the edge is visibly under construction the
      // whole time it's being crossed. "Smaller hits illuminating the
      // trace as they're drawn" -- brightens with the same ringHitFlash
      // pulse the dot itself uses, right as a hit actually lands.
      if (fromP) {
        ctx.beginPath();
        ctx.moveTo(fromP.x, fromP.y);
        ctx.lineTo(p.x, p.y);
        ctx.strokeStyle = glowColor;
        ctx.lineWidth = 1.25;
        ctx.globalAlpha = Math.min(1, (0.35 + 0.5 * flashT) * brightnessBoost);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // "It looks more like a big orb than a hot point." A single small
      // solid dot -- no halo ring, no glow gradient, no comet tail. Still
      // the one deliberately emphasized mark on the page, just via a
      // brief size flash on a real hit rather than any kind of glow.
      // `Math.min(1, brightnessBoost)` here used to be a silent no-op --
      // brightnessBoost is always >= 1, so the clamp could only ever leave
      // it at 1, meaning a real sync-event pulse never actually grew the
      // dot at all. Capped at 1.3 instead of removing the clamp outright --
      // letting the FULL boost (up to 1.6) through is exactly what
      // previously read as "a big orb."
      ctx.beginPath();
      ctx.arc(p.x, p.y, (2.2 + 1.1 * flashT) * Math.min(1.3, brightnessBoost), 0, Math.PI * 2);
      ctx.fillStyle = glowColor;
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";

    // "The emanating/growing standing waves need to be masked within the
    // circular frame of the empty viewing area." Everything ambient/
    // always-present (the per-ring standing tunnel, hit-echoes) is clipped
    // to a circle matching the canvas's own natural frame -- it can never
    // bleed past the edges of the visualization. "Periodic event-based
    // echoes should emanate out fully and render over the whole screen
    // space" -- burst waves and the master hull's own brief pass are
    // deliberately drawn OUTSIDE this clip, further down, unclipped.
    const vpStanding = this._viewParams;
    const frameClipRadius = Math.min(this.cx, this.cy);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, frameClipRadius, 0, Math.PI * 2);
    ctx.clip();

    // Per-ring phase bar -- "a continuous, interval-based timekeeping
    // visual indicator... a white bar that continuously travels around
    // every ring according to its phase." "The radial timekeeping cursor
    // itself" -- a real cursor now, not just a short tick: a thin radial
    // line spanning that ring's own full band (inner to outer edge), a
    // distinct near-white, not ring-hued, color so the timekeeping layer
    // reads as its own thing. No head/dot at the tip -- "completely
    // un-asked for," removed; the line alone is the cursor.
    // At that ring's own real-time position (`_ringPhaseSpoke`), rotated
    // by the SAME per-ring dial the bezel/letters use, so it stays
    // visually locked to its own ring rather than drifting against a
    // rotating backdrop. Crisp, non-additive -- "ideally they won't be
    // too distracting from the main imagery."
    for (const ring of RINGS) {
      const ringOffset = ringDialOffsets?.[ring.name] || 0;
      const barSpoke = this._ringPhaseSpoke[ring.name] - ringOffset;
      const rIn = outerR * ring.rFrom;
      const rOut = outerR * ring.rTo;
      const barFrom = spokePoint(barSpoke, rIn, cx, cy);
      const barTip = spokePoint(barSpoke, rOut + 4, cx, cy);
      ctx.beginPath();
      ctx.moveTo(barFrom.x, barFrom.y);
      ctx.lineTo(barTip.x, barTip.y);
      ctx.strokeStyle = "#f4ead0";
      ctx.lineWidth = 1.25;
      ctx.globalAlpha = 0.6;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Standing generations -- the ambient background layer: rare, real
    // captures (recordVisit, every real given-ring hit) but CONTINUOUS
    // motion once alive -- "more continuously advancing outward/receding,
    // with a more clear procession of each taking the place of the
    // other." Each generation's own depth eases toward an authoritative
    // integer rank (_standingDepth) -- rendered as a symmetric pair of
    // shells, one continuously receding outward, one continuously
    // receding inward, both from the live trace's own radius: the
    // "one-way mirror... perpetual receding frame of thresholds" tunnel,
    // actually moving. "Should diminish in opacity/brightness as they move
    // farther from the active trace-plane" -- alpha is an EXPONENTIAL
    // decay (asymptotic, long-tailed) keyed directly on depth, so a
    // farther/older shell is always genuinely dimmer, never a flat wash.
    // Drawn FIRST so the more active hit echoes below read as layered on
    // top of this steady backdrop, not competing with it.
    this._standingGenerations = this._standingGenerations.filter(
      (gen) => vpStanding.standingBaseAlpha * (gen.strengthMult ?? 1) * Math.exp(-Math.max(0, this._standingDepth(gen, now)) * vpStanding.standingFadeRate) > 0.008
    );
    for (const gen of this._standingGenerations) {
      const depth = this._standingDepth(gen, now);
      if (depth < -0.98) continue; // still peeling off the live trace, nothing to show yet
      const alpha = vpStanding.standingBaseAlpha * (gen.strengthMult ?? 1) * Math.exp(-Math.max(0, depth) * vpStanding.standingFadeRate);
      if (alpha <= 0.008) continue;
      for (const ring of Object.keys(gen.snapshot)) {
        const spokes = gen.snapshot[ring];
        ctx.strokeStyle = RING_MARKER_COLOR[ring];
        ctx.lineWidth = 1;
        ctx.globalAlpha = alpha;
        for (const dir of [1, -1]) {
          const scale = (1 + dir * (depth + 1) * vpStanding.standingStep) * breathPulse;
          if (scale <= 0.06) continue;
          const r = this._ringDepthRadius(baseRadius, ring) * scale;
          ctx.beginPath();
          spokes.forEach((s, i) => {
            // Frozen rotation (see captureStandingGeneration's own
            // comment) -- NOT the live `rimOffset` -- so history stays
            // exactly as it was drawn, not silently re-rotating with time.
            const pt = spokePoint(s - gen.rimOffsetAtCapture, r, cx, cy);
            if (i === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          });
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }

    // Propagating echoes, HIT and PHASEBAR kinds only here (still inside
    // the clip -- both are per-note/per-pulse ambient texture, part of the
    // same contained field as the standing tunnel). `burst` kind is drawn
    // further down, unclipped -- see that block's own comment for why. A
    // real note landing, always rippling inward -- "activated letters...
    // echoed backward... into the vanishing point" (hit); a phase bar's
    // own real-time tick, in/out (phasebar, near-white -- see
    // _spawnPhaseBarEcho). Simple one-shot eased sweep from the live
    // trace's own radius toward its target, fading over its own life.
    // Deliberately drawn in NORMAL (non-additive) compositing -- precise,
    // thin engraved lines, not soft light to blend.
    this._echoes = this._echoes.filter((echo) => now - echo.bornAt < echo.life);
    for (const echo of this._echoes) {
      if (echo.styleKind !== "hit" && echo.styleKind !== "phasebar") continue;
      if (now < echo.bornAt) continue;
      const t = (now - echo.bornAt) / echo.life;
      const eased = 1 - Math.pow(1 - t, 2);
      // "Should fade to black before disappearing more gradually" -- an
      // exponent > 1 keeps an echo visibly bright for longer, then tapers
      // off gently near the end of its life instead of a linear ramp that
      // reads as an abrupt cutoff.
      const alpha = echo.strength * Math.pow(1 - t, this._viewParams.echoFadeExponent);
      if (alpha <= 0.003) continue;

      if (echo.styleKind === "phasebar") {
        // The cursor's own true shape (see render()'s phase-bar cursor
        // block below) -- a radial line spanning this ring's band, not a
        // tangential arc. Both endpoints scale by the SAME travel factor,
        // so the whole line recedes/emanates as a rigid radial unit,
        // exactly the "one shared factor" idiom the standing tunnel above
        // already uses for a whole captured shape.
        const travel = (echo.from + (echo.to - echo.from) * eased) * breathPulse;
        const spoke = echo.spoke - echo.rotationAtCapture;
        const rIn = outerR * echo.ringFrom * travel;
        const rOut = (outerR * echo.ringTo + 4) * travel;
        const from = spokePoint(spoke, rIn, cx, cy);
        const tip = spokePoint(spoke, rOut, cx, cy);
        ctx.strokeStyle = "#f4ead0";
        ctx.lineWidth = 1.25 * (echo.widthMult || 1);
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(tip.x, tip.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }

      const r = this._ringDepthRadius(echo.baseR ?? baseRadius, echo.ring) * (echo.from + (echo.to - echo.from) * eased) * breathPulse;
      ctx.strokeStyle = RING_MARKER_COLOR[echo.ring];
      ctx.lineWidth = 1;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      echo.spokes.forEach((s, i) => {
        // Frozen at spawn (see _spawnEcho's own comment) -- not the live
        // offset, so an already-in-flight echo never jumps mid-flight.
        const pt = spokePoint(s - echo.rotationAtCapture, r, cx, cy);
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    // The master hull's own brief echo pass -- "the traced/white-line
    // geometry should only briefly pass backward into space as an echo,
    // the trace itself in motion is what should produce/maintain standing
    // waves." Unlike the per-ring tunnel above, this is NOT a standing,
    // accumulating shift register -- pulseHullEcho spawns exactly two
    // one-shot instances (out + in) each time the whole trace genuinely
    // completes/transforms (see retireTrace), and they're gone once their
    // own life elapses. Drawn UNCLIPPED, full canvas -- "periodic
    // event-based echoes should emanate out fully... over the whole
    // screen space," the same real-event exemption burst waves get below.
    // Includes each vertex's own letter -- "the activated corresponding
    // glyphs, all as a unified projection," the whole phrase's shape and
    // its actual alphabetic content receding together.
    this._hullEchoAges = this._hullEchoAges.filter((age) => now - age.bornAt < age.life);
    if (this.masterHull.length > 1) {
      for (const age of this._hullEchoAges) {
        const t = (now - age.bornAt) / age.life;
        const eased = 1 - Math.pow(1 - t, 2);
        const scale = (1 + (age.direction === "in" ? -1 : 1) * eased * vpStanding.hullEchoReach) * breathPulse;
        const r = outerR * scale;
        // "The white master hull echo should leave a full frozen copy of
        // itself in place when it PERFECTLY OVERLAYS the active trace
        // plane, which should linger and fade." Tracked unconditionally
        // (before the alpha/scale visibility guards below), frame to
        // frame, so a real crossing is never missed just because it
        // happens while the pass is dim. The inward pass's own radius is
        // monotonically decreasing, so this fires at most once per pass,
        // at the exact real moment r actually crosses baseRadius --
        // never a guessed or fixed timing.
        if (age.direction === "in") {
          if (age._lastR != null && age._lastR > baseRadius && r <= baseRadius && !age._crossedTracePlane) {
            age._crossedTracePlane = true;
            this._hullFrozenCopies.push({
              spokes: [...this.masterHull], letters: [...this.masterHullLetters],
              bornAt: now, life: this._viewParams.hullCheckpointLife, rotationAtCapture: age.rimOffsetAtCapture,
            });
            if (this._hullFrozenCopies.length > 6) this._hullFrozenCopies.shift();
          }
          age._lastR = r;
        }
        const alpha = vpStanding.hullEchoStrength * (age.strengthMult ?? 1) * Math.pow(1 - t, this._viewParams.echoFadeExponent);
        if (alpha <= 0.003) continue;
        if (scale <= 0.03) continue;
        ctx.strokeStyle = "#f4ead0";
        ctx.lineWidth = 1.25;
        ctx.setLineDash([5, 4]);
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        this.masterHull.forEach((s, i) => {
          const pt = spokePoint(s - age.rimOffsetAtCapture, r, cx, cy);
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
        if (this.masterHullLetters.length === this.masterHull.length) {
          ctx.font = `${this._hullHeightPx}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          this.masterHull.forEach((s, i) => {
            const pt = spokePoint(s - age.rimOffsetAtCapture, r, cx, cy);
            ctx.fillStyle = "#f4ead0";
            drawRadialGlyph(ctx, [this.masterHullLetters[i]], pt.x, pt.y, s - age.rimOffsetAtCapture, this._hullHeightPx);
          });
        }
        ctx.globalAlpha = 1;
      }
    }

    // The frozen copy itself -- static (fixed at the trace's own
    // baseRadius, only the shared ambient breathPulse wobble moves it at
    // all -- never travels again once spawned), lingering and fading over
    // its own life. Same dashed styling as the traveling pass it froze
    // from ("a full frozen copy of ITSELF"), so it genuinely reads as
    // that same pass, paused, rather than a new kind of mark.
    this._hullFrozenCopies = this._hullFrozenCopies.filter((fc) => now - fc.bornAt < fc.life);
    for (const fc of this._hullFrozenCopies) {
      if (fc.spokes.length < 2) continue;
      const t = (now - fc.bornAt) / fc.life;
      const alpha = this._viewParams.hullCheckpointStrength * Math.pow(1 - t, this._viewParams.echoFadeExponent);
      if (alpha <= 0.003) continue;
      const r = baseRadius * breathPulse;
      ctx.strokeStyle = "#f4ead0";
      ctx.lineWidth = 1.25;
      ctx.setLineDash([5, 4]);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      fc.spokes.forEach((s, i) => {
        const pt = spokePoint(s - fc.rotationAtCapture, r, cx, cy);
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      if (fc.letters.length === fc.spokes.length) {
        ctx.font = `${this._hullHeightPx}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        fc.spokes.forEach((s, i) => {
          const pt = spokePoint(s - fc.rotationAtCapture, r, cx, cy);
          ctx.fillStyle = "#f4ead0";
          drawRadialGlyph(ctx, [fc.letters[i]], pt.x, pt.y, s - fc.rotationAtCapture, this._hullHeightPx);
        });
      }
      ctx.globalAlpha = 1;
    }

    // Propagating echoes, BURST kind -- "periodic event-based echoes
    // should emanate out fully and render over the whole screen space as
    // they emanate outward." Several staggered concentric sync-event
    // waves (breath/convergence/transposition/stage -- see pulseFigure),
    // both directions, deliberately UNCLIPPED so a real structural event
    // reads as breaking free of the wheel's own frame, not contained by
    // it -- the visual distinction between "always-there ambient texture"
    // (clipped, above) and "a rare real event" (not).
    for (const echo of this._echoes) {
      if (echo.styleKind !== "burst") continue;
      if (now < echo.bornAt) continue;
      const t = (now - echo.bornAt) / echo.life;
      const eased = 1 - Math.pow(1 - t, 2);
      const r = this._ringDepthRadius(echo.baseR ?? baseRadius, echo.ring) * (echo.from + (echo.to - echo.from) * eased) * breathPulse;
      const alpha = echo.strength * Math.pow(1 - t, this._viewParams.echoFadeExponent);
      if (alpha <= 0.003) continue;
      ctx.strokeStyle = RING_MARKER_COLOR[echo.ring];
      ctx.lineWidth = 1;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      echo.spokes.forEach((s, i) => {
        // Frozen at spawn (see _spawnEcho's own comment) -- not the live
        // offset, so an already-in-flight echo never jumps mid-flight.
        const pt = spokePoint(s - echo.rotationAtCapture, r, cx, cy);
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Transform echo -- see spawnTransformEcho's own comment. Each point
    // morphs from its `fromSpokes[i]` position to `toSpokes[i]` via
    // shortest-arc (lerpSpokeShortest), eased in/out over the echo's own
    // life -- a deliberate morph, not a dart -- fading as it completes.
    // Drawn at the fixed trace radius (no radial travel), thicker than the
    // plain propagating echoes so a rare, structurally real event reads as
    // more consequential than routine texture.
    this._transformEchoes = this._transformEchoes.filter((echo) => now - echo.bornAt < echo.life);
    for (const echo of this._transformEchoes) {
      const t = Math.min(1, (now - echo.bornAt) / echo.life);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const alpha = echo.strength * (1 - t);
      if (alpha <= 0.003) continue;
      ctx.strokeStyle = RING_MARKER_COLOR[echo.ring];
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      echo.fromSpokes.forEach((fromSpoke, i) => {
        const spoke = lerpSpokeShortest(fromSpoke, echo.toSpokes[i], eased);
        const pt = spokePoint(spoke, baseRadius, cx, cy);
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}
