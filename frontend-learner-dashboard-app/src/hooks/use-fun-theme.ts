import { useEffect, useSyncExternalStore } from "react";

/**
 * Returns true when the "Fun" UI skin is active (<html> carries ui-fun). While it
 * is, the skin's type faces are loaded; no other skin ever requests them, and the
 * stylesheet goes again when the skin is switched off.
 *
 * The class can change after mount (a late settings read, an institute switch),
 * so every reader shares one observer. A plain module with no app imports: the
 * root reads it on every page, so it must stay cheap for every skin.
 */
export const FUN_CLASS = "ui-fun";

const read = (): boolean => document.documentElement.classList.contains(FUN_CLASS);

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

/** The stylesheet element's id, so it is added once however many readers there are. */
export const FUN_FONTS_LINK_ID = "fun-skin-fonts";

/**
 * Nunito, plus Noto Sans Devanagari for Hindi and the other Devanagari languages.
 * Google serves both per unicode-range, so a page in English never downloads the
 * Devanagari files.
 */
export const FUN_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Nunito:wght@600;700;800;900&family=Noto+Sans+Devanagari:wght@600;700;800;900&display=swap";

/** Adds the skin's font stylesheet to <head> once. Safe to call repeatedly. */
export function ensureFunFonts(doc: Document = document): void {
  if (doc.getElementById(FUN_FONTS_LINK_ID)) return;
  const link = doc.createElement("link");
  link.id = FUN_FONTS_LINK_ID;
  link.rel = "stylesheet";
  link.href = FUN_FONTS_HREF;
  doc.head.appendChild(link);
}

/**
 * Takes the skin's font stylesheet out again once the skin is off, for example after
 * a switch to an institute on another skin. Does nothing when it is not there.
 */
export function removeFunFonts(doc: Document = document): void {
  doc.getElementById(FUN_FONTS_LINK_ID)?.remove();
}

export function useFunTheme(): boolean {
  const on = useSyncExternalStore(subscribe, read, () => false);
  useEffect(() => {
    if (on) ensureFunFonts();
    else removeFunFonts();
  }, [on]);
  return on;
}
