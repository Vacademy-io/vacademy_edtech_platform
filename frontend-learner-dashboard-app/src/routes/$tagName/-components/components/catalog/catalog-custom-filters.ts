/**
 * Authored option groups of the Courses page (courseCatalog.customFilters):
 * FORMAT ("E-books", "Live sessions"…) and FOR ("Parents", "Students"…). Pure.
 *
 *   customFilters: [
 *     { id: "format", label: "Format", source: "courseFormats" },          // options = globalSettings.courseFormats
 *     { id: "for", label: "For", showCounts: false, visibleCount: 4,
 *       options: [{ id: "parents", label: "Parents", tags: ["for-parents"] }, …] },
 *     // options = every course tag starting with "for" ("for parents" → Parents),
 *     // after any authored ones; a new tag on a course is a new option.
 *     { id: "for", label: "For", source: "tags", prefix: "for", exclude: ["for everyone"] },
 *   ]
 *
 * An option matches a course when ANY version carries one of its tags or has
 * one of its level names (tags by tagKey, levels case-insensitive) — the same rule as the shared
 * course-format helper, so a 'courseFormats' option matches exactly the cards
 * whose cardFormatKeys include its key. Options inside a group are OR-ed,
 * groups are AND-ed with every other filter. The group id is its URL
 * parameter (?format=ebook,video&for=parents).
 *
 * No customFilters → [] everywhere: no facet group, no URL parameter read, no
 * state key — every other site is untouched.
 */

import { resolveCourseFormats, rowRawTags, rowTags, tagKey, type CourseFormatRow } from "../../../-utils/course-format";
import { toSlug } from "./catalog-config";

export interface ResolvedCustomOption {
  id: string;
  /** Display text. `labelFromSite` = base-language globalSettings text: show through siteT. */
  label: string;
  /** Match keys (tagKey). */
  tags: string[];
  /** Lower-case trimmed. */
  levels: string[];
}

export interface ResolvedCustomFilter {
  id: string;
  label: string;
  /** Options come from globalSettings.courseFormats: their labels need siteT at display. */
  labelFromSite: boolean;
  /** null = follow the section's showFilterCounts. */
  showCounts: boolean | null;
  showEmpty: boolean;
  /** Rows before show-more; null = all. */
  visibleCount: number | null;
  showAllLabel: string;
  options: ResolvedCustomOption[];
  /** source 'tags': options also come from the courses' tags (see withTagOptions). */
  fromTags: { prefix: string; exclude: string[] } | null;
}

/** Query parameters other catalogue features read — never a custom group id. */
export const RESERVED_FILTER_IDS = [
  "stream",
  "category",
  "language",
  "price",
  "sort",
  "q",
  "quick",
  "path",
  "badge",
  "lang",
  "page",
  "goal",
  "folder",
];

export const MAX_CUSTOM_FILTERS = 6;
export const MAX_CUSTOM_OPTIONS = 30;

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const lowerList = (v: unknown): string[] =>
  Array.isArray(v)
    ? [...new Set(v.map((x) => (typeof x === "string" ? x.trim().toLowerCase() : "")).filter(Boolean))]
    : [];
const keyList = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.map(tagKey).filter(Boolean))] : []);
const positiveInt = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
};

const authoredOptions = (raw: unknown): ResolvedCustomOption[] => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ResolvedCustomOption[] = [];
  for (const item of raw) {
    if (!isObject(item)) continue;
    const label = text(item.label);
    const id = toSlug(text(item.id) || label);
    const tags = keyList(item.tags);
    const levels = lowerList(item.levels);
    if (!id || !label || seen.has(id) || (!tags.length && !levels.length)) continue;
    seen.add(id);
    out.push({ id, label, tags, levels });
    if (out.length >= MAX_CUSTOM_OPTIONS) break;
  }
  return out;
};

const formatOptions = (globalSettings: unknown): ResolvedCustomOption[] => {
  const formats = resolveCourseFormats(isObject(globalSettings) ? globalSettings : null);
  return (formats?.list ?? [])
    .map((f) => ({ id: toSlug(f.key), label: f.label, tags: keyList(f.tags), levels: f.levels }))
    .filter((o) => !!o.id)
    .slice(0, MAX_CUSTOM_OPTIONS);
};

/**
 * The section's custom groups, validated (bad ids, duplicates and empty groups
 * dropped). A source 'tags' group with a prefix is kept with only its authored
 * options until withTagOptions adds the courses' tags.
 */
export const resolveCustomFilters = (raw: unknown, globalSettings: unknown): ResolvedCustomFilter[] => {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  const out: ResolvedCustomFilter[] = [];
  for (const item of raw) {
    if (!isObject(item) || item.enabled === false) continue;
    const id = toSlug(text(item.id));
    if (!id || ids.has(id) || RESERVED_FILTER_IDS.includes(id) || id.startsWith("utm")) continue;
    const fromFormats = item.source === "courseFormats";
    const prefix = item.source === "tags" ? tagKey(item.prefix) : "";
    const fromTags = prefix ? { prefix, exclude: keyList(item.exclude) } : null;
    const options = fromFormats ? formatOptions(globalSettings) : authoredOptions(item.options);
    if (!options.length && !fromTags) continue;
    ids.add(id);
    out.push({
      id,
      label: text(item.label),
      labelFromSite: fromFormats,
      showCounts: typeof item.showCounts === "boolean" ? item.showCounts : null,
      showEmpty: item.showEmpty !== false,
      visibleCount: positiveInt(item.visibleCount),
      showAllLabel: text(item.showAllLabel),
      options,
      fromTags,
    });
    if (out.length >= MAX_CUSTOM_FILTERS) break;
  }
  return out;
};

