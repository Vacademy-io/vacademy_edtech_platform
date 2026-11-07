import { useSyncExternalStore } from "react";

/**
 * Whether the chatbot header shows the shortcut to /ai-settings (the gear).
 *
 * That page exposes raw API keys and token spend, so it is hidden from the
 * learner-facing chatbot by default. Anyone who needs it can still open
 * /ai-settings directly and flip this switch on to bring the gear back.
 *
 * The preference is per-device (localStorage): turning it on for yourself does
 * not reveal the gear to every learner on the institute.
 */
const LS_KEY = "AI_SETTINGS_SHORTCUT_ENABLED_V1";

function readStoredValue(): boolean {
  try {
    return localStorage.getItem(LS_KEY) === "true";
  } catch {
    // Private mode / storage blocked — stay hidden.
    return false;
  }
}

// useSyncExternalStore compares snapshots by identity, so the value has to come
// from this cached copy rather than a fresh localStorage read on every render.
let enabled = readStoredValue();
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function isAiSettingsShortcutEnabled(): boolean {
  return enabled;
}

export function setAiSettingsShortcutEnabled(next: boolean): void {
  try {
    localStorage.setItem(LS_KEY, String(next));
  } catch {
    // noop — the in-memory value below still drives this session.
  }
  if (next === enabled) return;
  enabled = next;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Keep other tabs (and the same tab's other mounted chatbots) in step.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== LS_KEY) return;
    const next = readStoredValue();
    if (next === enabled) return;
    enabled = next;
    emit();
  });
}

/**
 * Two independent ways in, and the gear appears if either says so: the
 * institute setting (Admin -> Settings -> AI Settings -> Student AI) shows it
 * to everyone, the device preference above shows it only here. Both default to
 * hidden, so an institute that has never touched the setting shows learners
 * nothing.
 */
export function shouldShowAiSettingsShortcut(
  instituteSetting: boolean | undefined,
  deviceOptIn: boolean
): boolean {
  return instituteSetting === true || deviceOptIn;
}

/** Re-renders the caller whenever the preference is toggled. */
export function useAiSettingsShortcutEnabled(): boolean {
  return useSyncExternalStore(
    subscribe,
    isAiSettingsShortcutEnabled,
    isAiSettingsShortcutEnabled
  );
}
