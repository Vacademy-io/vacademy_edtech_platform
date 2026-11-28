import { useSyncExternalStore } from "react";

/**
 * Returns true when the "Neon City" skin is active (<html> carries ui-neon-city,
 * always together with ui-fun: Neon City repaints Fun's screens at night).
 *
 * A plain module with no app imports, like use-fun-theme: the root reads it on
 * every page, so it must stay cheap for every skin.
 */
export const NEON_CITY_CLASS = "ui-neon-city";

const read = (): boolean => document.documentElement.classList.contains(NEON_CITY_CLASS);

const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!observer) {
    observer = new MutationObserver(() => listeners.forEach((notify) => notify()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && observer) {
      observer.disconnect();
      observer = null;
    }
  };
}

/** Whether Neon City is on right now, outside React (for one-off checks). */
export const isNeonCityOn = (): boolean =>
  typeof document !== "undefined" && read();

/** Neon City's faces are loaded with the other Fun variants' (use-fun-variant). */
export function useNeonCity(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
