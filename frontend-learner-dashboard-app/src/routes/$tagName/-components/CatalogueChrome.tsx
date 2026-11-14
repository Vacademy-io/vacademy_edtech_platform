import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { JsonRenderer } from "./JsonRenderer";
import { AudienceFormModal } from "./AudienceFormModal";
import { CourseCatalogueService } from "../-services/course-catalogue-service";
import { applyCataloguePrimaryColor } from "../-utils/catalogue-theme";
import { CatalogueNamingProvider } from "../-utils/catalogue-naming";
import { CatalogueLocaleProvider } from "../-utils/catalogue-locale";
import { siteUsesDevanagari } from "../-utils/catalogue-site-language";
import { collectConfigFontFamilies, ensureFontsLoaded } from "../-utils/catalogue-fonts";
import { buildSiteThemeVars } from "../-utils/catalogue-palette";
import { headerOffsetClass } from "./header/header-chrome";
import { DEVANAGARI_FALLBACK_FAMILY, withArabicFallback, withDevanagariFallback } from "@/utils/branding";

/** The catalogue home's body font when the site sets none (CourseCataloguePage). */
const CATALOGUE_DEFAULT_FONT_STACK = "'Figtree', system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

/**
 * Wraps a non-catalogue page in the catalogue's own chrome: theme preset,
 * light/dark mode, institute primary colour, fonts, and the header/footer the
 * admin configured in globalSettings.layout.
 *
 * Why: a visitor who follows "See all courses" from a catalogue section lands
 * on the product page, which has its own (usually empty) page_json and so
 * rendered bare — no navigation, no footer, and the page-builder DEFAULT
 * indigo instead of the institute's colour. Passing the catalogue slug along
 * lets that page keep the site it belongs to.
 *
 * With no tagName this renders children untouched, so a product page opened
 * directly (short link, ad, QR) looks exactly as it does today.
 */
interface CatalogueChromeProps {
  /** Catalogue slug the visitor came from — the chrome's source. */
  tagName?: string;
  instituteId: string;
  /**
   * Render the catalogue's footer below the page. Off for buying flows: the
   * footer is a wall of site navigation ("Our Philosophy", "FAQs", "Rewards")
   * sitting directly under the cart bar, and every link in it leads out of the
   * purchase the visitor is midway through.
   */
  showFooter?: boolean;
  children: React.ReactNode;
}

