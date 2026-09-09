# Orphograph — Deriving musical structure from the input itself

A research + planning document. No code was changed. Every claim about the current codebase cites `file:line` against the working tree at `G:\TheCodex\03-engine\orphograph` as of 2026-09-09. Every claim about musical precedent is labeled as either **established** (citable convention/theory) or **experimental** (a mapping this project would be originating). Nothing here was verified by listening — structural/reading verification only, the same limit the README states for most of its own phases.

The owner's framing, verbatim, is the brief:

> "We should also use the outermost ring (currently labeled 1-12) as a full-procession clock, where each of the ring's segments represents a position in its full procession. We should look into whether or not this should be mutable (will every procession be a full circle of fifths, or is there precedent for more options / a more input-derived range of possibilities? I'd also like to look into chord voicing conventions... Things like phrase length, number of words, word-length-sequence, could all be used to experimentally modulate the remaining musical structural components that are currently either arbitrary or given/hardcoded."

---

## 0. Executive summary (read this if nothing else)

**Three real bugs in the existing "scale follows typed input" mechanism, found by reading, not running** (§1.3). They are cheap to fix and should land before anything new is built on top of `deriveScaleFromTrace`, because the proposal in §4 extends that mechanism rather than replacing it:

- **F1 — tritone reference-frame mismatch.** The derived scale is expressed relative to I (spoke 1) but applied relative to O (spoke 7). Every derived scale sounds a tritone off from the letters' pitch classes.
- **F2 — geometric transforms are silently excluded.** The derivation reads the letter's *canonical* spoke, not the transformed entry's spoke, so mirror/rotate stages only contribute through the six literal twin pairs.
- **F3 — REST leaks into the scale.** `REST` has spoke 1, so every multi-word phrase adds pitch class 0 spuriously. The README's own logged verification output shows it.

**On the outer ring as a "full-procession clock" (§2, §4.A):** the answer to "will every procession be a full circle of fifths?" is a theorem, not a taste call. Stepping a 12-position wheel by `g` produces a cycle of length `12 / gcd(g, 12)`: `{1,5,7,11}` give the full 12 (fifths/fourths/chromatic), `{2,10}` give 6 (whole-tone), `{3,9}` give 4 (diminished), `{4,8}` give 3 (augmented), `6` gives 2 (tritone). Those five cycle lengths are exactly the symmetric/maximally-even sets of Clough–Douthett. So the clock's segment count is *already* derivable from the step, and the step is the one thing the law itself said should yield to input: "rotation-by-seven as the conventional answer **when no ground compels**" (master-blueprint-v2, quoted in transform.js:5-7 and README "Generalized" section). A typed phrase is a ground. The proposal derives the step from the phrase's own dominant melodic interval (experimental mapping, established consequence), relabels the outer ring in *procession order* rather than canonical order (this is literally what a circle-of-fifths diagram is), and defines "one full procession" as the number of given-ring passes until pitch and trace both return home. Direct precedent for a clock whose division count is derived from a cycle length rather than fixed: the Antikythera mechanism's own dials (Metonic 235, Saros 223, Olympiad 4), isorhythmic talea/color realignment at the LCM, and Xenakis sieves (period = LCM of moduli).

**On voicing (§3, §4.B):** the current `whistleVoicing` table (`0.5:1:1.5:2`) is an organ *registration*, not a chord voicing, and the actual sounding chord is whatever `quantizeFluteHz` snaps each layer to — so the "major triad" preset only yields a triad when the scale happens to contain those degrees. The proposal makes the flute voice **the current word's own pitch classes** (which is already what chord mode declares a word to be, sequencer.js:28-30), spaced by a real voicing operator chosen from the word's letter count (unison/octave → close → drop-2 → drop-2&4 → spread), placed in register by ring with the standard low-interval-limit rule (established), left **rootless** when the word contains the drone's O (established jazz practice: the bass has the root), and connected word-to-word by minimal-motion voice leading (established: parsimonious/Tymoczko). The one honest observation: the current default `0.5:1:1.5:2` is *exactly* what the low-interval-limit rule prescribes for the given ring's register (open fifths and octaves only), so it wasn't wrong — it was right for one register and applied to all three.

**What becomes superfluous** (§4.D): the flute's separate harmonic-sweep pitch mechanism (`whistleHarmonicMin/Max` + cosine-by-spoke, synth.js:1505-1508) is a second, competing spoke→pitch map that disagrees with the one the kalimba uses; once the flute voices the word's spokes through `hzForSpoke`, that sweep, the register presets, and the tritone bug all go away together. Chord/mode presets and the voicing/scale text fields survive as manual overrides, same relationship the scale field already has to the derive toggle.

**What is law and should not move** (§1.1): 12 spokes, poles at 1/7, the 6:8:12 ring ratio, 72 BPM grounding, the 12/8 pulse, the voicing-tier ring assignment. One caveat on 12: the *musical* meaning "7 spokes = a perfect fifth" depends on the placeholder 12-TET table (letters.js:292-296, flagged STILL OPEN at letters.js:104-105). The cycle-length arithmetic holds under any tuning; the intervallic names do not.

---

## 1. Audit — derived vs. hardcoded

Classification: **(a)** fully derived from input/wheel state, **(b)** fixed constant with no input dependence, **(c)** partially derived (real input dependence, but leaning on an arbitrary constant). "Law" means the README/wheel.js cite a settled source document; those are (b) by mechanism but are *not* candidates for change.

### 1.1 Structural constants that are declared law (leave alone)

| Parameter | Where | Class | Basis |
|---|---|---|---|
| `SPOKE_COUNT = 12` | wheel.js:13 | (b) law | Mirror law `p ↔ (14−p) mod 12` (wheel.js:2-7); README line 19 |
| `POLE_SPOKES = [1, 7]` | wheel.js:14 | (a) derived from law | Only self-reflecting solutions of the mirror law |
| `RING_SPEED_WEIGHT` 6:8:12 | wheel.js:93-97 | (b) law | Timaeus harmonic sub-triad; "a declared law, not something a performer steers" (wheel.js:80-81) |
| `PULSES_PER_BEAT = 3` | wheel.js:122 | (b) law | "onset = spoke in 12-pulse (12/8)" |
| `GROUNDING_BPM = 72` | wheel.js:139 | (b) law-by-decision | README "grounding tempo" section; explicitly "fixed, not slider-adjustable" |
| `BREATH_CYCLE_PULSES = 36` | wheel.js:160 | (a) | Identity `SPOKE_COUNT × PULSES_PER_BEAT` |
| `GRAND_CONVERGENCE_PULSES = 72` | wheel.js:174-177 | (a) | LCM over ring lap lengths, computed not typed |
| Spoke per consonant | letters.js:115-151 | (a) | Place of articulation continuum |
| Spoke per vowel/ligature | letters.js:153-173 | (a) | Front/back antiscia (phonology-map §5) |
| Ring per letter | letters.js:224-242 | (a) | Voicing/sonority (L11 as re-ruled) |
| `DRONE` anchored on O | main.js:109-117 | law | "drone = O's voice" |
| Mirror axis = I–O spine | wheel.js:26-30 | law | |

