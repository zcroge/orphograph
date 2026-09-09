import { deriveTrace, invalidRanges } from "./trace.js";
import { buildProcession, describeSteps, ROTATION_SPOKE_SHIFT } from "./transform.js";
import { hzForSpoke, PLACEHOLDER_SPOKE_OF, ringForLetter } from "./letters.js";
import { OrphographAudio, DEFAULT_NOTE_PARAMS, DEFAULT_DRONE_PARAMS, WHISTLE_MAX_VOICES } from "./synth.js";
import { Sequencer } from "./sequencer.js";
import { MidiBridge } from "./midi.js";
import { WheelView, DEFAULT_VIEW_PARAMS } from "./view.js";
import { RING_OCTAVE_MULTIPLIER, ringSpeedMultiplier, SPOKE_COUNT, masterPulsesPerSecondToBpm, rotateSpoke, GRAND_CONVERGENCE_PULSES } from "./wheel.js";
import { loadAllPhrases, addPhrase, deletePhrase, isDefaultPhrase } from "./phrases.js";
import { loadPresets, savePreset, deletePreset, loadLastSession, saveLastSession } from "./timbrePresets.js";
import { PictographKeyboard } from "./keyboard.js";
import { CompactLegend } from "./compactLegend.js";

const $ = (id) => document.getElementById(id);

// Live invalid-character preview -- "flag J, U, Q, X, C in red within the
// input field... this will help me learn the phonetic basis behind each
// letter as I move forward." A real editable <input> with its own text
// made transparent (see style.css) sits in front of a backdrop div that
// renders the SAME text with unrecognized characters colored red -- the
// two must be kept in sync any time the input's value changes, whether
// from typing or from a programmatic change (phrase select, keyboard
// click-to-insert, the space button).
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function updateInputBackdrop() {
  const input = $("input");
  const text = input.value;
  const ranges = invalidRanges(text);
  let html = "";
  let i = 0;
  ranges.forEach(({ start, end }) => {
    html += escapeHtml(text.slice(i, start));
    html += `<span class="invalid-char">${escapeHtml(text.slice(start, end))}</span>`;
    i = end;
  });
  html += escapeHtml(text.slice(i));
  $("input-backdrop").innerHTML = html;
  $("input-backdrop").scrollLeft = input.scrollLeft;
}
$("input").addEventListener("input", updateInputBackdrop);
$("input").addEventListener("scroll", () => { $("input-backdrop").scrollLeft = $("input").scrollLeft; });
updateInputBackdrop();

function populatePhraseSelect(selectValue) {
  const select = $("phrase-select");
  select.innerHTML = "";
  loadAllPhrases().forEach(({ name, text }) => {
    const opt = document.createElement("option");
    opt.value = text;
    opt.textContent = name;
    opt.dataset.name = name;
    select.appendChild(opt);
  });
  if (selectValue !== undefined) select.value = selectValue;
}
populatePhraseSelect();

$("phrase-select").addEventListener("change", (e) => {
  $("input").value = e.target.value;
  updateInputBackdrop();
});

$("save-phrase").addEventListener("click", () => {
  const text = $("input").value.trim();
  if (!text) return;
  const name = prompt("Save this phrase as:", text);
  if (!name) return;
  addPhrase(name, text);
  populatePhraseSelect(text);
});

$("delete-phrase").addEventListener("click", () => {
  const select = $("phrase-select");
  const opt = select.selectedOptions[0];
  if (!opt) return;
  const name = opt.dataset.name;
  if (isDefaultPhrase(name)) {
    alert("Defaults can't be deleted -- only phrases you've saved.");
    return;
  }
  deletePhrase(name);
  populatePhraseSelect();
});

const canvas = $("wheel");
const view = new WheelView(canvas);
const audio = new OrphographAudio();
function insertLetter(letter) {
  const input = $("input");
  input.value += input.value === "" || input.value.endsWith(" ") ? letter : `-${letter}`;
  input.focus();
  updateInputBackdrop();
}

const keyboard = new PictographKeyboard($("keyboard"));
keyboard.onKeyClick = insertLetter;

const legendGrid = new CompactLegend($("legend-grid"));
legendGrid.onKeyClick = insertLetter;
$("kbd-space").addEventListener("click", () => {
  const input = $("input");
  if (input.value !== "" && !input.value.endsWith(" ")) input.value += " ";
  input.focus();
  updateInputBackdrop();
});

// Drone always anchors on O (spoke 7) -- see synth.js/README for why.
// Dropped several octaves: "subterranean and moving, not a fly buzzing in
// your ear" -- O's note-range pitch (~311Hz) is nowhere near a drone
// register. -3 octaves keeps the drone's three ring-voices (see synth.js's
// setDroneVoices) all comfortably audible as pitched content rather than
// dropping below the range where fundamentals are perceptible as pitch at
// all (roughly 20Hz).
const DRONE_OCTAVE_SHIFT = -3;
const DRONE_HZ = hzForSpoke(7) * Math.pow(2, DRONE_OCTAVE_SHIFT);
// Per-ring tonic/fifth/octave ratios now live inside synth.js's
// setDroneVoices itself (not RING_OCTAVE_MULTIPLIER -- that's a pure-octave
// ratio and would make the three voices fuse into one perceived pitch).
// main.js just hands over the one base frequency.

// Letters positioned in RING space too, not just spoke space -- L11's
// given/received/made ring assignment (00-laws.md) now means a spoke can
// hold letters from more than one tier (e.g. spoke 3: K given, G received),
// which a single joined "K/G" label at one radius doesn't distinguish.
// Grouped by spoke, then by ring, so view.js can draw each group at that
// ring's own radius band. Letters with no settled ring yet (ŋ, the two
// unnamed vowel primes) fall into "unassigned" and render at a neutral
// default position -- same "undecided, not silenced" treatment the audio
// side already gives them.
const lettersBySpokeAndRing = {};
for (const [letter, spoke] of Object.entries(PLACEHOLDER_SPOKE_OF)) {
  const ring = ringForLetter(letter) || "unassigned";
  ((lettersBySpokeAndRing[spoke] ??= {})[ring] ??= []).push(letter);
}
function ringLabelsAtSpoke(spoke) {
  return lettersBySpokeAndRing[spoke] || {};
}

// This ring's own current pulse rate -- the fixed grounding tempo
// (sequencer.pulsesPerSecond, see wheel.js's GROUNDING_BPM) scaled by this
// ring's own 6:8:12 speed. The old `Math.max(0.5, ...)` floor here guarded
// against a near-zero SLIDER rate; with the anchor fixed, pulsesPerSecond
// can never be near zero, so that guard is gone -- it would only have
// masked a real bug now. Pulled out as one shared helper since this exact
// formula used to be duplicated inline at five separate call sites.
function ringPulsesPerSecond(ring) {
  return sequencer.pulsesPerSecond * ringSpeedMultiplier(ring);
}

// "One driving bass drone, one meandering flute narrative" retired the
// sidechain-echo mechanism that used to live here (triggerRingEchoes,
// emptyRingsAtSpoke, ringPulseSeconds, audio.sympatheticFlick, and the
// activeEchoes visual it fed -- see view.js's own removal note). Its
// entire premise was bending a TARGET ring's separate, persistent flute
// voice toward a source ring's note; once there's one shared flute voice
// instead of three, there's no longer a separate target to bend. Not
// repurposed -- removed cleanly, per this project's standing discipline
// against a mechanism quietly changing what it does once its premise no
// longer holds.

// Same tie-break rule as sequencer.js's wordHandedness -- kept in sync by
// hand (duplicated, not imported, since sequencer.js's copy is private to
// its own module) rather than exposing sequencer internals just for this.
function wordHandedness(word) {
  if (word.length < 2) return 1;
  const first = word[0].spoke;
  const last = word[word.length - 1].spoke;
  const cw = (last - first + SPOKE_COUNT) % SPOKE_COUNT;
  const ccw = SPOKE_COUNT - cw;
  return cw <= ccw ? 1 : -1;
}

// Restored -- "the trace being stationary with a fading oscilloscope-like
// tracer following the stylus across the traces would be easier to follow."
// Letters are stationary again, so the tracer needs to know exactly how
// many raw pulses stand between a real hit and the next one, walking the
// actual trace forward the same shorter-arc-distance way the RingRunner
// itself does (two consecutive entries at the same spoke still need a full
// 12-pulse lap, since the ring can't already be there twice in a row).
// Renamed from nextRealHit -- "one whole trace, read three ways" (see
// README) dropped the ring-tier filter this used to apply: the tracer now
// glides toward the next NON-REST entry regardless of tier, since every
// ring's own drawn hull traces the complete phrase, not just its own
// tier's subset.
function nextTraceHit(trace, fromIndex, fromSpoke, words) {
  let spoke = fromSpoke;
  let idx = fromIndex;
  let pulses = 0;
  let direction = 1;
  for (let steps = 0; steps < trace.length; steps++) {
    idx = (idx + 1) % trace.length;
    const entry = trace[idx];
    if (spoke === entry.spoke) {
      pulses += SPOKE_COUNT; // must lap fully -- can't already be there
    } else {
      const cw = ((entry.spoke - spoke) % SPOKE_COUNT + SPOKE_COUNT) % SPOKE_COUNT;
      const ccw = SPOKE_COUNT - cw;
      if (cw < ccw) { pulses += cw; direction = 1; }
      else if (ccw < cw) { pulses += ccw; direction = -1; }
      else {
        const word = entry.isRest ? null : words.find((w) => w.includes(entry));
        direction = word ? wordHandedness(word) : direction;
        pulses += cw; // cw === ccw here, either is correct
      }
    }
    spoke = entry.spoke;
    if (!entry.isRest) return { pulses, spoke: entry.spoke };
  }
  return null; // pathological: trace is nothing but rests
}

