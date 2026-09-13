// Web Audio synthesis, aimed at "auric, dirge-like, timeless, but not
// denying its own digital origin" -- so this leans on techniques that are
// honestly digital (unison-detuned oscillator stacks, synthetic reverb)
// rather than trying to fake an acoustic instrument outright. The eventual
// physical build routes real speakers through wood/metal resonator
// chambers for its actual acoustic color; this digital layer just needs to
// give that later stage something rich and long-breathing to work with.
//
// Still deliberately NOT a port of the game's SynthVoice.cs formant/vocal
// model -- that's still future work. What's here is a step up from a bare
// single oscillator: unison stacking, a slow swelling envelope, a simple
// two-band formant-ish coloring (vaguely "oh"-shaped, tying to O's own
// spoken reading), and a synthetic convolution reverb for space and length.

import { ringSpeedMultiplier, spokeAngle, rotateSpoke, normalizeSpoke, RING_OCTAVE_MULTIPLIER } from "./wheel.js";
import { hzForSpoke } from "./letters.js";
import { voiceWord, DEFAULT_ARC_SPOKES_PER_OCTAVE } from "./voicing.js";

// O's own pole spoke (wheel.js: I at top, O at bottom) -- the drone's fixed
// anchor, in spoke terms. Used to find which pitch class the drone is
// CURRENTLY holding (rotateSpoke by the live transposition offset) for the
// native voicing engine's own rootless rule -- see meanderFlute.
const DRONE_POLE_SPOKE = 7;

const RINGS = ["given", "received", "made"];

// RING_RATIO (tonic/fifth/octave, one interval per ring) is retired --
// "one driving bass drone" replaced the three-simultaneous-voice chord it
// used to build with one fundamental (see setDroneVoices's own header
// comment), and its one remaining use, pulseDrone's brief per-partial
// pitch nudge, turned out to fire faster than it could ever settle (see
// pulseDrone's own comment -- "obnoxious wavering bass oscillation") and
// was removed rather than re-tuned. RING_OCTAVE_MULTIPLIER (wheel.js)
// covers the flute's own per-event register instead (see meanderFlute).
// Historical comments elsewhere in this file still refer to RING_RATIO by
// name describing PAST behavior -- left as-is, not live code.

// "Everything was sounding musically grounded and harmonious before we
// started trying to expand on the flutes... the polyphonic arrangements
// are reading pretty messy." Root cause: each ring already picked its own
// pitch independently within its own register (whistleHarmonic's
// continuous wheel-follow interpolation) -- the fixed root-fifth-octave
// ratio (RING_RATIO) only ever applied to the three rings' FUNDAMENTALS,
// never to the actual harmonic multiplier each ring separately, freely
// selects on top of it. That was always mildly true; it only became
// loudly audible once each ring's single tone became a full authored
// CHORD (phases 22-23) -- the same occasional cross-ring pitch mismatch
// now multiplies across every simultaneous chord tone in both rings'
// clusters instead of clashing as two single, forgivable notes.
//
// This is the actual, established technique real generative/ambient drone
// music uses to sound endlessly resolved (Eno-style generative systems,
// raga/modal drone traditions): constrain every simultaneously-sounding
// pitch to degrees of ONE shared, consonant scale relative to ONE common
// root, so ANY combination the wheel/cluster/register system can produce
// is guaranteed mutually consonant by construction -- not by hoping three
// independent choices happen to align.
//
// "More tailored control over modal arrangement" -- the scale itself is
// now authored data (whistleScale, in DEFAULT_DRONE_PARAMS below), the
// same treatment whistleVoicing already got in phase 22: a plain list of
// semitone offsets, editable as text, with real named-mode presets (see
// the UI) as starting points rather than one hardcoded array. Major
// pentatonic is still the default specifically because every pair of its
// own degrees is already a consonant interval (the "you can't really go
// wrong" scale in countless real generative-music systems) -- but modal
// COLOR, not just safety, is now something to actually dial in, not a
// fixed decision baked into the code.
const DEFAULT_FLUTE_SCALE_SEMITONES = [0, 2, 4, 7, 9];

// Snaps any frequency to the nearest member of scaleSemitones, relative to
// rootHz, in whichever octave is actually closest -- a ring's (or cluster
// voice's) own register stays roughly where it already was, just pulled
// onto the shared scale instead of landing on whatever arbitrary,
// possibly-dissonant pitch the raw math produced. Applied to the FINAL
// absolute pitch (after RING_RATIO, harmonic, and cluster ratio are all
// folded in) rather than to any one factor along the way, so it doesn't
// matter how a voice arrived at its "desired" pitch -- only the actual
// sounding result has to land on the shared scale. Falls back to the
// default scale if an authored one is ever empty/malformed, rather than
// leaving pitches completely unquantized.
function quantizeFluteHz(hz, rootHz, scaleSemitones) {
  if (!(hz > 0) || !(rootHz > 0)) return hz;
  const scale = scaleSemitones && scaleSemitones.length ? scaleSemitones : DEFAULT_FLUTE_SCALE_SEMITONES;
  const semitonesFromRoot = 12 * Math.log2(hz / rootHz);
  const octave = Math.floor(semitonesFromRoot / 12);
  const within = semitonesFromRoot - octave * 12;
  let best = scale[0], bestDist = Infinity;
  for (const s of scale) {
    for (const shift of [-12, 0, 12]) {
      const candidate = s + shift;
      const dist = Math.abs(within - candidate);
      if (dist < bestDist) { bestDist = dist; best = candidate; }
    }
  }
  const totalSemitones = octave * 12 + best;
  return rootHz * Math.pow(2, totalSemitones / 12);
}

// "The kalimba covers the high pitched melodic notes, I want the flute
// drones to stay below a more contained ceiling to keep it from becoming
// shrill/whistly." Each instrument's pitch used to be a product of several
// independent multipliers (ring register, harmonic, voicing ratio,
// transposition) with no shared concept of "this instrument's own range" --
// this is that missing concept. Folds by whole OCTAVES rather than a hard
// clamp, so a pitch that lands outside the authored window is re-voiced an
// octave down/up instead of flattening onto the boundary note -- pitch
// class and interval contour survive (the whole spoke->pitch design rests
// on that), only the register moves. Falls back to a plain clamp only if
// the window is too narrow to reach by whole octaves, so the function is
// always total.
function foldIntoRange(hz, floorHz, ceilingHz) {
  if (!(hz > 0) || !(floorHz > 0) || !(ceilingHz > floorHz)) return hz;
  let out = hz;
  while (out > ceilingHz) out /= 2;
  while (out < floorHz && out * 2 <= ceilingHz) out *= 2;
  return Math.min(ceilingHz, Math.max(floorHz, out));
}

// "There is no roughness-generating mechanism anywhere in the codebase --
// both the bass drone and the flute's growl are pure sine partials behind
// linear biquad filters, structurally 'vocal/organ,' never 'rough/buzzy,'
// regardless of tuning." A bandpass EQ bump (growl's own previous entire
// mechanism) can only emphasize existing content; it cannot GENERATE new
// harmonic content the way real vocal-tract/didgeridoo roughness actually
// works. This is the real fix: a soft-clip (tanh) waveshaper curve, the
// standard way to add genuine odd-harmonic-rich distortion without hard
// digital clipping. Normalized so curve(+-1) always maps to +-1 (no
// overall level jump as `amount` -- and therefore `drive` -- changes, only
// the SHAPE in between gets more aggressively curved) -- amount 0 returns
// a true identity curve (bypass), not just a very mild tanh, so "off"
// genuinely means off. Regenerated (not automated) on param change --
// WaveShaperNode.curve isn't an AudioParam, but this only ever changes on
// a slider drag, never per-frame, so the lack of a glide is inaudible.
function buildSaturationCurve(amount, samples = 1024) {
  const curve = new Float32Array(samples);
  if (!(amount > 0)) {
    for (let i = 0; i < samples; i++) curve[i] = (i / (samples - 1)) * 2 - 1;
    return curve;
  }
  const drive = 1 + amount * 20;
  const norm = Math.tanh(drive);
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / norm;
  }
  return curve;
}

// Real flute note samples (assets/samples/flute-note-*.mp3, see
// _loadRealFluteNoteBuffer and CREDITS.md) -- MULTISAMPLED, not one note
// stretched across the whole range. One recorded C4 pitch-shifted via
// playbackRate across this engine's actual pitch span (~117-1400Hz, given
// ring ratios/harmonics/voicing octaves) meant one sample stretching
// 0.44x-5.3x -- about 3.6 OCTAVES -- which drags that sample's own body
// resonance/formants along with the pitch (the "chipmunk" effect), the
// dynamic-resonance problem the chamber bank above exists to fix. This
// table (C4 through A5, same MTG "Good-sounds" dataset, all CC-BY 3.0, see
// CREDITS.md) means no layer ever needs more than roughly a fifth of
// stretch. Every baseHz here is MEASURED (autocorrelation, parabolic
// interpolation, multiple independent stable-sustain windows, cross-
// checked against an independent FFT peak where the two methods agreed --
// see CREDITS.md for the one file where they didn't and how that was
// resolved), never the nominal note name. loopStart/loopEnd are per-file
// since each recording's own stable sustain sits at a different point.
const FLUTE_SAMPLES = [
  { file: "flute-note-c4.mp3", baseHz: 264.7, loopStart: 1.5, loopEnd: 8.0 },
  { file: "flute-note-f4.mp3", baseHz: 354.1, loopStart: 1.5, loopEnd: 5.5 },
  { file: "flute-note-a4.mp3", baseHz: 445.5, loopStart: 3.2, loopEnd: 7.5 },
  { file: "flute-note-c5.mp3", baseHz: 532.7, loopStart: 2.0, loopEnd: 7.0 },
  { file: "flute-note-d5.mp3", baseHz: 603.8, loopStart: 2.7, loopEnd: 4.5 },
  { file: "flute-note-g5.mp3", baseHz: 804.5, loopStart: 3.0, loopEnd: 6.5 },
  { file: "flute-note-a5.mp3", baseHz: 900.2, loopStart: 3.0, loopEnd: 6.0 },
];

// The synthesized "throat voice" -- reaches the guttural kargyraa register
// no real flute sample can (see droneThroatAmount's own comment). Lived on
// the flute originally, crossfaded in at the low end of its register; now
// lives on the bass drone instead (see setDroneVoices/DEFAULT_DRONE_PARAMS'
// droneThroat* comment) -- the drone has no register to crossfade against,
// so this just sits on permanently, gated per-hit by pulseDrone instead.
// THROAT_HARMONICS is the bass drone's own DRONE_HARMONICS recipe (a
// proven odd-dominant additive stack, already self-described in this file
// as "clarinet/didgeridoo-ish"), truncated to 8 partials -- the downstream
// growl formant pair does the real spectral carving, so the full
// 16-partial richness isn't needed on this source.
const THROAT_HARMONICS = [
  { n: 1, amp: 1.0, detune: 0 },
  { n: 2, amp: 0.42, detune: 3 },
  { n: 3, amp: 0.5, detune: 0 },
  { n: 4, amp: 0.24, detune: -4 },
  { n: 5, amp: 0.34, detune: 0 },
  { n: 6, amp: 0.14, detune: 5 },
  { n: 7, amp: 0.2, detune: 0 },
  { n: 8, amp: 0.16, detune: -3 },
];

// The mixer -- per-channel faders sitting downstream of each voice's own
// timbre (busGain/whistleAmount stay where they are, in the drone-timbre
// panel; those scale modulation depth along with level and are timbre-
// internal, not faders -- see setDroneParam), a targeted low-mid boost for
// the flute (the register the recent de-harshing pass's growl reduction
// pulled level from -- see fluteLowMid/ensureContext), and a leveler
// distinct from the existing peak-safety limiter (that one stays a fast
// clip guard; this one is a slow, musical "even things out" control that
// is a genuine no-op at 0). Same "factory default" pattern as every other
// DEFAULT_*_PARAMS export here.
// REVISED after a real measured headroom check: the guitar's own new low-
// register/higher-drive redesign pushed the master bus to real, measured
// peak clipping (>=0.99 samples) at forced maximum arc intensity with the
// drone on -- found directly (mixMeterLevels().clipping), not guessed.
// mixGuitar starts at 0.8 (still user-adjustable up, same "arrives
// conservative" treatment mixFlute took the opposite direction on,
// deliberately, for presence) and mixLevelerAmount raised 0.35 -> 0.5 for
// more real evening-out under the heaviest simultaneous load this engine
// has produced yet.
//
// Honest disclosed limit, found while chasing this down: even completely
// alone (no guitar, no percussion, nothing else playing), the drone's own
// channel already measures ~1.6 RMS -- a real, PRE-EXISTING characteristic
// of its own additive stack (16 harmonic partials + throat harmonics +
// growl formants, all summing before any fader), predating this round
// entirely and unrelated to this round's own droneGrowlSaturationAmount/
// wander tuning (verified directly: reverting that tuning changed the
// measured drone RMS by less than measurement noise). That pre-existing
// level, not anything new this round added, is the real remaining
// contributor to occasional peak-limiter engagement at the most extreme
// combination this engine has ever produced (a long, dense phrase, forced
// maximum arc intensity, AND the drone on, together) -- the master bus's
// own RMS stays well-behaved throughout (< 0.75) even then, so the
// limiter is doing exactly the job it exists for at a genuinely new
// extreme, not silently failing. Turning the DRONE down further wasn't
// done here -- it isn't what this round's own brief asked for ("powerful
// force"), and it's a pre-existing balance question, not a regression
// this round introduced -- but it's the honest next place to look if a
// real ear check still finds the loudest simultaneous moments too hot.
export const DEFAULT_MIX_PARAMS = {
  mixDrone: 1,
  mixNote: 1,
  mixFlute: 1.45,
  mixPercussion: 1,
  mixGuitar: 0.8,
  mixMaster: 0.45,
  mixFluteLowMidHz: 400,
  mixFluteLowMidDb: 5,
  mixLevelerAmount: 0.5,
};

// The rhythmic, palm-muted, overdriven, drop-tuned guitar/bass voice.
// Synthesized, not sampled -- the flute's own reasoning (a near-pure
// spectrum exposes synthesis artifacts instantly, "nobody ships a
// convincing flute from oscillators plus noise") inverts for a high-gain
// guitar: a tanh clipper at real drive erases most of the difference
// between a real string and a sawtooth, the same reason a cheap and an
// expensive guitar sound closer once heavily distorted. Sawtooth (and,
// below, square) are a deliberate, LABELED exception to this file's own
// earlier "sawtooth removed as harsh" decision (see playNote's own
// detuneCents comment) -- that reasoning was about an undistorted,
// vocal-adjacent, struck voice; distorted odd/full-harmonic waveforms are
// the canonical source material for exactly this genre instead. One
// voice, not two ("guitar/bass") -- guitarSubAmount is the "bass" half, a
// sub-octave doubling layer, not a second instrument (the drone still
// permanently holds the true sub-bass, by law).
//
// Register: REVISED after listening -- "the guitar/bass needs to be...
// from the same super-low range that the bass drone lives in... what I'm
// hearing now is more like a wimpy palm mute." The first pass carved the
// guitar's own register ABOVE the drone (floorHz = DRONE_HZ*2) on the
// theory that metal mixes high-pass rhythm guitars at 80-120Hz to avoid
// fighting the bass -- true, but backwards here: a real drop-tuned 7/8-
// string's low string fundamental sits at 40-65Hz, genuinely IN the
// drone's own territory (DRONE_HZ ~=38.9Hz), and the real mixing answer
// for two low voices sharing that space is a SIDECHAIN duck (see
// _duckDroneForGuitar below), not frequency segregation. floorHz now sits
// just above the drone's own fundamental (real low-string F#0/G0-ish
// territory); ceilingHz two-plus octaves above that -- still a real
// rhythm-guitar span, never drifting up into the kalimba/note voice's own
// register.
//
// guitarScoopHz still defaults to droneGrowlF2Hz's OWN current value
// (580) -- the guitar vacates exactly the band the drone's throat voice
// occupies (a real measured collision, unaffected by the register move
// above, which only touches the FUNDAMENTAL), which also happens to be
// the classic metal mid-scoop frequency.
export const DEFAULT_GUITAR_PARAMS = {
  guitarPreGain: 1,
  // Raised 0.6 -> 0.85 -- last round's drive was genuinely mild; real
  // high-gain rhythm tone needs to be pushed hard enough that the raw
  // oscillator shape gets buried under generated harmonics, the entire
  // reason buildSaturationCurve exists in the first place.
  guitarDriveAmount: 0.85,
  guitarFloorHz: 34.7,
  guitarCeilingHz: 185,
  guitarScoopHz: 580,
  guitarScoopQ: 1.2,
  guitarScoopDb: -6,
  guitarCabLowpassHz: 4800,
  guitarSubAmount: 0.35,
  guitarDetuneCents: 6,
  // Multiplies the derived per-step chug length (main.js computes the
  // real seconds from the live pulse rate/subdivision, never a fixed ms,
  // and passes it in) -- 1.0 is a TRUE no-op identity, same "off means
  // off" discipline buildSaturationCurve's own amount=0 already follows.
  guitarChugTightness: 1,
  guitarChugAttackFraction: 0.04,
  // The two-stage percussive envelope's own choke -- see playGuitarChug's
  // own comment. 1.0 would be a true no-op (no choke at all, the old
  // single-decay shape); the factory default genuinely chokes.
  guitarChokeAmount: 0.18,
  guitarChokeFraction: 0.12,
  guitarDuckAmount: 0.3,
  guitarDuckPulseFraction: 0.25,
  // The real sidechain the owner asked for, in the direction that
  // actually serves "chug and hypnotic, powerful force": the DRONE ducks
  // for the GUITAR (see _duckDroneForGuitar), not the reverse -- every
  // real chug briefly makes room for itself in the shared low end, then
  // the drone swells back. Same shape as guitarDuckAmount/PulseFraction,
  // just naming which voice the duck lives on.
  // REVISED after a real measured headroom check: at 0.35, the duck
  // window (a fraction of one chug's own short duration) fully released
  // well before the NEXT chug at djent-speed subdivision, so the drone
  // spent most of a busy passage back at its full resting level anyway --
  // the sidechain only ever shaved the instant of each individual hit,
  // never the sustained passage. Real sidechain compression sets its
  // release close to the rhythmic INTERVAL it's ducking against (the
  // "pumping" effect), not just the transient -- raised so the duck
  // window approaches a full chug-length gap, keeping the low end
  // genuinely handed to the guitar for the length of a busy passage, not
  // flickering per hit. Depth raised to match.
  droneDuckAmount: 0.55,
  droneDuckPulseFraction: 0.85,
};

// Defaults exported so a "factory default" preset can always be reconstructed
// (see timbrePresets.js) without duplicating these numbers a second time.
export const DEFAULT_NOTE_PARAMS = {
  attackMs: 26,
  lowpassHz: 4910,
  lowpassQ: 2.75,
  bodyHz: 210,
  bodyQ: 6.1,
  bodyAmountDb: 16,
  pluckAmount: 0.82,
  pluckMs: 80,
  // The kalimba's own authored register -- see foldIntoRange, applied in
  // playNote. Defaults to this voice's real current span (110-830.6Hz
  // across the three rings) so factory default is a no-op; exposed so the
  // two melodic instruments' ranges can be pushed apart from each other by
  // ear, not just the flute's alone.
  floorHz: 110,
  ceilingHz: 831,
};

// The resultant-rhythm engine's own kick/snare/hat recipe -- previously
// inline literals in playPercussionHit's own three branches, promoted
// into a real params object (same "factory default reconstructable, live-
// tunable" treatment DEFAULT_NOTE_PARAMS already got) so timbre can be
// authored as named kits (see main.js's PERCUSSION_KIT_PRESETS) instead
// of a single hardcoded recipe. Values below reproduce that exact recipe
// -- the "Acoustic" kit -- so this promotion changes nothing on its own.
export const DEFAULT_PERCUSSION_PARAMS = {
  // given (slowest ring) = kick: a sine sweeping down fast plus a brief
  // lowpassed noise click for the beater attack.
  kickFreqStart: 150,
  kickFreqEnd: 50,
  kickSweepMs: 40,
  kickGain: 1.4,
  kickDecayMs: 220,
  kickClickGain: 0.6,
  kickClickLowpassHz: 1400,
  kickClickDecayMs: 15,
  // received (middle ring) = snare: two detuned tone oscillators for
  // body, plus bandpassed noise for the rattle.
  snareToneHz1: 180,
  snareToneHz2: 330,
  snareToneGain1: 0.5,
  snareToneGain2: 0.35,
  snareToneDecayMs: 90,
  snareNoiseBandHz: 1800,
  snareNoiseQ: 0.8,
  snareNoiseGain: 0.55,
  snareNoiseDecayMs: 90,
  // made (fastest ring) = hat: a short, high, fast-decaying highpassed
  // noise burst.
  hatHighpassHz: 6000,
  hatGain: 0.35,
  hatDecayMs: 30,
};

