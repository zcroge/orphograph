// Wheel geometry: 12 spokes, 3 rings, a hub, two self-reflecting poles.
// Numbering and pole positions are DERIVED, not chosen: master-blueprint-v2.md's
// mirror law is "spoke p <-> spoke (14-p) mod 12, the two pole spokes reflect
// onto themselves." Solving p = (14-p) mod 12 over spokes numbered 1..12 gives
// p = 1 and p = 7 as the only self-reflecting spokes. L8 says "I at top pole,
// O at bottom pole" -- so spoke 1 = top = I, spoke 7 = bottom = O. That is a
// consequence of settled law, not a placeholder choice made here.
//
// Spoke 1 sits at the top (12 o'clock) and numbering increases clockwise,
// which is the convention this prototype picks (not specified in the source
// docs) so that "procession" reads as a clockwise sweep, like a clock hand.

export const SPOKE_COUNT = 12;
export const POLE_SPOKES = [1, 7]; // I (top), O (bottom) -- settled, see above.

export function isPole(spoke) {
  return POLE_SPOKES.includes(normalizeSpoke(spoke));
}

export function normalizeSpoke(spoke) {
  // Keep spokes in the 1..12 range (not 0..11), matching the source math.
  const m = ((spoke - 1) % SPOKE_COUNT + SPOKE_COUNT) % SPOKE_COUNT;
  return m + 1;
}

export function mirrorSpoke(spoke) {
  const s = normalizeSpoke(spoke);
  const m = ((14 - s) % SPOKE_COUNT + SPOKE_COUNT) % SPOKE_COUNT;
  return m === 0 ? SPOKE_COUNT : m;
}

// Rotation by any degree (in spokes, each = 30 degrees geometrically) --
// the general case `normalizeSpoke` was always already correct for (it's a
// total mod-12 wrap over any integer, negative included), just never given
// its own name. `mirrorSpoke` is a REFLECTION (order 2, fixed points at the
// poles); this is a ROTATION (order 12/gcd(n,12), no fixed points unless
// n=0) -- the two are the wheel's own dihedral group, D12, acting on spokes.
export function rotateSpoke(spoke, n) {
  return normalizeSpoke(spoke + n);
}

// Angle in radians, 0 = up (12 o'clock), increasing clockwise.
export function spokeAngle(spoke) {
  const s = normalizeSpoke(spoke);
  return ((s - 1) / SPOKE_COUNT) * Math.PI * 2;
}

export function spokePoint(spoke, radius, cx, cy) {
  const a = spokeAngle(spoke) - Math.PI / 2; // canvas 0-rad = +x axis, so shift
  return {
    x: cx + radius * Math.cos(a),
    y: cy + radius * Math.sin(a),
  };
}

// The three rings. Radii are fractions of the wheel's outer radius;
// arbitrary proportions, not derived from anything -- purely a drawing
// choice. Ring hue (00-laws.md / lexicon: "ring -- given (outer, yellow) .
// received (middle, blue) . made (inner, green)") is law-declared but no
// longer drawn as a static band fill here -- see view.js's WHEEL_PALETTE
// and RING_MARKER_COLOR: the hue is now reserved for the ACTIVE per-ring
// cursor/hull only, so it reads as "the one loud thing on the page" the
// diagram's own drawing philosophy already declared, instead of also
// tinting the resting structure three separate ways.
// "The 3 rings of glyphs should be compressed into rings that circumscribe
// an empty circular space to give the visualization its own open field."
// Previously spanned rFrom 0.18 all the way to rTo 1.0, leaving almost no
// room in the middle; compressed into the outer quarter (0.76-1.0) instead,
// same relative widths as before (given widest->narrowest was actually
// received>given>made; preserved proportionally), so the 3D trace
// (view.js's own fixed, RINGS-independent _traceRadius) now has a real
// open field to live in rather than sitting inside the letter bezels.
export const RINGS = [
  { name: "given", rFrom: 0.918, rTo: 1.0 },
  { name: "received", rFrom: 0.824, rTo: 0.918 },
  { name: "made", rFrom: 0.76, rTo: 0.824 },
];

// Fixed procession-speed ratios, one per ring, all driven off one master
// rate (the crank stays a single input; the ratios between rings are a
// declared law, not something a performer steers independently).
// given=outer=passively-supplied=slowest, made=inner=actively-authored=
// fastest -- matching both (a) the provenance semantics already attached to
// these rings, and (b) real orbital mechanics in the Antikythera mechanism
// itself (inner orbits are faster than outer ones).
// The numbers 6:8:12 are not arbitrary either: they're the harmonic sub-
// triad of the "musical proportion" from Plato's Timaeus (12:9:8:6, where 9
// is the arithmetic mean and 8 the harmonic mean of 6 and 12) -- the
// foundational ancient source for building cosmological structure from
// musical ratio, later inherited by Renaissance proportion theory. 12 is
// used directly as the fastest ring's weight, tying it to the wheel's own
// spoke count rather than an imported number.
export const RING_SPEED_WEIGHT = {
  given: 6,
  received: 8,
  made: 12,
};
const MAX_RING_WEIGHT = 12;
export function ringSpeedMultiplier(ringName) {
  return RING_SPEED_WEIGHT[ringName] / MAX_RING_WEIGHT;
}