function splitIntoWords(trace) {
  const words = [];
  let current = [];
  for (const entry of trace) {
    if (entry.isRest) {
      if (current.length) words.push(current);
      current = [];
    } else {
      current.push(entry);
    }
  }
  if (current.length) words.push(current);
  return words;
}

let currentTrace = [];
let currentWords = [];
// Real stage-boundary metadata from transform.js's own buildProcession
// (empty when there's no response chain) -- see the Play handler and
// onNoteHit's own stage-crossing check below.
let stageBoundaries = [];
// Per ring: { fromSpoke, toSpoke, totalPulses, pulsesElapsed, lastPulseTime }
// -- null until that ring's first real hit of the current phrase.
const hullCursor = { given: null, received: null, made: null };
// The tracer's own brief glow-boost on a real hit -- "a fading oscilloscope-
// like tracer" gets a genuine pulse of brightness right as it actually
// crosses a real letter.
const ringHitFlash = { given: null, received: null, made: null };

// "Distinguish tiers by emphasis, not by absence." 1.0 = the original hard
// tier gate exactly (a passed letter's velocity is 1 - 1 = 0, silent);
// 0.0 = every ring voices the whole phrase equally, in its own register;
// between, a passed letter sounds at 1 - tierEmphasis, present but
// subordinate to a home-tier hit. Read fresh in onNoteHit/onChordHit
// (same "current value, not a snapshot" pattern already used everywhere
// else a live-tunable parameter is read at the moment it's needed).
let tierEmphasis = 1;

// The Response operator's open step chain -- see transform.js's own
// buildProcession/describeSteps. Each step: { type: "mirror"|"rotate"|
// "retrograde", degree? (rotate only), bounce? }. Kept in sync with the
// dynamic step-row UI below; read fresh at Play time (main.js's own
// established pattern for every other response-adjacent control).
// "Set up for ideal display of its capabilities... mirror step" -- one
// pre-added by default so a fresh page load already demonstrates the
// Response operator, rather than requiring a click before anything shows.
let responseSteps = [{ type: "mirror" }];

function renderResponseSteps() {
  const container = $("response-steps");
  container.innerHTML = "";
  responseSteps.forEach((step, i) => {
    const row = document.createElement("div");
    row.className = "response-step-row";

    const index = document.createElement("span");
    index.className = "step-index";
    index.textContent = `${i + 1}.`;
    row.appendChild(index);

    const typeSelect = document.createElement("select");
    ["mirror", "rotate", "retrograde"].forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      if (t === step.type) opt.selected = true;
      typeSelect.appendChild(opt);
    });
    typeSelect.title = "mirror = the enantiomer (law's 'inversion'), reflected across the I-O spine. rotate = transposition by any degree (spokes). retrograde = procession reversal (law's own named 'retrograde') -- plays the stage's letters back in reverse order.";
    typeSelect.addEventListener("change", (e) => {
      step.type = e.target.value;
      if (step.type !== "rotate") delete step.degree;
      else if (step.degree === undefined) step.degree = ROTATION_SPOKE_SHIFT;
      renderResponseSteps();
    });
    row.appendChild(typeSelect);

    if (step.type === "rotate") {
      const degreeInput = document.createElement("input");
      degreeInput.type = "number";
      degreeInput.min = "1";
      degreeInput.max = "11";
      degreeInput.step = "1";
      degreeInput.value = step.degree ?? ROTATION_SPOKE_SHIFT;
      degreeInput.title = "Degree in SPOKES (each = 30 degrees geometrically), 1-11 -- every downstream consumer (melody matching, pitch lookup) is integer-spoke-only. 7 is the law's own conventional default (a perfect fifth); the literal letter-respelling (K->G etc.) only applies at exactly 7, since that pairing is specifically the phonology-channel voicing twin, not a general fact about any rotation amount -- every other degree is a pure geometric spoke rotation.";
      degreeInput.addEventListener("input", (e) => {
        const v = parseInt(e.target.value, 10);
        step.degree = Number.isFinite(v) ? Math.max(1, Math.min(11, v)) : ROTATION_SPOKE_SHIFT;
      });
      row.appendChild(degreeInput);
    }

    const bounceLabel = document.createElement("label");
    bounceLabel.className = "inline";
    const bounceCheckbox = document.createElement("input");
    bounceCheckbox.type = "checkbox";
    const defaultBounce = step.type === "mirror";
    bounceCheckbox.checked = step.bounce ?? defaultBounce;
    bounceCheckbox.title = "bounce = an out-and-back (this stage, then back to whatever came before it) -- the way a reflection actually behaves; default on for mirror. off = a plain restatement in series at the new stage -- default for rotate/retrograde.";
    bounceCheckbox.addEventListener("change", (e) => { step.bounce = e.target.checked; });
    bounceLabel.appendChild(bounceCheckbox);
    bounceLabel.appendChild(document.createTextNode("bounce"));
    row.appendChild(bounceLabel);

    row.appendChild(Object.assign(document.createElement("span"), { className: "step-spacer" }));

    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.textContent = "↑";
    upBtn.disabled = i === 0;
    upBtn.addEventListener("click", () => {
      [responseSteps[i - 1], responseSteps[i]] = [responseSteps[i], responseSteps[i - 1]];
      renderResponseSteps();
    });
    row.appendChild(upBtn);

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.textContent = "↓";
    downBtn.disabled = i === responseSteps.length - 1;
    downBtn.addEventListener("click", () => {
      [responseSteps[i], responseSteps[i + 1]] = [responseSteps[i + 1], responseSteps[i]];
      renderResponseSteps();
    });
    row.appendChild(downBtn);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.title = "remove step";
    removeBtn.addEventListener("click", () => {
      responseSteps.splice(i, 1);
      renderResponseSteps();
    });
    row.appendChild(removeBtn);

    container.appendChild(row);
  });
}
$("response-add-step").addEventListener("click", () => {
  responseSteps.push({ type: "mirror" });
  renderResponseSteps();
});
renderResponseSteps();

// "A cyclic pattern procession... cyclical transposition patterns... could
// drive this... denoting the transposition state/offset/modal shift
// currently at play." A different LAYER than the step chain above, on
// purpose -- that operates on trace STRUCTURE, built once per Play; this is
// a continuous, real-time, GLOBAL pitch-offset that keeps advancing while
// the piece plays, decoupled so either can be used alone or together.
// Advances by transpositionStepSpokes (mod 12) once per full pass of the
// GIVEN ring (slowest, outermost, the ring this feature's own visual ring
// circumscribes) -- at the default step of 7, this is literally the circle
// of fifths as a real-time process: gcd(7,12)=1, so it visits all 12
// positions before returning home, a real, self-resolving musical
// structure, not invented for this engine.
// Defaults to true (matches index.html's own `checked` on the checkbox --
// the change listener only fires on user interaction, not on page load, so
// both need to independently agree) -- "set up for ideal display of its
// capabilities," cyclic transposition on by default for the demo.
let transpositionEnabled = true;
let transpositionStepSpokes = ROTATION_SPOKE_SHIFT;
let transpositionOffsetSpokes = 0;
// Real bug, root cause of "instant jumps": advanceTransposition used to
// glide directly between two WRAPPED (0-11) offsets. Whenever
// old+step >= 12, the wrapped `newOffset` can be numerically LESS than
// the old one (e.g. 7 -> 2 at the default step of 7), so a straight
// fromOffset->toOffset interpolation glides BACKWARD by 5 instead of
// forward by the real step of 7 -- confirmed directly: 7 of every 12
// advances at step=7 wrap this way. Harmless when this only drove a small
// 2D marker dot; now that the WHOLE 3D figure's own tilt axis is derived
// from it, every one of those wraps reads as the whole form snapping.
// This never wraps -- only ever used to derive a glide/angle (both
// naturally periodic via cos/sin), never for an actual spoke lookup
// (transpositionOffsetSpokes, wrapped, still does that job).
let transpositionOffsetUnwrapped = 0;
let currentRootSpoke = 1;
// For the revolving ring's own smooth "click over" -- extrapolated from
// real elapsed time against the live pulse rate, not a fixed CSS-style
// tween, so it stays correct if the rate slider moves mid-glide (this one
// still needs that extrapolation, unlike continuousSpoke below, since the
// transposition ring has no sequencer-side pulse accumulator of its own).
let transpositionGlide = { fromOffset: 0, toOffset: 0, startedAt: performance.now() };

function transposedSpoke(spoke) {
  return transpositionEnabled ? rotateSpoke(spoke, transpositionOffsetSpokes) : spoke;
}

