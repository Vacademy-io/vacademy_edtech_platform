import React, { useState, useEffect } from "react";
import { RouteMatcher } from "../-services/route-matcher";
import { useTranslation } from "react-i18next";
import { DEVANAGARI_FALLBACK_FAMILY, withArabicFallback, withDevanagariFallback } from "@/utils/branding";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { getTerminology, getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { LeadCollectionModal } from "./LeadCollectionModal";
import { AudienceFormModal } from "./AudienceFormModal";
import { MobileActionBar } from "./MobileActionBar";
import { useCatalogueTracking, captureUtmOnce } from "../-utils/catalogue-tracking";
import { useResourceTrackingContext } from "../-utils/resource-unlock";
import { pageOpensWithOwnHeader } from "../-utils/page-own-header";
import { useInstituteNamingSettings } from "../-utils/institute-naming-seed";
import { CatalogueLocaleProvider, useSiteT } from "../-utils/catalogue-locale";
import { CatalogueNamingProvider } from "../-utils/catalogue-naming";
import { useSiteNavigate } from "../-utils/catalogue-route-search";
import { siteUsesDevanagari } from "../-utils/catalogue-site-language";
import { collectConfigFontFamilies, ensureFontsLoaded } from "../-utils/catalogue-fonts";
import { CatalogueSeoHead } from "./CatalogueSeoHead";
import { WhatsAppFloatingButton } from "./WhatsAppFloatingButton";
import { HostedSiteAssistant } from "@/components/site-assistant/HostedSiteAssistant";
import { IntroPageComponent } from "./IntroPageComponent";
import { JsonRenderer } from "./JsonRenderer";
import { buildPrimaryScaleVars } from "../-utils/style-utils";
import { withSiteThemeVars } from "../-utils/catalogue-palette";
import { CourseCatalogueService } from "../-services/course-catalogue-service";
import { CourseCatalogueData } from "../-types/course-catalogue-types";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { getTokenFromStorage } from "@/lib/auth/sessionUtility";
import { Preferences } from "@capacitor/preferences";
import { isNullOrEmptyOrUndefined } from "@/lib/utils";
import { shouldShowMobileGetStarted } from "../-utils/catalogue-cta";
import { headerOffsetClass } from "./header/header-chrome";

interface CourseSubPageProps {
  tagName: string;
  page: string;
  instituteId: string;
  instituteThemeCode?: string | null;
}

/** The catalogue page "/<tag>/<page>" shows: its route or id, with or without a leading "/". */
const isSubPage = (page: string) => (p: { route?: string; id?: string }) =>
  p.route === page || p.id === page || p.route === `/${page}` || p.id === `/${page}`;

/** The learner app's own "/<page>", the visitor's query kept. */
const AppRouteRedirect: React.FC<{ page: string }> = ({ page }) => (
  <Navigate to={`/${page}` as never} search={true} replace />
);

/**
 * Root-mounted host, and "<page>" is one of the learner app's own routes
 * ("/new/login", "/new/dashboard"): "/<tag>/<page>" stays on the site only for
 * a site page named like an app route (a Courses page — see
 * RouteMatcher.pagePath). Any other such address goes to the app's own page,
 * as the canonical "/<tag>/<x>" → "/<x>" redirect always sent it. That needs
 * only the root catalogue's page list, read through the memoised fetch the
 * page the visitor came from already made, and it is settled before the
 * site's terminology, fonts or tracking load. Once a site page shows, it
 * handles the visitor's next such address itself (appRouteRedirect).
 *
 * Every other sub-page (all of a classic host's) renders straight away.
 */
export const CourseSubPage: React.FC<CourseSubPageProps> = (props) => {
  const { tagName, page, instituteId } = props;
  const reserved = RouteMatcher.isReservedRootPage(tagName, page);
  const site = `${instituteId}::${tagName}`;
  const [verdict, setVerdict] = useState<{ site: string; page: string; to: "site" | "app" } | null>(null);
  const settled =
    verdict?.site === site && (verdict.to === "site" || verdict.page === page) ? verdict.to : null;

  useEffect(() => {
    if (!reserved || settled) return;
    const decide = (to: "site" | "app") => setVerdict({ site, page, to });
    // No institute to read the site from: the app's page, as before.
    if (!instituteId) {
      decide("app");
      return;
    }
    let cancelled = false;
    CourseCatalogueService.getCourseCatalogueByTagMemo(instituteId, tagName)
      .then((data) => {
        if (!cancelled) decide((data.pages || []).some(isSubPage(page)) ? "site" : "app");
      })
      .catch(() => {
        // The site cannot be read: the app's page, as before.
        if (!cancelled) decide("app");
      });
    return () => {
      cancelled = true;
    };
  }, [reserved, settled, site, instituteId, tagName, page]);

  if (!reserved || settled === "site") return <CourseSubPageContent {...props} />;
  if (settled === "app") return <AppRouteRedirect page={page} />;
  return <DashboardLoader />;
};

const CourseSubPageContent: React.FC<CourseSubPageProps> = ({
  tagName,
  page,
  instituteId,
  instituteThemeCode,
}) => {
  const { t } = useTranslation("coursePlayerA");
  // Institute terminology must be seeded before the first paint — see
  // institute-naming-seed.ts.
  const namingReady = useInstituteNamingSettings(instituteId);
  const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
  const courses = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course);

  const navigate = useNavigate();
  // Authored routes (the mobile bar) — see useSiteNavigate.
  const siteNavigate = useSiteNavigate();
  const domainRouting = useDomainRouting();
  const [catalogueData, setCatalogueData] = useState<CourseCatalogueData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLeadCollection, setShowLeadCollection] = useState(false);
  const [audienceForm, setAudienceForm] = useState<{ audienceId: string; title?: string; unlockUrl?: string; unlockLabel?: string; unlockTitle?: string } | null>(null);

  // Site-configured GA4 / Meta Pixel / GTM (Global Settings → Tracking) +
  // first-touch UTM capture for lead attribution.
  useCatalogueTracking((catalogueData?.globalSettings as any)?.tracking);
  useEffect(() => { captureUtmOnce(); }, []);
  // Freebie downloads need the institute/page; resource cards do not know it.
  useResourceTrackingContext(
    catalogueData ? { instituteId, catalogueId: (catalogueData as any)?.catalogueId, pageRoute: page ?? "" } : null
  );
  const [showIntroPage, setShowIntroPage] = useState(false);
  const [introCompleted, setIntroCompleted] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // Check if user is authenticated - removed previous botched redirect
  useEffect(() => {
    setIsCheckingAuth(false);
  }, []);

  // Fetch course catalogue data
  useEffect(() => {
    const fetchCatalogueData = async () => {
      // Reset error state when starting a new fetch
      setError(null);

      try {
        setIsLoading(true);
        console.log("[CourseSubPage] Fetching catalogue data for:", { instituteId, tagName, page });

        // A root-mounted site's page named like an app route: CourseSubPage
        // just found it through the memoised fetch, so reuse that request.
        const data = await (RouteMatcher.isReservedRootPage(tagName, page)
          ? CourseCatalogueService.getCourseCatalogueByTagMemo(instituteId, tagName)
          : CourseCatalogueService.getCourseCatalogueByTag(instituteId, tagName));

        console.log("[CourseSubPage] Successfully fetched catalogue data");
        setCatalogueData(data);

        // Check if intro page should be shown based on localStorage
        const introPageSeenKey = `introPageSeen_${instituteId}_${tagName}`;
        const hasSeenIntroPage = localStorage.getItem(introPageSeenKey) === 'true';

        // Check if lead collection form has already been submitted
        const leadCollectionSubmittedKey = `leadCollectionSubmitted_${instituteId}_${tagName}`;
        const hasSubmittedLeadCollection = localStorage.getItem(leadCollectionSubmittedKey) === 'true';

        if (data.introPage?.enabled && !hasSeenIntroPage) {
          setShowIntroPage(true);
        } else if (data.introPage?.enabled && hasSeenIntroPage) {
          // Mark intro as completed since user has already seen it
          setIntroCompleted(true);
        } else if (data.globalSettings.leadCollection.enabled && !hasSubmittedLeadCollection) {
          // Only show lead collection if no intro page or intro already seen, and form hasn't been submitted
          setShowLeadCollection(true);
        }
      } catch (err) {
        console.error("[CourseSubPage] Error fetching catalogue data:", err);
        setError(t("courseSubPage.loadCatalogueFailed", { course }));
      } finally {
        setIsLoading(false);
      }
    };

    // Only fetch if we have valid instituteId and tagName
    // This prevents premature API calls before domain routing completes
    if (instituteId && tagName && !isCheckingAuth) {
      console.log("[CourseSubPage] Starting catalogue data fetch");
      fetchCatalogueData();
    } else {
      console.log("[CourseSubPage] Waiting for required data:", {
        hasInstituteId: !!instituteId,
        hasTagName: !!tagName,
        isCheckingAuth,
      });
      // Keep loading state true while waiting for instituteId
      if (!instituteId || !tagName) {
        setIsLoading(true);
      }
    }
  }, [instituteId, tagName, isCheckingAuth]);

  // Apply font from JSON if fonts.enabled is true
  useEffect(() => {
    const fonts = catalogueData?.globalSettings?.fonts;
    // A site offering हिन्दी / मराठी also gets a Devanagari face after the
    // brand font, loaded with every face its config uses (as on the catalogue
    // home). Other sites keep exactly the stacks and links below.
    const devanagari = siteUsesDevanagari(catalogueData?.globalSettings?.i18n);
    if (devanagari) {
      ensureFontsLoaded([...collectConfigFontFamilies(catalogueData), DEVANAGARI_FALLBACK_FAMILY]);
    }

    if (!fonts?.enabled || !fonts?.family) {
      const defaultStack = "'Figtree', system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      document.body.style.fontFamily = devanagari ? withDevanagariFallback(defaultStack) : defaultStack;
      document.documentElement.style.removeProperty("--catalogue-heading-font");
      return;
    }

    const fontFamily = fonts.family.trim();
    const primaryFont = fontFamily.split(",")[0].replace(/['"]/g, "").trim();

    // Create Google Fonts link 
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
      primaryFont
    )}:wght@300;400;500;600;700&display=swap`;

    // Append link only once
    if (!document.querySelector(`link[href="${link.href}"]`)) {
      document.head.appendChild(link);
    }

    // Apply font exactly as specified in JSON, plus the Arabic fallback the
    // stack would otherwise drop (withArabicFallback preserves Latin order).
    const resolvedFontFamily = devanagari
      ? withDevanagariFallback(withArabicFallback(fontFamily))
      : withArabicFallback(fontFamily);
    document.body.style.fontFamily = resolvedFontFamily;
    document.documentElement.style.setProperty("--app-font-family", resolvedFontFamily);

    // Optional separate heading font (serif display over sans body) — same
    // contract as CourseCataloguePage: load it and expose the CSS var the
    // catalogue heading rule reads; unset → headings inherit the body font.
    const headingFamily = (fonts as { headingFamily?: string })?.headingFamily?.trim();
    if (headingFamily) {
      const primaryHeading = headingFamily.split(",")[0].replace(/['"]/g, "").trim();
      const headingHref = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
        primaryHeading
      )}:wght@300;400;500;600;700&display=swap`;
      if (!document.querySelector(`link[href="${headingHref}"]`)) {
        const headingLink = document.createElement("link");
        headingLink.rel = "stylesheet";
        headingLink.href = headingHref;
        document.head.appendChild(headingLink);
      }
      document.documentElement.style.setProperty("--catalogue-heading-font", headingFamily);
    } else {
      document.documentElement.style.removeProperty("--catalogue-heading-font");
    }

    console.log("[CourseSubPage] Applied font:", fontFamily, "Primary font:", primaryFont);
  }, [catalogueData]);


  // Apply institute theme
  useEffect(() => {
    if (instituteThemeCode) {
      document.documentElement.setAttribute('data-theme', instituteThemeCode);
    }
  }, [instituteThemeCode]);

  // Listen for custom event to open lead collection
  useEffect(() => {
    const handleOpenLeadCollection = () => {
      // Only show lead collection if it's enabled in JSON
      if (catalogueData?.globalSettings.leadCollection.enabled) {
        setShowLeadCollection(true);
      } else {
        console.log("[CourseSubPage] Lead collection is disabled, ignoring openLeadCollection event");
      }
    };

    window.addEventListener('openLeadCollection', handleOpenLeadCollection);

    return () => {
      window.removeEventListener('openLeadCollection', handleOpenLeadCollection);
    };
  }, [catalogueData]);

  // Listen for buttons asking to open an Audience campaign form as a popup
  // (action 'openForm' on buttonBlock / ctaBanner). Mirrors openLeadCollection.
  useEffect(() => {
    const handleOpenAudienceForm = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (detail.audienceId) {
        setAudienceForm({
          audienceId: detail.audienceId,
          title: detail.title,
          // Set by gated resource cards — the file to hand over after submit.
          unlockUrl: detail.unlockUrl,
          unlockLabel: detail.unlockLabel,
          unlockTitle: detail.unlockTitle,
        });
      }
    };
    window.addEventListener('openAudienceForm', handleOpenAudienceForm);
    return () => window.removeEventListener('openAudienceForm', handleOpenAudienceForm);
  }, []);

  // Handle lead collection modal
  const handleLeadCollectionClose = () => {
    if (catalogueData?.globalSettings.leadCollection.mandatory) {
      // If mandatory, don't allow closing
      return;
    }
    setShowLeadCollection(false);
  };

  const handleLeadCollectionSubmit = () => {
    setShowLeadCollection(false);
  };

  // Intro page handlers
  const handleIntroGetStarted = () => {
    // This will be handled internally by IntroPageComponent
    // No need to show separate lead collection modal
  };

  const handleIntroLogin = () => {
    // Navigate to login page
    navigate({ to: '/login' });
  };

  const handleIntroComplete = () => {
    setIntroCompleted(true);
    setShowIntroPage(false);

    // Mark intro page as seen in localStorage
    const introPageSeenKey = `introPageSeen_${instituteId}_${tagName}`;
    localStorage.setItem(introPageSeenKey, 'true');

    // Show lead collection if enabled and not already shown and not already submitted
    const leadCollectionSubmittedKey = `leadCollectionSubmitted_${instituteId}_${tagName}`;
    const hasSubmittedLeadCollection = localStorage.getItem(leadCollectionSubmittedKey) === 'true';

    if (catalogueData?.globalSettings.leadCollection.enabled && !showLeadCollection && !hasSubmittedLeadCollection) {
      setShowLeadCollection(true);
    }
  };

  const handleIntroClose = () => {
    setShowIntroPage(false);
    setIntroCompleted(true);

    // Mark intro page as seen in localStorage even when closed
    const introPageSeenKey = `introPageSeen_${instituteId}_${tagName}`;
    localStorage.setItem(introPageSeenKey, 'true');
  };

  // Scroll to top when page changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [page]);

  if (isLoading || isCheckingAuth || !namingReady) {
    return <DashboardLoader />;
  }

  // Root-mounted host, an app-route address this site has no page for (see
  // CourseSubPage) — the visitor moved on from a site page, the page was
  // removed since the list was read, or the site failed to load: the app's own
  // page, never a dead end.
  const appRouteRedirect = RouteMatcher.isReservedRootPage(tagName, page) ? (
    <AppRouteRedirect page={page} />
  ) : null;

  if (error || !catalogueData) {
    if (appRouteRedirect) return appRouteRedirect;
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">
            {error || t("courseSubPage.catalogueNotFound", { course })}
          </h2>
          <p className="text-gray-600 mb-4">
            {t("courseSubPage.catalogueNotLoaded", { course })}
          </p>
          <button
            onClick={() => navigate({ to: "/courses" })}
            className="px-4 py-2 bg-primary-600 text-white rounded-catalogue-sm hover:bg-primary-700"
          >
            {t("courseSubPage.goToCourses", { courses })}
          </button>
        </div>
      </div>
    );
  }

  // Find the page configuration that matches the current route
  const currentPage = catalogueData.pages.find(isSubPage(page));

  /** Same opt-out as CourseCataloguePage. This component is the one that
   *  ACTUALLY renders custom pages on published sites: /$tagName/$courseId/
   *  outranks /$tagName/$pageSlug in route matching, so the gate added to
   *  CourseCataloguePage never ran for them — found by tracing a live page's
   *  header parent chain over CDP after the config flag provably had no
   *  effect. An imported HTML page carries its own nav and footer. */
  const hidesSiteChrome = !!(currentPage as { hideSiteChrome?: boolean } | undefined)?.hideSiteChrome;

  // The builder previews a sub-page here on classic hosts
  // (/<tag>/<route>?preview=true): it shows the language its URL asks for and
  // never reads or writes the visitor's remembered one (as CourseCataloguePage).
  const isPreview =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("preview") === "true";

  // If no matching page found, show not found (in the site's language) —
  // unless the address is also the app's own page (see appRouteRedirect).
  if (!currentPage) {
    if (appRouteRedirect) return appRouteRedirect;
    console.warn("[CourseSubPage] No page found for route:", page);
    return (
      <CatalogueLocaleProvider settings={catalogueData.globalSettings?.i18n} scope={tagName} persist={!isPreview}>
        <SubPageNotFound page={page} onBack={() => navigate({ to: RouteMatcher.pagePath(tagName) })} />
      </CatalogueLocaleProvider>
    );
  }


  // The generic blue title band is FALLBACK chrome, for pages that never
  // introduce themselves (a bare cart or policy page). Any page that opens with
  // its own hero or heading already shows a title, so the band is duplicate
  // chrome stacked on top of a designed page.
  //
  // This used to test for heroSection only. Directory/reference pages — the
  // composer's `courses` archetype — deliberately open with a COMPACT
  // sectionHeading instead of a tall hero so the content owns the fold, which
  // meant they fell through to the fallback and got a blue bar sitting above
  // their own heading.
  const enabledComponents = (currentPage.components || []).filter(
    (c: any) => c?.enabled !== false
  );
  const hasOwnPageHeader = pageOpensWithOwnHeader(enabledComponents);
  const themeSettings = catalogueData?.globalSettings?.theme as any;

  return (
    // Site language (?lang=, remembered per tag) for everything on the page.
    // A single-language site renders exactly as before.
    <CatalogueLocaleProvider settings={catalogueData.globalSettings?.i18n} scope={tagName} persist={!isPreview}>
    {/* The site's own words (naming) on its sub-pages too, as on its home page. */}
    <CatalogueNamingProvider naming={catalogueData.globalSettings?.naming}>
    <div
      // pt-20 exists to clear the fixed site header; with the chrome hidden it
      // would just open the page on an 80px blank strip.
      className={`min-h-screen bg-catalogue-bg w-full pb-20 md:pb-0 ${hidesSiteChrome ? '' : headerOffsetClass((catalogueData.globalSettings as any)?.layout?.header?.props, 'pt-20')}`}
      data-catalogue-theme={themeSettings?.preset || "default"}
      data-catalogue-radius={themeSettings?.borderRadius || "rounded-catalogue-xs"}
      data-heading-scale={themeSettings?.headingScale || "default"}
      data-catalogue-atmosphere={themeSettings?.atmosphere?.canvas || "flat"}
      data-catalogue-motion={(catalogueData?.globalSettings as any)?.motion?.personality}
      data-catalogue-intensity={themeSettings?.atmosphere?.intensity || "subtle"}
      data-catalogue-density={(catalogueData?.globalSettings as any)?.compactness || "medium"}
      // Opt-in theme.palette / theme.contentMaxWidth vars join the primary scale (same object when unset).
      style={withSiteThemeVars(buildPrimaryScaleVars(themeSettings?.primaryColor), catalogueData?.globalSettings) as React.CSSProperties}
    >
      {/* A site with languages: the same title/description rules as the
          catalogue home (page SEO → institute branding), in the visitor's
          language. Any other site's sub-pages set no title, as before. */}
      {catalogueData.globalSettings?.i18n?.enabled && (
        <CatalogueSeoHead
          page={currentPage}
          instituteName={domainRouting.instituteName}
          course={course}
          courses={courses}
        />
      )}
      {/* Intro Page - Show first if enabled and not completed */}
      {showIntroPage && catalogueData?.introPage && (
        <IntroPageComponent
          introPage={catalogueData.introPage}
          onGetStarted={handleIntroGetStarted}
          onLogin={handleIntroLogin}
          onComplete={handleIntroComplete}
          onClose={handleIntroClose}
          leadCollectionSettings={catalogueData.globalSettings.leadCollection}
          instituteId={instituteId}
        />
      )}

      {/* Main Content - Only show after intro is completed or if no intro page */}
      {(!showIntroPage || introCompleted) && catalogueData && (
        <>
          {/* Header from JSON globalSettings */}
          {!hidesSiteChrome && (catalogueData.globalSettings as any).layout?.header && (catalogueData.globalSettings as any).layout?.header?.enabled !== false && (
            <JsonRenderer
              page={{
                id: "header",
                route: "header",
                title: "Header",
                components: [(catalogueData.globalSettings as any).layout.header]
              }}
              globalSettings={catalogueData.globalSettings}
              instituteId={instituteId}
              tagName={tagName}
              catalogueData={catalogueData}
            />
          )}

          {/* Page Title Header — fallback chrome only; suppressed when the page
              opens with its own hero or heading (see hasOwnPageHeader) */}
          {currentPage?.title && !hasOwnPageHeader && (
            <div
              className="w-full py-5 sm:py-6 lg:py-8"
              style={{
                backgroundColor: domainRouting.instituteThemeCode ?
                  `hsl(var(--primary))` :
                  '#3b82f6' // design-lint-ignore: page-builder default color
              }}
            >
              <div className="w-full px-4 sm:px-6 lg:px-8">
                <h1 className="text-lg sm:text-xl lg:text-2xl font-semibold text-white text-center">
                  <SubPageTitle title={currentPage.title} />
                </h1>
              </div>
            </div>
          )}

          {/* Render the current page components from JSON */}
          <JsonRenderer
            key={currentPage.id}
            page={currentPage}
            globalSettings={catalogueData.globalSettings}
            instituteId={instituteId}
            tagName={tagName}
            catalogueData={catalogueData}
          />

          {/* Footer from JSON globalSettings */}
          {!hidesSiteChrome && (catalogueData.globalSettings as any).layout?.footer && (catalogueData.globalSettings as any).layout?.footer?.enabled !== false && (
            <JsonRenderer
              page={{
                id: "footer",
                route: "footer",
                title: "Footer",
                components: [(catalogueData.globalSettings as any).layout.footer]
              }}
              globalSettings={catalogueData.globalSettings}
              instituteId={instituteId}
              tagName={tagName}
              catalogueData={catalogueData}
            />
          )}
        </>
      )}

      {/* Lead Collection Modal - Show when requested and intro is completed or not active */}
      {audienceForm && (
        <AudienceFormModal
          isOpen={!!audienceForm}
          onClose={() => setAudienceForm(null)}
          audienceId={audienceForm.audienceId}
          title={audienceForm.title}
          instituteId={instituteId}
          unlockUrl={audienceForm.unlockUrl}
          unlockLabel={audienceForm.unlockLabel}
          unlockTitle={audienceForm.unlockTitle}
        />
      )}
      {showLeadCollection && catalogueData && catalogueData.globalSettings.leadCollection.enabled && (!showIntroPage || introCompleted) && (
        <LeadCollectionModal
          isOpen={showLeadCollection}
          onClose={handleLeadCollectionClose}
          onSubmit={handleLeadCollectionSubmit}
          settings={{
            enabled: catalogueData.globalSettings.leadCollection.enabled,
            mandatory: catalogueData.globalSettings.leadCollection.mandatory,
            inviteLink: catalogueData.globalSettings.leadCollection.inviteLink,
            formStyle: catalogueData.globalSettings.leadCollection.formStyle,
            fields: catalogueData.globalSettings.leadCollection.fields || []
          }}
          instituteId={instituteId}
          mandatory={catalogueData.globalSettings.leadCollection.mandatory}
        />
      )}


      {/* Mobile action bar — mirrors the header's Auth/CTA buttons (see
          MobileActionBar): admins control it from Global Header, including
          campaign-form popup buttons; removing every header button hides it. */}
            <WhatsAppFloatingButton
        settings={(catalogueData?.globalSettings as any)?.whatsapp}
        hasMobileBar
      />

      {/* Site Assistant (globalSettings.siteAssistant) — see CourseCataloguePage. */}
      {(!showIntroPage || introCompleted) && (
        <HostedSiteAssistant
          globalSettings={catalogueData?.globalSettings}
          tagName={tagName}
          pageKind="page"
          pageComponents={currentPage?.components}
          hasMobileBar
        />
      )}

      {(!showIntroPage || introCompleted) && catalogueData && (
        <MobileActionBar
          catalogueData={catalogueData}
          pageSlug={page}
          legacyGetStartedVisible={!(catalogueData?.globalSettings?.courseCatalogeType?.enabled ?? false)}
          onLogin={handleIntroLogin}
          onLegacyGetStarted={() => {
            if (catalogueData?.globalSettings.leadCollection.enabled) {
              setShowLeadCollection(true);
            } else {
              console.log("[CourseSubPage] Lead collection is disabled, not showing modal");
            }
          }}
          // Same navigation as always; only while a site language is carried
          // does a route with its own query string go by `href` (see
          // useSiteNavigate), so ?lang= never follows a second "?".
          onNavigate={(route) => void siteNavigate(RouteMatcher.pagePath(tagName, route))}
        />
      )}
    </div>
    </CatalogueNamingProvider>
    </CatalogueLocaleProvider>
  );
};

/** The fallback title band's text: the page title in the visitor's language.
 *  The cart check stays on the authored title. */
const SubPageTitle: React.FC<{ title: string }> = ({ title }) => {
  const siteT = useSiteT();
  return (
    <>
      {siteT(title)} {title === "Your Cart" ? "🛒" : ""}
    </>
  );
};

/** "Page not found" for a route the catalogue has no page for. */
const SubPageNotFound: React.FC<{ page: string; onBack: () => void }> = ({ page, onBack }) => {
  const { t } = useTranslation("coursePlayerA");
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">
          {t("courseSubPage.pageNotFound")}
        </h2>
        <p className="text-gray-600 mb-4">
          {t("courseSubPage.pageNotFoundDetail", { page })}
        </p>
        <button
          onClick={onBack}
          className="px-4 py-2 bg-primary-600 text-white rounded-catalogue-sm hover:bg-primary-700"
        >
          {t("courseSubPage.goBackToCatalogue")}
        </button>
      </div>
    </div>
  );
};