/** "for parents" minus the prefix key "for" → "parents" (separators between the words are free). */
const stripPrefix = (raw: string, prefix: string): string => {
  const words = prefix.split("-").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`^\\s*${words.join("[\\s\\-_/|'’]+")}[\\s\\-_/|:'’]+`, "i");
  return raw.replace(re, "").trim();
};

/**
 * Fills each source 'tags' group from the courses: every tag "<prefix> <rest>"
 * ("for parents", "for-teachers") is an option labelled <rest> ("Parents"),
 * after the authored options — a tag an authored option already lists, or one
 * in `exclude` (the whole tag or <rest>), is skipped. Most-used first. A group
 * left with no option is dropped; groups without a source 'tags' pass through.
 */
export const withTagOptions = (
  filters: ResolvedCustomFilter[],
  rows: CourseFormatRow[],
): ResolvedCustomFilter[] => {
  if (!filters.some((f) => f.fromTags)) return filters;
  const out: ResolvedCustomFilter[] = [];
  for (const f of filters) {
    if (!f.fromTags) {
      out.push(f);
      continue;
    }
    const { prefix, exclude } = f.fromTags;
    const authoredTags = new Set(f.options.flatMap((o) => o.tags));
    const authoredIds = new Set(f.options.map((o) => o.id));
    const found = new Map<string, { option: ResolvedCustomOption; count: number }>();
    for (const row of rows) {
      const seen = new Set<string>();
      for (const raw of rowRawTags(row)) {
        const key = tagKey(raw);
        if (!key.startsWith(`${prefix}-`) || authoredTags.has(key) || exclude.includes(key)) continue;
        const rest = stripPrefix(raw, prefix);
        if (!rest || exclude.includes(tagKey(rest))) continue;
        const id = toSlug(rest) || tagKey(rest);
        if (!id || authoredIds.has(id) || seen.has(id)) continue;
        seen.add(id);
        const hit = found.get(id);
        if (hit) {
          hit.count += 1;
          if (!hit.option.tags.includes(key)) hit.option.tags.push(key);
        } else {
          const label = rest.charAt(0).toUpperCase() + rest.slice(1);
          found.set(id, { option: { id, label, tags: [key], levels: [] }, count: 1 });
        }
      }
    }
    const auto = [...found.values()]
      .sort((a, b) => b.count - a.count || a.option.label.localeCompare(b.option.label))
      .map((v) => v.option);
    const options = [...f.options, ...auto].slice(0, MAX_CUSTOM_OPTIONS);
    if (options.length) out.push({ ...f, options });
  }
  return out;
};

const levelOf = (row: CourseFormatRow): string =>
  typeof (row.level_name ?? row.level) === "string" ? String(row.level_name ?? row.level).trim().toLowerCase() : "";

/** Does one version carry the option (a tag or a level name)? */
export const rowMatchesCustomOption = (row: CourseFormatRow, option: ResolvedCustomOption): boolean => {
  if (option.tags.length) {
    const keys = rowTags(row).map(tagKey);
    if (option.tags.some((t) => keys.includes(t))) return true;
  }
  if (option.levels.length) {
    const level = levelOf(row);
    if (level && option.levels.includes(level)) return true;
  }
  return false;
};

/** Card-level: any version matches. */
export const cardMatchesCustomOption = (card: { rows: CourseFormatRow[] }, option: ResolvedCustomOption): boolean =>
  card.rows.some((row) => rowMatchesCustomOption(row, option));

/** The selected options of each group, from the state's { groupId: optionIds } (unknown ids dropped). */
export const selectedCustomOptions = (
  filters: ResolvedCustomFilter[],
  state: Record<string, string[]> | undefined,
): { id: string; options: ResolvedCustomOption[] }[] =>
  filters
    .map((f) => ({
      id: f.id,
      options: f.options.filter((o) => (state?.[f.id] ?? []).includes(o.id)),
    }))
    .filter((g) => g.options.length > 0);

/** Allowed option ids per group — what a link may select (DiscoveryValidation.custom). */
export const customValidation = (filters: ResolvedCustomFilter[]): Record<string, string[]> =>
  Object.fromEntries(filters.map((f) => [f.id, f.options.map((o) => o.id)]));

/** A state patch that clears every custom group. */
export const clearedCustomState = (filters: ResolvedCustomFilter[]): Record<string, string[]> =>
  Object.fromEntries(filters.map((f) => [f.id, []]));

/** The facet-group id of a custom group (kept apart from the built-in ids). */
export const customGroupId = (id: string): string => `custom:${id}`;
