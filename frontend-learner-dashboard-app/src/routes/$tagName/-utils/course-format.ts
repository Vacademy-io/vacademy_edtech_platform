import { useMemo } from "react";
import { courseLanguagesOf, type CourseLanguageSettings } from "./course-variants";

/**
 * A course's FORMAT ("E-books", "Live sessions", "Short film / Animation"…),
 * authored once per site in globalSettings and shared by every surface that
 * shows or filters by it (course cards, the sidebar FORMAT filter, learning
 * path steps). Pure helpers + one memo hook; no other state.
 *
 *   globalSettings.courseFormats = {
 *     ebook:     { label: "E-books",       levels: ["eBook"], tags: ["e-book"] },
 *     elearning: { label: "Interactive, self-paced E-learning" },
 *     …
 *   }
 *   globalSettings.courseFormatOrder = ["elearning", "ebook", …]   // optional
 *
 * A course row's formats, in precedence order:
 *   1. a course tag `format-<key>` (case-insensitive) naming an authored key;
 *   2. a course tag listed in a format's `tags`;
 *   3. the row's level name listed in a format's `levels` (trimmed, case-insensitive).
 * A course may have several (an e-learning course with live sessions):
 * `courseFormatKeys` lists them all, `courseFormatOf` gives the first.
 * Tags compare by `tagKey`: case, spaces, hyphens, underscores, slashes and
 * apostrophes do not matter ("Article - Essay" = "article-essay").
 *
 * Formats that follow the courses' tags (opt-in):
 *   globalSettings.courseFormatsFromTags = { enabled: true, skipPrefixes: ["for"], skip: ["bestseller"] }
 * Every course tag no authored format, language, stream or skip rule claims
 * becomes a format of its own (label = the tag as written) — `withTagFormats`.
 * A new tag on a course is then a FORMAT option and a card pill with no site edit.
 *
 * Labels are authored BASE-language text: show them through siteT() (the site
 * dictionary). globalSettings is not run through localizeComponentProps, and
 * `levels`/`tags` must stay raw so they keep matching in every language.
 * No settings → every helper returns null / [] and nothing changes anywhere.
 */

export interface CourseFormatDefinition {
  label: string;
  /** Level names (as courses carry them) that mean this format. */
  levels?: string[];
  /** Course tags that mean this format (besides `format-<key>`). */
  tags?: string[];
}

/** globalSettings.courseFormats */
export type CourseFormatsSetting = Record<string, CourseFormatDefinition>;

export interface ResolvedCourseFormat {
  /** Lower-case key ("ebook"). */
  key: string;
  /** Authored base-language label — translate with siteT at display. */
  label: string;
  /** Lower-case trimmed level names. */
  levels: string[];
  /** Lower-case trimmed tags (always includes `format-<key>`). */
  tags: string[];
}

export interface ResolvedCourseFormats {
  /** In display order: courseFormatOrder first, then authoring order. */
  list: ResolvedCourseFormat[];
  byKey: Map<string, ResolvedCourseFormat>;
}

/** The part of a course row the helpers read (catalog Course, search v2 row, product-page mapping). */
export interface CourseFormatRow {
  comma_separeted_tags?: string | null;
  /** Comma string (product-page mappings) or array. */
  tags?: unknown;
  level_name?: string | null;
  level?: string | null;
}

export const FORMAT_TAG_PREFIX = "format-";
const MAX_FORMATS = 30;

const norm = (s: unknown): string => (typeof s === "string" ? s.trim().toLowerCase() : "");

/**
 * A tag's match key: lower-case, apostrophes dropped, runs of spaces, hyphens,
 * underscores, slashes and pipes folded to one "-". "for parents" = "for-parents",
 * "Short film / Animation" = "short-film-animation". Non-Latin text is kept.
 */
