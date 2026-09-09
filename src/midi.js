// Web MIDI hookup for the Akai MPK25 (or any class-compliant controller).
// - Keys: two octaves of 12 semitones map directly onto the 12 spokes twice
//   over (octave = ring, per the sonic parameters) -- useful for manually
//   auditioning spoke/pitch assignments by ear.
// - Expression pedal CC: procession rate (continuous, 0..1).
// - Sustain pedal (CC64): drone on/off.
// If no device is present, the UI falls back to on-screen controls -- MIDI
// is additive, not required.

const EXPRESSION_CC_CANDIDATES = [11, 4, 7]; // common expression/CC assignments; adjust to taste
const SUSTAIN_CC = 64;

export class MidiBridge {
  constructor({ onKeySpoke, onExpression, onSustain, onStatus }) {
    this.onKeySpoke = onKeySpoke || (() => {});
    this.onExpression = onExpression || (() => {});
    this.onSustain = onSustain || (() => {});
    this.onStatus = onStatus || (() => {});
    this.access = null;
  }

  async connect() {
    if (!navigator.requestMIDIAccess) {
      this.onStatus("Web MIDI not supported in this browser.");
      return false;
    }
    try {
      this.access = await navigator.requestMIDIAccess();
    } catch (e) {
      this.onStatus("MIDI access denied: " + e.message);
      return false;
    }
    const inputs = Array.from(this.access.inputs.values());
    if (inputs.length === 0) {
      this.onStatus("No MIDI inputs found. Plug in the MPK25 and reconnect.");
      return false;
    }
    inputs.forEach((input) => {
      input.onmidimessage = (msg) => this._handleMessage(msg);
    });
    this.onStatus(`Connected: ${inputs.map((i) => i.name).join(", ")}`);
    return true;
  }

  _handleMessage(msg) {
    const [status, d1, d2] = msg.data;
    const type = status & 0xf0;

    if (type === 0x90 && d2 > 0) {
      // Note on -- map chromatic note number to spoke 1..12 (mod 12),
      // matching the two-octave-equals-two-rings idea from the MPK25 discussion.
      const spoke = (d1 % 12) + 1;
      this.onKeySpoke(spoke, d2 / 127);
      return;
    }

    if (type === 0xb0) {
      if (d1 === SUSTAIN_CC) {
        this.onSustain(d2 >= 64);
        return;
      }
      if (EXPRESSION_CC_CANDIDATES.includes(d1)) {
        this.onExpression(d2 / 127);
        return;
      }
    }
  }
}
