# Sample credits

## flute-drone-plate.mp3

- **Source:** "Chaotic Hypnotic Flute Drone (Loop)" by kkenny101
- **URL:** https://freesound.org/people/kkenny101/sounds/859638/
- **License:** CC0 1.0 (public domain) -- no attribution required, free for commercial use
- **Original:** 48kHz/16-bit stereo WAV, 1:10.267
- **This file:** Freesound's own public preview stream (HQ MP3, ~128-192kbps), fetched directly from
  their CDN without requiring a Freesound account -- CC0 permits this use regardless of which
  Freesound-hosted rendition is used.
- **Used as:** the flute drone's breath-noise source in `src/synth.js` (`_pinkNoiseBuffer` replaced/
  supplemented by this real recorded texture), replacing synthesized pink noise that read as generic
  "static" with no organic character.

## flute-note-c4.mp3

- **Source:** "Flute - C4" by MTG (Music Technology Group, Universitat Pompeu Fabra, Barcelona), part
  of the "Good-sounds" dataset of monophonic instrumental sounds
- **URL:** https://freesound.org/people/MTG/sounds/354638/
- **License:** CC-BY 3.0 -- free for commercial use, attribution required (this file)
- **Original:** flute playing C4 (MIDI note 48), 442Hz tuning reference, 48kHz/24-bit mono WAV, 9.62s,
  recorded on a Neumann U87
- **This file:** Freesound's own public preview stream (HQ MP3), fetched directly from their CDN
- **Measured fundamental:** ~264.7Hz (autocorrelation with parabolic interpolation on stable sustain
  windows, 2.5-7s into the note) -- used instead of the nominal C4 figure since the actual recorded
  pitch is what playbackRate math needs, not the note's theoretical name
- **Used as:** the flute's pitched tone-core voice in `src/synth.js` (`buildFluteToneLayer`), replacing
  the additive sine-oscillator stack -- pitch-shifted via `AudioBufferSourceNode.playbackRate` to reach
  each ring/voice's actual target pitch, since no combination of synthesized oscillators + noise ever
  read as a real woodwind (see README "Flute, phase 24").

## Multisampling (flute-note-f4/a4/c5/d5/g5/a5.mp3)

One sample (C4 above) stretched via `playbackRate` across this engine's whole pitch span
(~117-1400Hz, given ring ratios/harmonics/voicing) meant up to **3.6 octaves of stretch on a single
recording** -- dragging that sample's own real body-resonance formants along with the pitch (the
"chipmunk" effect), and the actual root cause behind the flute never quite reading as a real
woodwind despite many rounds of parameter tuning. Fixed by multisampling: six more real notes from
the same dataset/source as the existing C4, so no layer needs more than roughly a fifth of stretch.

- **Source:** "Flute - &lt;note&gt;" by MTG, the same "Good-sounds" dataset/uploader/recording setup as
  `flute-note-c4.mp3` above (Neumann U87, 442Hz tuning reference, 48kHz/24-bit mono WAV originals)
- **License:** CC-BY 3.0 on every file, individually confirmed on each sound's own Freesound page
- **This file (each):** Freesound's own public preview-CDN stream (HQ MP3), same provenance as C4
- **Measured fundamentals** (autocorrelation with parabolic interpolation, multiple independent
  stable-sustain windows per file, cross-checked against an independent narrow-band FFT peak -- same
  method as C4's own measurement, "never trust the filename"):

  | File | Freesound URL / sound ID | Nominal note | Measured fundamental |
  |---|---|---|---|
  | `flute-note-f4.mp3` | https://freesound.org/people/MTG/sounds/354652/ (354652) | F4 | ~354.1Hz |
  | `flute-note-a4.mp3` | https://freesound.org/people/MTG/sounds/354541/ (354541) | A4 | ~445.5Hz |
  | `flute-note-c5.mp3` | https://freesound.org/people/MTG/sounds/354387/ (354387) | C5 | ~532.7Hz |
  | `flute-note-d5.mp3` | https://freesound.org/people/MTG/sounds/354668/ (354668) | D5 | ~603.8Hz |
  | `flute-note-g5.mp3` | https://freesound.org/people/MTG/sounds/354646/ (354646) | G5 | ~804.5Hz |
  | `flute-note-a5.mp3` | https://freesound.org/people/MTG/sounds/354446/ (354446) | A5 | ~900.2Hz |

  All six measured 30-46 cents sharp of A440-equal-tempered nominal, consistent with C4's own
  measurement (~264.7Hz is itself ~20 cents sharp of nominal C4) -- a real, systematic property of
  these recordings' own intonation/tuning reference, not a measurement error. `flute-note-d5.mp3` is
  the one file where the autocorrelation and initial FFT cross-check disagreed (by a full semitone);
  resolved with a denser autocorrelation scan across the whole note, which found the FFT check's
  analysis window had landed on a brief, real amplitude dip about a third of the way through the
  sustain, not a wrong fundamental -- the surrounding stable region (five independent 0.15s windows,
  correlation 0.999-1.0, all within 1.3Hz of each other) is what's reported above.
- **Used as:** additional entries in `src/synth.js`'s `FLUTE_SAMPLES` table -- each tone-core layer
  now picks whichever of these seven samples has the nearest base pitch to what that layer is
  actually playing (`_pickFluteSample`), rather than always stretching the one C4 recording.