export const tagKey = (s: unknown): string =>
  typeof s === "string"
    ? s
        .trim()
        .toLowerCase()
        .replace(/['’]/g, "")
        .replace(/[\s\-_/|]+/g, "-")
        .replace(/^-+|-+$/g, "")
    : "";
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strList = (raw: unknown): string[] =>
  Array.isArray(raw) ? [...new Set(raw.map(norm).filter(Boolean))] : [];

/** Validated formats from globalSettings, or null when the site authors none. */
export const resolveCourseFormats = (
  globalSettings: { courseFormats?: unknown; courseFormatOrder?: unknown } | null | undefined,
): ResolvedCourseFormats | null => {
  const raw = globalSettings?.courseFormats;
  if (!isObject(raw)) return null;
  const all: ResolvedCourseFormat[] = [];
  const seen = new Set<string>();
  for (const [rawKey, def] of Object.entries(raw)) {
    const key = norm(rawKey);
    if (!key || seen.has(key) || !isObject(def)) continue;
    const label = typeof def.label === "string" ? def.label.trim() : "";
    if (!label) continue;
    seen.add(key);
    const tags = strList(def.tags);
    const own = `${FORMAT_TAG_PREFIX}${key}`;
    all.push({ key, label, levels: strList(def.levels), tags: tags.includes(own) ? tags : [own, ...tags] });
    if (all.length >= MAX_FORMATS) break;
  }
  if (!all.length) return null;
  const order = strList(globalSettings?.courseFormatOrder);
  const rank = (key: string) => {
    const i = order.indexOf(key);
    return i === -1 ? order.length : i;
  };
  const list = all
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(a.f.key) - rank(b.f.key) || a.i - b.i)
    .map(({ f }) => f);
  return { list, byKey: new Map(list.map((f) => [f.key, f])) };
};

/** A row's course tags as written, trimmed (comma_separeted_tags + tags as a comma string or an array). */
export const rowRawTags = (row: CourseFormatRow): string[] => {
  const out: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === "string") v.split(",").forEach((t) => t.trim() && out.push(t.trim()));
    else if (Array.isArray(v)) v.forEach(add);
  };
  add(row.comma_separeted_tags);
  add(row.tags);
  return out;
};

/** A row's course tags, lower-case (comma_separeted_tags + tags as a comma string or an array). */
export const rowTags = (row: CourseFormatRow): string[] => rowRawTags(row).map(norm);

/** A row's level name, lower-case: level_name when present, else level. */
const rowLevel = (row: CourseFormatRow): string => norm(row.level_name ?? row.level);

/** Each format's tags as match keys, worked out once per resolved list. */
const formatTagKeys = new WeakMap<ResolvedCourseFormats, string[][]>();
const tagKeysOf = (formats: ResolvedCourseFormats): string[][] => {
  let keys = formatTagKeys.get(formats);
  if (!keys) {
    keys = formats.list.map((f) => f.tags.map(tagKey));
    formatTagKeys.set(formats, keys);
  }
  return keys;
};

/** Every format key the row has, in precedence order (see the module note). */
export const courseFormatKeys = (row: CourseFormatRow, formats: ResolvedCourseFormats | null): string[] => {
  if (!formats) return [];
  const out: string[] = [];
  const push = (key: string) => {
    if (formats.byKey.has(key) && !out.includes(key)) out.push(key);
  };
  const tags = rowTags(row);
  const keys = tags.map(tagKey);
  // format-<key>: the exact key as before ("format-audio_book"), or its folded spelling ("format audio book").
  for (const tag of tags) {
    if (tag.startsWith(FORMAT_TAG_PREFIX)) push(tag.slice(FORMAT_TAG_PREFIX.length));
    const k = tagKey(tag);
    if (k.startsWith(FORMAT_TAG_PREFIX)) {
      const want = k.slice(FORMAT_TAG_PREFIX.length);
      for (const f of formats.list) if (tagKey(f.key) === want) push(f.key);
    }
  }
  const formatKeys = tagKeysOf(formats);
  formats.list.forEach((f, i) => {
    if (formatKeys[i]!.some((t) => keys.includes(t))) push(f.key);
  });
  const level = rowLevel(row);
  if (level) for (const f of formats.list) if (f.levels.includes(level)) push(f.key);
  return out;
};

/** The row's first format, or null. */
export const courseFormatOf = (
  row: CourseFormatRow,
  formats: ResolvedCourseFormats | null,
): ResolvedCourseFormat | null => {
  const key = courseFormatKeys(row, formats)[0];
  return key ? formats!.byKey.get(key) ?? null : null;
};

/** Format keys of any of the rows (a language-grouped card), first-seen order. */
export const cardFormatKeys = (rows: CourseFormatRow[], formats: ResolvedCourseFormats | null): string[] => {
  const out: string[] = [];
  for (const row of rows) for (const key of courseFormatKeys(row, formats)) if (!out.includes(key)) out.push(key);
  return out;
};

