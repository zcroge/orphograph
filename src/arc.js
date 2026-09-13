// The input-driven intensity arc -- "a fully input-driven, procession-
// dynamic song structure that can cover anything from hypnotic, heavy
// djent-inspired metal... to the sparse, meditative and monastic
// arrangement style... shorter phrases/single words will be more apt to
// produce either shorter parts or sparser compositions, while longer
// phrases/per-word procession-sequences might end up making more
// structural or aesthetic sense."
//
// Three real trace statistics, each with exactly one job (same discipline
// MUSIC-STRUCTURE-PLAN.md already holds itself to for pitch/scale/voicing):
//   phrase length (already drives the transposition-series clock's own
//     period, main.js's seriesTotalMasterPulses)   -> the arc's PERIOD
//   word count (W)                                  -> the arc's CEILING
//   word-length SEQUENCE                            -> the arc's SHAPE
//
// "Shorter phrases -> sparser": W=1 gives ceiling=0 by construction, no
// special case -- a single word IS the monastic pole, the brief's own
// sentence falling directly out of the formula. The established
// vocabulary for "a sequence of lengths as a shape" is Carnatic yati
// (sama/srotovaha/gopuccha/mridanga/damaru/vishama) -- classifying a
// phrase's own word-length sequence this way is an honest, real
// classification, not an invented curve.
//
// Pure structure math, no Web Audio, no DOM -- sibling to src/voicing.js
// and src/rhythm.js. Callers (main.js) read arc.ceiling/arc.yati for a
// readout, call arcIntensityAt(arc, p) every frame (p = the ALREADY-
// COMPUTED transposition-series clock's own 0..1 progress, main.js's
// seriesStartPulse/seriesTotalMasterPulses -- see arcIntensityAt's own
// comment for why this clock and not a new one), and stageForIntensity to
// pick a row from ARC_STAGES.

import { SPOKE_COUNT, PULSES_PER_BEAT } from "./wheel.js";

// SPOKE_COUNT / PULSES_PER_BEAT = 4 -- not a chosen number, the same
// derived-identity pattern BREATH_CYCLE_PULSES (SPOKE_COUNT *
// PULSES_PER_BEAT) already uses in wheel.js, just divided instead of
// multiplied. It also happens to land on the standard metric subdivision
// ladder for a 12/8 bar (eighth/sixteenth/sixteenth-triplet/thirty-second),
// which is why it doubles as the pattern engine's own subdivision range.
export const ARC_STAGE_COUNT = SPOKE_COUNT / PULSES_PER_BEAT;

// One row per stage -- same shape as main.js's own VIBE_PRESETS ("one
// named object reconfigures many structural levers simultaneously").
// Subdivision and tierEmphasis are pure formulas (subdivisionForStage/
// tierEmphasisForStage below); only the truly discrete choices (pattern
// mode, per-ring performance mode, guitar behavior) need a table at all.
// `halfTime`/`polymeter`/`chirp` are new, additive fields -- "not djent...
// half-time, breakdown, and a high-register chirp layer." Only the top
// stage gets them: half-time and true polymetric phasing (see rhythm.js's
// own polyFine/polyN) are specifically HEAVY-intensity genre techniques,
// not something a processional/driving passage should already sound like.
export const ARC_STAGES = [
  { name: "monastic", percussionPatternMode: "sparse", ringModes: { given: "melody", received: "melody", made: "melody" }, guitar: "off", halfTime: false, polymeter: false, chirp: false },
  { name: "processional", percussionPatternMode: "resultant", ringModes: { given: "melody", received: "melody", made: "melody" }, guitar: "pedal", halfTime: false, polymeter: false, chirp: false },
  { name: "driving", percussionPatternMode: "woven", ringModes: { given: "chordPluck", received: "melody", made: "arpeggio" }, guitar: "pedal+letring", halfTime: false, polymeter: false, chirp: true },
  { name: "djent", percussionPatternMode: "woven", ringModes: { given: "chordPluck", received: "arpeggio", made: "arpeggio" }, guitar: "riff", halfTime: true, polymeter: true, chirp: true },
];

export function subdivisionForStage(stage) {
  return stage + 1; // 1/2/3/4 -- n = SPOKE_COUNT * s becomes 12/24/36/48
}

export function tierEmphasisForStage(stage) {
  // 1.00 / 0.66 / 0.33 / 0.00 -- monastic keeps the hard tier gate
  // (each ring only its own letters, the sparsest reading); djent hands
  // every ring the whole phrase (see main.js's own tierEmphasis comment:
  // "0.0 makes every ring voice the whole phrase equally").
  return ARC_STAGE_COUNT <= 1 ? 0 : 1 - stage / (ARC_STAGE_COUNT - 1);
}

