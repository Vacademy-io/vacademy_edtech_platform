/**
 * Site search in the header — what can be found and in which order. Pure, so
 * the ranking is unit-tested (header-search.test.ts); the dialog
 * (HeaderSearch.tsx) only fetches, renders and navigates.
 *
 * Sources: the institute's courses (open v2 search), the site's own pages
 * (catalogue JSON) and the streams/categories of the header mega menu.
 */

import { languageOfLevel, type CourseLanguageOption } from "../../-utils/course-variants";
import type { HeaderLink } from "./header-links";
import type { MegaMenuModel } from "./mega-menu-model";

export type SiteSearchKind = "stream" | "category" | "course" | "page";

export interface SiteSearchItem {
  id: string;
  kind: SiteSearchKind;
  /** Display text (already translated by the caller). */
  title: string;
  /** Second line: a course's level, a category's stream… */
  subtitle?: string;
  /** Extra text a query may match: untranslated names, tags, routes. */
  keywords: string[];
  /** Where selecting it goes; null = not selectable (coming soon without a form, or no usable link). */
  link: HeaderLink | null;
  /** Coming-soon entries open their "notify me" form instead of a link. */
  notifyAudienceId?: string;
  /** A stream or category that is not open yet (shows the "coming soon" tag). */
  comingSoon?: boolean;
}

export interface RankedSearchItem extends SiteSearchItem {
  score: number;
}

