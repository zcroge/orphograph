// Euclidean rhythm patterns -- "a more dynamic pattern and composition
// system for our percussion." The existing resultant-rhythm mechanism
// (synth.js's playPercussionHit, triggered from main.js's onNoteHit/
// onChordHit) is an EMERGENT composite of three independently-paced ring
// sweeps landing on real geometric hits -- explicitly cited from the
// West/Central African interlocking-bell technique (A.M. Jones,
// synth.js:2699-2701). That tradition has always had two halves: a FIXED
// timeline (the bell pattern) and RESPONSIVE drums answering it. This
// engine has only ever had the responsive half. This module is the fixed
// half: Bjorklund's algorithm (Toussaint 2005), which places k onsets as
// evenly as possible across n steps and reproduces a large catalogue of
// real traditional rhythms -- E(7,12) is literally the Ewe Gahu/Ashanti
// Mpre bell pattern; E(5,12) is the Venda clapping pattern. Adding this
// completes the engine's own cited tradition; it isn't a new genre import.
//
// Pure pattern math, no Web Audio, no DOM -- sibling to src/voicing.js
// (same "pure spoke-domain math" shape). Callers (main.js's onPulse
// scheduler) turn a returned pattern into real playPercussionHit calls.

import { SPOKE_COUNT, normalizeSpoke, rotateSpoke, mirrorSpoke, gcd, lcm, PULSES_PER_BEAT } from "./wheel.js";
import { ringForLetter } from "./letters.js";
import { ROTATION_SPOKE_SHIFT } from "./transform.js";
import { chordPulseLength } from "./trace.js";

// Reuses the exact number main.js's existing "roll" pattern mode already
// uses for its own first grace-note flam -- a ghost-tier onset here is the
// same kind of quiet fill, not a second, independently-tuned magic number.
export const GHOST_VELOCITY = 0.45;

// Bjorklund's algorithm, via the classic "Euclidean algorithm on
// sequences" construction (the same repeated-division idea as gcd(a,b),
// grouping short sequences into long ones instead of remainders into
// quotients). Verified directly against four published references: E(3,8)
// = tresillo [1,0,0,1,0,0,1,0]; E(5,8) = cinquillo [1,0,1,1,0,1,1,0];
// E(5,12) = the Venda clapping pattern [1,0,0,1,0,1,0,0,1,0,1,0]; E(7,12)
// = the Ewe Gahu/Ashanti Mpre bell pattern [1,0,1,1,0,1,0,1,1,0,1,0]
// (Toussaint's own [x.xx.x.xx.x.] notation). `k` is rounded and clamped
// to [0, n] -- a fractional or out-of-range k from a live-changing
// statistic should degrade gracefully, never throw.
export function euclid(k, n) {
  if (n <= 0) return [];
  const kk = Math.max(0, Math.min(n, Math.round(k)));
  if (kk === 0) return new Array(n).fill(false);
  if (kk === n) return new Array(n).fill(true);
  let a = Array.from({ length: kk }, () => [true]);
  let b = Array.from({ length: n - kk }, () => [false]);
  while (b.length > 1) {
    const m = Math.min(a.length, b.length);
    const merged = [];
    for (let i = 0; i < m; i++) merged.push(a[i].concat(b[i]));
    const remainder = a.length > m ? a.slice(m) : b.slice(m);
    a = merged;
    b = remainder;
  }
  return a.concat(b).flat();
}

// Cyclically shifts a pattern's own content forward by `by` steps (the
// onset at index 0 moves to index `by`) -- E(k,n) is only defined up to
// rotation, so any real use of it has to pick one, and picking it
// arbitrarily would be exactly the kind of unlabeled constant this
// project's own discipline forbids. See patternsForRing's own comment for
// what this project anchors rotation to.
export function rotatePattern(pattern, by) {
  const n = pattern.length;
  if (n === 0) return pattern;
  const shift = ((by % n) + n) % n;
  if (shift === 0) return pattern.slice();
  return pattern.map((_, j) => pattern[(j - shift + n) % n]);
}

