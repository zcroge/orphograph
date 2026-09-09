// Letter -> spoke -> pitch tables.
//
// SETTLED (law): I = spoke 1 (top pole), O = spoke 7 (bottom pole).
//
// SPOKE assignments below are now RE-DERIVED by PLACE OF ARTICULATION, not
// manner class. The earlier scheme (six tritone-slots, one per manner
// class -- nasal/stop/liquid/fricative/affricate) crammed every PLACE
// within a manner class onto one shared spoke (K/T/B, three different
// places, all stacked at one spoke purely because they're all stops) --
// "extremely uneven," and rightly so: spoke 5 alone held 4 letters, spoke
// 11 held 5, while several spokes held exactly one. Place of articulation
// is a real, standard, front-to-back CONTINUUM (bilabial -> labiodental ->
// dental -> alveolar -> postalveolar -> palatal -> velar -> glottal) --
// derived directly from the IPA sounds the census already states for each
// letter (no invention: this is the same census, just ordered by the
// property phoneticians already use place charts for), and a continuum
// maps onto a wheel's own rotation far more naturally than a small set of
// discrete manner categories forced onto antipodal pairs.
//
// This does NOT make the wheel perfectly even -- English's own consonant
// inventory isn't evenly distributed across place either (alveolar alone
// holds seven: T/D/N/S/Z/L/R). It IS a real improvement: K/T/B now sit at
// three different spokes instead of one, and freeing manner class from the
// spoke axis leaves exactly two spare non-pole spokes (8 place categories
// fit in 10) for E and A to each get their own dedicated spoke, rather
// than squatting on a consonant's cell as before.
//
// Manner class and the rotation/flip-twin relationships (K/G, T/D, S/Z,
// B/P, hush/ʒ, Y/H, ...) haven't gone anywhere -- they're just no longer
// spatial on the spoke axis. Twins are NOT required to share a spoke under
// this scheme, and mostly don't need to: same-PLACE twins (K/G both velar,
// T/D both alveolar, etc.) naturally still land together, but Y/H -- a
// flip-twin, not a rotation-twin, and genuinely different places (palatal
// glide vs. glottal fricative) -- now correctly split apart. That's a real
// gain in phonological honesty, not a loss: their twin relationship was
// already fully carried by ring (L11), not by spoke-sharing, so nothing
// about Y/H being twins is lost by putting them at their own true places.
// Likewise H's own marked family (h/ç/x) was previously bunched at one
// "liquid" spoke despite H not phonetically being a liquid at all -- a
// known stretch even under the old scheme. Now h/ç/x fall out at their
// three real, different places (glottal/palatal/velar) naturally.
//
// VOWELS/LIGATURES ARE NOW GROUNDED TOO, not placeholder -- by a DIFFERENT
// law than the consonants above (place of articulation is a consonant
// concept), but a law that was already on the books and simply never
// executed: appendix/B-history/phonology-map.md's own §5 declares
// reflection = harmony class = the front/back opposition -- "the wheel's
// mirror law gains a phonological employment: harmony classes are
// antiscia [mirror pairs]." wheel.js's mirror pairs are exactly
// 2<->12, 3<->11, 4<->10, 5<->9, 6<->8, with 1 and 7 self-reflecting
// (the poles) -- and the consonants above ALREADY occupy the front
// (2-6, bright/voiced-forward places) and back (8-10, dark/rearward
// places) arcs by place of articulation. So: put front vowels on the
// bright arc, and each one's real antiscion (true mirror spoke) holds
// the back vowel at the SAME aperture (height) step -- front/back
// mirror pairs the same way the law already describes, not a new
// invention. Diphthongs are grounded by their ONSET (nucleus) quality --
// the ligature's second glyph already writes the offset in the spelling
// itself, so the spoke shouldn't redundantly re-encode it too.
//
//   E (spoke 3): /e/, front mid -- bright arc, second aperture step off
//     the close (I) pole.
//   EA (spoke 4): /ae/, one step opener than E -- bright arc, third
//     step, the front-open corner.
//   AE (spoke 3): /ei/ ("day") -- the nucleus/onset quality is E's; the
//     offglide is already written by the second glyph, so it co-locates
//     with E rather than claiming a spoke of its own.
//   A (spoke 10): /a/ (open back) -- EA's true antiscion at the same
//     aperture step (the textbook front-open/back-open pair).
//   AI (spoke 10): /ai/ ("eye," "my," "time") -- open onset = A's
//     quality -> A's spoke, offglide already written by the second glyph.
//   AO (spoke 10): /aU/ ("cow," "how," "now") -- open onset = A's
//     quality -> A's spoke; O is the offglide, already written by the
//     second glyph (moved OFF O's own spoke 7 for exactly this reason --
//     see below).
//   OE (spoke 11): schwa/e (a neutral vowel, also covering stressed /V/
//     "cup" per the correction further down) -- mid back-central, E's
//     true antiscion, the mid bright/dark pair.
//   OO (spoke 12): /u/ ("boot") -- close back, the dark arc's first
//     step off the close pole, I's own true counterpart across the
//     wheel's closest-vowel top.
//   OI (spoke 7): /oi/ ("boy," "toy") -- an O-quality nucleus, so it
//     belongs at the O pole itself, same position as before this law was
//     stated but now actually grounded by it, not by "the spelling
//     contains O."
//   vowel.nub (spoke 1), vowel.horizontal (spoke 7): the two SOUNDLESS
//     primes (L8, 00-laws.md: "vertical/human = I, horizontal = earth,
//     nub = heaven") get a GEOMETRIC grounding instead of a phonetic one
//     -- a prime that GENERATES harmony classes rather than belonging to
//     one has no front/back quality to place by antiscion, so each takes
//     the one kind of spoke that has no antiscion of its own: the two
//     self-reflecting poles, alongside the two sounded primes (I, O)
//     they compose with.
//
// Net effect on population (39 tokens): ten of twelve spokes now sit at
// 2-4 occupants (was six of twelve); spoke 11 drops from a placeholder
// pile of 5 to a grounded 1, spoke 10 rises from H alone to a grounded
// 4. Spokes 11/12 stay the lightest (1 each) -- honestly, not evasively:
// English's own back-vowel inventory is genuinely thinner than its front
// one at this resolution, the same real-language fact already documented
// above for consonant spoke 5 (alveolar, 7 letters) rather than a
// modeling shortcut.
//
// STILL OPEN: what real pitch (Hz) each spoke actually sounds -- see
// PLACEHOLDER_HZ_OF below, untouched by this.

