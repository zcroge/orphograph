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

import { SPOKE_COUNT, normalizeSpoke, PULSES_PER_BEAT } from "./wheel.js";
import { ringForLetter } from "./letters.js";

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
