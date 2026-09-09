// Saved-phrase list: a few defaults (engine demos + the two register words
// already tied to specific letters in the census) plus whatever the user
// adds, persisted in localStorage. No orthography is settled yet, so
// spelling real register/lexicon words is a guess -- marked as such below,
// not presented as authoritative.

const STORAGE_KEY = "orphograph.savedPhrases.v1";

// "Set up for ideal display of its capabilities... ORFOGRAEF picked" --
// first in the list, since populatePhraseSelect (main.js) never sets an
// explicit `.selected`, so the browser's own default (first <option> wins)
// is what actually determines which one reads as "picked" on page load,
// matching the input field's own hardcoded default (index.html).
export const DEFAULT_PHRASES = [
  { name: "Orphograph", text: "O-R-F-O-G-R-AE-F" },
  { name: "Dogman", text: "D-AO-G-M-AE-N" },
  { name: "Respondeo atsi mootabor", text: "R-E-S-P-AO-N-D-E-O AE-T-S-I M-OO-T-A-B-O-R" },
  { name: "Veritas", text: "V-E-R-I-T-A-S" },
];

function readSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeSaved(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function loadAllPhrases() {
  return [...DEFAULT_PHRASES, ...readSaved()];
}

export function addPhrase(name, text) {
  const saved = readSaved();
  saved.push({ name, text });
  writeSaved(saved);
}

export function deletePhrase(name) {
  writeSaved(readSaved().filter((p) => p.name !== name));
}

export function isDefaultPhrase(name) {
  return DEFAULT_PHRASES.some((p) => p.name === name);
}
