// The motif engine -- "use our input almost as an elementary motif,
// around which the bespoke djent/metalcore riffs can be designed... a
// rich, stylized pattern or composition informed by the content of the
// pattern, not just 'density' of notes." A word becomes a Motif: a closed
// set of properties DERIVED from its own letters, read (never authored)
// by every voice through its own fixed lens (see main.js's ring lenses
// and rhythm.js's patternsForMotif). "One motif, many readers" -- a voice
// may choose which IMAGE of the motif it reads; it may never invent
// content, the same discipline this engine's "one AudioParam, one owner"
// already holds itself to, one level up.
//
// Pure spoke-domain math, no Web Audio, no DOM -- sibling to src/
// voicing.js, src/rhythm.js, src/arc.js.
//
// The load-bearing identity this whole module rests on: SPOKE_COUNT=12
// and hzForSpoke is one semitone per spoke (letters.js), so a word's own
// spoke set is SIMULTANEOUSLY a pitch-class set (Z12) and a 12-step onset
// vector (spoke s present = "onset on pulse s of the bar," PULSES_PER_BEAT
// * 4 = 12 = one 12/8 bar). These are not analogous -- they are the same
// twelve numbers -- which is why one D12 operation (wheel.js's own
// rotateSpoke/mirrorSpoke, already the wheel's dihedral group) transposes
// harmony and displaces rhythm coherently and simultaneously, for free.

import { SPOKE_COUNT, normalizeSpoke, rotateSpoke, mirrorSpoke } from "./wheel.js";
import { ringForLetter } from "./letters.js";
import { wordArc, wordHandedness } from "./trace.js";
import { signedArcDistance } from "./voicing.js";
import { euclid } from "./rhythm.js";

// Moved verbatim from voicing.js (was module-private there) -- voicing.js
// re-imports this so voiceWord's rule 6 stays byte-for-byte unchanged.
// Exact-or-null, unordered-SET comparison only (rotate then plain mirror,
// n=0 only) -- deliberately NOT the generalized `relate` below, which
// checks a wider family (general I_n, ordered R/RI, best-fit) that would
// change which word-to-word pairs voiceWord treats as "the same chord."
export function findSetTransform(prevPcs, nextPcs) {
  if (!prevPcs || !nextPcs || prevPcs.length === 0 || prevPcs.length !== nextPcs.length) return null;
  const nextSet = new Set(nextPcs.map(normalizeSpoke));
  const matches = (apply) => {
    const transformed = new Set(prevPcs.map((s) => normalizeSpoke(apply(s))));
    if (transformed.size !== nextSet.size) return false;
    for (const s of nextSet) if (!transformed.has(s)) return false;
    return true;
  };
  for (let n = 0; n < SPOKE_COUNT; n++) {
    if (matches((s) => rotateSpoke(s, n))) return { type: "rotate", n, apply: (s) => rotateSpoke(s, n) };
  }
  if (matches(mirrorSpoke)) return { type: "mirror", apply: mirrorSpoke };
  return null;
}

// Forte-style interval-class vector, ic1..ic6 -- the one similarity
// measure invariant under all of D12 (transposition AND inversion): two
// motifs with the same IC vector are heard as the same harmonic colour
// even when no single rotate/mirror maps one directly onto the other.
// O(k^2) over k <= SPOKE_COUNT, trivial cost. `pcSet` should already be
// unique spokes (a Motif's own pcSet always is); duplicates are
// tolerated (deduped here) but not expected from a real caller.
export function intervalVector(pcSet) {
  const vec = [0, 0, 0, 0, 0, 0]; // ic1..ic6
  const unique = [...new Set(pcSet.map(normalizeSpoke))];
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const d = Math.abs(unique[i] - unique[j]) % SPOKE_COUNT;
      const ic = Math.min(d, SPOKE_COUNT - d);
      if (ic >= 1 && ic <= 6) vec[ic - 1] += 1;
    }
  }
  return vec;
}