// The onset-count statistic `k` for one ring's own pattern -- how many of
// the phrase's real (non-rest) letters that ring's own tier owns, via the
// EXISTING law-grounded classification (letters.js's PLACEHOLDER_RING_OF/
// ringForLetter: voiceless obstruents -> given, voiced obstruents ->
// received, sonorants/vowels -> made). Not a new derivation -- this is the
// SAME per-letter classification the engine already uses to decide which
// ring VOICES a letter, applied one level down to decide how BUSY that
// ring's own drum is. A letter with no settled ring yet (undefined) counts
// toward none of the three -- it isn't silenced anywhere else either, but
// it also isn't a real census entry for a tier that hasn't claimed it.
export function tierLetterCount(trace, ring) {
  let count = 0;
  for (const entry of trace) {
    if (entry.isRest) continue;
    if (ringForLetter(entry.letter) === ring) count++;
  }
  return count;
}

// The one entry point. `subdivision` (1-4) is the arc layer's own `s` --
// the metric subdivision of the 12/8 bar (see src/arc.js); this module
// itself has no opinion on where that number comes from, only what to do
// with it. Two patterns come back:
//
// `coarse` -- E(k, SPOKE_COUNT), k = this ring's own tier-letter count
// (clamped to [1, SPOKE_COUNT] -- a ring with zero tier-letters in the
// phrase still gets the minimal E(1,12), one onset per lap, rather than
// silence with no pattern identity at all). This is the "real" onset grid
// at the wheel's own native 12-step resolution, used to classify which
// finer subdivisions are metrically real onsets vs. fill (see
// velocityForStep) and as the whole pattern when subdivision is 1.
//
// `fine` -- E(kFine, SPOKE_COUNT * subdivision), kFine = coarse's own k
// scaled by the same subdivision factor (so the onset RATIO, and
// therefore the pattern's own character, stays constant as subdivision
// increases -- subdividing shouldn't silently change how busy the pattern
// reads, only how finely it's articulated). This is what's actually
// scheduled onto the pulse clock.
//
// Both are rotated so their own canonical first onset lands on
// `rootSpoke` -- "root/key are determined by the first note/letter of the
// phrase" (trace.js), already law, currently only feeding the chamber.
// The wheel's own spoke grid supplies the anchor (rotation 0 = spoke 1,
// the I pole -- see main.js's onPulse, which hands this module the ring's
// live spoke position directly, so step 0 of every pattern is genuinely
// the ring standing on spoke 1); the pattern itself is anchored to the
// phrase's own declared root. Two real anchors, not one arbitrary one.
// `polyFine`/`polyN` -- real polymeter, not maximal evenness, for the
// heaviest intensity. "The current intense beat comes across as more
// drum-and-bass... not djent" -- E(k,n) at large k approaches even
// 16th-note spacing, a breakbeat signature, not a metal one. Real
// Meshuggah-style rhythm is instead built from an ODD-LENGTH repeating
// cell cycling against the fixed pulse, realigning only every so many
// bars -- this engine already has the exact right tool for that sitting
// unused: wheel.js's own gcd/lcm machinery, already used for
// GRAND_CONVERGENCE_PULSES's isorhythmic realignment. `polyN = n + 1`
// (never n-1, which could reach 0) -- consecutive integers are ALWAYS
// coprime, so gcd(n, polyN) = 1 always, which means (a) the realignment
// period is the maximum possible, lcm(n, polyN) = n * polyN, and (b) the
// polymetric cell visits every possible phase relationship against the
// grid before it repeats -- the real "takes many bars to come back
// around" quality real polymeter has, guaranteed by construction rather
// than picked by ear. Same k-scaling logic as `fine`, just against
// `polyN` instead of `n`. Consumed by a PERSISTENT, continuously
// incrementing cursor (main.js's own polymetricCursor -- deliberately
// NOT derived from the wheel's own per-lap spoke position the way `fine`
// is, since the entire point is that this cell does NOT reset when the
// wheel wraps back to spoke 1).
export function patternsForRing(trace, ring, rootSpoke, subdivision = 1) {
  const s = Math.max(1, Math.min(4, Math.round(subdivision)));
  const statRing = Math.max(1, Math.min(SPOKE_COUNT, tierLetterCount(trace, ring)));
  const n = SPOKE_COUNT * s;
  const kFine = Math.max(1, Math.min(n, statRing * s));
  const rotation = normalizeSpoke(rootSpoke) - 1;
  const polyN = n + 1;
  const kPoly = Math.max(1, Math.min(polyN, statRing * s));
  return {
    n,
    s,
    coarse: rotatePattern(euclid(statRing, SPOKE_COUNT), rotation),
    fine: rotatePattern(euclid(kFine, n), rotation * s),
    polyN,
    polyFine: rotatePattern(euclid(kPoly, polyN), rotation * s),
  };
}

