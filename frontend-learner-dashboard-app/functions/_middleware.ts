// Cloudflare Pages middleware that injects Open Graph meta tags
// for social media crawlers (WhatsApp, Facebook, Twitter, etc.)
// by fetching institute branding from the domain-routing API.

// Site languages (?lang=hi): the same pure helpers the app uses for its own
// <title>, so crawlers and visitors read one set of rules. Both files are
// dependency-free (no React, no DOM); a site without languages never reaches
// any of this.
import { LOCALE_PARAM, translateText, type CatalogueI18nSettings } from "../src/routes/$tagName/-utils/catalogue-i18n";
import {
  hreflangAlternates,
  localizedPageUrl,
  seoLocaleContext,
  withHtmlLang,
} from "../src/routes/$tagName/-utils/catalogue-seo";

// Search Console's URL-inspection and site-verification fetchers do not call
// themselves Googlebot; without them here a verification meta tag we inject
// is never seen and "Test live URL" shows the bare SPA shell.
const CRAWLER_UA_REGEX =
  /WhatsApp|facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|Discordbot|TelegramBot|Googlebot|Google-InspectionTool|Google-Site-Verification|Storebot-Google|bingbot|BingPreview|Applebot|DuckDuckBot|YandexBot|Baiduspider|PetalBot|Pinterest|Viber|Skype/i;

// Domain-specific backend mappings (same as src/config/baseUrl.ts)
const DOMAIN_BACKEND_MAP: Record<string, string> = {
  "letstalkvet.com": "https://api.letstalkvet.com",
};

const DEFAULT_BACKEND_BASE = "https://backend-stage.vacademy.io";

function getBackendBase(hostname: string): string {
  for (const [domain, backendUrl] of Object.entries(DOMAIN_BACKEND_MAP)) {
    if (hostname === domain || hostname.endsWith(`.${domain}`)) {
      return backendUrl;
    }
  }
  return DEFAULT_BACKEND_BASE;
}

function getMediaPublicUrl(backendBase: string): string {
  return `${backendBase}/media-service/public/get-public-url`;
}

function getDomainRoutingUrl(backendBase: string): string {
  return `${backendBase}/admin-core-service/public/domain-routing/v1/resolve`;
}

interface DomainRoutingResponse {
  instituteId: string;
  instituteName: string;
  instituteLogoFileId: string;
  instituteThemeCode: string;
  tabText?: string | null;
  tabIconFileId?: string | null;
  playStoreAppLink?: string | null;
  appStoreAppLink?: string | null;
  // Set when the host serves a catalogue at "/" (pages at /{route}, no tag prefix).
  rootCatalogueTag?: string | null;
}

async function resolveLogoUrl(fileId: string, backendBase: string): Promise<string> {
  try {
    const url = `${getMediaPublicUrl(backendBase)}?fileId=${encodeURIComponent(fileId)}&expiryDays=7`;
    const res = await fetch(url);
    if (res.ok) {
      const text = await res.text();
      // The API may return a plain URL string or JSON-wrapped string
      const cleaned = text.replace(/^"|"$/g, "").trim();
      if (cleaned.startsWith("http")) return cleaned;
    }
  } catch {
    // fall through
  }
  return "";
}

async function fetchBrandingOnce(
  domain: string,
  subdomain: string,
  backendBase: string
): Promise<DomainRoutingResponse | null> {
  try {
    const url = `${getDomainRoutingUrl(backendBase)}?domain=${encodeURIComponent(domain)}&subdomain=${encodeURIComponent(subdomain)}`;
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      // Edge-cache the resolve: crawlers arrive in bursts and every manifest
      // request now goes through here too. Branding changes rarely.
      cf: { cacheTtl: 300, cacheEverything: true },
    } as RequestInit);
    if (res.ok) {
      return (await res.json()) as DomainRoutingResponse;
    }
  } catch {
    // fall through
  }
  return null;
}

async function fetchBranding(
  domain: string,
  subdomain: string,
  backendBase: string
): Promise<DomainRoutingResponse | null> {
  const direct = await fetchBrandingOnce(domain, subdomain, backendBase);
  if (direct) return direct;
  // Apex domains (no subdomain) are stored with the wildcard subdomain "*" —
  // that is what the app itself sends (see getCurrentDomainInfo). Without this
  // retry, every two-part white-label host resolved to nothing and fell back to
  // Vacademy branding.
  if (!subdomain) {
    return await fetchBrandingOnce(domain, "*", backendBase);
  }
  return null;
}

interface PageSeo {
  title?: string;
  description?: string;
  ogImage?: string;
}

interface CataloguePage {
  id?: string;
  route?: string;
  title?: string;
  enabled?: boolean;
  seo?: { metaTitle?: string; metaDescription?: string; ogImage?: string };
  /** True when the page carries an enabled `blog` section, so "<page>/<slug>" addresses a post. */
  hasBlog?: boolean;
}

/** A published blog post, as the public catalogue-blog endpoint returns it. */
interface BlogPost {
  slug: string;
  title: string;
  excerpt?: string | null;
  cover_image_url?: string | null;
  author_name?: string | null;
  published_at?: string | null;
  updated_at?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
}

