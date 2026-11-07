import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { CatalogueLocale } from "../../-utils/catalogue-i18n";
import { useCatalogueLocale } from "../../-utils/catalogue-locale";
import { orderSwitcherLocales } from "./header-variants";
import { languageSwitcherClasses, type LanguageSwitcherVariant } from "./header-chrome";

/**
 * हिन्दी | EN — the site-language switch in the header. Renders only on a
 * site with more than one language (globalSettings.i18n.enabled); switching
 * goes through the catalogue locale provider, which remembers the choice and
 * reflects it in ?lang= (never the logged-in app's own language setting).
 * The other languages come first and the site's base language last.
 */
export const HeaderLanguageSwitcher: React.FC<{
  /** globalSettings.i18n.locales as authored — the order among the other languages. */
  authoredLocales?: Array<Partial<CatalogueLocale>> | null;
  className?: string;
  /** Absent = the original pill. "segmented" / "footer" = the design's bordered control (opt-in header / brand footer). */
  variant?: LanguageSwitcherVariant;
}> = ({ authoredLocales, className, variant }) => {
  const { t } = useTranslation("coursePlayerB");
  const { enabled, locales, locale, baseLocale, setLocale } = useCatalogueLocale();
  if (!enabled || locales.length < 2) return null;
  const options = orderSwitcherLocales(locales, authoredLocales, baseLocale);
  const styled = variant === "segmented" || variant === "footer" ? languageSwitcherClasses(variant) : null;

  return (
    <div
      role="group"
      aria-label={t("header.language.label", "Site language")}
      className={cn(styled ? styled.group : "inline-flex shrink-0 items-center rounded-full border border-catalogue-border p-0.5", className)}
    >
      {options.map((option) => {
        const active = option.code === locale;
        return (
          <button
            key={option.code}
            type="button"
            lang={option.code}
            aria-pressed={active}
            onClick={() => {
              if (!active) setLocale(option.code);
            }}
            className={
              styled
                ? styled.button(active)
                : cn(
                    "rounded-full px-2.5 py-1 text-xs font-semibold leading-none transition-colors duration-200",
                    active
                      ? "bg-primary-500 text-white"
                      : "text-catalogue-text-secondary hover:text-catalogue-text-primary hover:bg-catalogue-interactive-hover",
                  )
            }
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
};

export default HeaderLanguageSwitcher;