**One important caveat on "12":** `PLACEHOLDER_HZ_OF[s] = 220 · 2^((s−1)/12)` (letters.js:292-296) is explicitly a placeholder ("STILL OPEN: what real pitch (Hz) each spoke actually sounds," letters.js:104-105; README line 34). Everything downstream that says "rotate 7 = a perfect fifth" (transform.js comments, README "circle of fifths, live," index.html:62 tooltip) is true *only under this placeholder*. The group-theoretic facts in §2 (cycle lengths, coprimality) survive any retuning; the interval names don't. This document treats spoke = semitone as the working assumption but flags it wherever it matters.

### 1.2 Musical-structural parameters — the actual audit

| # | Parameter | Where | Class | Notes |
|---|---|---|---|---|
| 1 | `ROTATION_SPOKE_SHIFT = 7` (response-step default) | transform.js:54; main.js:286,297,301 | (b) | Law-declared *conventional default*, explicitly "demoted... to a displaceable default" (transform.js:8-10). Literal K→G respelling is gated to exactly 7 (transform.js:65-66). |
| 2 | `transpositionStepSpokes` (cyclic transposition step) | main.js:376 default `ROTATION_SPOKE_SHIFT`; UI index.html:62 `value="7"`, clamped 1-11 at main.js:447 | (b) | The step is a user number. Its *trigger* (given-ring trace loop, main.js:525-568) is (a). |
| 3 | `responseSteps` default `[{type:"mirror"}]` | main.js:260 | (b) | Demo default. Per-step `bounce` default = mirror only (transform.js:131). |
| 4 | `whistleVoicing` `0.5/1/1.5/2` @ `0.6/1/0.6/0.5` | synth.js:339-344 | (b) | One authored table; 8 named presets main.js:1165-1174; `WHISTLE_MAX_VOICES = 6` synth.js:608. Every layer is *then* quantized to the scale (synth.js:1019-1023), so the sounding chord ≠ the authored shape unless the scale contains it. |
| 5 | `whistleScale` default `[0,2,4,7,9]` | synth.js:61, synth.js:355; presets main.js:1207-1216 | (c) | Derived when `scale-follows-input` is on (index.html:166, default checked) via `deriveScaleFromTrace` — see §1.3 for how limited that derivation is. |
| 6 | `whistleHarmonic 8 / Min 6 / Max 9` | synth.js:279-281; register presets main.js:1255-1261 | (c) | The flute's pitch = `rootHz × RING_OCTAVE_MULTIPLIER[ring] × harmonic` (synth.js:970-972), harmonic interpolated by `cos(spokeAngle)` between Min/Max (synth.js:1505-1508), then folded (synth.js:988-1002) and quantized. Input-dependent only through which spoke was hit; the range endpoints and the cosine are authored. **This is a second spoke→pitch map, distinct from `hzForSpoke`.** |
| 7 | `whistleFloorHz 65 / CeilingHz 523`; note `floorHz 110 / ceilingHz 831` | synth.js:298-299, 177-178 | (b) | Justified by vocal-register research (comment synth.js:282-297) but fixed. Fold is octave-preserving, good. |
| 8 | `RING_OCTAVE_MULTIPLIER` 0.5/1/2 | wheel.js:106-110 | (b) | Self-described "reasonable default, not a declared law." |
| 9 | `DRONE_OCTAVE_SHIFT = −3` | main.js:116 | (b) | |
| 10 | `wordArc` / `chordPulseLength` | sequencer.js:52-65 | (c) | Chord spacing = sum of shorter arcs (a); floor `MIN_CHORD_PULSES = 4` (b). |
| 11 | Chord ring-out `clamp(0.4, 4, pulses/pps × 0.7)` | main.js:701 | (c) | Pulse-derived (a) with three bare constants (b). |
| 12 | Strum stagger `i × 20ms` | main.js:727 | (b) | |
| 13 | Note durations: origin 1.4s, melody 0.9s, reversal 0.9s, convergence 1.4s | main.js:521, 670, 832, 804 | (b) | Fixed seconds; not pulse-derived, unlike the flute gate (synth.js:1523-1529). |
| 14 | Accent velocity 1.3, accent percussion boost 1.6 | main.js:804,832; synth.js:2186 | (b) | |
| 15 | Direction = shorter arc; tie → word handedness | sequencer.js:75-82, 164-173 | (a) | Fully derived. |
| 16 | Lead-in = `SPOKE_COUNT` pulses | sequencer.js:148 | (a) | |
| 17 | Percussion density arc `0.35 + 0.65·(½+½cos)` over convergence phase | main.js:882-885 | (c) | Phase is real ring state (a); floor 0.35 and cosine shape (b). |
| 18 | Percussion kit roles per ring (kick/snare/hat) | synth.js:2190+ | (b) | Convention (low-to-high by speed). |
| 19 | Pan `−0.5/0/0.5`, detune `−4/0/+4` per ring | synth.js:2017, 2026 | (b) | |
| 20 | `tierEmphasis` default 1 | main.js:250; index.html:83 | (b) | A performer dial. |
| 21 | Flute note-gate window = `pulseSec × whistleArticulationPulseFraction (0.35)` | synth.js:1523-1529 | (c) | Pulse-derived (a), fraction (b). The README cites this as the model for "derive timing from wheel state." |
| 22 | F2 formant by received spoke: `950 → 1500 Hz` by cosine | synth.js:1458-1464 | (c) | Spoke-driven (a); endpoints and shape (b), self-flagged as a prototype interpretation. |
| 23 | Ring dial settle `900ms / ringSpeedMultiplier` | main.js:856-862 | (c) | |
| 24 | `rootSpoke` = first non-rest letter | trace.js:112 | (a) | Feeds the chamber root (main.js:1007-1009) and the readout — and nothing else. README "Next steps" #3 still lists "what root/key should govern" as open. |
| 25 | Transposition **trigger** = given ring completes a pass | main.js:525-568 | (a) | |
| 26 | Chamber modes `n × root` (open) / `(2n−1) × root` (stopped) | synth.js:748-759 | (a) from root + (b) pipe choice | |
| 27 | `REST` at spoke 1 | letters.js:183 | (b) engine device | Causes F3 below. |
| 28 | Trace capacity = `trace.length` clamped [32,256] | main.js:1046 | (a) | Visual; a good model for §4. |

**Reading of the table.** The *timing* layer of this engine is genuinely well derived (rows 10, 15, 16, 17, 21, 25): arcs, direction, convergence, breath, gate timing all fall out of the wheel. The *pitch-structure* layer is where the arbitrary constants cluster: rows 1, 2, 4, 5, 6, 7, 8. That is exactly the layer the owner's brief targets, and it's also where two pitch mechanisms coexist without agreeing (rows 5/6 vs. `hzForSpoke`).