/**
 * Site-level SEO the page editor stores under globalSettings.seo. Every key is
 * optional; the crawler branch only emits what is present.
 */
interface CatalogueSeo {
  keywords?: string[] | string;
  googleSiteVerification?: string;
  organization?: {
    name?: string;
    legalName?: string;
    description?: string;
    founder?: string;
    foundingDate?: string;
    /** Absolute URL of a clean logo (Google wants ≥112px on a plain background). */
    logo?: string;
    email?: string;
    telephone?: string;
    address?: string;
    sameAs?: string[];
  };
}

interface CatalogueConfig {
  pages: CataloguePage[];
  seo: CatalogueSeo;
  /** Social profile URLs from the site footer — feed Organization.sameAs. */
  socials: string[];
  /** globalSettings.i18n — the site's languages and translations, when it has any. */
  i18n?: CatalogueI18nSettings;
}

/**
 * Resolve the catalogue JSON for one tag. Edge-cached briefly: crawlers arrive
 * in bursts (WhatsApp fetches per recipient) and the JSON changes rarely.
 */
async function fetchCatalogue(
  backendBase: string,
  instituteId: string,
  tagName: string
): Promise<CatalogueConfig | null> {
  try {
    const url =
      `${backendBase}/admin-core-service/public/course-catalogue/v1/institute/get/by-tag` +
      `?instituteId=${encodeURIComponent(instituteId)}&tagName=${encodeURIComponent(tagName)}`;
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      cf: { cacheTtl: 300, cacheEverything: true },
    } as RequestInit);
    if (!res.ok) return null;
    const data = (await res.json()) as { catalogue_json?: string };
    if (!data?.catalogue_json) return null;
    const cfg = JSON.parse(data.catalogue_json) as {
      pages?: Array<CataloguePage & { components?: Array<{ type?: string; enabled?: boolean }> }>;
      globalSettings?: {
        seo?: CatalogueSeo;
        i18n?: CatalogueI18nSettings;
        layout?: {
          footer?: {
            props?: {
              socials?: Array<{ url?: string }>;
              // The footer template files them under leftSection.
              leftSection?: { socials?: Array<{ url?: string }> };
            };
          };
        };
      };
    };
    const footer = cfg?.globalSettings?.layout?.footer?.props;
    const socials = [...(footer?.socials || []), ...(footer?.leftSection?.socials || [])]
      .map((s) => nonEmpty(s?.url))
      .filter((u) => /^https?:\/\//i.test(u));
    const pages: CataloguePage[] = (cfg?.pages || []).map((p) => ({
      id: p.id,
      route: p.route,
      title: p.title,
      enabled: p.enabled,
      seo: p.seo,
      hasBlog: (p.components || []).some((c) => c?.type === "blog" && c.enabled !== false),
    }));
    const i18n = cfg?.globalSettings?.i18n;
    return {
      pages,
      seo: cfg?.globalSettings?.seo || {},
      socials,
      ...(i18n && typeof i18n === "object" ? { i18n } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Published posts of an institute (no bodies), for the sitemap. One page of
 * up to 50; a blog past that size still gets its newest 50 listed.
 */
async function fetchBlogPosts(backendBase: string, instituteId: string): Promise<BlogPost[]> {
  try {
    const url =
      `${backendBase}/admin-core-service/public/catalogue-blog/v1/posts` +
      `?instituteId=${encodeURIComponent(instituteId)}&page=0&size=50`;
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      cf: { cacheTtl: 300, cacheEverything: true },
    } as RequestInit);
    if (!res.ok) return [];
    const data = (await res.json()) as { content?: BlogPost[] };
    return Array.isArray(data?.content) ? data.content : [];
  } catch {
    return [];
  }
}

/** One published post by slug; null when unknown, unpublished or scheduled. */
async function fetchBlogPost(backendBase: string, instituteId: string, slug: string): Promise<BlogPost | null> {
  try {
    const url =
      `${backendBase}/admin-core-service/public/catalogue-blog/v1/post` +
      `?instituteId=${encodeURIComponent(instituteId)}&slug=${encodeURIComponent(slug)}`;
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      cf: { cacheTtl: 300, cacheEverything: true },
    } as RequestInit);
    if (!res.ok) return null;
    const post = (await res.json()) as BlogPost;
    return post && post.slug ? post : null;
  } catch {
    return null;
  }
}

