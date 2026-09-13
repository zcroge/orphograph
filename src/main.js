import { deriveTrace, invalidRanges, annotateInputForDisplay, wordHandedness, splitIntoWords, chordPulseLength } from "./trace.js";
import { buildProcession, describeSteps, ROTATION_SPOKE_SHIFT } from "./transform.js";
import { hzForSpoke, PLACEHOLDER_SPOKE_OF, ringForLetter, QWERTY_GLYPH_MAP, REST } from "./letters.js";
import { OrphographAudio, DEFAULT_NOTE_PARAMS, DEFAULT_DRONE_PARAMS, DEFAULT_PERCUSSION_PARAMS, DEFAULT_MIX_PARAMS, DEFAULT_GUITAR_PARAMS } from "./synth.js";
import { Sequencer } from "./sequencer.js";
import { MidiBridge } from "./midi.js";
import { WheelView, DEFAULT_VIEW_PARAMS } from "./view.js";
import { RING_OCTAVE_MULTIPLIER, ringSpeedMultiplier, SPOKE_COUNT, PULSES_PER_BEAT, masterPulsesPerSecondToBpm, rotateSpoke, GRAND_CONVERGENCE_PULSES, transpositionCycleSteps } from "./wheel.js";
import { loadAllPhrases, addPhrase, deletePhrase, isDefaultPhrase } from "./phrases.js";
import { loadPresets, savePreset, deletePreset, loadLastSession, saveLastSession } from "./timbrePresets.js";
import { PictographKeyboard } from "./keyboard.js";
import { CompactLegend } from "./compactLegend.js";
import { pixelGlyphSVGMarkup } from "./glyphRender.js";
import { patternsForRing, patternsForMotif, velocityForStep, GHOST_VELOCITY } from "./rhythm.js";
import { deriveArc, arcIntensityAt, stageForIntensity, subdivisionForStage, tierEmphasisForStage, describeArc, ARC_STAGES, ARC_STAGE_COUNT, subsetsForTraversal, vocabularyOf, depthAt, describeTraversal, describeForm } from "./arc.js";
import { deriveMotifs, applyMotifOp } from "./motif.js";

const $ = (id) => document.getElementById(id);