// 0..1, a closed formula (not a knob): 1.0 exactly at the Euclidean
// pattern of the SAME onset count -- "keep the density, restore metric
// legibility" is what evenness < 1 measures the DISTANCE from. `onsets`
// is a boolean[SPOKE_COUNT] (a Motif's own onsets field, or any 12-vector
// -- rhythm.js's own patterns are the same shape). Trivially even (1.0)
// at k=0 (nothing to be uneven about), k=1, or k=SPOKE_COUNT (maxDev=0 in
// both those last two cases, division-by-zero avoided by definition, per
// the design doc).
export function evenness(onsets) {
  const positions = [];
  for (let i = 0; i < SPOKE_COUNT; i++) if (onsets[i]) positions.push(i);
  const k = positions.length;
  if (k === 0 || k === 1 || k === SPOKE_COUNT) return 1;

  const gapsOf = (pos) =>
    pos.map((p, i) => {
      const next = pos[(i + 1) % pos.length];
      const raw = (next - p + SPOKE_COUNT) % SPOKE_COUNT;
      return raw === 0 ? SPOKE_COUNT : raw; // a single onset's own "gap to itself" is the full lap; unreachable here (k>=2) but keeps the helper honest
    });
  const mean = SPOKE_COUNT / k;
  const devOf = (gaps) => gaps.reduce((sum, g) => sum + Math.abs(g - mean), 0);

  const dev = devOf(gapsOf(positions));
  const euclidPattern = euclid(k, SPOKE_COUNT);
  const euclidPositions = [];
  for (let i = 0; i < SPOKE_COUNT; i++) if (euclidPattern[i]) euclidPositions.push(i);
  const devEuclid = devOf(gapsOf(euclidPositions));
  const maxDev = (2 * (k - 1) * (SPOKE_COUNT - k)) / k;

  if (maxDev === devEuclid) return 1; // degenerate (shouldn't occur for 2<=k<=11, guarded anyway)
  return (maxDev - dev) / (maxDev - devEuclid);
}

// Applies one relate() op to an ORDERED spoke sequence -- used both to set
// `relate`'s own `ordered` flag and by later phases (development at
// render time, see the plan's arc reframe) to actually transform a
// motif's color. Reuses wheel.js's own operators exclusively; no new
// geometry invented.
export function applyMotifOp(seq, op) {
  switch (op.type) {
    case "rotate": return seq.map((s) => rotateSpoke(s, op.n));
    case "mirror": return seq.map((s) => rotateSpoke(mirrorSpoke(s), op.n || 0));
    case "retrograde": return [...seq].reverse();
    case "retrograde-invert": return [...seq].reverse().map((s) => mirrorSpoke(s));
    default: return seq.slice();
  }
}

function arraysEqualAsSpokes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (normalizeSpoke(a[i]) !== normalizeSpoke(b[i])) return false;
  return true;
}