const normRoute = (r?: string) => (r || "").replace(/^\//, "").toLowerCase();

// First path segments the APP owns (src/routes/* — what reserved-app-routes.ts
// registers at runtime). Never a catalogue tag, and on a root-mounted host
// never a catalogue page either: the app's own route wins there, so its SEO
// must not be borrowed from a same-named catalogue page.
const APP_ROUTE_SEGMENTS = new Set([
  "account-deletion", "admission", "ai-settings", "assessment", "assignment", "audience-response",
  "auth-transfer", "booking-manage", "booking-response", "change-password", "chat", "courses",
  "dashboard", "delete-user", "downloads", "enquiry-response", "homework", "institute-selection",
  "kyc-complete", "leaderboard", "learner-invitation-response", "learning-centre", "live-class-guest",
  "login", "logout", "m", "my-files", "my-mentors", "my-reports", "parent", "pay", "payment-result",
  "planning", "privacy-policy", "product-pages", "profile", "referral", "register", "reports",
  "session-terminated", "signup", "site-assistant-embed", "study-library", "sub-org-learners", "sub-org-registration",
  "subscriptions", "terms-and-conditions", "try", "un", "user-profile", "verify",
  "branding-image", "assets", "icons", "images", "svgs", "vendor",
]);

const isHomePage = (p: CataloguePage) =>
  p.id === "home" || ["", "/", "home", "homepage"].includes(normRoute(p.route));

function findPage(pages: CataloguePage[], pageSlug: string | undefined): CataloguePage | undefined {
  return pageSlug
    ? pages.find((p) => normRoute(p.route) === normRoute(pageSlug))
    : pages.find(isHomePage) || pages[0];
}

/**
 * Which catalogue + page does this path address? Two shapes:
 *   /{tag}/{page?}         — the usual mount
 *   /{page?}               — a host whose catalogue is root-mounted
 * The root-mounted shape used to be misread as /{tag}: "/about" was looked up
 * as a catalogue called "about", failed, and every inner page of a root-mounted
 * site was handed the bare institute name as its title.
 */
async function resolveCataloguePage(
  backendBase: string,
  branding: DomainRoutingResponse,
  segs: string[]
): Promise<{ tag: string; rootMounted: boolean; page: CataloguePage; catalogue: CatalogueConfig; post?: BlogPost } | null> {
  const first = (segs[0] || "").toLowerCase();
  if (first && APP_ROUTE_SEGMENTS.has(first)) return null;
  const rootTag = nonEmpty(branding.rootCatalogueTag);
  if (rootTag && segs.length <= 1) {
    const catalogue = await fetchCatalogue(backendBase, branding.instituteId, rootTag);
    const page = catalogue ? findPage(catalogue.pages, segs[0]) : undefined;
    if (catalogue && page) return { tag: rootTag, rootMounted: true, page, catalogue };
  }
  // A blog post: /{blog-page}/{slug} on a root-mounted host. Checked before the
  // tagged reading so "/blog/<slug>" is not first tried as a catalogue named "blog".
  if (rootTag && segs.length === 2) {
    const catalogue = await fetchCatalogue(backendBase, branding.instituteId, rootTag);
    const page = catalogue ? findPage(catalogue.pages, segs[0]) : undefined;
    if (catalogue && page?.hasBlog) {
      const post = await fetchBlogPost(backendBase, branding.instituteId, decodeURIComponent(segs[1]));
      if (post) return { tag: rootTag, rootMounted: true, page, catalogue, post };
    }
  }
  if (segs.length >= 1 && segs.length <= 2) {
    const catalogue = await fetchCatalogue(backendBase, branding.instituteId, segs[0]);
    const page = catalogue ? findPage(catalogue.pages, segs[1]) : undefined;
    if (catalogue && page) return { tag: segs[0], rootMounted: false, page, catalogue };
  }
  // A blog post on a tagged site: /{tag}/{blog-page}/{slug}.
  if (segs.length === 3) {
    const catalogue = await fetchCatalogue(backendBase, branding.instituteId, segs[0]);
    const page = catalogue ? findPage(catalogue.pages, segs[1]) : undefined;
    if (catalogue && page?.hasBlog) {
      const post = await fetchBlogPost(backendBase, branding.instituteId, decodeURIComponent(segs[2]));
      if (post) return { tag: segs[0], rootMounted: false, page, catalogue, post };
    }
  }
  return null;
}

/**
 * Per-page SEO. The page editor collects seo.metaTitle / metaDescription /
 * ogImage on every catalogue page — but until now crawlers only ever saw
 * institute-level branding, so every page shared and ranked as the same
 * generic card. Let the page speak for itself; anything missing falls back to
 * branding exactly as before.
 */
function pageSeoOf(page: CataloguePage, post?: BlogPost): PageSeo {
  if (post) {
    return {
      title: nonEmpty(post.seo_title) || post.title,
      description: nonEmpty(post.seo_description) || nonEmpty(post.excerpt) || undefined,
      ogImage: nonEmpty(post.cover_image_url) || page.seo?.ogImage || undefined,
    };
  }
  return {
    title: page.seo?.metaTitle || page.title || undefined,
    description: page.seo?.metaDescription || undefined,
    ogImage: page.seo?.ogImage || undefined,
  };
}

/** Public URL of a catalogue page on this host. */
function pageUrl(origin: string, tag: string, rootMounted: boolean, page: CataloguePage): string {
  const route = isHomePage(page) ? "" : normRoute(page.route);
  const base = rootMounted ? origin : `${origin}/${tag}`;
  return route ? `${base}/${route}` : `${base}${rootMounted ? "/" : ""}`;
}

// Template pages that only make sense with a runtime binding (course details
// is rendered per course) — not sitemap entries in their own right.
const NON_INDEXABLE_ROUTES = new Set(["course-details"]);

/**
 * /sitemap.xml (root-mounted catalogue) and /{tag}/sitemap.xml (any catalogue).
 * One <url> per enabled page. No <lastmod>: the public payload carries no
 * timestamp, and a wrong one is worse than none.
 */
async function serveSitemap(
  context: Parameters<PagesFunction>[0],
  url: URL,
  tagFromPath: string | undefined
): Promise<Response> {
  const hostname = url.hostname;
  const backendBase = getBackendBase(hostname);
  const { domain, subdomain } = parseDomainParts(hostname);
  const branding = await fetchBranding(domain, subdomain, backendBase);
  const xml = (body: string, status = 200) =>
    new Response(body, {
      status,
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": "public, max-age=600, must-revalidate",
      },
    });
  const empty = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>';
  if (!branding) {
    if (isVacademyHost(hostname)) return context.next();
    return xml(empty, 404);
  }
  const rootTag = nonEmpty(branding.rootCatalogueTag);
  const tag = tagFromPath || rootTag;
  if (!tag) return xml(empty, 404);
  const catalogue = await fetchCatalogue(backendBase, branding.instituteId, tag);
  if (!catalogue) return xml(empty, 404);
  const rootMounted = !tagFromPath || tag === rootTag;
  const livePages = catalogue.pages.filter(
    (p) => p.enabled !== false && !NON_INDEXABLE_ROUTES.has(normRoute(p.route))
  );
  const entries: Array<{ loc: string; freq: string; priority: string; lastmod?: string }> = livePages.map((p) => ({
    loc: pageUrl(url.origin, tag, rootMounted, p),
    freq: isHomePage(p) ? "daily" : "weekly",
    priority: isHomePage(p) ? "1.0" : "0.7",
  }));
  // Blog posts live under their page: one <url> per published post, per blog
  // page (a post on the home page is addressed by ?post= and is not listed —
  // the same article has a clean address only on a dedicated page).
  const blogPages = livePages.filter((p) => p.hasBlog && !isHomePage(p));
  if (blogPages.length) {
    const posts = await fetchBlogPosts(backendBase, branding.instituteId);
    for (const p of blogPages) {
      const base = pageUrl(url.origin, tag, rootMounted, p);
      for (const post of posts) {
        const lastmod = nonEmpty(post.updated_at) || nonEmpty(post.published_at);
        entries.push({
          loc: `${base}/${encodeURIComponent(post.slug)}`,
          freq: "monthly",
          priority: "0.6",
          ...(lastmod && !Number.isNaN(Date.parse(lastmod)) ? { lastmod: new Date(lastmod).toISOString() } : {}),
        });
      }
    }
  }
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries
      .map(
        (e) =>
          `  <url><loc>${escapeHtml(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ""}<changefreq>${e.freq}</changefreq><priority>${e.priority}</priority></url>`
      )
      .join("\n") +
    "\n</urlset>";
  return xml(body);
}