export const SETTLED_SPOKE_OF = {
  I: 1,
  O: 7,
};

export const PLACEHOLDER_SPOKE_OF = {
  ...SETTLED_SPOKE_OF,

  // Bilabial -- both lips. W (labial-velar, doubly articulated) kept here
  // per its own name rather than split or duplicated.
  B: 2, P: 2, M: 2, W: 2,

  // Labiodental -- no twin relationship stated between f/v in the census
  // (F's own entry covers both via "f (·v)", not a twin-hop), so both
  // simply share this place-spoke; ring (both given) reflects that.
  F: 3, V: 3,

  // Dental -- Theta's own family (θ base, ð by mark).
  "TH": 4, "DH": 4,

  // Alveolar -- the largest real cluster (7): T/D and S/Z (rotation-twin
  // pairs), N (nasal), L/R (the liquid rotation-twin pair). This is where
  // the real unevenness that's left over lives -- English genuinely has
  // more alveolar consonants than any other single place, not an artifact
  // of this table.
  T: 5, D: 5, N: 5, S: 5, Z: 5, L: 5, R: 5,

  // Postalveolar -- hush's whole family: base, rotation-twin, and the
  // affricate compound built on it.
  SH: 6, ZH: 6, CH: 6, JH: 6,

  // Palatal -- Y's own place, and H.c (ç), one of H's two further marks,
  // which happens to be genuinely palatal too.
  Y: 8, "H.c": 8,

  // Velar -- K/G (rotation-twin pair), ŋ (velar nasal -- still open/
  // ligature status per its own census entry, but that doesn't block
  // giving it a spoke, same treatment as before), and H.x (x), H's OTHER
  // further mark, genuinely velar.
  K: 9, G: 9, "ŋ": 9, "H.x": 9,

  // Glottal -- H alone. Previously bunched with L/R/H.c/H.x at one
  // "liquid" spoke despite not being a liquid at all; this is H's actual,
  // single, true place.
  H: 10,

  // Vowels/ligatures -- see the front/back-mirror law above for the real
  // grounding each of these now has. Kept here, briefly, is just why each
  // TOKEN exists at all (unchanged from before, a separate question from
  // where it sits): the ligatures (L8/G-A2, "vowel combinations are
  // formed by conjoining the two component vowel glyphs") close real
  // gaps found in practice -- OE (schwa, also covering stressed /V/
  // "cup"), EA (/ae/ "cat"), OO (/u/ "boot"), AE (/ei/ "day," G-A2's own
  // cited example, never actually wired in until now), AI (/ai/ "eye" --
  // the sound of the pronoun "I" itself, distinct from the letter I's own
  // /i/), OI (/oi/ "boy"), and AO (/aU/ "cow" -- its earlier /V/ meaning
  // was retired in favor of OE covering that, freeing the spelling for
  // this real diphthong). IO ("io/yo-type," G-A2's other named example)
  // stays genuinely unimplemented -- its intended sound was never pinned
  // down precisely enough to commit to a value.
  E: 3, "AE": 3,
  EA: 4,
  A: 10, "AI": 10, "AO": 10,
  "OE": 11,
  "OO": 12,
  "OI": 7,
  "vowel.nub": 1, "vowel.horizontal": 7,

  // REST is an ENGINE-level device, not a claim about the alphabet's own
  // census -- it's not in 00-laws.md and shouldn't be read as a proposed
  // addition to it. It exists so a word-boundary space can be matched by
  // the sweep exactly like a real letter (per "placeholder-letter-as-rest-
  // note"), just silent when hit. See trace.js for how it enters the trace.
  // No longer spoke 12 (that's A's spoke now) -- moved to share I's pole
  // spoke, since REST isn't phonetic content in the first place and was
  // never meant to compete for a place-of-articulation slot at all.
  REST: 1,
};