// Carnatic yati -- named shapes an ordered sequence of durations/lengths
// can take (sama = equal, srotovaha = expanding, gopuccha = contracting,
// mridanga = expand-then-contract, damaru = contract-then-expand, vishama
// = irregular). Classifies a REAL word-length sequence; does not invent
// one. `DOGMAN SHORE K-T`'s own word lengths [6,4,2] are a textbook
// gopuccha -- the project's own canonical test phrase already has a named
// classical rhythmic shape.
export function classifyYati(lengths) {
  if (lengths.length < 2) return "sama";
  const diffs = [];
  for (let i = 0; i < lengths.length - 1; i++) diffs.push(Math.sign(lengths[i + 1] - lengths[i]));
  if (diffs.every((d) => d === 0)) return "sama";
  if (diffs.every((d) => d >= 0)) return "srotovaha"; // some d>0 guaranteed (not all-zero, just excluded)
  if (diffs.every((d) => d <= 0)) return "gopuccha";

  let peakIdx = 0;
  for (let i = 1; i < lengths.length; i++) if (lengths[i] > lengths[peakIdx]) peakIdx = i;
  let isMridanga = peakIdx > 0 && peakIdx < lengths.length - 1;
  for (let i = 0; isMridanga && i < peakIdx; i++) if (lengths[i + 1] < lengths[i]) isMridanga = false;
  for (let i = peakIdx; isMridanga && i < lengths.length - 1; i++) if (lengths[i + 1] > lengths[i]) isMridanga = false;
  if (isMridanga) return "mridanga";

  let troughIdx = 0;
  for (let i = 1; i < lengths.length; i++) if (lengths[i] < lengths[troughIdx]) troughIdx = i;
  let isDamaru = troughIdx > 0 && troughIdx < lengths.length - 1;
  for (let i = 0; isDamaru && i < troughIdx; i++) if (lengths[i + 1] > lengths[i]) isDamaru = false;
  for (let i = troughIdx; isDamaru && i < lengths.length - 1; i++) if (lengths[i + 1] < lengths[i]) isDamaru = false;
  if (isDamaru) return "damaru";

  return "vishama";
}

// Manual-override shapes -- used only when the owner picks a named shape
// instead of the derived one (see main.js's arc-shape select), replacing
// the SHAPE while the derived ceiling/period stay real. Deterministic, not
// an attempt at a "real" yati performance (no tradition specifies exact
// numbers for a synthetic sequence of arbitrary length W) -- honestly a
// convenience shape, not a second derivation.
export function synthesizeYatiShape(name, W) {
  if (W <= 0) return [];
  const mid = (W - 1) / 2;
  const seq = [];
  for (let i = 0; i < W; i++) {
    switch (name) {
      case "srotovaha": seq.push(i + 1); break;
      case "gopuccha": seq.push(W - i); break;
      case "mridanga": seq.push(Math.round(mid - Math.abs(i - mid)) + 1); break;
      case "damaru": seq.push(Math.round(Math.abs(i - mid)) + 1); break;
      case "vishama": seq.push(1 + ((i * 7) % W)); break; // a fixed, deterministic scramble -- "irregular," never Math.random()
      case "sama":
      default: seq.push(1); break;
    }
  }
  return seq;
}

// The one entry point for deriving an arc from a phrase's own words.
// `words` is the woven trace's own word list (main.js's currentWords,
// splitIntoWords(trace) -- see trace.js) -- the WOVEN trace deliberately,
// same reasoning as the pattern engine's own tierLetterCount: a Response
// step genuinely changes what's actually played, so the census should
// read what's actually played, not just what was typed.
export function deriveArc({ words }) {
  const W = words.length;
  const lengths = words.map((w) => w.length);
  const Lmin = W ? Math.min(...lengths) : 0;
  const Lmax = W ? Math.max(...lengths) : 0;
  // W=1 -> ceiling=0 by construction -- "a single word is more apt to
  // produce a sparser composition" falls directly out of this, no special
  // case. SPOKE_COUNT-1 as the divisor: 12 words is one word per spoke,
  // the point at which the phrase saturates the wheel.
  const ceiling = W <= 1 ? 0 : Math.min(1, (W - 1) / (SPOKE_COUNT - 1));
  return { W, lengths, Lmin, Lmax, ceiling, yati: classifyYati(lengths) };
}

// The arc's live intensity at progress `p` (0..1) through the current
// transposition series -- see main.js's own seriesStartPulse/
// seriesTotalMasterPulses/checkSeriesClosed. That clock (NOT a new one) is
// the arc's period for a real, load-bearing reason: it is ALREADY a
// phrase-length-derived total duration for "the whole self-resolving
// form" (computeGivenLapRingPulses reads the actual trace content), so a
// short phrase's arc already completes faster than a long phrase's, with
// zero new plumbing. The arc doesn't END the piece when p wraps back to
// 0 -- nothing in this engine ever stops on its own -- it resolves and
// restarts, the same "a real, periodic conjunction within continuous
// motion" philosophy this engine already states for grand convergence.
//
// `overrideShapeName` (one of synthesizeYatiShape's names, or null for the
// real derived shape) lets a manual "arc-shape" selection replace the
// SHAPE only -- the ceiling and period stay real either way.
export function arcIntensityAt(arc, p, overrideShapeName = null) {
  if (arc.W === 0) return 0;
  const wrapped = ((p % 1) + 1) % 1; // defensive -- p should already be in [0,1) but never trust a caller's clock past a phase boundary
  const lengths = overrideShapeName ? synthesizeYatiShape(overrideShapeName, arc.W) : arc.lengths;
  const lo = overrideShapeName ? Math.min(...lengths) : arc.Lmin;
  const hi = overrideShapeName ? Math.max(...lengths) : arc.Lmax;
  const i = Math.min(arc.W - 1, Math.floor(wrapped * arc.W));
  const shape = hi === lo ? 1 : (lengths[i] - lo) / (hi - lo);
  return arc.ceiling * shape;
}

export function stageForIntensity(I) {
  return Math.max(0, Math.min(ARC_STAGE_COUNT - 1, Math.floor(I * ARC_STAGE_COUNT)));
}

// A live readout string -- "always show what was derived," the same
// convention the scale field already follows (main.js's
// whistleScaleInput.value = derived.join(", ")).
export function describeArc(arc, I) {
  const stage = stageForIntensity(I);
  return `W=${arc.W} · ceiling ${arc.ceiling.toFixed(2)} · shape ${arc.yati} · I=${I.toFixed(2)} · stage ${stage} (${ARC_STAGES[stage].name})`;
}