function advanceTransposition() {
  const newOffset = ((transpositionOffsetSpokes + transpositionStepSpokes) % 12 + 12) % 12;
  // Glide the UNWRAPPED accumulator (always +transpositionStepSpokes,
  // genuinely forward, never a backward wrap artifact) -- see its own
  // comment above.
  transpositionGlide = { fromOffset: transpositionOffsetUnwrapped, toOffset: transpositionOffsetUnwrapped + transpositionStepSpokes, startedAt: performance.now() };
  transpositionOffsetUnwrapped += transpositionStepSpokes;
  transpositionOffsetSpokes = newOffset;
  // "The trace and music don't actually follow suit" -- this was the real
  // gap: only the kalimba/note-timbre real-hit voice (hzForSpoke below) and
  // the flute's own CHAMBER (resonance color) ever rotated. The flute's own
  // sustained PITCH -- the dominant, continuously-audible voice whenever the
  // drone is on -- never did, because it's derived from _droneBaseHz, the
  // bass drone's own fixed-on-O anchor. audio.setTranspositionOffset feeds a
  // SEPARATE ratio the flute reads instead (see synth.js's
  // _effectiveDroneBaseHz) -- the bass drone's own anchor stays untouched.
  audio.setTranspositionOffset(transpositionOffsetSpokes);
  if ($("chamber-follows-input").checked) {
    audio.setChamberRoot(hzForSpoke(rotateSpoke(currentRootSpoke, transpositionOffsetSpokes)) * Math.pow(2, DRONE_OCTAVE_SHIFT));
  }
  // "Animating an echoing visual transform of the trace, which should help
  // ground and visually represent the transpositions... as they truly
  // affect the sound." This is the one moment the pitch actually jumps --
  // flash the master hull so the step reads as a real structural event,
  // not just a marker dot gliding, and morph a ghost of each ring's own
  // current trace by the exact real interval the pitch just jumped by.
  view.pulseFigure("transposition");
  view.spawnTransposeEcho(transpositionStepSpokes);
  // "A... transform should propagate out and erase the completed trace
  // within the active draw plane" -- after the morph echo captures what
  // the transform just did, push the (pre-transform) flat-plane content
  // into the tunnel and clear it, so new drawing starts fresh under the
  // new transposition state.
  view.retireTrace();
}

// Interpolated offset for the revolving ring, glided over one GIVEN-ring
// pulse (the same derived-not-arbitrary timing every other note-change gate
// in this engine already uses) rather than snapping.
$("transposition-enabled").addEventListener("change", (e) => {
  transpositionEnabled = e.target.checked;
});
$("transposition-step").addEventListener("input", (e) => {
  const v = parseInt(e.target.value, 10);
  transpositionStepSpokes = Number.isFinite(v) ? Math.max(1, Math.min(11, v)) : ROTATION_SPOKE_SHIFT;
});

function transpositionGlideProgress() {
  const g = transpositionGlide;
  const pulseSec = 1 / ringPulsesPerSecond("given");
  const t = Math.min(1, (performance.now() - g.startedAt) / 1000 / pulseSec);
  return g.fromOffset + (g.toOffset - g.fromOffset) * t;
}

function hullCursorPoint(ring) {
  const hc = hullCursor[ring];
  if (!hc || hc.totalPulses <= 0) return null;
  const subPulse = Math.min(1, ((performance.now() - hc.lastPulseTime) / 1000) * ringPulsesPerSecond(ring));
  const progress = Math.min(1, (hc.pulsesElapsed + subPulse) / hc.totalPulses);
  return { fromSpoke: hc.fromSpoke, toSpoke: hc.toSpoke, progress };
}

// "The rotating rim should probably stay static and only advance/rotate to
// its new transpose state/offset on the transpose or given step, and each
// of the inner wheels should do the same, but each successive concentric
// ring should travel at their own prescribed rate, like an orrery being
// adjusted." Replaces the old continuous per-frame accumulator (which spun
// forever, the opposite of a stepped mechanism) with a genuinely discrete
// dial: holds perfectly still between its own real trigger events, then
// eases to its new offset over `settleMs` -- a mechanism being turned, not
// a wheel spinning freely. `stepDial` reads the CURRENT eased position as
// the new `from`, so a step that lands mid-ease continues smoothly instead
// of snapping backward.
function makeDial(settleMs) {
  return { from: 0, to: 0, startedAt: performance.now(), settleMs };
}
function stepDial(dial, deltaSpokes) {
  const current = dialOffset(dial);
  dial.from = current;
  dial.to = current + deltaSpokes;
  dial.startedAt = performance.now();
}
function dialOffset(dial) {
  const t = Math.min(1, (performance.now() - dial.startedAt) / dial.settleMs);
  const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic -- a settling mechanism, not a linear tween
  return dial.from + (dial.to - dial.from) * eased;
}

// "A universal grounding tempo... a fixed rate." The old exponential
// slider/pedal-rate curve (RATE_CURVE_EXPONENT, currentRate/sliderLinear/
// midiLinear/rateSource) is gone -- there is no longer a 0..1 control to
// curve. Tempo is now the fixed anchor set once in Sequencer's own
// constructor (see wheel.js's GROUNDING_BPM); tickRate() below just reads
// sequencer.pulsesPerSecond directly.

const phaseByRing = { given: "idle", received: "idle", made: "idle" };
let convergenceCount = 0;

// Vowel-formant, driven by real trace content -- NOT the dropdown. Of the
// three vowel primes (L8), only "vertical" has an object and a token at
// all: "vertical (human, = I)." Horizontal and nub have neither yet, so
// they genuinely can't be wired to typed input until they're named --
// that's not deferred out of laziness, there's nothing to type. Whenever I
// is actually hit in a trace, that's a real vowel occurring, so it drives
// the formant automatically. Other letters leave the formant where it is
// rather than resetting to neutral -- real speech glides between vowels
// through consonants, it doesn't snap back to a rest state each one.
function applyVowelFromLetters(letters) {
  if (letters.includes("I")) audio.setVowelFormant("vertical");
}