// Ring membership -- WHICH of the wheel's three rings a letter belongs to,
// as distinct from spoke (WHERE on the wheel). Until this table existed,
// every ring swept the identical trace at its own speed/octave: real
// movement, but no independent content -- each ring was the same
// information in a different octave and time signature.
//
// FIRST derivation (struck same day, 00-laws.md's L11/[S26]) counted ring
// as hops off L1's base x transform x mark model -- given=base(0 hops),
// received=1 hop, made=2 hops. That had the causality backwards: the
// symbols are meant to denote real phonetic/musical relationships, not the
// other way around, so ring shouldn't track how many drawing-transforms
// were used to reach a glyph. RE-DERIVED instead directly from phonetic
// space -- voicing and sonority, both real acoustic properties already
// implicit in the census's own stated IPA sounds, no new claim made:
//   given    = voiceless obstruent (stop/fricative/affricate, no vocal-fold
//              vibration)
//   received = voiced obstruent (same manner of obstruction, voicing added)
//   made     = sonorant -- nasal, liquid, glide, or vowel (voiced,
//              unobstructed, the register's own closest approach to a
//              vowel's free resonance -- fitting made's already-established
//              role as the fastest, innermost ring)
// This reframes the voicing rotation-twins already built for other reasons
// (G-A1: K/G, T/D, S/Z, B/P, hush/ʒ) as the DIRECT visual expression of
// this same acoustic fact, not a separate mechanism ring merely echoes.
// It also resolved most of the population imbalance the struck ruling
// produced (16/10/3 -> 11/8/11) as an unforced side effect of fitting the
// real material, not a goal pursued for its own sake. See 00-laws.md's
// L11 and CHANGELOG.md for the full derivation and the struck predecessor.
//
// Genuinely still open (no sound value settled yet to classify): the two
// vowel primes with no object/token at all (horizontal, nub). ŋ's own
// glyph/ligature status stays open, but its SOUND (a voiced velar nasal)
// is already fully known, so unlike the two open vowels it DOES get a real
// ring here. Letters left out of this table entirely -- ringForLetter
// returns undefined for them, and callers should treat "no ring yet" as
// "sounds on every ring," the same way undecided content already behaves
// everywhere else in this engine, rather than going silent on two-thirds
// of the wheel for something that was never actually classified.
export const PLACEHOLDER_RING_OF = {
  // given -- voiceless obstruents
  K: "given", T: "given", P: "given", F: "given", "TH": "given",
  S: "given", SH: "given", H: "given", CH: "given",
  "H.c": "given", "H.x": "given",

  // received -- voiced obstruents (the given row's voicing-partners)
  G: "received", D: "received", B: "received", V: "received", "DH": "received",
  Z: "received", ZH: "received", JH: "received",

  // made -- sonorants: nasals, liquids, glides, and vowels (voiced,
  // unobstructed). The new vowel ligatures (OE/EA/AO/OO) are made-tier for
  // the same reason as every other vowel -- maximally sonorant, no new
  // rule needed.
  M: "made", N: "made", "ŋ": "made", L: "made", R: "made", Y: "made", W: "made",
  I: "made", O: "made", E: "made", A: "made",
  "OE": "made", "EA": "made", "AO": "made", "OO": "made", "AE": "made", "AI": "made",
  "OI": "made",
};

export function ringForLetter(letterToken) {
  const canonical = canonicalToken(letterToken);
  return canonical === undefined ? undefined : PLACEHOLDER_RING_OF[canonical];
}

