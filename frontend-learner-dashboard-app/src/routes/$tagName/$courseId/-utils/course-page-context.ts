/**
 * Where a course sits on its site, for the course page's header: the
 * breadcrumb (Courses › stream › category), the chips (its formats and
 * category) and the topic its "More in …" strip shows.
 *
 * Everything is read from what the site already authors — the Courses
 * section's stream library and globalSettings.courseFormats — matched against
 * the course's own tags and level, by the same rules the catalogue's cards and
 * filters use. A site that authors neither gets a plain "Courses" crumb (when
 * it has a Courses section) and no chips. Pure; labels are base-language
 * (translate with siteT at display).
 */
import type { CatalogStream } from "../../-components/components/catalog/catalog-streams";
import type { CatalogEditorialCardConfig } from "../../-types/catalog-cards-types";
import { LEVEL_KEY_PREFIX, levelKeys } from "../../-utils/level-key";
import {
  courseFormatKeys,
  resolveCourseFormats,
  tagKey,
  withTagFormats,
} from "../../-utils/course-format";

interface ComponentLike {
  type?: string;
  enabled?: boolean;
  props?: Record<string, unknown> | null;
}
interface PageLike {
  route?: string | null;
  title?: string | null;
  components?: ComponentLike[] | null;
}

export interface CatalogSectionRef {
  /** The page's route ("courses"). */
  route: string;
  /** The first crumb: the header menu's label for the page, else its title ("" = the site's word for courses). */
  title: string;
  props: Record<string, unknown>;
}