// Octave placement per ring: foundation low, activity high -- a common
// enough musical convention (bass = slow-moving/foundational, treble =
// fast-moving/active) that it's a reasonable default, not a declared law.
export const RING_OCTAVE_MULTIPLIER = {
  given: 0.5,   // an octave down
  received: 1,
  made: 2,      // an octave up
};

// Master procession tempo, standardized as BPM -- "the given procession
// rate... standardized into bpm or another relevant, least-arbitrary
// candidate unit." Not a new claim: the-codex-v1.md's own Standards
// already settle the meter this counts in ("onset = spoke in 12-pulse
// (12/8)") -- so BPM here means exactly what it means on any lead sheet
// marked 12/8: one beat is a dotted quarter, three of this engine's own
// pulses. This replaces the old bare "maxPulsesPerSecond = 20" ceiling
// (tuned by ear, no unit behind it) with a real, named tempo range instead
// -- 20-300 BPM is standard tempo-marking territory (Grave to blast-beat/
// Prestissimo), not a number picked to make one slider feel right.
export const PULSES_PER_BEAT = 3; // 12/8 meter: beat = dotted quarter = 3 pulses
export const MIN_BPM = 20;
export const MAX_BPM = 300;

// "A universal grounding tempo... a low resting heart-rate tempo, or a
// ratio derived between ideal slow breathing and slow heartbeat to induce
// relaxation, visualization and lucid consciousness" -- Gojira's "The Art
// of Dying" and Meshuggah's "Clockworks" both run a steady, unwavering
// pulse beneath otherwise complex/polymetric material; this engine's own
// 6:8:12 rings already converge periodically the same way, just without a
// felt physiological floor underneath them. 72 BPM is the classic
// textbook average resting heart rate -- a real, named figure, same
// "20-300 BPM is standard tempo-marking territory" discipline as MIN_BPM/
// MAX_BPM above, not a number tuned to feel right. Fixed, not slider-
// adjustable (see sequencer.js's Sequencer, which no longer has a
// variable rate at all) -- the whole point is one steady constant
// everything else moves against.
export const GROUNDING_BPM = 72;

// The breath layer: 6 breaths/minute is the real resonance/coherence-
// breathing rate used in HRV biofeedback (Lehrer/Vaschillo et al.) for
// inducing exactly the relaxed, coherent state described -- and
// GROUNDING_BPM / SPOKE_COUNT = 6 lands exactly on it precisely because
// the divisor is this wheel's own spoke count: the breath cycle is one
// spoke-count's worth of heartbeats. A real fit, not forced -- reuses
// SPOKE_COUNT itself (above) rather than a duplicated magic 12.
export function bpmToMasterPulsesPerSecond(bpm) {
  return (bpm / 60) * PULSES_PER_BEAT;
}

// How many master pulses one breath cycle spans, at ANY tempo -- not just
// GROUNDING_BPM specifically. Derivation: breath period (seconds) =
// 60 * SPOKE_COUNT / bpm (since breaths/min = bpm / SPOKE_COUNT); pulses
// = period * bpmToMasterPulsesPerSecond(bpm) = period * (bpm/60) *
// PULSES_PER_BEAT. The bpm term cancels exactly, leaving a pure constant:
// SPOKE_COUNT * PULSES_PER_BEAT = 12 * 3 = 36. Expressed as the identity
// itself, not the pre-computed 36, so it stays correct if either constant
// ever changes.
export const BREATH_CYCLE_PULSES = SPOKE_COUNT * PULSES_PER_BEAT;
export function masterPulsesPerSecondToBpm(pulsesPerSecond) {
  return (pulsesPerSecond / PULSES_PER_BEAT) * 60;
}

// Grand convergence's own real period, named -- sequencer.js's own
// "recurs every 72 master pulses" comment already relied on this number
// without a name attached to it. Each ring's own full lap length in
// master pulses is SPOKE_COUNT / ringSpeedMultiplier(ring) = SPOKE_COUNT
// * MAX_RING_WEIGHT / RING_SPEED_WEIGHT[ring] -- 24/18/12 for
// given/received/made. All three rings land back on spoke 1
// simultaneously at the LCM of their own three lap lengths -- computed
// directly from RING_SPEED_WEIGHT here (not hand-verified and hardcoded),
// so this stays correct if the 6:8:12 ratio itself is ever revisited.
function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
function lcm(a, b) { return (a / gcd(a, b)) * b; }
const RING_LAP_LENGTHS = Object.values(RING_SPEED_WEIGHT).map((w) => (SPOKE_COUNT * MAX_RING_WEIGHT) / w);
export const GRAND_CONVERGENCE_PULSES = RING_LAP_LENGTHS.reduce(lcm);

// How many transposition steps of `stepSpokes` it takes to visit every
// position and return home -- SPOKE_COUNT / gcd(SPOKE_COUNT, stepSpokes),
// the standard cyclic-group-order formula (at the default step of 7,
// gcd(7,12)=1, so this is 12 -- the full circle of fifths). Used by the
// procession-history spiral readout (main.js/view.js) as the real,
// discrete "the current transposition series has closed" event -- the
// same formula this file's own onTraceLoop comments already stated in
// prose, now a real reusable function instead of just prose.
export function transpositionCycleSteps(stepSpokes) {
  return SPOKE_COUNT / gcd(SPOKE_COUNT, stepSpokes);
}