### 1.3 `deriveScaleFromTrace` — exactly how good the existing derivation is

```js
// main.js:1236-1244
function deriveScaleFromTrace(trace) {
  const semitones = new Set();
  for (const entry of trace) {
    const spoke = PLACEHOLDER_SPOKE_OF[entry.letter];
    if (spoke === undefined) continue;
    semitones.add(((spoke - 1) % 12 + 12) % 12);
  }
  return Array.from(semitones).sort((a, b) => a - b);
}
```

What it captures: the **set** of canonical pitch classes of the letters in the woven trace. What it discards: multiplicity (how often each letter occurs), order, word boundaries, and — because of F2 — the transformed positions.

**F1 — reference frame.** The output is `spoke − 1`, i.e. degrees from **spoke 1 (I)**. The consumer is `quantizeFluteHz(hz, rootHz, scale)` (synth.js:74-90), which computes `semitonesFromRoot = 12·log2(hz / rootHz)` with `rootHz` defaulting to `_effectiveDroneBaseHz()` (synth.js:1019, 1658-1660) = `DRONE_HZ × transpositionRatio`, and `DRONE_HZ = hzForSpoke(7) × 2^−3` (main.js:117) — **spoke 7 (O)**. Under the 12-TET placeholder, spoke 7 is 6 semitones above spoke 1. So degree 0 of the derived scale is applied at O's pitch class, while the letters that produced it sit at I's. Concretely: a phrase consisting only of `I` derives `[0]` and snaps the flute to O's pitch class; a phrase of only `O` derives `[6]` and snaps the flute to I's. The kalimba (`hzForSpoke(transposedSpoke(spoke))`, main.js:670) and flute therefore disagree by a tritone whenever the toggle is on. The named mode presets (main.js:1207-1216) are *not* affected — a mode "relative to the drone's root" is a coherent thing — only the derived path mixes frames. This was not caught by the phase-27 verification because that verification intercepted the `setDroneParam("whistleScale", ...)` argument, not the resulting sounding pitch relative to the kalimba.

**F2 — canonical spoke, not transformed spoke.** `PLACEHOLDER_SPOKE_OF[entry.letter]` is the letter's home spoke. `transformEntry` (transform.js:72-73) returns `{ letter: entry.letter, spoke: <mirrored/rotated>, literal: false }` for every letter without a declared twin — the letter is unchanged, only `spoke` moves. So a mirror or rotate stage contributes new pitch classes to the derived scale **only** via the six `ROTATION_TWIN_OF` pairs and the one `FLIP_TWIN_OF` pair (letters.js:264-283). The README's phase-27 claim "post-transform-weaving, so a mirror/rotate response's own letters count too, directly answering 'across all transforms'" is true for K/G/T/D/S/Z/B/P/SH/ZH/CH/JH/Y/H at degree 7 or under mirror, and false for everything else. Fix: read `entry.spoke`.

**F3 — REST contamination.** `REST: 1` (letters.js:183) is inside `PLACEHOLDER_SPOKE_OF`, and `deriveTrace` sets `letter: REST` on rest entries (trace.js:96), so every rest adds pitch class 0. Check against the README's own logged verification: "DOGMAN SHORE K-T" → `[0,1,4,5,6,8,10,11]`. Under the spoke table in force at phase 27 (E=11, A=12), the letters give {4,6,8,1,11,5,10} — no letter at spoke 1 — and the `0` present in the logged output is the REST. Fix: `if (entry.isRest) continue;`.

**L1 — cardinality is unbounded.** A phrase touching 8+ distinct spokes, or any moderately varied phrase plus a mirror/rotate step (once F2 is fixed, each geometric step roughly doubles the set), pushes the derived scale toward chromatic, at which point `quantizeFluteHz` is a no-op and the phase-26 dissonance problem returns in full. There is no reduction rule. §4.C proposes one.

**L2 — no weighting.** A letter that appears five times and one that appears once contribute identically. Multiplicity is exactly the statistic that distinguishes a tonal center from a passing tone, and it's free.

**L3 — root is unused.** `rootSpoke` (trace.js:112) is computed and, apart from the chamber, ignored; the scale is always O-relative. The law makes O the *drone*; it says nothing about the flute's melodic root. README "Next steps" #3 leaves this open. §4.C takes a position.

---

## 2. Research — is the 12-spoke / circle-of-fifths structure the only sensible design?

### 2.1 What "circle of fifths" actually is, mathematically, on this wheel

The wheel's transposition mechanism (main.js:403-437) is `offset ← (offset + g) mod 12`. Its behavior is fully determined by elementary group theory on ℤ₁₂ — **established**, not a modeling choice:

- The orbit of stepping by `g` has length `12 / gcd(g, 12)`.
- `g ∈ {1, 5, 7, 11}` (the units of ℤ₁₂): full 12-cycle. `g = 7` is the circle of fifths; `g = 5` is its mirror image (circle of fourths); `g = 1, 11` are the chromatic circle in either direction.
- `g ∈ {2, 10}`: 6-cycle — the whole-tone scale as a cycle.
- `g ∈ {3, 9}`: 4-cycle — the diminished-seventh set.
- `g ∈ {4, 8}`: 3-cycle — the augmented triad.
- `g = 6`: 2-cycle — the tritone.

The five cycle lengths `{12, 6, 4, 3, 2}` are the divisors of 12, and their orbits are exactly the symmetric (Messiaen "limited transposition") sets, which are also the maximally-even sets ME(12, d) for those d (Clough & Douthett 1991). Clough & Myerson (1986) call the general version "the generalized circle of fifths" for any chromatic cardinality. So the honest answer to "will every procession be a full circle of fifths?" is: **only if the step is a unit of ℤ₁₂.** A wheel that derives its step from input already has a derived *range of cycle lengths*, and each is a named, precedented musical object. The current UI clamps the step to 1-11 (main.js:447) and accepts all of them; it just never surfaces what the choice does to the cycle. `wheel.js:37` already states this ("order 12/gcd(n,12)") in the `rotateSpoke` comment — the structure is known to the code, just not used as a clock.

Note again: "fifth" depends on the placeholder tuning. Under a different `PLACEHOLDER_HZ_OF`, `g = 7` would still close after 12 steps; it just might not sound like fifths.

### 2.2 Alternative fixed pitch-space structures (established)

- **Chromatic circle vs. circle of fifths** — the same 12 pitch classes in two orderings (adjacency by semitone vs. by fifth). The wheel draws the chromatic ordering (spoke = semitone) and *processes* in the fifths ordering. §4.A's relabeling proposal is nothing more than drawing the ordering the processing already uses.
- **Diatonic / modal subsets** — 7-note ME(12,7) sets; the seven church modes are rotations of one set (main.js:1207-1216 already lists them).
- **Pentatonic** — ME(12,5); the phase-26 default, chosen "because every pair of its own degrees is already a consonant interval" (synth.js:56-60).
- **Tonnetz / neo-Riemannian space** — triads as nodes, parsimonious (one-voice, one-or-two-semitone) moves as edges (Cohn; Tymoczko's generalized Tonnetz). Relevant to §3 voice leading rather than to wheel size.
- **Bohlen–Pierce** — 13 equal steps of a 3:1 "tritave," no octave at all. Real precedent that 12-with-octave is not the only coherent closed pitch space; not recommended here because 12 is this project's law and BP's consonances (odd harmonics 3:5:7:9) would fight the drone's octave-doubled architecture (`RING_OCTAVE_MULTIPLIER`, the flute's 0.5/2 layers).

