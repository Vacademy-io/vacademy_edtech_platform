/**
 * Reads the Courses-page discovery props (streams, filters, badges, quick
 * filters…) of a courseCatalog / productCourseGrid section into one validated
 * config. Pure.
 *
 * The props come from hand-written or AI-written catalogue JSON, so nothing is
 * trusted: wrong types, unknown enum values and malformed list entries are
 * dropped rather than crashing the grid. A section that carries none of these
 * props resolves to `active: false` and the catalogue renders exactly as it
 * always has.
 */

import { ALL_BADGES, type BadgeRules, type CourseBadge } from "../../../-utils/course-badges";
import {
  DEFAULT_COURSE_LANGUAGES,
  courseLanguagesOf,
  type CourseLanguageOption,
  type CourseLanguageSettings,
} from "../../../-utils/course-variants";
import { resolveCategoryFilterExtension, type ResolvedCategoryFilterExtension } from "./catalog-sidebar-config";
import { resolveCustomFilters, type ResolvedCustomFilter } from "./catalog-custom-filters";
import type {
  CatalogQuickFilterKind,
  CatalogStreamItem,
} from "../../../-types/course-catalogue-types";

export type StreamSource = "folderLibrary" | "tags";
export type StreamLabelMode = "title" | "subtitle" | "both";

export interface ResolvedStreams {
  source: StreamSource;
  libraryId: string;
  items: CatalogStreamItem[];
  /** '' = the translated "All courses" default. */
  allLabel: string;
  sticky: boolean;
  labelMode: StreamLabelMode;
}

export interface ResolvedQuickFilter {
  id: string;
  /** '' = the translated default for the kind. */
  label: string;
  kind: CatalogQuickFilterKind;
  /** Lower-case language code ('language') or a positive amount ('priceMax'). */
  value?: string | number;
}

export interface ResolvedBadgeRules extends BadgeRules {
  enabled: true;
  types: CourseBadge[];
}

export interface CatalogDiscoveryConfig {
  /** Any discovery feature is switched on. False = the original grid, untouched. */
  active: boolean;
  streams: ResolvedStreams | null;
  syncUrl: boolean;
  showFilterCounts: boolean;
  showAppliedChips: boolean;
  mobileFilterSheet: boolean;
  /** globalSettings.courseLanguages.enabled — language chips, filter and grouping need it. */
  courseLanguagesOn: boolean;
  /** Site course languages, codes lower-cased. */
  languages: CourseLanguageOption[];
  languageFilter: { enabled: boolean; label: string };
  priceFilter: { enabled: boolean; label: string; showFree: boolean; maxOptions: number[]; control?: "checkbox" };
  categoryFilter: { enabled: boolean; label: string } & ResolvedCategoryFilterExtension;
  /** Authored option groups (FORMAT, FOR…); [] when the section sets none. Feature 'sidebar'. */
  customFilters: ResolvedCustomFilter[];
  grouping: boolean;
  badges: ResolvedBadgeRules | null;
  quickFilters: ResolvedQuickFilter[];
  /** globalSettings.courseLanguages.versionGroups (2+ package ids each); only set when the site authors some (feature 'cards'). */
  versionGroups?: string[][];
}

export const QUICK_FILTER_KINDS: CatalogQuickFilterKind[] = [
  "popular",
  "new",
  "free",
  "bestseller",
  "language",
  "priceMax",
];

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const positiveNumber = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

const positiveInt = (v: unknown): number | undefined => {
  const n = positiveNumber(v);
  return n === null ? undefined : Math.floor(n);
};

/** A URL key: lower-case letters, digits and dashes, at most 120 characters. */
export const toSlug = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");

/** Site course languages with codes normalised (lower-case, unique, non-empty). */
export const normaliseLanguages = (
  settings: CourseLanguageSettings | undefined | null,
): CourseLanguageOption[] => {
  const seen = new Set<string>();
  const out: CourseLanguageOption[] = [];
  for (const lang of courseLanguagesOf(settings)) {
    if (!isObject(lang)) continue;
    const code = text(lang.code).toLowerCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push({ ...lang, code });
  }
  return out.length ? out : DEFAULT_COURSE_LANGUAGES;
};

const resolveStreamItems = (raw: unknown): CatalogStreamItem[] => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CatalogStreamItem[] = [];
  for (const item of raw) {
    if (!isObject(item)) continue;
    const label = text(item.label);
    const tag = text(item.tag);
    const slug = toSlug(text(item.slug) || tag || label);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const imageUrl = text(item.imageUrl);
    out.push({ label: label || tag || slug, slug, tag: tag || slug, ...(imageUrl ? { imageUrl } : {}) });
  }
  return out;
};

const resolveStreams = (raw: unknown): ResolvedStreams | null => {
  if (!isObject(raw) || raw.enabled !== true) return null;
  const source: StreamSource = raw.source === "tags" ? "tags" : "folderLibrary";
  const labelMode: StreamLabelMode =
    raw.labelMode === "subtitle" || raw.labelMode === "both" ? raw.labelMode : "title";
  return {
    source,
    libraryId: text(raw.libraryId),
    items: source === "tags" ? resolveStreamItems(raw.items) : [],
    allLabel: text(raw.allLabel),
    sticky: raw.sticky !== false,
    labelMode,
  };
};

/**
 * Badge rules. `types` absent = all four. A types LIST is the admin's choice
 * of which badges may show, so one with nothing valid left in it (e.g. every
 * box unticked) means no badges — badges off, and no popularity fetch.
 */
