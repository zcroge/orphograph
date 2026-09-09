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

import { SPOKE_COUNT, RINGS, spokePoint, spokeAngle, isPole, rotateSpoke } from "./wheel.js";

// "Granular parametric control over the visuals now, especially the echo
// settings." Every number here has a real, currently-hardcoded twin
// somewhere in this file's echo/standing-generation machinery -- moved out
// so a live control panel (main.js's wireTimbrePanel, the same pattern
// already driving note/drone timbre) can retune them without a code
// change. See WheelView's own setViewParam.
export const DEFAULT_VIEW_PARAMS = {
  standingMaxGenerations: 8,     // "a greater accumulation of standing echoes visible at a given time"
  standingAdvanceMs: 900,        // ms to settle into a new rank when pushed by a fresh capture (not a continuous crawl rate -- see captureStandingGeneration)
  standingStep: 0.24,            // radial reach per rank
  standingFadeRate: 0.16,        // exponential decay rate -- lower = longer, more gradual tail
  standingBaseAlpha: 0.42,
  hullEchoLife: 1800,             // one brief pass, both directions -- not a standing/accumulating tunnel
  hullEchoStrength: 0.55,
  hullEchoReach: 0.5,
  echoHitLife: 1900,
  echoHitStrength: 0.55,
  echoBurstLife: 2200,
  echoBurstStrength: 0.7,
  echoReachOut: 1.35,
  echoReachIn: 0.92,
  echoFadeExponent: 1.7,         // >1 = "fade to black more gradually," not an abrupt cutoff
  breathPulseAmount: 0.035,      // "pulsate in scale slightly along with the low drones"
  // Per-ring phase bar -- "a continuous, interval-based timekeeping visual
  // indicator... a white bar that continuously travels around every ring
  // according to its phase." One per ring, real-time, not event-stepped.
  phaseBarArcWidth: 0.4,         // how wide the bar/its echoes are, in spokes
  phaseBarEchoLife: 900,         // brief -- "won't be too distracting"
  phaseBarEchoStrength: 0.3,
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

// Ring hues are law-declared (00-laws.md/lexicon: given=yellow, received=
// blue, made=green) -- identity untouched, pushed to saturated/luminous
// variants here so the ACTIVE hull/cursor per ring reads as the brightest
// thing on a black field, not the pastel-on-white tone tuned previously.
// This is now the ONLY place ring hue appears anywhere in the drawing --
// see WHEEL_PALETTE above for the full "why."
const RING_MARKER_COLOR = {
  given: "#ffcf3d",
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

export class WheelView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.cx = canvas.width / 2;
    this.cy = canvas.height / 2;
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
    this.outerR = Math.min(this.cx, this.cy) - 94;
    this.masterHull = [];
    // "There should be some level of flat-plane persistence to give a
    // readable trace the user can see clearly." Capacity-bound, not time-
    // bound (see setTraceCapacity), stays at the ring's own full base
    // radius (the same flat plane, never shrinking), quiet/dim -- the one
    // stable, always-readable record of what's actually been traced.
    this.persistentTraceByRing = { given: [], received: [], made: [] };
    this._persistentCapacity = WheelView.MAX_PERSISTENT_POINTS;
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
  }

  reset() {
    this.persistentTraceByRing = { given: [], received: [], made: [] };
    this.masterHull = [];
    this._hullEchoAges = [];
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
  _spawnEcho(ring, trail, style, styleKind, direction, reach = 1, bornAt = performance.now(), baseR = null) {
    if (trail.length < 2) return;
    const spokes = (Number.isFinite(style.count) ? trail.slice(-style.count) : trail).map((v) => v.spoke);
    if (spokes.length < 2) return;
    // "Emanate/recede farther... too static and too contained" -- live
    // tunable (echoReachOut/echoReachIn) so a full-strength echo's real
    // travel distance can be dialed in rather than baked in.
    const vp = this._viewParams;
    const to = direction === "in" ? 1 - reach * vp.echoReachIn : 1 + reach * vp.echoReachOut;
    this._echoes.push({ ring, spokes, styleKind, bornAt, life: style.life, from: 1, to, strength: style.strength, baseR });
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
    for (const ring of Object.keys(this.persistentTraceByRing)) {
      const trail = this.persistentTraceByRing[ring];
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
  // accurately reflect the current trace progress of the given ring's
  // trace" -- captured from `recordVisit` itself, once per real OWNED
  // given-ring hit (not the much rarer full given-loop wrap, which could
  // be 20-60+ seconds on a real phrase and read as dead most of the time;
  // still a real content event, still never per raw beat/pulse).
  captureStandingGeneration() {
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
    for (const ring of Object.keys(this.persistentTraceByRing)) {
      const trail = this.persistentTraceByRing[ring];
      if (trail.length >= 2) snapshot[ring] = trail.map((v) => v.spoke);
    }
    if (Object.keys(snapshot).length > 0) {
      this._standingGenerations.unshift({ snapshot, rank: 0, depthFrom: -1, depthEaseStartedAt: now });
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

  // Small local arc (not a bare point -- same "never a bare point"
  // discipline as every other echo in this file) centered on this ring's
  // CURRENT phase-bar position. `direction`: "out" on a real per-pulse
  // time-based event (pulsePhaseBarPulse, called from main.js's onPulse)
  // or "in" at diagram-echo-level intervals (captureStandingGeneration,
  // above). Deliberately its OWN styleKind ("phasebar") -- rendered near-
  // white like the bar itself, not ring-hued like hit/burst echoes, so the
  // "timekeeping" layer reads as visually distinct from the trace/echo
  // layer it rides alongside.
  _spawnPhaseBarEcho(ring, direction) {
    const spoke = this._ringPhaseSpoke[ring];
    if (spoke == null) return;
    const vp = this._viewParams;
    const arc = [{ spoke: spoke - vp.phaseBarArcWidth }, { spoke: spoke + vp.phaseBarArcWidth }];
    // Emanates from THIS ring's own outer band edge, not the trace's
    // baseRadius -- the bar lives at the ring, so its echo should too.
    const ringDef = RINGS.find((r) => r.name === ring);
    const baseR = this.outerR * (ringDef ? ringDef.rTo : 1);
    this._spawnEcho(ring, arc, { life: vp.phaseBarEchoLife, strength: vp.phaseBarEchoStrength, count: 2 }, "phasebar", direction, 1, performance.now(), baseR);
  }

  // Called from main.js's onPulse -- one real raw pulse IS this ring's own
  // "relevant time-based event," so an outward echo here is a genuine,
  // real-time tick, not a fabricated metronome.
  pulsePhaseBarPulse(ring) {
    this._spawnPhaseBarEcho(ring, "out");
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
    this._hullEchoAges = [
      { bornAt: now, life: vp.hullEchoLife, direction: "out", strengthMult },
      { bornAt: now, life: vp.hullEchoLife, direction: "in", strengthMult },
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
    if (owned) {
      persistent.push({ spoke });
      if (persistent.length > this._persistentCapacity) persistent.shift();
      // "The constant procession of echoes should more accurately reflect
      // the current trace progress of the given ring's trace." Given
      // (slowest, outermost) is what the standing-generation tunnel keys
      // off of -- a real content event on the SAME ring the rim dial and
      // transposition already anchor on, frequent enough to feel alive
      // (every real given-tier hit, not once per 20-60s full loop) while
      // still never firing on a raw beat/pulse.
      if (ring === "given") this.captureStandingGeneration();
    }
    // "Every hit (even percussion hits) should be reflected by an
    // echo/emanation of some kind, with each echo always being a fresh,
    // accurate representation of the current state." Spawns regardless of
    // `owned` now -- a passed/ghost letter still fires a real percussion
    // hit (main.js's onNoteHit/onChordHit call audio.playPercussionHit
    // unconditionally), so it gets a real echo too. Always drawn from
    // whatever this ring's own trail CURRENTLY is (never a fabricated
    // point) -- "activated letters... echoed backward fully into the echo
    // space... ripple backward... into the vanishing point," always
    // inward, whether or not THIS specific hit just grew the trail.
    const vp = this._viewParams;
    this._spawnEcho(ring, persistent, { life: vp.echoHitLife, strength: vp.echoHitStrength, count: WheelView.ECHO_COUNT.hit }, "hit", "in");
  }

  render({ ringLabelsAtSpoke, transposition, hullCursorByRing, ringHitFlash, masterRotationOffset, ringDialOffsets, droneBreathHz = 0 }) {
    const { ctx, cx, cy, outerR } = this;
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
        const label = letters.join("/");
        ctx.font = isPole(s) ? "bold 11px sans-serif" : "10px sans-serif";
        ctx.fillStyle = WHEEL_PALETTE.label;
        drawRadialText(ctx, label, p.x, p.y, s - ringOffset);
      }
      if (groups.unassigned && groups.unassigned.length) {
        const p = spokePoint(s - rimOffset, outerR + 26, cx, cy);
        const label = groups.unassigned.join("/");
        ctx.font = isPole(s) ? "italic bold 11px sans-serif" : "italic 10px sans-serif";
        const circumR = Math.max(11, ctx.measureText(label).width / 2 + 6);
        ctx.beginPath();
        ctx.arc(p.x, p.y, circumR, 0, Math.PI * 2);
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = WHEEL_PALETTE.structureDim;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = WHEEL_PALETTE.labelUnassigned;
        drawRadialText(ctx, label, p.x, p.y, s - rimOffset);
      }
      if (!Object.keys(groups).length) {
        // No table entry at all for this spoke -- fall back to the raw
        // number so an empty spoke still reads as something.
        const p = spokePoint(s - rimOffset, outerR + 18, cx, cy);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = WHEEL_PALETTE.structureDim;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = WHEEL_PALETTE.emptySpokeNumber;
        ctx.font = isPole(s) ? "bold 13px sans-serif" : "12px sans-serif";
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
    // the whole shape regardless of age.
    for (const ringName of Object.keys(this.persistentTraceByRing)) {
      const trail = this.persistentTraceByRing[ringName];
      if (trail.length < 1) continue;
      const glowColor = RING_MARKER_COLOR[ringName];
      const at = (v) => spokePoint(v.spoke, baseRadius, cx, cy);
      const recencyOf = (i) => trail.length > 1 ? i / (trail.length - 1) : 1; // 0 = oldest, 1 = newest
      // "The circular vertex-markers are more of a distraction than a
      // source of information" -- removed; the connecting lines alone
      // carry the shape, same reasoning that already dropped vertex
      // circles everywhere else the echo/extrusion system touches.
      for (let i = 1; i < trail.length; i++) {
        const a = at(trail[i - 1]);
        const b = at(trail[i]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = glowColor;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.12 + 0.35 * recencyOf(i);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // The tracer -- "a fading oscilloscope-like tracer following the
    // stylus across the traces." Glides in a straight line, always at the
    // ring's own fixed base radius (no more per-point decay math feeding
    // its position -- that was the actual source of "strange, pseudo-3D
    // bouncing": the old fast layer's wormhole pass-through-center effect
    // was leaking into the tracer's own departure point). Falls back to a
    // plain dot at this ring's own rest position (spoke 1) until its first
    // real hit of the phrase. ringHitFlash briefly boosts it right as it
    // crosses a real letter.
    for (const ringName of Object.keys(this.persistentTraceByRing)) {
      const glowColor = RING_MARKER_COLOR[ringName];
      const cursor = hullCursorByRing?.[ringName];
      let p = null;
      let fromP = null;
      if (cursor) {
        fromP = spokePoint(cursor.fromSpoke, baseRadius, cx, cy);
        const toP = spokePoint(cursor.toSpoke, baseRadius, cx, cy);
        p = {
          x: fromP.x + (toP.x - fromP.x) * cursor.progress,
          y: fromP.y + (toP.y - fromP.y) * cursor.progress,
        };
      } else {
        p = spokePoint(1, baseRadius, cx, cy);
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
      ctx.arc(p.x, p.y, (3 + 1.5 * flashT) * Math.min(1.3, brightnessBoost), 0, Math.PI * 2);
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
    // visual indicator in the outermost rings, a white bar that
    // continuously travels around every ring according to its phase."
    // Riding the outer edge of each of the 3 letter-bearing bands, at that
    // ring's own real-time position (`_ringPhaseSpoke`, just computed
    // above), rotated by the SAME per-ring dial the bezel/letters use, so
    // it stays visually locked to its own ring rather than drifting
    // against a rotating backdrop. Crisp, non-additive, thin -- "ideally
    // they won't be too distracting from the main imagery."
    for (const ring of RINGS) {
      const ringOffset = ringDialOffsets?.[ring.name] || 0;
      const barSpoke = this._ringPhaseSpoke[ring.name] - ringOffset;
      const rOut = outerR * ring.rTo;
      const barIn = spokePoint(barSpoke, rOut, cx, cy);
      const barOut = spokePoint(barSpoke, rOut + 7, cx, cy);
      ctx.beginPath();
      ctx.moveTo(barIn.x, barIn.y);
      ctx.lineTo(barOut.x, barOut.y);
      ctx.strokeStyle = "#f4ead0";
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.85;
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
      (gen) => vpStanding.standingBaseAlpha * Math.exp(-Math.max(0, this._standingDepth(gen, now)) * vpStanding.standingFadeRate) > 0.008
    );
    for (const gen of this._standingGenerations) {
      const depth = this._standingDepth(gen, now);
      if (depth < -0.98) continue; // still peeling off the live trace, nothing to show yet
      const alpha = vpStanding.standingBaseAlpha * Math.exp(-Math.max(0, depth) * vpStanding.standingFadeRate);
      if (alpha <= 0.008) continue;
      for (const ring of Object.keys(gen.snapshot)) {
        const spokes = gen.snapshot[ring];
        ctx.strokeStyle = RING_MARKER_COLOR[ring];
        ctx.lineWidth = 1;
        ctx.globalAlpha = alpha;
        for (const dir of [1, -1]) {
          const scale = (1 + dir * (depth + 1) * vpStanding.standingStep) * breathPulse;
          if (scale <= 0.06) continue;
          const r = baseRadius * scale;
          ctx.beginPath();
          spokes.forEach((s, i) => {
            const pt = spokePoint(s, r, cx, cy);
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
      const r = (echo.baseR ?? baseRadius) * (echo.from + (echo.to - echo.from) * eased) * breathPulse;
      // "Should fade to black before disappearing more gradually" -- an
      // exponent > 1 keeps an echo visibly bright for longer, then tapers
      // off gently near the end of its life instead of a linear ramp that
      // reads as an abrupt cutoff.
      const alpha = echo.strength * Math.pow(1 - t, this._viewParams.echoFadeExponent);
      if (alpha <= 0.003) continue;
      ctx.strokeStyle = echo.styleKind === "phasebar" ? "#f4ead0" : RING_MARKER_COLOR[echo.ring];
      ctx.lineWidth = 1;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      echo.spokes.forEach((s, i) => {
        const pt = spokePoint(s, r, cx, cy);
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
        const alpha = vpStanding.hullEchoStrength * (age.strengthMult ?? 1) * Math.pow(1 - t, this._viewParams.echoFadeExponent);
        if (alpha <= 0.003) continue;
        const scale = (1 + (age.direction === "in" ? -1 : 1) * eased * vpStanding.hullEchoReach) * breathPulse;
        if (scale <= 0.03) continue;
        const r = outerR * scale;
        ctx.strokeStyle = "#f4ead0";
        ctx.lineWidth = 1.25;
        ctx.setLineDash([5, 4]);
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        this.masterHull.forEach((s, i) => {
          const pt = spokePoint(s - rimOffset, r, cx, cy);
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
        if (this.masterHullLetters.length === this.masterHull.length) {
          ctx.font = "9px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          this.masterHull.forEach((s, i) => {
            const pt = spokePoint(s - rimOffset, r, cx, cy);
            ctx.fillStyle = "#f4ead0";
            drawRadialText(ctx, this.masterHullLetters[i], pt.x, pt.y, s - rimOffset);
          });
        }
        ctx.globalAlpha = 1;
      }
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
      const r = (echo.baseR ?? baseRadius) * (echo.from + (echo.to - echo.from) * eased) * breathPulse;
      const alpha = echo.strength * Math.pow(1 - t, this._viewParams.echoFadeExponent);
      if (alpha <= 0.003) continue;
      ctx.strokeStyle = RING_MARKER_COLOR[echo.ring];
      ctx.lineWidth = 1;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      echo.spokes.forEach((s, i) => {
        const pt = spokePoint(s, r, cx, cy);
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