// The rhythm reframe: "informed by the content of the pattern, not just
// 'density' of notes." patternsForRing above reduces a whole ring's
// tier-letter CENSUS to a single count k -- two different phrases with
// the same per-ring letter count produce byte-identical rhythms, and a
// word's own letter ORDER never reaches percussion at all. This is the
// same load-bearing identity src/motif.js's own header states: SPOKE_COUNT
// = 12 and hzForSpoke is one semitone per spoke, so a word's own spoke
// SET is simultaneously a pitch-class set and a 12-step onset vector --
// `motif.onsets` IS the bar, with no new mapping invented.
//
// Three ring LENSES, fixed by the wheel's own operator triple (not by
// taste, and not per-word): `given` = T0 (the ground states the motif as
// -is), `received` = T7 (ROTATION_SPOKE_SHIFT -- transform.js's own
// canonical answer for "no ground compels a specific rotation"), `made` =
// I (mirrorSpoke). Three rings reading three D12 images of the SAME cell
// is, precisely, three-voice isorhythmic motet writing, and precisely the
// guitar-against-kick relationship real djent/metalcore rhythm sections
// are built on -- free, because the identity above already ties pitch and
// rhythm together.
const RING_LENS = {
  given: (spoke) => spoke,
  received: (spoke) => rotateSpoke(spoke, ROTATION_SPOKE_SHIFT),
  made: (spoke) => mirrorSpoke(spoke),
};

function applyRingLens(onsets, ring) {
  const lens = RING_LENS[ring] || RING_LENS.given;
  const result = new Array(SPOKE_COUNT).fill(false);
  for (let i = 0; i < SPOKE_COUNT; i++) {
    if (!onsets[i]) continue;
    result[lens(i + 1) - 1] = true;
  }
  return result;
}

// `euclid` is retained here, demoted to a REGULARIZER for three closed,
// measured cases -- "keep the density, restore metric legibility" when a
// word's own geometry would otherwise produce a degenerate or illegible
// bar. All three conditions are measured off the motif itself, no tuning:
//   1. cardinality === 1 -- one onset isn't a pattern.
//   2. cardinality >= 10 -- a near-constant stream reads as no pattern.
//   3. evenness < 1/cardinality -- the onsets are so clumped the bar has
//      no felt pulse at all (see motif.js's own evenness formula).
// Everything else plays the word's own onsets directly.
function baseOnsetsForMotif(motif) {
  const k = motif.cardinality;
  const regularize = k === 1 || k >= 10 || motif.evenness < 1 / k;
  return regularize ? euclid(k, SPOKE_COUNT) : motif.onsets;
}

// Expands a 12-step `coarse` pattern to `n = 12*s` fine steps: each coarse
// onset lands on its own sub-step 0 (so the coarse grid is always exactly
// recoverable from the fine one, same contract velocityForStep already
// relies on), and at s>1 a proportionally-scaled Euclidean fill (SAME
// k*s scaling patternsForRing already used) supplies ghost-tier texture
// in between -- articulation detail, not a second onset source competing
// with the motif's own content.
function expandOnsets(coarse, s) {
  const n = coarse.length * s;
  const fine = new Array(n).fill(false);
  for (let i = 0; i < coarse.length; i++) if (coarse[i]) fine[i * s] = true;
  if (s > 1) {
    const k = coarse.reduce((sum, v) => sum + (v ? 1 : 0), 0);
    const kFine = Math.max(1, Math.min(n, k * s));
    const euclidFine = euclid(kFine, n);
    for (let step = 0; step < n; step++) if (euclidFine[step]) fine[step] = true;
  }
  return fine;
}

