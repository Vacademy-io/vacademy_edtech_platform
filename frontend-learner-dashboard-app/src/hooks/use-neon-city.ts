import { useEffect, useSyncExternalStore } from "react";

/**
 * Returns true when the "Neon City" skin is active (<html> carries ui-neon-city,
 * always together with ui-fun: Neon City repaints Fun's screens at night). While
 * it is, the skin's type faces are loaded; no other skin requests them.
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

export const NEON_FONTS_LINK_ID = "neon-city-skin-fonts";

/**
 * Anton for headings and big buttons, Manrope for everything else, Teko for
 * Hindi and Marathi headings (Anton has no Devanagari) and Noto Sans
 * Devanagari for Devanagari body text. Google serves each per unicode-range.
 */
export const NEON_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Anton&family=Manrope:wght@500;600;700;800&family=Teko:wght@600&family=Noto+Sans+Devanagari:wght@500;600;700;800&display=swap";

export function ensureNeonFonts(doc: Document = document): void {
  if (doc.getElementById(NEON_FONTS_LINK_ID)) return;
  const link = doc.createElement("link");
  link.id = NEON_FONTS_LINK_ID;
  link.rel = "stylesheet";
  link.href = NEON_FONTS_HREF;
  doc.head.appendChild(link);
}

export function removeNeonFonts(doc: Document = document): void {
  doc.getElementById(NEON_FONTS_LINK_ID)?.remove();
}

export function useNeonCity(): boolean {
  const on = useSyncExternalStore(subscribe, read, () => false);
  useEffect(() => {
    if (on) ensureNeonFonts();
    else removeNeonFonts();
  }, [on]);
  return on;
}