// Every knob the drone's voice touches -- "all the levers," not just the
// ones already fought over. Grouped in the UI (index.html) but flat here:
// levels (just busGain now -- givenGain/receivedGain/madeGain retired
// along with the three-simultaneous-voice chord they used to balance, see
// setDroneVoices's own header comment), movement (breathing/vibrato, the
// two "should be MOVING" dimensions), formant (the talk-box vowel shaping,
// "should be AURAL"), and filter/bass (the slow sweep + low-end weight).
export const DEFAULT_DRONE_PARAMS = {
  busGain: 0.2,
  // Breathing/vibrato/sweep rates are DERIVED, not free-floating Hz --
  // "adjust any Hz-based rates to become derived rates based on their
  // respective driven/associated ring and the given procession rate."
  // Each is now a musical SUBDIVISION of a pulse rate (this ring's own, or
  // the master's, for the one shared/bus-wide mover) rather than an
  // absolute frequency nothing else in the engine agrees with -- freeze
  // the procession and these freeze with it, exactly as a tempo-locked
  // instrument should. See OrphographAudio.setProcessionPulseRate.
  breathPulsesPerCycle: 24,   // this ring's own voice breathes once every N of ITS pulses
  breathDepth: 0.15,
  vibratoCyclesPerPulse: 0.5,  // vibrato wobbles N times per THIS ring's own pulse
  vibratoCents: 34,
  breathNoiseGain: 0.07,
  // "Piercing... like a car horn." Root cause, measured directly: Q=18 on
  // a FIXED, unmodulated 570Hz bandpass is an unusually narrow, sharp
  // resonant spike (typical vocal-formant Q sits 5-15; a static, this-
  // narrow peak reads as nasal/honky rather than a moving vocal-tract
  // color) -- the single most identifiable "car horn" cause in the whole
  // chain, independent of anything the flute itself does. Widened to a
  // softer, more vowel-like resonance; formantBlendGain lowered
  // proportionally so the now-broader (louder-sounding) peaks don't just
  // reintroduce the same edge at a wider bandwidth.
  formantF1Q: 5,
  formantF2Q: 4.5,
  formantBlendGain: 1.3,
  // "The bass drone's own spectral richness is being filtered out
  // downstream: moveFilter sits AFTER the formant pair and attenuates the
  // 570/950Hz formant peaks by ~14-22dB (up to ~36dB at the sweep's
  // bottom), and partials 12-16 by 10-15dB -- actively working against a
  // richer/rougher drone, independent of any roughness mechanism." Real
  // bug, not just a taste call: 260Hz (sweeping down to 120Hz) sat well
  // below both formants and the upper partials that give the new
  // saturation/subharmonic below something real to shape. Raised so the
  // filter's OWN "moving" character survives (still a real sweep, still
  // audible motion) without gating away the content underneath it.
  moveFilterHz: 200,
  moveFilterPulsesPerCycle: 192, // shared/bus-wide sweep: one full cycle every N MASTER pulses
  moveFilterDepthHz: 150,
  bassBoostHz: 205,
  bassBoostDb: 12,
  // "The low frequency drones should be given more didgeridoo-like
  // qualities -- the rough and shaped overtones." Real gap, not a tuning
  // problem: neither the drone nor the flute's growl had ANY mechanism
  // capable of generating new harmonic content (a bandpass EQ bump, growl's
  // whole previous story, can only emphasize what's already there). Two
  // real ingredients now, same two-lever pattern as everywhere else in
  // this file:
  //   - droneSubharmonicAmount -- a genuine sub-octave oscillator (the
  //     fundamental/2), the actual vocal-fry/kargyraa mechanism (the
  //     ventricular folds vibrating at HALF the vocal folds' rate), not an
  //     invented "sub bass" layer.
  //   - droneSaturationAmount -- soft-clip (tanh) waveshaping on the
  //     tonal stack (see buildSaturationCurve), applied BEFORE moveFilter
  //     so the now-fixed, wider filter above actually shapes the richer
  //     spectrum instead of deleting it.
  droneSubharmonicAmount: 0.3,
  droneSaturationAmount: 0.25,

  // "Moving all the growl effects to the drone to turn the drone into a
  // more singular didgeridoo layer, giving the flute more of its own
  // dedicated register and character, stopping them from stepping on each
  // other's toes." Relocated wholesale from the flute (where these lived
  // as whistleGrowl*/whistleThroat* -- see git history) -- both were
  // modeled ON the drone's own formant/saturation recipe in the first
  // place (see the comments on formantF1Q/droneSaturationAmount above),
  // so this actually DELIVERS the drone's own stated tone target ("a
  // hybrid between an organ and a talk-box vocoder -- a pipe organ of
  // didgeridoos," see README) for the first time rather than just moving
  // distortion around. See setDroneVoices for the node chain (taps
  // ringGain, sums into bus, same relative position droneSaturator holds)
  // and pulseDrone for the per-hit accent gate (the drone has no per-note
  // pitch change to gate off of the way the flute's meanderFlute did).
  //
  // Real bug fixed in the move: the old whistleGrowlWanderDepth (155Hz) on
  // an F1 centered at 90Hz drove the band's frequency negative for part of
  // every wander cycle -- not genuinely symmetric wander. droneGrowlF1Hz
  // raised to 110 and the depth brought inside it (35Hz) so the wander
  // actually swings symmetrically around its own center now.
  droneGrowlAmount: 0.32,
  droneGrowlF1Hz: 110,
  droneGrowlF2Hz: 580,
  droneGrowlQ: 2.2,
  // "Meandering fry layer of drone" -- a small, deliberate bump to both
  // the wander (slower, wider -- more genuinely meandering rather than a
  // quick wobble) and the saturation (a touch more roughness/fry
  // character), while staying well inside the real, already-established
  // "swings symmetrically around droneGrowlF1Hz without going negative"
  // safety margin (110 - 40 = 70, still comfortably positive) -- a
  // tuning nudge, not a new mechanism. 40, not some other nearby number,
  // because the UI slider's own step (5) must evenly divide it -- the
  // known "silently snaps on load" bug class this project has hit twice
  // before.
  droneGrowlWanderHz: 0.28,
  droneGrowlWanderDepth: 40,
  droneGrowlSaturationAmount: 0.19,
  // "I'd like our instrument to be able to reach from the lowest ranges of
  // guttural human throat singing... to a comfortable male singing range."
  // The synthesized "throat voice" (see THROAT_HARMONICS) -- amount is the
  // voice itself (the same additive-stack idea as DRONE_HARMONICS, just
  // throatier); subharmonicAmount is the actual kargyraa mechanism (the
  // ventricular folds vibrating at HALF the vocal folds' rate). Now pitched
  // off the drone's own fixed baseHz (it has no per-note register to
  // crossfade against the way the flute did) and gated by pulseDrone's own
  // per-hit accent.
  droneThroatAmount: 0.94,
  droneThroatSubharmonicAmount: 0.45,

  // Triatonic flute, phase 10 -- REBUILT again, this time on the simpler,
  // well-established pattern real flute-style synth patches actually use:
  // a clean oscillator core for pitch (inherently stable, no feedback
  // loop, no runaway possible) plus a separate, genuinely SUBORDINATE
  // breath-noise layer -- instead of trying to make a pitch EMERGE from
  // noise via a self-oscillating resonant delay loop. "Too much noise and
  // grit... sounds way too much like an overdriven synth than a flute...
  // too many levers and no cohesive approach" -- diagnosed as the wrong
  // archetype, not a tuning problem: a comb filter fed by broadband noise
  // is a real, recognizable timbre (flangers, phasers, "resonant filtered
  // noise" synth patches), just not a flute's. Real flute tone is the
  // opposite balance -- a very pure, high-Q, nearly sine-like resonance
  // (real air columns have very low intrinsic loss) with a comparatively
  // quiet, largely un-pitched hiss riding on top, not noise that became a
  // pitch. Dropped entirely: the delay/feedback loop, its damping filter,
  // the in-loop saturator, and the dedicated limiter/safety-clip stage
  // that existed only to keep that loop from running away -- none of that
  // machinery is needed once there's no self-oscillating system to manage.
  //
  // harmonic/Min/Max still set WHICH harmonic of the ring's own
  // fundamental is the target pitch (manual/fallback vs. wheel-following
  // range). glideMs no longer means "portamento" -- "there shouldn't be
  // note lerp on a flute... the pitch bend is working against us too." A
  // continuous slide between EVERY note is one of the single most
  // recognizable synth-LEAD cues there is (Minimoog-style "glide"), and
  // it directly contradicts real flute articulation: a player changes
  // fingering and the new pitch sounds cleanly, it doesn't slide there.
  // It was also a real contributor to "flat and spacey" -- a pitch that's
  // always smoothly in motion never actually lands anywhere. Cut from
  // 500ms to 20ms -- just enough to avoid a hard digital click at the
  // transition, nowhere near long enough to be heard as a bend. The
  // "narrative, meandering" quality this used to carry belongs to
  // sustain/vibrato/breath now, not to an audible slide between pitches.
  //
  // "The highest register is far too high pitched to be pleasant -- I'd
  // like them to basically be emulating a standard vocal register." A
  // real, checkable bug in the range, not a taste call: at the OLD
  // default (8-32), made ring's own top end was baseHz(~39) x RING_RATIO
  // (2) x 32 = ~2490Hz -- past even an extreme high soprano (~1046Hz) and
  // into whistle-register territory. The 8-32 range was inherited from an
  // "overtone singing" framing (which harmonic of a very low fundamental)
  // that was never re-checked against an actual vocal-register target.
  //
  // "The harmonic range is only allowing either a dull range or one that
  // reaches into undesired, shrill territory -- this value range isn't
  // giving us any meaningful control." A second, real bug in the SAME
  // parameter, introduced later: the 4-12 fix above was only ever checked
  // against the UNISON (1x) cluster layer. Phases 13-15 then added the
  // octave-registration cluster (0.5x-2x, a 4x/2-octave spread around
  // whatever the harmonic knob points to) on top of it -- so the range
  // that actually reaches the ear is 2 octaves WIDER than what "vocal
  // register" checked, on both ends at once. The Min-Max sweep itself
  // (4-12 is already a 3x/1.585-octave span) then compounds with that
  // spread and with RING_RATIO (1x-2x, another octave): sweeping the knob
  // barely has to move before the low end is sub-150Hz mud and the high
  // end is a 2x-layer well past soprano -- there's no real span left in
  // the middle to control. The register check was correct when made; it
  // went stale the moment the cluster feature multiplied the SAME axis it
  // was validated on, and was never rechecked. Narrowed to 6-9 (a span of
  // 1.5x -- the SAME root-fifth-octave ratio this whole engine already
  // reuses at the ring and cluster level, "wheels within wheels" a third
  // time, not an arbitrary tightening) so the full cluster+ring spread,
  // not just the unison layer, lands in 117-1400Hz across all three
  // rings -- a real alto/tenor-to-soprano-extreme band, with the harmonic
  // knob's own sweep now a controllable fraction of it instead of most of
  // it. whistleManualRatio (manual/fallback pitch, whistle-follow off) is
  // a plain ratio-of-root, not a harmonic index -- see its own comment
  // below, near the native voicing engine's own tunable.
  whistleManualRatio: 1,
  // The native chord-voicing engine's one real lever (see src/voicing.js
  // and the "native chord-voicing engine" plan) -- how many spokes of
  // arc-distance from a chord's root earn that voice one more octave out.
  // Defaults to 2 (12 spokes / 6, the Timaeus proportion's own smallest
  // member -- not a freehand pick, the same 6:8:12 ratio already governing
  // ring speed, one level down). Lower = voices spread out faster (an
  // "open," wide-register instrument); higher = voices stay clustered
  // near the root longer (a "closed," tight-register one).
  whistleVoicingArcSpokesPerOctave: DEFAULT_ARC_SPOKES_PER_OCTAVE,
  // "I don't want the spacey, high pitched flute sound. The kalimba covers
  // the high pitched melodic notes, I want the flute drones to stay below a
  // more contained ceiling to keep it from becoming shrill/whistly." The
  // real bug this traced to: ring register (0.5x-2x), harmonic (6-9),
  // voicing ratio (up to 2x), and transposition (up to 1.8877x) all stack
  // with no shared limit -- the flute could reach 2637Hz on a made-ring hit
  // under transposition, 1.7 octaves above the kalimba's own ceiling, and
  // at that extreme it was also pitch-shifting a mid-register flute sample
  // by 4+ octaves (see FLUTE_SAMPLES/_pickFluteSample), which is what
  // actually reads as thin/whistly. See foldIntoRange -- the whole voice
  // (every voicing layer together, so the chord shape survives; the
  // throat voice has since moved to the bass drone and no longer folds
  // with this) folds by octaves into [floor, ceiling] instead.
  // Raised from 30 -- with growl/throat now living on the drone (see
  // DEFAULT_DRONE_PARAMS' droneGrowl*/droneThroat* block), the sub-140Hz
  // territory is exclusively the drone's (its fundamental sits ~39Hz, its
  // relocated growl centers ~110Hz). Vacating it stops the flute's own
  // fold logic from reaching down into what's now clearly drone space --
  // "giving the flute its own dedicated register."
  whistleFloorHz: 140,
  whistleCeilingHz: 436,
  // "RING_OCTAVE_MULTIPLIER no longer differentiates the flute's register
  // across rings" -- see _fluteTargetHz's own comment for the measured
  // "why" (the fold's own valid-shift window has ~0.008 octaves of real
  // slack per octave under default settings -- nowhere near enough for
  // shift-selection alone to restore audible separation). This is that
  // fix's own knob: given folds this many octaves LOWER, made this many
  // HIGHER, before the shared fold/clamp ever runs -- so it can never
  // push a layer outside whistleFloorHz/CeilingHz either.
  whistleRingRegisterBias: 0.3,
  whistleGlideMs: 5,
  // A small, fixed spread BETWEEN this ring's own cluster voices (real
  // independent pipes don't land on the exact same cent) -- see
  // buildFluteToneLayer's per-voice detune. Used to be within one voice's
  // own oscillator pair, back when the tone core was oscillators; a real
  // sample doesn't need synthetic shimmer to sound alive the way a pure
  // sine did, so this moved one level up instead of disappearing.
  whistleDetuneCents: 13.5,

  // Tone core: see buildFluteToneLayer -- a real recorded flute note
  // (assets/samples/flute-note-c4.mp3), pitch-shifted via playbackRate,
  // not an additive oscillator stack (phases 9-23 built and refined one;
  // "is this a common issue... is there a free asset" -- README phase 24
  // has the full "why" a real sample replaced it entirely). whistleAmount
  // is the MASTER flute level -- every voice this._whistleActiveVoices
  // computes (see meanderFlute/voiceWord) scales relative to it.
  whistleAmount: 0.4,

  // whistleVoicing (a fixed, hand-authored {ratio, level} chord table) is
  // RETIRED -- "the whole voicing layer is [arbitrary]," picked for being
  // an established jazz/organ-registration convention, not for any tie to
  // the wheel's own geometry. Replaced by the native chord-voicing engine
  // (src/voicing.js): every word's own real letters compute their OWN
  // {ratio, level} voices live, from spoke arc-distance and the mirror/
  // rotate transform vocabulary already governing this piece at every
  // other scale -- see meanderFlute and this._whistleActiveVoices. Nothing
  // left to author here; the "next chord shape" is now the next word
  // typed, not a data edit.

  // "More tailored control over modal arrangement" -- see
  // DEFAULT_FLUTE_SCALE_SEMITONES/quantizeFluteHz above for the full
  // "why" (phase 26's shared-scale consonance fix). The scale itself is
  // now authored data, same treatment as whistleVoicing: a plain list of
  // semitone offsets from the drone's own root, editable as text with
  // real named-mode presets (major/minor pentatonic, the seven church
  // modes, whole tone, chromatic) as starting points. Default kept at
  // major pentatonic -- the phase-26 fix this became -- so nothing
  // changes on its own.
  whistleScale: [0, 2, 4, 7, 9],

  // "Lacking any sort of woodwind/blown-instrument character... the
  // breath/noise aspect is just static." Three real, missing acoustic
  // ingredients, not a vague polish pass:
  //
  //   1. Vibrato. Real woodwind players drive a continuous, coupled
  //      pitch+amplitude wobble from breath pressure (~5Hz is typical) --
  //      one of the single strongest "this is a living, blown instrument"
  //      cues, and the flute had none of its own (the main drone voice's
  //      vibrato never reached it). A shared LFO (one mechanism, felt by
  //      all three rings together -- the same "one instrument" reasoning
  //      as the breath source below), each ring depth-scaled.
  //   2. Noise COLOR. WHITE noise (flat spectrum) is literally what
  //      static/hiss is; real breath/wind is much closer to PINK noise
  //      (energy falls off ~3dB/octave) -- the standard, well-documented
  //      choice for natural-sounding air/wind/breath texture, specifically
  //      because white noise reads as electronic and pink noise reads as
  //      organic. See _pinkNoiseBuffer.
  //   3. Chiff. Real breath noise BRIGHTENS momentarily at the attack
  //      (more turbulence right as a note is re-tongued) and settles to a
  //      duller steady hiss -- a real hit already bumps breath LOUDNESS
  //      (whistleBreathSurgeAmount); it never changed the noise's own
  //      brightness, so articulation never read as breath-driven. A
  //      per-ring lowpass on the breath layer (whistleBreathColorRatio
  //      sets its steady-state cutoff, as a multiple of THIS ring's own
  //      current pitch -- see there) that also briefly opens up on a real
  //      hit (whistleChiffAmount), decaying back over the SAME note-gate
  //      window (see whistleArticulationPulseFraction below) as the
  //      loudness bump.
  // Slowed from an operatic-ish 3.8Hz -- part of the "more spectral,
  // Tibetan monastery" retuning: a slower, wider sway reads as a singing
  // bowl's own natural beat-frequency drift, where the old rate read as a
  // more nervous, vocal-tremor wobble. Depth raised slightly so the
  // slower rate doesn't just feel inert.
  whistleVibratoRateHz: 2.1,
  whistleVibratoCents: 16,     // pitch depth
  whistleVibratoAmpDepth: 0.09, // amplitude depth, as a fraction of tone level -- real breath vibrato couples both
  // "Still just a keyboard pad that sounds more or less spacey with the
  // wavering vibratos -- not a flute at all." Root cause, historically: ALL
  // THREE rings shared the exact same vibrato oscillator -- one signal,
  // phase-and-frequency-locked, felt identically by all 12 tone-cores at
  // once, the literal textbook definition of a chorus/ensemble pad effect.
  // The fix at the time gave each ring its own independently-offset
  // vibrato LFO (whistleVibratoRingSpreadPercent, now retired along with
  // it) -- moot now that there's genuinely only ONE flute voice ("one
  // meandering flute narrative"): a single shared LFO is no longer three
  // voices locked in a chorus, it's just the one voice's own vibrato.

  // Breath -- a separate, genuinely SUBORDINATE noise layer, not the
  // excitation of a resonator. One shared pink-noise bed (not white --
  // see above), leveled independently per ring. Default kept low on
  // purpose -- this is texture riding on top of the tone, not competing
  // with it for presence.
  whistleBreathAmount: 0.21,
  // "The breath dimension is just noise/static that I try to minimize --
  // it doesn't sound good." Root cause, checked directly: this used to be
  // ONE fixed absolute Hz (2200), identical for all three rings regardless
  // of what pitch they were actually playing -- given's ~250Hz tone and
  // made's ~650Hz tone got the EXACT same noise color. Real breath/edge-
  // tone turbulence is shaped by the SAME resonating air column as the
  // pitch -- it isn't a generic hiss bed sitting underneath the note, it's
  // audibly THIS note's own breath, brighter for a high note, duller for a
  // low one. A fixed color regardless of register is exactly what reads
  // as disconnected "static" rather than "this pipe's own air": nothing
  // about it ever related to what was actually sounding. Now a RATIO of
  // this ring's own current fundamental (clamped to a sane 400-8000Hz
  // band) instead of an absolute number -- the noise's own brightness
  // rises and falls with the note the same way a real player's does,
  // recomputed on every real hit (meanderFlute) and root change, not just
  // set once. NOT swept by anything periodic beyond that (still no
  // "Welcome to the Machine" resonant-filter LFO-sweep) -- only ever moved
  // by pitch itself and the one-shot chiff envelope below.
  whistleBreathColorRatio: 9.6,
  // "Breath renews here" -- a real hit still means something distinct
  // from the steady sustain: a brief breath bump (more air, momentarily)
  // AND a brief brightening (more turbulence, momentarily) together,
  // both decaying back to steady over the same derived note-gate window
  // (see whistleArticulationPulseFraction below) as the tone's own gate.
  // "Piercing... like a car horn, theremin parlor demon conjuration
  // horror, the opposite of meditative." Measured cause: at the old
  // values, EVERY note change compounded three simultaneous overshoots
  // above the steady level -- tone +50% (whistleArticulationAmount, see
  // below), breath loudness +94% (this param), and breath brightness
  // more than DOUBLING (whistleChiffAmount) -- all landing at once, on
  // top of a hard (unramped) filter-cutoff jump (see the chiff code in
  // meanderFlute, now a short ramp instead of an instant step). That's a
  // real transient spike, not a taste call -- reads as a percussive
  // "honk" on every single articulation, working directly against a
  // breathy, sustained monastery-drone feel. Gentled well below the old
  // ceiling.
  whistleBreathSurgeAmount: 0.3,
  whistleChiffAmount: 0.35, // how far the breath color opens up on a real hit, as a multiple of its own pitch-tracked base
  // "The note transitions still sound like a synth, not a flute changing
  // notes... there needs to be some kind of note envelope/gate per voice
  // that allows seamless droning while a single tone is allowed to
  // organically change notes with a proper flute-note-change sound
  // profile." Root cause: a real flute doesn't retune in place -- a
  // player's tongue briefly stops the whole air column BETWEEN notes
  // (the same physical interruption hits the pitched tone and the breath
  // noise together, real coupling, not a separate effect), which is also
  // what hides the fingering change's own brief instability. Everything
  // above (the short glide, the surge/chiff swell) only ever made the
  // tone swell UP at a hit; it never dipped first, so the tone never
  // actually stopped speaking between notes -- which is exactly what
  // reads as "synth retuning a drone" instead of "instrument re-
  // articulating." whistleNoteGateDipAmount is how far the tone (and
  // breath, together) duck before the new pitch and the attack -- 0 is
  // the old smooth-retune behavior, higher is a more clearly tongued gap.
  // Pulled back from a near-total (0.84 -> 16% remaining) dip -- that's a
  // hard synth-gate stutter, not a monk's breath between phrases; a
  // gentler dip reads as a smooth swell/glide, closer to a singing bowl's
  // own continuous sustain, while still audibly re-articulating.
  whistleNoteGateDipAmount: 0.45,
  // "As many of our parameters as possible should derive/infer timing
  // from the wheel/input/transform state itself, rather than apply
  // arbitrary values." whistleBreathSurgeMs (a fixed 180ms) was exactly
  // that -- a magic number with no relationship to how fast the wheel is
  // actually moving. Replaced with a FRACTION of the hit ring's own
  // current pulse duration (1 / (masterPulsesPerSecond x
  // ringSpeedMultiplier), the same derived quantity setProcessionPulseRate
  // already computes for breath/vibrato rate): the whole note-change
  // gate (dip + attack + decay) now takes a slice of however long this
  // ring's own pulse currently lasts, so a fast procession gets snappy,
  // tongued transitions and a slow one gets more relaxed, breathy ones --
  // note-change speed scales with tempo the way a real player's does,
  // instead of being fixed regardless of how fast the piece is moving.
  whistleArticulationPulseFraction: 0.34,

  // "It just sounds like an organ patch on a keyboard." Root-caused, not
  // another guess: a stack of sine harmonics at fixed ratios, doubled
  // across octaves, isn't just SIMILAR to a drawbar/Hammond organ -- it
  // IS one, structurally. That's what "organ" actually names here. The
  // real missing ingredient a drawbar organ can never have: in a real
  // wind instrument, the breath noise and the tone AREN'T two independent
  // layers -- they're the same physical event. Breath pressure fluctuates
  // ONCE, and it moves the tone's amplitude/brightness and the noise's
  // amplitude TOGETHER, correlated. Vibrato (tone-only) and turbulence
  // (breath-only) were built as two separate, independently-modulated
  // subsystems -- exactly the clean separation an organ has (drawbars
  // don't breathe) and a wind instrument doesn't. These two couple them
  // for real, using the SAME sources already built rather than adding new
  // parallel machinery:
  //   - whistleBreathToneCoupling: the irregular turbulence wander (an
  //     internal, noise-driven source -- no longer directly user-exposed,
  //     since phase 26 removed its OWN breath-level tap for being one
  //     unpredictable modulation too many; see _applyFluteBreathLevel)
  //     still nudges the tone's own amplitude and brightness, scaled down.
  //   - whistleArticulationAmount: a real hit already swells breath
  //     loudness (whistleBreathSurgeAmount) and brightness
  //     (whistleChiffAmount); this makes it ALSO swell the TONE's own
  //     presence, over the same derived note-gate window (see
  //     whistleArticulationPulseFraction) -- "breath renews here" now
  //     means the tone re-articulates along with the noise, not just the
  //     noise alone.
  whistleBreathToneCoupling: 0.5,
  // Part of the same compounded-transient fix as whistleBreathSurgeAmount/
  // whistleChiffAmount above -- was pushing the tone itself to 1.5x on
  // every note change, right alongside the other two. Gentled together.
  whistleArticulationAmount: 0.18,

  // "The entire sound profile still reads as a digital pipe organ. We're
  // not getting anywhere like this." Every fix through phase 17 modulated
  // things AROUND a fixed core -- vibrato, chiff, wander, the note-gate --
  // but the core itself never changed: the (then-additive) tone's own
  // upper-harmonic mix was a STATIC recipe, the same regardless of how the
  // piece was being played. That IS the actual defining difference an
  // organ pipe has from a wind instrument, more than any of the textures
  // added so far: an organ pipe has no velocity/dynamics at all -- press
  // the key hard or soft, the SAME fixed pipe geometry speaks, every time,
  // forever. A real wind player's breath pressure constantly varies the
  // tone's own upper-harmonic content and breath noise together -- play
  // calm and it's pure/sine-like, play energetically and it gets brighter
  // and airier. Every earlier "breath" fix rode on top of the harmonic
  // stack without ever touching its actual balance; this is what finally
  // does.
  //
  // "As many parameters as possible should derive/infer timing or
  // harmonic information from the wheel/input/transform state itself" --
  // this is exactly a HARMONIC quantity that should derive from real
  // state, and the wheel already has an obvious analog for "how
  // energetically is this being played": the procession's own current
  // pace. A faster pace reads as more urgent/energetic performance
  // (brighter, breathier); a slower one as calmer (purer, quieter upper
  // partials) -- continuously, not just at note-hits, the same way real
  // breath pressure never actually holds still either. whistleToneColorRatio
  // (below -- phase 24 replaced the additive harmonic-partial mix this
  // used to rebalance with a pitch-tracked tone-color lowpass instead,
  // once a real sample meant there was no partial mix left to rebalance)
  // and whistleBreathAmount become this ring's OWN current baseline (at
  // whistleBrightnessReferencePps, a "moderate" pace), scaled by
  // whistleBrightnessTempoSensitivity as the ring's own live pulse rate
  // moves away from that reference -- reusing setProcessionPulseRate,
  // the same tick that already retargets breath/vibrato rate live.
  whistleBrightnessTempoSensitivity: 2.8,
  whistleBrightnessReferencePps: 2,
  // Baseline tone-color lowpass cutoff, as a multiple of whatever pitch
  // THIS layer is currently playing (same pitch-tracking idea as
  // whistleBreathColorRatio) -- generous enough by default to let the
  // sample's own natural character through unfiltered at neutral
  // brightness (1x), since the point is dynamic movement on top of a real
  // recording, not muffling it.
  whistleToneColorRatio: 3.5,

  // The ONE voice's own FIXED chamber (see buildFluteChamberBank/setChamberRoot)
  // -- the physically-correct counterpart to whistleToneColorRatio above:
  // that filter tracks every note's pitch (the instrument's excitation
  // brightness, which legitimately varies with breath/tempo); this bank
  // deliberately does NOT -- it only moves when the phrase's own derived
  // root changes ("a different flute for this key"). amountDb sets mode 1's
  // peak (higher modes roll off as amountDb/n, a real pipe's own falloff);
  // modes picks how many of the fixed 6 slots are actually active; pipe
  // chooses which harmonic series a real pipe of that construction speaks --
  // "open" (transverse flute, every harmonic) or "stopped" (a capped/drone
  // pipe, odd harmonics only, the hollower character).
  whistleChamberAmountDb: 5,
  whistleChamberQ: 1.4,
  whistleChamberModes: 3,
  whistleChamberPipe: "open",

  // Wooden-flute-drone (high register) -- modeled on the bass drone's own
  // voiceLfo/breathPulsesPerCycle: a per-ring LFO breathing the ring's own
  // gain on a multi-second, pulse-derived cycle, independent of any note
  // event -- the "continuous life" the flute never had of its own. Growl
  // and the throat voice (the low-register half of this same "missing a
  // drone in itself" idea) have both since moved to the ACTUAL bass drone
  // -- see droneGrowl*/droneThroat* above -- since the flute now has its
  // own dedicated register instead of crossfading between two borrowed
  // vocal-tract mechanisms.
  whistleDroneWaveCyclesPerRingPulse: 2,
  whistleDroneWaveDepth: 0.26,

  // "A big box" -- one shared resonant peak the pipe speaks into, same
  // bodyHz/bodyQ/bodyAmountDb idea the note voice already uses for its own
  // wood-body resonance. Moved from 189 (nearly coincident with the bass
  // drone's own bassBoostHz: 205 peak) to 340 -- a brighter, airier
  // register clear of both the drone's bass emphasis and its relocated
  // growl, more typical of a real wooden flute's own body resonance.
  whistleBoxHz: 340,
  whistleBoxQ: 1.9,
  whistleBoxAmountDb: 3,

  // A single sustained "pedal" voice among the flute's own chord (see
  // meanderFlute) that holds the phrase's root continuously instead of
  // retuning/re-articulating on every real hit -- "the ability for one
  // note to flourish/change while the rest of the instrument drones
  // continuously." level sets how present it is under the lead voice;
  // glideMs governs how slowly it slides to a NEW root when the phrase's
  // root actually changes (deliberately much slower than whistleGlideMs --
  // a held drone shouldn't snap to a new pitch).
  whistlePedalLevel: 0.55,
  whistlePedalGlideMs: 600,

  // "Something that gives drone/poly flutes their distinct character is
  // the flourishes on note changes." Real players' breath leads the
  // embouchure settling on a new pitch, not the other way around -- today
  // the breath surge/chiff peak at the SAME moment the pitch retune
  // begins (see meanderFlute). This retimes just the breath-related
  // envelopes to peak first, as a fraction of the per-hit gate window
  // (gateSec), safely inside the existing dip fraction (0.25) so the huff
  // genuinely arrives before the pitch starts moving.
  whistleBreathLeadFraction: 0.15,
};

// See this._whistleActiveVoices (meanderFlute/src/voicing.js) -- a FIXED
// number of voice slots are always built (never created/destroyed while
// the drone runs), so a new word's own realized voicing is always just
// retuning/relevelling existing oscillators -- the same live-update path
// every other flute param already uses -- rather than a live audio-graph
// rebuild with its own click/glitch risk. Slots beyond however many
// voices the current word actually needs sit at level 0 (silent,
// negligible CPU for a few idle sine oscillators).
export const WHISTLE_MAX_VOICES = 6;
// A silent placeholder for any slot this._whistleActiveVoices doesn't
// fill.
const WHISTLE_EMPTY_VOICE = { ratio: 1, level: 0 };

