// Simple local UI preferences — not app/project data, just a browser-side
// toggle, so localStorage is enough (no Rust-backed storage needed).
const AUTO_UPDATE_CHECKS_KEY = "ampcore.autoUpdateChecksEnabled";

export function getAutoUpdateChecksEnabled(): boolean {
  return localStorage.getItem(AUTO_UPDATE_CHECKS_KEY) !== "false";
}

export function setAutoUpdateChecksEnabled(enabled: boolean): void {
  localStorage.setItem(AUTO_UPDATE_CHECKS_KEY, String(enabled));
}