const sequencer = new Sequencer({
  onOrigin: (ring, origin) => {
    // NOT wired to the vowel formant -- this "I" is the procession's
    // unconditional opening gesture, structural, fires on every trace
    // regardless of what was typed. It isn't real input content, so it
    // must not drive something that's supposed to represent real input
    // content -- that would silently default every trace to vertical.
    audio.playNote(hzForSpoke(origin.spoke) * RING_OCTAVE_MULTIPLIER[ring], { duration: 1.4, ring });
  },
  // "Given" (slowest, outermost) drives the cyclic transposition -- see
  // advanceTransposition's own comment for why this ring specifically.
  onTraceLoop: (ring) => {
    if (ring === "given") {
      // "The rotating rim should... only advance/rotate to its new
      // transpose state/offset on the transpose or given step" -- one full
      // pass of the given ring IS that step. Steps by the real
      // transposition interval when transposition is active (so the rim
      // literally shows the same offset the pitch just jumped by); a plain
      // 1-spoke advance otherwise, so the rim still reads as a real,
      // ticking mechanism even with transposition off. All three ring
      // dials step by the exact same delta, toward the exact same shared
      // target -- "each ring's trace can follow its corresponding
      // ring-character diagram sibling in its motion through
      // transposition" -- each just arrives at its own tempo-relative pace
      // (see RING_TRANSPOSE_BASE_SETTLE_MS above).
      const delta = transpositionEnabled ? transpositionStepSpokes : 1;
      stepDial(rimDial, delta);
      stepDial(ringDials.given, delta);
      stepDial(ringDials.received, delta);
      stepDial(ringDials.made, delta);
      // "A full-trace... should propagate out and erase the completed
      // trace within the active draw plane" -- given completing a full
      // pass IS a full-trace. Push everything currently on the flat plane
      // into the tunnel and clear it, so the next pass draws fresh.
      //
      // "Transform motions don't appear to be triggering additional
      // echoes." Real bug, root-caused: retireTrace() used to run
      // unconditionally HERE, before advanceTransposition() below -- but
      // advanceTransposition() reads the still-live trail to build its own
      // transform/burst echoes (spawnTransposeEcho, pulseFigure), and
      // ALSO ends with its own retireTrace() call. Calling it here first
      // cleared the trail out from under advanceTransposition() every
      // single time, so its echo-spawning always found an empty trail and
      // silently produced nothing -- confirmed directly (0 transform/burst
      // echoes across many transposition steps with this ordering,
      // vs. a full spawn when the trail is still present). Only retire
      // here when transposition is OFF (advanceTransposition never runs,
      // so nothing else will); when it's on, advanceTransposition owns the
      // entire spawn-then-retire sequence itself, in the right order.
      if (transpositionEnabled) {
        advanceTransposition();
      } else {
        view.retireTrace();
      }
    }
  },
  onPulse: (ring, spoke) => {
    // Drone rhythm/formant driven by the wheel's own real pulse events, not
    // an independent free-running LFO approximating the same tempo -- see
    // synth.js's pulseDrone for why (this was "the drone feels disjointed
    // from the wheel," addressed at the actual clock level).
    audio.pulseDrone(ring, spoke);
    // "[Phase bars] emanate echoes outward on relevant time-based events"
    // -- one real raw pulse IS this ring's own time-based event.
    view.pulsePhaseBarPulse(ring);
    // Tracer progress -- one more real raw pulse traveled toward whichever
    // real hit this ring is currently gliding toward.
    const hc = hullCursor[ring];
    if (hc) {
      hc.pulsesElapsed += 1;
      hc.lastPulseTime = performance.now();
    }
  },
  onNoteHit: (ring, target, traceIndex) => {
    // "Animating an echoing visual transform of the trace... as they truly
    // affect the sound and its trace throughout the procession" -- this
    // ring's own playhead really did just enter a transformed stage (see
    // the Play handler's own stageBoundaries, from transform.js's
    // buildProcession). Each ring crosses independently, at its own real
    // pace -- three separate real events over time, not artificially
    // synchronized, the same "purely observed" convention onGrandConvergence
    // already uses. Checked ahead of the isRest branch below since a
    // boundary's own traceIndex can itself land on a rest.
    const boundary = stageBoundaries.find((b) => b.index === traceIndex);
    if (boundary) {
      view.spawnTransformEcho(
        ring,
        boundary.fromStage.map((e) => e.spoke),
        boundary.toStage.map((e) => e.spoke),
        1100, 0.85
      );
      view.pulseFigure("stage");
      // "A... transform should propagate out and erase the completed
      // trace within the active draw plane" -- scoped to just THIS ring,
      // since a stage crossing is a per-ring, asynchronous event (see
      // retireRingTrace's own comment for why not all three).
      view.retireRingTrace(ring);
    }
    // "One whole trace, read three ways" (see README) -- a ring's own
    // sweep always did reach every letter's spoke (the geometric hit
    // "still always happens", per this block's own long-standing comment
    // above); the OLD binary tier gate below then threw away two thirds of
    // that motion as if it never occurred, so no voice and no drawn hull
    // ever stated the whole phrase. Tier now sets a VELOCITY, not a
    // silence/sound switch: this ring's own tier (given/received/made,
    // letters.js's ringForLetter) and undecided content (e.g. ŋ, no ring
    // settled yet) sound at full velocity, same as always; a passed
    // letter sounds at `1 - tierEmphasis`, so at emphasis 1.0 (the
    // control's default) this is byte-identical to the old hard gate, and
    // at 0.0 every ring voices the whole phrase equally.
    const tier = target.isRest ? null : ringForLetter(target.letter);
    const owned = target.isRest || tier === undefined || tier === ring;
    const velocity = target.isRest ? 0 : owned ? 1 : 1 - tierEmphasis;
    if (!target.isRest) {
      // "I'm noticing a disparity in the rotation of the master hull and
      // the actual trace being drawn... they shouldn't be allowed to
      // drift." Root cause, found by tracing exactly where each signal
      // comes from: this used to draw at transposedSpoke() -- the INSTANT,
      // un-eased transposition value -- while the master hull/bezel/
      // letters all rotate through the EASED rim/ring dials (main.js's
      // makeDial/stepDial), which take real time (900-2000ms) to settle
      // after every step. For that whole settle window, the trace jumped
      // instantly to its new position while the hull was still easing
      // toward it -- a genuine, structural mismatch, not a rendering
      // glitch. Fixed at the root: this now records the RAW canonical
      // spoke (same as every other structural element), and view.js
      // applies the SAME live rim dial (masterRotationOffset) to the
      // trace/tracer that it already applies to the hull -- one shared
      // rotation source, so they cannot drift apart by construction. The
      // actual SOUND still transposes instantly (hzForSpoke below is
      // untouched) -- only the drawn geometry now waits on the same real
      // dial as everything else it's drawn alongside.
      view.recordVisit(ring, target.spoke, owned);
      // Tracer -- glide from here toward whichever real hit comes next in
      // the WHOLE trace (no longer filtered to this ring's own tier), so
      // the stylus sweeps the complete shape too. Canonical spoke, same
      // reasoning as recordVisit above -- view.js rotates it at draw time.
      const next = nextTraceHit(currentTrace, traceIndex, target.spoke, currentWords);
      hullCursor[ring] = next
        ? { fromSpoke: target.spoke, toSpoke: next.spoke, totalPulses: next.pulses, pulsesElapsed: 0, lastPulseTime: performance.now() }
        : null;
      // A genuine brightness pulse on the tracer right as it crosses a
      // real letter -- "a fading oscilloscope-like tracer." Fires on every
      // geometric hit now, same as the trace/tracer above.
      ringHitFlash[ring] = { firedAt: performance.now(), life: 300 };
      // Resultant-rhythm percussion -- "on every real hit, on every ring,"
      // structurally unrelated to the tier gate/tier-emphasis/ghost-taps
      // (unlike the audible kalimba/flute below, which ARE gated by
      // velocity). The geometric hit is what this engine is; percussion
      // marks all of it, not just the audible subset. Audio only -- the
      // visual side no longer spawns per-hit events at all (view.js's
      // continuous extrusion layers already echo whatever's currently in
      // the persistent trace, automatically, every frame).
      audio.playPercussionHit(ring);
    }
    if (!target.isRest && velocity > 0) {
      audio.playNote(hzForSpoke(transposedSpoke(target.spoke)) * RING_OCTAVE_MULTIPLIER[ring], { duration: 0.9, velocity, ring });
      applyVowelFromLetters([target.letter]);
      keyboard.flash(target.letter);
      legendGrid.flash(target.letter);
      // Triatonic flute -- a real hit glides that ring's already-sustained
      // voice to a new harmonic (see synth.js's meanderFlute); the voice
      // itself never stops, only its pitch meanders. Skipped entirely at
      // velocity 0 (emphasis 1.0, passed letter) -- unchanged from before.
      audio.meanderFlute(ring, target.spoke);
    } else if (!target.isRest && velocity === 0 && $("ghost-taps").checked) {
      // Hocket experiment -- this ring's own beat really did land here, it
      // just isn't this ring's letter and emphasis is fully closing it out.
      // A soft click stands in for the true silence, making the already-
      // existing interlocking structure (three rings trading off who
      // sounds/rests) audible as rhythm.
      audio.playGhostTap(ring);
    }
    const label = target.isRest
      ? "rest"
      : velocity > 0
        ? `hit: ${target.letter} (spoke ${target.spoke}, velocity ${velocity.toFixed(2)})`
        : `passed: ${target.letter} (${tier}-tier, not this ring)`;
    $("status").textContent = `[${ring}] ${label}`;
  },
  onChordHit: (ring, word, wordIndex, pulseLength) => {
    // "duration = arc" -- pulseLength is the word's own arc (see
    // sequencer.js's wordArc), not a flat constant. Converted to seconds
    // at the ring's CURRENT pulse rate, same time-unit the rhythmic
    // spacing already uses, so a word's ring-out length and its spacing
    // from the next chord are both expressions of the same underlying
    // pulse, not two unrelated numbers.
    const durationSec = Math.min(4, Math.max(0.4, (pulseLength / ringPulsesPerSecond(ring)) * 0.7));

    // "One whole trace, read three ways" -- same velocity-not-silence
    // treatment as onNoteHit, per letter within the word. The word's
    // rhythm (pulseLength/durationSec above) is still derived from the
    // FULL word regardless -- tempo doesn't change, only how loud each of
    // the word's own letters strikes on this ring.
    const entryVelocity = (entry) => {
      const tier = ringForLetter(entry.letter);
      return tier === undefined || tier === ring ? 1 : 1 - tierEmphasis;
    };
    const soundingEntries = word.filter((entry) => entryVelocity(entry) > 0);

    // De-duplicate by spoke -- a word repeating a letter shouldn't stack
    // identical oscillators. Small strum stagger between notes rather than
    // a perfectly simultaneous trigger, closer to how a real strum sounds.
    // A repeated spoke takes the LOUDEST velocity among its occurrences
    // (max, not last/first) so a genuine home-tier hit is never quietly
    // shadowed by an earlier passed one at the same spoke.
    const velocityBySpoke = new Map();
    soundingEntries.forEach((entry) => {
      velocityBySpoke.set(entry.spoke, Math.max(velocityBySpoke.get(entry.spoke) || 0, entryVelocity(entry)));
    });
    [...velocityBySpoke.entries()].forEach(([spoke, velocity], i) => {
      setTimeout(() => {
        audio.playNote(hzForSpoke(transposedSpoke(spoke)) * RING_OCTAVE_MULTIPLIER[ring], { duration: durationSec, velocity, ring });
      }, i * 20);
    });
    if (soundingEntries.length) {
      applyVowelFromLetters(soundingEntries.map((e) => e.letter));
      soundingEntries.forEach((e) => {
        keyboard.flash(e.letter);
        legendGrid.flash(e.letter);
      });
      // Triatonic flute -- one glide per struck chord (not per letter in
      // it, the way ghost-taps also fire once per chord), toward the
      // chord's own first sounding spoke.
      audio.meanderFlute(ring, soundingEntries[0].spoke);
    } else if ($("ghost-taps").checked) {
      // Hocket experiment, chord-mode version -- one click for the whole
      // struck-but-silent chord (not one per muted letter; a chord is a
      // single rhythmic event, unlike melody mode's individual hits).
      // Only reachable at emphasis 1.0, where soundingEntries is empty
      // exactly as it always was under the old hard gate.
      audio.playGhostTap(ring);
    }
    // Note-to-note trace -- the whole word's own shape, every letter in
    // order, regardless of whether it also sounds on this ring (see
    // onNoteHit's identical reasoning). `owned` marks which vertices this
    // ring actually strikes, for view.js's bright/dim illumination.
    // Canonical spoke, same reasoning as onNoteHit's own fix -- view.js
    // rotates it via the same live rim dial the master hull uses, so the
    // two can never drift apart.
    word.forEach((e) => view.recordVisit(ring, e.spoke, entryVelocity(e) === 1));
    // Resultant-rhythm percussion -- one hit per struck chord (a chord is
    // a single rhythmic event, same "once per chord, not once per letter"
    // convention meanderFlute/ringHitFlash already use in chord mode
    // below), unconditional on tier/velocity, same as onNoteHit. Audio
    // only, same reasoning as onNoteHit.
    audio.playPercussionHit(ring);
    // Tracer -- chord mode already knows pulseLength exactly (sequencer.js
    // fires the next chord after exactly that many pulses), so no
    // forward-walk is needed here, unlike melody mode. Anchored on the
    // word's own LAST letter now (not the last one that happened to sound
    // on this ring), since the tracer follows the whole word's shape.
    const nextWord = currentWords[(wordIndex + 1) % currentWords.length];
    hullCursor[ring] = nextWord && nextWord.length
      ? {
          fromSpoke: word[word.length - 1].spoke,
          toSpoke: nextWord[0].spoke,
          totalPulses: pulseLength,
          pulsesElapsed: 0,
          lastPulseTime: performance.now(),
        }
      : null;
    if (soundingEntries.length) {
      // Same brightness pulse as onNoteHit -- one flare per struck chord
      // (matching how the flute/ghost-tap treatment already fires once per
      // chord here too, not once per letter in it).
      ringHitFlash[ring] = { firedAt: performance.now(), life: 300 };
    }
    const wordLabel = word.map((e) => e.letter).join("-");
    const label = soundingEntries.length
      ? `chord: ${soundingEntries.map((e) => e.letter).join("-")} of ${wordLabel} (arc ${pulseLength}, ${durationSec.toFixed(2)}s)`
      : `chord: silent (no ${ring}-tier letters in ${wordLabel})`;
    $("status").textContent = `[${ring}] ${label}`;
  },
  onPhaseChange: (ring, phase) => {
    phaseByRing[ring] = phase;
    $("phase").textContent = `given:${phaseByRing.given} received:${phaseByRing.received} made:${phaseByRing.made}`;
  },
  onGrandConvergence: () => {
    // All three rings land on I simultaneously -- a real, periodic
    // "conjunction" (see sequencer.js), not a stop. Nothing halts; this is
    // purely observed.
    convergenceCount += 1;
    logConvergence();
    // "Processional cycles and cyclical alignments" punctuated now, not
    // just logged -- one accent note at spoke 1 (received's own neutral
    // register, the same convention the whistle-audition default already
    // uses) plus the dedicated chime accent (see synth.js's
    // playConvergenceAccent -- deliberately a different character from
    // the breath cycle's own steady thump, a genuinely different event).
    audio.playNote(hzForSpoke(transposedSpoke(1)) * RING_OCTAVE_MULTIPLIER.received, { duration: 1.4, velocity: 1.3, ring: "received" });
    audio.playConvergenceAccent();
    // "A cohesive, pulsating... object" -- the whole figure's own bigger
    // climax pulse, same weight distinction as the audio side already
    // makes (playConvergenceAccent vs playBreathAccent below). The
    // extrusion layers themselves (view.js) already continuously echo
    // whatever the current trace is -- this pulse is what makes THIS
    // moment read as bigger, not a separate spawned echo.
    view.pulseFigure("convergence");
  },
  // "The pattern's own periodic downbeat... the felt heartbeat/breath
  // under the ring-driven complexity" -- fired once per breath cycle
  // (sequencer.js's own 36-master-pulse counter, see wheel.js's
  // BREATH_CYCLE_PULSES/GROUNDING_BPM), independent of ring convergence.
  onBreathCycle: () => {
    audio.playBreathAccent();
    // The steady, subtle whole-figure pulse -- same real anchor the audio
    // accent above already uses.
    view.pulseFigure("breath");
  },
  // "Ring retrograde/prograde reversals could be punctuated by accent
  // notes and accent percussion hits." A real reversal (sequencer.js's
  // own onDirectionReversal, fired only on a genuine flip) gets one
  // accent note at the ring's own current spoke/register plus one accent
  // percussion hit through that ring's own existing kick/snare/hat role
  // -- reusing what each ring already sounds like, not a fourth "reversal
  // sound."
  onDirectionReversal: (ring, spoke) => {
    audio.playNote(hzForSpoke(transposedSpoke(spoke)) * RING_OCTAVE_MULTIPLIER[ring], { duration: 0.9, velocity: 1.3, ring });
    audio.playPercussionHit(ring, { accent: true });
    // "I'd like the radial timekeeping cursor itself to emit echoes,
    // especially on events like reversals" -- a real, comparatively rare
    // structural event (this ring's own sweep genuinely flipping
    // direction), so its own echo reads as bigger than a routine spoke
    // pass.
    view.pulsePhaseBarReversal(ring);
  },
});

