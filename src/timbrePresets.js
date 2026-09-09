// Named timbre presets for the two instrument categories ("note" -- the
// melody/chord kalimba, "drone" -- the sustained ring-voices), persisted in
// localStorage. Mirrors phrases.js's save/load pattern deliberately, same
// shape of problem (a small named list the user builds up over sessions).

const STORAGE_KEY = "orphograph.timbrePresets.v1";

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeAll(all) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function loadPresets(category) {
  return readAll()[category] || [];
}

export function savePreset(category, name, params) {
  const all = readAll();
  const list = all[category] || [];
  const existing = list.findIndex((p) => p.name === name);
  const entry = { name, params: { ...params } };
  if (existing >= 0) list[existing] = entry;
  else list.push(entry);
  all[category] = list;
  writeAll(all);
}

export function deletePreset(category, name) {
  const all = readAll();
  all[category] = (all[category] || []).filter((p) => p.name !== name);
  writeAll(all);
}

// "Preserve the parameter configurations of the last open session... avoid
// having to go through presets every time I refresh or update after a
// small modification." A continuously-overwritten snapshot of whatever's
// CURRENTLY live, distinct from the named preset list above (a different
// shape -- one blob per category, not a growable list) -- every param
// change updates it, and a fresh page load restores from it before any
// preset is ever selected, so tuning survives a refresh the way a real
// instrument's own knob positions would rather than snapping back to
// factory defaults every time.
const SESSION_STORAGE_KEY = "orphograph.timbreLastSession.v1";

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeSession(all) {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(all));
}

export function loadLastSession(category) {
  return readSession()[category] || null;
}

export function saveLastSession(category, params) {
  const all = readSession();
  all[category] = { ...params };
  writeSession(all);
}
