import { useEffect, useSyncExternalStore } from "react";

/**
 * The skins drawn on Fun's screens with their own look: <html> carries ui-fun
 * plus one of these classes (lib/app-skin uiSkinClasses). Each keeps its own
 * colours (never the institute brand), its own type faces and, for the dark
 * ones, a night layer over the rest of the app.
 *
 * A plain module with no app imports, like use-fun-theme: the root reads it on
 * every page, so it must stay cheap for every skin.
 */
export type FunVariant = "neonCity" | "stage" | "calm" | "pulse";

export const FUN_VARIANT_CLASSES: Record<FunVariant, string> = {
  neonCity: "ui-neon-city",
  stage: "ui-stage",
  calm: "ui-calm",
  pulse: "ui-pulse",
};

/** Night skins: they repaint the whole app, so a test is taken with the skin held off. */
export const DARK_FUN_VARIANTS: ReadonlyArray<FunVariant> = ["neonCity", "pulse"];

/**
 * Each variant's faces. Google serves each per unicode-range, so an English
 * page never downloads the Devanagari files. Anton and Barlow Condensed have
 * no Devanagari: those skins name Teko for Hindi and Marathi headings.
 */
export const FUN_VARIANT_FONTS: Record<FunVariant, string> = {
  neonCity:
    "https://fonts.googleapis.com/css2?family=Anton&family=Manrope:wght@500;600;700;800&family=Teko:wght@600&family=Noto+Sans+Devanagari:wght@500;600;700;800&display=swap",
  stage:
    "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,600;1,9..144,600&family=Outfit:wght@400;500;600;700&family=Noto+Serif+Devanagari:wght@600&family=Noto+Sans+Devanagari:wght@500;600;700&display=swap",
  calm:
    "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Nunito+Sans:wght@400;600;700;800&family=Noto+Serif+Devanagari:wght@600&family=Noto+Sans+Devanagari:wght@500;600;700;800&display=swap",
  pulse:
    "https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,700;1,800&family=Inter:wght@500;600;700;800&family=Teko:wght@600&family=Noto+Sans+Devanagari:wght@500;600;700;800&display=swap",
};

const VARIANTS = Object.keys(FUN_VARIANT_CLASSES) as FunVariant[];

/** The variant <html> carries now, or null (plain Fun, or another skin). */
export function readFunVariant(root: Element | null = typeof document === "undefined" ? null : document.documentElement): FunVariant | null {
  if (!root) return null;
  return VARIANTS.find((v) => root.classList.contains(FUN_VARIANT_CLASSES[v])) ?? null;
}

/** Whether a night skin is on right now, outside React (for one-off checks). */
export const isDarkFunVariantOn = (): boolean => {
  const v = readFunVariant();
  return v !== null && DARK_FUN_VARIANTS.includes(v);
};

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

export const FUN_VARIANT_FONTS_LINK_ID = "fun-variant-skin-fonts";

/** Puts the variant's font stylesheet in <head> (replacing another variant's); null removes it. */
export function syncFunVariantFonts(variant: FunVariant | null, doc: Document = document): void {
  const existing = doc.getElementById(FUN_VARIANT_FONTS_LINK_ID) as HTMLLinkElement | null;
  if (!variant) {
    existing?.remove();
    return;
  }
  const href = FUN_VARIANT_FONTS[variant];
  if (existing) {
    if (existing.getAttribute("href") !== href) existing.setAttribute("href", href);
    return;
  }
  const link = doc.createElement("link");
  link.id = FUN_VARIANT_FONTS_LINK_ID;
  link.rel = "stylesheet";
  link.href = href;
  doc.head.appendChild(link);
}

const noVariant = () => null;

/** The active variant, kept current; loads its fonts while it is on. */
export function useFunVariant(): FunVariant | null {
  const variant = useSyncExternalStore(subscribe, () => readFunVariant(), noVariant);
  useEffect(() => {
    syncFunVariantFonts(variant);
  }, [variant]);
  return variant;
}
