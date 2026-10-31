import React, { useState, useEffect, useRef } from "react";
import { RouteMatcher } from "../-services/route-matcher";
import { useTranslation } from "react-i18next";
import { DEVANAGARI_FALLBACK_FAMILY, withArabicFallback, withDevanagariFallback } from "@/utils/branding";
import { Capacitor } from "@capacitor/core";
import { getTerminology, getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { useBlocker, useLocation, useNavigate } from "@tanstack/react-router";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { LeadCollectionModal } from "./LeadCollectionModal";
import { AudienceFormModal } from "./AudienceFormModal";
import { MobileActionBar } from "./MobileActionBar";
import { useCatalogueTracking, captureUtmOnce, useCataloguePageView } from "../-utils/catalogue-tracking";
import { useResourceTrackingContext } from "../-utils/resource-unlock";
import { CatalogueNamingProvider } from "../-utils/catalogue-naming";
import { CatalogueLocaleProvider } from "../-utils/catalogue-locale";
import { useSiteNavigate } from "../-utils/catalogue-route-search";
import { siteUsesDevanagari } from "../-utils/catalogue-site-language";
import { CatalogueSeoHead } from "./CatalogueSeoHead";
import { useInstituteNamingSettings } from "../-utils/institute-naming-seed";
import { consumeCourseFinderRequest } from "../-utils/reopen-course-finder";
import {
  clearCourseFinderSelection,
  courseFinderScope,
  saveCourseFinderSelection,
} from "../-utils/course-finder-bus";
import { WhatsAppFloatingButton } from "./WhatsAppFloatingButton";
import { HostedSiteAssistant } from "@/components/site-assistant/HostedSiteAssistant";
import { IntroPageComponent } from "./IntroPageComponent";
import { JsonRenderer } from "./JsonRenderer";
import {
  CourseFinderWizard,
  type CourseFinderOptions,
  type CourseFinderSelection,
} from "./CourseFinderWizard";
import { buildPrimaryScaleVars } from "../-utils/style-utils";
import { withSiteThemeVars } from "../-utils/catalogue-palette";
import { CourseCatalogueService } from "../-services/course-catalogue-service";
import { CourseCatalogueData } from "../-types/course-catalogue-types";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { Helmet } from "react-helmet";
import { CaretUp } from "@phosphor-icons/react";
import { ensureFontsLoaded, collectConfigFontFamilies } from "../-utils/catalogue-fonts";
import { shouldShowMobileGetStarted } from "../-utils/catalogue-cta";
import { headerOffsetClass } from "./header/header-chrome";
import { PreviewPathProvider } from "../-utils/preview-path";
import { blogPostSlugFor } from "../-utils/blog-route";
import { jobSlugFor, pageHasJob } from "../-utils/job-openings";
import { ImageFitProvider, siteImageFit } from "@/components/common/fit-image/FitImage";
import {
  isEditorMessage,
  isFramed,
  isSamePath,
  isShownRoute,
  leavesDocument,
  previewRouteFromHref,
  readyTargets,
  scrubPreviewConfig,
} from "../-utils/preview-bridge";

interface CourseCataloguePageProps {
  tagName: string;
  instituteId: string;
  instituteThemeCode?: string | null;
  /** When set, renders the page matching this route slug instead of the home page */
  pageSlug?: string;
}

export const CourseCataloguePage: React.FC<CourseCataloguePageProps> = ({
  tagName,
  instituteId,
  instituteThemeCode,
  pageSlug,
}) => {
  const { t } = useTranslation("coursePlayerA");
  // Institute terminology must be in localStorage before the first paint —
  // see institute-naming-seed.ts. Read the terms only after it settles.
  const namingReady = useInstituteNamingSettings(instituteId);
  const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
  const courses = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course);
  const navigate = useNavigate();
  const location = useLocation();
  // Authored routes (the mobile bar) — see useSiteNavigate.
  const siteNavigate = useSiteNavigate();
  const domainRouting = useDomainRouting();
  const isAndroid = Capacitor.getPlatform() === 'android';
  const isIOS = Capacitor.getPlatform() === 'ios';
  const [catalogueData, setCatalogueData] = useState<CourseCatalogueData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLeadCollection, setShowLeadCollection] = useState(false);
  const [audienceForm, setAudienceForm] = useState<{ audienceId: string; title?: string; unlockUrl?: string; unlockLabel?: string; unlockTitle?: string } | null>(null);

  // Preview mode: bidirectional communication with admin editor iframe.
  // A property of the document the editor loaded, read once: a navigation in
  // Browse mode that drops ?preview=true (TanStack drops every parameter it
  // is not given) must not turn the editor's frame into a visitor's page —
  // with the institute's pixels, popups and page-view counts.
  const [isPreviewMode] = useState(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('preview') === 'true',
  );
  // The editor's marks (hidden-block strips, per-block frames) belong in the
  // editor's frame; the headless AI preview shoots the page as visitors see it.
  const previewChrome = isPreviewMode && isFramed();

  // Site-configured GA4 / Meta Pixel / GTM (Global Settings → Tracking) +
  // first-touch UTM capture for lead attribution. Never from the editor's
  // preview: an admin opening the page is not a visitor, and their pixels
  // and Traffic numbers must not count it.
  useCatalogueTracking(isPreviewMode ? null : (catalogueData?.globalSettings as any)?.tracking);


  useEffect(() => { captureUtmOnce(); }, []);
  // First-party page view. Fires per route, so SPA navigation between pages is
  // counted — the GA4/Pixel hooks above only serve the institute's own tools,
  // and most institutes never connect one.
  useCataloguePageView(
    catalogueData && !isPreviewMode ? { instituteId, catalogueId: (catalogueData as any)?.catalogueId, pageRoute: pageSlug ?? "" } : null
  );
  // Freebie downloads need the same institute/page; resource cards do not know it.
  useResourceTrackingContext(
    catalogueData && !isPreviewMode ? { instituteId, catalogueId: (catalogueData as any)?.catalogueId, pageRoute: pageSlug ?? "" } : null
  );
  // Non-mandatory lead collection is "armed" rather than shown immediately, then
  // surfaced on a scroll/dwell signal (see effect below) to avoid t=0 friction.
  const [leadArmed, setLeadArmed] = useState(false);
  const [showIntroPage, setShowIntroPage] = useState(false);
  const [introCompleted, setIntroCompleted] = useState(false);

  // Course Finder wizard: options arrive live from whichever courseCatalog
  // block(s) are on the page (see CourseCatalogComponent's
  // courseFinderOptionsReady broadcast) — never a separate fetch.
  const [courseFinderOptions, setCourseFinderOptions] = useState<CourseFinderOptions>({
    levels: [],
    sessions: [],
    tags: [],
  });
  const [hasCourseFinderOptions, setHasCourseFinderOptions] = useState(false);
  const [showCourseFinder, setShowCourseFinder] = useState(false);
  // How the picker was opened. "Back to courses" is an ADD to an existing
  // basket; a first-visit open is a fresh start. Only the latter may reset it.
  const reopenedFromCheckout = useRef(false);

  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  // Editor's Browse mode: the site is clickable (menus, filters, tabs) and
  // links to other pages switch the editor's page tab instead of leaving.
  const [previewInteractive, setPreviewInteractive] = useState(false);
  // The real route of the page the editor shows as this root page, so the
  // header lights up the right nav item.
  const [previewPath, setPreviewPath] = useState<string | undefined>(undefined);
  // The editor's origin, learned from its first message.
  const editorOrigin = useRef<string | null>(null);
  // Not framed (the headless preview) there is no editor to tell.
  const postToEditor = (message: Record<string, unknown>) => {
    if (isFramed()) window.parent.postMessage(message, editorOrigin.current ?? "*");
  };
  // A short note over the preview ("Forms don't send in the preview").
  const [previewNotice, setPreviewNotice] = useState<string | null>(null);
  // Once the editor has posted its draft, the slower published fetch must not
  // land on top of it and show the old site.
  const previewConfigReceived = useRef(false);


  // Fetch course catalogue data
  useEffect(() => {
    const fetchCatalogueData = async () => {
      // Reset error state when starting a new fetch
      setError(null);

      try {
        setIsLoading(true);
        console.log("[CourseCataloguePage] Fetching catalogue data for:", { instituteId, tagName });

        // Memoised: on a root-mounted host the route already fetched this
        // catalogue to classify the URL, so this is normally a cache hit.
        const data = await CourseCatalogueService.getCourseCatalogueByTagMemo(instituteId, tagName);
        if (previewConfigReceived.current) return;

        console.log("[CourseCataloguePage] Successfully fetched catalogue data");
        setCatalogueData(data);

        // Check if intro page should be shown based on localStorage
        const introPageSeenKey = `introPageSeen_${instituteId}_${tagName}`;
        const hasSeenIntroPage = localStorage.getItem(introPageSeenKey) === 'true';

        // Check if lead collection form has already been submitted
        const leadCollectionSubmittedKey = `leadCollectionSubmitted_${instituteId}_${tagName}`;
        const hasSubmittedLeadCollection = localStorage.getItem(leadCollectionSubmittedKey) === 'true';

        console.log("Checking intro page and lead collection:", {
          introPageEnabled: data.introPage?.enabled,
          leadCollectionEnabled: data.globalSettings.leadCollection.enabled,
          hasSeenIntroPage,
          hasSubmittedLeadCollection,
          introPageSeenKey,
          leadCollectionSubmittedKey
        });

        if (data.introPage?.enabled && !hasSeenIntroPage) {
          console.log("Setting showIntroPage to true - first time visit or cache cleared");
          setShowIntroPage(true);
        } else if (data.introPage?.enabled && hasSeenIntroPage) {
          console.log("Intro page already seen, skipping intro page");
          // Mark intro as completed since user has already seen it
          setIntroCompleted(true);
        } else if (data.globalSettings.leadCollection.enabled && !hasSubmittedLeadCollection) {
          // Mandatory gates immediately; non-mandatory is armed for a deferred
          // scroll/dwell trigger so we don't interrupt at zero intent.
          if (data.globalSettings.leadCollection.mandatory) {
            setShowLeadCollection(true);
          } else {
            setLeadArmed(true);
          }
        }
      } catch (err) {
        console.error("[CourseCataloguePage] Error fetching catalogue data:", err);
        // A draft-only site has nothing published; the editor's config stands.
        if (!previewConfigReceived.current) setError(t("courseSubPage.loadCatalogueFailed", { course }));
      } finally {
        setIsLoading(false);
      }
    };

    // Only fetch if we have valid instituteId and tagName
    // This prevents premature API calls before domain routing completes
    if (instituteId && tagName) {
      console.log("[CourseCataloguePage] Starting catalogue data fetch");
      fetchCatalogueData();
    } else {
      console.log("[CourseCataloguePage] Waiting for required data:", {
        hasInstituteId: !!instituteId,
        hasTagName: !!tagName,
      });
      // Keep loading state true while waiting for instituteId
      if (!instituteId || !tagName) {
        setIsLoading(true);
      }
    }
  }, [instituteId, tagName]);

  // Preview mode: receive live config updates and highlight signals from admin editor.
  // Only from the frame that embeds this page, or (headless preview, not
  // framed) from the page itself — see preview-bridge.ts.
  useEffect(() => {
    if (!isPreviewMode) return;

    // Signal readiness to the admin editor
    if (isFramed()) {
      for (const target of readyTargets()) window.parent.postMessage({ type: 'PREVIEW_READY' }, target);
    }

    const handler = (event: MessageEvent) => {
      if (!isEditorMessage(event)) return;
      if (isFramed()) editorOrigin.current = event.origin;
      // The editor's frame loaded again (or it is checking): still here.
      if (event.data?.type === 'PREVIEW_HELLO') postToEditor({ type: 'PREVIEW_READY' });
      if (event.data?.type === 'CATALOGUE_CONFIG_UPDATE' && event.data.payload) {
        previewConfigReceived.current = true;
        setCatalogueData(scrubPreviewConfig(event.data.payload));
        setPreviewPath(typeof event.data.previewPath === 'string' ? event.data.previewPath : undefined);
        setIsLoading(false);
        setError(null);
      }
      if (event.data?.type === 'PREVIEW_INTERACT') {
        setPreviewInteractive(event.data.on === true);
      }
      if (event.data?.type === 'HIGHLIGHT_COMPONENT') {
        const componentId: string | null = event.data.componentId || null;
        setSelectedComponentId(componentId);
        // Picked in the editor's Layers panel: bring it into view. A block
        // already on screen (e.g. just clicked here) is left where it is.
        if (componentId) {
          requestAnimationFrame(() => {
            const el = document.querySelector(`[data-cid="${CSS.escape(componentId)}"]`);
            const box = el?.getBoundingClientRect();
            if (el && box && (box.bottom < 0 || box.top > window.innerHeight)) {
              el.scrollIntoView({ block: 'start', behavior: 'smooth' });
            }
          });
        }
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePreviewComponentClick = (componentId: string, pageId: string, parentId?: string) => {
    postToEditor({ type: 'COMPONENT_SELECTED', componentId, pageId, ...(parentId ? { parentId } : {}) });
    setSelectedComponentId(componentId);
  };

  // Browse mode: a link to another page asks the editor to open that page
  // instead of navigating the frame away from the preview (the editor says
  // so when it is not a page of the site). Same-page jumps (#anchor, or a
  // link to the shown page) and new-tab external links behave as on the
  // live site.
  useEffect(() => {
    if (!previewInteractive) return;
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || (anchor.getAttribute("href") || "").startsWith("#")) return;
      const route = previewRouteFromHref(anchor.href, { origin: window.location.origin, tagName });
      if (route === null && anchor.target === "_blank") return;
      event.preventDefault();
      if (route !== null && isShownRoute(route, previewPath)) {
        const hash = new URL(anchor.href).hash.slice(1);
        let id = hash;
        try {
          id = decodeURIComponent(hash);
        } catch {
          /* a malformed escape: look the id up as written */
        }
        const target = id ? document.getElementById(id) : null;
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        else if (!hash) window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      postToEditor({ type: "PREVIEW_NAVIGATE", route, href: anchor.href });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [previewInteractive, tagName, previewPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // ...and navigation that replaces the document from code (Login buttons,
  // the logo, same-tab external links all set window.location): held where
  // the browser can hold it (Navigation API), so the editor's frame never
  // leaves the preview. The editor also notices if one gets through.
  useEffect(() => {
    if (!isPreviewMode || !isFramed()) return;
    const navigation = (window as unknown as { navigation?: EventTarget }).navigation;
    if (!navigation) return;
    const onNavigate = (event: Event) => {
      const nav = event as Event & Parameters<typeof leavesDocument>[0];
      if (!leavesDocument(nav)) return;
      event.preventDefault();
      const href = nav.destination?.url ?? "";
      postToEditor({
        type: "PREVIEW_NAVIGATE",
        route: previewRouteFromHref(href, { origin: window.location.origin, tagName }),
        href,
      });
    };
    navigation.addEventListener("navigate", onNavigate);
    return () => navigation.removeEventListener("navigate", onNavigate);
  }, [tagName]); // eslint-disable-line react-hooks/exhaustive-deps

  // No form sends from the preview: an editor trying the contact form must
  // not create a real lead (or the emails and calls that follow one). Site
  // search forms stay usable.
  useEffect(() => {
    if (!isPreviewMode) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onSubmit = (event: Event) => {
      if ((event.target as Element | null)?.closest?.('[role="search"]')) return;
      event.preventDefault();
      event.stopPropagation();
      setPreviewNotice(t("courseCataloguePage.previewFormNotSent"));
      clearTimeout(timer);
      timer = setTimeout(() => setPreviewNotice(null), 4000);
    };
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("submit", onSubmit, true);
      clearTimeout(timer);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ...and the same for navigation from code (header items, cards). A change
  // of query string only (filters, tabs) stays on this page.
  useBlocker({
    disabled: !previewInteractive,
    enableBeforeUnload: false,
    shouldBlockFn: ({ current, next }) => {
      // Same page, preview kept (a tab or filter in the query string): stay.
      // Same page WITHOUT ?preview=true (the header's Home or logo — every
      // shown page is posted as the root page): that is "open the home page".
      const keepsPreview = String((next.search as Record<string, unknown> | undefined)?.preview) === "true";
      if (isSamePath(next.pathname, current.pathname) && keepsPreview) return false;
      const route = previewRouteFromHref(next.pathname, { origin: window.location.origin, tagName });
      postToEditor({ type: "PREVIEW_NAVIGATE", route, href: next.pathname });
      return true;
    },
  });

  useEffect(() => {
    // A site offering हिन्दी / मराठी also gets a Devanagari face after the
    // brand font (loaded with the others); every other site's stack is
    // exactly as before.
    const devanagari = siteUsesDevanagari(catalogueData?.globalSettings?.i18n);
    const withScripts = (stack: string) =>
      devanagari ? withDevanagariFallback(withArabicFallback(stack)) : withArabicFallback(stack);

    // Load EVERY font face the config references (global family + every
    // per-component style.typography.fontFamily incl. responsive overrides)
    // in one merged Google-Fonts request. Previously only the global family
    // loaded, so per-component font picks silently fell back to system fonts.
    const families = collectConfigFontFamilies(catalogueData);
    ensureFontsLoaded(devanagari ? [...families, DEVANAGARI_FALLBACK_FAMILY] : families);

    const fonts = catalogueData?.globalSettings?.fonts;
    if (!fonts?.enabled || !fonts?.family) {
      document.body.style.fontFamily = withScripts(
        "'Figtree', system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
      );
      document.documentElement.style.removeProperty("--catalogue-heading-font");
      return;
    }

    // Apply the global font exactly as specified in JSON, plus the Arabic
    // fallback the stack would otherwise drop (Latin order is preserved).
    const fontFamily = withScripts(fonts.family.trim());
    document.body.style.fontFamily = fontFamily;
    document.documentElement.style.setProperty("--app-font-family", fontFamily);

    // Optional separate heading font (serif display over sans body). Set the
    // var consumed by the catalogue heading rule; clear it when unset so
    // headings fall back to the body font (byte-identical to before).
    const headingFamily = (fonts as { headingFamily?: string })?.headingFamily?.trim();
    if (headingFamily) {
      document.documentElement.style.setProperty("--catalogue-heading-font", headingFamily);
    } else {
      document.documentElement.style.removeProperty("--catalogue-heading-font");
    }
  }, [catalogueData]);

  // Apply institute theme
  useEffect(() => {
    if (instituteThemeCode) {
      document.documentElement.setAttribute('data-theme', instituteThemeCode);
    }
  }, [instituteThemeCode]);

  // Theme wiring — must be before early returns (Rules of Hooks)
  const wrapperRef = useRef<HTMLDivElement>(null);
  const themeSettings = (catalogueData?.globalSettings as any)?.theme;
  const themePreset = themeSettings?.preset || 'default';
  const themeRadius = themeSettings?.borderRadius || 'rounded-catalogue-xs';
  const isDarkMode = (catalogueData?.globalSettings as any)?.mode === 'dark';

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const primaryColor = themeSettings?.primaryColor as string | undefined;
    if (primaryColor && /^#[0-9a-fA-F]{6}$/.test(primaryColor)) {
      const r = parseInt(primaryColor.slice(1, 3), 16) / 255;
      const g = parseInt(primaryColor.slice(3, 5), 16) / 255;
      const b = parseInt(primaryColor.slice(5, 7), 16) / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const l = (max + min) / 2;
      let h = 0, s = 0;
      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
      }
      const H = Math.round(h * 360), S = Math.round(s * 100), L = Math.round(l * 100);
      el.style.setProperty('--primary-500', `${H} ${S}% ${L}%`);
      // Keep the shadcn base `--primary` var in sync with --primary-500. The
      // header Login button (and other shadcn `bg-primary` elements) read
      // hsl(var(--primary)); without this it stays on a stale/default green
      // while the rest of the catalogue uses the institute color — so the
      // Login button looked a different green from every other accent.
      el.style.setProperty('--primary', `${H} ${S}% ${L}%`);
      el.style.setProperty('--primary-400', `${H} ${S}% ${Math.min(L + 10, 90)}%`);
      el.style.setProperty('--primary-200', `${H} ${Math.max(S - 15, 10)}% ${Math.min(L + 28, 95)}%`);
      el.style.setProperty('--primary-50', `${H} ${Math.max(S - 30, 5)}% ${Math.min(L + 43, 98)}%`);
    } else {
      el.style.removeProperty('--primary-500');
      el.style.removeProperty('--primary');
      el.style.removeProperty('--primary-400');
      el.style.removeProperty('--primary-200');
      el.style.removeProperty('--primary-50');
    }
  }, [themeSettings?.primaryColor]);

  // Listen for custom event to open lead collection
  useEffect(() => {
    const handleOpenLeadCollection = () => {
      console.log("[CourseCataloguePage] Received openLeadCollection event");
      // Only show lead collection if it's enabled in JSON
      if (catalogueData?.globalSettings.leadCollection.enabled) {
        setShowLeadCollection(true);
      } else {
        console.log("[CourseCataloguePage] Lead collection is disabled, ignoring openLeadCollection event");
      }
    };

    console.log("[CourseCataloguePage] Adding openLeadCollection event listener");
    window.addEventListener('openLeadCollection', handleOpenLeadCollection);

    return () => {
      console.log("[CourseCataloguePage] Removing openLeadCollection event listener");
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
    console.log("[CourseCataloguePage] Closing lead collection modal");
    if (catalogueData?.globalSettings.leadCollection.mandatory) {
      // If mandatory, don't allow closing
      console.log("[CourseCataloguePage] Lead collection is mandatory, not allowing close");
      return;
    }
    setShowLeadCollection(false);
  };

  const handleLeadCollectionSubmit = () => {
    // Persist so the modal doesn't re-arm on subsequent visits/reloads.
    try {
      localStorage.setItem(
        `leadCollectionSubmitted_${instituteId}_${tagName}`,
        "true",
      );
    } catch {
      // ignore storage errors (private mode etc.)
    }
    setLeadArmed(false);
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
    console.log(`[CourseCataloguePage] Marked intro page as seen: ${introPageSeenKey}`);

    // Show lead collection if enabled and not already shown and not already submitted
    const leadCollectionSubmittedKey = `leadCollectionSubmitted_${instituteId}_${tagName}`;
    const hasSubmittedLeadCollection = localStorage.getItem(leadCollectionSubmittedKey) === 'true';

    if (catalogueData?.globalSettings.leadCollection.enabled && !showLeadCollection && !hasSubmittedLeadCollection) {
      if (catalogueData.globalSettings.leadCollection.mandatory) {
        setShowLeadCollection(true);
      } else {
        setLeadArmed(true);
      }
    }
  };

  // Deferred trigger for non-mandatory lead collection: surface the modal once
  // the visitor shows intent (scrolled ~600px) or after a dwell fallback.
  useEffect(() => {
    if (!leadArmed || showLeadCollection || isPreviewMode) return;
    // One-shot: disarm the instant we show it so dismiss/submit can't re-arm
    // the trigger (the effect re-runs when showLeadCollection flips back).
    const fire = () => {
      setLeadArmed(false);
      setShowLeadCollection(true);
    };
    const onScroll = () => {
      if (window.scrollY > 600) fire();
    };
    const timer = setTimeout(fire, 15000);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    };
  }, [leadArmed, showLeadCollection, isPreviewMode]);

  const handleIntroClose = () => {
    setShowIntroPage(false);
    setIntroCompleted(true);

    // Mark intro page as seen in localStorage even when closed
    const introPageSeenKey = `introPageSeen_${instituteId}_${tagName}`;
    localStorage.setItem(introPageSeenKey, 'true');
    console.log(`[CourseCataloguePage] Marked intro page as seen (closed): ${introPageSeenKey}`);
  };

  // Course Finder: collect live filter options from the page's course-grid
  // block(s) as soon as they're ready.
  useEffect(() => {
    const handleOptionsReady = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      setCourseFinderOptions({
        levels: Array.isArray(detail.levels) ? detail.levels : [],
        sessions: Array.isArray(detail.sessions) ? detail.sessions : [],
        tags: Array.isArray(detail.tags) ? detail.tags : [],
      });
      setHasCourseFinderOptions(true);
    };
    window.addEventListener('courseFinderOptionsReady', handleOptionsReady);
    return () => window.removeEventListener('courseFinderOptionsReady', handleOptionsReady);
  }, []);

  // Show it once — after intro/lead gating clears, options have arrived, and
  // this visitor hasn't completed or skipped it before at this tag page.
  useEffect(() => {
    if (isPreviewMode) return;
    if (!catalogueData?.globalSettings?.courseFinder?.enabled) return;
    if (!hasCourseFinderOptions) return;
    if (showIntroPage && !introCompleted) return;
    // "Back to courses" asks for the picker explicitly - that visitor is
    // going back to CHOOSE, which is the one time the once-ever seen flag
    // gets in the way. The request clears itself, so a later reload of the
    // same page behaves normally.
    if (consumeCourseFinderRequest(tagName)) {
      reopenedFromCheckout.current = true;
      setShowCourseFinder(true);
      return;
    }
    const seenKey = `courseFinderSeen_${instituteId}_${tagName}`;
    if (localStorage.getItem(seenKey) === 'true') return;
    setShowCourseFinder(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isPreviewMode,
    catalogueData?.globalSettings?.courseFinder?.enabled,
    hasCourseFinderOptions,
    showIntroPage,
    introCompleted,
  ]);

  const markCourseFinderSeen = () => {
    try {
      localStorage.setItem(`courseFinderSeen_${instituteId}_${tagName}`, 'true');
    } catch {
      // ignore storage errors (private mode etc.)
    }
  };

  const handleCourseFinderComplete = (selection: CourseFinderSelection) => {
    setShowCourseFinder(false);
    markCourseFinderSeen();
    // Store the ANSWER alongside the seen flag. Without this the flag outlives
    // the filter: a reload (or "View course" and back) re-mounts the grid with
    // no selection and no second chance to be asked, so the visitor lands on
    // every class's subjects at once. See course-finder-bus.
    saveCourseFinderSelection(courseFinderScope(instituteId, tagName), {
      levels: selection.levels,
      sessions: selection.sessions,
      tags: selection.tags,
      labels: selection.labels,
    });
    // Answering the picker normally starts a fresh basket. Answering it after
    // "Back to courses" must not: that visitor already has courses selected and
    // came back to add more, so wiping them loses work they cannot recover.
    const keepBasket = reopenedFromCheckout.current;
    reopenedFromCheckout.current = false;
    window.dispatchEvent(
      new CustomEvent('courseFinderApplied', { detail: { ...selection, keepBasket } }),
    );
  };

  const handleCourseFinderSkip = () => {
    setShowCourseFinder(false);
    markCourseFinderSeen();
    // Skipping IS an answer — "show me everything" — so it has to erase any
    // stored one, or a visitor who skips on a second visit gets silently
    // re-filtered by a class they picked weeks ago.
    clearCourseFinderSelection(courseFinderScope(instituteId, tagName));
    reopenedFromCheckout.current = false;
  };

  if (isLoading || !namingReady) {
    return <DashboardLoader />;
  }

  if (error || !catalogueData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-catalogue-bg px-4">
        <div className="catalogue-card flex max-w-md flex-col items-center gap-stack p-8 text-center">
          <h2 className="text-xl font-semibold text-catalogue-text-primary">
            {error || t("courseSubPage.catalogueNotFound", { course })}
          </h2>
          <p className="text-sm text-catalogue-text-secondary">
            {t("courseSubPage.catalogueNotLoaded", { course })}
          </p>
          <button
            onClick={() => navigate({ to: "/courses" })}
            className="catalogue-btn catalogue-btn-primary mt-1"
          >
            {t("courseSubPage.goToCourses", { courses })}
          </button>
        </div>
      </div>
    );
  }

  // Keep the tenant's branded tab title (set by TabBranding/use-domain-routing);
  // only fall back to a sensible default if none was applied. og:* uses the
  // richer institute name for link previews without overriding the tab title.
  // (A site with languages uses CatalogueSeoHead instead — see below.)
  const brandedTitle =
    (typeof document !== "undefined" && document.title) || "";
  const defaultCatalogueTitle = t("courseCataloguePage.defaultTitle", { course });
  const seoTitle = brandedTitle || domainRouting.instituteName || defaultCatalogueTitle;
  const ogTitle = domainRouting.instituteName || defaultCatalogueTitle;
  const seoDescription = domainRouting.instituteName
    ? t("courseCataloguePage.seoDescriptionWithInstitute", {
        courses,
        institute: domainRouting.instituteName,
      })
    : t("courseCataloguePage.seoDescription", { courses });

  /** Which page this URL resolves to. Shared by the chrome check and the
   *  render so the two can never disagree about what is on screen. */
  const matchesActivePage = (page: { id?: string; route?: string }) =>
    pageSlug
      ? page.route === pageSlug || page.route === `/${pageSlug}`
      : page.id === "home" ||
        page.route === "homepage" ||
        page.route === "/" ||
        page.route === "";

  /** An imported HTML page normally pastes in its own nav and footer, so the
   *  site's chrome would render a second set. Opt-out lives on the page. */
  const activePage = catalogueData.pages.find(matchesActivePage);
  /** While a blog article is open (/<page>/<slug> or ?post=), the page shows
   *  only its blog section: on a page with other sections (Free Resources:
   *  hero, resource cards, blog cards) the article would otherwise open as one
   *  band in the middle of them. Header and footer stay. The blog block's
   *  `articleSectionIds` keeps chosen sections (e.g. a newsletter signup)
   *  under the article, in page order. */
  const withArticleOnly = (page: CourseCatalogueData["pages"][number]) => {
    const components = page.components || [];
    // A job's own page (/<page>/<job-slug>) reads the same way: only the
    // jobOpenings section, and only when the slug names one of its jobs (an
    // unknown slug keeps the whole page, cards included).
    const jobs = components.find((c) => c?.type === "jobOpenings" && c.enabled !== false);
    if (jobs && pageHasJob(jobs.props, jobSlugFor(location.pathname, location.searchStr, tagName, page.route || ""))) {
      return { ...page, components: [jobs] };
    }
    const blog = components.find((c) => c?.type === "blog" && c.enabled !== false);
    if (!blog) return page;
    const slug = blogPostSlugFor(location.pathname, location.searchStr, tagName, page.route || "");
    if (!slug) return page;
    const keepIds: unknown = blog.props?.articleSectionIds;
    const keep = new Set(Array.isArray(keepIds) ? keepIds : []);
    const below = components.filter(
      (c) => c !== blog && c?.enabled !== false && !!c?.id && keep.has(c.id)
    );
    return { ...page, components: [blog, ...below] };
  };
  const hidesSiteChrome = !!(activePage as { hideSiteChrome?: boolean } | undefined)?.hideSiteChrome;

  return (
    // Site language (?lang=, remembered per tag): authored props, live data
    // and react-i18next chrome below all follow it. A single-language site
    // renders exactly as before.
    <CatalogueLocaleProvider
      settings={catalogueData.globalSettings?.i18n}
      scope={tagName}
      persist={!isPreviewMode}
    >
    <CatalogueNamingProvider naming={catalogueData?.globalSettings?.naming}>
    {/* Content images fill their box or fit it whole (FitImage); a site can
        keep every image filling with globalSettings.images.fit = "cover". */}
    <ImageFitProvider fit={siteImageFit(catalogueData?.globalSettings)}>
    <div
      ref={wrapperRef}
      className={`min-h-screen bg-catalogue-bg w-full pb-20 md:pb-0 md:pt-0${isDarkMode ? ' dark' : ''}`}
      data-catalogue-theme={themePreset}
      data-catalogue-radius={themeRadius}
      data-heading-scale={catalogueData?.globalSettings?.theme?.headingScale || 'default'}
      data-catalogue-atmosphere={themeSettings?.atmosphere?.canvas || 'flat'}
      data-catalogue-motion={(catalogueData?.globalSettings as any)?.motion?.personality}
      data-catalogue-intensity={themeSettings?.atmosphere?.intensity || 'subtle'}
      data-catalogue-density={(catalogueData?.globalSettings as any)?.compactness || 'medium'}
      // Opt-in theme.palette / theme.contentMaxWidth vars join the primary scale (same object when unset).
      style={withSiteThemeVars(buildPrimaryScaleVars(themeSettings?.primaryColor), catalogueData?.globalSettings) as React.CSSProperties}
    >
      {catalogueData.globalSettings?.i18n?.enabled ? (
        // A site with languages: title/description from stable inputs (page
        // SEO, institute branding) in the visitor's language — never read
        // back from document.title.
        <CatalogueSeoHead
          page={activePage}
          instituteName={domainRouting.instituteName}
          course={course}
          courses={courses}
        />
      ) : (
        <Helmet>
          <title>{seoTitle}</title>
          <meta name="description" content={seoDescription} />
          <meta property="og:title" content={ogTitle} />
          <meta property="og:description" content={seoDescription} />
          <meta property="og:type" content="website" />
        </Helmet>
      )}
      {/* Intro Page - Show first if enabled and not completed (hidden in preview mode) */}
      {showIntroPage && !isPreviewMode && catalogueData?.introPage && (
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
          {/* Keyboard users land on the header nav; this lets them jump the
              whole global chrome straight to the page content. */}
          <SkipToMainLink />
          {/* Header from JSON globalSettings.
              Suppressed when the active page asks for it: an imported HTML
              page usually pastes in its own nav and footer, so rendering the
              site's chrome as well gives the visitor two of each. */}
          {!hidesSiteChrome && (catalogueData.globalSettings as any).layout?.header && (catalogueData.globalSettings as any).layout?.header?.enabled !== false && (
            <div className={(catalogueData.globalSettings as any).stickyHeader !== false ? 'sticky top-0 z-50' : ''}>
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
                isPreviewMode={isPreviewMode}
                previewChrome={previewChrome}
                previewInteractive={previewInteractive}
                previewPath={previewPath}
                selectedComponentId={selectedComponentId}
                onComponentClick={handlePreviewComponentClick}
              />
            </div>
          )}

          {/* Legacy page title banner — removed in v2. Page titles are now handled by hero/textBlock components. */}
          {/* Render the matching page (home page by default, or specific slug) */}
          <PreviewPathProvider value={isPreviewMode ? previewPath : undefined}>
          {catalogueData.pages
            .filter(matchesActivePage)
            .map((page) => (
              <main id="catalogue-main" tabIndex={-1} key={page.id} className={hidesSiteChrome ? '' : headerOffsetClass((catalogueData.globalSettings as any).layout?.header?.props)} style={{ backgroundColor: (page as any).backgroundColor || undefined }}>
                <JsonRenderer
                  page={withArticleOnly(page)}
                  globalSettings={catalogueData.globalSettings}
                  instituteId={instituteId}
                  tagName={tagName}
                  isPreviewMode={isPreviewMode}
                  previewChrome={previewChrome}
                  previewInteractive={previewInteractive}
                  previewPath={previewPath}
                  selectedComponentId={selectedComponentId}
                  onComponentClick={handlePreviewComponentClick}
                />
              </main>
            ))}
          </PreviewPathProvider>

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
              isPreviewMode={isPreviewMode}
              previewChrome={previewChrome}
              previewInteractive={previewInteractive}
              selectedComponentId={selectedComponentId}
              onComponentClick={handlePreviewComponentClick}
            />
          )}
        </>
      )}

      {/* Lead Collection Modal - Show when requested, intro completed, and not in preview mode */}
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
          isPreviewMode={isPreviewMode}
        />
      )}
      {showLeadCollection && !isPreviewMode && catalogueData && catalogueData.globalSettings.leadCollection && (!showIntroPage || introCompleted) && (
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

      {showCourseFinder && !isPreviewMode && catalogueData?.globalSettings?.courseFinder && (
        <CourseFinderWizard
          steps={catalogueData.globalSettings.courseFinder.steps}
          mandatory={catalogueData.globalSettings.courseFinder.mandatory}
          stepLabels={catalogueData.globalSettings.courseFinder.stepLabels}
          levelGroups={catalogueData.globalSettings.courseFinder.levelGroups}
          options={courseFinderOptions}
          onComplete={handleCourseFinderComplete}
          onSkip={handleCourseFinderSkip}
        />
      )}

      {/* Mobile action bar — mirrors the header's Auth/CTA buttons (see
          MobileActionBar): admins control it from Global Header, including
          campaign-form popup buttons; removing every header button hides it. */}
            <WhatsAppFloatingButton
        settings={(catalogueData?.globalSettings as any)?.whatsapp}
        hasMobileBar
      />

      {/* Site Assistant (globalSettings.siteAssistant): stacks above the
          WhatsApp bubble and clears the mobile bar; hidden in preview. */}
      {(!showIntroPage || introCompleted) && (
        <HostedSiteAssistant
          globalSettings={catalogueData?.globalSettings}
          tagName={tagName}
          pageKind={pageSlug ? "page" : "home"}
          pageComponents={activePage?.components}
          hasMobileBar
        />
      )}

      {(!showIntroPage || introCompleted) && !isPreviewMode && catalogueData && (
        <MobileActionBar
          catalogueData={catalogueData}
          pageSlug={pageSlug}
          legacyGetStartedVisible={!(catalogueData?.globalSettings?.courseCatalogeType?.enabled ?? false)}
          onLogin={handleIntroLogin}
          onLegacyGetStarted={() => setShowLeadCollection(true)}
          // Same navigation as always; only while a site language is carried
          // does a route with its own query string go by `href` (see
          // useSiteNavigate), so ?lang= never follows a second "?".
          onNavigate={(route) => void siteNavigate(RouteMatcher.pagePath(tagName, route))}
          nativePad={isAndroid || isIOS}
        />
      )}

      {/* Back to Top Button */}
      {catalogueData?.globalSettings?.backToTop && !isPreviewMode && (
        <BackToTopButton />
      )}
      {/* The headless preview (not framed) shoots the page as visitors see it. */}
      {isPreviewMode && isFramed() && <PreviewRibbon notice={previewNotice} />}
    </div>
    </ImageFitProvider>
    </CatalogueNamingProvider>
    </CatalogueLocaleProvider>
  );
};

/** Always on in preview: an editor preview is never mistaken for the live
 *  site, and a framed copy of it is no use for passing off as one. */
const PreviewRibbon = ({ notice }: { notice: string | null }) => {
  const { t } = useTranslation("coursePlayerA");
  return (
    <div className="pointer-events-none fixed bottom-2 start-2 z-50 flex items-center gap-2">
      <span className="rounded-full bg-warning-500 px-2.5 py-0.5 text-xs font-semibold text-white shadow-sm">
        {t("courseCataloguePage.previewRibbon")}
      </span>
      {notice && (
        <span role="status" className="rounded-full bg-catalogue-text-primary px-3 py-0.5 text-xs text-catalogue-bg shadow-sm">
          {notice}
        </span>
      )}
    </div>
  );
};

/** Keyboard users land on the header nav; this jumps past the global chrome.
 *  Its own component so the label follows the site language (it renders
 *  inside CatalogueLocaleProvider, unlike the page shell's own `t`). */
const SkipToMainLink = () => {
  const { t } = useTranslation("coursePlayerA");
  return (
    <a href="#catalogue-main" className="catalogue-skip-link">
      {t("courseCataloguePage.skipToMainContent")}
    </a>
  );
};

/* ─── Back to Top Button ───────────────────────────────────────────────── */

const BackToTopButton = () => {
  const { t } = useTranslation("coursePlayerA");
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className="catalogue-fab fixed bottom-6 end-6 z-50 flex h-11 w-11 items-center justify-center rounded-full backdrop-blur active:scale-95 md:bottom-8 md:end-8"
      aria-label={t("courseCataloguePage.backToTop")}
    >
      <CaretUp size={20} weight="bold" aria-hidden="true" />
    </button>
  );
};