export const CatalogueChrome: React.FC<CatalogueChromeProps> = ({
  tagName,
  instituteId,
  showFooter = true,
  children,
}) => {
  const themeRootRef = useRef<HTMLDivElement>(null);

  // The catalogue pages fetch this through useEffect + service rather than
  // react-query, so this is its own request (cached here for repeat visits
  // within the session, not shared with theirs).
  const { data: catalogueData } = useQuery({
    queryKey: ["COURSE_CATALOGUE_BY_TAG", instituteId, tagName],
    queryFn: () => CourseCatalogueService.getCourseCatalogueByTag(instituteId, tagName || ""),
    enabled: !!tagName && !!instituteId,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const globalSettings = catalogueData?.globalSettings as any;

  useEffect(() => {
    applyCataloguePrimaryColor(themeRootRef.current, globalSettings?.theme?.primaryColor);
  }, [globalSettings?.theme?.primaryColor]);

  // A site offering हिन्दी / मराठी also gets a Devanagari face (loaded with
  // the faces its config uses); every other site is left exactly as before.
  const devanagari = siteUsesDevanagari(globalSettings?.i18n);
  useEffect(() => {
    if (devanagari && catalogueData) {
      ensureFontsLoaded([...collectConfigFontFamilies(catalogueData), DEVANAGARI_FALLBACK_FAMILY]);
    }
  }, [devanagari, catalogueData]);

  // Fonts are part of "the theme" the admin picked; mirrors the catalogue page.
  useEffect(() => {
    const fonts = globalSettings?.fonts;
    if (!fonts?.enabled || !fonts?.family) {
      // No catalogue font: the page keeps the app's own font, as before —
      // except on a site offering हिन्दी / मराठी, which gets the catalogue
      // home's default stack with the Devanagari face it just loaded (or the
      // face would download and Hindi still render in the OS fallback).
      if (devanagari) {
        document.body.style.fontFamily = withDevanagariFallback(withArabicFallback(CATALOGUE_DEFAULT_FONT_STACK));
      }
      return;
    }
    const family = devanagari
      ? withDevanagariFallback(withArabicFallback(fonts.family))
      : withArabicFallback(fonts.family);
    document.body.style.fontFamily = family;
    document.documentElement.style.setProperty("--app-font-family", family);
  }, [globalSettings?.fonts?.enabled, globalSettings?.fonts?.family, devanagari]);

  // The site header's campaign buttons and the mega menu's coming-soon
  // "Notify me" ask for a form through openAudienceForm, like on the
  // catalogue pages. Only listened for while the site chrome is drawn.
  const chromeDrawn = !!tagName && !!catalogueData;
  const [audienceForm, setAudienceForm] = useState<{ audienceId: string; title?: string } | null>(null);
  useEffect(() => {
    if (!chromeDrawn) return;
    const handleOpenAudienceForm = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (detail.audienceId) setAudienceForm({ audienceId: String(detail.audienceId), title: detail.title });
    };
    window.addEventListener("openAudienceForm", handleOpenAudienceForm);
    return () => window.removeEventListener("openAudienceForm", handleOpenAudienceForm);
  }, [chromeDrawn]);

  // Nothing to dress the page with — render it exactly as before, but still
  // supply the catalogue's words if we have them.
  // Both paths sit inside the site-language provider (settings undefined →
  // the base language, i.e. exactly as before), so the product page follows
  // the catalogue's ?lang= once the catalogue has loaded.
  if (!tagName || !catalogueData) {
    return (
      <CatalogueLocaleProvider settings={globalSettings?.i18n} scope={tagName || ""}>
      <CatalogueNamingProvider naming={globalSettings?.naming}>
        {children}
      </CatalogueNamingProvider>
      </CatalogueLocaleProvider>
    );
  }

  const header = globalSettings?.layout?.header;
  const footer = globalSettings?.layout?.footer;
  const headerEnabled = !!header && header.enabled !== false;
  const isDarkMode = globalSettings?.mode === "dark";

  const renderBlock = (id: string, component: unknown) => (
    <JsonRenderer
      page={{ id, route: id, title: id, components: [component] as any }}
      globalSettings={catalogueData.globalSettings}
      instituteId={instituteId}
      tagName={tagName}
      catalogueData={catalogueData}
    />
  );

  return (
    <CatalogueLocaleProvider settings={globalSettings?.i18n} scope={tagName}>
    <CatalogueNamingProvider naming={globalSettings?.naming}>
    <div
      ref={themeRootRef}
      data-catalogue-theme={globalSettings?.theme?.preset || "default"}
      className={`min-h-screen w-full bg-catalogue-bg${isDarkMode ? " dark" : ""}`}
      // Opt-in theme.palette / theme.contentMaxWidth vars; undefined (no style attribute) when unset.
      style={buildSiteThemeVars(globalSettings) as React.CSSProperties | undefined}
    >
      {headerEnabled && (
        <div className={globalSettings?.stickyHeader !== false ? "sticky top-0 z-50" : ""}>
          {renderBlock("header", header)}
        </div>
      )}

      {/* HeaderComponent renders a `fixed` <header> (h-16 md:h-20) and emits no
          spacer, and JsonRenderer deliberately skips its own pt-16 for a page
          whose id IS "header" — so the wrapper above collapses to zero height
          and the child page starts underneath the header, its first heading
          hidden. CourseCataloguePage's <main> and CourseDetailsPage reserve the
          same offset; mirror it here. */}
      <div className={headerEnabled ? headerOffsetClass(header?.props) : ""}>{children}</div>

      {showFooter && footer && footer.enabled !== false && renderBlock("footer", footer)}
      {audienceForm && (
        <AudienceFormModal
          isOpen={!!audienceForm}
          onClose={() => setAudienceForm(null)}
          audienceId={audienceForm.audienceId}
          title={audienceForm.title}
          instituteId={instituteId}
        />
      )}
    </div>
    </CatalogueNamingProvider>
    </CatalogueLocaleProvider>
  );
};

export default CatalogueChrome;
