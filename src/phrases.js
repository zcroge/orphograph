// Saved-phrase list: a few defaults (engine demos + the two register words
// already tied to specific letters in the census) plus whatever the user
// adds, persisted in localStorage. No orthography is settled yet, so
// spelling real register/lexicon words is a guess -- marked as such below,
// not presented as authoritative.

const STORAGE_KEY = "orphograph.savedPhrases.v1";

export const DEFAULT_PHRASES = [
  { name: "I-K-T O (rest + loop demo)", text: "I-K-T O" },
  { name: "I O (the two poles, one rest apart)", text: "I O" },
  { name: "SH-O-R-E (hush's own object)", text: "SH-O-R-E" },
  { name: "Otter (O's acrophon -- best-guess spelling, verify)", text: "O-T-R" },
  { name: "Djyash (field-forced hush/SH -- best-guess spelling, verify)", text: "JH-Y-A-SH" },
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