// The generalized, exported successor to findSetTransform -- "the
// transform applied at a structural juncture is one the input itself
// already performs somewhere." Resolution ladder, first hit wins, ordered
// by DOCUMENTED PERCEPTUAL SALIENCE (listeners recognize transposition
// well, inversion weakly, retrograde essentially not at all -- see the
// design doc's research section): exact T_n on pcSets, then exact I_n
// (general inversion = mirror + any rotation, T_n composed with I -- the
// wheel's own D12, wheel.js:32-37's own comment), then exact R/RI on the
// ORDERED sequences (only checked when both are supplied -- today's
// unordered-set-only check, findSetTransform above, discards order
// entirely), then a BEST-FIT rotation when nothing is exact: most real
// word pairs are only NEARLY related, and returning null (as
// findSetTransform does) throws that information away.
//
// `pcSetA`/`pcSetB`: arrays of spokes (a Motif's own `pcSet`, sorted
// unique). `opts.orderedA`/`opts.orderedB`: the motifs' own `spokes`
// (ordered, with repeats) -- optional; R/RI can't be checked and
// `ordered` is always false without them.
//
// Returns `{ op, residual, ordered }` or `null` only when an input itself
// is degenerate (empty). UNLIKE findSetTransform, mismatched cardinality
// is NOT rejected -- exact T_n/I_n/R/RI can only ever match when the two
// sets are the same size (symDiffSize can only be 0 for equal-size sets,
// so those branches self-gate), but the best-fit branch (4) is exactly
// what makes two DIFFERENT-sized words comparable at all: most real word
// pairs don't share a cardinality, and `residual` (0, 1] still measures
// how close the best rotation comes, denominated over both sets' own
// sizes (|A|+|B|, not a shared cardinality that might not exist).
export function relate(pcSetA, pcSetB, opts = {}) {
  const { orderedA = null, orderedB = null } = opts;
  if (!pcSetA || !pcSetB || pcSetA.length === 0 || pcSetB.length === 0) return null;

  const a = pcSetA.map(normalizeSpoke);
  const bSet = new Set(pcSetB.map(normalizeSpoke));
  const symDiffSize = (transformed) => {
    const tSet = new Set(transformed);
    let diff = 0;
    for (const s of tSet) if (!bSet.has(s)) diff += 1;
    for (const s of bSet) if (!tSet.has(s)) diff += 1;
    return diff;
  };
  const orderedMatches = (op) =>
    !!(orderedA && orderedB && orderedA.length === orderedB.length && arraysEqualAsSpokes(applyMotifOp(orderedA, op), orderedB));

  // 1. exact T_n
  for (let n = 0; n < SPOKE_COUNT; n++) {
    if (symDiffSize(a.map((s) => rotateSpoke(s, n))) === 0) {
      const op = { type: "rotate", n };
      return { op, residual: 0, ordered: orderedMatches(op) };
    }
  }
  // 2. exact I_n (mirror composed with any rotation)
  for (let n = 0; n < SPOKE_COUNT; n++) {
    if (symDiffSize(a.map((s) => rotateSpoke(mirrorSpoke(s), n))) === 0) {
      const op = { type: "mirror", n };
      return { op, residual: 0, ordered: orderedMatches(op) };
    }
  }
  // 3. exact R / RI on the ORDERED sequences (order-sensitive; no meaning
  // as a set operation, so only reachable when both orderings are given)
  if (orderedA && orderedB && orderedA.length === orderedB.length) {
    const rOp = { type: "retrograde" };
    if (arraysEqualAsSpokes(applyMotifOp(orderedA, rOp), orderedB)) return { op: rOp, residual: 0, ordered: true };
    const riOp = { type: "retrograde-invert" };
    if (arraysEqualAsSpokes(applyMotifOp(orderedA, riOp), orderedB)) return { op: riOp, residual: 0, ordered: true };
  }
  // 4. best fit -- rotation only (the design's own choice: transposition
  // is the perceptually strongest relation, so it's what "nearly related"
  // means by default). n* = argmin |T_n(A) triangle B|.
  let best = null;
  for (let n = 0; n < SPOKE_COUNT; n++) {
    const diff = symDiffSize(a.map((s) => rotateSpoke(s, n)));
    if (!best || diff < best.diff) best = { n, diff };
  }
  const residual = best.diff / (a.length + bSet.size);
  return { op: { type: "rotate", n: best.n }, residual, ordered: false };
}

// A word's own phoneme-class census -- the SAME classification arc.js's
// own censusForWord computes (and main.js:1081 computes per-letter for a
// velocity gate); tallied here again because a Motif is a self-contained
// object a voice can read without also holding a live arc reference. The
// two are intentionally independent (arc.js keeps its own copy, kept in
// sync only by both reading the same ringForLetter law) -- see the design
// doc's own accounting of this duplication.
function censusForWord(word) {
  const census = { given: 0, received: 0, made: 0, unsettled: 0 };
  for (const entry of word) {
    const tier = ringForLetter(entry.letter);
    if (tier === "given" || tier === "received" || tier === "made") census[tier] += 1;
    else census.unsettled += 1;
  }
  return census;
}

