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

const MAX_TOKEN_LEN = Math.max(
  ...Object.keys(PLACEHOLDER_SPOKE_OF).map((t) => t.length),
  ...Object.keys(SHORTHAND_OF).map((t) => t.length)
);

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

  return { tokens: trace.map((t) => t.letter), trace, rootSpoke: rootEntry.spoke, unknownTokens };
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