// The four orrery dials -- see makeDial's own comment above. "The rings
// should each travel deliberately to their transpose position at a
// tempo-relative rate... the constantly-shifting ring graphics appear to
// be a mistake/leftover artifact." A real correction: these used to step
// on every one of a ring's own raw pulses (1.8-3.6 times/sec -- genuine
// visual noise, unrelated to anything meaningful). All four dials now step
// ONLY on a real transposition event (see onTraceLoop("given") below, the
// same rare event that already drives advanceTransposition) -- never per
// beat. Settle time is tempo-relative but now means something different:
// not "finish before the next pulse," but "how deliberately THIS ring
// arrives at the new shared transpose target" -- the slow outer given ring
// takes the longest, made (fastest) arrives soonest, a real cascade rather
// than three independent tickers.
const RING_TRANSPOSE_BASE_SETTLE_MS = 900;
const rimDial = makeDial((RING_TRANSPOSE_BASE_SETTLE_MS / ringSpeedMultiplier("given")) * 1.15);
const ringDials = {
  given: makeDial(RING_TRANSPOSE_BASE_SETTLE_MS / ringSpeedMultiplier("given")),
  received: makeDial(RING_TRANSPOSE_BASE_SETTLE_MS / ringSpeedMultiplier("received")),
  made: makeDial(RING_TRANSPOSE_BASE_SETTLE_MS / ringSpeedMultiplier("made")),
};

function logConvergence() {
  const log = $("loop-log");
  const line = document.createElement("div");
  line.textContent = `#${convergenceCount}: all rings converged on I`;
  log.prepend(line);
}

// "Better off going with a 2D hull trace" -- the whole 3D precession/tilt
// system (spokePoint3D, per-ring axes, the transposition-tilt-toward-
// marker) is retired; the trace is flat again, same plain spokePoint the
// structural diagram already uses.
// "Ebbing and flowing with processions/across the full arc of procession"
// -- peaks (1.0) exactly AT grand convergence, dips (0.35, never fully
// silent) at the cycle's own midpoint, cosine-shaped between. Real and
// synchronized to the actual ring state (sequencer.masterPulseCount), not
// a decorative LFO with a similar-looking period. Drives percussion
// density (tickRate below) -- real musical structure, not a fabricated
// signal.
function convergenceAmplitude() {
  const convergencePhase = (sequencer.masterPulseCount % GRAND_CONVERGENCE_PULSES) / GRAND_CONVERGENCE_PULSES;
  return 0.35 + (1 - 0.35) * (0.5 + 0.5 * Math.cos(2 * Math.PI * convergencePhase));
}

function render() {
  const transposition = transpositionEnabled
    ? { offset: transpositionGlideProgress() }
    : null;
  const hullCursorByRing = {
    given: hullCursorPoint("given"),
    received: hullCursorPoint("received"),
    made: hullCursorPoint("made"),
  };
  const ringDialOffsets = {
    given: dialOffset(ringDials.given),
    received: dialOffset(ringDials.received),
    made: dialOffset(ringDials.made),
  };
  // "The echoes should all pulsate in scale slightly along with the low
  // drones of our soundscape." The real rate a drone voice's own
  // breath/vibrato LFO runs at (synth.js's voiceLfo -- audio.droneParams is
  // public-by-convention, same precedent as every other direct read of it
  // in this file), read directly rather than sampled audio (which this
  // engine has never done and has no infrastructure for) -- an honest
  // "same rate," not a fabricated decorative wobble.
  const droneBreathHz = sequencer.pulsesPerSecond / audio.droneParams.breathPulsesPerCycle;
  view.render({
    ringLabelsAtSpoke, transposition, hullCursorByRing, ringHitFlash,
    masterRotationOffset: dialOffset(rimDial), ringDialOffsets, droneBreathHz,
  });
}
render();

function tickRate() {
  // Standardized master tempo, in BPM (wheel.js -- 12/8 meter, already
  // law-declared by the-codex-v1.md's own "onset = spoke in 12-pulse"
  // rather than a bare pulses/sec figure with no real-world unit behind
  // it). Fixed now (GROUNDING_BPM), not slider-derived -- still fed to the
  // audio engine continuously, drone on or off, so its own breath/vibrato/
  // sweep rates stay locked to procession speed -- see
  // OrphographAudio.setProcessionPulseRate.
  const masterPulsesPerSecond = sequencer.pulsesPerSecond;
  audio.setProcessionPulseRate(masterPulsesPerSecond);
  $("bpm-readout").textContent = `${Math.round(masterPulsesPerSecondToBpm(masterPulsesPerSecond))} BPM`;
  // See convergenceAmplitude's own comment -- shared with the trace
  // echoes' own brightness/color modulation now.
  audio.setPercussionDensity(convergenceAmplitude());
  // render() runs every animation frame here (not just once per pulse via
  // onPulse) so the tracer's own glide and each dial's own settle-ease
  // both stay genuinely continuous, even though the dials themselves only
  // STEP on real events.
  render();
  requestAnimationFrame(tickRate);
}
tickRate();