// Same fixed-slot-count precedent as WHISTLE_MAX_VOICES, applied to the
// chamber resonator bank below -- a real pipe has a handful of audible
// modes before losses dominate, so 6 peaking filters (most left at 0dB,
// see whistleChamberModes) covers any authored mode count without ever
// creating/destroying nodes while the drone runs.
const FLUTE_CHAMBER_MAX_MODES = 6;

// One tone layer -- a real recorded flute note (see FLUTE_SAMPLES/
// _loadRealFluteNoteBuffer/_pickFluteSample), pitch-shifted via playbackRate
// to layerHz, instead of the additive oscillator stack every earlier phase
// used ("is this a common issue... is there a free asset" -- README phase 24
// has the full "why"). `sample` is the CHOSEN entry (nearest available base
// pitch to layerHz, picked once by the caller -- see _pickFluteSample) plus
// its decoded buffer; picked once per layer at construction/rebuild time,
// never re-picked mid-note (a real player doesn't swap instruments between
// notes either). Falls back to a silent placeholder if no real sample has
// loaded yet (a narrow startup race -- self-heals once one has). Real
// breath-pressure vibrato couples pitch (source.detune) AND amplitude
// (toneGain.gain), same as before; a per-layer tone-color lowpass (pitch-
// tracked, brightness-driven -- see whistleToneColorRatio) is the
// brightness-follows-tempo analog now that there's no separate harmonic-
// partial mix left to rebalance; breath-tone wander coupling and the
// note-gate articulation stage are otherwise unchanged. octaveMult/
// levelScale/sampleBaseHz are kept on the returned object (octaveMult/
// levelScale are later MUTATED by _applyWhistleVoicesToLayers, every real
// word hit; sampleBaseHz is read by every later playbackRate retune so it
// always divides by the SAME sample this layer actually holds).
function buildFluteToneLayer(ctx, dp, octaveMult, levelScale, layerHz, vibratoLfo, wanderLowpass, sample, voiceIndex) {
  const toneGain = ctx.createGain();
  toneGain.gain.value = dp.whistleAmount * levelScale;

  const source = ctx.createBufferSource();
  source.buffer = sample.buffer;
  if (sample.buffer.duration > sample.loopEnd) {
    source.loop = true;
    source.loopStart = sample.loopStart;
    source.loopEnd = sample.loopEnd;
  } else {
    source.loop = true; // placeholder buffer -- loop the whole (tiny) thing
  }
  source.playbackRate.value = layerHz / sample.baseHz;
  // A small, fixed, honest per-voice detune spread -- real independent
  // cluster voices don't land on the exact same cent. Alternating sign by
  // slot index makes it a real spread, not a drift.
  source.detune.value = (voiceIndex % 2 === 0 ? -1 : 1) * (dp.whistleDetuneCents / 2);
  source.connect(toneGain);
  source.start();

  const vibratoPitchDepth = ctx.createGain();
  vibratoPitchDepth.gain.value = dp.whistleVibratoCents;
  vibratoLfo.connect(vibratoPitchDepth);
  vibratoPitchDepth.connect(source.detune);
  const vibratoAmpDepth = ctx.createGain();
  vibratoAmpDepth.gain.value = dp.whistleAmount * levelScale * dp.whistleVibratoAmpDepth;
  vibratoLfo.connect(vibratoAmpDepth);
  vibratoAmpDepth.connect(toneGain.gain);

  // Tone color -- the brightness-follows-tempo analog (phase 18) now that
  // there's no separate harmonic-partial mix to rebalance: a gentle,
  // pitch-tracked lowpass (same idea as the breath color filter),
  // opened/closed by _updateFluteBrightness exactly the way breath level
  // already is.
  const toneColorFilter = ctx.createBiquadFilter();
  toneColorFilter.type = "lowpass";
  toneColorFilter.Q.value = 0.5;
  toneColorFilter.frequency.value = layerHz * dp.whistleToneColorRatio;
  toneGain.connect(toneColorFilter);

  // Breath-tone coupling -- the SAME irregular (non-periodic) wander
  // already driving breath level also nudges THIS layer's own amplitude,
  // scaled down. Real breath-pressure vibrato/wander moves the tone and
  // the noise together because they're the same underlying breath.
  const toneWanderDepth = ctx.createGain();
  toneWanderDepth.gain.value = dp.whistleAmount * levelScale * dp.whistleBreathToneCoupling * 0.3;
  wanderLowpass.connect(toneWanderDepth);
  toneWanderDepth.connect(toneGain.gain);

  // Articulation -- "breath renews here" used to only ever swell the
  // NOISE (whistleBreathSurgeAmount); this lets a real hit swell the
  // TONE's own presence too, over the same window, so the pitched core
  // re-articulates along with the breath instead of just gliding smoothly
  // underneath an independently-articulated noise layer.
  const toneSurgeGain = ctx.createGain();
  toneSurgeGain.gain.value = 1;
  toneColorFilter.connect(toneSurgeGain);

  return {
    octaveMult, levelScale, sampleBaseHz: sample.baseHz,
    source, toneGain, toneColorFilter,
    vibratoPitchDepth, vibratoAmpDepth, toneWanderDepth,
    toneSurgeGain, output: toneSurgeGain,
  };
}

// The chamber resonator bank -- one per RING (not per layer: RING_RATIO
// already makes each ring its own pipe length; the layers within a ring are
// cluster-voicing copies of that same pipe, not separate bores). N peaking
// filters IN SERIES (not bandpass -- in series that would gut everything
// between modes), each boosting one of a real open or stopped cylindrical
// pipe's own resonant modes: open (transverse flute) speaks every integer
// harmonic of its fundamental; stopped (a capped/drone pipe) speaks only
// odd harmonics -- textbook wind-instrument acoustics, not an invented
// shape. Deliberately the ONE thing in this flute's signal chain that does
// NOT retune on every note (contrast toneColorFilter, which tracks every
// pitch) -- see setChamberRoot's own comment for why that fixedness is the
// entire point.
function buildFluteChamberBank(ctx, dp, chamberFundamentalHz) {
  const input = ctx.createGain();
  input.gain.value = 1;
  const filters = [];
  let node = input;
  for (let i = 0; i < FLUTE_CHAMBER_MAX_MODES; i++) {
    const filter = ctx.createBiquadFilter();
    filter.type = "peaking";
    node.connect(filter);
    filters.push(filter);
    node = filter;
  }
  const bank = { input, output: node, filters };
  applyChamberModeParams(bank, dp, chamberFundamentalHz);
  return bank;
}

// Recomputes every mode's frequency/gain/Q from the current chamber
// fundamental and params. Mode n's frequency is exactly n (open) or
// 2n-1 (stopped) times the fundamental -- no per-mode constant, the whole
// bank is one number (chamberFundamentalHz) plus the pipe-type choice.
// Mode n's gain rolls off as amountDb/n, the standard first-order falloff
// for higher modes (radiation + wall losses) -- so mode 1 is loudest and
// each successive mode recedes, the way a real pipe's own overtone series
// actually behaves. Modes beyond whistleChamberModes sit at 0dB (present
// in the graph, inaudible) rather than being created/destroyed, matching
// this file's existing fixed-slot-count discipline (see WHISTLE_MAX_VOICES).
// now/glideTc supplied => glide live (a running drone); omitted => set the
// value directly (building a fresh bank has nothing to glide FROM yet).
function applyChamberModeParams(bank, dp, chamberFundamentalHz, now, glideTc) {
  const stopped = dp.whistleChamberPipe === "stopped";
  for (let i = 0; i < bank.filters.length; i++) {
    const n = stopped ? 2 * i + 1 : i + 1;
    const freqHz = Math.max(20, n * chamberFundamentalHz);
    const active = i < dp.whistleChamberModes;
    const gainDb = active ? dp.whistleChamberAmountDb / n : 0;
    const filter = bank.filters[i];
    if (now !== undefined) {
      filter.frequency.setTargetAtTime(freqHz, now, glideTc);
      filter.gain.setTargetAtTime(gainDb, now, glideTc);
      filter.Q.setTargetAtTime(dp.whistleChamberQ, now, glideTc);
    } else {
      filter.frequency.value = freqHz;
      filter.gain.value = gainDb;
      filter.Q.value = dp.whistleChamberQ;
    }
  }
}

// The guitar cabinet's own fixed body resonance -- a small, FIXED bank
// (not retuned per note), the same "a real body's resonances are fixed by
// its physical geometry, they don't move when fingering changes" reasoning
// buildFluteChamberBank's own header comment already established for the
// flute. A real cabinet's own resonance behavior is dominated by a couple
// of real cone/box modes (a low body thump, a presence peak), not a clean
// harmonic-series ladder like a wind-instrument pipe -- so this is two
// named peaks, not a mode-count/pipe-type table like the flute's own bank.
function buildGuitarCabBank(ctx) {
  const input = ctx.createGain();
  const low = ctx.createBiquadFilter();
  low.type = "peaking";
  low.frequency.value = 110;
  low.Q.value = 1.1;
  low.gain.value = 4;
  const presence = ctx.createBiquadFilter();
  presence.type = "peaking";
  presence.frequency.value = 2200;
  presence.Q.value = 1.3;
  presence.gain.value = 3;
  input.connect(low);
  low.connect(presence);
  return { input, output: presence };
}

function buildSyntheticImpulseResponse(ctx, seconds = 3.2, decay = 3.5) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