// The one entry point: a word (array of trace entries, e.g. one of
// splitIntoWords' own returned arrays) -> a Motif. `entries` holds THE
// SAME trace entry objects passed in -- never cloned. sequencer.js's own
// wordIndexOfEntry (and main.js's wordOfEntry) rely on this exact
// reference identity via Map/Array.includes; cloning here would silently
// break direction tie-breaks and flute retuning elsewhere in the engine.
function deriveMotif(word, index) {
  const spokes = word.map((e) => e.spoke);
  const pcSet = [];
  for (const s of spokes) {
    const n = normalizeSpoke(s);
    if (!pcSet.includes(n)) pcSet.push(n);
  }
  pcSet.sort((x, y) => x - y);

  const contour = [];
  for (let i = 0; i < spokes.length - 1; i++) contour.push(signedArcDistance(spokes[i], spokes[i + 1]));

  const census = censusForWord(word);
  const weight = spokes.length > 0 ? (census.given + census.received) / spokes.length : 0;
  const obstruentTotal = census.given + census.received;
  const edge = obstruentTotal > 0 ? census.given / obstruentTotal : null;

  const onsets = new Array(SPOKE_COUNT).fill(false);
  for (const s of pcSet) onsets[normalizeSpoke(s) - 1] = true;

  return {
    index,
    entries: word,
    letters: word.map((e) => e.letter),

    spokes,
    pcSet,
    cardinality: pcSet.length,
    root: spokes[0],
    contour,
    intervalVector: intervalVector(pcSet),
    span: wordArc(word),
    handedness: wordHandedness(word),
    repeatCount: spokes.length - pcSet.length,

    census,
    weight,
    edge,

    onsets,
    density: pcSet.length / SPOKE_COUNT,
    evenness: evenness(onsets),
  };
}

// `words` -- a word list in the same shape splitIntoWords returns (and
// therefore main.js's currentWords, sequencer.js's own per-ring `words`).
// Built once per Play from the WOVEN trace, same reasoning arc.js's
// deriveArc already documents: a Response step genuinely changes what's
// actually played, so the motif census should read what's actually
// played, not just what was typed.
export function deriveMotifs(words) {
  return words.map((w, i) => deriveMotif(w, i));
}

// Real, UNFOLDED register offsets, one per letter, from the word's own
// first letter (its root) -- the cumulative sum of the word's own
// `contour` (signedArcDistance between consecutive letters, already
// computed above and, until this function, never read again anywhere).
//
// `hzForSpoke` (letters.js) is a 12-entry mod-12 lookup: every spoke maps
// into exactly ONE octave, so every melodic voice that plays
// `hzForSpoke(spoke)` per letter has always played a register-FLAT,
// octave-wrapped line -- a word whose letters climb five spokes, five
// spokes, five spokes does not climb; `signedArcDistance` always takes
// the SHORTEST arc back toward the reference spoke, silently re-wrapping
// every single step. Accumulating the word's own already-computed
// step-by-step contour instead lets a melody that keeps climbing keep
// climbing -- exactly the same per-step distances `wordArc` (trace.js)
// already sums for an unrelated purpose (chord duration) without ever
// folding them back down; this is that same real quantity, kept
// per-step instead of summed to one total, and finally given a reader.
//
// Verified against this project's own canonical word: DOGMAN's letters
// (spokes [5,7,9,2,10,5], contour [2,2,5,-4,-5]) unfold to real offsets
// [0,2,4,9,5,0] -- a rising arch of a major sixth and back home -- where
// the OLD per-letter `signedArcDistance(root, spoke)` reading would give
// [0,2,4,-3,5,0], silently wrapping the word's own 4th letter down an
// octave from where its actual melodic path actually goes.
//
// Returned offsets are in REAL semitones (not wrapped to +/-6, not
// folded to one octave) -- a caller combines this with a root Hz via
// `rootHz * 2^(offset/SPOKE_COUNT)`, the same ratio-from-semitones
// convention `voiceWord`'s own `ratio` field already uses.
export function unfoldedOffsets(motif) {
  const offsets = [0];
  let cumulative = 0;
  for (const step of motif.contour) {
    cumulative += step;
    offsets.push(cumulative);
  }
  return offsets;
}