/**
 * Per-host /robots.txt. The static file could not name a sitemap (it is the
 * same file on every domain), and the app's authenticated routes only ever
 * render a login form to a crawler — keep its budget on the public site.
 */
async function serveRobots(
  context: Parameters<PagesFunction>[0],
  url: URL
): Promise<Response> {
  const hostname = url.hostname;
  if (isVacademyHost(hostname)) return context.next();
  const backendBase = getBackendBase(hostname);
  const { domain, subdomain } = parseDomainParts(hostname);
  const branding = await fetchBranding(domain, subdomain, backendBase);
  // Only the sign-in gates and the logged-in shell. NOT /branding-image: the
  // og:image and the Organization logo are served through it, and Google's
  // image fetcher honours robots — disallowing it would hide the brand mark.
  const lines = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /login",
    "Disallow: /signup",
    "Disallow: /register",
    "Disallow: /dashboard",
    "Disallow: /study-library",
  ];
  if (branding && nonEmpty(branding.rootCatalogueTag)) {
    lines.push("", `Sitemap: ${url.origin}/sitemap.xml`);
  }
  return new Response(lines.join("\n") + "\n", {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=600, must-revalidate",
    },
  });
}

/**
 * Organization + WebSite structured data for a catalogue site. This is what
 * lets a search engine tie the brand name, logo and social profiles together
 * (knowledge panel, sitelinks) instead of ranking the page as an anonymous
 * SPA. Built from data the site already carries; globalSettings.seo.organization
 * adds what the JSON cannot infer (founder, contact, legal name).
 */