const resolveBadges = (raw: unknown): ResolvedBadgeRules | null => {
  if (!isObject(raw) || raw.enabled !== true) return null;
  const types = Array.isArray(raw.types)
    ? (raw.types.filter((t, i, all) => ALL_BADGES.includes(t as CourseBadge) && all.indexOf(t) === i) as CourseBadge[])
    : [...ALL_BADGES];
  if (!types.length) return null;
  return {
    enabled: true,
    types,
    newDays: positiveInt(raw.newDays),
    bestsellerTop: positiveInt(raw.bestsellerTop),
    max: positiveInt(raw.max),
  };
};

const resolveAmounts = (raw: unknown): number[] => {
  if (!Array.isArray(raw)) return [];
  const nums = raw.map(positiveNumber).filter((n): n is number => n !== null);
  return [...new Set(nums)].sort((a, b) => a - b).slice(0, 8);
};

const resolveQuickFilters = (
  raw: unknown,
  ctx: { courseLanguagesOn: boolean; languages: CourseLanguageOption[] },
): ResolvedQuickFilter[] => {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  const out: ResolvedQuickFilter[] = [];
  raw.forEach((item, index) => {
    if (!isObject(item)) return;
    const kind = item.kind as CatalogQuickFilterKind;
    if (!QUICK_FILTER_KINDS.includes(kind)) return;
    let value: string | number | undefined;
    if (kind === "language") {
      const code = text(item.value).toLowerCase();
      if (!ctx.courseLanguagesOn || !ctx.languages.some((l) => l.code === code)) return;
      value = code;
    } else if (kind === "priceMax") {
      const amount = positiveNumber(item.value);
      if (amount === null) return;
      value = amount;
    }
    let id = text(item.id) || `${kind}-${index}`;
    while (ids.has(id)) id = `${id}-${index}`;
    ids.add(id);
    out.push({ id, label: text(item.label), kind, ...(value !== undefined ? { value } : {}) });
  });
  return out;
};

const enabledWithLabel = (raw: unknown): { enabled: boolean; label: string } => ({
  enabled: isObject(raw) && raw.enabled === true,
  label: isObject(raw) ? text(raw.label) : "",
});

/** The discovery props of one catalogue section, validated. */
export const resolveCatalogDiscovery = (
  props: Record<string, unknown> | null | undefined,
  globalSettings: unknown,
): CatalogDiscoveryConfig => {
  const p = isObject(props) ? props : {};
  const gs = isObject(globalSettings) ? globalSettings : {};
  const languageSettings = isObject(gs.courseLanguages)
    ? (gs.courseLanguages as CourseLanguageSettings)
    : undefined;
  const courseLanguagesOn = languageSettings?.enabled === true;
  const languages = normaliseLanguages(languageSettings);

  const streams = resolveStreams(p.streams);
  const languageFilterRaw = enabledWithLabel(p.languageFilter);
  const categoryFilter = enabledWithLabel(p.categoryFilter);
  const priceRaw = isObject(p.priceFilter) ? p.priceFilter : {};
  const priceFilter = {
    enabled: priceRaw.enabled === true,
    label: text(priceRaw.label),
    showFree: priceRaw.showFree !== false,
    maxOptions: resolveAmounts(priceRaw.maxOptions),
  };
  const badges = resolveBadges(p.badges);
  const quickFilters = resolveQuickFilters(p.quickFilters, { courseLanguagesOn, languages });
  // Feature 'sidebar': opt-in price control, category extensions and custom groups (absent → no keys).
  const priceControl = priceRaw.control === "checkbox" ? { control: "checkbox" as const } : {};
  const categoryExtension = resolveCategoryFilterExtension(p.categoryFilter);
  const customFilters = resolveCustomFilters(p.customFilters, gs);
  const groupingRequested = p.groupLanguageVersions === true;
  const showFilterCounts = p.showFilterCounts === true;
  const showAppliedChips = p.showAppliedChips === true;
  const mobileFilterSheet = p.mobileFilterSheet === true;
  const syncUrl = typeof p.syncUrl === "boolean" ? p.syncUrl : !!streams;

  const versionGroups = resolveVersionGroups(languageSettings?.versionGroups);
  const active =
    !!streams ||
    p.syncUrl === true ||
    showFilterCounts ||
    showAppliedChips ||
    mobileFilterSheet ||
    quickFilters.length > 0 ||
    languageFilterRaw.enabled ||
    priceFilter.enabled ||
    categoryFilter.enabled ||
    customFilters.length > 0 ||
    groupingRequested ||
    !!badges;

  return {
    active,
    streams,
    syncUrl,
    showFilterCounts,
    showAppliedChips,
    mobileFilterSheet,
    courseLanguagesOn,
    languages,
    languageFilter: {
      enabled: languageFilterRaw.enabled && courseLanguagesOn,
      label: languageFilterRaw.label,
    },
    priceFilter: { ...priceFilter, ...priceControl },
    categoryFilter: {
      enabled: categoryFilter.enabled && streams?.source === "folderLibrary",
      label: categoryFilter.label,
      ...categoryExtension,
    },
    customFilters,
    grouping: groupingRequested && courseLanguagesOn,
    badges,
    quickFilters,
    ...(versionGroups.length ? { versionGroups } : {}),
  };
};

/** Authored version groups: lists of 2+ distinct non-empty package ids (at most 500 lists). */
export const resolveVersionGroups = (raw: unknown): string[][] => {
  if (!Array.isArray(raw)) return [];
  const out: string[][] = [];
  for (const group of raw.slice(0, 500)) {
    if (!Array.isArray(group)) continue;
    const ids = [...new Set(group.map(text).filter(Boolean))];
    if (ids.length >= 2) out.push(ids);
  }
  return out;
};

/** Do these badge types need enrolment ranks from the popularity endpoint? */
export const badgesNeedRanks = (types: readonly CourseBadge[]): boolean =>
  types.includes("bestseller") || types.includes("popular");