// "The most limited UI available... including play, stop, and just the
// basic text input/custom key selection grid in a compact format. I'd
// like to keep the levers to a minimum when I let other people test it."
// Every parameter row/panel/readout in index.html carries an
// `advanced-only` class (see style.css's `body:not(.advanced-mode)
// .advanced-only { display: none }`); this is the toggle for that class,
// plus a real tooltip suppression to match ("tooltips... invisible by
// default") -- most `title=` attributes live on elements already hidden
// by the class alone, but a few (the compact key grid, the input's own
// red-highlight explainer) sit on controls that stay visible, so this
// strips EVERY title site-wide in minimal mode rather than hunting down
// exceptions one at a time. A hidden hotkey (Ctrl+Alt+A, deliberately
// undocumented in the UI itself) reveals everything -- persisted in this
// browser only (localStorage), so a fresh visitor -- a different browser,
// a different machine, the person you actually hand this link to --
// always starts minimal regardless of what state you last left it in.
const ADVANCED_MODE_KEY = "orphograph.advancedMode.v1";
function setAdvancedMode(on) {
  document.body.classList.toggle("advanced-mode", on);
  if (on) {
    document.querySelectorAll("[data-title-hidden]").forEach((el) => {
      el.setAttribute("title", el.getAttribute("data-title-hidden"));
      el.removeAttribute("data-title-hidden");
    });
  } else {
    document.querySelectorAll("[title]").forEach((el) => {
      el.setAttribute("data-title-hidden", el.getAttribute("title"));
      el.removeAttribute("title");
    });
  }
  try {
    localStorage.setItem(ADVANCED_MODE_KEY, on ? "1" : "0");
  } catch {
    // Private browsing / storage disabled -- the toggle still works for
    // this page load, it just won't be remembered next visit.
  }
}
let storedAdvancedMode = false;
try {
  storedAdvancedMode = localStorage.getItem(ADVANCED_MODE_KEY) === "1";
} catch {
  // Same as above -- default to minimal if storage can't be read at all.
}
// NOT applied here yet -- CompactLegend/PictographKeyboard and the
// default response-step row (all below) set their own `title` attributes
// while populating, which hasn't happened yet at this point in the
// script. Applying now would miss those entirely (querySelectorAll
// finds nothing inside an empty grid). Applied once, at the very end of
// this file's synchronous setup, after every constructor/render call
// that could still add a title has already run.
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.altKey && e.key.toLowerCase() === "a") {
    setAdvancedMode(!document.body.classList.contains("advanced-mode"));
  }
});

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
// "Let's use the pixel font in place of the orphograph text entry" -- each
// RECOGNIZED token renders as its real pixel-font glyph (glyph-studio's
// own 16x16 bitmap, see glyphRender.js's pixelGlyphSVGMarkup) instead of
// its plain ASCII name; hyphens/spaces and genuinely unrecognized text
// stay exactly as before (plain characters, red for unrecognized). Each
// glyph is wrapped in a span sized to EXACTLY `token.length` monospace
// character-widths (`ch` units, the same unit the real input's own font-
// family: monospace already uses) -- required so the backdrop's total
// width for any given text prefix stays byte-identical to the real
// (invisible) input's own width at that same length; without this the
// visible caret (the only non-transparent part of the real input, see
// style.css) would drift out of alignment with what's drawn behind it
// the moment a multi-character token got replaced by a differently-sized
// image. Falls back to plain text for any token with no pixel data yet.
function updateInputBackdrop() {
  const input = $("input");
  const text = input.value;
  const segments = annotateInputForDisplay(text);
  let html = "";
  segments.forEach(({ start, end, kind, token }) => {
    const raw = text.slice(start, end);
    if (kind === "invalid") {
      html += `<span class="invalid-char">${escapeHtml(raw)}</span>`;
      return;
    }
    if (kind === "valid") {
      const svg = pixelGlyphSVGMarkup(token, { heightPx: 18 });
      if (svg) {
        html += `<span class="pixel-glyph-slot" style="width:${raw.length}ch">${svg}</span>`;
        return;
      }
    }
    html += escapeHtml(raw);
  });
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
// "Make the orphograph display itself larger, it's the focal point of our
// whole build." The constructor already sizes the wheel once from the
// canvas's real current CSS size (see view.js's resize()); this keeps it
// in sync afterward -- window resize, browser zoom, or (built so it
// reuses cleanly) a future fullscreen mode, since fullscreen is just
// another container size for this same observer to react to. contentRect
// is already border-box-exclusive CSS pixels, exactly what resize() wants.
new ResizeObserver((entries) => {
  const { width, height } = entries[0].contentRect;
  if (width > 0 && height > 0) view.resize(width, height);
}).observe(canvas);
const audio = new OrphographAudio();
// "Remove the automatic-hyphenation in the text input" -- letters just
// concatenate now, the same hyphen-less shape plain hand-typed prose
// already produces via tokenizeWord's own greedy longest-match
// tokenizer (trace.js), consistent with the direct-glyph-typing layer's
// own stated goal of reading "as close to automatic dictation as
// possible." A manually-typed literal "-" still works as an explicit
// disambiguation escape hatch (see the keydown handler below) -- this
// function just no longer inserts one itself.
function insertLetter(letter) {
  const input = $("input");
  input.value += letter;
  input.focus();
  updateInputBackdrop();
}

const keyboard = new PictographKeyboard($("keyboard"));
keyboard.onKeyClick = insertLetter;

const legendGrid = new CompactLegend($("legend-grid"));
legendGrid.onKeyClick = insertLetter;
function insertWordBoundary() {
  const input = $("input");
  if (input.value !== "" && !input.value.endsWith(" ")) input.value += " ";
  input.focus();
  updateInputBackdrop();
}
$("kbd-space").addEventListener("click", insertWordBoundary);

// The counterpart insertLetter never needed -- the on-screen keyboard has
// no delete key. Removes the LAST token, not one raw character -- "the
// string is the whole source of truth" model insertLetter already uses,
// just run in reverse. A trailing word-boundary space counts as its own
// removable "token" here (undoes insertWordBoundary), same granularity a
// direct-glyph-typing backspace should have. Now that insertLetter no
// longer auto-inserts a "-" between tokens, this can no longer find the
// last token via lastIndexOf("-")/(" ") -- that search would find
// nothing at all in ordinary hyphen-free text. Reworked to reuse
// annotateInputForDisplay's own real tokenization (trace.js) instead:
// its segments already partition the WHOLE string into real tokens
// (valid/invalid) and separators (plain, spaces/hyphens) in order, so
// the last segment IS the last token -- truncating to its own `start`
// removes exactly it, whether or not a hyphen ever separated it from
// what came before. A manually-typed trailing "-" (the hyphen still
// works as a manual disambiguation escape hatch, see the keydown
// handler below) is itself the last segment in that case, so one press
// removes just that hyphen, one whole "token" per press either way.
function removeLastToken() {
  const input = $("input");
  const value = input.value;
  if (value === "") return;
  if (value.endsWith(" ")) {
    input.value = value.slice(0, -1);
  } else {
    const segments = annotateInputForDisplay(value);
    const last = segments[segments.length - 1];
    input.value = last ? value.slice(0, last.start) : "";
  }
  input.focus();
  updateInputBackdrop();
}

// "A direct keyboard input system for our new glyph set, with an
// intuitive two-layer system... key layout should be as close to
// original qwerty equivalents as possible." See letters.js's
// QWERTY_GLYPH_MAP for the full mapping/reasoning. Scoped to a keydown
// listener on #input itself (not document-level) so it can never touch
// any other field or the existing Ctrl+Alt+A advanced-mode hotkey, and
// is gated behind its own toggle so the field's plain literal-text
// editing (hand-editing an exact token string, pasting a saved phrase)
// stays available exactly as before whenever the mode is off. Reuses
// insertLetter/insertWordBoundary/removeLastToken -- the SAME functions
// the on-screen keyboard's clicks already call -- so a key press and a
// tile click are indistinguishable to everything downstream.
let directGlyphTyping = true;
$("input").addEventListener("keydown", (e) => {
  if (!directGlyphTyping) return;
  if (e.ctrlKey || e.altKey || e.metaKey) return; // leave every modifier combo (incl. Ctrl+Alt+A) alone
  if (e.key === "Backspace") {
    e.preventDefault();
    removeLastToken();
    return;
  }
  if (e.key === " ") {
    e.preventDefault();
    insertWordBoundary();
    return;
  }
  const mapping = QWERTY_GLYPH_MAP[e.key.toLowerCase()];
  if (!mapping) return; // not a mapped letter key -- leave arrows/Tab/Enter/etc. to native behavior
  const token = e.shiftKey ? mapping.shift : mapping.base;
  if (!token) return; // this key has no shift-layer token -- fall through (browser default, harmless)
  e.preventDefault();
  insertLetter(token);
});
$("direct-glyph-typing").addEventListener("change", (e) => {
  directGlyphTyping = e.target.checked;
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
  if (letter === REST) continue; // engine device, not a census letter -- see letters.js/keyboard.js/compactLegend.js
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

// wordHandedness now lives in trace.js (imported above) -- shared with
// sequencer.js's own RingRunner instead of hand-duplicated.

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

// splitIntoWords now lives in trace.js (imported above).

let currentTrace = [];
let currentWords = [];
// Object identity -> the word (currentWords entry) it belongs to -- rebuilt
// alongside currentWords each Play. Lets onNoteHit (melody mode, one
// letter at a time) find "the word this hit belongs to" in O(1), so the
// native chord-voicing engine (synth.js's meanderFlute) can retune once
// per WORD boundary instead of once per letter -- see lastFluteWordByRing.
let wordOfEntry = new Map();
// The motif engine's own per-word derived objects (src/motif.js) -- built
// alongside currentWords/wordOfEntry, same lifetime, same reasoning.
// `motifOfEntry` mirrors wordOfEntry exactly (object identity -> the
// motif, not just the word, that entry belongs to). `currentMotifByRing`
// is the one genuinely new piece of live state this phase adds: which
// motif each ring is CURRENTLY inside, written exclusively by the
// Sequencer's own onWordChange callback below -- "one owner at a time,"
// the same discipline this file's other discrete dials already follow.
let currentMotifs = [];
let motifOfEntry = new Map();
const currentMotifByRing = { given: null, received: null, made: null };
// Form traversal (src/arc.js) -- yati (already computed for currentArc)
// selects one of six named traversal strategies over the phrase's own
// words; `currentVocabulary` is the phrase's own measured, deduplicated
// D12 relation set (arc.js's vocabularyOf), built once per Play alongside
// currentMotifs. `traversalCount` is the one genuinely new persistent
// counter this phase adds: a 0-indexed lap count, incremented on every
// real given-ring onTraceLoop (the SAME event that already advances the
// transposition series) and reset to 0 whenever checkSeriesClosed
// actually closes a series -- kept in lockstep with that clock rather
// than a second, independently-timed one, for the same reason
// arcIntensityAt's own period reuses the transposition series instead of
// inventing a new clock.
let currentVocabulary = [];
let traversalCount = 0;
// Per ring: the last word (object identity into currentWords) this ring's
// own flute retune already fired for -- melody mode's onNoteHit fires
// once per AUDIBLE letter, but the flute should only retune once per real
// word boundary per ring (chord mode's onChordHit already IS one call per
// word, no tracking needed there).
const lastFluteWordByRing = { given: null, received: null, made: null };
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

// "A continuous marquee... resulting in a full, unbroken ring when the
// full cyclic procession (standard 12 transpositions) is completed."
// The marquee's own single revolution has to span exactly one full
// transposition series, not a fixed wall-clock duration -- these two
// values are the "clock" main.js hands to view.js's render() for that
// (seriesStartPulse is the raw sequencer.masterPulseCount baseline the
// series began at; seriesTotalMasterPulses is how many master pulses
// the WHOLE series takes to close). Both reset together, see
// recomputeSeriesTotalPulses below.
let seriesStartPulse = 0;
let seriesTotalMasterPulses = GRAND_CONVERGENCE_PULSES; // sane pre-Play fallback, replaced the instant Play computes the real value

// A transposition SERIES closes after exactly transpositionCycleSteps
// real given-ring laps (wheel.js's own formula) -- and, critically,
// every one of those laps takes the exact SAME number of master pulses:
// the given ring always sweeps the SAME trace at the SAME fixed pulse
// rate (transposedSpoke only ever changes pitch, never the ring's own
// spoke-traversal timing), so "one given-ring lap" is a static property
// of the trace itself, fully computable the instant a phrase loads --
// no need to wait and measure it from real playback. Mirrors
// sequencer.js's own RingRunner timing rules exactly, reusing the SAME
// shared helper (trace.js's chordPulseLength, imported above -- no longer
// hand-duplicated, see trace.js's own comment): melody mode costs
// shortest-arc pulses between every consecutive pair of trace entries
// (rests included -- every entry, rest or real, is still a real
// spoke-arrival the ring must physically travel to, see RingRunner's own
// traceIndex advance), summed all the way around back to the start; chord
// mode costs chordPulseLength(word) per word instead
// (RingRunner._strikeWord), summed over every word.
function computeGivenLapRingPulses() {
  if (ringPerformanceMode.given !== "melody") {
    // Chord/arpeggio timing -- both map to sequencer.js's "chord" mode
    // (see applyRingPerformanceMode), same per-word arc timing either way.
    return currentWords.reduce((sum, w) => sum + chordPulseLength(w), 0) || SPOKE_COUNT;
  }
  if (currentTrace.length === 0) return SPOKE_COUNT; // degenerate guard, never actually reachable (Play requires real input)
  let total = 0;
  for (let i = 0; i < currentTrace.length; i++) {
    const a = currentTrace[i].spoke;
    const b = currentTrace[(i + 1) % currentTrace.length].spoke;
    const d = Math.abs(a - b) % SPOKE_COUNT;
    total += Math.min(d, SPOKE_COUNT - d);
  }
  return total || SPOKE_COUNT;
}
// Converts the given ring's own RING-pulse lap length into MASTER
// pulses (the two differ by exactly ringSpeedMultiplier("given"), the
// same conversion every other ring-relative timing figure in this file
// already uses), then multiplies by however many such laps the CURRENT
// step size needs to close a full series. Called at Play and every time
// a series actually closes or restarts (the step-size slider changing
// mid-series) -- see those call sites.
function recomputeSeriesTotalPulses() {
  const givenLapMasterPulses = computeGivenLapRingPulses() / ringSpeedMultiplier("given");
  seriesTotalMasterPulses = givenLapMasterPulses * transpositionCycleSteps(transpositionStepSpokes);
}
// The actual "has the series closed" check -- called once per animation
// frame (see render() below), not from a discrete per-step counter.
// Counting real advanceTransposition() calls and comparing against
// transpositionCycleSteps was the first approach tried here, but it (a)
// silently never closes at all when transposition is disabled (
// advanceTransposition is never even called then -- no series would ever
// push out, growing the readout unboundedly for as long as Play runs),
// and (b) is really just a more roundabout way of asking the exact same
// question this already answers directly: masterPulseCount and the given
// ring's own pulse accumulator are driven by the identical per-frame dt
// (Sequencer.tick), so they stay in the fixed ringSpeedMultiplier("given")
// ratio to arbitrary precision -- "N real transposition steps have
// elapsed" and "N * givenLapMasterPulses master pulses have elapsed" are
// the same real-world moment. Using elapsed pulses directly handles the
// transposition-disabled case for free (no special-casing: it just keeps
// completing nominal "editions" at the current step-size's own implied
// pace) instead of leaving it as a silent gap.
function checkSeriesClosed() {
  if (sequencer.masterPulseCount - seriesStartPulse < seriesTotalMasterPulses) return;
  view.resetCycleReadoutSeries();
  seriesStartPulse += seriesTotalMasterPulses; // advance by the exact interval just closed, not "now" -- keeps long sessions from drifting
  recomputeSeriesTotalPulses(); // the trace/step-size may have changed since this series began
  // The form's own traversal counter resets alongside the series it's
  // synced to -- see currentTraversalState's own comment. Without this,
  // traversalCount would keep climbing past the series' own real period
  // (transpositionCycleSteps laps), and depthAt's clamp to maxDepth would
  // just hold the form at its final, fully-developed state forever
  // instead of the form genuinely restarting with the new series.
  traversalCount = 0;
  // A real breakdown -- "djent breakdowns are a real STRUCTURAL moment,"
  // tied to an event this engine already tracks discretely, not another
  // continuous intensity increment. The series closing IS that moment;
  // only fires at the arc's own top stage (a breakdown is specifically a
  // maximal-intensity device). Cleared at the NEXT given-ring lap
  // completion (onTraceLoop's own "given" branch), so it always lasts
  // exactly one lap.
  if (lastArcStage === ARC_STAGES.length - 1) breakdownActive = true;
}

// The Euclidean pattern engine's own per-ring patterns (src/rhythm.js) --
// one { n, s, coarse, fine } per ring, rebuilt whenever the phrase (and
// therefore its own tier-letter census and rootSpoke) changes. Subdivision
// (`s`) is fixed at 1 here -- it becomes the arc layer's own live output
// once that exists; this is deliberately built and independently
// verifiable before that wiring lands (see the plan's own phased build
// order), so a constant stands in for it for now.
let currentPatterns = { given: null, received: null, made: null };
function recomputeRhythmPatterns(subdivision = 1) {
  for (const ring of ["given", "received", "made"]) {
    currentPatterns[ring] = patternsForRing(currentTrace, ring, currentRootSpoke, subdivision);
  }
}

// "Informed by the content of the pattern, not just density." Derived by
// default, manual override always available -- the same convention
// `scale-follows-input`/`chamber-follows-input`/`arc-follows-input`
// already use. ON: every ring's own Euclidean pattern is rebuilt LIVE,
// every pulse, from whichever motif that ring is CURRENTLY inside
// (currentMotifByRing, src/motif.js's patternsForMotif) -- cheap, pure
// 12*s-length array math, no cache to invalidate on a word change. OFF:
// the OLD phrase-wide statistical patterns (currentPatterns, above,
// rebuilt only at Play/stage-change) stay byte-identical to before this
// phase, for A/B comparison by ear -- see the plan's own honest risk
// section on why this is a real gamble, not a safe default with no
// fallback.
let rhythmFollowsMotif = true;

// Subdivision decoupled from arrangement intensity: `subdivisionForStage`
// (arc.js) ties articulation FINENESS to the arc's own STAGE, which is
// why "heavy" and "busy" used to be the same axis. Following motif: a
// word's own cardinality (how many distinct spokes it actually touches)
// decides how finely it's articulated -- zero new constants, just
// ARC_STAGE_COUNT/PULSES_PER_BEAT this file already imports. Not
// following: the old stage-driven formula, unchanged, feeding the OFF
// path's own recomputeRhythmPatterns calls (see applyArcStage/Play).
function currentSubdivision() {
  if (rhythmFollowsMotif) {
    const motif = currentMotifByRing.given;
    const cardinality = motif ? motif.cardinality : 1;
    return Math.max(1, Math.min(ARC_STAGE_COUNT, Math.round(cardinality / PULSES_PER_BEAT)));
  }
  return subdivisionForStage(Math.max(0, lastArcStage));
}

// "Surfaced in the readout, or it reads as silent failure" -- a derived
// talea that happens to be a multiple of SPOKE_COUNT genuinely never
// phases against the fixed bar (disorientationDepth = SPOKE_COUNT, the
// old n+1 trick's own guaranteed-always-1 property traded away for real
// input-dependence, see rhythm.js's own patternsForMotif header). Updated
// only on a real given-ring word change (onWordChange above), not every
// frame -- the talea can only change when the word it's derived from
// does.
function updateIsorhythmReadout() {
  const el = $("isorhythm-readout");
  if (!el) return;
  const motif = currentMotifByRing.given;
  if (!motif) { el.textContent = ""; return; }
  const p = patternsForMotif(motif, "given", currentSubdivision());
  const phasing = p.disorientationDepth === 1 ? "maximal phasing" : p.disorientationDepth === SPOKE_COUNT ? "never phases (talea locked to the bar)" : `disorientation depth ${p.disorientationDepth}`;
  el.textContent = `talea ${p.talea} pulses · realigns every ${p.realignmentBars} bar${p.realignmentBars === 1 ? "" : "s"} · ${phasing}`;
}

// The form traversal's own live state -- a pure function of already-live
// values (currentArc.W/.yati, currentVocabulary, traversalCount), so
// "read live state, don't cache" applies here exactly as everywhere else
// in this file: nothing is stored beyond the raw traversalCount, and
// every reader (the guitar riff, the flute, the readout) calls this
// fresh. `chain` is what actually gets applied to a motif's own spokes at
// RENDER TIME (see applyMotifOp, src/motif.js) -- never by rebuilding the
// trace, which would restart the sequencer and lose every ring's phase.
function currentTraversalState() {
  const W = currentArc.W;
  const subsets = subsetsForTraversal(currentArc.yati, W);
  const S = Math.max(1, subsets.length);
  const subsetIndex = traversalCount % S;
  const maxDepth = currentVocabulary.length;
  const depth = depthAt(traversalCount, S, maxDepth);
  return {
    subsets, S, subsetIndex, depth,
    activeWordIndices: subsets[subsetIndex] || [],
    chain: currentVocabulary.slice(0, depth),
  };
}

// Applies the form's own current development chain to a motif's ordered
// spokes -- the ONE place every color-reading voice (guitar riff pitch,
// flute word-voicing) goes through, so "one motif, many readers" holds:
// neither voice invents its own transform, both read the SAME derived
// chain. Returns `spokes` unchanged (a NEW array, never mutated in
// place) when there is nothing to develop yet (depth 0, or no motif).
function developedSpokes(spokes) {
  const { chain } = currentTraversalState();
  return chain.reduce((t, step) => applyMotifOp(t, step), spokes.slice());
}

// Which ring's own Euclidean pattern the guitar chugs on -- "kick-and-chug
// locked together is genre-defining," so this defaults to `given` (the
// kick's own ring), matching the pattern engine's own kick/snare/hat role
// convention. A real, derived default with a manual override, the same
// convention every other "which ring" choice in this file already has.
let guitarFollowsRing = "given";

// Real polymeter's own persistent cursor (src/rhythm.js's polyFine/polyN)
// -- deliberately module-level state, NOT derived from the wheel's own
// per-lap spoke position, since the entire point is that this position
// does NOT reset when the wheel wraps back to spoke 1 (see onPulse's own
// comment). Only the given ring uses this today. Reset on Play (a fresh
// phrase starts its own polymetric drift fresh, same reasoning as every
// other Play-scoped reset here).
const polymetricCursor = { given: 0, received: 0, made: 0 };

// A real breakdown -- "half-time, breakdown" -- a discrete, one-lap-long
// override of the given ring's own pattern, not a continuous intensity
// state. Set true the moment a transposition series closes while the arc
// is at its top stage (see checkSeriesClosed); cleared the NEXT time the
// given ring completes a lap (onTraceLoop's own "given" branch, already
// firing once per lap) -- so a breakdown always lasts exactly one given-
// ring lap, a real, already-meaningful unit in this engine, never a
// hand-picked duration.
let breakdownActive = false;

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
  // The marquee's own series-closed check (checkSeriesClosed, called every
  // frame from render()) is what actually pushes the readout ring out and
  // starts a fresh one -- see its own comment for why this doesn't also
  // need to watch for that here.
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
  // A different step size changes what "the series" even means (a new
  // transpositionCycleSteps target, and a different total marquee-ring
  // revolution length) -- whatever ring the old series had built up no
  // longer means anything against it, so push what's there out as a
  // standing echo (same as a real series closing -- the work already
  // played is still worth keeping) and start a fresh series.
  view.resetCycleReadoutSeries();
  seriesStartPulse = sequencer.masterPulseCount;
  recomputeSeriesTotalPulses();
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
      // A breakdown lasts exactly one given-ring lap -- clear it here,
      // the given ring's own real "one lap just completed" event, before
      // anything else this branch does. If checkSeriesClosed sets it
      // again below (a fresh top-stage series just closed), the NEXT lap
      // becomes its own breakdown -- back to back breakdowns are a real
      // possibility, not a bug, for a long enough top-stage performance.
      breakdownActive = false;
      // The form's own traversal counter -- one given-ring lap IS one
      // traversal pass (see currentTraversalState's own comment for why
      // this stays synced with the transposition series instead of a
      // second, independently-timed clock). Advances unconditionally,
      // the same way the dial-stepping below does, regardless of whether
      // transposition itself is enabled.
      traversalCount += 1;
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
    // The Euclidean pattern engine (src/rhythm.js) -- a SECOND, independent
    // percussion clock, deliberately separate from the geometric
    // resultant-rhythm mechanism below (triggerPercussion, fired from
    // onNoteHit/onChordHit): this fires on the ring's own real pulse/spoke
    // position, not on where the typed phrase's letters happen to sit.
    // Only active in the two pattern-aware modes -- resultant/sparse/roll
    // stay byte-identical to before. `spoke` is this ring's own live
    // position (1..SPOKE_COUNT), handed straight in as the pattern's own
    // step index -- no separate counter, and step 0 of every pattern is
    // genuinely the ring standing on the wheel's own I pole.
    if (percussionPatternMode === "euclid" || percussionPatternMode === "woven") {
      const currentMotif = currentMotifByRing[ring];
      const pattern = rhythmFollowsMotif && currentMotif
        ? patternsForMotif(currentMotif, ring, currentSubdivision())
        : currentPatterns[ring];
      if (pattern) {
        const stage = Math.max(0, lastArcStage);
        const stageDef = ARC_STAGES[stage];
        const pulseSec = 1 / ringPulsesPerSecond(ring);
        const now = audio.ctx ? audio.ctx.currentTime : 0;

        // A real breakdown -- "fewer, heavier, more syncopated hits...
        // guitar plays every surviving onset in rhythmic unison with the
        // kick." A genuine structural EVENT (see checkSeriesClosed's own
        // trigger and onTraceLoop's own clear), not a continuous
        // intensity increment -- overrides the normal pattern entirely,
        // for one given-ring lap, on the given ring only (received/made
        // keep their own normal patterns; a breakdown is specifically a
        // kick+guitar moment). Reads the COARSE grid directly (ignoring
        // subdivision/polymeter) -- fewer onsets, not more, is the actual
        // character of a breakdown.
        if (breakdownActive && ring === "given") {
          if (pattern.coarse[(spoke - 1) % SPOKE_COUNT]) {
            audio.playPercussionHit(ring, { accent: true, atTime: now });
            const chugSec = pulseSec * audio.guitarParams.guitarChugTightness;
            audio.playGuitarChug(ring, hzForSpoke(transposedSpoke(currentRootSpoke)), {
              velocity: 1,
              atTime: now,
              chugSec,
              attackFraction: audio.guitarParams.guitarChugAttackFraction,
            });
          }
          return;
        }

        // Real polymeter, not maximal evenness, at the top stage --
        // src/rhythm.js's own polyFine/polyN (n+1, always coprime with n
        // by construction). Consumed via a PERSISTENT cursor, deliberately
        // independent of the wheel's own per-lap spoke position (`step`
        // below) -- the whole point is that this cell does NOT reset when
        // the wheel wraps back to spoke 1, so it genuinely phases against
        // the beat lap over lap, the real Meshuggah-style riff-cycling
        // device. Only the given ring gets this (the ring the guitar
        // follows by default), so the guitar's own riff is what actually
        // phases. Advances every sub-step regardless of whether polymeter
        // is currently engaged, so toggling it on/off never causes a
        // discontinuity in its own running phase.
        const usePolymeter = ring === "given" && stageDef.polymeter;
        for (let j = 0; j < pattern.s; j++) {
          const step = (spoke - 1) * pattern.s + j;
          let onset;
          if (ring === "given") {
            onset = usePolymeter
              ? pattern.polyFine[polymetricCursor.given % pattern.polyN]
              : pattern.fine[step % pattern.n];
            polymetricCursor.given += 1;
          } else {
            onset = pattern.fine[step % pattern.n];
          }
          if (!onset) continue;
          // Bypasses the density accumulator entirely (via `accent`/
          // `velocity`, both already-existing gate escape hatches) --
          // "one onset, one decider": a pattern-decided onset already went
          // through its own real decision process and is not an
          // independent resultant-rhythm event for the density arc to
          // ALSO thin.
          const tier = velocityForStep(step, pattern.s, pattern.coarse, stageDef.halfTime);
          const atTime = now + (j * pulseSec) / pattern.s;
          if (tier === "accent") audio.playPercussionHit(ring, { accent: true, atTime });
          else audio.playPercussionHit(ring, { velocity: tier === "ghost" ? GHOST_VELOCITY : 1, atTime });
          // The guitar -- "kick-and-chug locked together is genre-
          // defining" (Gojira/Meshuggah, already named three times in
          // this codebase's own comments as the tempo/riff-layering
          // precedent). Triggered by the SAME onset stream as the
          // percussion pattern above, on whichever ring guitarFollowsRing
          // names (default given, the kick's own ring) -- not by raw
          // geometric hits, which would just duplicate the kalimba's own
          // shape. `stageDef.guitar` gates both WHETHER it plays at all
          // ("off") and whether only accents sound ("pedal"/
          // "pedal+letring") or every onset does ("riff").
          if (ring === guitarFollowsRing) {
            const guitarBehavior = stageDef.guitar;
            const playsThisOnset = guitarBehavior === "riff" || (guitarBehavior !== "off" && tier === "accent");
            if (playsThisOnset) {
              // Accented onsets spell the CURRENT MOTIF across the bar (a
              // real riff -- a short cell repeated against a stable grid,
              // see src/motif.js's own header); every other onset (and
              // every onset at a pedal-only stage) sits on that same
              // motif's own root -- a pedal tone, the low-string-drone
              // character the genre is built on. Was a single flat
              // cursor (guitarLetterCursor) walking the ENTIRE phrase's
              // own letters, advancing only on accents and never
              // resetting per word -- not a riff, a slow serial readout
              // that never actually repeated. `accentIndex` is DERIVED
              // from the step itself (which accent slot this is within
              // the current bar), not a persistent counter -- the same
              // riff cell recurs every time the bar loops, the real
              // "repeated against a stable grid" character a riff needs.
              let spokeToPlay = currentMotif ? currentMotif.root : currentRootSpoke;
              if (guitarBehavior === "riff" && tier === "accent" && currentMotif && currentMotif.spokes.length) {
                // The form's own developing variation (src/arc.js's
                // traversal/vocabulary) reaches the riff here -- the SAME
                // motif, read through whatever D12 chain the current
                // traversal pass has accumulated (see
                // currentTraversalState/developedSpokes). At depth 0
                // (the phrase's own opening statement) this is a no-op --
                // chain.reduce over an empty array returns the motif's
                // own spokes unchanged, so a fresh phrase always states
                // its riff PLAINLY before anything develops it.
                const rendered = developedSpokes(currentMotif.spokes);
                const accentEvery = PULSES_PER_BEAT * pattern.s * (stageDef.halfTime ? 2 : 1);
                const accentIndex = Math.floor(step / accentEvery);
                spokeToPlay = rendered[accentIndex % rendered.length];
              }
              const chugSec = (pulseSec / pattern.s) * audio.guitarParams.guitarChugTightness;
              audio.playGuitarChug(ring, hzForSpoke(transposedSpoke(spokeToPlay)), {
                velocity: tier === "ghost" ? GHOST_VELOCITY : 1,
                atTime,
                chugSec,
                attackFraction: audio.guitarParams.guitarChugAttackFraction,
              });
            }
          }
          // A high-register chirp/glitch layer -- "the same kalimba
          // register... same modal and rhythmic/melodic principles." No
          // new synthesis: the made ring's own ghost-tier fill (the
          // fine-grid-only texture, the sparsest of the three tiers)
          // fires a short, quiet EXISTING kalimba hit, through the SAME
          // hzForSpoke(transposedSpoke(...)) pitch path every other real
          // note already uses -- automatically modally consistent. A
          // short negative bend gives it the quick pitch-dip "chirp"/
          // pinch-harmonic character real djent ornamentation has,
          // distinguishing it from an ordinary melodic kalimba hit. Only
          // once the arc has actually earned some intensity (driving/
          // djent) -- a monastic/processional performance stays exactly
          // as quiet as it already was -- and never during a breakdown,
          // which is deliberately stark, not ornamented.
          if (ring === "made" && tier === "ghost" && stageDef.chirp && !breakdownActive) {
            audio.playNote(hzForSpoke(transposedSpoke(spoke)) * RING_OCTAVE_MULTIPLIER.made, {
              duration: 0.05,
              velocity: 0.4,
              bend: -2,
              ring: "made",
              atTime,
            });
          }
        }
      }
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
      // the persistent trace, automatically, every frame). Pattern-mode
      // aware now -- see triggerPercussion (owned is already computed
      // above for the tier-emphasis velocity math).
      triggerPercussion(ring, owned);
    }
    if (!target.isRest && velocity > 0) {
      audio.playNote(hzForSpoke(transposedSpoke(target.spoke)) * RING_OCTAVE_MULTIPLIER[ring], { duration: 0.9, velocity, ring });
      applyVowelFromLetters([target.letter]);
      keyboard.flash(target.letter);
      legendGrid.flash(target.letter);
      // "A cyclical readout/record of the letters/notes played" -- exactly
      // this branch, deliberately not view.recordVisit above: a shared
      // trace's content is hit by all three tempo-offset rings, so
      // hooking a "some ring passed through here" event would triple-
      // stamp one conceptual note. This fires once per REAL audible
      // sound (velocity > 0), the same condition that gates playNote
      // itself just above.
      view.recordCycleReadoutLetter(target.letter, sequencer.masterPulseCount);
      // Native chord voicing -- retunes once per WORD boundary now, not
      // once per letter (see the "native chord-voicing engine" plan's own
      // flagged behavioral change): melody mode still plays individual
      // kalimba notes per letter above, but the shared flute voice sustains
      // one voiced chord per word, only changing at the first AUDIBLE
      // letter of the NEXT word this ring reaches. Skipped entirely at
      // velocity 0 (emphasis 1.0, passed letter) -- unchanged from before.
      const word = wordOfEntry.get(target);
      if (word && lastFluteWordByRing[ring] !== word) {
        lastFluteWordByRing[ring] = word;
        // The form's own developing variation reaches the flute here too
        // -- the SAME chain the guitar riff reads (currentTraversalState
        // is one shared, live-read source; neither voice invents its
        // own transform). `motifOfEntry` finally gets its first real
        // reader: built in Phase 2 alongside wordOfEntry, unused until
        // now.
        const wordMotif = motifOfEntry.get(target);
        const rawSpokes = wordMotif ? developedSpokes(wordMotif.spokes) : word.map((e) => e.spoke);
        const wordSpokes = rawSpokes.map(transposedSpoke);
        audio.meanderFlute(ring, wordSpokes, wordSpokes[0]);
      }
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
    if (ringPerformanceMode[ring] === "arpeggio") {
      // Arpeggiate -- the SAME content and timing budget as chord pluck
      // (velocityBySpoke, durationSec), just spread across it as a real
      // ordered sequence instead of a near-simultaneous strum. slotMs
      // subdivides the word's own already-derived arc-timing budget
      // evenly -- no new arbitrary rate. Each note's own duration runs a
      // little past its slot so notes ring into each other slightly, the
      // way a real plucked-tine arpeggio naturally overlaps, rather than
      // each one cutting the next off exactly at the slot boundary.
      const ordered = orderArpeggioEntries([...velocityBySpoke.entries()], word, arpeggioDirection[ring]);
      const slotSec = durationSec / ordered.length;
      ordered.forEach(([spoke, velocity], i) => {
        setTimeout(() => {
          audio.playNote(hzForSpoke(transposedSpoke(spoke)) * RING_OCTAVE_MULTIPLIER[ring], { duration: Math.min(1.2, slotSec * 1.6), velocity, ring });
        }, i * slotSec * 1000);
      });
    } else {
      // Chord pluck (and the safe default for any other value) -- a
      // small strum stagger between notes rather than a perfectly
      // simultaneous trigger, closer to how a real strum sounds.
      [...velocityBySpoke.entries()].forEach(([spoke, velocity], i) => {
        setTimeout(() => {
          audio.playNote(hzForSpoke(transposedSpoke(spoke)) * RING_OCTAVE_MULTIPLIER[ring], { duration: durationSec, velocity, ring });
        }, i * 20);
      });
    }
    if (soundingEntries.length) {
      applyVowelFromLetters(soundingEntries.map((e) => e.letter));
      soundingEntries.forEach((e) => {
        keyboard.flash(e.letter);
        legendGrid.flash(e.letter);
      });
      // Native chord voicing -- one retune per struck chord (not per
      // letter in it, the way ghost-taps also fire once per chord), on the
      // WORD's own full content (not just soundingEntries -- the chord's
      // content is the word's own geometry, independent of which of its
      // letters happen to be this ring's own tier), rooted on the word's
      // own first letter.
      const wordSpokes = word.map((e) => transposedSpoke(e.spoke));
      audio.meanderFlute(ring, wordSpokes, wordSpokes[0]);
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
    // below), unconditional on tier/velocity in resultant/roll mode, same
    // as onNoteHit -- see triggerPercussion. A chord "belongs" to this
    // ring (for sparse mode) if at least one of its letters is fully this
    // ring's own tier, same `entryVelocity(e) === 1` test recordVisit just
    // used above.
    triggerPercussion(ring, word.some((e) => entryVelocity(e) === 1));
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
    // Let-ring guitar punctuation -- structural events reusing an
    // existing voice, the same "accents reuse existing voices at a
    // boosted level, not new instruments" convention this engine already
    // follows for percussion accents. Only once the arc has actually
    // brought the guitar past a pedal-only stage (driving/djent, per
    // ARC_STAGES' own guitar column) -- a monastic/processional
    // performance stays exactly as quiet as it already was.
    if (ARC_STAGES[Math.max(0, lastArcStage)].guitar === "pedal+letring" || ARC_STAGES[Math.max(0, lastArcStage)].guitar === "riff") {
      audio.playGuitarChug("received", hzForSpoke(transposedSpoke(1)), { velocity: 1, letRing: true, chugSec: 1 });
    }
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
    if (ARC_STAGES[Math.max(0, lastArcStage)].guitar === "pedal+letring" || ARC_STAGES[Math.max(0, lastArcStage)].guitar === "riff") {
      audio.playGuitarChug(guitarFollowsRing, hzForSpoke(transposedSpoke(currentRootSpoke)), { velocity: 0.7, letRing: true, chugSec: 1 });
    }
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
    if (
      ring === guitarFollowsRing &&
      (ARC_STAGES[Math.max(0, lastArcStage)].guitar === "pedal+letring" || ARC_STAGES[Math.max(0, lastArcStage)].guitar === "riff")
    ) {
      audio.playGuitarChug(ring, hzForSpoke(transposedSpoke(spoke)), { velocity: 1, letRing: true, chugSec: 0.8 });
    }
    // "I'd like the radial timekeeping cursor itself to emit echoes,
    // especially on events like reversals" -- a real, comparatively rare
    // structural event (this ring's own sweep genuinely flipping
    // direction), so its own echo reads as bigger than a routine spoke
    // pass.
    view.pulsePhaseBarReversal(ring);
  },
  // The motif engine's own missing signal (src/motif.js/src/sequencer.js):
  // "which word is THIS ring currently inside." Only real per-ring state
  // update here -- currentMotifByRing is read live elsewhere (the arc's
  // own intensity, rhythm.js's future patternsForMotif), never cached
  // beyond this one write, same "read live state, don't cache" discipline
  // as everything else in this file. `wordIndex` indexes `currentMotifs`
  // directly: splitIntoWords is a pure function of the shared trace, so
  // this ring's own word list and main.js's currentWords always agree on
  // what "word index i" means, without the two coordinating directly.
  onWordChange: (ring, wordIndex) => {
    currentMotifByRing[ring] = currentMotifs[wordIndex] || null;
    // The isorhythm readout tracks the GIVEN ring specifically -- it's
    // the only ring that ever phases (see the invariant-layer rule,
    // rhythm.js's own patternsForMotif header), so it's the only one
    // whose talea/realignment figures mean anything to state.
    if (ring === "given") updateIsorhythmReadout();
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

// The input-driven intensity arc (src/arc.js) -- "ebbing and flowing with
// processions/across the full arc of procession," now genuinely input-
// derived rather than a fixed-period cosine. convergenceAmplitude() (the
// engine's ONLY prior intensity signal -- peaks at grand convergence,
// floor 0.35, cosine-shaped, completely independent of what was typed) is
// retired outright, per this project's own standing discipline against a
// superseded mechanism quietly surviving alongside its replacement: it was
// always a placeholder standing in for an arc that didn't exist yet.
//
// currentArc is rebuilt every Play (see the Play handler) from the WOVEN
// trace's own words -- see deriveArc's own comment for why the woven
// trace, not just the typed call.
let currentArc = deriveArc({ words: [] });
// Derived by default, manual override always available -- the same
// "scale-follows-input"/"chamber-follows-input" convention this engine
// already uses everywhere else. `arcShapeOverride` is independent of this
// toggle (see index.html's own arc-shape select) -- it replaces only the
// arc's SHAPE component, live, whether the arc is following input or not.
let arcFollowsInput = true;
let arcShapeOverride = null;
// The last real stage actually applied -- `applyArcStage` only fires on a
// genuine transition (see tickRate's own call site), the same "write only
// on change" discipline main.js's other discrete dials already follow, so
// selecting a vibe preset (or dragging the manual slider) is never
// immediately re-clobbered by a redundant re-application of the SAME stage.
let lastArcStage = -1;

// The arc's own live intensity, read fresh every frame (main.js's own
// established "read live state, don't cache" convention). Following
// input, real case: reads the GIVEN ring's own CURRENT motif directly
// (currentMotifByRing, written by the Sequencer's onWordChange) -- the
// given ring owns the global stage because it's the slowest, the ground,
// and already the ring the guitar follows by default (guitarFollowsRing).
// This replaces indexing into the phrase's word list by the transposition
// -series clock's own progress fraction (floor(p*W)) -- an indirect proxy
// for "which word is sounding" -- with the real, event-driven answer: the
// stage now changes at the exact moment the given ring actually enters a
// new word, not at an approximated fraction of an unrelated clock. Before
// the given ring's lead-in finishes and it enters its first word,
// currentMotifByRing.given is still null -- reads as 0 (monastic), a
// reasonable "nothing derived yet" default, same spirit as every other
// freshly-reset-at-Play state.
//
// Following input, override case: `arcShapeOverride` replaces the WEIGHT
// signal with a synthetic, deterministic 0..1 curve (see arc.js's own
// synthesizeYatiShape) for when the owner wants a chosen dynamic shape
// instead of the phrase's own phonetics -- that still needs the
// transposition-series clock's own progress to index into, since a
// synthetic curve has no "current ring position" to read.
//
// Not following: the manual slider drives it directly, same relationship
// the manual scale field has to `scale-follows-input`.
function currentArcIntensity() {
  if (arcFollowsInput) {
    if (arcShapeOverride) {
      const p = seriesTotalMasterPulses > 0 ? (sequencer.masterPulseCount - seriesStartPulse) / seriesTotalMasterPulses : 0;
      return arcIntensityAt(currentArc, p, arcShapeOverride);
    }
    return currentMotifByRing.given ? currentMotifByRing.given.weight : 0;
  }
  return parseFloat($("arc-intensity").value);
}

// Writes the arc's own discrete levers for one stage -- ONLY ever called
// on a genuine stage transition (see call sites: tickRate's own per-frame
// check, gated to arcFollowsInput; the manual intensity slider/stage
// picker's own listeners, an explicit user action either way). Reuses the
// exact fireChange/setSliderValue idiom every other programmatic lever
// write in this file already uses, so the UI visibly moves as the arc
// progresses -- "one owner at a time, visibly." Owns lastArcStage itself
// (rather than trusting every call site to also remember to update it) --
// a real bug was found and fixed here: the guitar's own stage-gating
// (onPulse/onGrandConvergence/onBreathCycle/onDirectionReversal, all read
// lastArcStage directly) went permanently silent under a MANUAL stage
// pick, because manual mode never runs through tickRate's own per-frame
// tracker at all, so lastArcStage stayed frozen at Play's own reset value
// (-1) forever. Setting it HERE means every real application of a stage,
// automatic or manual, keeps every reader in sync by construction.
function applyArcStage(stage) {
  lastArcStage = stage;
  const def = ARC_STAGES[stage];
  fireChange("percussion-pattern-mode", def.percussionPatternMode);
  for (const ring of ["given", "received", "made"]) fireChange(`mode-${ring}`, def.ringModes[ring]);
  setSliderValue("tier-emphasis", tierEmphasisForStage(stage));
  recomputeRhythmPatterns(subdivisionForStage(stage));
}

function updateArcReadout(I) {
  const el = $("arc-readout");
  if (el) el.textContent = `${describeArc(currentArc, I)} · ${describeTraversal(currentTraversalState())} · form ${describeForm(currentMotifs)}`;
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
  checkSeriesClosed();
  view.render({
    ringLabelsAtSpoke, transposition, hullCursorByRing, ringHitFlash,
    masterRotationOffset: dialOffset(rimDial), ringDialOffsets, droneBreathHz,
    // "A continuous marquee... resulting in a full, unbroken ring when
    // the full cyclic procession... is completed." Same "main.js computes
    // the live clock value(s), view.js only renders them" split every
    // other continuous motion here already uses (transposition's own
    // glide progress, the phase-bar cursors above) -- see
    // recomputeSeriesTotalPulses's own comment for what these two mean.
    masterPulseCount: sequencer.masterPulseCountFractional,
    seriesStartPulse,
    seriesTotalMasterPulses,
  });
}
render();

// The real first application of minimal mode -- see setAdvancedMode's own
// comment, above, for why this has to wait until every synchronous setup
// call above (both grids, the default response-step row, wireTimbrePanel)
// has already run and set whatever `title` attributes it's going to set.
setAdvancedMode(storedAdvancedMode);

// Mixer meters -- five small bars (drone/note/flute/percussion/master)
// plus a clip indicator, read from audio.mixMeterLevels() (synth.js).
// Declared here, ahead of tickRate's own first (synchronous, module-load-
// time) call below, rather than down by the mixer panel's wireTimbrePanel
// call -- these are plain $() lookups with no dependency on that wiring,
// and tickRate's very first invocation needs them already initialized.
// Called from tickRate's own rAF chain (see that call site's comment);
// skipped entirely while the panel is closed or before the audio graph
// exists, so this never does real work when nobody can see it.
const mixMeterPanel = $("mix-meter-panel");
const mixMeterBars = {
  drone: $("mix-meter-drone"),
  note: $("mix-meter-note"),
  flute: $("mix-meter-flute"),
  percussion: $("mix-meter-percussion"),
  guitar: $("mix-meter-guitar"),
  master: $("mix-meter-master"),
};
const mixMeterClip = $("mix-meter-clip");
// RMS of a healthy mixed signal rarely clears ~0.3 -- scaled so the bars
// use their visual range meaningfully instead of sitting mostly empty.
const MIX_METER_RMS_TO_WIDTH = 2.6;
function drawMixMeters() {
  if (!audio.ctx || !mixMeterPanel.open) return;
  const levels = audio.mixMeterLevels();
  for (const key of Object.keys(mixMeterBars)) {
    const pct = Math.min(100, levels[key] * MIX_METER_RMS_TO_WIDTH * 100);
    mixMeterBars[key].style.width = `${pct}%`;
  }
  mixMeterClip.classList.toggle("clipping", levels.clipping);
}

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
  // The arc's own live intensity -- density floor becomes 1/SPOKE_COUNT
  // (E(1,12), the minimal Euclidean pattern -- one onset per lap) instead
  // of convergenceAmplitude's old bare 0.35, and the ceiling is genuinely
  // input-derived instead of a fixed cosine peak. See currentArcIntensity's
  // own comment.
  const arcIntensity = currentArcIntensity();
  audio.setPercussionDensity(1 / SPOKE_COUNT + (1 - 1 / SPOKE_COUNT) * arcIntensity);
  // Discrete lever writes (pattern mode, ring modes, tierEmphasis,
  // subdivision) only fire on a genuine stage transition, and only while
  // the arc is actually the one authoring them -- a vibe preset (or a
  // direct manual slider/stage-picker drag, which applies its own stage
  // immediately on interaction, see index.html's own listeners) owns
  // those levers completely once arc-follows-input is off, never
  // re-clobbered by a stale per-frame re-application.
  const arcStage = stageForIntensity(arcIntensity);
  if (arcFollowsInput && arcStage !== lastArcStage) applyArcStage(arcStage);
  updateArcReadout(arcIntensity);
  // Mixer meters -- riding this SAME rAF chain rather than a second loop
  // (see the removed duplicate-render-loop comment further down in this
  // file for exactly why that's a real regression class here). Cheap
  // no-op when the panel is closed or the audio graph doesn't exist yet.
  drawMixMeters();
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
      const derived = deriveScaleFromTrace(trace, rootSpoke);
      if (derived.length > 0) {
        audio.setDroneParam("whistleScale", derived);
        // The scale is now expressed relative to rootSpoke (F1 fix) --
        // the quantization root has to point at the exact same spoke, or
        // the tritone bug just returns in a new form. Named mode presets
        // (below, via the mode-preset select) stay relative to the
        // drone's O anchor by design -- setMelodicRoot is only ever
        // called from this derived-scale path.
        audio.setMelodicRoot(hzForSpoke(rootSpoke) * Math.pow(2, DRONE_OCTAVE_SHIFT));
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
    } else {
      // Falls back to the drone's O anchor (see _effectiveMelodicRootHz's
      // own comment) -- a manual scale/mode preset is root-on-O by design.
      audio.setMelodicRoot(0);
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
    wordOfEntry = new Map();
    for (const w of currentWords) for (const e of w) wordOfEntry.set(e, w);
    // The motif engine's own per-word objects -- built once here, same
    // "a fresh phrase means fresh derived state" reasoning as currentArc
    // just below. currentMotifByRing resets to null/null/null: no ring
    // has entered a word yet (lead-in hasn't even finished), the same
    // honest "nothing derived yet" state Play already leaves lastArcStage
    // and lastFluteWordByRing in.
    currentMotifs = deriveMotifs(currentWords);
    motifOfEntry = new Map();
    for (let wi = 0; wi < currentWords.length; wi++) for (const e of currentWords[wi]) motifOfEntry.set(e, currentMotifs[wi]);
    currentMotifByRing.given = currentMotifByRing.received = currentMotifByRing.made = null;
    updateIsorhythmReadout();
    // The form's own vocabulary and traversal count -- a fresh phrase
    // means a fresh set of word-to-word relations to develop with, and a
    // fresh form starts stating its own material plainly (traversal 0,
    // depth 0) rather than continuing wherever the last phrase's own form
    // happened to leave off.
    currentVocabulary = vocabularyOf(currentMotifs);
    traversalCount = 0;
    lastFluteWordByRing.given = lastFluteWordByRing.received = lastFluteWordByRing.made = null;
    hullCursor.given = hullCursor.received = hullCursor.made = null;
    // The marquee's own "one revolution" clock -- a fresh phrase means a
    // fresh trace, which can genuinely change the given ring's own real
    // lap length (see computeGivenLapRingPulses), so this has to be
    // recomputed every Play, not just once at module load.
    seriesStartPulse = sequencer.masterPulseCount;
    recomputeSeriesTotalPulses();
    // The intensity arc (src/arc.js) -- a fresh phrase means a fresh word
    // count/word-length sequence, its own ceiling and shape.
    currentArc = deriveArc({ words: currentWords });
    // Following input: force lastArcStage to -1 so tickRate's very next
    // frame detects a genuine change and runs a REAL applyArcStage(0) --
    // the previous phrase may have left the discrete levers (pattern
    // mode/ring modes/tierEmphasis) sitting on a totally different stage,
    // and those need a real, fresh stage-0 application, not just a
    // subdivision rebuild.
    //
    // NOT following input: applyArcStage never runs automatically at all
    // (manual mode's whole point is that those levers stay wholly
    // manual/vibe-owned, "one owner at a time") -- so lastArcStage must be
    // set to the REAL current manual stage directly, right here, or every
    // reader of it (the guitar's own stage-gating in onPulse/
    // onGrandConvergence/onBreathCycle/onDirectionReversal) would see a
    // stale -1 ("off") forever after this Play, regardless of whatever
    // stage was actually selected beforehand -- a real bug, found and
    // fixed at this exact point.
    lastArcStage = arcFollowsInput ? -1 : stageForIntensity(currentArcIntensity());
    // The Euclidean pattern engine's own per-ring patterns -- rootSpoke and
    // the trace's own tier-letter census both just changed with the new
    // phrase (see rhythm.js's patternsForRing), so these need rebuilding
    // every Play too, at whatever subdivision the CURRENT stage implies
    // (stage 0 if following input -- tickRate's own next frame both
    // confirms and re-applies this for real; the manual stage otherwise).
    recomputeRhythmPatterns(subdivisionForStage(Math.max(0, lastArcStage)));
    polymetricCursor.given = polymetricCursor.received = polymetricCursor.made = 0;
    breakdownActive = false;
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
// to land. One shared voice, one fixed representative test chord (spokes
// 4/7/11, see below), through "received" (RING_OCTAVE_MULTIPLIER's own
// neutral/center register, the same convention construction itself
// defaults to at rest).
$("whistle-audition").addEventListener("click", () => {
  audio.ensureContext();
  if (!droneOn) setDrone(true);
  // A fixed, representative test chord (spokes 4/7/11 -- not derived from
  // any real typed phrase) through "received" (RING_OCTAVE_MULTIPLIER's
  // own neutral/center register), so a slider change can be heard
  // immediately without typing a phrase or pressing play.
  audio.meanderFlute("received", [4, 7, 11], 4);
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
//
// Three real bugs fixed here (MUSIC-STRUCTURE-PLAN.md F1/F2/F3), found by
// reading, not running:
//   F1 -- reference frame. Used to express the scale relative to spoke 1
//     (I) while every consumer (quantizeFluteHz) applied it relative to
//     the drone's O anchor (spoke 7) -- a tritone off, always. Now
//     expressed relative to `rootSpoke` (the phrase's own declared root,
//     trace.js), and the caller below now also points the actual
//     quantization root (audio.setMelodicRoot) at that SAME spoke, so the
//     two can't drift apart again.
//   F2 -- used the letter's CANONICAL spoke (PLACEHOLDER_SPOKE_OF), not
//     the trace entry's own (possibly transformed) spoke -- a mirror/
//     rotate response stage only ever contributed via the six literal
//     twin-letter pairs. Reading entry.spoke directly means every real
//     transform stage's own geometry counts.
//   F3 -- REST sits at spoke 1 in PLACEHOLDER_SPOKE_OF, so every
//     multi-word phrase silently added pitch class 0. Skipped now via
//     entry.isRest.
function deriveScaleFromTrace(trace, rootSpoke) {
  const semitones = new Set();
  for (const entry of trace) {
    if (entry.isRest) continue;
    if (entry.spoke === undefined) continue;
    semitones.add(((entry.spoke - rootSpoke) % 12 + 12) % 12);
  }
  return Array.from(semitones).sort((a, b) => a - b);
}

// Shared foundation for chord/arpeggio content (MUSIC-STRUCTURE-PLAN.md
// P2) -- the unique real spokes a word actually touches, order of first
// occurrence preserved (not sorted -- a future voicing/arpeggio consumer
// may care which letter came first). This is deliberately the SAME kind
// of data onChordHit's own `velocityBySpoke` computes ad hoc, minus the
// per-tier velocity weighting that's specific to that call site -- a
// plain pitch-class-per-word view other consumers (the voicing engine,
// an arpeggiator) can share instead of re-deriving it themselves, the
// same "one place this gets decided" discipline deriveScaleFromTrace
// above already established for the whole-phrase scale.
function wordPitchClasses(word) {
  const seen = new Set();
  const spokes = [];
  for (const entry of word) {
    if (entry.isRest || entry.spoke === undefined) continue;
    if (seen.has(entry.spoke)) continue;
    seen.add(entry.spoke);
    spokes.push(entry.spoke);
  }
  return spokes;
}

// The arpeggiator promised above -- orders onChordHit's own already-
// computed `velocityBySpoke` entries (tier-gated, deduped, first-
// occurrence) into a real timed sequence instead of a near-simultaneous
// strum. `entries` is `[...velocityBySpoke.entries()]` (each `[spoke,
// velocity]`); sorting is by each pitch class's own ACTUAL played Hz,
// which for one fixed ring/tonic is just its raw transposed spoke number
// -- hzForSpoke (letters.js) is strictly increasing over spokes 1-12, so
// no arc-distance math is needed here (that's the flute voicing engine's
// own concern, not this one). "auto" reuses wordHandedness -- the SAME
// clockwise/counter-clockwise lean already driving sweep direction
// elsewhere -- so a word's own geometry picks ascending vs descending
// without a manual choice, unless overridden.
function orderArpeggioEntries(entries, word, direction) {
  const byPitch = (a, b) => transposedSpoke(a[0]) - transposedSpoke(b[0]);
  const ascending = () => [...entries].sort(byPitch);
  const descending = () => ascending().reverse();
  switch (direction === "auto" ? (wordHandedness(word) === 1 ? "ascending" : "descending") : direction) {
    case "ascending": return ascending();
    case "descending": return descending();
    case "upDown": {
      const up = ascending();
      const down = descending();
      return [...up, ...down.slice(1, -1)];
    }
    case "asTyped":
    default:
      return entries;
  }
}

// Named vocal-register presets (whistleHarmonicMin/Max) retired along with
// the harmonic-sweep pitch model they tuned -- see the native chord-voicing
// engine plan. setSliderValue survives; other callers still use it
// (below, and the settings-import feature further down).
function setSliderValue(id, value) {
  const el = $(id);
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

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
  "whistleManualRatio", "whistleVoicingArcSpokesPerOctave", "whistleFloorHz", "whistleCeilingHz",
  "whistleRingRegisterBias",
  "whistleGlideMs", "whistleNoteGateDipAmount",
  "whistleDetuneCents",
  "whistleAmount",
  "whistleVibratoRateHz", "whistleVibratoCents", "whistleVibratoAmpDepth",
  "whistleBreathAmount", "whistleBreathColorRatio", "whistleBreathSurgeAmount", "whistleChiffAmount",
  "whistleArticulationPulseFraction", "whistleBreathToneCoupling", "whistleArticulationAmount",
  "whistleBrightnessTempoSensitivity", "whistleBrightnessReferencePps", "whistleToneColorRatio",
  "whistleChamberAmountDb", "whistleChamberQ", "whistleChamberModes",
  "whistleDroneWaveCyclesPerRingPulse", "whistleDroneWaveDepth",
  "whistleBoxHz", "whistleBoxQ", "whistleBoxAmountDb",
  "whistlePedalLevel", "whistlePedalGlideMs", "whistleBreathLeadFraction",
  "moveFilterHz", "moveFilterPulsesPerCycle", "moveFilterDepthHz", "bassBoostHz", "bassBoostDb",
  "droneSubharmonicAmount", "droneSaturationAmount",
  "droneGrowlAmount", "droneGrowlF1Hz", "droneGrowlF2Hz", "droneGrowlQ",
  "droneGrowlWanderHz", "droneGrowlWanderDepth", "droneGrowlSaturationAmount",
  "droneThroatAmount", "droneThroatSubharmonicAmount",
];
const VIEW_PANEL_KEYS = Object.keys(DEFAULT_VIEW_PARAMS);
const PERCUSSION_PANEL_KEYS = Object.keys(DEFAULT_PERCUSSION_PARAMS);
const GUITAR_PANEL_KEYS = Object.keys(DEFAULT_GUITAR_PARAMS);
const MIX_PANEL_KEYS = Object.keys(DEFAULT_MIX_PARAMS);

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

// "More dynamic range of percussion... richer variety." Same
// wireTimbrePanel reuse as note/drone/view above -- the resultant-rhythm
// kick/snare/hat recipe (previously inline literals) gets a live panel,
// named-preset save/load, and factory reset for free.
wireTimbrePanel({
  category: "percussion",
  idPrefix: "pp",
  keys: PERCUSSION_PANEL_KEYS,
  setParam: (key, value) => audio.setPercussionParam(key, value),
  defaults: DEFAULT_PERCUSSION_PARAMS,
  presetSelectId: "percussion-preset-select",
  saveBtnId: "percussion-preset-save",
  deleteBtnId: "percussion-preset-delete",
  resetBtnId: "percussion-preset-reset",
});

// "A new rhythmic, palm-muted, overdriven, drop-tuned guitar/bass
// instrument." Same wireTimbrePanel reuse as every panel above -- named
// presets, factory reset, and last-session persistence for free.
wireTimbrePanel({
  category: "guitar",
  idPrefix: "gp",
  keys: GUITAR_PANEL_KEYS,
  setParam: (key, value) => audio.setGuitarParam(key, value),
  defaults: DEFAULT_GUITAR_PARAMS,
  presetSelectId: "guitar-preset-select",
  saveBtnId: "guitar-preset-save",
  deleteBtnId: "guitar-preset-delete",
  resetBtnId: "guitar-preset-reset",
});

// Real, named kits -- same "hardcoded named preset object" pattern
// PERCUSSION_KIT_PRESETS already uses. `chug` is DEFAULT_GUITAR_PARAMS
// itself; `doom` trades tightness/drive for a looser, lower, heavier
// character; `fuzz` pushes drive further with a wider detune spread.
const GUITAR_KIT_PRESETS = {
  chug: { ...DEFAULT_GUITAR_PARAMS },
  doom: {
    ...DEFAULT_GUITAR_PARAMS,
    guitarDriveAmount: 0.45, guitarScoopDb: -3, guitarCabLowpassHz: 3600,
    guitarSubAmount: 0.55, guitarChugTightness: 1.4, guitarDuckAmount: 0.2,
  },
  fuzz: {
    ...DEFAULT_GUITAR_PARAMS,
    guitarDriveAmount: 0.85, guitarDetuneCents: 14, guitarScoopDb: -8,
    guitarSubAmount: 0.2, guitarChugTightness: 0.8,
  },
};
$("guitar-kit-preset").addEventListener("change", (e) => {
  const kit = GUITAR_KIT_PRESETS[e.target.value];
  if (!kit) return; // "(custom)"
  for (const key of GUITAR_PANEL_KEYS) setSliderValue(`gp-${key}`, kit[key]);
});
$("guitar-follows-ring").addEventListener("change", (e) => { guitarFollowsRing = e.target.value; });

// The mixer -- "a few more elegantly designed levers" for overall sound
// balancing. Same wireTimbrePanel reuse as every panel above; replaces the
// old standalone percussion-level slider (mixPercussion now covers it,
// presettable alongside its siblings instead of living outside the preset
// system).
wireTimbrePanel({
  category: "mix",
  idPrefix: "mp",
  keys: MIX_PANEL_KEYS,
  setParam: (key, value) => audio.setMixParam(key, value),
  defaults: DEFAULT_MIX_PARAMS,
  presetSelectId: "mix-preset-select",
  saveBtnId: "mix-preset-save",
  deleteBtnId: "mix-preset-delete",
  resetBtnId: "mix-preset-reset",
});

// Real, named kits (character starting points, not the generic save/load
// preset system every panel above already gets via wireTimbrePanel) --
// same "hardcoded named preset object, shipped to every visitor" pattern
// as WHISTLE_MODE_PRESETS. `acoustic` is DEFAULT_PERCUSSION_PARAMS
// itself, spelled out here too so this ONE dropdown is a self-contained
// tour of every kit, factory default included. Applied via setSliderValue
// (main.js's own established "set a slider programmatically" idiom,
// already used by the settings-import feature above) -- the panel's own
// input listener does the actual apply/persist/preset-select-reset, so
// no separate apply logic is needed here.
const PERCUSSION_KIT_PRESETS = {
  acoustic: { ...DEFAULT_PERCUSSION_PARAMS },
  electronic: {
    kickFreqStart: 180, kickFreqEnd: 40, kickSweepMs: 25, kickGain: 1.6, kickDecayMs: 140,
    kickClickGain: 0.3, kickClickLowpassHz: 2200, kickClickDecayMs: 8,
    snareToneHz1: 200, snareToneHz2: 400, snareToneGain1: 0.4, snareToneGain2: 0.3, snareToneDecayMs: 60,
    snareNoiseBandHz: 2400, snareNoiseQ: 1.4, snareNoiseGain: 0.65, snareNoiseDecayMs: 70,
    hatHighpassHz: 8000, hatGain: 0.3, hatDecayMs: 18,
  },
  frameDrum: {
    kickFreqStart: 120, kickFreqEnd: 60, kickSweepMs: 70, kickGain: 1.1, kickDecayMs: 340,
    kickClickGain: 0.15, kickClickLowpassHz: 900, kickClickDecayMs: 20,
    snareToneHz1: 150, snareToneHz2: 260, snareToneGain1: 0.45, snareToneGain2: 0.25, snareToneDecayMs: 160,
    snareNoiseBandHz: 1200, snareNoiseQ: 0.5, snareNoiseGain: 0.3, snareNoiseDecayMs: 140,
    hatHighpassHz: 4500, hatGain: 0.2, hatDecayMs: 55,
  },
  industrial: {
    kickFreqStart: 200, kickFreqEnd: 45, kickSweepMs: 55, kickGain: 1.6, kickDecayMs: 300,
    kickClickGain: 0.9, kickClickLowpassHz: 2600, kickClickDecayMs: 25,
    snareToneHz1: 220, snareToneHz2: 470, snareToneGain1: 0.45, snareToneGain2: 0.45, snareToneDecayMs: 130,
    snareNoiseBandHz: 2600, snareNoiseQ: 0.4, snareNoiseGain: 0.8, snareNoiseDecayMs: 180,
    hatHighpassHz: 5000, hatGain: 0.45, hatDecayMs: 70,
  },
};
$("percussion-kit-preset").addEventListener("change", (e) => {
  const kit = PERCUSSION_KIT_PRESETS[e.target.value];
  if (!kit) return; // "(custom)" -- leave whatever's currently tuned alone
  for (const key of PERCUSSION_PANEL_KEYS) setSliderValue(`pp-${key}`, kit[key]);
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
    percussion: currentCategoryValues("pp", PERCUSSION_PANEL_KEYS),
    guitar: currentCategoryValues("gp", GUITAR_PANEL_KEYS),
    mix: currentCategoryValues("mp", MIX_PANEL_KEYS),
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
    apply("pp", PERCUSSION_PANEL_KEYS, data.percussion);
    apply("gp", GUITAR_PANEL_KEYS, data.guitar);
    apply("mp", MIX_PANEL_KEYS, data.mix);
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
// Kalimba performance modes -- "arpeggiate, chord pluck, or follow pure
// melody," per ring. `melody` and `chordPluck` are the SAME two
// sequencer.js timing modes this always had (spoke-matched per-letter vs.
// arc-timed per-word); `arpeggio` reuses chord timing too (the SAME
// word/arc-derived event, see onChordHit) but renders it as an ordered,
// spaced-out sequence instead of a near-simultaneous strum -- see
// orderArpeggioEntries above. Kept as one small mapping here rather than
// a third sequencer.js mode string, so sequencer.js's own dispatch never
// has to know this distinction exists.
const ringPerformanceMode = { given: "melody", received: "melody", made: "melody" };
const arpeggioDirection = { given: "auto", received: "auto", made: "auto" };
function applyRingPerformanceMode(ring, mode) {
  ringPerformanceMode[ring] = mode;
  sequencer.setRingMode(ring, mode === "melody" ? "melody" : "chord");
  // The direction lever only means anything in arpeggio mode -- disabled
  // otherwise, same "grey out what wouldn't do anything" pattern
  // applyWhistleFollow already uses for the manual pitch slider.
  $(`arpeggio-direction-${ring}`).disabled = mode !== "arpeggio";
}
function applyArpeggioDirection(ring, direction) {
  arpeggioDirection[ring] = direction;
}
["given", "received", "made"].forEach((ring) => {
  const modeSelect = $(`mode-${ring}`);
  applyRingPerformanceMode(ring, modeSelect.value);
  modeSelect.addEventListener("change", (e) => applyRingPerformanceMode(ring, e.target.value));

  const directionSelect = $(`arpeggio-direction-${ring}`);
  applyArpeggioDirection(ring, directionSelect.value);
  directionSelect.addEventListener("change", (e) => applyArpeggioDirection(ring, e.target.value));
});

// Percussion pattern modes -- "different modes of timekeeping,
// stylization or intensity." One GLOBAL lever, not per-ring (the three
// roles already read as one resultant-rhythm ensemble, same reasoning as
// the shared kit above): `resultant` (default, unchanged -- one event per
// real geometric hit, density-gated) / `sparse` (only this ring's own
// tier-owned hits sound) / `roll` (a surviving hit adds a quick flam of
// quieter echo-hits). `triggerPercussion` replaces the two previously-
// unconditional `audio.playPercussionHit(ring)` call sites below.
let percussionPatternMode = "resultant";
$("percussion-pattern-mode").addEventListener("change", (e) => { percussionPatternMode = e.target.value; });

function triggerPercussion(ring, owned) {
  // "euclid" -- the Euclidean pattern engine (onPulse, above) plays alone;
  // the geometric resultant-rhythm layer is fully muted here, a real
  // authored timeline rather than an emergent one. "woven" leaves this
  // path unmuted (falls through to the same resultant behavior as
  // default) -- the pattern plays underneath it as the timekeeping floor,
  // both layers audible together, matching the cited West/Central African
  // tradition's own real ensemble shape (a fixed bell timeline plus
  // responsive drums), which this engine has only ever had half of.
  if (percussionPatternMode === "euclid") return;
  if (percussionPatternMode === "sparse" && !owned) return;
  const sounded = audio.playPercussionHit(ring);
  if (sounded && percussionPatternMode === "roll") {
    // Grace-note echoes timed as a fraction of THIS ring's own current
    // pulse duration -- derived, not a fixed ms, so a fast ring's flam
    // tightens and a slow ring's relaxes, the same convention every other
    // timing value in this engine already follows. Both bypass the
    // density gate (gainMultiplier !== null) -- an echo embellishes an
    // already-decided real hit, it isn't a second independent
    // resultant-rhythm event for the density arc to separately thin.
    // Scheduled against the real AudioContext clock (`atTime`), not
    // `setTimeout` -- a real, if usually inaudible, main-thread-jitter bug
    // found while designing the Euclidean pattern engine (src/rhythm.js),
    // which schedules onsets far more densely and at tighter spacing than
    // this ever did; fixed here too rather than left as a latent hazard.
    const pulseSec = 1 / ringPulsesPerSecond(ring);
    const now = audio.ctx ? audio.ctx.currentTime : 0;
    audio.playPercussionHit(ring, { gainMultiplier: 0.45, atTime: now + pulseSec * 0.15 });
    audio.playPercussionHit(ring, { gainMultiplier: 0.22, atTime: now + pulseSec * 0.3 });
  }
}

// Native chord voicing -- each word's own real letters drive the shared
// flute voice's chord (see synth.js's meanderFlute/src/voicing.js), rather
// than a hand on a manual pitch slider. That manual slider is disabled
// while following, since every real hit overwrites the voice's pitch
// anyway -- leaving it enabled would just be misleading, not functional.
function applyWhistleFollow(following) {
  audio.setWhistleFollowsWheel(following);
  $("dp-whistleManualRatio").disabled = following;
  $("dp-whistleManualRatio-n").disabled = following;
}
applyWhistleFollow($("whistle-follow").checked);
$("whistle-follow").addEventListener("change", (e) => applyWhistleFollow(e.target.checked));

// The intensity arc's own manual-override controls (src/arc.js) -- same
// "follows input by default, the manual control disabled while following"
// relationship applyWhistleFollow just established for the flute's pitch.
function applyArcFollowsInput(following) {
  arcFollowsInput = following;
  $("arc-intensity").disabled = following;
  $("arc-stage-select").disabled = following;
}
applyArcFollowsInput($("arc-follows-input").checked);
$("arc-follows-input").addEventListener("change", (e) => {
  applyArcFollowsInput(e.target.checked);
  // An explicit toggle-off is a real request for manual control right
  // now -- apply whatever the manual slider currently reads immediately,
  // rather than leaving the arrangement sitting on whatever stage the
  // derived arc last left it at.
  if (!e.target.checked) applyArcStage(stageForIntensity(currentArcIntensity()));
});
$("arc-intensity").addEventListener("input", (e) => {
  if (arcFollowsInput) return; // disabled while following -- stay honest either way
  applyArcStage(stageForIntensity(parseFloat(e.target.value)));
});
// The rhythm reframe's own A/B toggle (src/rhythm.js's patternsForMotif) --
// no disabled-control coupling needed, unlike arc-follows-input above:
// the OLD phrase-wide patterns (currentPatterns) are always kept current
// regardless of this checkbox (recomputeRhythmPatterns already runs
// unconditionally at Play/stage-change), so flipping this is a pure,
// instantaneous A/B on which source onPulse reads, with nothing else to
// reconcile.
rhythmFollowsMotif = $("rhythm-follows-motif").checked;
$("rhythm-follows-motif").addEventListener("change", (e) => {
  rhythmFollowsMotif = e.target.checked;
});
$("arc-stage-select").addEventListener("change", (e) => {
  // A convenience shortcut, not a second source of truth -- sets the
  // manual intensity slider to a representative value INSIDE that
  // stage's own range (its midpoint), which fires the listener just
  // above and applies the stage from there, so the two manual controls
  // can never silently disagree with each other.
  const stage = parseInt(e.target.value, 10);
  setSliderValue("arc-intensity", ((stage + 0.5) / ARC_STAGE_COUNT).toFixed(2));
});
$("arc-shape-override").addEventListener("change", (e) => {
  arcShapeOverride = e.target.value || null;
});

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

// Resultant-rhythm percussion's own level used to live here as a standalone
// slider (applyPercussionLevel/setPercussionLevel) -- retired in favor of
// the mixer's mixPercussion (see the wireTimbrePanel({category: "mix", ...})
// call above), which gives it a presettable home next to the other channel
// faders instead of living outside the preset system.

// Vibe presets -- "the most intuitive, plug-and-play experience... the
// same underlying beat and tempo layering could make something like
// contemplation/meditation, intense technical groovy jam sessions,
// spiritual communal drum circling, or just tinkering around." One
// shared behavioral bundle across every structural lever this session
// built (kalimba mode/direction per ring, percussion kit/pattern, tier
// emphasis, ghost-taps, transposition, flute-follow, drone on/off) --
// deliberately NOT the drone/note timbre panels (dozens of individual
// synthesis params stay whatever they're currently tuned to; a vibe
// reshapes how the piece BEHAVES, not its raw tone). Same "hardcoded
// named object, shipped to every visitor" pattern as
// PERCUSSION_KIT_PRESETS/WHISTLE_MODE_PRESETS above -- distinct from the
// generic per-category save/load system, since a vibe is a fixed
// authored bundle, not something built up and saved by hand (though
// every lever it sets can still be hand-tuned afterward, same as
// applying any other preset).
const VIBE_PRESETS = {
  contemplation: {
    mode: { given: "melody", received: "melody", made: "melody" },
    direction: { given: "auto", received: "auto", made: "auto" },
    percussionKit: "frameDrum", percussionPattern: "sparse",
    tierEmphasis: 1, ghostTaps: true,
    transpositionEnabled: false, transpositionStep: 7,
    whistleFollow: true, droneOn: true,
  },
  jam: {
    mode: { given: "chordPluck", received: "arpeggio", made: "arpeggio" },
    direction: { given: "auto", received: "auto", made: "auto" },
    percussionKit: "industrial", percussionPattern: "roll",
    tierEmphasis: 0, ghostTaps: false,
    transpositionEnabled: true, transpositionStep: 7,
    whistleFollow: true, droneOn: true,
  },
  communal: {
    mode: { given: "chordPluck", received: "melody", made: "melody" },
    direction: { given: "auto", received: "auto", made: "auto" },
    percussionKit: "frameDrum", percussionPattern: "resultant",
    tierEmphasis: 0.5, ghostTaps: true,
    transpositionEnabled: true, transpositionStep: 7,
    whistleFollow: true, droneOn: true,
  },
  tinkering: {
    mode: { given: "melody", received: "melody", made: "melody" },
    direction: { given: "auto", received: "auto", made: "auto" },
    percussionKit: "acoustic", percussionPattern: "resultant",
    tierEmphasis: 1, ghostTaps: true,
    transpositionEnabled: true, transpositionStep: 7,
    whistleFollow: true, droneOn: true,
  },
};
// Sets a control's value/checked state and fires the SAME event type its
// own real listener already listens for, so that ONE existing listener
// does the actual apply/persist/UI-sync work -- no separate apply logic
// duplicated here. `value` a boolean -> `.checked` + "change" (every
// checkbox lever above listens on change); otherwise `.value` + "change"
// (every select lever above listens on change too). Sliders/number
// inputs that listen on "input" instead (tier-emphasis, transposition-
// step) reuse the existing setSliderValue for that reason.
function fireChange(id, value) {
  const el = $(id);
  if (typeof value === "boolean") el.checked = value; else el.value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
function applyVibePreset(name) {
  const vibe = VIBE_PRESETS[name];
  if (!vibe) return; // "(custom)" -- leave whatever's currently set alone
  // "One owner at a time, visibly" -- a vibe is a real, explicit request to
  // set every one of these same levers by hand; the arc (which owns them
  // while following input) stands down rather than re-deriving over top
  // of what was just chosen. Re-checking arc-follows-input hands control
  // back at any time.
  fireChange("arc-follows-input", false);
  for (const ring of ["given", "received", "made"]) {
    fireChange(`mode-${ring}`, vibe.mode[ring]);
    fireChange(`arpeggio-direction-${ring}`, vibe.direction[ring]);
  }
  fireChange("percussion-kit-preset", vibe.percussionKit);
  fireChange("percussion-pattern-mode", vibe.percussionPattern);
  setSliderValue("tier-emphasis", vibe.tierEmphasis);
  fireChange("ghost-taps", vibe.ghostTaps);
  fireChange("transposition-enabled", vibe.transpositionEnabled);
  setSliderValue("transposition-step", vibe.transpositionStep);
  fireChange("whistle-follow", vibe.whistleFollow);
  // The select's own "change" event is itself a real user gesture, same
  // as clicking the drone button directly -- safe to start audio here.
  audio.ensureContext();
  setDrone(vibe.droneOn);
}
$("vibe-preset").addEventListener("change", (e) => applyVibePreset(e.target.value));

// A single rAF loop drives the canvas -- tickRate() (above, in the
// procession-rate section) already calls render() every frame via its own
// requestAnimationFrame chain; a second loop() here was calling render() a
// second time per frame, every frame, since the very first version of this
// file. Harmless while the canvas was cheap; wasteful now that every
// ring's trail carries a full phrase (see MAX_TRACE_POINTS/setTraceCapacity
// above) and outright misleading for any future per-frame visual math.
// tickRate() self-schedules from module load, so nothing is lost by
// removing this second driver.