// Literal transform-twins -- the actual OTHER LETTER a base becomes under
// one of 00-laws.md L1's own transforms, when the census already declares
// one. This is what makes a "response" a real re-spelling rather than just
// the same letters replayed from new wheel positions: "the symbols that
// represent the transformed word... comprised of the respective literal
// transforms of the letters of the input itself, if our system allows."
// It doesn't always allow it -- coverage is exactly as wide as the census
// already committed to and no wider (see transform.js for the geometric
// spoke-fallback used everywhere else).
//
// Rotation-twins (R): the six voicing pairs G-A1 already declares, which
// L11 also reframed as the given/received ring split -- so applying R to a
// given-tier letter literally respells it as its received-tier voicing
// partner (K->G, T->D, S->Z, B->P, hush->ʒ, and the affricate compound
// tʃ->dʒ, "dʒ by rotation of the compound" per 00-laws.md's own census).
export const ROTATION_TWIN_OF = {
  K: "G", G: "K",
  T: "D", D: "T",
  S: "Z", Z: "S",
  B: "P", P: "B",
  SH: "ZH", ZH: "SH",
  CH: "JH", JH: "CH",
};

// Flip-twins (I): only one pair is actually declared this way in the
// census -- Y/H, explicitly named "a flip-twin, not a rotation-twin" in
// letters.js's own spoke-derivation notes above, precisely because they
// don't share a place (palatal glide vs. glottal fricative) the way
// rotation-twins share a place but differ in voicing. Everything else
// (TH/DH, H.c, H.x) is a MARK relationship, not a transform -- L1 keeps
// marks and transforms as separate generator legs, and only transforms
// belong here.
export const FLIP_TWIN_OF = {
  Y: "H", H: "Y",
};

export const REST = "REST";

// 12-TET default, spoke 1 = an arbitrary placeholder tonic (A3 = 220Hz).
// Real biwa practice tunes relative to the performer's vocal range (see the
// Biwa-tuning discussion) -- this table exists purely so the prototype makes
// sound; replace TONIC_HZ once a real tonic is chosen. Untouched by the
// spoke-table sync above -- pitch-per-spoke is a separate open question.
const TONIC_HZ = 220;
export const PLACEHOLDER_HZ_OF = {};
for (let s = 1; s <= 12; s++) {
  PLACEHOLDER_HZ_OF[s] = TONIC_HZ * Math.pow(2, (s - 1) / 12);
}

// Typing shorthand -- a temporary, PHONETIC bridge to a standard
// Roman/QWERTY keyboard, only for the handful of tokens that aren't
// already reasonably typable (most tokens -- K, T, SH, CH, etc. -- are
// already 1-2 plain ASCII letters and need no alias at all). This is
// explicitly the near-term answer: once a real physical keyboard and
// finalized glyphs exist, the better mapping is DIRECT/positional (a
// physical key placed where that letter actually sits in the wheel's own
// spoke/ring arrangement), not phonetic -- this table is the bridge until
// then, not a claim about the eventual hardware layout.
//
// ŋ isn't on a Roman keyboard at all -- "NG" is the standard English
// digraph for exactly this sound. H.c/H.x carry a period, awkward to type
// and easy to mistype -- "HC"/"HX" keep the family-relationship (H's own
// marks) visible while dropping the punctuation. The two unnamed vowel
// primes get neutral, clearly-provisional codes derived from their own
// placeholder names (vowel-Horizontal, vowel-Nub) rather than inventing a
// phonetic value they haven't actually been assigned yet.
export const SHORTHAND_OF = {
  "NG": "ŋ",
  "HC": "H.c",
  "HX": "H.x",
  "VH": "vowel.horizontal",
  "VN": "vowel.nub",
};

// Reverse lookup, for display -- e.g. the keyboard/legend showing "type: NG"
// on the ŋ tile. Tokens with no shorthand alias (the large majority --
// their own formal token is already fine to type) simply aren't in here.
export const TYPED_AS_OF = Object.fromEntries(
  Object.entries(SHORTHAND_OF).map(([shorthand, token]) => [token, shorthand])
);

// Resolves EITHER a formal token (I, SH, "H.c", ...) or a shorthand alias
// (NG, HC, ...) to the one canonical formal token everything downstream
// (spoke/ring/legend lookups, keyboard highlighting) actually keys on.
// Returns undefined for anything genuinely unrecognized.
export function canonicalToken(rawToken) {
  const key = rawToken.trim();
  if (key in PLACEHOLDER_SPOKE_OF) return key;
  const upper = key.toUpperCase();
  if (upper in PLACEHOLDER_SPOKE_OF) return upper;
  return SHORTHAND_OF[upper];
}

export function spokeForLetter(letterToken) {
  const canonical = canonicalToken(letterToken);
  const spoke = canonical === undefined ? undefined : PLACEHOLDER_SPOKE_OF[canonical];
  if (spoke === undefined) {
    throw new Error(`Unknown letter token "${letterToken}" -- see src/letters.js for known tokens.`);
  }
  return spoke;
}

export function hzForSpoke(spoke) {
  return PLACEHOLDER_HZ_OF[spoke] ?? PLACEHOLDER_HZ_OF[((spoke - 1) % 12) + 1];
}
