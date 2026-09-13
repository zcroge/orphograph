// Typed input -> trace. A space between words is a word boundary and
// inserts one REST -- a placeholder-letter, matched by the procession
// sweep exactly like a real letter, but silent when hit. Punctuation, not
// decoration: it's how a phrase or a bridge between words gets marked.
//
// A word can be written two ways:
//   - Hyphenated, explicit tokens: "SH-O-R-E" -- always works, and is the
//     way to FORCE a reading the greedy tokenizer below wouldn't otherwise
//     pick (see the N-G example below).
//   - Plain, phonetic, no hyphens: "SHORE" -- tokenized by greedy longest-
//     match, the same strategy real digraph spellings already rely on
//     (English "sh," "th," "ng" work this way too: try the longer digraph
//     reading first, fall back to single letters only if it isn't one).
//     This is the point of it -- write out a word phonetically without
//     having to stop and hyphenate every letter.
//
// Examples:
//   "I-K-T-O"      -> I, K, T, O                  (one word, no rests)
//   "IKTO"         -> I, K, T, O                  (same, unhyphenated)
//   "I-K-T O"      -> I, K, T, REST, O             (two words, one rest)
//   "SHORE K-T"    -> SH, O, R, E, REST, K, T
//   "INGOT"        -> I, NG, O, T (greedy reads "NG" as one digraph/ŋ) --
//                     to force two separate sounds instead, hyphenate:
//                     "I-N-G-O-T"

import { spokeForLetter, canonicalToken, PLACEHOLDER_SPOKE_OF, SHORTHAND_OF, REST } from "./letters.js";
import { SPOKE_COUNT } from "./wheel.js";

const MAX_TOKEN_LEN = Math.max(
  ...Object.keys(PLACEHOLDER_SPOKE_OF).map((t) => t.length),
  ...Object.keys(SHORTHAND_OF).map((t) => t.length)
);

// Word-level structure -- split out of deriveTrace below, shared by
// sequencer.js (RingRunner's own chord/melody timing) and main.js (the
// tracer, the transposition-series clock, and the rhythm/arc systems).
// These five used to be hand-duplicated in both of those files (each with
// its own "kept in sync by hand" comment) since deriveTrace computed word
// structure internally and threw it away, returning only a flat trace --
// this is that structure's one real home now, and deriveTrace itself
// returns `words` alongside `trace` below so nothing has to re-derive it
// a third time.

// "duration = arc" -- one of the nine sonic parameters declared from the
// start, never actually implemented until now (chord/note durations were
// fixed constants everywhere). A word's arc is the sum of the SHORTER arc
// (same rule as "direction = shorter arc") between each consecutive pair
// of its letters' spokes -- a tightly-clustered word gets a small arc and
// a quick chord; a word whose letters range widely across the wheel gets
// a proportionally larger one. Derived from the word's own geometry, not
// a flat constant applied to every word regardless of content.
export const MIN_CHORD_PULSES = 4; // floor, so a 1-letter (zero-arc) word isn't instant

export function wordArc(word) {
  let total = 0;
  for (let i = 0; i < word.length - 1; i++) {
    const d = Math.abs(word[i].spoke - word[i + 1].spoke) % SPOKE_COUNT;
    total += Math.min(d, SPOKE_COUNT - d);
  }
  return total;
}

export function chordPulseLength(word) {
  return Math.max(MIN_CHORD_PULSES, wordArc(word));
}

// "Direction = shorter arc (tie -> word's handedness)" -- one of the nine
// sonic parameters declared from the very start, alongside "duration =
// arc," but never implemented until now: the ring always swept clockwise
// regardless of which way was actually closer to its next target. A
// word's own handedness (used only to break an exact tie, i.e. the target
// is precisely antipodal, 6 spokes either way) is derived from the word's
// own shape -- which way its overall span from first letter to last
// letter leans -- not assigned arbitrarily.
export function wordHandedness(word) {
  if (word.length < 2) return 1;
  const first = word[0].spoke;
  const last = word[word.length - 1].spoke;
  const cw = (last - first + SPOKE_COUNT) % SPOKE_COUNT;
  const ccw = SPOKE_COUNT - cw;
  return cw <= ccw ? 1 : -1;
}

