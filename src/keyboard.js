// Pictographic keyboard / legend: an "unrolled" rectangular reading of the
// wheel -- 12 spoke-columns x ring-rows (given/received/made), plus a 4th
// row for letters with no ring assigned yet (L11, 00-laws.md). Built
// directly from PLACEHOLDER_SPOKE_OF / ringForLetter, the same tables the
// engine itself plays from, not a hand-kept duplicate -- it can't drift
// from what the wheel actually does.
//
// Every key is a placeholder Latin-label tile today: no glyph has been
// drawn yet (01-alphabet/letters/README.md says so directly). Each key
// still carries the expected future asset paths (Krita/Inkscape sketch,
// UFO glyph) in its tooltip -- not real links yet, since nothing exists at
// either path, but fixing the convention now means a real glyph just
// starts appearing there once someone exports one, with no code change
// needed later. The font-master UFO is the implied end state; this is the
// legend that will eventually point straight at it.

import { SPOKE_COUNT } from "./wheel.js";
import { PLACEHOLDER_SPOKE_OF, ringForLetter, REST, TYPED_AS_OF } from "./letters.js";
import { LEGEND_OF } from "./glyphLegend.js";

const ROW_ORDER = ["given", "received", "made", "unassigned"];
const ROW_LABEL = {
  given: "given",
  received: "received",
  made: "made",
  unassigned: "open / not yet settled",
};

const FLASH_MS = 350;

// Display-only shortening for the two long vowel-prime tokens -- the real
// token (dataset.letter, tooltip, click-to-insert) stays the full name;
// this only affects what's printed on the key itself, which is too narrow
// for "vowel.horizontal" to fit without overflowing its column.
const DISPLAY_LABEL = {
  "vowel.horizontal": "horiz.",
  "vowel.nub": "nub",
};

// Paths are relative to this file's own served location (this engine's
// src/), reaching up to the wider TheCodex repo -- this dev server only
// serves the engine folder today, so these render as plain text, not
// working links, until asset-serving spans the whole repo.
function expectedPaths(token) {
  const safe = token.replace(/\./g, "_");
  return {
    sketch: `01-alphabet/letters/${safe}.svg`,
    glyph: `01-alphabet/letters/TheCodex-Draft.ufo/glyphs/${safe}.glif`,
  };
}

export class PictographKeyboard {
  constructor(container) {
    this.container = container;
    this.keyEls = {}; // letter token -> button element
    this.onKeyClick = null;
    this._build();
  }

  _build() {
    this.container.innerHTML = "";
    const bySpokeAndRing = {};
    for (const [letter, spoke] of Object.entries(PLACEHOLDER_SPOKE_OF)) {
      if (letter === REST) continue; // engine device, not a census letter -- see letters.js
      const ring = ringForLetter(letter) || "unassigned";
      ((bySpokeAndRing[ring] ??= {})[spoke] ??= []).push(letter);
    }

    for (const ring of ROW_ORDER) {
      const row = document.createElement("div");
      row.className = `kbd-row kbd-row-${ring}`;

      const label = document.createElement("div");
      label.className = "kbd-row-label";
      label.textContent = ROW_LABEL[ring];
      row.appendChild(label);

      for (let s = 1; s <= SPOKE_COUNT; s++) {
        const cell = document.createElement("div");
        cell.className = "kbd-cell";
        const letters = (bySpokeAndRing[ring] || {})[s] || [];
        letters.forEach((letter) => {
          const key = document.createElement("button");
          key.type = "button";
          key.className = "kbd-key";
          key.textContent = DISPLAY_LABEL[letter] || letter;
          key.dataset.letter = letter;

          const shorthand = TYPED_AS_OF[letter];
          if (shorthand) {
            const badge = document.createElement("span");
            badge.className = "kbd-shorthand";
            badge.textContent = shorthand;
            key.appendChild(badge);
          }

          const legend = LEGEND_OF[letter];
          const paths = expectedPaths(letter);
          const legendLine = legend ? `${legend.object}${legend.sound ? ` (/${legend.sound}/)` : ""}` : "(no legend entry yet)";
          key.title =
            `${letter} -- ${legendLine}\n` +
            `spoke ${s}, ${ring}` +
            (shorthand ? `\ntype: ${shorthand}` : "") +
            `\nsketch: ${paths.sketch} (not yet authored)\n` +
            `glyph: ${paths.glyph} (not yet authored)`;

          key.addEventListener("click", () => this.onKeyClick?.(letter));
          cell.appendChild(key);
          this.keyEls[letter] = key;
        });
        row.appendChild(cell);
      }
      this.container.appendChild(row);
    }
  }

  // Real-time feedback -- called from main.js only when a letter actually
  // SOUNDS (i.e. it survived the ring-tier mute gate, see main.js's
  // onNoteHit/onChordHit), not on every geometric hit, so the keyboard
  // reflects real activation, not just the wheel's own sweep passing over
  // a spoke it isn't voicing this ring.
  flash(letter) {
    const el = this.keyEls[letter];
    if (!el) return;
    clearTimeout(el._flashTimer);
    el.classList.add("kbd-flash");
    el._flashTimer = setTimeout(() => el.classList.remove("kbd-flash"), FLASH_MS);
  }
}
