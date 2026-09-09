// The Response operator -- the-codex-v1.md's own already-declared law:
// "selected transformation of the call... rotation-7 conventional;
// activation = being answered; call never consumed." The RICHER statement,
// master-blueprint-v2.md: "a SELECTED transformation of the call -- from
// {prime, inversion, retrograde, retrograde-inversion}, with rotation-by-
// seven as the conventional answer when no ground compels." That is literal
// twelve-tone row-operation vocabulary -- a real, cited musical precedent,
// not invented for this module. And the struck-reading record (A-struck.md
// S11) confirms rotation-7 was explicitly DEMOTED from "the answer" to a
// displaceable default.
//
// "Limiting transformations to a single layer/operation is arbitrary and
// naive." Generalized here from a fixed mirror+rotate-7 pair into an open,
// arbitrary-length, ORDERED chain of steps -- a "procession of
// transformations" -- each applied to the previous stage to produce the
// next: [call] -> stage1 -> stage2 -> ... -> stageN, all woven into one
// continuous playback. Zero steps reproduces the original, response-free
// behavior exactly.
//
// Three step types, each with a real anchor already established elsewhere
// in this engine, not invented for this module:
//   mirror -- the enantiomer (law's "inversion"). Reflects across the
//     wheel's own I-O spine (wheel.js's mirrorSpoke, the SAME axis that
//     already proved Dogman's hull symmetric, and the axis the-codex-v1.md
//     uses to define "flaw" as a trace's deviation from its own
//     mirror-trace).
//   rotate -- transposition by any degree (in spokes), not just the
//     conventional 7. wheel.js's rotateSpoke is the general case
//     normalizeSpoke was always correct for.
//   retrograde -- procession reversal (law's "retrograde"), reversing
//     playback ORDER rather than mapping each entry in place -- a
//     whole-trace permutation, not a per-entry transform.
//
// LITERAL vs. GEOMETRIC: wherever the census already declares a real
// transform-twin for a letter (letters.js's ROTATION_TWIN_OF/FLIP_TWIN_OF
// -- the six given/received voicing pairs for rotate, Y/H for mirror), the
// response uses that ACTUAL other letter -- a real re-spelling, not just
// the same letter moved to a new position. For rotate, this literal branch
// applies ONLY at the canonical degree 7 -- ROTATION_TWIN_OF encodes the
// voicing-pair relationship 00-laws.md's own channel doctrine ties
// SPECIFICALLY to the 180-degree/phonology channel, not a general fact
// about ANY rotation amount; every other degree uses the pure geometric
// rotateSpoke, which is also the fix for a latent bug -- the literal and
// geometric branches are not the same group action, so mixing them under
// arbitrary degrees would silently drift. Everywhere else (most letters
// have no declared twin, and mirror has only Y/H), it falls back to the
// geometric spoke operation on the SAME letter, honestly flagged
// (`literal: false`) the same way every other placeholder decision in this
// engine already is.

import { ROTATION_TWIN_OF, FLIP_TWIN_OF, spokeForLetter, REST } from "./letters.js";
import { mirrorSpoke, rotateSpoke } from "./wheel.js";

export const ROTATION_SPOKE_SHIFT = 7;

// Applies ONE step to one trace entry (mirror/rotate only -- retrograde is
// a whole-trace permutation, handled separately by applyOp below). REST
// carries no phonetic content to transform -- passed through unchanged,
// same as everywhere else a rest is treated as punctuation rather than a
// sound. `step` is `{ type: "mirror" | "rotate", degree? }` -- degree is
// only meaningful for rotate (default ROTATION_SPOKE_SHIFT).
export function transformEntry(entry, step) {
  if (entry.isRest) return entry;
  const degree = step.type === "rotate" ? (step.degree ?? ROTATION_SPOKE_SHIFT) : undefined;
  const twinTable = step.type === "mirror" ? FLIP_TWIN_OF
    : step.type === "rotate" && degree === ROTATION_SPOKE_SHIFT ? ROTATION_TWIN_OF
    : null;
  const twin = twinTable ? twinTable[entry.letter] : undefined;
  if (twin !== undefined) {
    return { letter: twin, spoke: spokeForLetter(twin), isRest: false, literal: true };
  }
  const spoke = step.type === "mirror" ? mirrorSpoke(entry.spoke) : rotateSpoke(entry.spoke, degree);
  return { letter: entry.letter, spoke, isRest: false, literal: false };
}