$("play").addEventListener("click", () => {
  audio.ensureContext();
  // The drone may already be toggled "on" (including by default -- see
  // setDrone's own comment) without its audio ever having actually
  // started, since that needs a real user gesture. Play is one.
  if (droneOn && !droneAudioStarted) {
    audio.setDroneVoices(true, DRONE_HZ);
    droneAudioStarted = true;
  }
  try {
    const { trace: callTrace, rootSpoke, unknownTokens } = deriveTrace($("input").value);

    // Response operator (the-codex-v1.md / master-blueprint-v2.md): "a
    // SELECTED transformation of the call -- from {prime, inversion,
    // retrograde, retrograde-inversion}... call never consumed." Generalized
    // from a fixed mirror+rotate-7 pair into an open, ORDERED, arbitrary-
    // length chain of steps (see responseSteps/the step-row UI below) --
    // "limiting transformations to a single layer/operation is arbitrary and
    // naive." Weaves a NEW phrase from the call plus its whole procession of
    // stages, rather than replacing what was typed -- the call still plays
    // in full. Zero steps (the default) plays exactly the call, unchanged.
    const built = responseSteps.length ? buildProcession(callTrace, responseSteps) : null;
    const trace = built ? built.woven : callTrace;
    // "Animating an echoing visual transform of the trace... as they truly
    // affect the sound and its trace throughout the procession" -- the real
    // traceIndex where each ring's own playhead ENTERS a transformed stage
    // (buildProcession's own already-computed before/after arrays, see
    // onNoteHit below), so the transform echo shows the ACTUAL operator
    // that just ran, never a reimplementation of it.
    stageBoundaries = built ? built.boundaries : [];

    // "Mode derived intuitively from input alone" -- the actual trace
    // about to play (call + any response) sets the flute's shared scale,
    // when the toggle is on. See deriveScaleFromTrace's own comment.
    if ($("scale-follows-input").checked) {
      const derived = deriveScaleFromTrace(trace);
      if (derived.length > 0) {
        audio.setDroneParam("whistleScale", derived);
        // "The scale in the text field doesn't seem to update" -- it
        // really wasn't: this call only ever reached the audio param
        // directly, so the field had no way to show what was actually
        // derived, even though the audio itself was correct. Now it
        // reflects the live-derived scale directly (and drops out of
        // "(custom)" the same way any other hand-edit would, since this
        // no longer matches a fixed mode preset).
        whistleScaleInput.value = derived.join(", ");
        $("whistle-mode-preset").value = "";
      }
    }

    // "Different drone flutes in different keys" -- rootSpoke is the
    // phrase's own already-derived root (trace.js: the first non-rest
    // letter's spoke), previously computed and then discarded (only ever
    // shown in the readout below). This is that root's actual job: which
    // fixed chamber the flute plays through for this phrase, the sampler
    // equivalent of picking up the instrument built in this key -- NOT the
    // drone's own anchor, which stays fixed on O regardless (settled law,
    // see DRONE_HZ above). Off (checkbox unchecked) leaves the chamber on
    // whatever it last was (initially the drone's own root) so this can be
    // A/B'd by ear against the always-derived behavior.
    currentRootSpoke = rootSpoke;
    // Each new phrase starts its own cycle fresh, from the tonic -- the
    // cyclic transposition is a property of THIS phrase's own repetitions,
    // not a standing global state that survives retyping.
    transpositionOffsetSpokes = 0;
    transpositionOffsetUnwrapped = 0;
    transpositionGlide = { fromOffset: 0, toOffset: 0, startedAt: performance.now() };
    audio.setTranspositionOffset(0);
    if ($("chamber-follows-input").checked) {
      audio.setChamberRoot(hzForSpoke(rootSpoke) * Math.pow(2, DRONE_OCTAVE_SHIFT));
    }

    convergenceCount = 0;
    $("loop-log").innerHTML = "";
    view.reset();
    ringHitFlash.given = ringHitFlash.received = ringHitFlash.made = null;
    // Each new phrase starts the orrery fresh too, same reasoning as the
    // transposition reset just above.
    rimDial.from = rimDial.to = 0;
    rimDial.startedAt = performance.now();
    for (const ring of ["given", "received", "made"]) {
      ringDials[ring].from = ringDials[ring].to = 0;
      ringDials[ring].startedAt = performance.now();
    }
    currentTrace = trace;
    currentWords = splitIntoWords(trace);
    hullCursor.given = hullCursor.received = hullCursor.made = null;
    // Master hull -- the whole phrase's own shape (every non-rest letter,
    // in order, regardless of which ring ends up voicing it), so a word
    // whose letters disperse across all three tiers still shows a real
    // hull even when no single ring's own trail gets enough points to draw
    // one. Known fully the instant the phrase is derived, so set once here
    // rather than built up from playback events like the per-ring hulls.
    // When a response is active, this is the CALL+RESPONSE woven shape --
    // the ping-pong zigzag or the series' two joined lobes are themselves
    // the visible signature of which transform produced them.
    const nonRestTrace = trace.filter((t) => !t.isRest);
    view.setMasterHull(nonRestTrace.map((t) => t.spoke), nonRestTrace.map((t) => t.letter));
    // "One whole trace, read three ways" -- MAX_TRACE_POINTS (view.js) used
    // to be sized for tier-FILTERED hits (~3 laps' worth); now every
    // geometric hit is recorded (owned or merely passed), so a fixed 32-point
    // window would cut a phrase off well before it completes one lap,
    // defeating the whole point of drawing the complete shape. Set to the
    // phrase's own length instead, so the trail's persistence window is
    // exactly the phrase -- clamped so a one-letter phrase still has room
    // for the master hull's own dashed reference and a very long phrase
    // doesn't grow the buffer unboundedly.
    view.setTraceCapacity(trace.length);
    sequencer.start(trace);
    $("root").textContent = `root spoke: ${rootSpoke} (drone anchor stays on O; `
      + `flute chamber ${$("chamber-follows-input").checked ? "follows this root" : "unchanged"})`
      + (responseSteps.length ? ` -- responding: ${describeSteps(responseSteps)}` : "");
    // "Handle any input, flag/discard any unrecognized input" -- unknown
    // characters no longer block the whole phrase (see trace.js); this
    // just makes sure they're visibly flagged rather than silently
    // vanishing, since a dropped character is still information worth
    // having (a typo, or a real gap in the alphabet).
    const warning = $("unknown-warning");
    if (unknownTokens.length) {
      warning.textContent = `skipped unrecognized: ${unknownTokens.map((t) => `"${t}"`).join(", ")} -- see README.md for known tokens`;
      warning.hidden = false;
    } else {
      warning.hidden = true;
    }
  } catch (err) {
    $("status").textContent = "error: " + err.message;
  }
});

$("stop").addEventListener("click", () => {
  sequencer.stop();
});

// "Set up for ideal display of its capabilities... drone on" -- but "all
// playback should be silent on stopped/not played, so the drone shouldn't
// start making sound until play is pressed." Two separate concerns:
// `droneOn` is the logical/displayed toggle state (can default to true);
// `droneAudioStarted` tracks whether audio.setDroneVoices has actually been
// called (real oscillators running). audio.ensureContext() requires a real
// user gesture, so it can never run at page load -- only a genuine click
// (the drone button itself, or Play, both real gestures) may start it.
let droneOn = true;
let droneAudioStarted = false;
function setDrone(on) {
  droneOn = on;
  audio.ensureContext();
  audio.setDroneVoices(on, DRONE_HZ);
  droneAudioStarted = true;
  $("drone").textContent = droneOn ? "drone: on (dry -> attested)" : "drone: off";
}
// Reflects the default `droneOn = true` in the button's own label WITHOUT
// touching audio -- see setDrone's own comment on why that has to wait for
// a real user gesture.
$("drone").textContent = "drone: on (dry -> attested)";
$("drone").addEventListener("click", () => setDrone(!droneOn));

// "A more direct way to survey the sound possibilities... dialed in more
// efficiently" -- previously the only way to hear a flute-parameter
// change was type/select a phrase and press play, waiting for a real hit
// to land. One shared voice now (was three) -- one retune, at spoke 4
// (the exact midpoint of the wheel-follow cosine curve between
// whistleHarmonicMin/Max regardless of their current values, so it's
// always a representative, not extreme, test pitch) through "received"
// (RING_OCTAVE_MULTIPLIER's own neutral/center register, the same
// convention construction itself defaults to at rest).
$("whistle-audition").addEventListener("click", () => {
  audio.ensureContext();
  if (!droneOn) setDrone(true);
  audio.meanderFlute("received", 4);
});

// "A GROUP of instruments whose harmonic relationships are parametrically
// authored... there must be a simpler solution than what we have." One
// authored data table instead of a separately-named slider per interval --
// outside wireTimbrePanel's generic numeric-slider loop since this is a
// list, not a single number, so it doesn't currently participate in
// preset save/load/factory-reset the way the numeric drone params do.
//
// "The harmonic range and the voicing text field are pretty unintuitive --
// is there a better solution that's more of a stylistic expression of
// established musical principles?" Authored in SEMITONES from the ring's
// own root (0=unison, 7=a fifth, 12=an octave, negative=below root) --
// real, standard interval vocabulary any musician already knows -- rather
// than raw frequency ratios (1.5, 1.25...) that need mental log-math to
// place on a keyboard. Converted to the ratio synth.js's DSP layer
// actually needs (equal temperament: 2^(semitones/12)) only here, at the
// authoring boundary -- the underlying audio graph is untouched by this,
// it only ever dealt in ratios and still does.
function semitoneVoicingToRatio(semitones) {
  return Math.pow(2, semitones / 12);
}
function parseWhistleVoicing(text) {
  const voices = text.split(",").map((chunk) => {
    const [semitoneStr, levelStr] = chunk.split(":");
    const semitones = parseFloat(semitoneStr);
    const level = parseFloat(levelStr);
    return Number.isFinite(semitones) && Number.isFinite(level)
      ? { ratio: semitoneVoicingToRatio(semitones), level }
      : null;
  }).filter(Boolean).slice(0, WHISTLE_MAX_VOICES);
  return voices;
}
const whistleVoicingInput = $("dp-whistleVoicingText");
// Same "preserve the last session, not just named presets" treatment as
// wireTimbrePanel's numeric params -- this field lives outside that
// generic system (a list, not a number), so it needs its own restore/save.
const whistleVoicingSession = loadLastSession("whistleVoicingText");
if (whistleVoicingSession && whistleVoicingSession.text) {
  whistleVoicingInput.value = whistleVoicingSession.text;
}
function applyWhistleVoicingText() {
  const parsed = parseWhistleVoicing(whistleVoicingInput.value);
  if (parsed.length === 0) return; // malformed/empty edit -- never silence the whole flute over a typo
  audio.setDroneParam("whistleVoicing", parsed);
  saveLastSession("whistleVoicingText", { text: whistleVoicingInput.value });
}
applyWhistleVoicingText();
whistleVoicingInput.addEventListener("change", () => {
  applyWhistleVoicingText();
  $("whistle-chord-preset").value = ""; // hand-edited -- no longer exactly the selected preset
});