function buildStructuredData(
  origin: string,
  siteUrl: string,
  pageUrlAbs: string,
  branding: DomainRoutingResponse,
  catalogue: CatalogueConfig,
  logoUrl: string,
  pageTitle: string,
  pageDescription: string
): string {
  const org = catalogue.seo.organization || {};
  const name = nonEmpty(org.name) || nonEmpty(branding.instituteName) || nonEmpty(branding.tabText);
  const sameAs = Array.from(new Set([...(org.sameAs || []), ...catalogue.socials].map(nonEmpty).filter(Boolean)));
  const orgId = `${siteUrl}#organization`;
  const organization: Record<string, unknown> = {
    "@type": "EducationalOrganization",
    "@id": orgId,
    name,
    url: siteUrl,
    ...(nonEmpty(org.logo) || logoUrl
      ? { logo: { "@type": "ImageObject", url: nonEmpty(org.logo) || logoUrl } }
      : {}),
    ...(nonEmpty(org.legalName) ? { legalName: org.legalName } : {}),
    ...(nonEmpty(org.description) ? { description: org.description } : {}),
    ...(nonEmpty(org.founder) ? { founder: { "@type": "Person", name: org.founder } } : {}),
    ...(nonEmpty(org.foundingDate) ? { foundingDate: org.foundingDate } : {}),
    ...(nonEmpty(org.email) ? { email: org.email } : {}),
    ...(nonEmpty(org.telephone) ? { telephone: org.telephone } : {}),
    ...(nonEmpty(org.address) ? { address: org.address } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  };
  const website = {
    "@type": "WebSite",
    "@id": `${siteUrl}#website`,
    name,
    url: siteUrl,
    publisher: { "@id": orgId },
  };
  const webpage = {
    "@type": "WebPage",
    "@id": pageUrlAbs,
    url: pageUrlAbs,
    name: pageTitle,
    ...(pageDescription ? { description: pageDescription } : {}),
    isPartOf: { "@id": `${siteUrl}#website` },
    about: { "@id": orgId },
  };
  const graph = { "@context": "https://schema.org", "@graph": [organization, website, webpage] };
  // "</" inside a JSON string would end the script element early.
  return JSON.stringify(graph).replace(/<\//g, "<\\/");
}

/** schema.org BlogPosting for one article, alongside the site graph. */
function buildBlogPostingData(
  pageUrlAbs: string,
  siteUrl: string,
  post: BlogPost,
  imageUrl: string,
  description: string
): string {
  const posting: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": pageUrlAbs,
    mainEntityOfPage: pageUrlAbs,
    headline: nonEmpty(post.seo_title) || post.title,
    ...(description ? { description } : {}),
    ...(imageUrl ? { image: imageUrl } : {}),
    ...(nonEmpty(post.published_at) ? { datePublished: post.published_at } : {}),
    ...(nonEmpty(post.updated_at) ? { dateModified: post.updated_at } : {}),
    ...(nonEmpty(post.author_name) ? { author: { "@type": "Person", name: post.author_name } } : {}),
    publisher: { "@id": `${siteUrl}#organization` },
    isPartOf: { "@id": `${siteUrl}#website` },
  };
  return JSON.stringify(posting).replace(/<\//g, "<\\/");
}

function parseDomainParts(hostname: string): {
  domain: string;
  subdomain: string;
} {
  // e.g. learner.shikshanation.com → domain=shikshanation.com, subdomain=learner
  const parts = hostname.split(".");
  if (parts.length >= 3) {
    return {
      subdomain: parts[0],
      domain: parts.slice(1).join("."),
    };
  }
  // Two-part domain like shikshanation.com — no subdomain
  return { domain: hostname, subdomain: "" };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isVacademyHost(hostname: string): boolean {
  return (
    /(^|\.)vacademy\.io$/.test(hostname) ||
    hostname === "localhost" ||
    hostname === "127.0.0.1"
  );
}

/** Play Store links carry the package id in ?id=; related_applications wants it. */
function playPackageId(link: string): string {
  try {
    return new URL(link).searchParams.get("id") || "";
  } catch {
    return "";
  }
}

const nonEmpty = (v: string | null | undefined): string =>
  typeof v === "string" && v.trim() ? v.trim() : "";

/**
 * instituteThemeCode is not always a colour — plenty of institutes store a
 * theme *name* ("amber", "blue") that the app maps through theme.json. A
 * manifest theme_color must be a CSS colour, so only pass hex through and let
 * the browser pick its own default otherwise.
 */
const hexColor = (v: string | null | undefined): string => {
  const value = nonEmpty(v);
  return /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) ? value : "";
};

/**
 * Per-institute PWA manifest.
 *
 * The static public/manifest.webmanifest is hardcoded to name "Vacademy" with
 * Vacademy icons, and it was served verbatim on every white-labelled domain —
 * so Chrome's install prompt read "Install Vacademy" with the Vacademy mark on
 * e.g. students.zoeedtech.com. Resolve the institute from the hostname and
 * answer with its own name, icon and theme colour instead.
 *
 * When the institute ships a real native app we go further: `related_applications`
 * + `prefer_related_applications` tells Chrome to stop offering the PWA at all,
 * so the only thing a learner is nudged towards is that institute's own store
 * listing (the in-app <GetAppBanner /> does the actual suggesting).
 */
async function serveManifest(
  context: Parameters<PagesFunction>[0],
  url: URL
): Promise<Response> {
  const hostname = url.hostname;
  const backendBase = getBackendBase(hostname);
  const { domain, subdomain } = parseDomainParts(hostname);
  const branding = await fetchBranding(domain, subdomain, backendBase);

  const json = (body: unknown) =>
    new Response(JSON.stringify(body, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/manifest+json; charset=utf-8",
        "cache-control": "public, max-age=300, must-revalidate",
      },
    });

  if (!branding) {
    // Vacademy's own hosts legitimately want the Vacademy manifest.
    if (isVacademyHost(hostname)) return context.next();
    // On an unresolved white-label host, an install prompt is better suppressed
    // than mis-branded: no icons => Chrome treats the app as not installable,
    // so nobody is offered "Install Vacademy" under someone else's domain.
    return json({
      name: hostname,
      short_name: hostname,
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#ffffff",
    });
  }

  const name = nonEmpty(branding.tabText) || nonEmpty(branding.instituteName) || hostname;

  // Prefer the dedicated tab icon: it is the square-ish mark, whereas the main
  // institute logo is often a wide lockup that would be squashed into the
  // launcher's square icon slot.
  const iconFileId =
    nonEmpty(branding.tabIconFileId) || nonEmpty(branding.instituteLogoFileId);
  const iconSource = iconFileId ? await resolveLogoUrl(iconFileId, backendBase) : "";
  // Same-origin proxy: guarantees an image/* content-type (S3 objects are stored
  // with the wrong one) and keeps the icon on our own cache-control.
  const iconUrl = iconSource
    ? `${url.origin}/branding-image?u=${encodeURIComponent(iconSource)}`
    : "";

  // Declared sizes are what Chrome's installability check reads; it only requires
  // the fetched bitmap to decode. "any" purpose (not "maskable") on purpose — an
  // arbitrary institute logo has no safe zone and would be cropped into a circle.
  const icons = iconUrl
    ? ["96x96", "128x128", "192x192", "256x256", "512x512"].map((sizes) => ({
        src: iconUrl,
        sizes,
        purpose: "any",
      }))
    : [];

  const play = nonEmpty(branding.playStoreAppLink);
  const itunes = nonEmpty(branding.appStoreAppLink);
  const relatedApplications = [
    ...(play
      ? [{ platform: "play", url: play, ...(playPackageId(play) ? { id: playPackageId(play) } : {}) }]
      : []),
    ...(itunes ? [{ platform: "itunes", url: itunes }] : []),
  ];

  return json({
    name,
    short_name: name,
    description: nonEmpty(branding.instituteName) || name,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    ...(hexColor(branding.instituteThemeCode)
      ? { theme_color: hexColor(branding.instituteThemeCode) }
      : {}),
    orientation: "portrait-primary",
    categories: ["education", "productivity"],
    lang: "en-US",
    icons,
    ...(relatedApplications.length
      ? {
          related_applications: relatedApplications,
          // The institute has its own app — don't compete with it.
          prefer_related_applications: true,
        }
      : {}),
  });
}

/**
 * Per-institute /favicon.ico.
 *
 * The crawler branch below rewrites the icon <link> tags in the HTML, but that
 * only helps consumers that (a) send a crawler UA we recognise and (b) read the
 * markup at all. Google's favicon fetcher does neither reliably, and a browser
 * with no icon link requests /favicon.ico by convention. That path used to be
 * excluded from Functions in public/_routes.json, so every white-labelled
 * domain served the static Vacademy "V" — which is what Google indexed and
 * showed next to e.g. readonrent.in.
 *
 * Resolve the institute from the hostname and redirect to its own mark instead.
 * A redirect (rather than proxying the bytes) reuses /branding-image, which
 * already fixes the wrong content-type S3 hands back for branding uploads.
 */
async function serveFavicon(
  context: Parameters<PagesFunction>[0],
  url: URL
): Promise<Response> {
  const hostname = url.hostname;
  const backendBase = getBackendBase(hostname);
  const { domain, subdomain } = parseDomainParts(hostname);
  const branding = await fetchBranding(domain, subdomain, backendBase);

  // Prefer the dedicated tab icon for the same reason the manifest does: the
  // main logo is often a wide lockup, and a favicon slot is square.
  const iconFileId = branding
    ? nonEmpty(branding.tabIconFileId) || nonEmpty(branding.instituteLogoFileId)
    : "";
  const iconSource = iconFileId ? await resolveLogoUrl(iconFileId, backendBase) : "";

  if (iconSource) {
    return new Response(null, {
      status: 302,
      headers: {
        location: `${url.origin}/branding-image?u=${encodeURIComponent(iconSource)}`,
        // Short enough that a branding change propagates the same day. The old
        // immutable year-long rule on *.ico pinned the wrong mark for far longer
        // than any fix could undo.
        "cache-control": "public, max-age=3600, must-revalidate",
      },
    });
  }

  // Vacademy's own hosts legitimately want the Vacademy mark.
  if (isVacademyHost(hostname)) return context.next();

  // Unresolved white-label host: no icon beats someone else's icon. Same
  // reasoning as the cold-cache branch of the inline script in index.html.
  return new Response(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"></svg>',
    {
      status: 200,
      headers: {
        "content-type": "image/svg+xml",
        "cache-control": "public, max-age=300, must-revalidate",
      },
    }
  );
}

export const onRequest: PagesFunction = async (context) => {
  const { request } = context;
  const ua = request.headers.get("user-agent") || "";
  const url = new URL(request.url);

  // Per-institute PWA manifest. Handled before the crawler check because this
  // one is for real browsers, not bots.
  if (url.pathname === "/manifest.webmanifest") {
    return serveManifest(context, url);
  }

  // Per-institute favicon. Also handled before the crawler check: the whole
  // point is that the callers that ask for it (browsers, Google's favicon
  // fetcher) do not identify as crawlers.
  if (url.pathname === "/favicon.ico") {
    return serveFavicon(context, url);
  }

  // Per-host robots.txt and sitemaps — also for real browsers and search
  // engines' non-crawler fetchers, hence before the UA check.
  if (url.pathname === "/robots.txt") {
    return serveRobots(context, url);
  }
  const sitemapMatch = url.pathname.match(/^\/(?:([^/]+)\/)?sitemap\.xml$/);
  if (sitemapMatch) {
    return serveSitemap(context, url, sitemapMatch[1]);
  }

  // Only intercept for crawlers
  if (!CRAWLER_UA_REGEX.test(ua)) {
    return context.next();
  }

  // Only intercept HTML page requests, not assets
  const ext = url.pathname.split(".").pop()?.toLowerCase();
  if (
    ext &&
    ["js", "css", "png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "woff", "woff2", "ttf", "json", "webmanifest"].includes(ext)
  ) {
    return context.next();
  }

  // Get the original HTML response
  const response = await context.next();
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    return response;
  }

  const hostname = url.hostname;
  const backendBase = getBackendBase(hostname);
  const { domain, subdomain } = parseDomainParts(hostname);

  // Fetch branding from domain-routing API
  const branding = await fetchBranding(domain, subdomain, backendBase);
  if (!branding) {
    return response;
  }

  // Try page-level SEO for catalogue routes (/{tag}, /{tag}/{page}, or /{page}
  // on a root-mounted host); every other route — and any failure — keeps the
  // branding fallback.
  const segs = url.pathname.split("/").filter(Boolean);
  // Up to three segments: /{tag}/{blog-page}/{post-slug} is the longest catalogue address.
  const looksLikeCatalogue = segs.length <= 3 && !APP_ROUTE_SEGMENTS.has((segs[0] || "").toLowerCase());
  const resolved = looksLikeCatalogue
    ? await resolveCataloguePage(backendBase, branding, segs)
    : null;
  const pageSeo = resolved ? pageSeoOf(resolved.page, resolved.post) : null;
  const post = resolved?.post;

  // The request's site language: ?lang= when the site offers it and has
  // translations for it, else its base language. null for a site without
  // languages — every tag below is then exactly what it was before languages
  // existed.
  const seoLocale = resolved
    ? seoLocaleContext(resolved.catalogue.i18n, url.searchParams.get(LOCALE_PARAM))
    : null;
  // Titles and descriptions through the site dictionary (identity when null
  // or when the string has no translation).
  const localize = (text: string): string => (seoLocale ? translateText(text, seoLocale.dict) : text);

  const title = escapeHtml(
    localize(pageSeo?.title || branding.tabText || branding.instituteName || "")
  );
  const description = escapeHtml(
    localize(pageSeo?.description || `${branding.instituteName}`)
  );

  // The big unfurl thumbnail uses the main institute logo; the favicon /
  // apple-touch-icon prefer the dedicated tab icon. Resolve both (deduped).
  const ogImageFileId =
    branding.instituteLogoFileId || branding.tabIconFileId || "";
  const faviconFileId =
    branding.tabIconFileId || branding.instituteLogoFileId || "";
  const [ogImage, faviconResolved] = await Promise.all([
    ogImageFileId ? resolveLogoUrl(ogImageFileId, backendBase) : Promise.resolve(""),
    faviconFileId === ogImageFileId
      ? Promise.resolve("")
      : faviconFileId
        ? resolveLogoUrl(faviconFileId, backendBase)
        : Promise.resolve(""),
  ]);
  const favicon = faviconResolved || ogImage;

  // The S3 objects are served with a wrong content-type, which makes crawlers
  // refuse to render them. Route og:image through our same-origin proxy, which
  // re-serves the bytes with a correct image/* content-type.
  // Page-level OG image (stored as a full public URL) wins over the logo;
  // both go through the same-origin proxy for the content-type fix.
  const ogImageSource = pageSeo?.ogImage || ogImage;
  const ogImageProxied = ogImageSource
    ? `${url.origin}/branding-image?u=${encodeURIComponent(ogImageSource)}`
    : "";

  // Build OG meta tags
  const ogTags = [
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:type" content="${post ? "article" : "website"}" />`,
    `<meta property="og:url" content="${escapeHtml(request.url)}" />`,
    ogImageProxied ? `<meta property="og:image" content="${escapeHtml(ogImageProxied)}" />` : "",
    post && nonEmpty(post.published_at)
      ? `<meta property="article:published_time" content="${escapeHtml(post.published_at!)}" />`
      : "",
    // Twitter card — a post with a cover gets the large card.
    `<meta name="twitter:card" content="${post && ogImageProxied ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    ogImageProxied ? `<meta name="twitter:image" content="${escapeHtml(ogImageProxied)}" />` : "",
  ]
    .filter(Boolean)
    .join("\n    ");

  // Canonical: the request URL without query/hash (cache-busters and tracking
  // params must not fork the page into several indexed copies). On the day a
  // site moves to its own apex the canonical follows the host automatically.
  // A non-base site language keeps its ?lang=: the Hindi page is its own page,
  // not a duplicate of the English one.
  const canonical = seoLocale
    ? localizedPageUrl(url.origin, url.pathname, seoLocale.locale, seoLocale.baseLocale)
    : `${url.origin}${url.pathname.replace(/\/+$/, "") || "/"}`;
  const seoTags: string[] = [`<link rel="canonical" href="${escapeHtml(canonical)}" />`];
  if (seoLocale) {
    // Every language version of this page (each language with translations),
    // so search engines pair them; none while only the base has text.
    for (const alternate of hreflangAlternates(url.origin, url.pathname, seoLocale)) {
      seoTags.push(
        `<link rel="alternate" hreflang="${escapeHtml(alternate.hreflang)}" href="${escapeHtml(alternate.href)}" />`
      );
    }
  }
  if (resolved) {
    const siteSeo = resolved.catalogue.seo;
    const keywords = Array.isArray(siteSeo.keywords)
      ? siteSeo.keywords.map(nonEmpty).filter(Boolean).join(", ")
      : nonEmpty(siteSeo.keywords as string | undefined);
    if (keywords) seoTags.push(`<meta name="keywords" content="${escapeHtml(keywords)}" />`);
    if (nonEmpty(siteSeo.googleSiteVerification)) {
      seoTags.push(
        `<meta name="google-site-verification" content="${escapeHtml(siteSeo.googleSiteVerification!)}" />`
      );
    }
    const siteUrl = resolved.rootMounted ? `${url.origin}/` : `${url.origin}/${resolved.tag}`;
    const ld = buildStructuredData(
      url.origin,
      siteUrl,
      canonical,
      branding,
      resolved.catalogue,
      ogImageProxied,
      localize(pageSeo?.title || branding.instituteName || ""),
      localize(pageSeo?.description || "")
    );
    seoTags.push(`<script type="application/ld+json">${ld}</script>`);
    if (post) {
      seoTags.push(`<script type="application/ld+json">${buildBlogPostingData(canonical, siteUrl, post, ogImageProxied, localize(pageSeo?.description || ""))}</script>`);
    }
  }

  let html = await response.text();

  // Replace the static description with institute-specific one
  html = html.replace(
    /<meta name="description" content="Learning Platform" \/>/,
    `<meta name="description" content="${description}" />`
  );

  // Replace the static title (matches both empty and "Course Catalogue").
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);

  // Inject OG + SEO tags before </head>
  html = html.replace("</head>", `    ${ogTags}\n    ${seoTags.join("\n    ")}\n  </head>`);

  // Replace existing apple-touch-icon and favicon with the institute icon for crawlers
  if (favicon) {
    const escapedLogo = escapeHtml(favicon);
    // Replace apple-touch-icon href
    html = html.replace(
      /<link\s+rel="apple-touch-icon"[^>]*\/>/,
      `<link rel="apple-touch-icon" href="${escapedLogo}" />`
    );
    // Replace any existing shortcut icon / icon links
    html = html.replace(
      /<link\s+rel="(?:shortcut )?icon"[^>]*\/>/g,
      `<link rel="icon" href="${escapedLogo}" />`
    );
    // Also add a favicon link if none existed.
    //
    // This MUST test for a real <link> tag, not the bare substring `rel="icon"`.
    // index.html has no icon link at all (only apple-touch-icon), but its inline
    // branding script contains the selector string 'link[rel="icon"]' — so a
    // substring check matched the JS source and silently skipped the injection
    // on every white-labelled domain. Crawlers then found no icon link, fell
    // back to /favicon.ico, and Google listed those domains with the Vacademy
    // mark.
    if (!/<link[^>]+rel="(?:shortcut )?icon"/.test(html)) {
      html = html.replace(
        "</head>",
        `    <link rel="icon" href="${escapedLogo}" />\n  </head>`
      );
    }
  }

  // Strip the manifest link for crawlers — it references default Vacademy icons
  html = html.replace(/<link\s+rel="manifest"[^>]*\/?>/, "");

  // The document's language is the page's language (index.html says "en").
  if (seoLocale) {
    html = withHtmlLang(html, seoLocale.locale);
  }

  // Rebuild headers: the body length changed (and reading .text() may have
  // decompressed it), so a stale content-length/content-encoding would
  // truncate or corrupt the response. Let the runtime recompute them.
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
