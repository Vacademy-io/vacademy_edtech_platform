/**
 * Looks of header buttons and nav items. Every "absent" case returns the exact
 * class string the header has always used, so a header authored before these
 * options renders byte-for-byte as before (header-variants.test.ts pins it).
 */

import type { CatalogueLocale } from "../../-utils/catalogue-i18n";

export type AuthLinkVariant = "primary" | "outline" | "text";

const isVariant = (v: unknown): v is AuthLinkVariant => v === "primary" || v === "outline" || v === "text";

/** Desktop bar: the original rule is "first button filled, the rest outlined". */
export const desktopAuthVariant = (style: unknown, index: number): AuthLinkVariant =>
  isVariant(style) ? style : index === 0 ? "primary" : "outline";

/** Mobile menu: the original rule there is "first button filled, the rest plain text". */
export const mobileAuthVariant = (style: unknown, index: number): AuthLinkVariant =>
  isVariant(style) ? style : index === 0 ? "primary" : "text";

export const DESKTOP_AUTH_CLASSES: Record<AuthLinkVariant, string> = {
  primary: "bg-primary-500 text-white hover:bg-primary-400",
  outline: "border border-primary-500 text-primary-500 hover:bg-primary-50",
  text: "text-catalogue-text-primary hover:text-primary-500 hover:bg-catalogue-interactive-hover",
};

export const MOBILE_AUTH_CLASSES: Record<AuthLinkVariant, string> = {
  primary: "bg-primary-500 text-white hover:bg-primary-400",
  outline: "border border-primary-500 text-primary-500 hover:bg-primary-50",
  text: "text-primary-500 hover:bg-primary-50",
};

/** Desktop nav item colours for the chosen active style (absent = 'pill'). */
export const desktopNavItemClasses = (active: boolean, activeStyle: unknown): string => {
  if (activeStyle === "underline") {
    return active
      ? "text-primary-500 underline decoration-2 underline-offset-8"
      : "text-catalogue-text-secondary hover:text-catalogue-text-primary";
  }
  return active
    ? "text-primary-500 bg-primary-50"
    : "text-catalogue-text-secondary hover:text-catalogue-text-primary hover:bg-catalogue-interactive-hover";
};

/**
 * Switcher order: the site's other languages first, its base language last —
 * "हिन्दी | EN" on an English site, as in the design. The Languages settings
 * always store the base language first and cannot reorder, so the stored
 * order cannot express this; among the other languages it is kept (only
 * languages the site offers; anything not listed follows in offered order).
 */
export const orderSwitcherLocales = (
  offered: CatalogueLocale[],
  authored: Array<Partial<CatalogueLocale>> | null | undefined,
  baseLocale?: string | null,
): CatalogueLocale[] => {
  const byCode = new Map(offered.map((l) => [l.code, l] as const));
  const out: CatalogueLocale[] = [];
  for (const l of Array.isArray(authored) ? authored : []) {
    const code = typeof l?.code === "string" ? l.code.trim().toLowerCase() : "";
    const hit = byCode.get(code);
    if (hit && !out.includes(hit)) out.push(hit);
  }
  for (const l of offered) if (!out.includes(l)) out.push(l);
  const base = (baseLocale || "").trim().toLowerCase();
  const baseEntry = base ? out.find((l) => l.code === base) : undefined;
  return baseEntry ? [...out.filter((l) => l !== baseEntry), baseEntry] : out;
};
