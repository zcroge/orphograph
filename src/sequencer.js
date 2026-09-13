// The crank: three concentric procession runners (given/received/made),
// each sweeping the same 12 spokes at its own fixed-ratio speed off one
// master rate (see wheel.js's RING_SPEED_WEIGHT for why those ratios and
// not others), each independently and CONTINUOUSLY working through the
// same trace, forever, until stopped by hand.
//
// Earlier versions of this had each ring stop dead once it finished its
// trace and reached a pole, waiting for every other ring to also finish
// before an external "loop" restarted all three together. That's not what
// was decided: the actual design (worked out over several turns) is that
// no ring ever stops -- each one wraps its trace/words and keeps sweeping
// indefinitely, the way Gojira/Meshuggah-style riff layering never halts.
// A pole isn't a place a ring parks; it's just a spoke it passes through,
// like any other. "Resolution = pole arrival" survives as something
// OBSERVED rather than something that stops anything: because the three
// ring speeds are fixed ratios of one master clock, all three land back on
// spoke 1 (I) at the exact same instant on a calculable, recurring period
// (see Sequencer's grand-convergence check) -- a real, periodic
// "conjunction" within continuous motion, the way planets align without
// either stopping. That's flagged, not halted.
//
// Per-ring rules:
//   - each ring starts at the top and completes one full free lap (its OWN
//     12 pulses, at its OWN speed) before it starts matching the trace.
//   - melody mode: a note triggers when the ring's sweep reaches its
//     target spoke; once the trace is exhausted, it wraps back to the
//     first letter and keeps going.
//   - chord mode: one word (letters between rests) is struck as a
//     simultaneous chord every WORD_CHORD_PULSE_LENGTH pulses; once the
//     words are exhausted, it wraps back to the first word.
// Sweep direction (clockwise) is this prototype's interpretation, as
// before -- see wheel.js's header for the parts derived from source law.

import { SPOKE_COUNT, normalizeSpoke, ringSpeedMultiplier, GROUNDING_BPM, BREATH_CYCLE_PULSES, bpmToMasterPulsesPerSecond } from "./wheel.js";
// wordArc/chordPulseLength/wordHandedness/splitIntoWords used to be
// hand-duplicated here (each with its own "kept in sync by hand" comment)
// since deriveTrace threw its own internal word structure away -- see
// trace.js's own comment on these. One shared home now.
import { chordPulseLength, wordHandedness, splitIntoWords, MIN_CHORD_PULSES } from "./trace.js";

export const Phase = Object.freeze({
  IDLE: "idle",
  LEAD_IN: "lead-in",
  TRACING: "tracing",
});

const RING_NAMES = ["given", "received", "made"];

class RingRunner {
  constructor(ringName, { onPulse, onNoteHit, onChordHit, onPhaseChange, onOrigin, onTraceLoop, onDirectionReversal }) {
    this.ring = ringName;
    this.speedMultiplier = ringSpeedMultiplier(ringName);
    this.onPulse = onPulse;
    this.onNoteHit = onNoteHit;
    this.onChordHit = onChordHit;
    this.onPhaseChange = onPhaseChange;
    this.onOrigin = onOrigin;
    // "A cyclic pattern procession... driven by input/wheel/instrument
    // properties." No signal previously existed for "this ring just
    // completed one full pass through the trace" -- both real wrap points
    // below were silent. Fired there now, defaulted to a no-op like every
    // other callback so this is backward compatible.
    this.onTraceLoop = onTraceLoop || (() => {});
    // "Ring retrograde/prograde reversals could be punctuated by accent
    // notes and accent percussion hits." No signal previously existed for
    // "this ring's own direction just actually changed" either -- fired
    // only on a genuine flip (see _advanceMelody), not every recomputation.
    this.onDirectionReversal = onDirectionReversal || (() => {});

    this.mode = "melody"; // or "chord" -- see setMode
    this.phase = Phase.IDLE;
    this.currentSpoke = 1;
    this.trace = [];
    this.traceIndex = 0;
    this.words = [];
    this.wordIndex = 0;
    this.pulsesSinceLastWord = 0;
    this.currentWordPulseLength = MIN_CHORD_PULSES;
    this.leadInPulsesRemaining = 0;
    this._pulseAccumulator = 0;
    this.direction = 1; // +1 clockwise, -1 counterclockwise -- melody-mode tracing only
    this.wordHandednessOf = new Map();
  }

  setMode(mode) {
    this.mode = mode;
  }

  start(trace) {
    this.trace = trace;
    this.traceIndex = 0;
    this.words = splitIntoWords(trace);
    this.wordHandednessOf = new Map(this.words.map((w) => [w, wordHandedness(w)]));
    this.wordIndex = 0;
    this.pulsesSinceLastWord = 0;
    this.currentSpoke = 1;
    this.direction = 1;
    this.leadInPulsesRemaining = SPOKE_COUNT;
    this._pulseAccumulator = 0;
    this._setPhase(Phase.LEAD_IN);
    this.onOrigin(this.ring, { letter: "I", spoke: 1 });
  }