export class OrphographAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.reverbSend = null;
    this.droneVoices = null;
    this.droneOn = false;
    // "Isolate just the flutes for testing" -- see _nonFluteGate
    // (ensureContext) and setFluteSolo. Read at construction time by
    // ensureContext, so set before ensureContext if you want solo already
    // engaged the first time the graph is built.
    this._fluteSoloOn = false;
    // Resultant-rhythm percussion engine -- see playPercussionHit and
    // _percussionGate (ensureContext). Its level now lives in the mixer as
    // mixPercussion (DEFAULT_MIX_PARAMS/setMixParam) rather than a
    // standalone field -- the old dedicated _percussionLevel/
    // setPercussionLevel were retired once the mixer gave this same lever
    // a presettable home next to its siblings.
    // "Can't really hear any percussion" -- 0.7 was never checked against
    // the drone's own real aggregate level (the 16-partial DRONE_HARMONICS
    // stack sums to ~3.78 linearly, x busGain 0.3 ~= 1.13 into the bus,
    // then a further +9dB lowshelf below 140Hz -- exactly the kick's own
    // 150->50Hz sweep range). At 0.7, the kick's own peak (0.9 x 0.7 =
    // 0.63) never even matched that, let alone cleared it under masking.
    // Raised to 1.0 (max, now mixPercussion's own default) here; the
    // individual hit gains below were also raised for real margin, not
    // just "higher."
    // "Ebbing and flowing with processions/across the full arc of
    // procession" -- density (not level) is how often the resultant-
    // rhythm kit actually fires, fed live from main.js's tickRate loop
    // the same way _masterPulsesPerSecond already is (see
    // setPercussionDensity). 1 = every real hit sounds (today's original
    // behavior); the accumulator below is what actually gates on it.
    this._percussionDensity = 1;
    // The exact accumulate-and-drain-past-1 idiom sequencer.js's own
    // RingRunner._pulseAccumulator and Sequencer's breath-cycle counter
    // already use, one accumulator per role so each drum voice thins
    // independently -- deterministic and evenly-spread, not a
    // Math.random() gate (see playPercussionHit).
    this._percussionDensityAccumulator = { given: 0, received: 0, made: 0 };
    // Fed continuously by main.js's tickRate loop regardless of drone
    // on/off state, so it's always current by the time the drone starts --
    // see setProcessionPulseRate.
    this._masterPulsesPerSecond = 0;
    // Loudness/energy is the one thing an organ pipe structurally can't
    // have and a wind instrument's tone is built from -- see
    // whistleBrightnessTempoSensitivity. Starts neutral (1 = the static
    // pre-phase-18 behavior) until the first real setProcessionPulseRate
    // tick establishes the voice's own actual pace. A scalar now, not
    // ring-keyed -- one flute voice, one current brightness.
    this._whistleBrightnessMult = 1;
    // Which ring's own register the shared flute voice is CURRENTLY
    // registered to -- see _fluteTargetHz. Only meanderFlute (a real hit)
    // ever changes this; every other site that needs the voice's own
    // current pitch (brightness crossfade, sample re-pick, per-param
    // retunes, the frame-rate level tick) reads it instead of assuming
    // "received" the way those sites used to. "received" is the correct
    // starting register before any real hit has ever fired.
    this._whistleLastRing = "received";

    // The flute's own chamber root -- deliberately SEPARATE from the drone's
    // own anchor (_droneBaseHz, which stays fixed on O by settled law). A
    // real wind instrument's body resonances are fixed by its physical
    // geometry: a player who needs a different key picks up a different
    // flute, they don't bend one instrument's body in real time. This is
    // that "which flute" choice -- set once per Play from the phrase's own
    // derived root (see main.js/setChamberRoot), left untouched by every
    // per-note pitch change (meanderFlute). 0 until the
    // first setDroneVoices/setChamberRoot call establishes it.
    this._chamberRootHz = 0;

    // The flute's own MELODIC root -- deliberately separate from
    // `_chamberRootHz` above (that's the physical resonance body, "a
    // different flute for this key"; this is which Hz scale-degree-0
    // actually sounds at) and from `_droneBaseHz` (the drone's own
    // fixed-on-O anchor, settled law, never moves). Set by
    // `setMelodicRoot` when the phrase's derived scale is active (see
    // main.js's deriveScaleFromTrace fix -- the tritone bug this closes),
    // 0 (meaning "none set yet, fall back to the drone's O anchor") the
    // rest of the time, e.g. while a named mode preset is in effect
    // ("relative to the drone's root" is a coherent, unaffected case).
    this._melodicRootBaseHz = 0;

    // "The cyclic transposition graphics work, but the trace and music
    // don't actually follow suit" -- root cause: main.js's transposition
    // only ever rotated the KALIMBA/note-timbre real-hit voice's spoke
    // (hzForSpoke) and the flute's CHAMBER (resonance/timbre coloring) --
    // never the flute's own PITCH, which is what's actually sustained and
    // dominant for as long as the drone is on. The flute's pitch is
    // everywhere derived from _droneBaseHz -- the bass drone's OWN fixed-
    // on-O anchor -- so a naive fix would have meant either transposing
    // the bass drone too (violating the settled "stays fixed on O" law) or
    // leaving the flute silent on the whole feature. This ratio is the
    // real fix: a SEPARATE multiplier, applied only where the FLUTE reads
    // its root (see _effectiveDroneBaseHz), leaving _droneBaseHz itself --
    // and the bass drone's own oscillator stack, which reads it directly,
    // never through this ratio -- exactly as fixed as the law requires.
    this._transpositionRatio = 1;

    // Multisampled flute notes (see FLUTE_SAMPLES/_loadRealFluteNoteBuffer/
    // _pickFluteSample) -- keyed by filename, populated as each file's
    // fetch+decode resolves (independently, not gated on the others).
    this._fluteSampleBuffers = {};
    this._fluteSampleLoadStarted = false;

    // Note-timbre parameters, live-adjustable via setNoteParam -- exposed
    // because this prototype stands in for a physical instrument whose
    // actual filtering/resonance hasn't been built yet. Defaults aimed at
    // "marimba/harp hybrid: string-like attack, not harsh; dull, rich
    // wooden body resonance" -- fast attack (struck/plucked, not a swell),
    // a warm/dark lowpass, one wood-body resonance peak (not the vocal
    // formant pair -- that's specific to the drone), and a brief
    // mallet/pluck noise transient instead of harsh oscillator content.
    this.noteParams = { ...DEFAULT_NOTE_PARAMS };

    // Percussion-timbre parameters, live-adjustable via setPercussionParam
    // -- same treatment as noteParams above, promoted out of
    // playPercussionHit's own former inline literals so a "kit" is a data
    // edit (see main.js's PERCUSSION_KIT_PRESETS), not a code change.
    this.percussionParams = { ...DEFAULT_PERCUSSION_PARAMS };

    // Guitar/bass-timbre parameters -- same live-adjustable, read-write
    // pattern as noteParams/percussionParams. See DEFAULT_GUITAR_PARAMS'
    // own comment for the instrument itself.
    this.guitarParams = { ...DEFAULT_GUITAR_PARAMS };

    // Mixer parameters -- see DEFAULT_MIX_PARAMS. Same live-tunable,
    // read-write pattern as noteParams/percussionParams; pushed onto the
    // real channel gain nodes by setMixParam once ensureContext has built
    // them (harmless before that -- setMixParam no-ops on the AudioParam
    // side and just remembers the value, same guard as setPercussionLevel
    // always used).
    this.mixParams = { ...DEFAULT_MIX_PARAMS };

    // Drone-timbre parameters -- same "read-write, not read-only" deal as
    // noteParams, but the drone is a long-lived running graph rather than a
    // one-shot note, so setDroneParam (below) also pushes changes into the
    // live AudioParams immediately when the drone is on, instead of only
    // taking effect on the next playNote() call.
    // whistleScale is an array -- a shallow spread would alias it back to
    // DEFAULT_DRONE_PARAMS itself (the exported "factory default" every
    // reset/preset reconstruction relies on), so any future in-place edit
    // to this instance's list would silently corrupt that shared default
    // too. Cloned one level deep here specifically for that reason.
    this.droneParams = {
      ...DEFAULT_DRONE_PARAMS,
      whistleScale: [...DEFAULT_DRONE_PARAMS.whistleScale],
    };
    // The native voicing engine's own live state (see meanderFlute,
    // src/voicing.js) -- normally only ever set by a real hit, but
    // setDroneVoices's first-ever build computes the voice's starting
    // pitch/layer levels through that same shared machinery before any
    // hit has fired once, so it needs real starting values here, not
    // undefined. A single silent root voice (WHISTLE_MAX_VOICES' slot 0
    // only) until the first real word voices a chord.
    this._whistleActiveVoices = [{ ratio: 1, level: 1, isDoubling: false, isPedal: false, isLead: true }];
    this._whistlePreviousVoicing = null;
    this._whistlePreviousPcSpokes = null;
    this._whistleChordRootHz = 0;
    // The pedal voice's own held root -- see meanderFlute. null until the
    // first real hit, so that first hit always retunes the pedal (nothing
    // to compare against yet) rather than silently skipping it.
    this._whistlePedalRootSpoke = null;
    this._transpositionOffsetSpokes = 0;

    // Per-ring mute (setDroneMute) is retired -- "one driving bass drone,
    // one meandering flute narrative" means there's only one instance of
    // each to mute now, already covered by the drone on/off button and
    // setFluteSolo.

    // Triatonic flute, phase 2 -- "narrative, meandering, resolving,"
    // modulating whistleHarmonic by hand was the satisfying part; this
    // makes that motion autonomous, driven by the made ring's own real
    // rotation instead of a hand on the slider. On by default -- this is
    // the wheel-driven, not manual, mode of the feature now.
    this.whistleFollowsWheel = true;
  }

  setWhistleFollowsWheel(on) {
    this.whistleFollowsWheel = !!on;
  }

  // Fed every animation frame by main.js's tickRate loop, drone on or off
  // -- "adjust any Hz-based rates to become derived rates based on their
  // respective driven/associated ring and the given procession rate."
  // Retargets the drone's own breath/vibrato LFOs and the flute's own
  // drone-wave LFO -- all off the MASTER rate now (one shared voice each,
  // see setDroneVoices's own header comment on why this simplified rather
  // than invented a composite formula), plus the one shared sweep LFO
  // (already master-rate-derived) -- live, so speeding up or slowing down
  // the procession audibly speeds up or slows down the drone's own
  // movement with it -- including down to a full stop: freeze the wheel
  // and these freeze too, the way a tempo-locked instrument should, rather
  // than drifting on regardless.
  setProcessionPulseRate(masterPulsesPerSecond) {
    this._masterPulsesPerSecond = masterPulsesPerSecond;
    if (!this.droneOn || !this.droneVoices) return;
    const dv = this.droneVoices;
    const dp = this.droneParams;
    const now = this.ctx.currentTime;
    dv.voiceLfo.frequency.setTargetAtTime(masterPulsesPerSecond / dp.breathPulsesPerCycle, now, 0.2);
    dv.vibratoLfo.frequency.setTargetAtTime(masterPulsesPerSecond * dp.vibratoCyclesPerPulse, now, 0.2);
    // The flute's own drone-wave LFO -- same pulse-derived-rate idea as
    // voiceLfo above, just applied to the flute's own mute gain instead of
    // the bass drone's (see _updateFluteBrightness for the register
    // scaling that decides how audible it actually is right now).
    if (dv.whistleDroneWaveLfo) {
      dv.whistleDroneWaveLfo.frequency.setTargetAtTime(
        masterPulsesPerSecond / dp.whistleDroneWaveCyclesPerRingPulse, now, 0.2);
    }
    dv.filterLfo.frequency.setTargetAtTime(masterPulsesPerSecond / dp.moveFilterPulsesPerCycle, now, 0.2);
    if (dv.whistleLayers) this._updateFluteBrightness(dv, dp, now);
  }

  setNoteParam(key, value) {
    if (this.noteParams && key in this.noteParams) this.noteParams[key] = value;
  }

  setPercussionParam(key, value) {
    if (this.percussionParams && key in this.percussionParams) this.percussionParams[key] = value;
  }

  // The guitar/bass rig's own params -- unlike percussion (a one-shot
  // voice that reads percussionParams fresh every hit, nothing persistent
  // to push into), the guitar's DRIVE/TONE STACK is a real persistent
  // graph (see _ensureGuitarRig), so most of these need live pushes here,
  // the same "dict write, then push onto the live nodes if they already
  // exist" pattern setMixParam/setDroneParam already use. Params read
  // fresh per chug instead (guitarCeilingHz/SubAmount/DetuneCents/
  // ChugTightness/ChugAttackFraction/DuckAmount/DuckPulseFraction -- see
  // playGuitarChug/_duckGuitar) need no case here at all.
  setGuitarParam(key, value) {
    if (!(this.guitarParams && key in this.guitarParams)) return;
    this.guitarParams[key] = value;
    const rig = this._guitarRig;
    if (!this.ctx || !rig) return;
    const now = this.ctx.currentTime;
    const glide = (param, v) => param.setTargetAtTime(v, now, 0.05);
    switch (key) {
      case "guitarPreGain": glide(rig.preGain.gain, value); break;
      case "guitarDriveAmount": rig.saturator.curve = buildSaturationCurve(value); break;
      case "guitarFloorHz": glide(rig.highpass.frequency, value); break;
      case "guitarScoopHz": glide(rig.scoop.frequency, value); break;
      case "guitarScoopQ": glide(rig.scoop.Q, value); break;
      case "guitarScoopDb": glide(rig.scoop.gain, value); break;
      case "guitarCabLowpassHz": glide(rig.cabLowpass.frequency, value); break;
    }
  }

  // The mixer -- see DEFAULT_MIX_PARAMS. Always remembers the value (so
  // wireTimbrePanel's module-load-time apply, before any user gesture/
  // ensureContext, is harmless -- same guard setPercussionLevel always
  // used); pushes it onto the real channel node live once the audio graph
  // exists.
  setMixParam(key, value) {
    if (!(key in this.mixParams)) return;
    this.mixParams[key] = value;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const glide = (param, v) => param.setTargetAtTime(v, now, 0.05);
    switch (key) {
      case "mixDrone": glide(this._chanDrone.gain, value); break;
      case "mixNote": glide(this._chanNote.gain, value); break;
      case "mixFlute": glide(this._chanFlute.gain, value); break;
      case "mixPercussion": glide(this._percussionGate.gain, value); break;
      case "mixGuitar": glide(this._chanGuitar.gain, value); break;
      case "mixMaster": glide(this.master.gain, value); break;
      case "mixFluteLowMidHz": glide(this._fluteLowMid.frequency, value); break;
      case "mixFluteLowMidDb": glide(this._fluteLowMid.gain, value); break;
      case "mixLevelerAmount": this._applyLevelerAmount(value); break;
    }
  }

  // One lever driving threshold+ratio+makeup together -- see the leveler's
  // own comment in ensureContext for why (0 must be a true no-op, 1 a real
  // even-out, and turning it up shouldn't just make everything quieter).
  // Threshold -6dB..-24dB, ratio 1..4, both linear in `amount`; makeup
  // gain approximates the dB the compressor removes at a signal that's
  // already sitting AT threshold (a reasonable, simple stand-in -- exact
  // makeup depends on program material, which this can't know in advance).
  _applyLevelerAmount(amount) {
    if (!this.ctx || !this._leveler) return;
    const now = this.ctx.currentTime;
    const glide = (param, v) => param.setTargetAtTime(v, now, 0.05);
    const threshold = -6 + amount * -18; // -6 -> -24
    const ratio = 1 + amount * 3; // 1 -> 4
    glide(this._leveler.threshold, threshold);
    glide(this._leveler.ratio, ratio);
    const reductionDb = Math.max(0, -threshold) * (1 - 1 / ratio);
    const makeupGain = Math.pow(10, (reductionDb * 0.6) / 20);
    glide(this._levelerMakeup.gain, makeupGain);
  }

  // Read fresh whenever the mixer panel is open (main.js's tickRate loop --
  // no separate polling loop, see that call site's own comment on why).
  // RMS over the analyser's current time-domain buffer, one per channel
  // plus master; `clipping` is a simple peek at whether the master's own
  // samples are hugging full scale, a cheap proxy for "the limiter is
  // working hard right now."
  mixMeterLevels() {
    const rms = (analyser) => {
      if (!analyser) return 0;
      const buf = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      return Math.sqrt(sum / buf.length);
    };
    const masterBuf = this._meterMaster ? new Float32Array(this._meterMaster.fftSize) : null;
    let clipping = false;
    if (masterBuf) {
      this._meterMaster.getFloatTimeDomainData(masterBuf);
      for (let i = 0; i < masterBuf.length; i++) {
        if (Math.abs(masterBuf[i]) >= 0.99) { clipping = true; break; }
      }
    }
    return {
      drone: rms(this._meterDrone),
      note: rms(this._meterNote),
      flute: rms(this._meterFlute),
      percussion: rms(this._meterPercussion),
      guitar: rms(this._meterGuitar),
      master: rms(this._meterMaster),
      clipping,
    };
  }

  // The ONE place the flute's un-folded register formula lives -- every
  // site that used to hand-recompute
  // "rootHz * RING_OCTAVE_MULTIPLIER.received * harmonic" independently
  // (construction, every setDroneParam case, the frame-rate brightness
  // tick, sample re-picking) now reads this instead, which is what fixed
  // two real bugs at once: those sites were all hardcoded to `.received`
  // regardless of which ring actually last fired (this._whistleLastRing,
  // set only by a real hit -- see meanderFlute), and any future fix to the
  // formula only ever has one place to land. rootHz defaults to the
  // transposition-aware live root; the two sites that retune mid-
  // construction (setDroneVoices) pass the raw incoming baseHz explicitly,
  // since _droneBaseHz isn't settled yet at that point.
  //
  // "RING_OCTAVE_MULTIPLIER no longer differentiates the flute's register
  // across rings" -- measured, not assumed: with the default floor/
  // ceiling/voicing span, the fold's own valid-shift window has only
  // ~0.008 octaves of real slack out of every octave (the window is
  // 65-523Hz, ~3.008 octaves; the chord's own 0.5x-2x span is exactly 2
  // octaves; the difference, 1.008 octaves, is JUST barely over one full
  // octave -- meaning almost every real target lands on exactly one legal
  // shift, leaving _fluteFoldFactor's own ring-aware shift-selection
  // (below) almost nothing to bias between in practice). A shift-selection
  // rule alone can't fix that; this is the real fix -- a small, continuous
  // (non-octave) per-ring bias applied HERE, before the fold, so it can
  // genuinely tip the pre-fold target across a fold boundary rather than
  // waiting for one to already be open. RING_REGISTER_BIAS_SIGN (given
  // down, made up, received centered) times whistleRingRegisterBias
  // (octaves) -- final safety is still `_fluteLayerHz`'s own floor/ceiling
  // clamp, so this can never push a layer outside the authored range
  // either.
  static RING_REGISTER_BIAS_SIGN = { given: -1, received: 0, made: 1 };
  // rootHz now defaults to this._whistleChordRootHz -- the chord's own
  // real root pitch (hzForSpoke of whichever letter started the current
  // word, see meanderFlute), NOT a "harmonic of the drone's O" multiplier
  // anymore (that whole indirection retired with whistleHarmonic). The
  // explicit-argument override stays for construction/chamber-retune,
  // which run before a chord root has ever been set.
  _fluteTargetHz(rootHz = this._whistleChordRootHz || this._effectiveDroneBaseHz()) {
    const ring = this._whistleLastRing || "received";
    const bias = Math.pow(2, (OrphographAudio.RING_REGISTER_BIAS_SIGN[ring] || 0) * (this.droneParams.whistleRingRegisterBias || 0));
    return rootHz * RING_OCTAVE_MULTIPLIER[ring] * bias;
  }

  // See foldIntoRange/whistleCeilingHz's own comment for the "why." Returns
  // a single power-of-2 factor -- computed from the topmost and bottommost
  // currently-SOUNDING voicing layers (level > 0; a silent slot shouldn't
  // constrain the range) -- rather than folding each layer separately,
  // because folding independently would let the 2x layer collapse onto the
  // 1x layer and destroy the authored chord shape at the top of the range.
  // Applying ONE shared factor to every layer (see _fluteFundamentalHz)
  // keeps every layer's ratio to every other layer exactly what
  // whistleVoicing authored, only the whole voice's register moves.
  // Ceiling is the hard constraint (the loop that enforces it has no exit
  // condition beyond "fits"); floor is honored whenever there's still room
  // under the ceiling to fold up into -- with the factory defaults the
  // voicing's own span (4x/2 octaves) fits comfortably inside the
  // floor-ceiling window (65-523Hz is ~8x/3 octaves), so both hold.
  //
  // "RING_OCTAVE_MULTIPLIER no longer differentiates the flute's register
  // across rings at all -- the fold always returns a power-of-2 factor,
  // collapsing given/received/made to the same octave." Real regression:
  // RING_OCTAVE_MULTIPLIER's own ratios (0.5/1/2) ARE octave multiples, so
  // whenever the fold had exactly one valid octave to land on, given and
  // made's pre-fold targets (an octave apart by construction) folded to
  // the identical result -- no shift-selection rule can undo that when
  // there's only one legal shift. What it CAN do: whenever the window
  // (~3 octaves) has slack beyond what the chord itself needs (~2
  // octaves) -- genuinely often, since harmonic/transposition move the
  // pre-fold target continuously -- pick WHERE in that slack to land based
  // on which ring is actually sounding, rather than an arbitrary fixed
  // rule blind to ring. given prefers the window's own floor, made its own
  // ceiling, received the middle -- restoring real register separation
  // whenever the math allows it, never by relaxing either hard bound.
  _fluteFoldFactor(targetHz, dp = this.droneParams) {
    if (!(targetHz > 0)) return 1;
    const floorHz = dp.whistleFloorHz, ceilingHz = dp.whistleCeilingHz;
    if (!(ceilingHz > floorHz && floorHz > 0)) return 1;
    const activeRatios = (this._whistleActiveVoices || [])
      .filter((v) => v.level > 0 && v.ratio > 0)
      .map((v) => v.ratio);
    const maxRatio = activeRatios.length ? Math.max(...activeRatios) : 1;
    const minRatio = activeRatios.length ? Math.min(...activeRatios) : 1;
    // The ceiling is the hard bound -- the highest shift at which the
    // topmost sounding layer still fits, clamped to a sane range.
    const shiftMax = Math.max(-24, Math.min(24, Math.floor(Math.log2(ceilingHz / (targetHz * maxRatio)))));
    // The floor is honored whenever there's room -- the lowest shift at
    // which the bottommost sounding layer clears it, but never past
    // shiftMax (the ceiling always wins if the two disagree).
    const shiftMinWanted = Math.max(-24, Math.min(24, Math.ceil(Math.log2(floorHz / (targetHz * minRatio)))));
    const shiftMin = Math.min(shiftMinWanted, shiftMax);
    const ring = this._whistleLastRing || "received";
    const shift = ring === "given" ? shiftMin : ring === "made" ? shiftMax : Math.round((shiftMin + shiftMax) / 2);
    return Math.pow(2, shift);
  }

  // The voice's own actual current fundamental -- _fluteTargetHz folded as
  // a whole into [whistleFloorHz, whistleCeilingHz]. This is what every
  // layer/throat-partial pitch should now be computed FROM (multiply by
  // that layer's own ratio, same as before the fold existed).
  _fluteFundamentalHz(rootHz = this._effectiveDroneBaseHz()) {
    const targetHz = this._fluteTargetHz(rootHz);
    return targetHz * this._fluteFoldFactor(targetHz);
  }

  // Quantize-then-safety-clamp for one sounding layer (or the throat
  // voice, octaveMult 1). The fold above already keeps the UNQUANTIZED
  // voice inside range; quantizeFluteHz can nudge an individual layer up
  // to ~1.5 semitones (~9%) off that when it snaps to the nearest scale
  // degree, which is small enough to just clamp flat rather than re-fold a
  // whole octave over a few Hz of quantization wobble.
  //
  // The default `rootHz` is the QUANTIZATION root (which absolute Hz
  // scale-degree-0 snaps to), deliberately independent of the register/
  // harmonic math above (`_fluteFundamentalHz`, still always anchored on
  // the drone's O -- register stays law) -- prefers the phrase's own
  // derived melodic root when one is set, falls back to O otherwise. The
  // two explicit-rootHz call sites (construction, mid-restart retune) keep
  // passing the raw incoming `baseHz` unchanged -- they run before
  // `_droneBaseHz`/`_transpositionRatio` are settled, the same reason they
  // already bypassed `_effectiveDroneBaseHz()`.
  // Quantization is skipped entirely while whistleFollowsWheel is on --
  // every voice's pitch already IS a real letter's own exact 12-TET spoke
  // (see voiceWord), so snapping it again to a scale (possibly a hand-set
  // preset that doesn't even contain that pitch class) could only ever
  // corrupt it. `whistleScale`/quantizeFluteHz stay live for the manual/
  // fallback path only (whistle-follow off), per the native voicing
  // engine's own design.
  _fluteLayerHz(targetHz, octaveMult, rootHz = this._effectiveMelodicRootHz() || this._effectiveDroneBaseHz()) {
    const dp = this.droneParams;
    const raw = targetHz * octaveMult;
    const value = this.whistleFollowsWheel ? raw : quantizeFluteHz(raw, rootHz, dp.whistleScale);
    return Math.min(dp.whistleCeilingHz, Math.max(dp.whistleFloorHz, value));
  }

  // Recomputes every level-dependent gain on ONE flute tone layer from
  // the current droneParams, including the breath-tone coupling depths --
  // several params (whistleAmount, whistleHarmonic2/3Amount,
  // whistleVibratoAmpDepth, whistleBreathToneCoupling, and the octave-
  // doubling amounts) all feed formulas that touch multiple nodes at
  // once; this keeps every one of setDroneParam's cases from having to
  // duplicate that math and risk forgetting a dependent node.
  // See whistleBreathColorRatio -- this ring's own breath-noise color,
  // as a multiple of whatever pitch it's CURRENTLY playing rather than a
  // fixed absolute Hz, clamped to a sane audible band.
  _breathColorHzFor(targetHz, ratio) {
    return Math.min(8000, Math.max(400, targetHz * ratio));
  }

  // brightness (the voice's own current whistleBrightnessMult, see
  // _updateFluteBrightness) opens/closes the tone-color filter and the
  // breath bed -- the parts of the tone real breath energy actually
  // varies -- but NOT the fundamental (toneGain), which is loudness, not
  // brightness; an organ's problem was a fixed brightness, not a fixed
  // loudness. There's no separate harmonic-partial mix to rebalance
  // anymore (see buildFluteToneLayer -- a real sample carries its own),
  // so brightness now means "how open is the tone-color lowpass," the
  // standard sampler-instrument way to give a static recording dynamic
  // movement.
  _applyFluteLayerLevel(dv, dp, layerIndex, now) {
    const layer = dv.whistleLayers[layerIndex];
    const glide = (param, v) => param.setTargetAtTime(v, now, 0.08);
    const ls = layer.levelScale;
    const brightness = this._whistleBrightnessMult;
    const targetHz = this._fluteFundamentalHz();
    const layerHz = targetHz * layer.octaveMult;
    glide(layer.toneGain.gain, dp.whistleAmount * ls);
    glide(layer.toneColorFilter.frequency, this._toneColorHzFor(layerHz, dp.whistleToneColorRatio, brightness));
    glide(layer.vibratoAmpDepth.gain, dp.whistleAmount * ls * dp.whistleVibratoAmpDepth);
    glide(layer.toneWanderDepth.gain, dp.whistleAmount * ls * dp.whistleBreathToneCoupling * 0.3);
  }

  // Pushes this._whistleActiveVoices (the native voicing engine's own
  // current output, see meanderFlute/voiceWord) into each fixed layer
  // slot's bookkeeping (octaveMult/levelScale) and re-applies its GAIN
  // from that -- but deliberately does NOT touch pitch (playbackRate)
  // here. Pitch retuning stays inside meanderFlute's own dip-masked gate
  // (the tongued-articulation envelope), timed to hide the fingering
  // change, same as every other real-hit retune in this file; this only
  // updates which ratio/level each slot is ABOUT to glide toward.
  _applyWhistleVoicesToLayers(dv, dp, now) {
    const voices = this._whistleActiveVoices || [];
    dv.whistleLayers.forEach((layer, i) => {
      const voice = voices[i] || WHISTLE_EMPTY_VOICE;
      layer.octaveMult = voice.ratio;
      layer.levelScale = voice.level;
      // Which of the three articulation tiers this slot is THIS hit -- see
      // meanderFlute's own per-hit loop, which reads these to decide
      // whether to retune/re-articulate this layer at all.
      layer.isPedal = !!voice.isPedal;
      layer.isLead = !!voice.isLead;
      this._applyFluteLayerLevel(dv, dp, i, now);
    });
  }

  // See whistleToneColorRatio -- this layer's own tone-color cutoff, as a
  // multiple of whatever pitch it's CURRENTLY playing (same pitch-tracking
  // idea as _breathColorHzFor), scaled by the brightness multiplier,
  // clamped to a sane audible band.
  _toneColorHzFor(layerHz, ratio, brightness) {
    return Math.min(12000, Math.max(400, layerHz * ratio * brightness));
  }

  // Same idea for the (non-layered) breath stage -- more energetic
  // playing means more air, not just brighter tone.
  // "None of the breath components are working as intended... how can we
  // tie this together into something resolved, meandering, timeless?" --
  // simplified to a minimal, predictable bed on purpose: a steady level
  // (whistleBreathAmount), pitch-tracked color (phase 20), and the real-
  // hit note-gate duck/attack (meanderFlute -- kept, since that's tied to
  // actual articulation, not a continuous unpredictable modulation).
  // Turbulence wander and tempo-brightness's effect on breath level are
  // GONE, not just turned down -- too many interacting, continuously-
  // shifting modulations on what's supposed to be a quiet, subordinate
  // texture made it read as chaotic rather than calm. Brightness still
  // drives the TONE's own color filter (_applyFluteLayerLevel) -- this is
  // breath-specific simplification, not a brightness removal.
  _applyFluteBreathLevel(dv, dp, now) {
    const glide = (param, v) => param.setTargetAtTime(v, now, 0.08);
    glide(dv.whistleBreathGain.gain, dp.whistleBreathAmount);
  }

  // "The entire sound profile still reads as a digital pipe organ" --
  // root cause: whistleHarmonic2/3Amount and whistleBreathAmount were
  // static numbers, the one thing a real wind player's breath pressure
  // never lets stay fixed. This is what makes them dynamic: the voice's
  // own CURRENT master pulse rate (already computed by
  // setProcessionPulseRate every tick, drone on or off -- see that
  // method's own header comment for why this is master-rate-derived now,
  // not any one ring's own) stands in for "how energetically is this
  // being played" -- faster than whistleBrightnessReferencePps brightens
  // and airs the tone up, slower purifies and quiets it down, scaled by
  // whistleBrightnessTempoSensitivity and clamped to a sane [0.25, 3]
  // range so an extreme tempo can't silence or blow out the upper
  // partials entirely.
  _updateFluteBrightness(dv, dp, now) {
    const referencePps = Math.max(0.1, dp.whistleBrightnessReferencePps);
    // Register reference for the growl/throat/drone-wave crossfade below.
    // Real bug fixed here: this used to reference FLUTE_SAMPLES' own span
    // (264.7-900.2Hz) and a separate hardcoded THROAT_LOW_REF_HZ (40Hz) --
    // both authored BEFORE the pitch-range fold existed, back when the
    // flute's real pitch could actually reach that whole span. A second,
    // subtler bug was found MEASURING the first fix: [whistleFloorHz,
    // whistleCeilingHz] bounds the WHOLE CHORD, not the fundamental this
    // crossfade actually reads -- since the fold keeps every voicing layer
    // inside that window as one block, the fundamental (ratio 1) can only
    // ever reach a narrower sub-range itself: bounded below by needing the
    // lowest-ratio layer to still clear the floor, above by needing the
    // highest-ratio layer to still clear the ceiling. Using the chord's
    // own outer bounds here (rather than the fundamental's real ones)
    // left t stuck around 0.35-0.65 instead of reaching [0,1] -- measured
    // directly, not assumed.
    const activeRatios = (this._whistleActiveVoices || []).filter((v) => v.level > 0 && v.ratio > 0).map((v) => v.ratio);
    const maxRatio = activeRatios.length ? Math.max(...activeRatios) : 1;
    const minRatio = activeRatios.length ? Math.min(...activeRatios) : 1;
    const lowRefHz = dp.whistleFloorHz / minRatio;
    const highRefHz = dp.whistleCeilingHz / maxRatio;

    const brightnessMult = Math.min(3, Math.max(0.25,
      1 + dp.whistleBrightnessTempoSensitivity * (this._masterPulsesPerSecond / referencePps - 1)));
    this._whistleBrightnessMult = brightnessMult;
    dv.whistleLayers.forEach((_, i) => this._applyFluteLayerLevel(dv, dp, i, now));
    this._applyFluteBreathLevel(dv, dp, now);

    // "The flute is missing a drone in itself -- wooden-flute-drone at the
    // high end." t=0 at the voice's own authored FLOOR, t=1 at its
    // authored CEILING -- the real reachable window (see lowRefHz/
    // highRefHz's own comment above), not a stale sample-library span.
    // Glides on a slow (0.3s) time constant on purpose -- a register-
    // character shift is meant to read as "meandering," not a snap. Growl
    // and the throat voice USED to crossfade here too (the low-register
    // half of this same idea) -- both have since moved to the actual bass
    // drone (droneGrowl*/droneThroat*), which has no register to crossfade
    // against, so they're driven directly now (see setDroneParam).
    if (dv.whistleDroneWaveDepthGain) {
      const targetHz = this._fluteFundamentalHz();
      const t = targetHz > 0
        ? Math.min(1, Math.max(0,
            (Math.log2(targetHz) - Math.log2(lowRefHz)) / (Math.log2(highRefHz) - Math.log2(lowRefHz))))
        : 0.5;
      dv.whistleDroneWaveDepthGain.gain.setTargetAtTime(dp.whistleDroneWaveDepth * t, now, 0.3);
    }
  }

  setDroneParam(key, value) {
    if (!(key in this.droneParams)) return;
    this.droneParams[key] = value;
    if (!this.droneOn || !this.droneVoices) return; // takes effect next time the drone starts
    const dv = this.droneVoices;
    const now = this.ctx.currentTime;
    const glide = (param, v) => param.setTargetAtTime(v, now, 0.08);
    switch (key) {
      case "busGain": glide(dv.bus.gain, value); break;
      // givenGain/receivedGain/madeGain are retired -- there's one shared
      // ringGain now (busGain governs overall level; the per-ring sliders
      // used to set that node's own baseline, which pulseDrone's swell no
      // longer varies by ring).
      case "breathPulsesPerCycle":
        glide(dv.voiceLfo.frequency, this._masterPulsesPerSecond / value);
        break;
      case "breathDepth":
        glide(dv.voiceLfoDepth.gain, value);
        break;
      case "vibratoCyclesPerPulse":
        glide(dv.vibratoLfo.frequency, this._masterPulsesPerSecond * value);
        break;
      case "vibratoCents":
        glide(dv.vibratoDepth.gain, value);
        break;
      case "breathNoiseGain":
        glide(dv.noiseGain.gain, value);
        break;
      case "formantF1Q": glide(dv.f1.Q, value); break;
      case "formantF2Q": glide(dv.f2.Q, value); break;
      case "formantBlendGain": glide(dv.formantBlend.gain, value); break;
      case "moveFilterHz": glide(dv.moveFilter.frequency, value); break;
      case "moveFilterPulsesPerCycle": glide(dv.filterLfo.frequency, this._masterPulsesPerSecond / value); break;
      case "moveFilterDepthHz": glide(dv.filterLfoDepth.gain, value); break;
      case "bassBoostHz": glide(dv.bassBoost.frequency, value); break;
      case "bassBoostDb": glide(dv.bassBoost.gain, value); break;
      case "droneSubharmonicAmount": glide(dv.subGain.gain, value); break;
      // WaveShaperNode.curve isn't an AudioParam -- rebuilt fresh on
      // change (see buildSaturationCurve's own comment on why that's fine).
      case "droneSaturationAmount": dv.droneSaturator.curve = buildSaturationCurve(value); break;
      // Growl and throat/kargyraa -- relocated here from the flute (see
      // DEFAULT_DRONE_PARAMS' own comment). No register to crossfade
      // against on the drone (its pitch is fixed), so amount/level params
      // drive their gains directly rather than through a continuous
      // brightness-tick update the way the flute's version had to.
      case "droneGrowlAmount":
        glide(dv.droneGrowlF1Gain.gain, value);
        glide(dv.droneGrowlF2Gain.gain, value);
        break;
      case "droneGrowlF1Hz":
        glide(dv.droneGrowlF1.frequency, value);
        break;
      case "droneGrowlF2Hz":
        glide(dv.droneGrowlF2.frequency, value);
        break;
      case "droneGrowlQ":
        glide(dv.droneGrowlF1.Q, value);
        glide(dv.droneGrowlF2.Q, value);
        break;
      case "droneGrowlWanderHz":
        glide(dv.droneGrowlWanderLfo1.frequency, value);
        glide(dv.droneGrowlWanderLfo2.frequency, value);
        break;
      case "droneGrowlWanderDepth":
        glide(dv.droneGrowlWanderDepth1.gain, value);
        glide(dv.droneGrowlWanderDepth2.gain, value);
        break;
      case "droneGrowlSaturationAmount":
        dv.droneGrowlSaturatorF1.curve = buildSaturationCurve(value);
        dv.droneGrowlSaturatorF2.curve = buildSaturationCurve(value);
        break;
      case "droneThroatAmount": glide(dv.droneThroatLevelGain.gain, value); break;
      case "droneThroatSubharmonicAmount": glide(dv.droneThroatSubGain.gain, value); break;
      // All of these feed the _applyFluteLayerLevel formula (several at
      // once, per the coupling comment on that method) -- update the
      // param, then recompute every layer from it, rather than
      // duplicating pieces of that formula per case.
      case "whistleAmount":
      case "whistleToneColorRatio":
      case "whistleVibratoAmpDepth":
        dv.whistleLayers.forEach((_, i) => this._applyFluteLayerLevel(dv, this.droneParams, i, now));
        break;
      case "whistleChamberAmountDb":
      case "whistleChamberQ":
      case "whistleChamberModes":
      case "whistleChamberPipe":
        this._applyChamberModes();
        break;
      // drone-wave (high-register wooden-flute character, the one half of
      // "the flute is missing a drone in itself" that stayed on the
      // flute) -- amount/depth aren't glided directly, they're the CEILING
      // the register crossfade scales, so re-running the same continuous
      // update the tick loop already does is what actually applies them.
      case "whistleDroneWaveDepth":
        this._updateFluteBrightness(dv, this.droneParams, now);
        break;
      case "whistleDroneWaveCyclesPerRingPulse":
        glide(dv.whistleDroneWaveLfo.frequency, this._masterPulsesPerSecond / value);
        break;
      // whistleVibratoRingSpreadPercent is retired -- it existed only to
      // keep three SIMULTANEOUS vibrato LFOs from locking into a chorus
      // effect; moot with one shared LFO, nothing left to desync from.
      case "whistleVibratoRateHz":
        glide(dv.whistleVibratoLfo.frequency, value);
        break;
      case "whistleVibratoCents":
        dv.whistleLayers.forEach((layer) => glide(layer.vibratoPitchDepth.gain, value));
        break;
      // A small, fixed spread BETWEEN this voice's own cluster voices
      // (real independent pipes don't land on the exact same cent) rather
      // than within one voice's own oscillator pair -- see
      // buildFluteToneLayer's voiceIndex handling.
      case "whistleDetuneCents":
        dv.whistleLayers.forEach((layer, i) => {
          const sign = i % 2 === 0 ? -1 : 1;
          layer.source.detune.setTargetAtTime(sign * (value / 2), this.ctx.currentTime, 0.05);
        });
        break;
      // whistleVoicing (the authored {ratio, level} table) is retired --
      // see this._whistleActiveVoices/meanderFlute/src/voicing.js. No case
      // needed: the native voicing engine recomputes on every real word
      // hit, not from a standing table a slider could edit.
      case "whistleBreathAmount":
        this._applyFluteBreathLevel(dv, this.droneParams, now);
        break;
      // "Tailored control over modal arrangement" -- the scale just
      // changed, so every voice needs its actual sounding pitch
      // re-quantized against it immediately (the underlying target hasn't
      // moved, only where it gets snapped to).
      case "whistleScale": {
        const targetHz = this._fluteFundamentalHz();
        dv.whistleLayers.forEach((layer) => {
          const quantizedHz = this._fluteLayerHz(targetHz, layer.octaveMult);
          glide(layer.source.playbackRate, quantizedHz / layer.sampleBaseHz);
        });
        break;
      }
      // Recomputes from the voice's own current pitch, not a flat number
      // -- see whistleBreathColorRatio.
      case "whistleBreathColorRatio": {
        const targetHz = this._fluteFundamentalHz();
        glide(dv.whistleBreathColorFilter.frequency, this._breathColorHzFor(targetHz, value));
        break;
      }
      // "It just sounds like an organ patch" -- rescales BOTH the layer
      // and breath coupling depths together, since this one param is what
      // ties tone and breath into a single correlated system.
      // Tone-only now (see _applyFluteBreathLevel -- breath no longer has
      // its own coupling tap).
      case "whistleBreathToneCoupling":
        dv.whistleLayers.forEach((_, i) => this._applyFluteLayerLevel(dv, this.droneParams, i, now));
        break;
      // "Still reads as a digital pipe organ" -- both feed
      // _updateFluteBrightness's formula, so both just rerun it against
      // the voice's own already-current pulse rate rather than waiting
      // for the next animation-frame tick.
      case "whistleBrightnessTempoSensitivity":
      case "whistleBrightnessReferencePps":
        this._updateFluteBrightness(dv, this.droneParams, now);
        break;
      // whistleChiffAmount/whistleArticulationAmount/
      // whistleNoteGateDipAmount/whistleArticulationPulseFraction need no
      // case -- all read live by meanderFlute at the moment of the next
      // real hit.
      case "whistleBoxHz": glide(dv.whistleBox.frequency, value); break;
      case "whistleBoxQ": glide(dv.whistleBox.Q, value); break;
      case "whistleBoxAmountDb": glide(dv.whistleBox.gain, value); break;
      case "whistleManualRatio": {
        // Manual/fallback pitch -- when whistleFollowsWheel is off, this
        // is the ONE flute pitch control, a single user-facing slider (not
        // a per-ring real-hit event), so moving it retunes the one voice
        // directly. Glides, same as a real letter-hit would, rather than
        // snapping. No-ops harmlessly while following is on (the next real
        // word overwrites it anyway).
        this._whistleChordRootHz = this._effectiveDroneBaseHz() * value;
        const targetHz = this._fluteFundamentalHz();
        dv.whistleLayers.forEach((layer) => {
          const layerHz = targetHz * layer.octaveMult;
          const quantizedHz = this._fluteLayerHz(targetHz, layer.octaveMult);
          glide(layer.source.playbackRate, quantizedHz / layer.sampleBaseHz);
          glide(layer.toneColorFilter.frequency, this._toneColorHzFor(layerHz, this.droneParams.whistleToneColorRatio, this._whistleBrightnessMult));
        });
        break;
      }
      // whistleVoicingArcSpokesPerOctave/whistleGlideMs need no case --
      // the former only affects the target the NEXT real hit's voiceWord
      // call computes; glide-time only affects how a FUTURE glide is
      // shaped, not anything currently sounding. whistleBreathSurgeAmount
      // is read live by meanderFlute at the moment of the next real hit,
      // same reason.
    }
  }

  // "Can we add an option to isolate just the flutes for testing?" -- mutes
  // every NON-flute source at the shared gate every one of them routes
  // through (bass drone, playNote hits, hocket ghost-taps -- see
  // _nonFluteGate/ensureContext; the resultant-rhythm percussion engine
  // deliberately does NOT route through here, see _percussionGate's own
  // comment), leaving the flute's own whistleBox output completely
  // untouched. Per-ring drone/flute mute (setDroneMute, dp-mute-*) is
  // retired -- there's only one instance of each now.
  setFluteSolo(on) {
    this._fluteSoloOn = !!on;
    if (!this.ctx || !this._nonFluteGate) return;
    const now = this.ctx.currentTime;
    this._nonFluteGate.gain.setTargetAtTime(this._fluteSoloOn ? 0 : 1, now, 0.05);
  }

  // Just a stored number -- no AudioParam, no scheduling, read fresh by
  // playPercussionHit's own accumulator gate at the moment of each real
  // hit. Deliberately NOT a scheduled/automated value (the exact class of
  // bug pulseDrone's own pitch nudge just was); main.js pushes a fresh
  // number every frame, same pattern as setProcessionPulseRate.
  setPercussionDensity(density) {
    this._percussionDensity = Math.max(0, Math.min(1, density));
  }

  // Real wheel state driving the drone directly, not an approximation of
  // it: called once per ACTUAL pulse a ring's own RingRunner fires (see
  // sequencer.js's onPulse), so the drone's rhythm is exactly the wheel's
  // rhythm, not a free-running LFO guessing at the same tempo and slowly
  // drifting out of phase with it. This is also literally what real
  // didgeridoo playing is: a continuous tone with rhythmic tongued
  // articulation ("dugu-dugu") pulsed in time with the music, plus the
  // classic "wah-wah" -- a tongue/mouth-shape articulation timed to the
  // same pulse, not a separately-clocked filter sweep.
  //
  // The swell height is read live from droneParams every call, not
  // captured once at drone-start -- so a ring's level slider (previously
  // hard to judge inside a static sustained chord) now visibly changes
  // the size of every beat, which is a much more legible way to feel what
  // that lever does than a subtle balance shift in a held chord.
  // "One driving bass drone... modulated by a set of the ring/spoke
  // parameter states." Fires on EVERY ring's own raw pulse, same as
  // always -- but there's one shared voice to swell now, not that ring's
  // own separate one. Ring identity lives in the gain-swell/wah/F2-steer
  // below, same as it always has.
  //
  // A per-partial PITCH nudge toward RING_RATIO[ring] briefly lived here
  // too -- removed. "Obnoxious wavering bass oscillation": at the fixed
  // 72 BPM anchor, given/received/made's raw pulses arrive combined at
  // ~7.8/sec (~128ms apart), FASTER than that nudge's own 150ms settle
  // time constant -- every call cancelled the previous one's return to
  // root before it ever got there, so the pitch was permanently in
  // motion across all 16 partials, never resolving. The general rule this
  // confirms: any cancelScheduledValues+reschedule pair driven by a live,
  // recurring event stream needs its own settle time SHORTER than that
  // stream's typical inter-arrival time, or it will never actually
  // resolve -- check the trigger rate before adding one, not just the
  // sound of a single call in isolation. meanderFlute's equivalent
  // per-event color is correctly tied to real hits (rare, main.js's
  // onNoteHit) rather than raw pulses (constant) -- pulseDrone's mistake
  // was using the wrong one of those two triggers, not the idea of ring
  // color itself. Not replaced with a rarer-triggered version either --
  // "optimize/simplify... fewer open ends" argues for landing back on the
  // swell alone (solid for this whole session) rather than adding a new
  // lever to route around the one that just broke.
  pulseDrone(ring, spoke) {
    if (!this.droneOn || !this.droneVoices) return;
    const dv = this.droneVoices;
    const dp = this.droneParams;
    const now = this.ctx.currentTime;
    const baseGain = 1; // the ONE voice's own gain node -- busGain governs overall level

    const g = dv.ringGain.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(baseGain * 1.6, now, 0.02); // tongued attack
    g.setTargetAtTime(baseGain, now + 0.05, 0.12); // settles before the next pulse at any normal tempo

    const mf = dv.moveFilter.frequency;
    mf.cancelScheduledValues(now);
    mf.setTargetAtTime(dp.moveFilterHz + dp.moveFilterDepthHz * 0.8, now, 0.015); // "wah"
    mf.setTargetAtTime(dp.moveFilterHz, now + 0.06, 0.1);

    // "Received" steers the shared formant's F2, the front/back axis --
    // kept exclusive to this ring (it no longer "leads" via a higher base
    // gain, since there's only one shared gain now, but it's still this
    // wheel's own middle-speed, middle ring, a reasonable single owner for
    // one continuous formant lever rather than three rings fighting over
    // it). Spoke 1 (I) reads as this drone's own "vertical" color, spoke 7
    // (O) as its resting "neutral" -- the same two targets setVowelFormant
    // already uses for typed content -- interpolated smoothly around the
    // wheel between them by spoke angle. A typed vowel still briefly
    // overrides this (see setVowelFormant); the wheel's own rotation is
    // what leads it the rest of the time. Flagged the same way the sweep
    // direction is (see sequencer.js's header): this prototype's
    // interpretation of "formant should track wheel state," not a claim
    // about settled phonetics -- there's no established front/back-per-spoke
    // law yet to derive it from instead.
    if (ring === "received") {
      const NEUTRAL_F2 = 950;
      const VERTICAL_F2 = 1500;
      const blend = (1 + Math.cos(spokeAngle(spoke))) / 2; // 1 at spoke 1, 0 at spoke 7
      const f2Target = NEUTRAL_F2 + (VERTICAL_F2 - NEUTRAL_F2) * blend;
      dv.f2.frequency.setTargetAtTime(f2Target, now, 0.15);
    }

    // The relocated throat/kargyraa voice's own per-hit accent (see
    // droneThroatAmount) -- the drone has no per-note pitch change to gate
    // off of the way the flute's meanderFlute did, so it rides the SAME
    // tongued-attack pulse the ring-gain swell above already uses.
    if (dv.droneThroatGateGain) {
      const tg = dv.droneThroatGateGain.gain;
      tg.cancelScheduledValues(now);
      tg.setTargetAtTime(1.25, now, 0.02);
      tg.setTargetAtTime(1, now + 0.05, 0.12);
    }

    // Triatonic flute no longer lives here -- it's a persistent voice
    // driven by real letter-hits instead of raw wheel rotation, but the
    // per-pulse drone effects above (gain-swell, wah, F2 sweep) still do
    // belong to pulseDrone; only the flute's own trigger moved out (see
    // meanderFlute, called from main.js's onNoteHit/onChordHit).
  }

  // Flute -- "one meandering flute drone/pad/melodic narrative." Called on
  // a real letter-hit (main.js's onNoteHit/onChordHit, the same branch
  // that calls playNote), but unlike playNote this does NOT build a new
  // voice or trigger an envelope. The ONE flute voice is PERSISTENT (built
  // once in setDroneVoices) and stays sustained continuously -- "it needs
  // to carry the continuity of the tonal ring it's emulating, a consistent
  // backdrop." A real hit retunes THE voice to a new harmonic -- quickly
  // (whistleGlideMs, now just long enough to avoid a click, NOT an audible
  // portamento; "there shouldn't be note lerp on a flute" -- a real
  // player's pitch changes cleanly between fingerings, it doesn't slide).
  // "Narrative, meandering, resolving" lives in the sustained tone's own
  // vibrato/breath/articulation now, not in an audible glide between
  // distinct notes.
  //
  // Register now comes from RING_OCTAVE_MULTIPLIER (the same low-to-high-
  // by-speed convention playNote/playPercussionHit already use), not
  // RING_RATIO -- an earlier phase built three genuinely independent
  // pipes, one per ring, each permanently in its own register ("true
  // polyphony," a real, deliberate design). "One driving bass drone, one
  // meandering flute narrative" replaces that with ONE voice whose
  // register/pitch keeps getting reassigned by whichever ring's real hit
  // arrives -- asynchronously, at the actual 6:8:12 relationship, so the
  // narrative itself is driven by all three tempos rather than tripled by
  // them. Still only fires on the ring that actually triggered it; what
  // changed is that every ring now retunes the SAME shared voice instead
  // of each owning a separate one.
  // `wordSpokes` is the current word's own letters' spokes, IN ORDER, WITH
  // repeats (already transposed -- main.js's onNoteHit/onChordHit build
  // this the same way they build every other real pitch), `rootSpoke` its
  // own chord root (by convention, the word's first letter). Both are
  // ignored when whistleFollowsWheel is off (the manual/fallback path
  // needs neither -- see whistleManualRatio).
  meanderFlute(ring, wordSpokes, rootSpoke) {
    if (!this.droneOn || !this.droneVoices) return;
    const dp = this.droneParams;
    const dv = this.droneVoices;
    const now = this.ctx.currentTime;

    this._whistleLastRing = ring;
    const glideTc = Math.max(0.02, dp.whistleGlideMs) / 1000;

    // "The ability for one note to flourish/change while the rest of the
    // instrument drones continuously" -- slot 0 is ALWAYS a held pedal
    // voice (ratio locked to the chord root), never part of voiceWord's
    // own chord. The remaining WHISTLE_MAX_VOICES-1 slots carry the real
    // chord exactly as before. See the per-layer loop below for how the
    // pedal/lead/companion tiers actually differ in behavior.
    const normalizedRoot = normalizeSpoke(rootSpoke);
    const pedalRootChanged = this._whistlePedalRootSpoke === null || normalizedRoot !== this._whistlePedalRootSpoke;
    this._whistlePedalRootSpoke = normalizedRoot;
    const pedalVoice = { ratio: 1, level: dp.whistlePedalLevel, isPedal: true, isLead: false };

    // The native voicing engine (src/voicing.js) -- every word's own real
    // letters compute their own chord, replacing the old cosine-by-spoke-
    // angle harmonic sweep entirely. See the "native chord-voicing engine"
    // plan for the full rationale.
    if (this.whistleFollowsWheel && wordSpokes && wordSpokes.length) {
      const dronePitchClass = rotateSpoke(DRONE_POLE_SPOKE, this._transpositionOffsetSpokes);
      const { voices, pcSpokes } = voiceWord(wordSpokes, rootSpoke, {
        arcSpokesPerOctave: dp.whistleVoicingArcSpokesPerOctave,
        dronePitchClass,
        previousPcSpokes: this._whistlePreviousPcSpokes,
        previousVoicing: this._whistlePreviousVoicing,
        maxVoices: WHISTLE_MAX_VOICES - 1,
      });
      this._whistlePreviousVoicing = voices;
      this._whistlePreviousPcSpokes = pcSpokes;
      // Root voice loudest (and the one LEAD voice -- see the per-layer
      // loop below); a real companion voice (rule 2) a shade under it; a
      // mirror-echo doubling (rule 4) softer still, since it's an echo of
      // a voice already sounding, not new content -- same "root loudest,
      // companions softer" shape the old authored table used (1 / 0.6 /
      // 0.5), just assigned by role now, not by fixed ratio.
      this._whistleActiveVoices = [pedalVoice, ...voices.map((v) => {
        const isLead = !v.isDoubling && v.spoke === normalizedRoot;
        return { ratio: v.ratio, level: v.isDoubling ? 0.45 : isLead ? 1 : 0.6, isPedal: false, isLead };
      })];
      this._whistleChordRootHz = hzForSpoke(rootSpoke);
    } else if (!this.whistleFollowsWheel) {
      // Manual/fallback -- a single static voice at whatever
      // whistleManualRatio last set (see setDroneParam), unrelated to any
      // real word; a real hit still articulates (the gate/breath/chiff
      // below all still fire), it just doesn't change pitch. No pedal
      // here -- this path is an explicit non-wheel fallback, not the
      // musical drone/flourish feature.
      this._whistleActiveVoices = [{ ratio: 1, level: 1, isPedal: false, isLead: true }];
    }
    this._applyWhistleVoicesToLayers(dv, dp, now);
    const targetHz = this._fluteFundamentalHz();

    // Derived, not arbitrary -- "as many parameters as possible should
    // derive/infer timing from the wheel/input/transform state itself."
    // This ring's own CURRENT pulse duration (same quantity
    // setProcessionPulseRate already computes for breath/vibrato rate)
    // sets how long the whole note-change gate below takes, so a fast
    // procession gets snappy, tongued transitions and a slow one gets
    // more relaxed ones -- articulation speed scales with tempo instead
    // of sitting at a fixed ms regardless of how fast the piece moves.
    const ringPulsesPerSecond = Math.max(0.5, this._masterPulsesPerSecond * ringSpeedMultiplier(ring));
    const pulseSec = 1 / ringPulsesPerSecond;
    const gateSec = Math.max(0.03, pulseSec * dp.whistleArticulationPulseFraction);
    // Three phases of that one derived window: a quick DIP (the tongue
    // stops the air column), then the pitch change happens hidden inside
    // it, then a fast ATTACK and a slower DECAY back to steady.
    const dipSec = gateSec * 0.25;
    const attackSec = gateSec * 0.15;
    const decayTc = gateSec * 0.6;

    // "There needs to be some kind of note envelope/gate per voice/tone
    // that allows seamless droning while a single tone is allowed to
    // organically change notes with a proper flute-note-change sound
    // profile... it still sounds like a synth, not a flute changing
    // notes." The glide above already stopped the pitch from SLIDING
    // between notes; it never stopped the tone from smoothly retuning IN
    // PLACE, which is its own synth-like cue -- a real flute's tone
    // briefly stops speaking between notes (tongued articulation), it
    // doesn't just quietly change pitch underneath a continuous sustain.
    // Dip first (whistleNoteGateDipAmount), retune AT the bottom of the
    // dip (masks the fingering transition, the same reason real players
    // tongue there), then attack/decay back to steady -- never fully to
    // zero, so the ring's own continuity ("it needs to carry the
    // continuity of the tonal ring... a consistent backdrop") still
    // holds even during the gate.
    //
    // "The ability for one note to flourish/change while the rest of the
    // instrument drones continuously" -- three tiers now, not one uniform
    // treatment: the PEDAL holds (no gate/surge at all, and only retunes
    // on an actual root change, slowly); the LEAD gets the full gate/surge
    // articulation, the one voice that actually "flourishes"; COMPANIONS
    // retune pitch to follow the chord but skip the surge -- they support
    // harmonically without competing for attack-transient attention.
    dv.whistleLayers.forEach((layer) => {
      if (layer.isPedal) {
        if (!pedalRootChanged) return; // held -- this hit doesn't touch it at all
        const layerHz = targetHz * layer.octaveMult;
        const quantizedHz = this._fluteLayerHz(targetHz, layer.octaveMult);
        const pedalGlideTc = Math.max(0.02, dp.whistlePedalGlideMs) / 1000;
        layer.source.playbackRate.setTargetAtTime(quantizedHz / layer.sampleBaseHz, now, pedalGlideTc);
        layer.toneColorFilter.frequency.setTargetAtTime(
          this._toneColorHzFor(layerHz, dp.whistleToneColorRatio, this._whistleBrightnessMult), now, pedalGlideTc);
        return; // no toneSurge -- the pedal never re-articulates
      }

      const layerHz = targetHz * layer.octaveMult;
      const quantizedHz = this._fluteLayerHz(targetHz, layer.octaveMult);
      layer.source.playbackRate.setTargetAtTime(quantizedHz / layer.sampleBaseHz, now + dipSec, glideTc);
      layer.toneColorFilter.frequency.setTargetAtTime(
        this._toneColorHzFor(layerHz, dp.whistleToneColorRatio, this._whistleBrightnessMult), now + dipSec, glideTc);

      if (!layer.isLead) return; // companion -- pitch moves, no attack transient

      const toneSurge = layer.toneSurgeGain.gain;
      toneSurge.cancelScheduledValues(now);
      toneSurge.setValueAtTime(1, now);
      toneSurge.linearRampToValueAtTime(1 - dp.whistleNoteGateDipAmount, now + dipSec);
      toneSurge.linearRampToValueAtTime(1 + dp.whistleArticulationAmount, now + dipSec + attackSec);
      toneSurge.setTargetAtTime(1, now + dipSec + attackSec, decayTc);
    });

    // Breath -- "flourishes on note changes... a real player's breath
    // leads the embouchure settling on a new pitch, not the other way
    // around." Retimed to peak BEFORE dipSec (when pitch retuning
    // begins), not alongside it -- breathLeadSec is safely inside dipSec's
    // own 0.25 fraction, so the huff genuinely arrives first. Breath is a
    // shared, monophonic "wind source" for the whole instrument (not
    // per-voice), so this fires once per real hit exactly as it always
    // has, just retimed.
    const breathLeadSec = gateSec * dp.whistleBreathLeadFraction;
    const surge = dv.whistleSurgeGain.gain;
    surge.cancelScheduledValues(now);
    surge.setValueAtTime(1, now);
    surge.linearRampToValueAtTime(1 + dp.whistleBreathSurgeAmount, now + breathLeadSec);
    surge.setTargetAtTime(1, now + breathLeadSec, decayTc);

    // Chiff -- real breath noise BRIGHTENS momentarily at the attack (more
    // turbulence right as a note is re-tongued), not just louder. Leads
    // the pitch retune the same way the breath surge above does now.
    // "Just noise/static" was root-caused to this base value being a fixed
    // absolute Hz with no relationship to what pitch was actually playing
    // -- now this voice's own pitch-tracked base (see whistleBreathColorRatio),
    // retuned right alongside the pitch itself on every real hit.
    const breathColorBase = this._breathColorHzFor(targetHz, dp.whistleBreathColorRatio);
    const colorFreq = dv.whistleBreathColorFilter.frequency;
    colorFreq.cancelScheduledValues(now);
    colorFreq.setValueAtTime(breathColorBase, now);
    // Re-clamp after the chiff boost -- _breathColorHzFor's own 8000Hz
    // ceiling only bounds the STEADY value; multiplying it by (1+chiff)
    // afterward could otherwise punch back through that ceiling.
    //
    // Ramped (not a hard setValueAtTime step) -- an instantaneous filter-
    // cutoff jump is its own audible click on a biquad, a second
    // transient discontinuity stacked right on top of the chiff's own
    // intended brightening.
    colorFreq.linearRampToValueAtTime(Math.min(8000, breathColorBase * (1 + dp.whistleChiffAmount)), now + breathLeadSec);
    colorFreq.setTargetAtTime(breathColorBase, now + breathLeadSec, decayTc);
  }

  // sympatheticFlick (the sidechain-echo bend) is retired -- its entire
  // premise was "briefly BEND the TARGET ring's own already-sustained
  // flute pitch toward the source ring's note," which depended on each
  // ring having a separate voice to bend. Once there's one flute voice
  // (see meanderFlute/setDroneVoices), there is no longer a separate
  // target to bend toward -- removed cleanly along with its main.js
  // caller (triggerRingEchoes) and the view.js visual it fed, not
  // repurposed to quietly mean something else.

  // "Pick up a different flute for this key" -- the chamber's own root,
  // separate from the drone's fixed O anchor (_droneBaseHz). Called once
  // per Play from the phrase's own derived root (main.js), NOT from every
  // note change -- a real player doesn't retune their instrument's body
  // between notes, they choose which instrument to hold for the whole
  // section. Every mode in every ring's bank re-registers against the new
  // root (via RING_RATIO, same as every other per-ring pitch in this file)
  // and glides rather than jumps, matching every other retune path here.
  setChamberRoot(hz) {
    if (!(hz > 0)) return;
    this._chamberRootHz = hz;
    if (!this.droneOn || !this.droneVoices) return;
    this._applyChamberModes();
  }

  // "Cyclic transposition... denoting the modal shift currently at play" --
  // the flute's own PITCH follows this now, not just its chamber's
  // resonance color. `spokes` is the current transposition offset (0-11);
  // 2^(spokes/12) is the exact same 12-TET ratio hzForSpoke's own formula
  // already uses for every other spoke-to-Hz relationship in this engine.
  // Applied live via the same continuous _updateFluteBrightness tick every
  // other register-dependent thing here already rides (see
  // _effectiveDroneBaseHz) -- no new call sites at meanderFlute etc. needed.
  setTranspositionOffset(spokes) {
    this._transpositionRatio = Math.pow(2, (spokes || 0) / 12);
    // Kept as a raw spoke count too (not just the derived ratio) -- the
    // native voicing engine's rootless rule (meanderFlute) needs to know
    // which SPOKE the drone's pole tone currently sits on, not just its
    // Hz multiplier.
    this._transpositionOffsetSpokes = spokes || 0;
  }

  // The root every FLUTE pitch computation should read -- _droneBaseHz
  // scaled by the current transposition ratio. Deliberately NOT used by the
  // bass drone's own oscillator construction (which reads this._droneBaseHz
  // directly) -- that voice stays exactly fixed on O, the settled law this
  // session has restated at every prior phase. The flute merely used to
  // share that same fixed value as a convenient root reference; this
  // separates the two uses instead of leaving them conflated.
  _effectiveDroneBaseHz() {
    return (this._droneBaseHz || 0) * this._transpositionRatio;
  }

  // "Deriving the flute's melodic root from the phrase's own root spoke,
  // instead of always quantizing relative to the drone's fixed O anchor."
  // Real bug this fixes (MUSIC-STRUCTURE-PLAN.md F1): the derived scale
  // used to be expressed relative to spoke 1 (I) but every quantize call
  // applied it relative to O (spoke 7) -- a tritone off, always, whenever
  // "scale follows input" was on. main.js now derives the scale AND calls
  // `setMelodicRoot` together, both relative to the SAME root
  // (`rootSpoke`), so they can't mismatch again. Untransposed base is set
  // once per Play; scaled live by the SAME `_transpositionRatio` the
  // drone's O-anchor already uses, so a mid-phrase transposition step
  // moves the melodic root exactly as it moves everything else pitched.
  setMelodicRoot(hz) {
    this._melodicRootBaseHz = hz > 0 ? hz : 0;
  }

  // Falls back to 0 (not the drone's O-anchor) when no melodic root has
  // been set -- callers OR this against `_effectiveDroneBaseHz()`
  // themselves, so "no melodic root yet" (before the first Play, or while
  // a named mode preset -- explicitly root-on-O by design -- is active)
  // reads as "use O" without this method silently picking a wrong default.
  _effectiveMelodicRootHz() {
    return (this._melodicRootBaseHz || 0) * this._transpositionRatio;
  }

  // Re-applies the chamber-bank's own mode frequencies/gains/Q from the
  // current _chamberRootHz + params. Shared by setChamberRoot and the
  // whistleChamber* setDroneParam cases below -- same recompute either way,
  // only the trigger differs (root changed vs. a chamber param was tuned).
  _applyChamberModes() {
    const dp = this.droneParams;
    const dv = this.droneVoices;
    const now = this.ctx.currentTime;
    applyChamberModeParams(dv.whistleChamberBank, dp, this._chamberRootHz, now, 0.12);
  }

  ensureContext() {
    if (!this.ctx) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.ctx = ctx;

      this.master = ctx.createGain();
      this.master.gain.value = this.mixParams.mixMaster;

      // The leveler -- a genuine loudness-evener, distinct from the
      // limiter below. Slow (80ms attack, 500ms release, 30dB knee) so it
      // rides overall level rather than pumping on individual transients;
      // driven by ONE lever (mixLevelerAmount, setMixParam) that ramps
      // threshold/ratio together so 0 is truly transparent (ratio 1 = no
      // compression at all) and 1 is a real, audible even-out. `makeup`
      // restores the gain the compression stage removes so turning the
      // leveler up doesn't just make everything quieter.
      const leveler = ctx.createDynamicsCompressor();
      leveler.threshold.value = -6;
      leveler.ratio.value = 1;
      leveler.knee.value = 30;
      leveler.attack.value = 0.08;
      leveler.release.value = 0.5;
      const makeup = ctx.createGain();
      makeup.gain.value = 1;
      this.master.connect(leveler);
      leveler.connect(makeup);
      this._leveler = leveler;
      this._levelerMakeup = makeup;

      // Bus limiter -- headroom so the drone (below) can be pushed for real
      // presence/weight without risking harsh clipping on loud chords. Pure
      // peak safety (3ms attack) -- the leveler above is where any real
      // "even things out" tuning belongs; this stays untouched by it.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -8; // was -12 -- was quietly absorbing small ring-balance changes
      limiter.knee.value = 6;
      limiter.ratio.value = 3;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;
      makeup.connect(limiter);
      limiter.connect(ctx.destination);

      // Synthetic convolution reverb, parallel send -- gives length/space
      // ("timeless") without pretending to be a real room.
      const convolver = ctx.createConvolver();
      convolver.buffer = buildSyntheticImpulseResponse(ctx);
      this.reverbSend = ctx.createGain();
      this.reverbSend.gain.value = 0.55;
      this.reverbSend.connect(convolver);
      convolver.connect(this.master);

      this.dry = ctx.createGain();
      this.dry.gain.value = 0.8;
      this.dry.connect(this.master);

      // "Isolate just the flutes for testing" -- every NON-flute source
      // (the bass drone's own bassBoost output, every playNote/vowel-
      // preview one-shot voice) routes through this shared gate instead of
      // straight to dry/reverbSend; the flute's own whistleBox stays
      // connected directly and is never touched by it. setFluteSolo(true)
      // silences everything competing with the flute without silencing the
      // flute's own reverb send, so growl/chamber/breath-wave can be heard
      // in isolation rather than guessed at underneath everything else.
      this._nonFluteGate = ctx.createGain();
      this._nonFluteGate.gain.value = this._fluteSoloOn ? 0 : 1;
      this._nonFluteGate.connect(this.dry);
      this._nonFluteGate.connect(this.reverbSend);

      // The mixer -- per-instrument channel gains, one per voice family,
      // sitting between each voice's own output and the gate/bus it already
      // fed (see DEFAULT_MIX_PARAMS/setMixParam). chanDrone/chanNote feed
      // INTO _nonFluteGate (so flute-solo still silences them exactly as
      // before); chanFlute bypasses it exactly as whistleBox always has.
      // _percussionGate itself doubles as the percussion channel -- it
      // already did this job (see its own comment just below), so
      // mixPercussion drives its existing gain rather than adding a
      // redundant node.
      this._chanDrone = ctx.createGain();
      this._chanDrone.gain.value = this.mixParams.mixDrone;
      this._chanDrone.connect(this._nonFluteGate);
      this._chanNote = ctx.createGain();
      this._chanNote.gain.value = this.mixParams.mixNote;
      this._chanNote.connect(this._nonFluteGate);
      this._chanFlute = ctx.createGain();
      this._chanFlute.gain.value = this.mixParams.mixFlute;
      this._chanFlute.connect(this.dry);
      this._chanFlute.connect(this.reverbSend);

      // A targeted low-mid boost for the flute -- the register the de-
      // harshing pass's growl-amount reduction (see DEFAULT_DRONE_PARAMS)
      // pulled real weight from. Broad (Q 0.8, deliberately not a narrow
      // resonance -- that shape is exactly what caused the original
      // harshness) and aimable (mixFluteLowMidHz/mixFluteLowMidDb) rather
      // than fixed, so it can be tuned by ear against whatever the flute's
      // tone currently is.
      this._fluteLowMid = ctx.createBiquadFilter();
      this._fluteLowMid.type = "peaking";
      this._fluteLowMid.frequency.value = this.mixParams.mixFluteLowMidHz;
      this._fluteLowMid.Q.value = 0.8;
      this._fluteLowMid.gain.value = this.mixParams.mixFluteLowMidDb;
      this._fluteLowMid.connect(this._chanFlute);

      // Resultant-rhythm percussion -- its own bus, deliberately NOT
      // routed through _nonFluteGate: "not tangled with the existing
      // solo/mute machinery" (flute-solo silences competing pitched
      // voices to judge the flute alone; percussion is a structural
      // layer, not a competing melodic voice, so it stays audible under
      // flute-solo). Its level is mixPercussion (setMixParam) -- see the
      // mixer comment above.
      this._percussionGate = ctx.createGain();
      this._percussionGate.gain.value = this.mixParams.mixPercussion;
      this._percussionGate.connect(this.dry);
      this._percussionGate.connect(this.reverbSend);

      // The guitar/bass channel -- routes through _nonFluteGate like
      // chanDrone/chanNote (a real melodic/rhythmic voice competing with
      // the flute, not a structural layer like percussion, so flute-solo
      // silences it too). The rig itself (_ensureGuitarRig) is built
      // lazily, on the first real chug -- not here -- since nothing about
      // it depends on ensureContext's own one-time setup specifically,
      // matching the drone/flute's own "build the graph when it's first
      // actually needed" precedent (setDroneVoices).
      this._chanGuitar = ctx.createGain();
      this._chanGuitar.gain.value = this.mixParams.mixGuitar;
      this._chanGuitar.connect(this._nonFluteGate);

      // Metering -- one small analyser per channel plus the master output,
      // read by mixMeterLevels() (polled from main.js's existing tickRate
      // rAF loop, not a new one). Time-domain only -- RMS/clip-peek is all
      // the mixer panel needs, no need for an FFT.
      const tapAnalyser = (node) => {
        const a = ctx.createAnalyser();
        a.fftSize = 512;
        node.connect(a);
        return a;
      };
      this._meterDrone = tapAnalyser(this._chanDrone);
      this._meterNote = tapAnalyser(this._chanNote);
      this._meterFlute = tapAnalyser(this._chanFlute);
      this._meterPercussion = tapAnalyser(this._percussionGate);
      this._meterGuitar = tapAnalyser(this._chanGuitar);
      this._meterMaster = tapAnalyser(this.master);

      // "Real royalty-free flute/drone/woodwind sound plate" -- see
      // _loadRealBreathBuffer. Fire-and-forget: the flute's breath source
      // (setDroneVoices) uses whatever's ready at the moment it's built,
      // real sample once loaded or synthesized pink noise before then/if
      // it ever fails, never blocking drone start on a network fetch.
      this._loadRealBreathBuffer();
      // Same fire-and-forget deal for the flute's own pitched tone-core
      // sample -- see _loadRealFluteNoteBuffer.
      this._loadRealFluteNoteBuffer();
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  // "It might be improving, but there's still more of a keyboard
  // character than woodwind in all respects." Root cause, agreed on
  // explicitly rather than guessed at: 20 phases of synthesis-only fixes
  // (additive sine partials + a parallel noise layer, however cleverly
  // coupled and modulated) can't escape reading as "synthesizer," because
  // linear superposition of clean oscillators IS what a synthesizer/organ/
  // pad structurally is -- a real flute's breath noise comes from a
  // genuinely chaotic, non-periodic physical process with organic micro-
  // detail no procedural noise generator (white or pink) actually has. A
  // real recorded sample is the established, honest way most commercial
  // wind-instrument synths close exactly this gap. This is a real,
  // CC0-licensed (public-domain, no attribution required) flute/drone
  // texture recording -- see assets/samples/CREDITS.md -- used ONLY as the
  // shared breath-noise SOURCE, feeding the exact same per-ring pitch-
  // tracked color filter / turbulence wander / chiff / tone-coupling
  // machinery already built (see setDroneVoices) rather than replacing any
  // of that. RMS-normalized to roughly the same level the synthesized pink
  // noise buffer already had, so whistleBreathAmount's existing tuning
  // stays meaningful regardless of which source is actually active; edges
  // faded so the native Web Audio loop (AudioBufferSourceNode.loop = true)
  // doesn't click at the seam.
  async _loadRealBreathBuffer() {
    if (this._realBreathBuffer || this._realBreathBufferLoading) return;
    this._realBreathBufferLoading = true;
    try {
      const res = await fetch("assets/samples/flute-drone-plate.mp3");
      const arrayBuf = await res.arrayBuffer();
      const decoded = await this.ctx.decodeAudioData(arrayBuf);
      this._fadeBufferEdges(decoded, 0.35);
      this._normalizeBufferRms(decoded, 0.2, 15);
      this._realBreathBuffer = decoded;
      // Same deterministic "fetch never awaited, drone builds synchronously
      // right after" issue the flute-note sample had (see
      // _loadRealFluteNoteBuffer) -- swap the breath source over live if
      // the drone's already running on the synthesized-pink-noise fallback.
      if (this.droneOn && this.droneVoices) this._rebuildBreathSourceWithRealSample();
    } catch (e) {
      // Sample missing/unreachable/undecodable -- setDroneVoices already
      // falls back to _pinkNoiseBuffer() whenever this hasn't resolved.
    } finally {
      this._realBreathBufferLoading = false;
    }
  }

  // In-place linear fade at both ends of a decoded buffer, all channels --
  // a raw recording's own start/end amplitude has no reason to match, so
  // looping it via AudioBufferSourceNode.loop (a hard restart, no
  // crossfade) can click at the seam without this.
  _fadeBufferEdges(buffer, fadeSeconds) {
    const fadeSamples = Math.min(Math.floor(fadeSeconds * buffer.sampleRate), Math.floor(buffer.length / 4));
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < fadeSamples; i++) {
        const g = i / fadeSamples;
        data[i] *= g;
        data[data.length - 1 - i] *= g;
      }
    }
  }

  // In-place RMS normalization (all channels together) so a real
  // recording's own, unrelated loudness doesn't silently make
  // whistleBreathAmount's existing tuning meaningless. maxGain caps the
  // boost so a near-silent source can't get amplified into audible noise
  // floor/artifacts.
  _normalizeBufferRms(buffer, targetRms, maxGain) {
    let sumSq = 0, count = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) sumSq += data[i] * data[i];
      count += data.length;
    }
    const currentRms = Math.sqrt(sumSq / count);
    if (currentRms <= 0) return;
    const gain = Math.min(maxGain, targetRms / currentRms);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) data[i] *= gain;
    }
  }

  // "Is this a common issue people run into when trying to create a
  // synthesized flute? Is there a free asset we can use to just emulate
  // flute sounds?" Yes, and yes -- a real, well-documented ceiling, not
  // something missed: a flute's tone is spectrally simple (mostly the
  // fundamental, a weak 2nd harmonic), which is precisely what makes it
  // HARD to synthesize -- a rich, complex tone masks synthesis artifacts
  // in its own harmonic mess; a near-pure tone exposes every one instantly.
  // Every real commercial flute/woodwind instrument is either fully
  // sample-based or built on serious physical-modeling DSP (a real
  // waveguide simulation of an air column, well beyond a lightweight
  // oscillator-based prototype); nobody ships a convincing flute from
  // oscillators plus noise. See buildFluteToneLayer -- this is the
  // standard, actually-used fix: one real recorded note, pitch-shifted via
  // playbackRate, replacing the additive oscillator stack entirely.
  // Fire-and-forget from ensureContext, same non-blocking pattern as
  // _loadRealBreathBuffer.
  // "Flute sound is not audible at all" -- a silent, un-diagnosable
  // failure was a real gap here: any fetch/decode problem (a 404 that
  // still returns a normal-looking HTML body, a dev server serving the
  // wrong content type, a transient network hiccup) was swallowed with no
  // trace, leaving the tone core on the near-silent placeholder buffer
  // FOREVER with nothing in the console to explain why. Now: an explicit
  // res.ok check (so a 404's own HTML body doesn't get silently handed to
  // decodeAudioData and fail for an unrelated-looking reason), a few
  // retries with backoff for anything transient, and a console.warn on
  // final failure that actually says what happened -- this can never fix
  // a genuinely broken path by itself, but it turns "silent, mysterious
  // failure" into "check the console, here's why."
  //
  // Multisampled (see FLUTE_SAMPLES): kicks off all files' fetches in
  // parallel, each with its own independent retry, rather than one file
  // gating the rest. Fires the same live hot-swap ("flute sound is not
  // audible at all"'s actual fix -- see _rebuildFluteToneCoreWithRealSample)
  // after EVERY sample that finishes loading, not just the first -- so as
  // more samples arrive, layers progressively upgrade to a closer-matched
  // sample instead of waiting for every file before any of them help.
  _loadRealFluteNoteBuffer() {
    if (this._fluteSampleLoadStarted) return;
    this._fluteSampleLoadStarted = true;
    FLUTE_SAMPLES.forEach((sample) => this._loadOneFluteSample(sample, 1));
  }

  async _loadOneFluteSample(sample, attempt) {
    try {
      const res = await fetch(`assets/samples/${sample.file}`);
      if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status}`);
      const arrayBuf = await res.arrayBuffer();
      const decoded = await this.ctx.decodeAudioData(arrayBuf);
      // Loop the STABLE sustain only (see assets/samples/CREDITS.md for
      // the measured envelope) -- the real attack/release transients sit
      // outside [loopStart, loopEnd] on purpose, preserved rather than
      // looped over. Fades both loop edges toward silence (same technique
      // as _fadeBufferEdges, applied to this sub-region instead of the
      // whole buffer) so the hard loop restart doesn't click -- multiple
      // simultaneous voices at different playbackRates loop at different
      // real-time intervals, so any one voice's brief seam is covered by
      // the others, not audible as a synchronized pulse.
      this._fadeLoopSeam(decoded, sample.loopStart, sample.loopEnd, 0.08);
      this._fluteSampleBuffers[sample.file] = decoded;
      // "Flute sound is not audible at all" -- the ACTUAL root cause,
      // deterministic, not a rare race: ensureContext fires these fetches
      // but never awaits them, and setDroneVoices runs synchronously right
      // after in the very same click handler -- there is NO window for
      // even a fast fetch to resolve in between, so the tone core is built
      // on the silent placeholder on literally every first "drone on"
      // click, every time. Rather than requiring a manual off/on toggle to
      // "self-heal" (which a real user has no reason to know to do), swap
      // every layer over to its now best-available real sample the instant
      // any one finishes loading, live, mid-drone if it's already running.
      if (this.droneOn && this.droneVoices) this._rebuildFluteToneCoreWithRealSample();
    } catch (e) {
      if (attempt < 3) {
        setTimeout(() => this._loadOneFluteSample(sample, attempt + 1), attempt * 1000);
      } else {
        console.warn(
          `Orphograph: flute sample ${sample.file} failed to load after 3 attempts -- ` +
          "any layer that would have used it falls back to the nearest OTHER loaded " +
          "sample instead (or a silent placeholder if none have loaded at all). Cause:", e,
          `-- check that assets/samples/${sample.file} is being served correctly ` +
          "(open that URL directly; it should download/play an mp3, not a 404 or an HTML page)."
        );
      }
    }
  }

  // Nearest available sample to targetHz, compared in log-Hz (semitone)
  // space so "nearest" means smallest pitch-shift, not smallest raw Hz
  // difference -- the whole point of multisampling is keeping every
  // layer's playbackRate stretch small. Falls back to a silent placeholder
  // (baseHz set to targetHz itself, so playbackRate is a harmless 1x) if
  // NOTHING has loaded yet -- the same narrow startup race the single-
  // sample version already handled, now generalized to "zero of seven"
  // rather than "the one."
  _pickFluteSample(targetHz) {
    const loadedFiles = FLUTE_SAMPLES.filter((s) => this._fluteSampleBuffers[s.file]);
    if (!loadedFiles.length) {
      return { buffer: this._silentPlaceholderBuffer(), baseHz: targetHz > 0 ? targetHz : 264.7, loopStart: 0, loopEnd: 0 };
    }
    let best = loadedFiles[0], bestDist = Infinity;
    for (const s of loadedFiles) {
      const dist = Math.abs(Math.log2((targetHz || s.baseHz) / s.baseHz));
      if (dist < bestDist) { bestDist = dist; best = s; }
    }
    return { buffer: this._fluteSampleBuffers[best.file], baseHz: best.baseHz, loopStart: best.loopStart, loopEnd: best.loopEnd };
  }

  // Swaps every tone-core layer from the silent placeholder over to the
  // real sample, live, mid-drone -- see the call site in
  // _loadRealFluteNoteBuffer for the full "why." AudioBufferSourceNode's
  // own buffer can only be set once, before start() (a hard Web Audio
  // constraint, not a choice) -- there is no way to hot-swap an existing
  // source's buffer, so this stops each old (placeholder) source and
  // builds a genuinely new layer in its place, preserving that layer's
  // current ratio/level and retuning it to the voice's actual current
  // pitch immediately (never to a stale/placeholder frequency).
  _rebuildFluteToneCoreWithRealSample() {
    const dv = this.droneVoices;
    const dp = this.droneParams;
    const targetHz = this._fluteFundamentalHz();
    dv.whistleLayers = dv.whistleLayers.map((oldLayer, i) => {
      oldLayer.source.stop();
      const layerHz = this._fluteLayerHz(targetHz, oldLayer.octaveMult);
      const sample = this._pickFluteSample(layerHz);
      const newLayer = buildFluteToneLayer(
        this.ctx, dp, oldLayer.octaveMult, oldLayer.levelScale, layerHz,
        dv.whistleVibratoLfo, dv.wanderLowpass, sample, i
      );
      newLayer.output.connect(dv.whistleMuteGain);
      return newLayer;
    });
  }

  // Same idea as _rebuildFluteToneCoreWithRealSample, for the ONE shared
  // breath noise source instead of the per-ring-per-voice tone layers.
  _rebuildBreathSourceWithRealSample() {
    const dv = this.droneVoices;
    dv.whistleSharedNoise.stop();
    const newSource = this.ctx.createBufferSource();
    newSource.buffer = this._realBreathBuffer;
    newSource.loop = true;
    newSource.connect(dv.breathShape);
    newSource.start();
    dv.whistleSharedNoise = newSource;
  }

  // In-place fade toward silence at both edges of a LOOP SUB-REGION
  // (not the whole buffer -- see _fadeBufferEdges for that version, used
  // for the whole-buffer breath loop instead).
  _fadeLoopSeam(buffer, loopStartSec, loopEndSec, fadeSeconds) {
    const sr = buffer.sampleRate;
    const loopStartSample = Math.floor(loopStartSec * sr);
    const loopEndSample = Math.floor(loopEndSec * sr);
    const fadeSamples = Math.min(Math.floor(fadeSeconds * sr), Math.floor((loopEndSample - loopStartSample) / 4));
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < fadeSamples; i++) {
        const g = i / fadeSamples;
        data[loopStartSample + i] *= g;
        data[loopEndSample - i] *= g;
      }
    }
  }

  // One "figure" note -- marimba/harp hybrid: a plucked/struck attack that
  // stays soft rather than biting, a warm wooden body resonance rather
  // than a bright open tone. Unison-detuned oscillator stack (triangle +
  // sine only, no sawtooth -- that's the brightest/harshest waveform and
  // was the main source of the harshness), a brief filtered-noise
  // mallet/pluck transient for the attack instead of relying on harsh
  // oscillator content, a dark lowpass, and one wood-body resonance peak.
  // All of the filtering/resonance is read from this.noteParams live, so
  // it can be tuned by ear against `this.noteParams` while this stands in
  // for a physical instrument whose real resonance isn't built yet.
  // "Never had persistent per-ring state... what's missing is everything
  // that would let a listener tell which ring is speaking through the one
  // shared instrument without a register difference alone." An optional
  // `ring` colors THIS event -- pan position and a small detune-spread
  // nudge -- layered on top of the shared this.noteParams; omitted (MIDI's
  // own call site) leaves the voice centered/unnudged exactly as before.
  // `atTime` -- schedules against a caller-given AudioContext time instead
  // of always `ctx.currentTime`, the same addition playPercussionHit/
  // playGuitarChug already have -- needed so the pattern engine's own
  // high-register chirp layer (main.js's onPulse) can land its ghost-tier
  // hits at the exact same sub-pulse offset as everything else scheduled
  // in that loop. `null` (the default) preserves the exact old behavior
  // for every existing call site.
  playNote(hz, { duration = 1.1, bend = 0, velocity = 1, ring, atTime = null } = {}) {
    const ctx = this.ensureContext();
    const t0 = atTime != null ? atTime : ctx.currentTime;
    const p = this.noteParams;
    // The kalimba's own authored register -- see foldIntoRange. Applied
    // here, once, so every call site (origin ping, melody/chord hits, the
    // UI/keyboard preview, MIDI) is covered automatically rather than
    // needing the same fold copied at each one.
    hz = foldIntoRange(hz, p.floorHz, p.ceilingHz);

    // given left / received center / made right -- the same low-to-high,
    // slow-to-fast ring ordering used everywhere else here, expressed as a
    // stereo spread instead of a register this time (no StereoPannerNode
    // existed anywhere in this codebase before now).
    const pan = { given: -0.5, received: 0, made: 0.5 }[ring] ?? 0;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this._chanNote);

    // A few cents of ring-tinted detune spread -- subtle, not a pitch
    // change (RING_OCTAVE_MULTIPLIER at the main.js call site already
    // handles register); just enough that the SAME algorithm reads as
    // recognizably "this ring" by ear even at identical pitch/octave.
    const ringDetuneOffset = { given: -4, received: 0, made: 4 }[ring] ?? 0;

    const voiceBus = ctx.createGain();
    const detuneCents = [-6, 0, 6, 12];
    detuneCents.forEach((cents, i) => {
      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? "triangle" : "sine";
      osc.frequency.setValueAtTime(hz, t0);
      osc.detune.setValueAtTime(cents + ringDetuneOffset, t0);
      if (bend !== 0) {
        osc.frequency.linearRampToValueAtTime(hz * Math.pow(2, bend / 12), t0 + duration * 0.7);
      }
      const oscGain = ctx.createGain();
      oscGain.gain.value = i === 1 ? 0.5 : 0.22;
      osc.connect(oscGain);
      oscGain.connect(voiceBus);
      osc.start(t0);
      osc.stop(t0 + duration + 0.4);
    });

    // Pluck transient -- kalimba, not generic noise: a plucked metal tine
    // has a bright attack whose overtones are slightly INHARMONIC (real
    // tines aren't perfect harmonic oscillators), giving that faint
    // bell-like "ping" rather than a plain click. Filtered noise for the
    // broadband attack, plus one short detuned sine burst (a non-integer
    // ratio -- 3.83x, not 4x) for the metallic ping itself.
    const pluckMs = Math.max(1, p.pluckMs) / 1000;
    if (p.pluckAmount > 0) {
      const pluck = ctx.createBufferSource();
      pluck.buffer = this._noiseBuffer();
      const pluckFilter = ctx.createBiquadFilter();
      pluckFilter.type = "bandpass";
      pluckFilter.frequency.value = hz * 3;
      pluckFilter.Q.value = 1.4;
      const pluckGain = ctx.createGain();
      pluckGain.gain.setValueAtTime(p.pluckAmount * velocity, t0);
      pluckGain.gain.exponentialRampToValueAtTime(0.0001, t0 + pluckMs);
      pluck.connect(pluckFilter);
      pluckFilter.connect(pluckGain);
      pluckGain.connect(voiceBus);
      pluck.start(t0);
      pluck.stop(t0 + pluckMs + 0.02);

      const ping = ctx.createOscillator();
      ping.type = "sine";
      ping.frequency.value = hz * 3.83; // inharmonic -- a real tine's overtone, not a clean partial
      const pingGain = ctx.createGain();
      const pingMs = pluckMs * 0.7;
      pingGain.gain.setValueAtTime(p.pluckAmount * velocity * 0.6, t0);
      pingGain.gain.exponentialRampToValueAtTime(0.0001, t0 + pingMs);
      ping.connect(pingGain);
      pingGain.connect(voiceBus);
      ping.start(t0);
      ping.stop(t0 + pingMs + 0.02);
    }

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = p.lowpassHz;
    lowpass.Q.value = p.lowpassQ;
    voiceBus.connect(lowpass);

    // Wood-body resonance -- one warm peak standing in for the instrument
    // body (marimba resonator tube, harp soundboard), NOT the vocal
    // formant pair (that's specific to the drone/"O's voice").
    const body = ctx.createBiquadFilter();
    body.type = "peaking";
    body.frequency.value = p.bodyHz;
    body.Q.value = p.bodyQ;
    body.gain.value = p.bodyAmountDb;
    lowpass.connect(body);

    const env = ctx.createGain();
    const peak = 0.5 * velocity;
    const attackS = Math.max(0.001, p.attackMs) / 1000;
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + attackS); // fast -- struck/plucked, not a swell
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration + 0.35);
    body.connect(env);

    env.connect(panner);
  }

  // Ghost tap -- a hocket experiment. When a ring's own sweep passes a
  // letter belonging to a DIFFERENT tier, the ring-tier gate (main.js)
  // already goes silent rather than sounding it (L11) -- three voices at
  // three different speeds already trading off who sounds and who rests at
  // any given spoke is structurally a hocket (the medieval technique of
  // splitting a line across voices so one's rest is filled by another's
  // sound), it's just been INAUDIBLE as such: true silence carries no cue
  // that "this was this ring's beat, just not this ring's letter." A soft,
  // dry, non-pitched click standing in for that beat -- quiet and short
  // enough to read as a rhythmic marker, not a note -- makes the
  // already-existing interlocking structure actually audible as rhythm.
  //
  // Filter frequency is ring-tinted (given darkest/lowest, made
  // brightest/highest) so a listener can tell WHICH ring is resting by ear,
  // the same register-ordering already used for real notes
  // (RING_OCTAVE_MULTIPLIER: given lowest, made highest) -- consistent
  // per-ring identity whether a ring is sounding or resting.
  playGhostTap(ring, { velocity = 1 } = {}) {
    const ctx = this.ensureContext();
    const t0 = ctx.currentTime;
    const tickHz = { given: 900, received: 1400, made: 2200 }[ring] || 1400;

    const tap = ctx.createBufferSource();
    tap.buffer = this._noiseBuffer();
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = tickHz;
    filter.Q.value = 1.4;
    const gain = ctx.createGain();
    const peak = 0.09 * velocity; // deliberately much quieter than a real note -- a marker, not a hit
    gain.gain.setValueAtTime(peak, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.045);
    tap.connect(filter);
    filter.connect(gain);
    gain.connect(this._chanNote);
    tap.start(t0);
    tap.stop(t0 + 0.06);
  }

  // Resultant-rhythm percussion -- "one cohesive percussion pattern
  // array," genuinely independent of ghost-taps above (which only fills
  // the SILENCED gap left by tier-emphasis, and stays exactly as it is).
  // Every real hit, every ring, reaches this call unconditionally (see
  // main.js) -- a real resultant rhythm (the West/Central African
  // interlocking-bell technique, A.M. Jones): each ring's own asynchronous
  // 6:8:12 onsets, read together, become one composite pattern. Role by
  // speed, the SAME low-to-high-by-ring-speed convention already used
  // everywhere else here (RING_OCTAVE_MULTIPLIER; playGhostTap's own
  // tickHz map) -- given (slowest) = kick, received = snare, made
  // (fastest) = hat. One-shot, stateless, same shape as playGhostTap --
  // no persistent instance. Level (not mute) via _percussionGate/
  // setPercussionLevel, applied ONCE at the shared bus -- each hit's own
  // internal gains below are only its own kick/snare/hat balance, not a
  // second application of the overall level.
  //
  // "Ebbing and flowing with processions/across the full arc of
  // procession" -- whether a given CALL actually sounds is gated by
  // _percussionDensity, via the same accumulate-and-drain-past-1 idiom
  // sequencer.js already uses for pulse timing (see
  // _percussionDensityAccumulator's own comment) -- deterministic and
  // evenly spread, not a Math.random() thin-out. `accent` (ring
  // reversals, grand convergence -- see main.js) bypasses this gate
  // entirely and boosts every gain below: a structural accent marking a
  // genuinely rare event shouldn't be thinned by the same budget that
  // paces routine texture.
  // Returns true when it actually fired (an audible hit), false when the
  // density gate swallowed it -- lets a caller (view.js's hit ripples) tell
  // "a real percussion hit happened here" from "this ring's sweep merely
  // passed a beat the density arc chose to skip," rather than firing a
  // visual for every call regardless of whether anything was heard.
  // `gainMultiplier` -- a roll/flam grace-note echo (see main.js's
  // triggerPercussion): like `accent`, it bypasses the density gate (an
  // echo embellishes an already-decided real hit, it isn't a new
  // independent resultant-rhythm event to separately thin), but sets the
  // boost directly instead of accent's fixed 1.6x. Normal calls
  // (`accent=false, gainMultiplier=null, velocity=null`) are the exact
  // density-gated path this always had.
  // `velocity` -- an AUTHORED onset from the Euclidean pattern engine
  // (src/rhythm.js, see main.js's onPulse scheduler), not a geometric
  // resultant-rhythm hit. Same bypass reasoning as gainMultiplier -- a
  // pattern-decided onset already went through its own real decision
  // process (a computed rhythm, not a raw hit stream); it is not an
  // independent event for the density accumulator to ALSO thin ("one
  // onset, one decider"). Bypasses whenever explicitly passed, even at
  // exactly 1.0 (the pattern engine's own "normal" velocity tier) -- the
  // sentinel is "did the caller assert an onset happened," not "is the
  // boost non-default."
  // `atTime` -- schedules against a caller-given AudioContext time instead
  // of always `ctx.currentTime`. Needed for sub-pulse subdivision (the
  // pattern engine schedules several onsets within one ring pulse ahead
  // of time) -- `null` (the default) preserves the exact old behavior for
  // every existing call site.
  playPercussionHit(ring, { accent = false, gainMultiplier = null, velocity = null, atTime = null } = {}) {
    if (!accent && gainMultiplier === null && velocity === null) {
      const acc = this._percussionDensityAccumulator;
      acc[ring] += this._percussionDensity;
      if (acc[ring] < 1) return false;
      acc[ring] -= 1;
    }
    const boost = accent ? 1.6 : (gainMultiplier !== null ? gainMultiplier : (velocity !== null ? velocity : 1));
    const ctx = this.ensureContext();
    const t0 = atTime != null ? atTime : ctx.currentTime;
    const pp = this.percussionParams;

    if (ring === "given") {
      // Kick-owned sidechain duck on the guitar -- a real, established
      // production technique (kick ducking guitars/bass), and the direct
      // answer to the one remaining register overlap the mid-scoop/
      // highpass alone don't cover: the kick's own sweep top (150Hz)
      // against the guitar's fundamental region, under the drone's own
      // +12dB sub-140Hz lowshelf. No-ops harmlessly if the guitar rig was
      // never built (most performances never touch it).
      this._duckGuitar();
      // Kick -- a sine sweeping down fast (150Hz -> 50Hz over ~40ms, the
      // standard "click into thump" drum-synthesis recipe) plus a brief
      // lowpassed noise transient for the beater attack. Raised from 0.9:
      // the kick's own sweep sits entirely inside the drone's own
      // bassBoost region (below 140Hz, +9dB there) -- ordinary bass-vs-
      // kick masking, not a wiring bug (see _percussionLevel's own
      // comment). 1.4 gives it real headroom against the drone's own
      // ~1.13 aggregate bus level instead of sitting under it.
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(pp.kickFreqStart, t0);
      osc.frequency.exponentialRampToValueAtTime(pp.kickFreqEnd, t0 + pp.kickSweepMs / 1000);
      const oscGain = ctx.createGain();
      oscGain.gain.setValueAtTime(pp.kickGain * boost, t0);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, t0 + pp.kickDecayMs / 1000);
      osc.connect(oscGain);
      oscGain.connect(this._percussionGate);
      osc.start(t0);
      osc.stop(t0 + pp.kickDecayMs / 1000 + 0.03);

      // The click is the part most likely to actually cut through --
      // outside the masked sub-140Hz band. Raised and opened a little
      // brighter (800 -> 1400Hz) for the same reason real kick drums
      // always carry a beater-click transient in a bass-heavy mix.
      const click = ctx.createBufferSource();
      click.buffer = this._noiseBuffer();
      const clickFilter = ctx.createBiquadFilter();
      clickFilter.type = "lowpass";
      clickFilter.frequency.value = pp.kickClickLowpassHz;
      const clickGain = ctx.createGain();
      clickGain.gain.setValueAtTime(pp.kickClickGain * boost, t0);
      clickGain.gain.exponentialRampToValueAtTime(0.0001, t0 + pp.kickClickDecayMs / 1000);
      click.connect(clickFilter);
      clickFilter.connect(clickGain);
      clickGain.connect(this._percussionGate);
      click.start(t0);
      click.stop(t0 + pp.kickClickDecayMs / 1000 + 0.005);
    } else if (ring === "received") {
      // Snare -- the classic drum-machine recipe: two detuned tone
      // oscillators for body, plus bandpassed noise for the rattle. Less
      // contested than the kick's own band (see given, above) -- raised
      // proportionately, not as drastically.
      [[pp.snareToneHz1, pp.snareToneGain1], [pp.snareToneHz2, pp.snareToneGain2]].forEach(([hz, gain]) => {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = hz;
        const oscGain = ctx.createGain();
        oscGain.gain.setValueAtTime(gain * boost, t0);
        oscGain.gain.exponentialRampToValueAtTime(0.0001, t0 + pp.snareToneDecayMs / 1000);
        osc.connect(oscGain);
        oscGain.connect(this._percussionGate);
        osc.start(t0);
        osc.stop(t0 + pp.snareToneDecayMs / 1000 + 0.01);
      });
      const noise = ctx.createBufferSource();
      noise.buffer = this._noiseBuffer();
      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = "bandpass";
      noiseFilter.frequency.value = pp.snareNoiseBandHz;
      noiseFilter.Q.value = pp.snareNoiseQ;
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(pp.snareNoiseGain * boost, t0);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, t0 + pp.snareNoiseDecayMs / 1000);
      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(this._percussionGate);
      noise.start(t0);
      noise.stop(t0 + pp.snareNoiseDecayMs / 1000 + 0.01);
    } else {
      // Hat -- a short, high, fast-decaying highpassed noise burst. Least
      // contested band of the three (well above the drone's own harmonic
      // content) -- smallest proportional raise.
      const noise = ctx.createBufferSource();
      noise.buffer = this._noiseBuffer();
      const filter2 = ctx.createBiquadFilter();
      filter2.type = "highpass";
      filter2.frequency.value = pp.hatHighpassHz;
      const gain2 = ctx.createGain();
      gain2.gain.setValueAtTime(pp.hatGain * boost, t0);
      gain2.gain.exponentialRampToValueAtTime(0.0001, t0 + pp.hatDecayMs / 1000);
      noise.connect(filter2);
      filter2.connect(gain2);
      gain2.connect(this._percussionGate);
      noise.start(t0);
      noise.stop(t0 + pp.hatDecayMs / 1000 + 0.01);
    }
    return true;
  }

  // Builds the guitar/bass rig's own persistent graph -- lazily, on the
  // first real chug, the same "build the graph when it's first actually
  // needed" precedent setDroneVoices already sets for the drone/flute.
  // Signal order is deliberate and load-bearing: DRIVE first, then the
  // tone stack (highpass -> mid-scoop -> cab lowpass -> cab body
  // resonance) -- both the standard virtual-analog amp topology (preamp
  // gain -> tone stack -> cabinet) AND this file's own hard-won "car horn"
  // lesson (the drone's growl saturator sits AFTER its own bandpass,
  // which concentrated new harmonic content into a narrow band and read
  // as a car horn rather than a rough growl -- see droneGrowlSaturatorF1's
  // own comment). That ordering is right THERE (a parallel-send source
  // selector, not a tone stack); it is the wrong model to copy here.
  //
  // Four gain-node stages, four distinct owners -- arcGain (main.js's
  // intensity arc, guitar enable/disable across stages), duckGain
  // (_duckGuitar below, exclusively), _chanGuitar (setMixParam,
  // exclusively) -- the exact "chain of multiplied gain nodes with
  // strictly separated ownership" fix this file's own toneGain/
  // toneSurgeGain bug (see meanderFlute) already established, applied
  // from day one instead of after a bug.
  _ensureGuitarRig() {
    if (this._guitarRig) return this._guitarRig;
    const ctx = this.ensureContext();
    const gp = this.guitarParams;

    const preGain = ctx.createGain();
    preGain.gain.value = gp.guitarPreGain;
    const saturator = ctx.createWaveShaper();
    saturator.curve = buildSaturationCurve(gp.guitarDriveAmount);
    saturator.oversample = "4x";
    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = gp.guitarFloorHz;
    const scoop = ctx.createBiquadFilter();
    scoop.type = "peaking";
    scoop.frequency.value = gp.guitarScoopHz;
    scoop.Q.value = gp.guitarScoopQ;
    scoop.gain.value = gp.guitarScoopDb;
    const cabLowpass = ctx.createBiquadFilter();
    cabLowpass.type = "lowpass";
    cabLowpass.frequency.value = gp.guitarCabLowpassHz;
    const cabBank = buildGuitarCabBank(ctx);
    const arcGain = ctx.createGain();
    arcGain.gain.value = 1;
    const duckGain = ctx.createGain();
    duckGain.gain.value = 1;

    preGain.connect(saturator);
    saturator.connect(highpass);
    highpass.connect(scoop);
    scoop.connect(cabLowpass);
    cabLowpass.connect(cabBank.input);
    cabBank.output.connect(arcGain);
    arcGain.connect(duckGain);
    duckGain.connect(this._chanGuitar);

    this._guitarRig = { input: preGain, preGain, saturator, highpass, scoop, cabLowpass, cabBank, arcGain, duckGain };
    return this._guitarRig;
  }

  // The per-event "chug" voice -- built fresh, dies with the note, fired
  // INTO the persistent rig above (the hybrid shape neither the kalimba
  // nor the drone/flute individually are -- a persistent amp, cheap
  // per-event voices). Two detuned unison voices -- one sawtooth, one
  // SQUARE (the deliberate, labeled exception -- see DEFAULT_GUITAR_PARAMS'
  // own comment) -- plus a sub-octave doubling layer for the "bass" half,
  // all through the SAME highpass as everything else, so the sub layer's
  // own fundamental is attenuated there and its 2nd harmonic reinforces
  // the main voice's fundamental instead of competing as independent
  // sub-bass. `chugSec`/`attackFraction` are ALWAYS handed in by the
  // caller (main.js), never recomputed here from pulse rate -- the exact
  // same "main.js computes timing, synth.js only shapes the envelope"
  // split playNote's own `duration` parameter already establishes.
  // `letRing` (structural punctuation -- reversals/convergence/breath, or
  // a breakdown lap's own unison hit) sustains far longer, an open chord
  // instead of a muted chug, and skips the choke stage below entirely.
  playGuitarChug(ring, hz, { velocity = 1, atTime = null, chugSec = 0.3, attackFraction = 0.04, letRing = false } = {}) {
    const ctx = this.ensureContext();
    const rig = this._ensureGuitarRig();
    const gp = this.guitarParams;
    const t0 = atTime != null ? atTime : ctx.currentTime;
    const foldedHz = foldIntoRange(hz, gp.guitarFloorHz, gp.guitarCeilingHz);
    const sustainSec = letRing ? Math.max(chugSec, 1) : chugSec;
    const stopAt = t0 + sustainSec + 0.15;

    // The real sidechain -- "sidechaining it or overriding it" -- the
    // drone yields to every real chug, unconditionally, regardless of
    // which caller actually played it (the pattern engine, a let-ring
    // punctuation event, a breakdown unison hit). See its own comment.
    this._duckDroneForGuitar(chugSec);

    const pan = { given: -0.5, received: 0, made: 0.5 }[ring] ?? 0;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(rig.input);

    // The palm-mute envelope -- TWO stages, not one smooth decay, because
    // that IS the actual acoustic mechanism of a palm mute: the hand
    // chokes the string almost immediately after the pick attack, well
    // before any natural decay would finish on its own. "What I'm
    // hearing... is more like a wimpy palm mute" -- a single exponential
    // fade, however short, reads as a synth envelope, never a real choke;
    // this fixes it at the mechanism level rather than by shortening the
    // old curve further. Fast attack -> peak -> a QUICK drop to a low
    // choked floor (velocity * guitarChokeAmount) partway through the
    // chug -> the existing release to silence. Skipped entirely for a
    // `letRing` event -- nothing chokes a sustained, ringing chord.
    const voiceGain = ctx.createGain();
    const attackSec = Math.max(0.001, sustainSec * attackFraction);
    voiceGain.gain.setValueAtTime(0.0001, t0);
    voiceGain.gain.linearRampToValueAtTime(velocity, t0 + attackSec);
    if (!letRing && gp.guitarChokeAmount < 1) {
      const chokeAt = t0 + attackSec + Math.max(0.002, sustainSec * gp.guitarChokeFraction);
      voiceGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, velocity * gp.guitarChokeAmount), chokeAt);
    }
    voiceGain.gain.exponentialRampToValueAtTime(0.0001, stopAt);
    voiceGain.connect(panner);

    const detune = gp.guitarDetuneCents;
    ["sawtooth", "square"].forEach((type, i) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = foldedHz;
      osc.detune.value = i === 0 ? -detune / 2 : detune / 2;
      const oscGain = ctx.createGain();
      oscGain.gain.value = 0.4;
      osc.connect(oscGain);
      oscGain.connect(voiceGain);
      osc.start(t0);
      osc.stop(stopAt + 0.05);
    });

    if (gp.guitarSubAmount > 0) {
      const sub = ctx.createOscillator();
      sub.type = "sawtooth";
      sub.frequency.value = foldedHz / 2;
      const subGain = ctx.createGain();
      subGain.gain.value = gp.guitarSubAmount;
      sub.connect(subGain);
      subGain.connect(voiceGain);
      sub.start(t0);
      sub.stop(stopAt + 0.05);
    }

    // Pick/mute transient -- the same "broadband filtered-noise attack"
    // idiom playNote's own pluck transient already uses.
    const pick = ctx.createBufferSource();
    pick.buffer = this._noiseBuffer();
    const pickFilter = ctx.createBiquadFilter();
    pickFilter.type = "bandpass";
    pickFilter.frequency.value = foldedHz * 2;
    pickFilter.Q.value = 1.2;
    const pickGain = ctx.createGain();
    pickGain.gain.setValueAtTime(0.5 * velocity, t0);
    pickGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.02);
    pick.connect(pickFilter);
    pickFilter.connect(pickGain);
    pickGain.connect(voiceGain);
    pick.start(t0);
    pick.stop(t0 + 0.03);
  }

  // The kick-owned sidechain duck -- see playPercussionHit's own given-
  // ring branch, the only call site. No-ops if the guitar rig doesn't
  // exist yet (most performances never touch the guitar). `ringSpeedMultiplier`
  // is already imported here (this file's own header) -- computes the
  // given ring's real current pulse rate itself rather than reaching into
  // main.js's own ringPulsesPerSecond, the same self-sufficiency every
  // other per-ring timing figure in this file already has.
  _duckGuitar() {
    const rig = this._guitarRig;
    if (!rig || !this.ctx) return;
    const gp = this.guitarParams;
    const t0 = this.ctx.currentTime;
    const givenPulseSec = 1 / (this._masterPulsesPerSecond * ringSpeedMultiplier("given"));
    const duckSec = givenPulseSec * gp.guitarDuckPulseFraction;
    const g = rig.duckGain.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(g.value, t0); // hold current position first -- avoids a jump if a prior duck hasn't fully released yet
    g.linearRampToValueAtTime(1 - gp.guitarDuckAmount, t0 + duckSec * 0.15);
    g.setTargetAtTime(1, t0 + duckSec * 0.15, duckSec * 0.4);
  }

  // The real sidechain the owner asked for -- "sidechaining it or
  // overriding it to an extent" -- run in the direction that actually
  // serves "chug and hypnotic, powerful force": the DRONE ducks for the
  // GUITAR, on every real chug, not the reverse. Same shape as
  // _duckGuitar's own kick-triggered duck (own dedicated gain node, own
  // exclusive writer), timed off THIS chug's own duration (`chugSec`)
  // rather than borrowing a specific ring's pulse rate -- the guitar can
  // follow any of the three rings (main.js's guitarFollowsRing), so its
  // own event duration is the one timing reference that's always real
  // regardless of which ring is driving it. No-ops if the drone isn't
  // currently on (most chugs happen while it is, but this must never
  // assume so).
  _duckDroneForGuitar(chugSec = 0.3) {
    if (!this.droneOn || !this.droneVoices || !this.ctx) return;
    const gp = this.guitarParams;
    const t0 = this.ctx.currentTime;
    const duckSec = Math.max(0.05, chugSec) * gp.droneDuckPulseFraction;
    const g = this.droneVoices.droneDuckGain.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(g.value, t0); // hold current position first -- avoids a jump if a prior duck hasn't fully released yet
    g.linearRampToValueAtTime(1 - gp.droneDuckAmount, t0 + duckSec * 0.15);
    g.setTargetAtTime(1, t0 + duckSec * 0.15, duckSec * 0.4);
  }

  // Breath-cycle percussion accent -- "the pattern's own periodic
  // downbeat... the felt heartbeat/breath under the ring-driven
  // complexity, Gojira/Meshuggah's own move, made literal." Fired once per
  // breath cycle (main.js's onBreathCycle, sequencer.js's 36-master-pulse
  // period) -- deliberately louder and lower than any per-ring hit above,
  // structurally its own thing, not a fourth ring role.
  playBreathAccent() {
    const ctx = this.ensureContext();
    const t0 = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(70, t0);
    osc.frequency.exponentialRampToValueAtTime(35, t0 + 0.09);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(1.3, t0);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
    osc.connect(oscGain);
    oscGain.connect(this._percussionGate);
    osc.start(t0);
    osc.stop(t0 + 0.65);
  }

  // Grand-convergence accent -- "processional cycles and cyclical
  // alignments" should be punctuated too, not just logged. Genuinely
  // different EVENT from the breath cycle (a real, separately-timed 20s
  // period at the fixed anchor, confirmed a real 2:1 ratio against the
  // 10s breath cycle, not the same occurrence) and deliberately a
  // different CHARACTER: a steady, unwavering floor (playBreathAccent)
  // vs. a periodic climax deserves to sound like one -- three inharmonic
  // partials (the same "real tine/bell overtones aren't a clean integer
  // series" idea already used for the kalimba's own metallic ping, reused
  // here at chime scale) ringing out over ~1.8s, bright and long rather
  // than low and short. Neither accent is density-gated -- both are
  // already-established anchors, not routine resultant-rhythm texture.
  playConvergenceAccent() {
    const ctx = this.ensureContext();
    const t0 = ctx.currentTime;

    [1, 2.4, 3.8].forEach((ratio, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = 880 * ratio;
      const gain = ctx.createGain();
      const peak = 0.5 / (i + 1); // higher partials ring quieter, real bell falloff
      const decay = 1.8 / (i + 1); // and shorter, real bell falloff
      gain.gain.setValueAtTime(peak, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
      osc.connect(gain);
      gain.connect(this._percussionGate);
      osc.start(t0);
      osc.stop(t0 + decay + 0.05);
    });
  }

  // Drone: "one driving bass drone... 3 geometrically congruent,
  // temporally dissonant objects... it feels more like separate
  // simultaneous operations... than a unified, conjured sonic landscape."
  // ONE fundamental with harmonic partials now (DRONE_HARMONICS below),
  // not three simultaneous ring-voices at a tonic/fifth/octave interval
  // apiece -- that three-voice chord WAS a real, deliberate design (see
  // the superseded comment this replaced, kept in spirit below), but it's
  // exactly the thing "temporally dissonant... separate operations" named:
  // three permanently-sounding, independently-moving voices, not one.
  //
  // Ring identity doesn't disappear -- it moves from "a permanent third
  // of the chord" to "a brief color any ring's own real hit nudges the
  // ONE voice toward and lets glide back from" (pulseDrone, below), the
  // same shape meanderFlute already uses for the flute. RING_RATIO (the
  // real tonic/fifth/octave interval table) is REUSED for that nudge, not
  // retired -- still not RING_OCTAVE_MULTIPLIER (0.5/1/2): a pure 1:2:4
  // octave ratio shares pitch chroma and would read as the same note
  // reinforced, not a distinct harmonic color to nudge toward (the actual
  // bug an earlier phase found reusing that constant here). A real
  // interval (the fifth) is what makes the nudge audibly ITS OWN color,
  // even briefly.
  //
  // Movement: one shared breath/vibrato pair now, rate-derived directly
  // from the master pulse rate (this._masterPulsesPerSecond) rather than
  // any one ring's own 6:8:12-scaled rate -- simplified, not invented (see
  // README's own "build then tune" note on this), since there's only one
  // voice's own aliveness to drive now, not three independently-phased
  // ones.
  //
  // The formant filter pair was already shared across all three voices --
  // real vowel formants are roughly independent of fundamental pitch, so
  // one shared F1/F2 target is acoustically correct regardless of how many
  // voices sit under it. Unchanged by this consolidation.
  // Cached, shared noise buffer for the per-voice breath/buzz layer below --
  // built once, reused, not regenerated per drone start.
  _noiseBuffer() {
    if (!this._cachedNoise) {
      const ctx = this.ctx;
      const length = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      this._cachedNoise = buf;
    }
    return this._cachedNoise;
  }

  // Silent stand-in for the real flute-note sample during the narrow
  // startup race where the drone starts before _loadRealFluteNoteBuffer's
  // fetch resolves -- self-heals on the next drone on/off cycle once the
  // real sample is ready, so this only needs to not throw or click.
  _silentPlaceholderBuffer() {
    if (!this._cachedSilentPlaceholder) {
      this._cachedSilentPlaceholder = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.1, this.ctx.sampleRate);
    }
    return this._cachedSilentPlaceholder;
  }

  // "The breath/noise aspect is just static." Correctly diagnosed: WHITE
  // noise (flat spectrum) is literally what static/hiss is. Real breath
  // and wind sound is much closer to PINK noise (energy falls off ~3dB
  // per octave, equal energy per octave) -- the standard, well-documented
  // choice for any natural wind/breath/air texture in sound design, used
  // specifically because white noise reads as electronic and pink noise
  // reads as organic. This is the Paul Kellet pink-noise filter, a
  // well-known, widely-published algorithm (not a guess) -- a small bank
  // of leaky integrators applied to white noise, pre-rendered into a
  // cached buffer the same way _noiseBuffer() already is.
  _pinkNoiseBuffer() {
    if (!this._cachedPinkNoise) {
      const ctx = this.ctx;
      const length = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        b6 = white * 0.115926;
        data[i] = pink * 0.11;
      }
      this._cachedPinkNoise = buf;
    }
    return this._cachedPinkNoise;
  }

  // A resonant tube's real spectrum, not a waveform type. "Square" or
  // "sawtooth" are generic synth building blocks with a fixed, mathematical
  // harmonic ratio -- no matter how it's filtered afterward, that reads as
  // "oscillator" rather than "instrument," which was the actual complaint.
  // This is a small additive stack instead: individually-set sine partials
  // (both odd and even, mimicking a real cylindrical resonator -- a pure
  // odd-only series, like a plain square wave, sounds hollow/synthetic by
  // comparison), a couple of them slightly detuned for natural beating a
  // single oscillator can't produce.
  // Extended 7 -> 16 partials: the actual root cause of "the formant lever
  // feels inert" wasn't the formant filters, it was that the harmonic stack
  // never reached them. The fundamentals sit at ~39-78Hz; a series that
  // stops at the 7th partial only reaches ~270-545Hz, well short of the
  // formant filters' 350-1900Hz working range across the vowel targets
  // below -- there was nothing there for Q or position changes to grab.
  // Real lip-buzz/reed sources are dense and a little irregular this far
  // up (not a clean falling 1/n series), which is also just more
  // didgeridoo-like: a buzzy, harmonically rich source the mouth cavity
  // then selectively resonates, rather than a a few clean partials.
  static DRONE_HARMONICS = [
    { n: 1, amp: 1.0, detune: 0 },
    { n: 2, amp: 0.42, detune: 3 },
    { n: 3, amp: 0.5, detune: 0 },
    { n: 4, amp: 0.24, detune: -4 },
    { n: 5, amp: 0.34, detune: 0 },
    { n: 6, amp: 0.14, detune: 5 },
    { n: 7, amp: 0.2, detune: 0 },
    { n: 8, amp: 0.16, detune: -3 },
    { n: 9, amp: 0.13, detune: 0 },
    { n: 10, amp: 0.15, detune: 4 },
    { n: 11, amp: 0.09, detune: 0 },
    { n: 12, amp: 0.11, detune: -5 },
    { n: 13, amp: 0.07, detune: 0 },
    { n: 14, amp: 0.09, detune: 3 },
    { n: 15, amp: 0.06, detune: 0 },
    { n: 16, amp: 0.08, detune: -4 },
  ];

  setDroneVoices(on, baseHz) {
    const ctx = this.ensureContext();
    const dp = this.droneParams;

    if (on && !this.droneOn) {
      const bus = ctx.createGain();
      bus.gain.setValueAtTime(0, ctx.currentTime);
      bus.gain.linearRampToValueAtTime(dp.busGain, ctx.currentTime + 1.2);

      // One fundamental, one DRONE_HARMONICS stack -- see this method's
      // own header comment. `ringGain` is no longer a per-ring BALANCE
      // (the three givenGain/receivedGain/madeGain sliders are retired) --
      // overall level is busGain's job; ringGain exists only as the node
      // pulseDrone's per-ring swell targets.
      const ringGain = ctx.createGain();
      ringGain.gain.value = 1;
      const oscs = OrphographAudio.DRONE_HARMONICS.map((partial) => {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = baseHz * partial.n;
        osc.detune.value = partial.detune;
        const partialGain = ctx.createGain();
        partialGain.gain.value = partial.amp;
        osc.connect(partialGain);
        partialGain.connect(ringGain);
        osc.start();
        return { osc, n: partial.n };
      });

      // "The rough and shaped overtones" -- see droneSubharmonicAmount's
      // own comment (DEFAULT_DRONE_PARAMS). A real sub-octave partial,
      // summed into the SAME ringGain the 16 harmonic partials use, so it
      // rides the same breath swell and passes through the same
      // saturator below -- not a separate, independently-controlled layer.
      const sub = ctx.createOscillator();
      sub.type = "sine";
      sub.frequency.value = baseHz / 2;
      const subGain = ctx.createGain();
      subGain.gain.value = dp.droneSubharmonicAmount;
      sub.connect(subGain);
      subGain.connect(ringGain);
      sub.start();

      // Breathing -- one shared LFO now, off the MASTER pulse rate (see
      // this method's own header comment) rather than any one ring's own
      // 6:8:12-scaled rate; see setProcessionPulseRate for the live update
      // as procession speed changes.
      const voiceLfo = ctx.createOscillator();
      voiceLfo.frequency.value = this._masterPulsesPerSecond / dp.breathPulsesPerCycle;
      const voiceLfoDepth = ctx.createGain();
      voiceLfoDepth.gain.value = dp.breathDepth;
      voiceLfo.connect(voiceLfoDepth);
      voiceLfoDepth.connect(ringGain.gain);
      voiceLfo.start();

      // Pitch vibrato -- one shared LFO, fanned into every partial's own
      // .detune (sums additively with that partial's own static detune
      // offset, layering on top of the existing unison spread).
      const vibratoLfo = ctx.createOscillator();
      vibratoLfo.frequency.value = this._masterPulsesPerSecond * dp.vibratoCyclesPerPulse;
      const vibratoDepth = ctx.createGain();
      vibratoDepth.gain.value = dp.vibratoCents;
      vibratoLfo.connect(vibratoDepth);
      oscs.forEach((p) => vibratoDepth.connect(p.osc.detune));
      vibratoDepth.connect(sub.detune);
      vibratoLfo.start();

      // Soft-clip (tanh) waveshaping on the whole tonal stack (16 partials
      // + subharmonic together) -- see buildSaturationCurve/
      // droneSaturationAmount. Sits BEFORE the formant pair and moveFilter
      // below (both now retuned to actually pass this content through, see
      // moveFilterHz's own comment), so the added harmonics get shaped by
      // the rest of the chain instead of arriving after it. The breath/
      // buzz noise layer (below) connects straight to `bus`, bypassing
      // this -- it's texture, not part of the tone being roughened.
      const droneSaturator = ctx.createWaveShaper();
      droneSaturator.oversample = "4x";
      droneSaturator.curve = buildSaturationCurve(dp.droneSaturationAmount);
      ringGain.connect(droneSaturator);
      droneSaturator.connect(bus);

      // Breath/buzz layer -- didgeridoo tone is never a clean pitch; it's
      // breathy and buzzy from the player's embouchure. Filtered noise,
      // banded around the one fundamental (was banded per-ring around
      // each ring's own before).
      const noiseSources = [];
      const noise = ctx.createBufferSource();
      noise.buffer = this._noiseBuffer();
      noise.loop = true;
      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = "bandpass";
      noiseFilter.frequency.value = baseHz * 2;
      noiseFilter.Q.value = 0.8;
      const noiseGain = ctx.createGain();
      noiseGain.gain.value = dp.breathNoiseGain;
      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(bus);
      noise.start();
      noiseSources.push(noise);

      // "Moving all the growl effects to the drone to turn the drone into
      // a more singular didgeridoo layer, giving the flute more of its
      // own dedicated register and character." Relocated here from the
      // flute (see DEFAULT_DRONE_PARAMS' droneGrowl* comment for the full
      // rationale) -- taps ringGain (post-additive-stack, same relative
      // position the flute's own tap held: post-mix, pre-final-color-
      // stage) and sums into `bus`, the same destination droneSaturator
      // and the noise layer above already reach. No register to crossfade
      // against here (the drone's pitch is fixed) -- droneGrowlAmount
      // drives these gains directly (see setDroneParam), not through a
      // continuous brightness-tick update the flute's version needed.
      const droneGrowlF1 = ctx.createBiquadFilter();
      droneGrowlF1.type = "bandpass";
      droneGrowlF1.frequency.value = dp.droneGrowlF1Hz;
      droneGrowlF1.Q.value = dp.droneGrowlQ;
      const droneGrowlSaturatorF1 = ctx.createWaveShaper();
      droneGrowlSaturatorF1.oversample = "4x";
      droneGrowlSaturatorF1.curve = buildSaturationCurve(dp.droneGrowlSaturationAmount);
      const droneGrowlF1Gain = ctx.createGain();
      droneGrowlF1Gain.gain.value = dp.droneGrowlAmount;
      ringGain.connect(droneGrowlF1);
      droneGrowlF1.connect(droneGrowlSaturatorF1);
      droneGrowlSaturatorF1.connect(droneGrowlF1Gain);
      droneGrowlF1Gain.connect(bus);

      const droneGrowlF2 = ctx.createBiquadFilter();
      droneGrowlF2.type = "bandpass";
      droneGrowlF2.frequency.value = dp.droneGrowlF2Hz;
      droneGrowlF2.Q.value = dp.droneGrowlQ;
      const droneGrowlSaturatorF2 = ctx.createWaveShaper();
      droneGrowlSaturatorF2.oversample = "4x";
      droneGrowlSaturatorF2.curve = buildSaturationCurve(dp.droneGrowlSaturationAmount);
      const droneGrowlF2Gain = ctx.createGain();
      droneGrowlF2Gain.gain.value = dp.droneGrowlAmount;
      ringGain.connect(droneGrowlF2);
      droneGrowlF2.connect(droneGrowlSaturatorF2);
      droneGrowlSaturatorF2.connect(droneGrowlF2Gain);
      droneGrowlF2Gain.connect(bus);

      // Free-running "vocalization" wander -- NOT pulse-locked (a vocal
      // tract shifting shape isn't tied to how fast the wheel is turning).
      // Two independent oscillators so F1/F2 drift relative to each other,
      // not in lockstep. Real bug fixed in the move: the depth used to
      // exceed the band center (155Hz depth on a 90Hz F1), driving the
      // frequency negative for part of every cycle -- droneGrowlF1Hz
      // raised to 110 and the depth brought inside it (35Hz) so the
      // wander is genuinely symmetric now.
      const droneGrowlWanderLfo1 = ctx.createOscillator();
      droneGrowlWanderLfo1.type = "sine";
      droneGrowlWanderLfo1.frequency.value = dp.droneGrowlWanderHz;
      const droneGrowlWanderDepth1 = ctx.createGain();
      droneGrowlWanderDepth1.gain.value = dp.droneGrowlWanderDepth;
      droneGrowlWanderLfo1.connect(droneGrowlWanderDepth1);
      droneGrowlWanderDepth1.connect(droneGrowlF1.frequency);
      droneGrowlWanderLfo1.start();

      const droneGrowlWanderLfo2 = ctx.createOscillator();
      droneGrowlWanderLfo2.type = "sine";
      droneGrowlWanderLfo2.frequency.value = dp.droneGrowlWanderHz;
      const droneGrowlWanderDepth2 = ctx.createGain();
      droneGrowlWanderDepth2.gain.value = dp.droneGrowlWanderDepth;
      droneGrowlWanderLfo2.connect(droneGrowlWanderDepth2);
      droneGrowlWanderDepth2.connect(droneGrowlF2.frequency);
      droneGrowlWanderLfo2.start();

      // The throat voice -- also relocated here (see droneThroatAmount's
      // own comment). Pitched off the drone's own FIXED baseHz (no
      // per-note register to crossfade against the way the flute had),
      // and its per-hit accent now comes from pulseDrone's own tongued-
      // attack gate rather than meanderFlute's -- the drone has no
      // per-note pitch change to gate off of.
      const droneThroatOscs = THROAT_HARMONICS.map((partial) => {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = baseHz * partial.n;
        osc.detune.value = partial.detune;
        const partialGain = ctx.createGain();
        partialGain.gain.value = partial.amp;
        osc.connect(partialGain);
        osc.start();
        return { osc, gain: partialGain, n: partial.n };
      });
      const droneThroatLevelGain = ctx.createGain();
      droneThroatLevelGain.gain.value = dp.droneThroatAmount;

      // The kargyraa layer -- the ventricular folds vibrating at HALF the
      // vocal folds' rate, the actual mechanism that defines this specific
      // throat-singing style, not an invented "sub bass" add-on.
      const droneThroatSubOsc = ctx.createOscillator();
      droneThroatSubOsc.type = "sine";
      droneThroatSubOsc.frequency.value = baseHz / 2;
      const droneThroatSubGain = ctx.createGain();
      droneThroatSubGain.gain.value = dp.droneThroatSubharmonicAmount;
      droneThroatSubOsc.connect(droneThroatSubGain);
      droneThroatSubOsc.start();

      const droneThroatGateGain = ctx.createGain();
      droneThroatGateGain.gain.value = 1;
      droneThroatLevelGain.connect(droneThroatGateGain);
      droneThroatSubGain.connect(droneThroatGateGain);
      droneThroatGateGain.connect(bus);
      droneThroatOscs.forEach((p) => p.gain.connect(droneThroatLevelGain));

      // Shared formant pair -- vowel color, glides rather than clicks when
      // setVowelFormant changes the target. Sharper resonance than a
      // gentle color, closer to a talk-box: articulate rather than subtle.
      // Defaults to a neutral "oh" (O's own spoken reading) until a vowel
      // is actively selected.
      const f1 = ctx.createBiquadFilter();
      f1.type = "bandpass"; f1.frequency.value = 570; f1.Q.value = dp.formantF1Q;
      const f2 = ctx.createBiquadFilter();
      f2.type = "bandpass"; f2.frequency.value = 950; f2.Q.value = dp.formantF2Q;
      const formantBlend = ctx.createGain();
      formantBlend.gain.value = dp.formantBlendGain;
      bus.connect(f1); f1.connect(formantBlend);
      bus.connect(f2); f2.connect(formantBlend);
      bus.connect(formantBlend); // some uncolored signal through

      // A slow-sweeping lowpass for overall "moving," on top of the one
      // voice's own breath rate above -- tuned for sub-bass, separate from
      // the formant stage (which does the vowel-color work).
      const moveFilter = ctx.createBiquadFilter();
      moveFilter.type = "lowpass";
      moveFilter.frequency.value = dp.moveFilterHz;
      moveFilter.Q.value = 1.0;
      // Bus-wide, not per-ring -- derived from the MASTER pulse rate
      // directly (no single ring "owns" this sweep).
      const filterLfo = ctx.createOscillator();
      filterLfo.frequency.value = this._masterPulsesPerSecond / dp.moveFilterPulsesPerCycle;
      const filterLfoDepth = ctx.createGain();
      filterLfoDepth.gain.value = dp.moveFilterDepthHz;
      filterLfo.connect(filterLfoDepth);
      filterLfoDepth.connect(moveFilter.frequency);
      filterLfo.start();

      // Bass boost -- a real gain increase in the low end, not just a
      // lowpass cut (moveFilter already does that). "Much more powerful,
      // needs bass" -- this is the actual weight, on top of the richer
      // waveforms above giving the formant stage something to shape.
      const bassBoost = ctx.createBiquadFilter();
      bassBoost.type = "lowshelf";
      bassBoost.frequency.value = dp.bassBoostHz;
      bassBoost.gain.value = dp.bassBoostDb;

      // The guitar's own sidechain target -- "sidechaining it or
      // overriding it to an extent." Owned EXCLUSIVELY by
      // _duckDroneForGuitar (see its own comment), the same "one
      // AudioParam, one owner" discipline every other per-hit gate in
      // this file follows -- inserted right at the drone's own final
      // exit point so it ducks the WHOLE drone voice (fundamental,
      // growl, throat, everything), not just one layer of it.
      const droneDuckGain = ctx.createGain();
      droneDuckGain.gain.value = 1;

      formantBlend.connect(moveFilter);
      moveFilter.connect(bassBoost);
      bassBoost.connect(droneDuckGain);
      droneDuckGain.connect(this._chanDrone);

      // Flute -- "one meandering flute drone/pad/melodic narrative," ONE
      // voice now (was three genuinely independent pipes, one per ring --
      // "true polyphony," a real, deliberate design this replaces, not a
      // bug fix). The signal path is otherwise unchanged:
      //   source (real sample, pitch-shifted) -> toneGain -> toneColorFilter -> toneSurgeGain
      //   sharedNoise -> breathShape -> surgeGain -> wander-modulated -> breathGain
      //   toneSurgeGain + breathGain -> muteGain -> whistleBus
      //
      // Ring identity moves from "which pipe is this" to "which ring's
      // real hit most recently retuned the one pipe" -- meanderFlute below
      // still only fires on the ring that actually triggered it, but now
      // retunes the SAME shared voice every time, offset by
      // RING_OCTAVE_MULTIPLIER (the same low-to-high-by-speed register
      // convention playNote/playPercussionHit already use) instead of each
      // ring owning a permanently distinct register via RING_RATIO. The
      // three rings' own asynchronous 6:8:12 timing is what keeps this one
      // voice's target constantly, asynchronously in motion -- "the
      // narrative itself is driven by all three tempos rather than
      // tripled by them."
      //
      // One shared breath source ("one breath, many chambers" -- now
      // literally one breath, one chamber); one shared, irregular (noise-
      // driven, NOT periodic) wander scales breath level -- real breath
      // pressure fluctuates unevenly, never a filter's own pitch (an LFO
      // doing THAT was the "Welcome to the Machine" mistake, kept out of
      // this design entirely).
      const whistleSharedNoise = ctx.createBufferSource();
      // Real CC0 recorded texture once it's loaded (see
      // _loadRealBreathBuffer -- "still more of a keyboard character than
      // woodwind"), synthesized pink noise before then or if it never
      // resolves. Same downstream chain either way.
      whistleSharedNoise.buffer = this._realBreathBuffer || this._pinkNoiseBuffer();
      whistleSharedNoise.loop = true;
      whistleSharedNoise.start();
      // Static, non-resonant PRE-shaping only -- not swept, not a
      // resonant peak. Just a gentle fixed roll-off so the breath bed
      // isn't full-scale noise before the voice's own color filter
      // (below) shapes it further; the actual pitch comes entirely from
      // the oscillators, never from this.
      const breathShape = ctx.createBiquadFilter();
      breathShape.type = "lowpass";
      breathShape.Q.value = 0.5;
      breathShape.frequency.value = 6000;
      whistleSharedNoise.connect(breathShape);

      const whistleBreathWander = ctx.createBufferSource();
      whistleBreathWander.buffer = this._noiseBuffer();
      whistleBreathWander.loop = true;
      const wanderLowpass = ctx.createBiquadFilter();
      wanderLowpass.type = "lowpass";
      wanderLowpass.frequency.value = 2.5; // well below anything periodic-sounding -- a slow, irregular drift
      whistleBreathWander.connect(wanderLowpass);
      whistleBreathWander.start();

      // Vibrato -- one shared LFO now (used to be three independent ones
      // specifically to avoid a chorus/pad effect across three SIMULTANEOUS
      // voices -- moot with one voice, nothing left to desync from), still
      // feeding depth-scaled taps into BOTH pitch (oscillator detune) and
      // amplitude (toneGain) -- real breath-pressure vibrato couples the
      // two, not just a clean pitch-only wobble.
      const whistleVibratoLfo = ctx.createOscillator();
      whistleVibratoLfo.type = "sine";
      whistleVibratoLfo.frequency.value = dp.whistleVibratoRateHz;
      whistleVibratoLfo.start();

      // "Pick up a different flute for this key" -- defaults to matching
      // the drone's own root the first time the drone ever starts, then
      // stays whatever setChamberRoot last set it to (main.js updates it
      // once per Play from the phrase's own derived root; it is NOT reset
      // here on every drone on/off cycle, since a chamber that reset every
      // time the sustain pedal is tapped would defeat the whole "fixed
      // until the key changes" point).
      if (!(this._chamberRootHz > 0)) this._chamberRootHz = baseHz;

      // "One meandering flute" -- ringHz uses RING_OCTAVE_MULTIPLIER now
      // (the CENTER register, since there's no real word/chord-root context
      // yet -- meanderFlute's own per-event retune is where a real hit's
      // ring/chord actually shifts pitch/register), not RING_RATIO (that
      // table is retired from the flute entirely -- still used by the
      // drone's own per-event nudge, see pulseDrone). this._whistleLastRing
      // isn't set yet on the very first build (still at its constructor
      // default, "received"), so _fluteFundamentalHz reads exactly the
      // pre-fold formula did here -- the fold itself is new.
      const ringHz = this._fluteFundamentalHz(baseHz);

      // this._whistleActiveVoices -- a fixed WHISTLE_MAX_VOICES slots, each
      // sourced from the native voicing engine's own current output
      // (silent WHISTLE_EMPTY_VOICE beyond however many voices are
      // currently active; just the root, silent elsewhere, until the first
      // real word voices a chord -- see the constructor).
      const whistleLayers = [];
      for (let i = 0; i < WHISTLE_MAX_VOICES; i++) {
        const voice = this._whistleActiveVoices[i] || WHISTLE_EMPTY_VOICE;
        const layerHz = this._fluteLayerHz(ringHz, voice.ratio, baseHz);
        const sample = this._pickFluteSample(layerHz);
        whistleLayers.push(buildFluteToneLayer(ctx, dp, voice.ratio, voice.level, layerHz, whistleVibratoLfo, wanderLowpass, sample, i));
      }

      // Breath: the ONE shared, already pink-noise-shaped bed, run through
      // the voice's own color filter (the "air formant," and what the
      // chiff below actually brightens), then the surge (real-hit
      // loudness) and wander (irregular turbulence) modulations on top of
      // it. NOT layered by octave -- breath is texture, not the choir
      // content the doubling is for.
      const whistleBreathColorFilter = ctx.createBiquadFilter();
      whistleBreathColorFilter.type = "lowpass";
      whistleBreathColorFilter.Q.value = 0.5;
      whistleBreathColorFilter.frequency.value = this._breathColorHzFor(ringHz, dp.whistleBreathColorRatio);
      breathShape.connect(whistleBreathColorFilter);

      const whistleBreathGain = ctx.createGain();
      whistleBreathGain.gain.value = dp.whistleBreathAmount;
      const whistleSurgeGain = ctx.createGain();
      whistleSurgeGain.gain.value = 1;
      whistleBreathColorFilter.connect(whistleSurgeGain);
      whistleSurgeGain.connect(whistleBreathGain);
      // "None of the breath components are working as intended" --
      // turbulence wander and vibrato-coupling taps into breath level are
      // gone (see _applyFluteBreathLevel); a minimal, predictable steady
      // bed plus the real-hit note-gate is the whole breath story now.
      // Per-ring mute is retired (setDroneMute removed) -- always on.
      const whistleMuteGain = ctx.createGain();
      whistleMuteGain.gain.value = 1;
      whistleLayers.forEach((layer) => layer.output.connect(whistleMuteGain));
      whistleBreathGain.connect(whistleMuteGain);

      // The ONE fixed chamber -- see buildFluteChamberBank. Sits
      // downstream of the mute gain and upstream of the shared
      // whistleBus/whistleBox below, which stays what it always was: one
      // shared body/room resonance the (now single, individually
      // chambered) pipe speaks into.
      const whistleChamberBank = buildFluteChamberBank(ctx, dp, this._chamberRootHz);
      whistleMuteGain.connect(whistleChamberBank.input);

      // The drone-wave -- "the flute is missing a drone in itself,"
      // wooden-flute-drone half (the high-register counterpart to growl,
      // which has since moved to the actual bass drone -- see
      // droneGrowl*). Same "additive LFO tap into a gain AudioParam"
      // pattern the bass drone's own voiceLfo already uses, applied here
      // to the flute's own mute gain, off the MASTER pulse rate (see this
      // method's own header comment) rather than any one ring's own.
      const whistleDroneWaveLfo = ctx.createOscillator();
      whistleDroneWaveLfo.type = "sine";
      whistleDroneWaveLfo.frequency.value = this._masterPulsesPerSecond / dp.whistleDroneWaveCyclesPerRingPulse;
      const whistleDroneWaveDepthGain = ctx.createGain();
      whistleDroneWaveDepthGain.gain.value = 0;
      whistleDroneWaveLfo.connect(whistleDroneWaveDepthGain);
      whistleDroneWaveDepthGain.connect(whistleMuteGain.gain);
      whistleDroneWaveLfo.start();

      // "A big box" -- one shared resonant peak the pipe speaks INTO, the
      // same peaking-filter idea already used for the note voice's own
      // wood-body resonance (bodyHz/bodyQ/bodyAmountDb). No limiter/
      // safety-clip stage needed -- there's no self-oscillating loop to
      // guard against; the shared master bus limiter (see ensureContext)
      // is the same headroom every other voice relies on.
      const whistleBus = ctx.createGain();
      const whistleBox = ctx.createBiquadFilter();
      whistleBox.type = "peaking";
      whistleBox.frequency.value = dp.whistleBoxHz;
      whistleBox.Q.value = dp.whistleBoxQ;
      whistleBox.gain.value = dp.whistleBoxAmountDb;
      whistleChamberBank.output.connect(whistleBus);
      whistleBus.connect(whistleBox);
      whistleBox.connect(this._fluteLowMid);

      this._droneBaseHz = baseHz;
      // Scalars now, not ring-keyed -- one voice, one current chord-root/
      // brightness state. See _updateFluteBrightness/meanderFlute.
      this._whistleChordRootHz = baseHz;

      this.droneVoices = {
        bus, oscs, ringGain, sub, subGain, droneSaturator,
        voiceLfo, voiceLfoDepth, vibratoLfo, vibratoDepth,
        noiseSources, noiseGain, f1, f2, formantBlend, moveFilter, filterLfo, filterLfoDepth, bassBoost, droneDuckGain,
        droneGrowlF1, droneGrowlF2, droneGrowlF1Gain, droneGrowlF2Gain,
        droneGrowlSaturatorF1, droneGrowlSaturatorF2,
        droneGrowlWanderLfo1, droneGrowlWanderLfo2, droneGrowlWanderDepth1, droneGrowlWanderDepth2,
        droneThroatOscs, droneThroatLevelGain, droneThroatSubOsc, droneThroatSubGain, droneThroatGateGain,
        whistleLayers, whistleVibratoLfo, wanderLowpass,
        whistleSharedNoise, breathShape, whistleBreathWander, whistleBreathColorFilter, whistleBreathGain,
        whistleSurgeGain, whistleMuteGain, whistleChamberBank, whistleBus, whistleBox,
        whistleDroneWaveLfo, whistleDroneWaveDepthGain,
      };
      this.droneOn = true;
    } else if (!on && this.droneOn) {
      const now = ctx.currentTime;
      this.droneVoices.bus.gain.cancelScheduledValues(now);
      this.droneVoices.bus.gain.linearRampToValueAtTime(0, now + 0.8);
      this.droneVoices.oscs.forEach((p) => p.osc.stop(now + 0.85));
      this.droneVoices.sub.stop(now + 0.85);
      this.droneVoices.voiceLfo.stop(now + 0.85);
      this.droneVoices.vibratoLfo.stop(now + 0.85);
      this.droneVoices.noiseSources.forEach((n) => n.stop(now + 0.85));
      this.droneVoices.filterLfo.stop(now + 0.85);
      this.droneVoices.whistleLayers.forEach((layer) => layer.source.stop(now + 0.85));
      this.droneVoices.whistleVibratoLfo.stop(now + 0.85);
      this.droneVoices.whistleSharedNoise.stop(now + 0.85); // one shared breath source
      this.droneVoices.whistleBreathWander.stop(now + 0.85); // one shared turbulence wander
      this.droneOn = false;
    } else if (on && this.droneOn) {
      const now = ctx.currentTime;
      // Drone -- retune the one fundamental stack straight to the new
      // root; no RING_RATIO multiplication anymore (that table colors
      // brief per-event nudges now, see pulseDrone, not a permanent
      // per-ring fundamental).
      this.droneVoices.oscs.forEach((p) => {
        p.osc.frequency.setTargetAtTime(baseHz * p.n, now, 0.08);
      });
      this.droneVoices.sub.frequency.setTargetAtTime(baseHz / 2, now, 0.08);
      // Flute -- same construction-time formula (RING_OCTAVE_MULTIPLIER's
      // center register, harmonic scalar), retuned to the new root.
      const whistleTarget = this._fluteFundamentalHz(baseHz);
      this.droneVoices.whistleLayers.forEach((layer) => {
        const layerHz = whistleTarget * layer.octaveMult;
        const quantizedHz = this._fluteLayerHz(whistleTarget, layer.octaveMult, baseHz);
        layer.source.playbackRate.setTargetAtTime(quantizedHz / layer.sampleBaseHz, now, 0.08);
        layer.toneColorFilter.frequency.setTargetAtTime(
          this._toneColorHzFor(layerHz, dp.whistleToneColorRatio, this._whistleBrightnessMult), now, 0.08);
      });
      // Breath color tracks pitch (see whistleBreathColorRatio) -- a root
      // change moves the pitch, so it has to retune this too.
      this.droneVoices.whistleBreathColorFilter.frequency.setTargetAtTime(
        this._breathColorHzFor(whistleTarget, dp.whistleBreathColorRatio), now, 0.08);
      this._droneBaseHz = baseHz;
    }
  }

  // Vowel -> drone formant. Glides (setTargetAtTime), doesn't click.
  // Targets are deliberately NOT literal IPA vowels -- the three primes
  // were never claimed to be one -- but a warm palette chosen on purpose:
  // horizontal (earth) dark/low-F2 (the frequency-code association of low
  // F2 with "large," matching earth's own weight); nub (heaven) brighter
  // but restrained well short of a full bright /i/, specifically to avoid
  // tinny; vertical (= I) neutral, between them.
  setVowelFormant(primeName) {
    if (!this.droneVoices) return;
    const targets = {
      vertical: { f1: 500, f2: 1500 },
      horizontal: { f1: 350, f2: 750 },
      nub: { f1: 450, f2: 1900 },
      neutral: { f1: 570, f2: 950 }, // the resting "oh" default
    };
    const t = targets[primeName] || targets.neutral;
    const now = this.ctx.currentTime;
    this.droneVoices.f1.frequency.setTargetAtTime(t.f1, now, 0.4);
    this.droneVoices.f2.frequency.setTargetAtTime(t.f2, now, 0.4);
  }
}