export function splitIntoWords(trace) {
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

// Unrecognized input is flagged, not fatal -- "make sure our system can
// handle any input, and flag/discard any unrecognized input." One bad
// character used to throw and block the ENTIRE phrase from playing at
// all, which is a much harsher failure than the actual problem (a gap in
// the alphabet, or a typo) deserves. Now: an unrecognized character (or
// hyphenated token) is skipped -- it has no real spoke to be matched
// against, so it couldn't be inserted into the trace even if we wanted to
// -- and collected into `unknownTokens` so the caller can surface exactly
// what got dropped, rather than silently eating it.
export function tokenizeWord(word) {
  const tokens = [];
  let i = 0;
  while (i < word.length) {
    let matched = null;
    for (let len = Math.min(MAX_TOKEN_LEN, word.length - i); len >= 1; len--) {
      const candidate = word.slice(i, i + len);
      if (canonicalToken(candidate) !== undefined) {
        matched = candidate;
        break;
      }
    }
    if (matched === null) {
      tokens.push({ raw: word[i], unknown: true });
      i += 1; // skip just the one bad character, keep reading the rest of the word
    } else {
      tokens.push({ raw: matched, unknown: false });
      i += matched.length;
    }
  }
  return tokens;
}

export function deriveTrace(inputText) {
  const words = inputText
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);

  if (words.length === 0) {
    throw new Error("Empty input -- type at least one letter token.");
  }

  const rawTokens = []; // { raw, unknown }
  words.forEach((word, i) => {
    const wordTokens = word.includes("-")
      ? word.split("-").map((t) => t.trim()).filter((t) => t.length > 0)
          .map((t) => ({ raw: t, unknown: canonicalToken(t) === undefined }))
      : tokenizeWord(word);
    wordTokens.forEach((t) => rawTokens.push(t));
    if (i < words.length - 1) rawTokens.push({ raw: REST, unknown: false });
  });

  const unknownTokens = rawTokens.filter((t) => t.unknown).map((t) => t.raw);

  // Canonicalize each recognized token here, once -- so a typing shorthand
  // (e.g. "NG" for ŋ, see letters.js's SHORTHAND_OF) resolves to the same
  // canonical letter everything downstream keys on (ring lookups, hz,
  // keyboard highlighting, the vowel-formant check). Without this, typing
  // the shorthand would play correctly but fail to highlight/legend-match
  // its own keyboard tile, which is keyed by the formal token.
  const trace = rawTokens
    .filter((t) => !t.unknown)
    .map(({ raw }) => {
      if (raw === REST) return { letter: REST, spoke: spokeForLetter(REST), isRest: true };
      const letter = canonicalToken(raw);
      return { letter, spoke: spokeForLetter(letter), isRest: false };
    });

  if (trace.length === 0) {
    throw new Error(
      unknownTokens.length
        ? `Nothing recognized -- every character typed ("${unknownTokens.join(", ")}") is unknown. See src/letters.js for known tokens.`
        : "Empty input -- type at least one letter token."
    );
  }

  // "Root/key are determined by the first note/letter of the phrase" --
  // the first NON-REST trace entry's spoke is the phrase's declared root.
  // (Distinct from the drone, which always anchors on I -- see main.js.)
  const rootEntry = trace.find((t) => !t.isRest) ?? trace[0];

  // Word structure -- real, already-computed data (this function already
  // walked the rest boundaries once, above) that used to be discarded
  // here and separately re-derived by hand downstream (see splitIntoWords's
  // own comment). This is the CALL trace's own word list; a woven
  // (Response-operator) trace has its own, different word count and is
  // split again by the caller once weaving is known -- see main.js's Play
  // handler.
  return { tokens: trace.map((t) => t.letter), trace, words: splitIntoWords(trace), rootSpoke: rootEntry.spoke, unknownTokens };
}