// The one entry point for the reframed rhythm engine -- same returned
// shape as patternsForRing ({n, s, coarse, fine, polyN, polyFine}) plus
// two new isorhythmic readout fields (disorientationDepth,
// realignmentBars), so every existing consumer (velocityForStep, the
// breakdown/polymeter logic in main.js's onPulse) works unchanged
// regardless of which function built the pattern; only the SOURCE of
// `coarse`/`fine`/`polyN`/`polyFine` changes.
//
// Real isorhythm, not the old "n+1, always coprime by construction"
// trick: a genuine medieval-motet TALEA (a repeating rhythmic cell,
// independent of the melodic content riding on it) needs its own
// length, and this word already has one -- `chordPulseLength` (trace.js,
// `max(MIN_CHORD_PULSES, wordArc(word))`), the SAME duration the chord/
// arpeggio ring-performance modes already use for this exact word's own
// sounding length. `motif.entries` IS the original word (the same trace
// entries splitIntoWords returned, never cloned -- see motif.js's own
// comment), so `chordPulseLength(motif.entries)` is real, not invented.
// The COLOR (the melodic cycle riding on top of the talea) is the
// motif's own `spokes.length` -- already how the guitar riff indexes
// into the motif (main.js's own accentIndex). Talea and color are
// independent by construction (one measures the word's own ARC, the
// other its own LETTER COUNT), so they only recombine identically once
// every `lcm(talea, color)` -- literally Vitry's ars nova device,
// derived from the word instead of chosen.
//
// `disorientationDepth = gcd(L, SPOKE_COUNT)` -- how much the talea
// shares with the fixed 12-pulse bar; 1 means maximal phasing (the old
// `n+1` trick's own guarantee), 12 means the talea is itself a multiple
// of the bar and NEVER phases at all (a real, honest possible outcome
// now that L is derived rather than chosen -- see this function's own
// realignmentBars). `realignmentBars = lcm(L, SPOKE_COUNT) / SPOKE_COUNT`
// -- how many bars of the fixed grid the talea takes to return to phase
// zero; the readout states this so a non-phasing word (L a multiple of
// 12) reads as a real, derived outcome, not as the feature silently
// failing.
export function patternsForMotif(motif, ring, subdivision = 1) {
  const s = Math.max(1, Math.min(4, Math.round(subdivision)));
  const coarse = applyRingLens(baseOnsetsForMotif(motif), ring);
  const n = SPOKE_COUNT * s;
  const fine = expandOnsets(coarse, s);
  const k = coarse.reduce((sum, v) => sum + (v ? 1 : 0), 0);

  const talea = chordPulseLength(motif.entries);
  const color = Math.max(1, motif.spokes.length);
  const polyN = talea * s; // fine-step-scaled, same resolution `n` is built at
  const kPoly = Math.max(1, Math.min(polyN, k * s));

  return {
    n, s, coarse, fine,
    polyN,
    polyFine: euclid(kPoly, polyN),
    talea,
    color,
    disorientationDepth: gcd(talea, SPOKE_COUNT),
    realignmentBars: lcm(talea, SPOKE_COUNT) / SPOKE_COUNT,
    // The classic isorhythmic statistic (Vitry's own talea/color split):
    // how many TALEA STATEMENTS pass before the melodic color cycle also
    // returns to its own start -- 1 means color and talea are already
    // the same length (they realign every single statement); otherwise a
    // real, derived "the riff's pitch content only fully repeats every
    // N bar-cycles of its own rhythm" figure.
    colorRepeatsEveryTaleaStatements: lcm(talea, color) / talea,
  };
}

// Three velocity tiers, reusing existing numbers rather than inventing new
// ones -- see this module's own header and GHOST_VELOCITY above. `accent`
// (the caller applies the EXISTING accent:true path, synth.js's own 1.6x)
// on real metric beat boundaries (one beat = PULSES_PER_BEAT pulses,
// scaled by the same subdivision `s` the pattern itself was built at);
// `normal` (velocity 1.0) on a real coarse-grid onset -- a beat this
// engine's own 12-step wheel would itself land on, at subdivision 1; and
// `ghost` (GHOST_VELOCITY) on fine-grid-only fill, the finer texture that
// only exists once subdivision > 1. This is what makes a pattern whose
// bare onset RATIO stayed constant across subdivisions (see
// patternsForRing) still read as busier at higher subdivision: the accent
// structure genuinely differs even when the ratio doesn't.
//
// `halfTime` -- a real, named genre technique: at the heaviest moments, a
// metal rhythm section's FELT kick/snare grid halves (hits land twice as
// far apart) even though the underlying pulse hasn't slowed at all --
// reading as heavier and more guttural rather than merely faster. Doubles
// the accent spacing; the coarse/ghost tiers are untouched, so the
// underlying pattern still reads as busy, just with the metric "downbeat"
// landing half as often.
export function velocityForStep(step, s, coarse, halfTime = false) {
  const accentEvery = PULSES_PER_BEAT * s * (halfTime ? 2 : 1);
  if (step % accentEvery === 0) return "accent";
  if (coarse.length && coarse[Math.floor(step / s) % coarse.length]) return "normal";
  return "ghost";
}