const HOME_ROUTES = new Set(["", "home", "homepage"]);
const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const normRoute = (r: unknown) => (typeof r === "string" ? r.trim().replace(/^\//, "").toLowerCase() : "");

/** The header menu's label for a route, at any depth (mega-menu columns too). */
const navLabelFor = (globalSettings: unknown, route: string): string => {
  const gs = isObject(globalSettings) ? globalSettings : null;
  const layout = gs && isObject(gs.layout) ? gs.layout : null;
  const header = layout && isObject(layout.header) ? layout.header : null;
  const nav = header && isObject(header.props) ? header.props.navigation : null;
  const target = normRoute(route);
  const visit = (node: unknown): string => {
    if (Array.isArray(node)) {
      for (const n of node) {
        const hit = visit(n);
        if (hit) return hit;
      }
      return "";
    }
    if (!isObject(node)) return "";
    if (normRoute(node.route) === target && typeof node.label === "string" && node.label.trim()) {
      return node.label.trim();
    }
    return Object.values(node).reduce<string>((hit, v) => hit || (typeof v === "object" ? visit(v) : ""), "");
  };
  return target ? visit(nav) : "";
};

/**
 * The site's Courses section: an enabled course catalogue, preferring one on a
 * page of its own over the home page's, and one with streams over one without.
 * Its crumb is what the header menu calls that page ("Courses"): the page
 * title is the SEO one ("Books & Kits — Acme Academy") or a duplicate's
 * "(Copy)" title, neither of which a visitor clicked on.
 */
export const findCatalogSection = (
  pages: PageLike[] | null | undefined,
  globalSettings?: unknown,
): CatalogSectionRef | null => {
  const found: Array<CatalogSectionRef & { score: number }> = [];
  (pages || []).forEach((page, order) => {
    for (const c of page.components || []) {
      if (c?.type !== "courseCatalog" || c.enabled === false) continue;
      const props = isObject(c.props) ? c.props : {};
      const route = (page.route || "").trim();
      const streamsOn = isObject(props.streams) && props.streams.enabled === true;
      // Lower wins: own page before home, streams before none, then page order.
      const score = (HOME_ROUTES.has(route.toLowerCase()) ? 2 : 0) + (streamsOn ? 0 : 1) + order / 1000;
      found.push({ route, title: (page.title || "").trim(), props, score });
      break;
    }
  });
  found.sort((a, b) => a.score - b.score);
  const best = found[0];
  if (!best) return null;
  return { route: best.route, title: navLabelFor(globalSettings, best.route) || best.title, props: best.props };
};

export interface Crumb {
  /** Base-language label ("" on the first crumb = the site's word for courses). */
  label: string;
  route: string;
  /** Query the catalogue reads (?stream=, ?category=). */
  search?: Record<string, string>;
}

export interface CoursePageContext {
  formatKeys: string[];
  /** Base-language format labels, in the site's format order. */
  formatLabels: string[];
  /** The stream, with its icon and colour for the header's eyebrow. */
  stream: { slug: string; label: string; imageUrl: string | null; accentColor: string | null } | null;
  category: { slug: string; label: string } | null;
  /** The trail above the course; empty when the site has no Courses section. */
  breadcrumb: Crumb[];
  /** "More in …": the tag the strip lists, and what it is called. */
  related: { tag: string; label: string } | null;
}

const lower = (s: unknown) => (typeof s === "string" ? s.trim().toLowerCase() : "");

const DEVANAGARI = /[\u0900-\u097F]/;
const DEVANAGARI_LOCALES = new Set(["hi", "mr", "ne", "sa", "kok", "mai", "bho"]);

/**
 * A stream or category as the visitor reads it, by the Courses section's
 * label mode: its title, its subtitle, or ("both", where the tabs show the
 * two) the title — unless the title is in Devanagari and the visitor is
 * reading another language, when its subtitle (the other-language name) is
 * the one they can read.
 */
export const placeLabel = (
  place: { title: string; subtitle?: string | null },
  labelMode: string | null | undefined,
  locale: string | null | undefined,
): string => {
  const title = (place.title || "").trim();
  const subtitle = (place.subtitle || "").trim();
  if (labelMode === "subtitle") return subtitle || title;
  if (labelMode === "both" && subtitle && DEVANAGARI.test(title)) {
    const lang = (locale || "").toLowerCase().split(/[-_]/)[0] || "";
    if (!DEVANAGARI_LOCALES.has(lang)) return subtitle;
  }
  return title || subtitle;
};

export const coursePageContext = (input: {
  tags: string[] | null | undefined;
  levelName?: string | null;
  globalSettings: unknown;
  streams: readonly CatalogStream[];
  catalog: CatalogSectionRef | null;
  /** The Courses section's stream label mode ("title" | "subtitle" | "both"). */
  labelMode?: string | null;
  /** The visitor's site language. */
  locale?: string | null;
}): CoursePageContext => {
  const tags = (input.tags || []).map(lower).filter((t) => t && !t.startsWith(LEVEL_KEY_PREFIX));
  // Level keys too: a course levelled like a stream or category belongs to it.
  const tagSet = new Set([...tags, ...levelKeys(input.levelName)]);
  // courseFormatsFromTags: an unclaimed tag of this course is a format too (stream tags never are).
  const streamTags = new Set(input.streams.flatMap((s) => s.tags.map(tagKey)));
  const gs = withTagFormats(isObject(input.globalSettings) ? input.globalSettings : null, [{ tags: input.tags ?? [] }], (key) =>
    streamTags.has(key),
  );

  const formats = resolveCourseFormats(gs);
  const formatKeys = courseFormatKeys({ tags, level_name: input.levelName ?? null }, formats);
  const formatLabels = formatKeys
    .map((key) => formats?.byKey.get(key)?.label || "")
    .filter(Boolean)
    .slice(0, 2);

  // The first stream (folder order) the course is tagged into, then its first
  // category — the same rule the catalogue's stream tabs and cards use.
  const stream = input.streams.find((s) => s.tags.some((t) => tagSet.has(t))) ?? null;
  const category = stream?.categories.find((c) => c.tags.some((t) => tagSet.has(t))) ?? null;
  const streamLabel = stream ? placeLabel(stream, input.labelMode, input.locale) : "";
  const categoryLabel = category ? placeLabel(category, input.labelMode, input.locale) : "";

  const breadcrumb: Crumb[] = [];
  if (input.catalog) {
    const route = input.catalog.route;
    breadcrumb.push({ label: input.catalog.title, route });
    if (stream) {
      breadcrumb.push({ label: streamLabel, route, search: { stream: stream.slug } });
      if (category) {
        breadcrumb.push({
          label: categoryLabel,
          route,
          search: { stream: stream.slug, category: category.slug },
        });
      }
    }
  }

  // "More in …" lists the stream (its own tag): a category is often a
  // handful of courses, or one book in two languages, which would leave the
  // strip empty. A stream without a tag of its own falls back to the
  // category (whose first tag is its own folder's).
  const relatedTag = stream?.tag || category?.tags[0] || "";
  const relatedLabel = stream?.tag ? streamLabel : categoryLabel || streamLabel;

  return {
    formatKeys,
    formatLabels,
    stream: stream
      ? { slug: stream.slug, label: streamLabel, imageUrl: stream.imageUrl ?? null, accentColor: stream.accentColor ?? null }
      : null,
    category: category ? { slug: category.slug, label: categoryLabel } : null,
    breadcrumb,
    related: relatedTag && relatedLabel ? { tag: relatedTag, label: relatedLabel } : null,
  };
};

/**
 * The crumbs the course page shows between Home and the course. A course in a
 * stream reads Home / stream / category: the Courses section's own crumb
 * (e.g. "Knowledge Streams") would only repeat the page the stream link opens.
 * A course in no stream keeps Home / Courses.
 */
export const coursePageTrail = (breadcrumb: readonly Crumb[]): Crumb[] =>
  breadcrumb.length > 1 ? breadcrumb.slice(1) : [...breadcrumb];

/** Formats read rather than watched: a "duration" there is a reading estimate, not worth a row. */
const READING_FORMATS = new Set(["ebook", "e-book", "book", "pdf", "article", "articles", "document", "notes"]);

/** Should the purchase card show the course's duration? Not for reading formats. */
export const showsDuration = (duration: string | null | undefined, formatKeys: string[]): boolean =>
  !!duration && !(formatKeys.length > 0 && formatKeys.every((k) => READING_FORMATS.has(k)));

/** Plain text of authored HTML (tags dropped, entities and spaces tidied). */
export const plainText = (html: string | null | undefined): string =>
  (html || "")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();

/** A one-glance summary for the header: the description's opening, cut at a word. */
export const summaryOf = (html: string | null | undefined, max = 220): string => {
  const text = plainText(html);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
};

/**
 * The "More in …" strip in the site's own card style: editorial cards (with
 * the section's card config and stream library) when the Courses section uses
 * them, else the strip's default cards.
 */
export const relatedCardStyle = (
  catalogProps: Record<string, unknown> | null | undefined,
  streams: { source: string; libraryId: string } | null | undefined,
): { cardStyle?: "editorial"; card?: CatalogEditorialCardConfig; streamsLibraryId?: string } => {
  const render = isObject(catalogProps?.render) ? catalogProps!.render : null;
  if (!render || render.cardStyle !== "editorial") return {};
  return {
    cardStyle: "editorial",
    ...(isObject(render.card) ? { card: render.card as CatalogEditorialCardConfig } : {}),
    ...(streams?.source === "folderLibrary" && streams.libraryId ? { streamsLibraryId: streams.libraryId } : {}),
  };
};

/**
 * The library the site's Learning Paths come from (its first learningPath
 * section with a folder library), or null — the course page's series.
 */
export const findPathLibraryId = (pages: PageLike[] | null | undefined): string | null => {
  for (const page of pages || []) {
    for (const c of page.components || []) {
      if (c?.type !== "learningPath" || c.enabled === false) continue;
      const id = isObject(c.props) && typeof c.props.libraryId === "string" ? c.props.libraryId.trim() : "";
      if (id) return id;
    }
  }
  return null;
};

/**
 * The site's app banner, which also closes the course page: its first CTA band
 * with a phone mockup ("Get the app"). globalSettings.courseDetails.appBanner
 * = false leaves it off.
 */
export const findAppBanner = (
  pages: PageLike[] | null | undefined,
  globalSettings?: unknown,
): { id?: string; type: string; enabled?: boolean; props: Record<string, unknown> } | null => {
  const gs = isObject(globalSettings) ? globalSettings : {};
  const cd = isObject(gs.courseDetails) ? gs.courseDetails : {};
  if (cd.appBanner === false) return null;
  for (const page of pages || []) {
    for (const c of page.components || []) {
      if (c?.type !== "ctaBanner" || c.enabled === false || !isObject(c.props)) continue;
      const mockup = c.props.mockup;
      if (isObject(mockup) && mockup.kind === "phone") {
        return c as { id?: string; type: string; enabled?: boolean; props: Record<string, unknown> };
      }
    }
  }
  return null;
};