  _setPhase(p) {
    this.phase = p;
    this.onPhaseChange(this.ring, p);
  }

  // Which way to step toward a target -- whichever arc is shorter. Exact
  // ties (the target sits precisely 6 spokes away either direction) fall
  // back to the current target's own word's handedness; a target with no
  // word (a rest) just keeps whatever direction this ring was already
  // moving in, since there's nothing to derive a handedness from.
  _directionToward(targetSpoke) {
    if (this.currentSpoke === targetSpoke) return this.direction;
    const cw = (targetSpoke - this.currentSpoke + SPOKE_COUNT) % SPOKE_COUNT;
    const ccw = SPOKE_COUNT - cw;
    if (cw < ccw) return 1;
    if (ccw < cw) return -1;
    const entry = this.trace[this.traceIndex];
    const word = entry && !entry.isRest ? this.words.find((w) => w.includes(entry)) : null;
    return word ? this.wordHandednessOf.get(word) : this.direction;
  }

  advance(masterPulsesPerSecond, dt) {
    if (this.phase === Phase.IDLE) return;
    this._pulseAccumulator += masterPulsesPerSecond * this.speedMultiplier * dt;
    while (this._pulseAccumulator >= 1) {
      this._pulseAccumulator -= 1;
      this._advanceOnePulse();
    }
  }

  _advanceOnePulse() {
    // Lead-in is a fixed onboarding sweep (a "free lap," always clockwise,
    // no real target yet) and chord mode never uses spoke-matching for its
    // own timing at all (see _advanceChord) -- direction only has real
    // meaning for melody mode's actual tracing, and is deliberately NOT
    // recomputed every pulse (see below) -- only once per target acquired.
    const step = this.phase === Phase.TRACING && this.mode === "melody" ? this.direction : 1;
    this.currentSpoke = normalizeSpoke(this.currentSpoke + step);
    this.onPulse(this.ring, this.currentSpoke);

    if (this.phase === Phase.LEAD_IN) {
      this.leadInPulsesRemaining -= 1;
      if (this.leadInPulsesRemaining <= 0) {
        this._setPhase(Phase.TRACING);
        if (this.mode === "chord") this._strikeWord(0);
        // First real target of the trace, acquired the moment tracing
        // starts -- see _advanceMelody for why this is a one-time
        // computation, not a per-pulse one.
        else if (this.trace.length > 0) this.direction = this._directionToward(this.trace[this.traceIndex].spoke);
      }
      return;
    }

    // Phase.TRACING, forever -- never transitions anywhere else.
    if (this.mode === "chord") {
      this._advanceChord();
    } else {
      this._advanceMelody();
    }
  }

  _advanceMelody() {
    if (this.trace.length === 0) return;
    const target = this.trace[this.traceIndex];
    if (target && this.currentSpoke === target.spoke) {
      this.onNoteHit(this.ring, target, this.traceIndex);
      this.traceIndex = (this.traceIndex + 1) % this.trace.length; // wrap, don't stop
      if (this.traceIndex === 0) this.onTraceLoop(this.ring);
      // Direction is chosen ONCE here, right as the new target is
      // acquired -- not recomputed every pulse while chasing it. Recomputing
      // every pulse looks harmless for a genuinely distant target (the
      // "shorter way" stays shorter as you get closer), but breaks the
      // moment a target repeats the ring's own current spoke (a real
      // "repeat = re-strike at min pulse," another sonic parameter): after
      // one step away, the very next recomputation would find "1 step back"
      // objectively shorter than "11 more to complete a lap" and reverse
      // right back, oscillating in place instead of completing a clean lap.
      const newDirection = this._directionToward(this.trace[this.traceIndex].spoke);
      // A real retrograde/prograde reversal -- fired only on an actual
      // flip, not every recomputation (which happens on every real hit
      // regardless of whether direction changed). Scoped to here
      // deliberately, not the one-time lead-in assignment below -- nothing
      // was "reversed" from before tracing even started.
      if (newDirection !== this.direction) this.onDirectionReversal(this.ring, this.currentSpoke, newDirection);
      this.direction = newDirection;
    }
  }

  _strikeWord(index) {
    if (this.words.length === 0) return;
    const word = this.words[index];
    const pulseLength = chordPulseLength(word);
    this.onChordHit(this.ring, word, index, pulseLength);
    this.wordIndex = (index + 1) % this.words.length; // wrap, don't stop
    if (this.wordIndex === 0) this.onTraceLoop(this.ring);
    this.pulsesSinceLastWord = 0;
    this.currentWordPulseLength = pulseLength; // this word's own arc sizes its own duration
  }

  _advanceChord() {
    if (this.words.length === 0) return;
    this.pulsesSinceLastWord += 1;
    if (this.pulsesSinceLastWord >= this.currentWordPulseLength) this._strikeWord(this.wordIndex);
  }
}

