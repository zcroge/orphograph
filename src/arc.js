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
//   each word's OBSTRUENT SHARE (ringForLetter's own given/received
//     census, already computed for a velocity gate at main.js:1081 and
//     nowhere else) -> the arc's live INTENSITY, directly, per word
//   word count (W)                                  -> `ceiling`, now the
//     amount of DEVELOPMENT MATERIAL available (a later phase's job; see
//     its own comment below) -- intensity no longer multiplies by it
//   word-length SEQUENCE                            -> the arc's SHAPE
//     (yati classification, still real, still unmultiplied by anything)
//
// This replaces an earlier version that reduced a word to `word.length`
// and min-max-normalized THAT across the phrase's own words -- which
// pins the shortest word of every phrase to intensity 0 and the longest
// to `ceiling` BY CONSTRUCTION, no matter what either word actually
// contains. Two words with equal letter counts produced byte-identical
// intensity; a phrase's own most obstruent, most "djent-shaped" word
// could be assigned the LOWEST intensity in the phrase for the crime of
// being short. Obstruent share is a real, per-word, unnormalized
// phonetic signal -- it does not need every OTHER word in the phrase to
// know how loud one word should be.
//
// "Shorter phrases -> sparser" still holds, now for an honest reason: a
// short word is more likely to be dominated by its few sonorants (vowels
// carry no obstruent weight), and W=1 still means zero material to
// develop with (see `ceiling`'s own comment). The established vocabulary
// for "a sequence of lengths as a shape" is Carnatic yati (sama/
// srotovaha/gopuccha/mridanga/damaru/vishama) -- classifying a phrase's
// own word-length sequence this way is an honest, real classification,
// not an invented curve.
//
// Pure structure math, no Web Audio, no DOM -- sibling to src/voicing.js
// and src/rhythm.js. Callers (main.js) read arc.ceiling/arc.yati for a
// readout, call arcIntensityAt(arc, p) every frame (p = the ALREADY-
// COMPUTED transposition-series clock's own 0..1 progress, main.js's
// seriesStartPulse/seriesTotalMasterPulses -- see arcIntensityAt's own
// comment for why this clock and not a new one), and stageForIntensity to
// pick a row from ARC_STAGES.

import { SPOKE_COUNT, PULSES_PER_BEAT } from "./wheel.js";
import { ringForLetter } from "./letters.js";
import { relate } from "./motif.js";

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

// A word's phoneme-class census via letters.js's own ringForLetter --
// the SAME classification main.js:1081 already computes per letter-hit
// for a velocity gate, just tallied across a whole word instead of read
// one letter at a time. `unsettled` (ringForLetter returns undefined --
// "sounds on every ring", letters.js:219-223) is tracked but does not
// enter `weight`: it is neither an obstruent nor a sonorant statement.
function censusForWord(word) {
  const census = { given: 0, received: 0, made: 0, unsettled: 0 };
  for (const entry of word) {
    const tier = ringForLetter(entry.letter);
    if (tier === "given" || tier === "received" || tier === "made") census[tier] += 1;
    else census.unsettled += 1;
  }
  return census;
}