// A fresh copy of one trace entry -- every occurrence of an entry in a
// woven procession needs its OWN object. sequencer.js resolves a trace
// entry's word by reference identity (Array.includes, SameValueZero); a
// longer chain reuses stages more than the original two-op pingPong ever
// did, so this is the safe rule applied consistently, not just where the
// old code happened to get away without it.
function cloneEntry(entry) {
  return { ...entry };
}

// Applies ONE step to a WHOLE trace, producing the next stage. Retrograde
// is a permutation (reverse playback order); mirror/rotate are per-entry
// maps via transformEntry.
export function applyOp(trace, step) {
  if (step.type === "retrograde") {
    return [...trace].reverse().map(cloneEntry);
  }
  return trace.map((entry) => transformEntry(entry, step));
}

const restEntry = () => ({ letter: REST, spoke: spokeForLetter(REST), isRest: true });

// Weaves an open chain of steps into one continuous procession. Each step
// produces a new stage from the previous one; how that stage joins the
// woven playback is the step's OWN choice (`bounce`), not one hardcoded
// shape for the whole set -- "transforms should naturally be played back
// as their transformation suggests."
//   bounce: true  -- [REST, stage, REST, previousStage] -- an out-and-back,
//     the way a reflection actually behaves (default for mirror).
//   bounce: false -- [REST, stage] -- a restatement in series, at the new
//     level (default for rotate/retrograde).
// Zero steps returns the call unchanged -- today's no-response behavior,
// exactly. A single mirror step reproduces the old pingPong array exactly;
// a single rotate-7 step reproduces the old series array exactly (see
// README/tests) -- this is a generalization, not a rewrite of behavior.
// `boundaries`: the traceIndex (into `woven`, matching sequencer.js's own
// per-ring `traceIndex`, see main.js's onNoteHit) where playback ENTERS
// each new segment, paired with the exact `fromStage`/`toStage` arrays
// that segment's own step actually produced -- "animating an echoing
// visual transform of the trace, which should help ground and visually
// represent the transpositions, mirrors and other steps as they truly
// affect the sound." This is the REAL computed stage, not something a
// caller needs to re-derive -- a viewer reading `toStage[i].spoke` sees
// exactly the transform this function already applied via applyOp, for
// every step type including retrograde (whose `toStage` is genuinely
// order-reversed relative to `fromStage`, not index-for-index -- pairing
// by shared index `i` is still correct, since that IS the reversal).
export function buildProcession(callTrace, steps) {
  const stages = [callTrace];
  const woven = [...callTrace];
  const boundaries = [];
  let prevStage = callTrace;
  for (const step of steps) {
    const nextStage = applyOp(prevStage, step);
    stages.push(nextStage);
    const bounce = step.bounce ?? (step.type === "mirror");
    woven.push(restEntry());
    boundaries.push({ index: woven.length, step, fromStage: prevStage, toStage: nextStage });
    woven.push(...nextStage);
    if (bounce) {
      woven.push(restEntry());
      boundaries.push({ index: woven.length, step, fromStage: nextStage, toStage: prevStage, isBounceBack: true });
      woven.push(...prevStage.map(cloneEntry));
    }
    prevStage = nextStage;
  }
  return { stages, woven, boundaries };
}

// Human-legible description of a step chain, for the "responding:" readout
// -- e.g. "rotate+5 -> retrograde -> mirror".
export function describeSteps(steps) {
  return steps
    .map((s) => (s.type === "rotate" ? `rotate+${s.degree ?? ROTATION_SPOKE_SHIFT}` : s.type))
    .join(" -> ");
}