// Real, named chord voicings (standard music theory, not invented ratios)
// as a starting point -- semitones:level strings, same format the text
// field itself takes, so picking one is just filling the field and
// applying it the normal way.
const WHISTLE_CHORD_PRESETS = {
  octaveStack: "-12:0.6, 0:1, 7:0.6, 12:0.5",
  unison: "0:1",
  openFifths: "0:1, 7:0.6, 12:0.4",
  majorTriad: "0:1, 4:0.5, 7:0.5",
  minorTriad: "0:1, 3:0.5, 7:0.5",
  sus4: "0:1, 5:0.5, 7:0.5",
  add9: "0:1, 7:0.5, 14:0.35",
  wideSpread: "-12:0.5, 0:1, 7:0.4, 12:0.4, 19:0.3",
};
$("whistle-chord-preset").addEventListener("change", (e) => {
  const preset = WHISTLE_CHORD_PRESETS[e.target.value];
  if (!preset) return; // "(custom)" -- leave whatever's currently typed alone
  whistleVoicingInput.value = preset;
  applyWhistleVoicingText();
});

// "More tailored control over modal arrangement" -- the shared scale
// (phase 26's dissonance fix) is now authored the same way whistleVoicing
// is: a plain semitone list, editable as text, with real named-mode
// presets as starting points. Malformed/empty edits are ignored, same
// safety as the voicing field -- never leave the flute unquantized.
function parseWhistleScale(text) {
  return text.split(",").map((s) => parseFloat(s.trim())).filter((n) => Number.isFinite(n));
}
const whistleScaleInput = $("dp-whistleScaleText");
const scaleSession = loadLastSession("whistleScaleText");
if (scaleSession && scaleSession.text) whistleScaleInput.value = scaleSession.text;
function applyWhistleScaleText() {
  const parsed = parseWhistleScale(whistleScaleInput.value);
  if (parsed.length === 0) return;
  audio.setDroneParam("whistleScale", parsed);
  saveLastSession("whistleScaleText", { text: whistleScaleInput.value });
}
applyWhistleScaleText();
whistleScaleInput.addEventListener("change", () => {
  applyWhistleScaleText();
  $("whistle-mode-preset").value = ""; // hand-edited -- no longer exactly the selected preset
});

// Real, named modes (standard music theory) -- semitone lists, same
// format the field itself takes.
const WHISTLE_MODE_PRESETS = {
  majorPentatonic: "0, 2, 4, 7, 9",
  minorPentatonic: "0, 3, 5, 7, 10",
  ionian: "0, 2, 4, 5, 7, 9, 11",
  aeolian: "0, 2, 3, 5, 7, 8, 10",
  dorian: "0, 2, 3, 5, 7, 9, 10",
  mixolydian: "0, 2, 4, 5, 7, 9, 10",
  wholeTone: "0, 2, 4, 6, 8, 10",
  chromatic: "0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11",
};
$("whistle-mode-preset").addEventListener("change", (e) => {
  const preset = WHISTLE_MODE_PRESETS[e.target.value];
  if (!preset) return;
  whistleScaleInput.value = preset;
  applyWhistleScaleText();
});

// "Mode, key, progression could be derived intuitively from input alone,
// free of arbitrary user decision-making... does this track?" -- yes,
// the same "derive from real state" principle already driving tempo
// timing and pitch-tracked filters all session, one level up to modal
// structure itself. The wheel's own spoke-to-semitone mapping is already
// direct and linear (hzForSpoke/PLACEHOLDER_SPOKE_OF in letters.js) -- the
// UNIQUE spokes the actual letters about to play land on already ARE a
// semitone set, no arbitrary scale choice needed. Computed fresh from
// the real trace (post-transform-weaving, so a mirror/rotate response
// contributes its own letters too) each time Play runs, when the toggle
// is on; leaves whatever's in the scale field alone when it's off, or if
// the phrase happens to touch no real letters at all.
function deriveScaleFromTrace(trace) {
  const semitones = new Set();
  for (const entry of trace) {
    const spoke = PLACEHOLDER_SPOKE_OF[entry.letter];
    if (spoke === undefined) continue;
    semitones.add(((spoke - 1) % 12 + 12) % 12);
  }
  return Array.from(semitones).sort((a, b) => a - b);
}

// Named vocal-register presets instead of raw harmonic-index numbers --
// sets the SAME whistleHarmonicMin/Max sliders wireTimbrePanel already
// wired up above (dispatching "input" so that existing listener does the
// actual apply/number-field-sync/preset-select-reset, rather than
// duplicating that logic here), just picked by ear-recognizable name.
// Each keeps roughly the same Min:Max span (a fifth) phase 17 found kept
// the cluster's full spread out of "dull or shrill with no middle" --
// "wide" is the one deliberate exception, offered as a clearly labeled
// choice now rather than an accidental default.
const WHISTLE_REGISTER_PRESETS = {
  bass: { min: 4, max: 6 },
  tenor: { min: 6, max: 9 },
  alto: { min: 8, max: 11 },
  soprano: { min: 9, max: 13 },
  wide: { min: 4, max: 13 },
};
function setSliderValue(id, value) {
  const el = $(id);
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
$("whistle-register-preset").addEventListener("change", (e) => {
  const preset = WHISTLE_REGISTER_PRESETS[e.target.value];
  if (!preset) return;
  setSliderValue("dp-whistleHarmonicMin", preset.min);
  setSliderValue("dp-whistleHarmonicMax", preset.max);
});

$("vowel-select").addEventListener("change", (e) => {
  audio.setVowelFormant(e.target.value);
});

const midi = new MidiBridge({
  onKeySpoke: (spoke, velocity) => {
    audio.playNote(hzForSpoke(transposedSpoke(spoke)), { duration: 0.6, velocity });
  },
  // "A universal grounding tempo... a fixed rate." The expression pedal
  // used to drive procession rate (onExpression -> midiLinear/rateSource,
  // both retired); tempo is fixed now, so there's nothing left for it to
  // control -- MidiBridge's own onExpression defaults to a no-op when
  // omitted, same as every other optional callback here.
  onSustain: (on) => setDrone(on),
  onStatus: (s) => {
    $("midi-status").textContent = s;
  },
});

$("connect-midi").addEventListener("click", () => midi.connect());

// Read-write, not read-only: slider and number box stay in sync both ways,
// and either one can override the live value at any time. Shared between
// the note and drone panels -- same shape of problem (a flat set of named
// numeric knobs), plus save/load/delete/reset against timbrePresets.js.
function wireTimbrePanel({ category, idPrefix, keys, setParam, defaults, presetSelectId, saveBtnId, deleteBtnId, resetBtnId }) {
  const select = $(presetSelectId);
  const rows = {};
  const FACTORY = "__factory__";

  function applyAll(params) {
    // "I changed a preset to an older version and it reverted the flute
    // fix." Root cause: a preset saved before a param existed (e.g. before
    // whistleFloorHz/whistleCeilingHz were added) has no entry for it --
    // params[key] was `undefined`, silently written into the slider and
    // into setParam as NaN, which quietly disables that param's own
    // guards (foldIntoRange's own "is this a real range" check reads NaN
    // as "no range configured" and skips folding entirely). A preset
    // missing a key now falls back to the CURRENT factory default for
    // just that key instead -- old presets stay forward-compatible as new
    // params get added, rather than able to silently switch a later
    // safety feature back off.
    keys.forEach((key) => {
      const value = key in params ? params[key] : defaults[key];
      rows[key].range.value = value;
      rows[key].number.value = value;
      setParam(key, Number(value));
    });
    saveLastSession(category, currentParams());
  }

  function currentParams() {
    const out = {};
    keys.forEach((key) => { out[key] = Number(rows[key].range.value); });
    return out;
  }

  function populateSelect(selectValue) {
    select.innerHTML = "";
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "(unsaved)";
    select.appendChild(blank);
    const factory = document.createElement("option");
    factory.value = FACTORY;
    factory.textContent = "factory default";
    select.appendChild(factory);
    loadPresets(category).forEach(({ name }) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    });
    select.value = selectValue !== undefined ? selectValue : "";
  }

  // "Preserve the parameter configurations of the last open session...
  // avoid having to go through presets every time I refresh or update
  // after a small modification." Restores from the continuously-updated
  // last-session snapshot (if one exists) instead of each slider's raw
  // HTML default -- falls back to that default for any key the snapshot
  // doesn't have (e.g. a param added in a later update than the saved
  // snapshot), so this never breaks on a stale/partial snapshot.
  const lastSession = loadLastSession(category);
  keys.forEach((key) => {
    const range = $(`${idPrefix}-${key}`);
    const number = $(`${idPrefix}-${key}-n`);
    rows[key] = { range, number };
    const initialValue = lastSession && key in lastSession ? lastSession[key] : Number(range.value);
    range.value = initialValue;
    number.value = initialValue;
    setParam(key, Number(initialValue));
    const apply = (value) => {
      range.value = value;
      number.value = value;
      setParam(key, Number(value));
      select.value = ""; // hand-edited -- no longer exactly the selected preset
      saveLastSession(category, currentParams());
    };
    range.addEventListener("input", (e) => apply(e.target.value));
    number.addEventListener("input", (e) => apply(e.target.value));
  });

  populateSelect("");

  select.addEventListener("change", (e) => {
    if (e.target.value === FACTORY) { applyAll(defaults); return; }
    if (e.target.value === "") return;
    const preset = loadPresets(category).find((p) => p.name === e.target.value);
    if (preset) applyAll(preset.params);
  });

  $(saveBtnId).addEventListener("click", () => {
    const startingName = select.value && select.value !== FACTORY ? select.value : "";
    const name = prompt("Save this timbre as:", startingName);
    if (!name) return;
    savePreset(category, name, currentParams());
    populateSelect(name);
  });

  $(deleteBtnId).addEventListener("click", () => {
    const name = select.value;
    if (!name || name === FACTORY) {
      alert("Select a saved preset to delete first -- factory default can't be deleted.");
      return;
    }
    deletePreset(category, name);
    populateSelect("");
  });

  $(resetBtnId).addEventListener("click", () => {
    applyAll(defaults);
    select.value = FACTORY;
  });
}