// Live typing feedback -- which RAW CHARACTER RANGES in the input text
// would be skipped as unrecognized if played right now, keeping their
// exact position in the original string (unlike deriveTrace, which only
// needs a clean token list, not original offsets). Used by main.js to
// highlight invalid characters red as you type -- "this won't matter in
// the final product, but it'll help me learn the phonetic basis behind
// each letter." Reuses the exact same tokenizeWord/canonicalToken logic
// deriveTrace itself uses, so the live preview can never drift out of
// sync with what play would actually flag.
export function invalidRanges(inputText) {
  const ranges = []; // { start, end } character index ranges, end exclusive
  const wordRe = /\S+/g;
  let m;
  while ((m = wordRe.exec(inputText))) {
    const word = m[0];
    const wordStart = m.index;
    if (word.includes("-")) {
      let offset = 0;
      word.split("-").forEach((piece) => {
        const pieceStart = wordStart + offset;
        if (piece.length && canonicalToken(piece) === undefined) {
          ranges.push({ start: pieceStart, end: pieceStart + piece.length });
        }
        offset += piece.length + 1; // +1 to also skip the hyphen itself
      });
    } else {
      let offset = 0;
      tokenizeWord(word).forEach((t) => {
        if (t.unknown) ranges.push({ start: wordStart + offset, end: wordStart + offset + t.raw.length });
        offset += t.raw.length;
      });
    }
  }
  return ranges;
}

// Same walk as invalidRanges above (kept as its own function rather than
// refactored into a shared helper, so the red-highlight path this session
// already ships stays untouched), but annotates the WHOLE string --
// covers every character, not just the bad ones -- for main.js's pixel-
// font input display (updateInputBackdrop): each segment is either a
// recognized token (with its resolved canonical name, so the display can
// look up its pixel glyph), an unrecognized run (same "invalid" meaning
// invalidRanges already flags), or plain text (hyphens/spaces/whitespace
// -- literal characters with no token of their own).
export function annotateInputForDisplay(inputText) {
  const segments = []; // { start, end, kind: "valid"|"invalid"|"plain", token? }
  let cursor = 0;
  const wordRe = /\S+/g;
  let m;
  while ((m = wordRe.exec(inputText))) {
    const word = m[0];
    const wordStart = m.index;
    if (wordStart > cursor) segments.push({ start: cursor, end: wordStart, kind: "plain" });
    if (word.includes("-")) {
      let offset = 0;
      const pieces = word.split("-");
      pieces.forEach((piece, idx) => {
        const pieceStart = wordStart + offset;
        if (piece.length) {
          const token = canonicalToken(piece);
          if (token === undefined) segments.push({ start: pieceStart, end: pieceStart + piece.length, kind: "invalid" });
          else segments.push({ start: pieceStart, end: pieceStart + piece.length, kind: "valid", token });
        }
        offset += piece.length;
        if (idx < pieces.length - 1) {
          segments.push({ start: wordStart + offset, end: wordStart + offset + 1, kind: "plain" }); // the hyphen itself
          offset += 1;
        }
      });
    } else {
      let offset = 0;
      tokenizeWord(word).forEach((t) => {
        const start = wordStart + offset;
        const end = start + t.raw.length;
        segments.push(t.unknown ? { start, end, kind: "invalid" } : { start, end, kind: "valid", token: canonicalToken(t.raw) });
        offset += t.raw.length;
      });
    }
    cursor = wordStart + word.length;
  }
  if (cursor < inputText.length) segments.push({ start: cursor, end: inputText.length, kind: "plain" });
  return segments;
}