export class Sequencer {
  constructor({ onPulse, onNoteHit, onChordHit, onPhaseChange, onOrigin, onGrandConvergence, onTraceLoop, onBreathCycle, onDirectionReversal }) {
    const cb = {
      onPulse: onPulse || (() => {}),
      onNoteHit: onNoteHit || (() => {}),
      onChordHit: onChordHit || (() => {}),
      onPhaseChange: onPhaseChange || (() => {}),
      onOrigin: onOrigin || (() => {}),
      onTraceLoop: onTraceLoop || (() => {}),
      onDirectionReversal: onDirectionReversal || (() => {}),
    };
    this.rings = Object.fromEntries(RING_NAMES.map((r) => [r, new RingRunner(r, cb)]));
    this.onGrandConvergence = onGrandConvergence || (() => {});
    // "A universal grounding tempo... a fixed rate, maybe a low resting
    // heart-rate tempo" -- confirmed fixed, not slider/pedal-adjustable
    // (see wheel.js's GROUNDING_BPM for the full precedent/derivation).
    // There is no longer a 0..1 "rate" to be a fraction OF -- one real
    // number, set once at construction, never mutated.
    this.pulsesPerSecond = bpmToMasterPulsesPerSecond(GROUNDING_BPM);
    // The breath layer's own pulse-counted cycle -- same accumulate-and-
    // drain shape RingRunner.advance already uses for its own per-ring
    // accumulator, just at the master level (see wheel.js's
    // BREATH_CYCLE_PULSES for the derivation of 36). Edge-triggered via a
    // plain count-up-and-wrap, not time-based, so it can never drift from
    // the same clock everything else in this engine already counts pulses
    // against.
    this._masterPulseAccumulator = 0;
    this._masterPulseCount = 0;
    this.onBreathCycle = onBreathCycle || (() => {});
    this._lastTick = null;
    this._running = false;
    this._wasAtOrigin = true; // avoid firing convergence on the very first frame
  }

  setRingMode(ring, mode) {
    this.rings[ring].setMode(mode);
  }

  start(trace) {
    this._running = true;
    this._lastTick = performance.now();
    this._wasAtOrigin = true;
    RING_NAMES.forEach((r) => this.rings[r].start(trace));
    this._loop();
  }

  stop() {
    this._running = false;
    RING_NAMES.forEach((r) => (this.rings[r].phase = Phase.IDLE));
  }

  get phase() {
    // Coarse overall phase for simple UI readouts -- "least advanced ring wins."
    const order = [Phase.IDLE, Phase.LEAD_IN, Phase.TRACING];
    let earliest = Phase.TRACING;
    for (const r of RING_NAMES) {
      if (order.indexOf(this.rings[r].phase) < order.indexOf(earliest)) earliest = this.rings[r].phase;
    }
    return earliest;
  }

  // The real master-pulse counter Part 0 already tracks internally for
  // the breath cycle -- exposed read-only so main.js can derive OTHER
  // things from the exact same clock (e.g. percussion density's own
  // convergence-cycle arc, see wheel.js's GRAND_CONVERGENCE_PULSES)
  // without duplicating a second, potentially-drifting counter.
  get masterPulseCount() {
    return this._masterPulseCount;
  }

  // Same exposure, same reasoning, sub-pulse-smooth -- the whole-pulse
  // counter above steps once every ~278ms (at the fixed 72 BPM anchor),
  // which is coarse for something meant to animate continuously (the
  // outer cycle-readout ring's own rotation). The fractional part is the
  // SAME accumulator the whole-pulse counter already drains every frame,
  // just read before it's consumed, so this never drifts from
  // masterPulseCount's own integer steps.
  get masterPulseCountFractional() {
    return this._masterPulseCount + this._masterPulseAccumulator;
  }

  _loop() {
    if (!this._running) return;
    const now = performance.now();
    const dt = (now - this._lastTick) / 1000;
    this._lastTick = now;

    RING_NAMES.forEach((r) => this.rings[r].advance(this.pulsesPerSecond, dt));

    // Breath cycle -- the fixed anchor's own slowest layer, 36 master
    // pulses per cycle (wheel.js's BREATH_CYCLE_PULSES). Counted the same
    // way RingRunner.advance drains its own per-ring accumulator: whole
    // pulses only, fired on each one, wrapped every 36th.
    this._masterPulseAccumulator += this.pulsesPerSecond * dt;
    while (this._masterPulseAccumulator >= 1) {
      this._masterPulseAccumulator -= 1;
      this._masterPulseCount += 1;
      if (this._masterPulseCount % BREATH_CYCLE_PULSES === 0) this.onBreathCycle();
    }

    // Grand convergence: all three rings land on I (spoke 1) simultaneously.
    // With fixed ratios 6:8:12, this recurs every 72 master pulses once all
    // three are past their lead-ins -- a real, periodic "conjunction," not
    // a stop. Edge-triggered so it fires once per arrival, not every frame
    // it happens to still be true.
    const allAtOrigin = RING_NAMES.every(
      (r) => this.rings[r].phase === Phase.TRACING && this.rings[r].currentSpoke === 1
    );
    if (allAtOrigin && !this._wasAtOrigin) this.onGrandConvergence();
    this._wasAtOrigin = allAtOrigin;

    requestAnimationFrame(() => this._loop());
  }
}
