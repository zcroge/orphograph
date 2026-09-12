// Compact glyph reference: a small, uniform-square index of every letter,
// meant to sit directly under the wheel canvas as a pure "what does this
// look like" glance -- deliberately NOT reproducing the wheel's own
// spoke/ring geometry (variable-width columns, ring bands) the way the big
// keyboard panel does; this is a plain, evenly-sized grid, ordered by
// spoke purely so it still reads in a sense-making, connected order.
// Same underlying data (PLACEHOLDER_SPOKE_OF/ringForLetter) as the big
// keyboard, so it can't drift out of sync with it or the engine.

import { PLACEHOLDER_SPOKE_OF, ringForLetter, REST, TYPED_AS_OF } from "./letters.js";
import { LEGEND_OF } from "./glyphLegend.js";
import { hasGlyph, glyphSVGMarkup } from "./glyphRender.js";

const RING_ACCENT = {
  given: "#c9a227",
  received: "#3f7cb5",
  made: "#3f9457",
  unassigned: "#aaaaaa",
};

// Same display-shortening need as the big keyboard, independently applied
// here since this grid's cells are even narrower (fixed square, not a
// flexible column).
const DISPLAY_LABEL = {
  "vowel.horizontal": "h.",
  "vowel.nub": "n.",
};

const FLASH_MS = 350;

export class CompactLegend {
  constructor(container) {
    this.container = container;
    this.keyEls = {};
    this.onKeyClick = null;
    this._build();
  }

  _build() {
    this.container.innerHTML = "";
    const entries = Object.entries(PLACEHOLDER_SPOKE_OF)
      .filter(([letter]) => letter !== REST) // engine device, not a census letter
      .sort((a, b) => a[1] - b[1]); // by spoke; ties keep their declared order

    entries.forEach(([letter, spoke]) => {
      const ring = ringForLetter(letter) || "unassigned";
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "legend-key";
      cell.style.setProperty("--accent", RING_ACCENT[ring]);
      const svg = hasGlyph(letter) ? glyphSVGMarkup(letter, { heightPx: 26 }) : null;
      if (svg) cell.innerHTML = svg;
      else cell.textContent = DISPLAY_LABEL[letter] || letter;
      cell.dataset.letter = letter;

      const legend = LEGEND_OF[letter];
      const shorthand = TYPED_AS_OF[letter];
      const legendPart = legend ? ` -- ${legend.object}${legend.sound ? ` (/${legend.sound}/)` : ""}` : "";
      cell.title = `${letter}${legendPart} -- spoke ${spoke}, ${ring}${shorthand ? ` -- type: ${shorthand}` : ""}`;

      cell.addEventListener("click", () => this.onKeyClick?.(letter));
      this.container.appendChild(cell);
      this.keyEls[letter] = cell;
    });
  }

  // Same real-activation-only contract as the big keyboard's flash --
  // callers only invoke this from inside the ring-tier-gated "sounds"
  // branch, never on a muted/passed hit.
  flash(letter) {
    const el = this.keyEls[letter];
    if (!el) return;
    clearTimeout(el._flashTimer);
    el.classList.add("legend-flash");
    el._flashTimer = setTimeout(() => el.classList.remove("legend-flash"), FLASH_MS);
  }
}
