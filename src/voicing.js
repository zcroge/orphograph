// Native chord voicing -- replaces the jazz/orchestration-borrowed P2
// sketch in MUSIC-STRUCTURE-PLAN.md with rules derived from the wheel's OWN
// vocabulary: spoke arc-distance (the wheel's own distance metric), the
// 6:8:12 Timaeus proportion (already governing ring speed, reused here as
// ARC_SPOKES_PER_OCTAVE's own derivation: 12 spokes / 6, its smallest
// member), and the mirror/rotate transform operators that already govern
// macro-structure (transform.js), applied one level down, to the chord
// itself. See the "native chord-voicing engine" plan for the full rationale
// and the honest accounting of what this replaces and why.
//
// Pure spoke-domain math, no Web Audio -- callers (synth.js) convert the
// returned {spoke, octaveOffset} voices into Hz/ratios against whatever
// root frequency and ring register multiplier are live at call time.

import { SPOKE_COUNT, normalizeSpoke, mirrorSpoke, rotateSpoke } from "./wheel.js";

// 12 spokes / 6 (the Timaeus proportion's own smallest member) -- not a
// freehand pick. See rule 2 in the plan.
export const DEFAULT_ARC_SPOKES_PER_OCTAVE = 2;

// Signed shortest-arc distance from `fromSpoke` to `toSpoke`, in spokes
// (== semitones, since hzForSpoke is one semitone per spoke -- letters.js).
// Same "compare d to SPOKE_COUNT - d" shortest-arc rule wordArc/
// _directionToward already use (sequencer.js), made pure and signed:
// positive = clockwise/up, negative = counter-clockwise/down, range
// -6..+6 (a tritone's exact antipode picks +6 consistently, an arbitrary
// but harmless tie-break -- no word-handedness context to break it by here).
export function signedArcDistance(fromSpoke, toSpoke) {
  const raw = ((normalizeSpoke(toSpoke) - normalizeSpoke(fromSpoke)) % SPOKE_COUNT + SPOKE_COUNT) % SPOKE_COUNT;
  return raw > SPOKE_COUNT / 2 ? raw - SPOKE_COUNT : raw;
}

// Rule 2: how many octaves out from the root's own octave a voice sits,
// as a continuous function of its own arc-distance from the root -- no
// lookup table, no named "drop-2/drop-3/tertian/quartal" category to pick.
function octaveOffsetForArc(arcDistance, arcSpokesPerOctave) {
  return Math.sign(arcDistance) * Math.floor(Math.abs(arcDistance) / arcSpokesPerOctave);
}

// Rule 5: the drone permanently holds its own pole tone -- a word with
// enough real content of its own (|pcs| >= 3) omits that pitch class from
// the flute's voicing rather than doubling what's already sounding
// underneath it. A dyad (or single note) keeps everything; there's nothing
// to spare.
function applyRootless(wordSpokes, dronePitchClass) {
  if (dronePitchClass == null) return wordSpokes;
  const uniqueCount = new Set(wordSpokes.map(normalizeSpoke)).size;
  if (uniqueCount < 3) return wordSpokes;
  const dp = normalizeSpoke(dronePitchClass);
  return wordSpokes.filter((s) => normalizeSpoke(s) !== dp);
}

// Rule 2 + rule 4 (mirror-echo doubling), from scratch -- used whenever
// rule 6's transform check (below) doesn't find a cleaner relationship to
// the previous word.
function voiceFresh(wordSpokes, rootSpoke, arcSpokesPerOctave, maxVoices) {
  const firstOctaveOffsetBySpoke = new Map();
  const voices = [];
  for (const rawSpoke of wordSpokes) {
    if (voices.length >= maxVoices) break;
    const spoke = normalizeSpoke(rawSpoke);
    if (!firstOctaveOffsetBySpoke.has(spoke)) {
      const arc = signedArcDistance(rootSpoke, spoke);
      const octaveOffset = octaveOffsetForArc(arc, arcSpokesPerOctave);
      firstOctaveOffsetBySpoke.set(spoke, octaveOffset);
      voices.push({ spoke, octaveOffset, isDoubling: false });
    } else {
      // A recurring letter's SECOND occurrence echoes at the octave-offset
      // mirrored through 0 (its first sat +1 out -> the echo sits -1 out) --
      // "double the root" has no meaning outside functional harmony, but a
      // real geometric echo of the letter's own first voicing does. Only
      // once per recurring pitch class (a third+ occurrence doesn't stack
      // more echoes), same fixed-slot discipline as everywhere else here.
      const firstOffset = firstOctaveOffsetBySpoke.get(spoke);
      const alreadyEchoed = voices.some((v) => v.spoke === spoke && v.isDoubling);
      if (!alreadyEchoed) voices.push({ spoke, octaveOffset: -firstOffset, isDoubling: true });
    }
  }
  return voices.slice(0, maxVoices);
}

// Rule 6: is `nextPcs` reachable from `prevPcs` (as SETS) by one shared
// mirror or rotation? Checked identity/rotations before mirror -- an exact
// repeat (rotate by 0) is the simplest, most common case. Reuses the
// EXISTING wheel.js operators, not a reimplementation of them.
function findSetTransform(prevPcs, nextPcs) {
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

// The one entry point. `wordSpokes` is the word's own letters' spokes, IN
// ORDER, WITH repeats (not pre-deduplicated -- rule 4 needs to see repeats
// to detect them). `rootSpoke` is this chord's own root (by convention,
// the word's first sounding letter, same "word[0]" precedent wordArc/
// wordHandedness already set).
//
// Returns { voices, pcSpokes }: `voices` is up to `maxVoices` entries of
// { spoke, octaveOffset, isDoubling, ratio } (ratio = this voice's Hz
// relative to the chord root's own Hz, i.e. rootHz * ratio is the voice's
// real pitch -- callers need nothing more than that to drive a layer).
// `pcSpokes` is this word's own effective (post-rootless) unique content,
// in first-occurrence order -- stash it and pass it back as
// `previousPcSpokes` next call, alongside this call's `voices` as
// `previousVoicing`, to make rule 6 possible on the NEXT word.
export function voiceWord(wordSpokes, rootSpoke, options = {}) {
  const {
    arcSpokesPerOctave = DEFAULT_ARC_SPOKES_PER_OCTAVE,
    dronePitchClass = null,
    previousPcSpokes = null,
    previousVoicing = null,
    maxVoices = 6,
  } = options;

  const root = normalizeSpoke(rootSpoke);
  const filteredSpokes = applyRootless(wordSpokes, dronePitchClass);
  const pcSpokes = [];
  for (const s of filteredSpokes) {
    const n = normalizeSpoke(s);
    if (!pcSpokes.includes(n)) pcSpokes.push(n);
  }

  let voices;
  const transform = findSetTransform(previousPcSpokes, pcSpokes);
  if (transform && previousVoicing && previousVoicing.length) {
    voices = previousVoicing
      .map((v) => ({ spoke: normalizeSpoke(transform.apply(v.spoke)), octaveOffset: v.octaveOffset, isDoubling: v.isDoubling || false }))
      .slice(0, maxVoices);
  } else {
    voices = voiceFresh(filteredSpokes, root, arcSpokesPerOctave, maxVoices);
  }

  const voicesWithRatio = voices.map((v) => ({
    ...v,
    ratio: Math.pow(2, signedArcDistance(root, v.spoke) / SPOKE_COUNT + v.octaveOffset),
  }));

  return { voices: voicesWithRatio, pcSpokes };
}