/** How many of `items` have each format (an item counts once per format it has). Zero-count formats are listed. */
export const countByFormat = <T>(
  items: T[],
  rowsOf: (item: T) => CourseFormatRow[],
  formats: ResolvedCourseFormats | null,
): Map<string, number> => {
  const counts = new Map<string, number>((formats?.list ?? []).map((f) => [f.key, 0]));
  if (!formats) return counts;
  for (const item of items) for (const key of cardFormatKeys(rowsOf(item), formats)) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
};

/** globalSettings.courseFormatsFromTags */
export interface CourseFormatsFromTagsSetting {
  enabled?: boolean;
  /** Tags starting with one of these words are never formats ("for" skips "for parents"). */
  skipPrefixes?: string[];
  /** Tags that are never formats. */
  skip?: string[];
}

/** Match keys of the site's language tags ("hindi", "english", their codes and match words). */
const languageTagKeys = (globalSettings: Record<string, unknown>): Set<string> => {
  const raw = isObject(globalSettings.courseLanguages) ? (globalSettings.courseLanguages as CourseLanguageSettings) : null;
  const out = new Set<string>();
  for (const l of courseLanguagesOf(raw)) for (const w of [l.code, l.label, ...(l.match ?? [])]) if (tagKey(w)) out.add(tagKey(w));
  return out;
};

/**
 * globalSettings with a format added for every course tag nothing else
 * claims, when courseFormatsFromTags.enabled — the same object otherwise.
 * Claimed: a tag an authored format matches, a language tag, a skip /
 * skipPrefixes tag, and whatever `isClaimed` says (stream and filter tags the
 * caller knows). Key = the tag's match key; label = the tag as first written,
 * first letter upper-cased. Authored formats keep their place; new ones follow.
 */
export const withTagFormats = <T extends Record<string, unknown> | null | undefined>(
  globalSettings: T,
  rows: CourseFormatRow[],
  isClaimed: (key: string) => boolean = () => false,
): T => {
  if (!isObject(globalSettings)) return globalSettings;
  const setting = globalSettings.courseFormatsFromTags;
  if (!isObject(setting) || setting.enabled !== true) return globalSettings;
  const keyList = (raw: unknown) => (Array.isArray(raw) ? raw.map(tagKey).filter(Boolean) : []);
  const skip = new Set(keyList(setting.skip));
  const skipPrefixes = keyList(setting.skipPrefixes);
  const languages = languageTagKeys(globalSettings);
  const formats = resolveCourseFormats(globalSettings);
  const authored = isObject(globalSettings.courseFormats) ? globalSettings.courseFormats : {};
  const taken = new Set(Object.keys(authored).map(norm));
  const added: CourseFormatsSetting = {};
  for (const row of rows) {
    for (const raw of rowRawTags(row)) {
      const key = tagKey(raw);
      if (!key || taken.has(key) || skip.has(key) || languages.has(key)) continue;
      if (key.startsWith(FORMAT_TAG_PREFIX) || skipPrefixes.some((p) => key === p || key.startsWith(`${p}-`))) continue;
      if (isClaimed(key) || courseFormatKeys({ tags: [raw] }, formats).length) continue;
      taken.add(key);
      added[key] = { label: raw.charAt(0).toUpperCase() + raw.slice(1), tags: [raw] };
    }
  }
  if (!Object.keys(added).length) return globalSettings;
  return { ...globalSettings, courseFormats: { ...authored, ...added } };
};

/**
 * The site's course formats, read from the globalSettings a component already
 * receives (CourseCatalogComponent, LearningPathComponent and CourseShowcase
 * all get `globalSettings` from JsonRenderer). Memoised on the two settings.
 */
export const useCourseFormats = (
  globalSettings: { courseFormats?: unknown; courseFormatOrder?: unknown } | null | undefined,
) => {
  const raw = globalSettings?.courseFormats;
  const order = globalSettings?.courseFormatOrder;
  return useMemo(() => {
    const formats = resolveCourseFormats({ courseFormats: raw, courseFormatOrder: order });
    return {
      /** null when the site authors no formats. */
      formats,
      keysOf: (row: CourseFormatRow) => courseFormatKeys(row, formats),
      formatOf: (row: CourseFormatRow) => courseFormatOf(row, formats),
      cardKeysOf: (rows: CourseFormatRow[]) => cardFormatKeys(rows, formats),
    };
  }, [raw, order]);
};