### 2.3 Precedent for a structure whose SIZE varies with input (the owner's actual question)

The owner proposes "the outer ring as a full-procession clock, each segment a position in its full procession" — a division count that is a property of the procession rather than a fixed 12. Real precedent exists for each ingredient; the specific assembly is this project's own.

**Established:**

1. **The Antikythera mechanism's own dials** — the project's cited model (wheel.js:84-85, README "Rings run at fixed ratios"). Its back-face dials are divided by *cycle length*, not by a universal 12: the Metonic spiral has 235 cells (the 19-year lunisolar cycle, in 5 turns of 47), the Saros spiral 223 (the eclipse cycle), the Olympiad dial 4, the Exeligmos dial 3. A clock whose segment count is the length of the cycle it tracks is the mechanism's native idiom, and the multi-turn spiral is its answer to "what if the cycle is longer than one lap."
2. **Isorhythm (Ars Nova; Machaut, Vitry)** — a rhythmic cycle (*talea*) and a pitch cycle (*color*) of *different* lengths run simultaneously and realign at their LCM ("if the color includes nine notes and the talea five, the color would have to be repeated five times before the two schemes again realign"). This is precisely the relationship between the woven trace (a color of length *n*) and the transposition cycle (a talea of length `12/gcd(g,12)` given-passes), and `GRAND_CONVERGENCE_PULSES` (wheel.js:174-177) already uses LCM alignment for the ring speeds. Mensuration canon — the README's own frame for the three rings — is the same family.
3. **Xenakis sieves** — a scale/rhythm is a union/intersection of residue classes `(modulus, residue)`, and its period is the LCM of the moduli. Structure size is *derived* from the generating moduli, never chosen directly.
4. **Euclidean rhythms E(k, n)** (Toussaint 2005, Bjorklund) — `n` steps, `k` onsets distributed maximally evenly; the structure's size `n` is an input parameter, and the pattern is derived. Reproduces a large family of real traditional rhythms; the pitch-side twin of the same math is Clough–Douthett's ME sets.
5. **Moments of Symmetry (Erv Wilson 1975) / generated scales** — given a generator and an interval of equivalence, the *cardinalities* at which the stacked generator closes into a two-step-size scale are derived (for the fifth in the octave: 2, 3, 5, 7, 12, 17, ...). Scale size is a consequence of the generator, not a choice. This is the strongest precedent for "the size of the pitch structure is derived from the process that generates it."
6. **Letter-to-pitch ciphers** — the "French" cryptogram system (Ecorcheville 1909, used by Ravel/Debussy/d'Indy for the Haydn centenary) writes the alphabet in rows under A–G, i.e. maps letters onto pitch mod 7; the German B-A-C-H tradition; Josquin's *soggetto cavato* (vowels → solmization syllables, named by Zarlino 1558); Messiaen's *langage communicable* (letters → pitch + duration). This is the direct lineage of "type text, get pitch classes" and of `deriveScaleFromTrace`; Guido's Micrologus vowel-to-pitch table (c. 1025) is the oldest documented text-to-melody algorithm. None of these derive a *structure size* from the text, but they establish that letter-frequency → pitch-frequency is a centuries-old, respectable mapping.

**Experimental (this project's own):**

- Deriving the transposition **step** from the phrase (§4.A.2). No tradition picks a modulation interval by counting the intervals in a theme, though tonal answers in fugue are chosen by the subject's own head interval (a real if loose analogy: the answer is at the fifth *because* the subject outlines tonic–dominant).
- Making the outer clock's **segment count** equal to the procession's cycle length and subdividing each segment by word count (§4.A.3). The Antikythera spiral and the talea/color LCM are the nearest cousins.

### 2.4 Verdict on mutability

Yes, the outer ring should be mutable, and the mutability is already latent: the step already accepts 1-11, and the cycle length is already a function of it. What's missing is (1) an input-derived step with 7 as the "no ground compels" fallback, (2) a display that shows the *cycle* rather than the canonical 12, and (3) a definition of "full procession" that makes the clock close. Recommendations in §4.A.

---

## 3. Research — chord voicing conventions for rich, varied, elegant output

### 3.1 What the codebase currently calls "voicing"

`whistleVoicing` (synth.js:339-344) is a list of `{ratio, level}` multipliers on the flute's *one* fundamental. `0.5/1/1.5/2` is 16′/8′/(Quint)/4′ — pipe-organ registration, and the code says so (synth.js:334-338). Each layer is then independently snapped to the scale (`_fluteLayerHz`, synth.js:1019-1023). Two consequences worth naming:

- The **pitch content** of the flute chord comes from `quantizeFluteHz`, not from the table. A "major triad" preset (`0:1, 4:0.5, 7:0.5`) under the default pentatonic gives a triad; under a derived scale lacking degree 4 it gives whatever's nearest. The preset names promise a shape the pipeline doesn't guarantee.
- The fold (`_fluteFoldFactor`, synth.js:988-1002) correctly preserves the authored ratios as a block — good — but that also means one spacing is applied at every register. Under the standard low-interval rule (§3.2), the *same* spacing can be right at 500 Hz and wrong at 80 Hz.

Also relevant: chord mode already defines "a word is a chord" (sequencer.js:28-30, `_strikeWord`), and `onChordHit` (main.js:694-787) already de-duplicates by spoke, takes max velocity per spoke, and strums with a stagger. The kalimba therefore *already* voices words; the flute does not. The flute plays harmonics of O selected by the cosine of the hit spoke's angle (synth.js:1505-1508) — a mechanism inherited from the phase-2 "overtone flute" and never reconciled with the spoke→pitch table after the flute became a scale-quantized melodic voice (phase 26). That is the structural reason the flute's harmony feels "ungrounded" relative to the kalimba's: they don't share a pitch source.

### 3.2 Established voicing conventions, and what each would buy here

**Spacing follows the overtone series (orchestration; Rimsky-Korsakov, Adler, every arranging text).** Wide intervals at the bottom (octaves, fifths), progressively closer intervals higher up; close harmony below roughly C3 produces audible beating between low partials. Formalized as **low interval limits**: approximate floors below which an interval muddies — minor 2nd ≈ E3, major 2nd ≈ E♭3, minor 3rd ≈ C3, major 3rd ≈ B♭2, perfect 4th ≈ B♭2, perfect 5th ≈ B♭1, octave unrestricted. (Exact figures vary by source by a whole step or so; the ordering is universal.) *Buys:* a **register-dependent** voicing rule per ring. The given ring (`RING_OCTAVE_MULTIPLIER 0.5`, floor 65 Hz) should carry only 5ths/8ves — which is exactly the current default table. Made (`2×`) can carry close triads and seconds. This turns the existing three-ring register convention (wheel.js:103-110) into a voicing law with a real justification.

**Doubling (common-practice part-writing).** Prefer doubling the root, then the fifth, rarely the third; never double a tendency tone (leading tone, chordal 7th). Overtone-series justification: the fundamental recurs most in the series, then the fifth. *Buys:* a rule for what to do when a word repeats a letter (`RESPONDEO` has E×2, O×2): doubled letters → doubled pitch classes at octave displacement, unless the pitch is a tendency tone relative to the current scale (experimental extension).

**Drop-2 / drop-3 / drop-2&4 (jazz arranging; the big-band four-horn standard).** Take a close-position 4-note chord, drop the 2nd (or 3rd, or 2nd and 4th) voice from the top by an octave. Spans about a 10th; bottom-to-top never collapses to all-thirds; drop-3 is "too wide for piano" and is a guitar/section shape. *Buys:* a **spread operator parameterized by an integer**, which is exactly what a word-length statistic can select. Close (drop-0) → drop-2 → drop-3 → drop-2&4 is a monotone "openness" ladder.

**Rootless voicings (Bill Evans; the A/B forms 3-5-7-9 and 7-9-3-5).** The pianist omits the root because the bassist supplies it; the guide tones (3rd, 7th) carry the identity. *Buys:* the single cleanest rule for this engine — the **bass drone is the root (O), permanently, by law**. When a word contains O (or the phrase's `rootSpoke`), the flute should *omit* it and voice the remaining pitch classes over the drone. The law "drone = the pole-tone held under every figure" is literally the rhythm-section-plays-the-root arrangement.

**Quartal / quintal stacks (McCoy Tyner, the "So What" voicing).** Stacks of 4ths (or 5ths). *Buys:* an alternative to tertian spacing whose selection can be grounded in the word's own interval content (§4.B.4). Note the wheel is already quintal: rotate-7 is the fifth, and the 6:8:12 ring ratio is a 3:4:6 = fifth-and-octave structure.

**Parsimonious / minimal voice leading (neo-Riemannian P, L, R; Tymoczko's OPTIC geometry).** Successive chords connect by the smallest total voice motion; distance in the voice-leading space measures how smoothly two chords connect. *Buys:* a **word-to-word octave-placement rule**: for each pitch class in the next word, choose the octave that minimizes total semitone motion from the current voicing, subject to register limits. This is the harmonic twin of the engine's own "direction = shorter arc" (sequencer.js:164-173), which is a parsimony rule on the spoke axis. Two rules, one principle.

**Eno-style constrained systems.** *Discreet Music*: two loops of 63 s and 68 s; *Music for Airports 2/1*: ~22 loops of "incommensurable" lengths so they "are not likely to come back into sync." The consonance guarantee comes from restricting every loop to one scale, then letting incommensurate periods produce the variety. The codebase already cites this (synth.js:43-49). The lesson for voicing is the division of labor: **a constraint guarantees consonance; the period structure guarantees variety.** Orphograph's periods are already incommensurate-ish by design (6:8:12 rings, woven trace length, transposition cycle). The missing half is that the *voicing* should also be a function of those cycles, not a constant riding on top of them. Riley's *In C* (53 fixed cells, free progression) and Reich's phasing are the same family.

### 3.3 Mapping text statistics to voicing — honest labels

| Statistic | Proposed role | Support |
|---|---|---|
| Distinct letters in the current word | The chord's pitch-class content | **Established** by the project's own chord-mode definition (sequencer.js:28-30) and by the cipher/soggetto-cavato lineage. |
| Word letter count | Openness/spread operator (unison → close → drop-2 → drop-2&4 → spread) | Operators **established**; the *selection by count* is **experimental**, though "more voices → wider spacing" is the direction every arranging text pushes. |
| Repeated letters in a word | Doubling | Doubling rules **established**; letter-repeat → doubling is **experimental**, analogous to soggetto cavato's repeated vowels producing repeated syllables. |
| Word contains O / the root | Rootless voicing | **Established** (bass has the root). |
| Ring (given/received/made) | Register + low-interval limit | **Established** orchestration rule; ring→register is the project's own existing convention. |
| Previous word's voicing | Octave placement by minimal motion | **Established** (parsimonious voice leading). |
| Word's dominant melodic interval (2/3/4 vs 5/7) | Tertian vs quartal stacking | Both vocabularies **established**; the selector is **experimental**. |
| Number of words in the phrase | Length of the harmonic "progression" per pass; subdivision ticks on the outer clock | Structurally true by construction; the clock display is **experimental** with Antikythera/isorhythm precedent. |
| Phrase length (entries) | Trace capacity (already, main.js:1046); transposition cycle in passes (§4.A) | Isorhythm LCM precedent **established**. |
| Word-length *sequence* | Rhythmic accent distribution (Euclidean E(k=words, n=pulses per pass)) instead of the fixed cosine density | Euclidean rhythms **established**; using word count as *k* is **experimental**. |

---

## 4. The proposal

Ordered by priority. P0 is bug-fix; P1–P2 are the two sub-questions the owner asked, kept separate but joined by one shared statistic (§4.E). Each item states the formula, the inputs it reads, and its precedent label.

### P0 — Fix `deriveScaleFromTrace` before building on it

1. **F2/F3:** iterate `trace`, `if (entry.isRest) continue;`, use `entry.spoke` (not `PLACEHOLDER_SPOKE_OF[entry.letter]`). Now every geometric transform stage contributes its real pitch classes, and rests contribute nothing.
2. **F1 — pick one frame.** Two options, and this is a design decision the owner should make explicitly:
   - **(i) Keep O as the flute's root and express the derived scale O-relative:** `((spoke − 7) mod 12)`. Minimal change; the kalimba and flute then agree. The drone remains the tonal center of the flute, consistent with law.
   - **(ii) Make the flute's melodic root the phrase's `rootSpoke`** (trace.js:112 — "root/key are determined by the first note/letter of the phrase," a statement the README already quotes as settled but only ever wired to the chamber): pass `rootHz = hzForSpoke(rotateSpoke(rootSpoke, transpositionOffset)) × 2^DRONE_OCTAVE_SHIFT` into `quantizeFluteHz`, and derive the scale as `((spoke − rootSpoke) mod 12)`. This resolves README "Next steps" #3 and makes the phrase's own first letter the modal center the way *soggetto cavato* makes the first vowel the subject's head. The drone still sits on O; a phrase not rooted on O then sits *over* a non-tonic pedal, which is common modal-drone practice (a dominant or subdominant pedal), not an error.
   - Recommendation: **(ii)**, because it uses a statistic the law already declared and the code already computes, and because it gives every phrase its own key rather than every phrase sharing O's. Either option fixes the tritone.
3. Add a one-line verification to the existing Playwright habit: for phrase `I`, assert the flute's quantized pitch class equals `hzForSpoke(1)`'s.

### P1 — The outer ring as a full-procession clock (owner's sub-question A)

**A.1 Define "one full procession."** Currently the transposition advances once per given-ring pass (main.js:525-568), the given ring's lap over a woven trace of `n` entries, and the offset returns to 0 after `L = 12 / gcd(g, 12)` advances. So a full procession is `L` given-passes, and at its end both pitch (offset 0) and content (traceIndex 0) are home — self-resolving by construction, exactly as the README already verified for `g = 7` (`[7,2,9,4,11,6,1,8,3,10,5,0]`). With retrograde/mirror steps in the chain the woven trace is already one pass, so no extra alignment is needed. **Formula:** `processionPasses = 12 / gcd(transpositionStepSpokes, 12)`. Established (ℤ₁₂).

**A.2 Derive the step from the phrase, with 7 as the law's fallback.** Compute the phrase's **melodic interval histogram**: for each consecutive non-rest pair within a word, the shorter-arc distance `d ∈ {1..6}` (the same `wordArc` step, sequencer.js:54-61) and its sign (cw/ccw). Pick the modal `d` (most frequent); tie-break toward the phrase's overall handedness (`wordHandedness` of the whole trace, sequencer.js:75-82), then toward 7 per law. Then set `g = d` if the phrase leans clockwise, `12 − d` if counterclockwise. Fallback when no interval exists (single-letter phrase, or all repeats): `g = 7` — precisely "rotation-by-seven... when no ground compels."

- Worked example, `DOGMAN` (D5 O7 G9 M2 A10 N5): arcs 2, 2, 5, 4, 5 → modal tie {2, 5}; the word's span 5→5 has handedness +1, so tie-break clockwise; between 2 and 5 choose... this needs a rule. Proposed: prefer the interval class whose cycle is *longer* (5 → 12-cycle over 2 → 6-cycle), since "no ground compels" defaults to the fullest cycle. Result `g = 5`, a full 12-cycle by fourths, clock of 12 segments. A phrase dominated by whole-steps (e.g. `T-D-N-S` all at spoke 5 → no; try `B-F-TH` = 2,3,4 → arcs 1,1) gives `g = 1`, chromatic, 12 segments; one dominated by tritone leaps gives `g = 6`, a 2-segment clock — a phrase that literally only alternates between two keys.
- Precedent label: the interval histogram is a melodic cousin of Forte's interval-class vector (**established** analytic object); using its mode as the modulation interval is **experimental**. Consequence (cycle length) is a theorem.
- Keep the UI number box (index.html:62) as a manual override, exactly like the scale field: a "step follows input" checkbox, default on, and the box shows the derived value.

**A.3 Relabel and resize the outer ring as the clock.** The outer ring (view.js:880-922) currently draws 12 segments labeled 1-12 in canonical (chromatic) order and rotates the whole ring by the rim dial. Proposed:

- Draw `L = 12 / gcd(g, 12)` major segments. Segment `k` is labeled with the pitch offset reached after `k` advances, i.e. `(k · g) mod 12` — for `g = 7` that is `0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5`: **the circle of fifths drawn as a circle of fifths.** For `g = 2` it's a 6-segment whole-tone clock; for `g = 6`, two segments. This is not a novel diagram — it is the standard circle-of-fifths chart, generalized to whatever generator the phrase produced. The transposition marker ring (view.js:924-952) becomes redundant with this and can be folded into it (the marker is "which segment is active").
- Subdivide each major segment into `W` minor ticks, where `W` = number of words in the woven trace (the given-pass is `W` chords long in chord mode, and `W` word-arcs long in melody mode). The clock then reads at two scales: which key (major segment) and which word within the pass (minor tick). Precedent: the Antikythera Metonic spiral's 235 months grouped into years; the talea within the color. Experimental as a display; every quantity is real.
- The rim dial (main.js:856-862, `stepDial(rimDial, delta)`) already steps by `delta = transpositionStepSpokes` per given pass; under the relabeled ring a step is *one segment*, so `stepDial(rimDial, 1)` in segment units, with the settle time unchanged. Total rotation over a full procession = one turn, which is the clock reading "the procession closed."

**A.4 What stays fixed.** The inner three rings stay at 12 segments — they are the letter space, and 12 is law. Only the outermost (procession) ring is resized. Grand convergence, breath, and 6:8:12 are untouched; note that a full procession of `L` given-passes over a trace of `n` entries realigns with the 72-pulse convergence cycle at `lcm(L · n-ish, 72)` — a further, longer isorhythmic realignment the readout could log the way it logs convergence now.

### P2 — Voicing derived from the word (owner's sub-question B)

Replace "flute pitch = harmonic of O by spoke-angle cosine, then table-voiced, then quantized" with "flute chord = the current word's pitch classes, voiced by rule." All pitch goes through `hzForSpoke(transposedSpoke(spoke))` like the kalimba — one pitch source for the whole engine.

**B.1 Content (established).** On each `onChordHit` / on each word boundary in melody mode: `pcs = unique(word.map(e => e.spoke))` (already computed as `velocityBySpoke` in main.js:720-723). In melody mode, the "current word" is the word containing the hit entry (sequencer already resolves this by reference, sequencer.js:171). The flute sustains the word's chord until the next word; per-letter hits within the word can still re-articulate via the existing note-gate (synth.js:1523-1529) without changing pitch content — this is the "seamless droning while a single tone is allowed to organically change" the README's phase 16 asked for, now with a harmonic reason for *when* it changes.

**B.2 Rootless when the drone already has it (established).** If `pcs` contains the flute's root (O under P0-option-i, `rootSpoke` under option-ii) and `|pcs| ≥ 3`, drop it from the flute; the drone holds it. For `|pcs| ≤ 2` keep everything (a dyad with the root removed is a single note).

**B.3 Spread operator by word length (operators established; selector experimental).** Let `v = |pcs|` after B.2, clamped to `WHISTLE_MAX_VOICES`. Build the close-position stack (sort pcs ascending from the root within one octave), then:

| `v` | operator | result |
|---|---|---|
| 1 | octave stack (16′/8′/4′) | the current default, minus the fifth |
| 2 | open: lower voice down an octave | a "power" dyad |
| 3 | close position | triad shape |
| 4 | drop-2 | spans ≈ a 10th |
| 5 | drop-2&4 | |
| 6 | drop-3 + doubled root at 16′ | widest |

The `level` per voice reuses the existing table convention: unison 1.0, others scaled by the overtone-series doubling preference (root-class 1.0 → 0.6 → 0.5, the same numbers already in synth.js:339-344, so the default loudness balance is preserved).

**B.4 Register and low-interval limits by ring (established).** Place the voicing so its lowest note ≥ the ring's floor: given `0.5×`, received `1×`, made `2×` (`RING_OCTAVE_MULTIPLIER`), then check adjacent intervals against the low-interval table; any adjacent interval smaller than its limit at that register is opened by raising the upper voice an octave (or, if that breaks the ceiling, dropping the lower). For the given ring this collapses almost every word to fifths/octaves — which is what the current table does, now for a stated reason. Existing `whistleFloorHz/CeilingHz` and `foldIntoRange` (synth.js:104-110) remain the outer bounds.

**B.5 Voice leading between words (established).** Given the previous word's realized voicing `V_prev` (absolute Hz per voice) and the next word's pcs, choose each voice's octave to minimize `Σ |semitones(V_prev[i] → V_next[i])|` (greedy assignment is fine at ≤ 6 voices), subject to B.4. When voice counts differ, the extra voices enter at the octave nearest the chord's mean. This is Tymoczko's voice-leading distance in its simplest form and the harmonic analog of `_directionToward` (sequencer.js:164-173).

**B.6 Doubling from repeated letters (experimental).** If the word repeats a letter (`RESPONDEO`: E, O twice), and `v < WHISTLE_MAX_VOICES`, add that pitch class again an octave away from its first placement, unless it is the scale's leading tone relative to the root (semitone 11) — the one doubling every part-writing text forbids.

**B.7 Tertian vs quartal (experimental selector, established vocabularies).** Use the same interval histogram as A.2, per word: if the word's modal arc is 5 (a fourth/fifth on the placeholder tuning), stack the voicing in fourths from the lowest pc rather than in close thirds. Ties → tertian. This makes a word like `K-A-D` (9→10→5: arcs 1, 5) voice differently from `K-T-S` (9→5→5: arcs 4, 0). Optional; can land after B.1–B.5 are heard.

**B.8 Scale interaction.** Under P2 the flute's pitch content *is* letters, so scale quantization of the flute becomes a no-op for the current word (its pcs are in the derived scale by construction) and matters only for (a) the manual-harmonic fallback when `whistle-follow` is off, and (b) any future voice that isn't letter-driven. That is the right outcome: the scale was introduced (phase 26) to stop three *independent* pitch choices from clashing; once the choices aren't independent, the constraint is satisfied structurally. Keep `quantizeFluteHz` for (a)/(b).

### P3 — Scale cardinality and weighting (extends `deriveScaleFromTrace`)

Even with P2, the derived scale still governs the kalimba's transposition sense, the manual flute mode, and any future melodic voice, so it should be made principled:

- **Weight by multiplicity:** build a histogram `count[pc]` over non-rest entries (post-F2, so transform stages count).
- **Cardinality rule:** if `|pcs| ≤ 7`, use all. Otherwise keep the 7 most frequent (ties by earliest first occurrence — the phrase's own order is a real statistic). 7 is not arbitrary: it is the largest ME cardinality below 12 that still has a well-formed generated structure for `g = 7` (MOS cardinalities 5, 7, 12), and it's the diatonic cardinality. If the owner prefers stricter consonance, 5 is the other MOS stop.
- **Root:** per P0 (ii), `rootSpoke`. Alternatively the histogram's mode — but the law already names the first letter, so keep that and expose the histogram mode only in the readout.
- Precedent labels: histogram → scale is the cipher/soggetto lineage (**established** in kind); the 7-cap via MOS/ME cardinalities is **established** structure applied as an **experimental** rule.

### P4 — Small constants that can be re-expressed in wheel units (low priority, honest housekeeping)

| Constant | Now | Proposed derivation |
|---|---|---|
| `MIN_CHORD_PULSES = 4` (sequencer.js:52) | bare | `PULSES_PER_BEAT + 1`, or simply `PULSES_PER_BEAT` (one 12/8 beat). Minor; the floor is only hit by 1-letter words. |
| Chord ring-out `× 0.7`, clamp `[0.4, 4]` s (main.js:701) | bare seconds | `durationSec = pulseLength / ringPulsesPerSecond(ring) × (1 − 1/SPOKE_COUNT)`; clamp to `[1 pulse, 1 lap]` in that ring's own pulse units. |
| Strum stagger `20 ms` (main.js:727) | bare | One made-ring pulse × `whistleArticulationPulseFraction / v` — the strum spans the articulation window already derived for the flute. |
| Note durations 0.9/1.4 s (main.js:521, 670, 804, 832) | bare | One pulse of the hit ring (`1 / ringPulsesPerSecond(ring)`) for ordinary hits; one beat (`PULSES_PER_BEAT` pulses) for origin/convergence/reversal accents. |
| Density floor `0.35` (main.js:884) | bare | Replace the cosine with a Euclidean pattern `E(k, n)` per pass, `k = word count`, `n = SPOKE_COUNT × passLaps` — accent distribution derived from the phrase's word-length sequence rather than a fixed curve. **Experimental**, established algorithm. Or, minimally, floor = `1 / PULSES_PER_BEAT`. |
| `RING_TRANSPOSE_BASE_SETTLE_MS = 900` (main.js:856) | bare | `1000 / ringPulsesPerSecond("given")` × 1 — one given pulse, the same unit `transpositionGlideProgress` already uses (main.js:450-455). |

### 4.D — What this makes superfluous or subsumed

- **`whistleHarmonic`, `whistleHarmonicMin/Max`, the cosine sweep in `meanderFlute` (synth.js:1505-1508), `WHISTLE_REGISTER_PRESETS` (main.js:1255-1261), `_whistleHarmonicByRing`** — superseded by P2. The flute's pitch comes from the same `hzForSpoke` as everything else; register comes from ring + B.4. Retire per the project's rule against mechanisms quietly changing meaning (README, "one driving bass drone"). Keep `whistle-follow` as the on/off for "flute voices the word" vs. manual pitch, so the manual harmonic slider survives as the off-state fallback (the relationship `whistleScale` already has to its toggle).
- **`WHISTLE_CHORD_PRESETS` and the voicing text field (main.js:1141-1180)** — demoted to a manual override of the *spread operator* when "voicing follows input" is off. Semitone authoring stays; the presets are now honest, because B.1 guarantees the content and the preset only shapes spacing.
- **`WHISTLE_MODE_PRESETS` and the scale field** — unchanged role (manual override of P3), already correct.
- **The transposition marker ring (view.js:924-952)** — folded into the relabeled procession clock (A.3); two rings showing the same offset in two coordinate systems is the redundancy the owner's framing points at.
- **`_fluteFoldFactor`'s "fold the whole voicing as a block"** — still needed as the outer safety bound, but B.4 handles register properly before it ever engages.
- **`transposition-step` number box** — becomes the derived-value readout/override (A.2).
- **`deriveScaleFromTrace`** — extended (P0, P3), not duplicated. Nothing new should compute pitch-class sets from the trace anywhere else; P2's per-word `pcs` is a *subset* view of the same histogram and should be built by the same helper.

### 4.E — Where the two sub-questions meet

One statistic — the melodic interval histogram over the phrase (A.2) — drives both the procession clock's generator and, per word, the tertian/quartal choice (B.7). One statistic — word count — drives both the clock's minor subdivision (A.3) and the chords-per-pass (B.1). One statistic — word length — drives voicing openness (B.3). Phrase length (entries) already drives trace capacity and, via the given ring's lap count over it, *when* the clock ticks. The owner asked "if procession length starts determining a wheel's own size, does that same length statistic also plausibly drive voicing richness?" — the honest answer is that *phrase length* is the wrong statistic for richness (a long phrase of two-letter words should be sparse), but *word length* is the right one, and the two are related by word count. So: **phrase length → clock size; word count → clock subdivision and progression length; word length → chord richness; interval content → generator and stacking.** Each lever gets exactly one job, and every job reads a number the trace already contains.

Interaction to watch: under A.2, a phrase dominated by tritones gives a 2-segment clock and only two keys; that is *correct* (the phrase's own material only implies two keys) but may feel static. The fallback rule "prefer the longer cycle on ties" (A.2) mitigates it; if it still feels thin by ear, the next lever is to let the *response chain's* rotate steps use the derived `g` too, so a phrase's transform stages and its transposition cycle share one generator.

### 4.F — Verification plan (structural, the project's own style)

1. P0: assert `deriveScaleFromTrace("I K")` contains no rest-derived 0, contains K's *transformed* spoke under a `rotate+3` step, and that the flute's quantized pc for phrase `I` equals `hzForSpoke(1)`'s pc.
2. A.1/A.2: for each `g ∈ 1..11`, assert the offset sequence closes after exactly `12/gcd(g,12)` steps; assert `DOGMAN` derives `g = 5` (or whatever the tie rule lands on — pin it in a test so it can't drift).
3. A.3: capture `fillText` calls on the procession ring; for `g = 7` assert labels read `0,7,2,9,4,11,6,1,8,3,10,5` in order.
4. B.1–B.5: for `DOGMAN` under P0(ii) with root D (spoke 5): pcs = {5,7,9,2,10}; B.2 removes the root D (the drone/chamber carry it) → {7,9,2,10}, `v = 4` → drop-2. Assert the realized voice count is 4, that every adjacent interval respects the ring's low-interval limit, and that the transition to the next word (`SHORE`: {6,7,5,3} → minus root → {6,7,3}) moves each voice ≤ 6 semitones.
5. The full combined smoke test the README already runs, plus a screenshot showing the relabeled ring.

---

## 5. Sources

Precedent citations used above (web-checked 2026-09-09):

- MOS / generated scales — [Xenharmonic Wiki: MOS scale](https://en.xen.wiki/w/MOS_scale); [Anaphoria: Introduction to Erv Wilson's Moments of Symmetry](https://www.anaphoria.com/wilsonintroMOS.html); [Tonalsoft: moment of symmetry](http://tonalsoft.com/enc/m/mos.aspx)
- Maximally even sets — [Clough & Douthett 1991 (PDF)](https://ehess.modelisationsavoirs.fr/atiam/biblio/Clough&DouthettJMT-1991.pdf); [Wikipedia: Maximal evenness](https://en.wikipedia.org/wiki/Maximal_evenness); [Clough legacy / generalized circle of fifths](https://www.tandfonline.com/doi/full/10.1080/17459730701494710)
- Isorhythm — [Wikipedia: Isorhythm](https://en.wikipedia.org/wiki/Isorhythm); [Britannica: Isorhythm](https://www.britannica.com/art/isorhythm); [HOASM: Isorhythm](http://www.hoasm.org/IID/Isorhythm.html)
- Xenakis sieves — [iannis-xenakis.org: Sieve Theory](https://www.iannis-xenakis.org/en/sieve-theory/); [Exarchos & Jones, Sieve analysis and construction](https://research.gold.ac.uk/15753/1/11.2-Dimitris-Exarchos-%26-Daniel-Jones.pdf); [MTO 28.2 Besada](https://www.mtosmt.org/issues/mto.22.28.2/mto.22.28.2.besada.html)
- Euclidean rhythms — [Toussaint, The Euclidean Algorithm Generates Traditional Musical Rhythms (PDF)](https://cgm.cs.mcgill.ca/~godfried/publications/banff.pdf); [Wikipedia: Euclidean rhythm](https://en.wikipedia.org/wiki/Euclidean_rhythm)
- Bohlen–Pierce — [Wikipedia](https://en.wikipedia.org/wiki/Bohlen%E2%80%93Pierce_scale); [Xenharmonic Wiki](https://en.xen.wiki/w/Bohlen%E2%80%93Pierce_scale)
- Text-to-pitch lineage — [Wikipedia: Soggetto cavato](https://en.wikipedia.org/wiki/Soggetto_cavato); [Britannica: Micrologus](https://www.britannica.com/topic/Micrologus); [Wikipedia: Musical cryptogram](https://en.wikipedia.org/wiki/Musical_cryptogram); [Eric Sams, Musical Cryptography](https://ericsams.org/index.php/on-cryptography/333-musical-cryptography?start=1)
- Voicing conventions — [PianoGroove: Drop 2 voicings](https://www.pianogroove.com/jazz-piano-lessons/drop-2-voicings-tutorial/); [FreeJazzLessons: Drop 2](https://www.freejazzlessons.com/drop-2-voicings/); [Piano With Jonny: voicings guide (rootless A/B, quartal)](https://pianowithjonny.com/piano-lessons/jazz-piano-chord-voicings-the-complete-guide/)
- Orchestral spacing / doubling — [Open Music Theory: Core Principles of Orchestration](https://pressbooks.nebraska.edu/openmusictheory/chapter/core-principles-of-orchestration/); [Hutchinson, Rules of Spacing](https://musictheory.pugetsound.edu/mt21c/RulesOfSpacing.html); [Orchestration Resources: Spacing and Balance](https://www.orchestrationresources.com/introduction-chapters/chapter-5b-spacing-and-balance)
- Voice-leading geometry — [Hook, review of Tymoczko *A Geometry of Music* (MTO 17.3)](https://mtosmt.org/issues/mto.11.17.3/mto.11.17.3.hook.html); [Tymoczko, The Generalized Tonnetz (PDF)](https://dmitri.mycpanel.princeton.edu/tonnetzes.pdf)
- Eno — [Reverb Machine: Deconstructing Music for Airports](https://reverbmachine.com/blog/deconstructing-brian-eno-music-for-airports/); [Open Culture summary](https://www.openculture.com/2019/07/deconstructing-brian-enos-music-for-airports.html)
- Text setting — [Wikipedia: Text declamation](https://en.wikipedia.org/wiki/Text_declamation)

Antikythera dial divisions (Metonic 235, Saros 223, Olympiad 4, Exeligmos 3) are from general knowledge of the mechanism (Freeth et al., *Nature* 2006/2008) and were not re-fetched for this document; the project already cites the mechanism (wheel.js:84-85).