// Named once, referenced both by wireTimbrePanel below AND by the
// export/import settings feature further down -- the SAME authoritative
// key list either way, so the two can never drift apart.
const NOTE_PANEL_KEYS = ["attackMs", "lowpassHz", "lowpassQ", "bodyHz", "bodyQ", "bodyAmountDb", "pluckAmount", "pluckMs", "floorHz", "ceilingHz"];
const DRONE_PANEL_KEYS = [
  "busGain",
  "breathPulsesPerCycle", "breathDepth", "vibratoCyclesPerPulse", "vibratoCents", "breathNoiseGain",
  "formantF1Q", "formantF2Q", "formantBlendGain",
  "whistleHarmonic", "whistleHarmonicMin", "whistleHarmonicMax", "whistleFloorHz", "whistleCeilingHz",
  "whistleGlideMs", "whistleNoteGateDipAmount",
  "whistleDetuneCents",
  "whistleAmount",
  "whistleVibratoRateHz", "whistleVibratoCents", "whistleVibratoAmpDepth",
  "whistleBreathAmount", "whistleBreathColorRatio", "whistleBreathSurgeAmount", "whistleChiffAmount",
  "whistleArticulationPulseFraction", "whistleBreathToneCoupling", "whistleArticulationAmount",
  "whistleBrightnessTempoSensitivity", "whistleBrightnessReferencePps", "whistleToneColorRatio",
  "whistleChamberAmountDb", "whistleChamberQ", "whistleChamberModes",
  "whistleGrowlAmount", "whistleGrowlF1Hz", "whistleGrowlF2Hz", "whistleGrowlQ",
  "whistleGrowlWanderHz", "whistleGrowlWanderDepth",
  "whistleDroneWaveCyclesPerRingPulse", "whistleDroneWaveDepth",
  "whistleThroatAmount", "whistleThroatSubharmonicAmount",
  "whistleBoxHz", "whistleBoxQ", "whistleBoxAmountDb",
  "moveFilterHz", "moveFilterPulsesPerCycle", "moveFilterDepthHz", "bassBoostHz", "bassBoostDb",
];
const VIEW_PANEL_KEYS = Object.keys(DEFAULT_VIEW_PARAMS);

wireTimbrePanel({
  category: "note",
  idPrefix: "np",
  keys: NOTE_PANEL_KEYS,
  setParam: (key, value) => audio.setNoteParam(key, value),
  defaults: DEFAULT_NOTE_PARAMS,
  presetSelectId: "note-preset-select",
  saveBtnId: "note-preset-save",
  deleteBtnId: "note-preset-delete",
  resetBtnId: "note-preset-reset",
});

wireTimbrePanel({
  category: "drone",
  idPrefix: "dp",
  keys: DRONE_PANEL_KEYS,
  setParam: (key, value) => audio.setDroneParam(key, value),
  defaults: DEFAULT_DRONE_PARAMS,
  presetSelectId: "drone-preset-select",
  saveBtnId: "drone-preset-save",
  deleteBtnId: "drone-preset-delete",
  resetBtnId: "drone-preset-reset",
});

// "Granular parametric control over the visuals now, especially the echo
// settings." Same wireTimbrePanel reuse as note/drone timbre above -- a
// visuals panel gets named presets, factory reset, and last-session
// persistence for free, with zero new plumbing beyond this call.
wireTimbrePanel({
  category: "view",
  idPrefix: "vp",
  keys: VIEW_PANEL_KEYS,
  setParam: (key, value) => view.setViewParam(key, value),
  defaults: DEFAULT_VIEW_PARAMS,
  presetSelectId: "view-preset-select",
  saveBtnId: "view-preset-save",
  deleteBtnId: "view-preset-delete",
  resetBtnId: "view-preset-reset",
});

// "Full authorship over defaults/presets... a portable way to
// save/share/restore a full tuning state." One combined export covering
// all three tunable categories at once -- exactly the numeric keys
// wireTimbrePanel already manages for each (NOTE_PANEL_KEYS/
// DRONE_PANEL_KEYS/VIEW_PANEL_KEYS above), so export can never drift from
// what's actually tunable. Import reuses setSliderValue (main.js's own
// established "set a slider programmatically" idiom -- dispatches a real
// `input` event) so applying a file is indistinguishable from a user
// manually dragging every slider: live-updates AND persists to
// last-session exactly like a hand-tune would.
function currentCategoryValues(idPrefix, keys) {
  const out = {};
  for (const key of keys) {
    const el = $(`${idPrefix}-${key}`);
    if (el) out[key] = Number(el.value);
  }
  return out;
}

$("export-settings").addEventListener("click", () => {
  const payload = {
    note: currentCategoryValues("np", NOTE_PANEL_KEYS),
    drone: currentCategoryValues("dp", DRONE_PANEL_KEYS),
    view: currentCategoryValues("vp", VIEW_PANEL_KEYS),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "orphograph-settings.json";
  a.click();
  URL.revokeObjectURL(url);
});

$("import-settings-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const apply = (idPrefix, keys, values) => {
      if (!values) return;
      for (const key of keys) {
        if (!(key in values)) continue;
        setSliderValue(`${idPrefix}-${key}`, values[key]);
      }
    };
    apply("np", NOTE_PANEL_KEYS, data.note);
    apply("dp", DRONE_PANEL_KEYS, data.drone);
    apply("vp", VIEW_PANEL_KEYS, data.view);
  } catch (err) {
    alert("Couldn't read that settings file: " + err.message);
  }
  e.target.value = ""; // allow re-importing the exact same file later
});

// Per-ring drone/flute mute (dp-mute-*) and the three per-ring drone gain
// sliders are retired along with it -- "one driving bass drone, one
// meandering flute narrative" means there's only one instance of each to
// mute/level now, already covered by the drone on/off button and
// flute-solo. "Which ring" no longer maps to a separately audible thing.
["given", "received", "made"].forEach((ring) => {
  const select = $(`mode-${ring}`);
  sequencer.setRingMode(ring, select.value);
  select.addEventListener("change", (e) => sequencer.setRingMode(ring, e.target.value));
});

// Triatonic flute -- each ring's own rotation drives which harmonic that
// ring's OWN flute voice sounds (see synth.js's pulseDrone), rather than
// requiring a hand on the shared "which harmonic" slider. That manual
// slider is disabled while following, since every ring overwrites its own
// voice every pulse anyway -- leaving it enabled would just be misleading,
// not functional.
function applyWhistleFollow(following) {
  audio.setWhistleFollowsWheel(following);
  $("dp-whistleHarmonic").disabled = following;
  $("dp-whistleHarmonic-n").disabled = following;
}
applyWhistleFollow($("whistle-follow").checked);
$("whistle-follow").addEventListener("change", (e) => applyWhistleFollow(e.target.checked));

// Which harmonic series this ring's fixed chamber speaks -- "open" (every
// harmonic, a real transverse flute) or "stopped" (odd harmonics only, the
// hollower capped-pipe/drone character). A string enum, so it sits outside
// wireTimbrePanel's numeric slider loop, same as whistleVoicing/whistleScale.
$("whistle-chamber-pipe").addEventListener("change", (e) => audio.setDroneParam("whistleChamberPipe", e.target.value));

// "Isolate just the flutes for testing" -- a single master switch, read
// live at toggle time (not gated on ensureContext having run yet -- the
// engine itself no-ops safely if the audio graph doesn't exist).
$("flute-solo").addEventListener("change", (e) => audio.setFluteSolo(e.target.checked));

// "Distinguish tiers by emphasis, not by absence" -- see tierEmphasis's own
// declaration above for what the two endpoints mean. Same simple
// range+readout pattern as the procession-rate slider, not wireTimbrePanel
// (this isn't an audio.droneParams/noteParams entry -- it's read directly
// by onNoteHit/onChordHit).
function applyTierEmphasis(value) {
  tierEmphasis = value;
  $("tier-emphasis-readout").textContent = value.toFixed(2);
}
applyTierEmphasis(parseFloat($("tier-emphasis").value));
$("tier-emphasis").addEventListener("input", (e) => applyTierEmphasis(parseFloat(e.target.value)));

// Resultant-rhythm percussion's own level -- same pattern as tier-emphasis
// above, wired straight to synth.js's own live setter (this one already
// has to survive ensureContext not having run yet, hence setPercussionLevel
// itself, unlike tierEmphasis which is a bare local read by main.js).
function applyPercussionLevel(value) {
  audio.setPercussionLevel(value);
  $("percussion-level-readout").textContent = value.toFixed(2);
}
applyPercussionLevel(parseFloat($("percussion-level").value));
$("percussion-level").addEventListener("input", (e) => applyPercussionLevel(parseFloat(e.target.value)));

// A single rAF loop drives the canvas -- tickRate() (above, in the
// procession-rate section) already calls render() every frame via its own
// requestAnimationFrame chain; a second loop() here was calling render() a
// second time per frame, every frame, since the very first version of this
// file. Harmless while the canvas was cheap; wasteful now that every
// ring's trail carries a full phrase (see MAX_TRACE_POINTS/setTraceCapacity
// above) and outright misleading for any future per-frame visual math.
// tickRate() self-schedules from module load, so nothing is lost by
// removing this second driver.