// Obstruent share, 0..1 -- the given+received census over the word's own
// length. A word of pure sonorants (vowels, nasals, liquids, glides)
// scores 0; a word of pure voiceless/voiced obstruents (stops, fricatives)
// scores 1. This is the phonetic signal that used to do exactly one job
// (a velocity gate, main.js:1081) and otherwise vanished after spoke
// assignment -- re-entering it here is what makes the arc's intensity a
// property of THIS word, not a rank among its neighbors.
function weightForCensus(census, wordLength) {
  return wordLength > 0 ? (census.given + census.received) / wordLength : 0;
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
  const censuses = words.map(censusForWord);
  const weights = censuses.map((c, i) => weightForCensus(c, lengths[i]));
  const Lmin = W ? Math.min(...lengths) : 0;
  const Lmax = W ? Math.max(...lengths) : 0;
  // `ceiling` no longer multiplies intensity (see arcIntensityAt) -- a
  // word's own obstruent share IS its intensity, full stop, regardless of
  // how many other words share the phrase. What W actually measures is
  // how much MATERIAL there is to develop a form out of (relations
  // between consecutive words, a later phase's job) -- a one-word phrase
  // has zero word-to-word relations to develop by, which is the honest
  // version of "a single word is more apt to produce a sparser
  // composition," not a manufactured intensity cap. SPOKE_COUNT-1 as the
  // divisor: 12 words is one word per spoke, the point at which the
  // phrase saturates the wheel.
  const ceiling = W <= 1 ? 0 : Math.min(1, (W - 1) / (SPOKE_COUNT - 1));
  return { W, lengths, censuses, weights, Lmin, Lmax, ceiling, yati: classifyYati(lengths) };
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
// Intensity IS the current word's own obstruent share -- no normalization
// against the phrase's other words, no ceiling multiply. `overrideShapeName`
// (one of synthesizeYatiShape's names, or null for the real derived
// weights) replaces the WEIGHT SEQUENCE with a synthetic 0..1 shape, for
// when the owner wants a deterministic dynamic curve instead of the
// phrase's own phonetics -- still returned directly, still unmultiplied.
export function arcIntensityAt(arc, p, overrideShapeName = null) {
  if (arc.W === 0) return 0;
  const wrapped = ((p % 1) + 1) % 1; // defensive -- p should already be in [0,1) but never trust a caller's clock past a phase boundary
  const i = Math.min(arc.W - 1, Math.floor(wrapped * arc.W));
  if (!overrideShapeName) return arc.weights[i];
  const synth = synthesizeYatiShape(overrideShapeName, arc.W);
  const lo = Math.min(...synth);
  const hi = Math.max(...synth);
  return hi === lo ? 1 : (synth[i] - lo) / (hi - lo);
}

export function stageForIntensity(I) {
  return Math.max(0, Math.min(ARC_STAGE_COUNT - 1, Math.floor(I * ARC_STAGE_COUNT)));
}

// A live readout string -- "always show what was derived," the same
// convention the scale field already follows (main.js's
// whistleScaleInput.value = derived.join(", ")).
export function describeArc(arc, I) {
  const stage = stageForIntensity(I);
  return `W=${arc.W} · weight I=${I.toFixed(2)} · shape ${arc.yati} · ceiling ${arc.ceiling.toFixed(2)} · stage ${stage} (${ARC_STAGES[stage].name})`;
}

// Form traversal and developing variation -- "a rich, stylized pattern...
// informed by the content of the pattern" needs an actual FORM, not just
// a louder/quieter arc. `classifyYati` (above) is a real, content-derived
// reading of the phrase's own word-length sequence, and until now it fed
// nothing but this readout string -- a real classification computed and
// then thrown away. This gives it the structural job it was always
// shaped for: yati selects which of six named, real compositional
// TRAVERSAL STRATEGIES deploys the phrase's own words across the arc.
// Each strategy returns an ordered list of "subsets" (word-index arrays)
// -- one subset per pass -- so a loop through a phrase becomes a FORM.
//
// All six degrade to a single one-word subset at W<=1 (no special case
// needed): a phrase with nothing to develop just states its one word,
// forever, matching Phase 1's own "a one-word phrase cannot develop
// because it contains no relations to develop by."
function sama(W) {
  return [Array.from({ length: W }, (_, i) => i)]; // "equal" -- the same full pass every time, ostinato/colotomic loop
}
function srotovaha(W) {
  const subsets = [];
  for (let size = 1; size <= W; size++) subsets.push(Array.from({ length: size }, (_, i) => i));
  return subsets; // "expanding" -- Glass additive process
}
function gopuccha(W) {
  const subsets = [];
  for (let size = W; size >= 1; size--) subsets.push(Array.from({ length: size }, (_, i) => i));
  return subsets; // "contracting" -- Schoenbergian liquidation
}
function mridanga(W) {
  return [...srotovaha(W), ...gopuccha(W).slice(1)]; // expand then contract -- arch form (the full-W peak isn't repeated)
}
function damaru(W) {
  return [...gopuccha(W), ...srotovaha(W).slice(1)]; // contract then expand -- hourglass (the size-1 trough isn't repeated)
}
function vishama(W) {
  const subsets = [];
  for (let n = 0; n < W; n++) subsets.push(Array.from({ length: W }, (_, i) => (n + i) % W));
  return subsets; // "irregular" -- Stravinsky rotational array: pass n starts at word n
}
const YATI_TRAVERSAL = { sama, srotovaha, gopuccha, mridanga, damaru, vishama };

// The one entry point for "which words are in play on traversal pass N."
// `yati` is one of classifyYati's own return values; unrecognized names
// (there shouldn't be any -- classifyYati is exhaustive) fall back to
// `sama`, the least eventful choice, rather than throwing.
export function subsetsForTraversal(yati, W) {
  if (W <= 0) return [[]];
  const fn = YATI_TRAVERSAL[yati] || sama;
  return fn(Math.max(1, Math.round(W)));
}

// The phrase's own measured transformation VOCABULARY -- every DISTINCT,
// non-identity relation `relate` (motif.js) finds between CYCLICALLY
// consecutive motifs (word i to word i+1, and -- the phrase's own
// "return to start," the same relation the CADENCE structural function
// measures -- the last word back to the first), deduplicated. This is
// "the elementary motif around which bespoke riffs can be designed" made
// literal: the transform applied at any structural juncture is one the
// input itself already performs somewhere, never picked from a menu.
// Cyclic, not just consecutive-pairs, because a W-word phrase's own
// closed form has exactly W real relations to measure, not W-1 -- and
// without the wrap-around relation, a 3-word phrase can only ever offer
// 2 vocabulary members, capping development one step short of what the
// phrase's own full cycle actually contains (verified directly: DOGMAN
// SHORE K-T's wrap-around K-T->DOGMAN relation is a real, distinct T_0
// best-fit with residual 0.43 -- not an exact repeat, so it's real
// vocabulary, and it's what makes this phrase's own maxDepth reach 3).
//
// Only a LITERAL exact repeat (`residual === 0` AND `n === 0`) is
// excluded -- it develops nothing. A best-fit rotation that happens to
// land on n=0 despite a NONZERO residual is not an identity -- it means
// "these sets overlap most without rotating, but they are not the same
// set" -- and an exact mirror or exact non-zero rotation counts as real
// vocabulary too, even though it's an EXACT match, because applying it
// still changes what's heard.
export function vocabularyOf(motifs) {
  const vocab = [];
  const seen = new Set();
  const W = motifs.length;
  for (let i = 0; i < W; i++) {
    const j = (i + 1) % W;
    if (i === j) continue; // W<=1 -- nothing to relate, empty vocabulary
    const r = relate(motifs[i].pcSet, motifs[j].pcSet, {
      orderedA: motifs[i].spokes,
      orderedB: motifs[j].spokes,
    });
    if (!r) continue;
    if (r.op.type === "rotate" && r.op.n === 0 && r.residual === 0) continue; // a literal exact repeat -- develops nothing
    const key = JSON.stringify(r.op);
    if (seen.has(key)) continue;
    seen.add(key);
    vocab.push(r.op);
  }
  return vocab;
}

// Depth escalation: `traversal` is a 0-indexed lap count (main.js's own
// given-ring onTraceLoop, already firing every real lap); `S` is the
// traversal strategy's own subset count (subsetsForTraversal(...).length);
// `maxDepth` is the vocabulary's own size (vocabularyOf(...).length) --
// a phrase can never develop past the number of distinct relations it
// actually contains. `DOGMAN SHORE K-T` (gopuccha, S=3) escalates
// 0,0,0,1,1,1,2,2,2,3,3,3 across a 12-lap series -- a twelve-section form
// from a three-word phrase, contracting in material (subset) while
// escalating in transformation (depth), closing exactly when the
// transposition series itself closes.
export function depthAt(traversal, S, maxDepth) {
  if (S <= 0) return 0;
  return Math.min(maxDepth, Math.floor(Math.max(0, traversal) / S));
}

function opLabel(op) {
  if (op.type === "rotate") return `T${op.n}`;
  if (op.type === "mirror") return `I${op.n || 0}`;
  if (op.type === "retrograde") return "R";
  if (op.type === "retrograde-invert") return "RI";
  return op.type;
}

// A live readout string -- "always show what was derived," same
// convention describeArc/the scale field already follow.
export function describeTraversal({ subsetIndex, S, depth, chain }) {
  const chainLabel = chain.length ? chain.map(opLabel).join("+") : "prime";
  return `pass ${subsetIndex + 1}/${S} · depth ${depth} · chain ${chainLabel}`;
}

// Five structural functions -- what a WORD *is* within the phrase's own
// form, measured from `relate`'s own residual against a threshold
// derived from the word's own size (theta_i = 1/cardinality(M_i): "one
// element changed out of the cell's own size" -- a 2-note cell losing one
// note is a different cell; a 6-note cell losing one note is the same
// cell varied). Not a tuned constant -- it comes from the word being
// judged, not a global knob.
//
// CADENCE takes precedence over every other label when it applies,
// exactly like a real cadence overriding whatever harmonic function came
// before it: either the word is literally the phrase's last (the form
// has nowhere left to go), or it measures as an exact return to the
// PHRASE'S OWN OPENING motif (residual 0 against M_0) -- "the form has
// come home" is a real event even mid-phrase, the same *sam*/korvai
// resolution Carnatic rhythm names.
//
// Verified against both of this project's own worked phrases: `DOGMAN
// SHORE K-T` -> [STATEMENT, CONTRAST, CADENCE]; `PIK TAK SHOK KOT` ->
// [STATEMENT, RESTATEMENT, DEVELOPMENT, CADENCE] -- a textbook four-bar
// phrase, measured, not imposed, already latent in ordinary phonetic
// input.
export function formFunctionsOf(motifs) {
  const W = motifs.length;
  const labels = [];
  for (let i = 0; i < W; i++) {
    if (i === 0) {
      labels.push("STATEMENT");
      continue;
    }
    const isLastWord = i === W - 1;
    // "Returned home" requires having LEFT home first -- checked only for
    // i > 1, since word 1 relating exactly back to word 0 is just what an
    // immediate RESTATEMENT looks like (real cadences travel away and
    // resolve back; they aren't the very next chord). Without this guard,
    // a tightly motivic phrase where every word relates exactly to its
    // neighbor (PIK TAK SHOK KOT's own PIK->TAK) would misfire CADENCE one
    // word early -- caught directly against this project's own worked
    // example, which the design doc claims should read RESTATEMENT here.
    const home = i > 1 ? relate(motifs[i].pcSet, motifs[0].pcSet, {
      orderedA: motifs[i].spokes,
      orderedB: motifs[0].spokes,
    }) : null;
    const hasReturnedHome = !!home && home.residual === 0;
    if (isLastWord || hasReturnedHome) {
      labels.push("CADENCE");
      continue;
    }
    const r = relate(motifs[i - 1].pcSet, motifs[i].pcSet, {
      orderedA: motifs[i - 1].spokes,
      orderedB: motifs[i].spokes,
    });
    const residual = r ? r.residual : 1; // no relation possible (mismatched degenerate input) -- treat as maximal contrast, never crash
    const theta = 1 / Math.max(1, motifs[i].cardinality);
    if (residual === 0) labels.push("RESTATEMENT");
    else if (residual <= theta) labels.push("DEVELOPMENT");
    else labels.push("CONTRAST");
  }
  return labels;
}

export function describeForm(motifs) {
  return motifs.length ? formFunctionsOf(motifs).join(" > ") : "";
}