/** Lowercase, accents folded, whitespace collapsed — Devanagari is left as is. */
export const normalizeSearchText = (value: string | null | undefined): string =>
  (value || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const WORD_SPLIT = /[\s\-_/·,.:;()|]+/;

/** 0–100: how well `text` answers `query` (both already normalized). */
const fieldScore = (field: string, query: string, tokens: string[]): number => {
  if (!field) return 0;
  if (field === query) return 100;
  if (field.startsWith(query)) return 85;
  const words = field.split(WORD_SPLIT).filter(Boolean);
  if (words.some((w) => w.startsWith(query))) return 70;
  if (field.includes(query)) return 50;
  if (tokens.length > 1) {
    if (tokens.every((tok) => words.some((w) => w.startsWith(tok)))) return 45;
    if (tokens.every((tok) => field.includes(tok))) return 30;
  }
  return 0;
};

const KIND_ORDER: Record<SiteSearchKind, number> = { stream: 0, category: 1, course: 2, page: 3 };

/**
 * Items that match `query`, best first. Title matches outrank subtitle and
 * keyword matches; ties keep streams before categories before courses before
 * pages, then the original order. An empty query matches nothing.
 */
export const rankSiteSearch = (query: string, items: SiteSearchItem[]): RankedSearchItem[] => {
  const q = normalizeSearchText(query);
  if (!q) return [];
  const tokens = q.split(" ").filter(Boolean);
  const ranked: Array<{ hit: RankedSearchItem; index: number }> = [];
  items.forEach((item, index) => {
    const title = fieldScore(normalizeSearchText(item.title), q, tokens);
    const subtitle = fieldScore(normalizeSearchText(item.subtitle), q, tokens) * 0.5;
    const keywords = Math.max(0, ...item.keywords.map((k) => fieldScore(normalizeSearchText(k), q, tokens))) * 0.8;
    const score = Math.max(title, subtitle, keywords);
    if (score > 0) ranked.push({ hit: { ...item, score }, index });
  });
  ranked.sort(
    (a, b) =>
      b.hit.score - a.hit.score || KIND_ORDER[a.hit.kind] - KIND_ORDER[b.hit.kind] || a.index - b.index,
  );
  return ranked.map(({ hit }) => hit);
};

export interface SearchGroup {
  kind: "streams" | "courses" | "pages";
  items: RankedSearchItem[];
}

const groupOf = (kind: SiteSearchKind): SearchGroup["kind"] =>
  kind === "course" ? "courses" : kind === "page" ? "pages" : "streams";

/**
 * Ranked results split into display groups (streams+categories, courses,
 * pages), each capped at `limit`. Groups are ordered by their best match so
 * the strongest hit is always on top; the flattened order is what arrow keys
 * walk through.
 */
export const groupSearchResults = (ranked: RankedSearchItem[], limit = 6): SearchGroup[] => {
  const groups = new Map<SearchGroup["kind"], RankedSearchItem[]>();
  for (const item of ranked) {
    const key = groupOf(item.kind);
    const list = groups.get(key) || [];
    if (list.length < limit) list.push(item);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([kind, items]) => ({ kind, items }));
};

/* ── sources ─────────────────────────────────────────────────────────── */

interface PageLike {
  id?: string;
  route?: string;
  title?: string;
  published?: boolean;
}

/**
 * The site's pages. Unpublished pages are left out; a page without a title is
 * listed by its route, the home page as `homeLabel`. Links are SITE paths
 * ("/about"); the caller maps them onto the host (toAppHref).
 */
export const pageSearchItems = (
  pages: PageLike[] | null | undefined,
  opts: { homeLabel: string; translate?: (s: string) => string },
): SiteSearchItem[] => {
  const translate = opts.translate || ((s: string) => s);
  const seen = new Set<string>();
  const out: SiteSearchItem[] = [];
  for (const page of Array.isArray(pages) ? pages : []) {
    if (!page || page.published === false) continue;
    const route = (page.route || "").trim().replace(/^\/+|\/+$/g, "");
    const isHome = route === "" || route.toLowerCase() === "home" || route.toLowerCase() === "homepage";
    const key = isHome ? "" : route.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const rawTitle = (page.title || "").trim();
    const title = rawTitle ? translate(rawTitle) : isHome ? opts.homeLabel : route;
    out.push({
      id: `page:${page.id || key || "home"}`,
      kind: "page",
      title,
      keywords: [rawTitle, route.replace(/[-_/]+/g, " ")].filter(Boolean),
      link: { href: isHome ? "/" : `/${route}`, external: false },
    });
  }
  return out;
};

/** Streams and their categories from the mega menu model. */
export const streamSearchItems = (
  model: MegaMenuModel | null | undefined,
  translate: (s: string) => string = (s) => s,
): SiteSearchItem[] => {
  const out: SiteSearchItem[] = [];
  for (const stream of model?.streams || []) {
    const streamTitle = translate(stream.title);
    out.push({
      id: `stream:${stream.id}`,
      kind: "stream",
      title: streamTitle,
      subtitle: stream.subtitle ? translate(stream.subtitle) : undefined,
      keywords: [stream.title, stream.subtitle, stream.slug].filter(Boolean),
      link: stream.action.kind === "link" ? stream.action.link : null,
      notifyAudienceId: stream.action.kind === "notify" ? stream.action.audienceId : undefined,
      comingSoon: stream.comingSoon,
    });
    for (const cat of stream.categories) {
      const catTitle = translate(cat.title);
      out.push({
        id: `category:${cat.id}`,
        kind: "category",
        title: cat.subtitle ? `${catTitle} · ${translate(cat.subtitle)}` : catTitle,
        subtitle: streamTitle,
        keywords: [cat.title, cat.subtitle, cat.slug].filter(Boolean),
        link: cat.action.kind === "link" ? cat.action.link : null,
        notifyAudienceId: cat.action.kind === "notify" ? cat.action.audienceId : undefined,
        comingSoon: cat.comingSoon,
      });
    }
  }
  return out;
};

/** One row of the open v2 course search (only the fields the header reads). */
export interface CourseSearchRow {
  id?: string;
  package_id?: string;
  packageId?: string;
  package_name?: string;
  package_session_id?: string;
  enroll_invite_id?: string;
  level_name?: string;
  comma_separeted_tags?: string;
  course_preview_image_media_id?: string;
  course_banner_media_id?: string;
  thumbnail_file_id?: string;
}

/**
 * The course page link a catalogue card opens, as a SITE path: the course's
 * own page route when the site gives it one, else its id, with the version
 * the card would pass (invite, package session, level, banner).
 */
export const courseSitePath = (row: CourseSearchRow, pageRoute: string | null): string | null => {
  const id = courseIdOf(row);
  if (!id) return null;
  const params = new URLSearchParams();
  if (row.enroll_invite_id) params.set("enrollInviteId", row.enroll_invite_id);
  if (row.package_session_id) params.set("packageSessionId", row.package_session_id);
  const banner = row.course_preview_image_media_id || row.course_banner_media_id || row.thumbnail_file_id;
  if (banner) params.set("bannerImage", banner);
  if (row.level_name) params.set("level", row.level_name);
  const qs = params.toString();
  return `/${(pageRoute || id).replace(/^\/+/, "")}${qs ? `?${qs}` : ""}`;
};

export const courseIdOf = (row: CourseSearchRow): string =>
  (row.id || row.package_id || row.packageId || "").trim();

/**
 * The version of a course a result opens — the one a merged catalogue card
 * opens: the visitor's course language (read from the level name, e.g.
 * "Hindi") when the course has it, else its first row. The search sorts rows
 * newest first, so "first" alone would often be the newest version.
 */
export const pickCourseVersion = <T extends Pick<CourseSearchRow, "level_name">>(
  versions: T[],
  preferredLanguage: string | null | undefined,
  languages: CourseLanguageOption[] | null | undefined,
): T | undefined => {
  if (preferredLanguage && languages?.length) {
    const hit = versions.find((v) => languageOfLevel(v.level_name, languages)?.code === preferredLanguage);
    if (hit) return hit;
  }
  return versions[0];
};

/**
 * Courses, one entry per course: the search returns one row per course
 * version (level / language). The entry links to pickCourseVersion's
 * version; every version's tags and level names stay searchable. `hrefFor`
 * builds the link (course page route, invite and version params) — the
 * caller owns the routing rules.
 */
export const courseSearchItems = (
  rows: CourseSearchRow[] | null | undefined,
  opts: {
    translate?: (s: string) => string;
    hrefFor: (row: CourseSearchRow) => string | null;
    /** Course language to open (preferredCourseLanguage of the site locale). */
    preferredLanguage?: string | null;
    /** The site's course languages (courseLanguagesOf). */
    languages?: CourseLanguageOption[];
  },
): SiteSearchItem[] => {
  const translate = opts.translate || ((s: string) => s);
  // Versions per course, courses in the order their first row came.
  const byCourse = new Map<string, CourseSearchRow[]>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = row ? courseIdOf(row) : "";
    if (!id || !(row.package_name || "").trim()) continue;
    const versions = byCourse.get(id);
    if (versions) versions.push(row);
    else byCourse.set(id, [row]);
  }
  const out: SiteSearchItem[] = [];
  for (const [id, versions] of byCourse) {
    const row = pickCourseVersion(versions, opts.preferredLanguage, opts.languages) ?? versions[0];
    const name = (row.package_name || "").trim();
    const href = opts.hrefFor(row);
    const keywords = new Set<string>([name]);
    for (const v of versions) {
      for (const tag of (v.comma_separeted_tags || "").split(",")) if (tag.trim()) keywords.add(tag.trim());
      if (v.level_name) keywords.add(v.level_name);
    }
    out.push({
      id: `course:${id}`,
      kind: "course",
      title: translate(name),
      subtitle: row.level_name && row.level_name.toUpperCase() !== "DEFAULT" ? translate(row.level_name) : undefined,
      keywords: [...keywords],
      link: href ? { href, external: false } : null,
    });
  }
  return out;
};
