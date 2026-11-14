import type {
  SiteAssistantPersona,
  SiteAssistantPlacementMode,
  SiteAssistantPosition,
  SiteAssistantSettings,
} from "./types";

/**
 * globalSettings.siteAssistant → a complete settings object (SPEC §1:
 * "missing keys = these defaults"). Everything here is public by nature — it
 * ships with the site — so the widget reads it straight from the catalogue.
 */

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const PERSONAS: SiteAssistantPersona[] = ["warm", "formal", "friendly", "concise"];
const MODES: SiteAssistantPlacementMode[] = ["all", "catalogue_and_courses", "routes"];

export const resolveSiteAssistantSettings = (raw: unknown): SiteAssistantSettings => {
  const s = obj(raw);
  const placement = obj(s.placement);
  const leads = obj(s.leads);
  const support = obj(s.support);
  const mode = MODES.includes(placement.mode as SiteAssistantPlacementMode)
    ? (placement.mode as SiteAssistantPlacementMode)
    : "all";
  return {
    enabled: s.enabled === true,
    name: str(s.name),
    avatarUrl: str(s.avatarUrl),
    greeting: str(s.greeting),
    persona: PERSONAS.includes(s.persona as SiteAssistantPersona) ? (s.persona as SiteAssistantPersona) : "warm",
    suggestions: Array.isArray(s.suggestions)
      ? s.suggestions.map(str).filter((x): x is string => !!x).slice(0, 6)
      : [],
    placement: {
      mode,
      routes: Array.isArray(placement.routes)
        ? placement.routes.map(str).filter((x): x is string => !!x)
        : [],
    },
    position: s.position === "bottom-left" ? "bottom-left" : "bottom-right",
    accentColor: str(s.accentColor),
    leads: { campaignId: str(leads.campaignId), consentText: str(leads.consentText) },
    support: {
      email: str(support.email),
      phone: str(support.phone),
      whatsapp: str(support.whatsapp),
      loginUrl: str(support.loginUrl),
    },
    embed: { enabled: obj(s.embed).enabled === true },
  };
};

/** Catalogue blocks that make a page a "catalogue" page for placement mode catalogue_and_courses. */
export const CATALOGUE_BLOCK_TYPES = new Set([
  "courseCatalog",
  "bookCatalogue",
  "courseShowcase",
  "productCourseGrid",
  "folderBrowser",
  "learningPath",
  "courseRecommendations",
]);

export const pageHasCatalogueBlock = (components: unknown): boolean =>
  Array.isArray(components) &&
  components.some((c) => {
    const comp = obj(c);
    return comp.enabled !== false && typeof comp.type === "string" && CATALOGUE_BLOCK_TYPES.has(comp.type);
  });

/** Site routes the assistant never shows on (PRD §6: not on login/checkout). */
const NEVER_ON = /^(login|signup|register|checkout|cart|payment|pay)(\/|$)/i;

/** "/About/" → "about"; home ("", "/", "home", "homepage") → "". */
export const normalizeSiteRoute = (route: string | null | undefined): string => {
  const clean = (route || "").trim().replace(/^\/+/, "").replace(/\/+$/, "").toLowerCase();
  return clean === "home" || clean === "homepage" ? "" : clean;
};

/**
 * Does a configured route pattern match the visitor's site route? Exact, or a
 * prefix pattern ending in "*" ("courses/*", "blog*"). "/" means home.
 */
export const routeMatches = (pattern: string, siteRoute: string): boolean => {
  const p = pattern.trim();
  if (p.endsWith("*")) {
    const prefix = normalizeSiteRoute(p.slice(0, -1));
    return siteRoute.startsWith(prefix);
  }
  return normalizeSiteRoute(p) === siteRoute;
};

export interface PlacementInput {
  settings: SiteAssistantSettings;
  /** Route inside the site, without the "/<tag>" base: "" (home), "about", "<courseId>". */
  siteRoute: string;
  /** What kind of page this is. */
  pageKind: "home" | "page" | "course";
  /** The page carries a course listing block (catalogue_and_courses). */
  hasCatalogueBlock: boolean;
  /** The Student AI launcher shows on this screen (only one launcher at a time). */
  studentAiVisible: boolean;
  /** The admin editor's preview of the site. */
  isPreview: boolean;
}

/** Should the hosted launcher show on this page? Pure; see SPEC §1 placement and PRD §6. */
export const shouldShowSiteAssistant = (input: PlacementInput): boolean => {
  const { settings, siteRoute, pageKind, hasCatalogueBlock, studentAiVisible, isPreview } = input;
  if (!settings.enabled || isPreview || studentAiVisible) return false;
  const route = normalizeSiteRoute(siteRoute);
  if (NEVER_ON.test(route)) return false;
  switch (settings.placement.mode) {
    case "catalogue_and_courses":
      return pageKind === "home" || pageKind === "course" || hasCatalogueBlock;
    case "routes":
      return settings.placement.routes.some((p) => routeMatches(p, route));
    case "all":
    default:
      return true;
  }
};

export type LauncherSide = "start" | "end";

export const launcherSide = (position: SiteAssistantPosition | null | undefined): LauncherSide =>
  position === "bottom-left" ? "start" : "end";

export interface LauncherStackInput {
  side: LauncherSide;
  /** globalSettings.whatsapp (WhatsAppFloatingButton). */
  whatsapp?: { enabled?: boolean; phone?: string; position?: "left" | "right" } | null;
  /** globalSettings.backToTop — that button sits bottom-end. */
  backToTop?: boolean;
  /** A fixed mobile action bar is at the foot of the page on phones. */
  hasMobileBar: boolean;
}

/**
 * Bottom offset for the launcher: lifts it clear of the mobile action bar
 * (same lift WhatsAppFloatingButton uses) and stacks it above another
 * floating button on the same side. Returns literal Tailwind classes so the
 * JIT sees them; `level` drives the checkout-bar lift in site-assistant.css.
 */
export const launcherStack = (input: LauncherStackInput): { level: 0 | 1; className: string } => {
  const wa = input.whatsapp;
  const waOn = !!wa?.enabled && !!(wa.phone || "").replace(/\D/g, "");
  const waSide: LauncherSide = wa?.position === "left" ? "start" : "end";
  const level: 0 | 1 = (waOn && waSide === input.side) || (input.backToTop && input.side === "end") ? 1 : 0;
  if (level === 1) {
    return { level, className: input.hasMobileBar ? "bottom-52 md:bottom-24" : "bottom-24" };
  }
  return { level, className: input.hasMobileBar ? "bottom-32 md:bottom-6" : "bottom-6" };
};
