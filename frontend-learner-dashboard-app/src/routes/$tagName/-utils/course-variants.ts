/**
 * Course language versions.
 *
 * A course's language versions are its LEVELS — "Hindi" and "English", and
 * later "Beginner Hindi" / "Beginner English". The public catalogue API returns
 * one row per level (package_session), so without grouping every version is its
 * own card. These helpers fold a course's rows into ONE card that knows its
 * languages (the EN / हिं chips) and which version to show first.
 *
 * The language is read from the level NAME with the site's matching rules
 * (globalSettings.courseLanguages), so an admin never tags levels separately.
 * Grouping is opt-in: with no settings every row stays its own card, exactly
 * as before.
 */

export interface CourseLanguageOption {
  /** Stable code, also used in ?language= (e.g. "hi"). */
  code: string;
  /** Filter label: "Hindi". */
  label: string;
  /** Card chip: "हिं". Falls back to the label. */
  chip?: string;
  /** Words that identify this language inside a level name (case-insensitive). */
  match?: string[];
}

export interface CourseLanguageSettings {
  /** Fold a course's language levels into one card, with language chips and filter. */
  enabled?: boolean;
  languages?: CourseLanguageOption[];
  /**
   * Opt-in: courses that are the SAME course in different languages but were
   * set up as separate packages (["<EN package id>", "<HI package id>"]). With
   * grouping on, each list folds into one card like a course's language levels
   * do. Absent = one card per package, exactly as before.
   */
  versionGroups?: string[][];
}

export const DEFAULT_COURSE_LANGUAGES: CourseLanguageOption[] = [
  { code: "en", label: "English", chip: "EN", match: ["english", "eng"] },
  { code: "hi", label: "Hindi", chip: "हिं", match: ["hindi", "हिन्दी", "हिंदी"] },
];

export const courseLanguagesOf = (settings: CourseLanguageSettings | undefined | null): CourseLanguageOption[] =>
  settings?.languages?.length ? settings.languages : DEFAULT_COURSE_LANGUAGES;

const isAscii = (s: string) => /^[\x00-\x7F]*$/.test(s);

/**
 * The language a level name stands for: "Hindi", "Beginner Hindi" and
 * "hindi - batch 2" are all Hindi. ASCII words must match as whole words (so
 * "eng" does not match "engineering"); non-Latin tokens match anywhere.
 */
export const languageOfLevel = (
  levelName: string | null | undefined,
  languages: CourseLanguageOption[],
): CourseLanguageOption | null => {
  const name = (levelName || "").toLowerCase();
  if (!name.trim()) return null;
  for (const lang of languages) {
    const tokens = [...(lang.match || []), lang.label, lang.code].filter(Boolean).map((t) => t.toLowerCase().trim());
    for (const token of tokens) {
      if (!token) continue;
      if (isAscii(token)) {
        const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(name)) return lang;
      } else if (name.includes(token)) {
        return lang;
      }
    }
  }
  return null;
};

/** The minimum a catalogue row must carry to be grouped. */
export interface VariantRow {
  package_id?: string | null;
  package_session_id?: string | null;
  level_name?: string | null;
  /** Course tags; a tag that IS a language names the row's language when its level does not. */
  comma_separeted_tags?: string | null;
}

/**
 * The language a course's tags name: a tag that is EXACTLY a language's label,
 * code or match word ("Hindi", "हिन्दी", "en"), never a word inside a longer tag
 * ("English literature" is not English).
 */
export const languageOfTags = (
  tags: string | null | undefined,
  languages: CourseLanguageOption[],
): CourseLanguageOption | null => {
  if (typeof tags !== "string" || !tags.trim()) return null;
  const list = tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return null;
  for (const lang of languages) {
    const tokens = [...(lang.match || []), lang.label, lang.code]
      .filter((t): t is string => typeof t === "string" && !!t.trim())
      .map((t) => t.toLowerCase().trim());
    if (list.some((t) => tokens.includes(t))) return lang;
  }
  return null;
};

/**
 * The language a row is in: its level name ("Beginner Hindi") — or, for
 * institutes whose levels are formats (eBook, Short Film) and whose language
 * versions are separate courses, a course tag that is exactly a language.
 */
export const languageOfRow = (
  row: { level_name?: string | null; level?: string | null; comma_separeted_tags?: string | null },
  languages: CourseLanguageOption[],
): CourseLanguageOption | null =>
  languageOfLevel(row.level_name ?? row.level, languages) ?? languageOfTags(row.comma_separeted_tags, languages);

export interface CourseGroup<T extends VariantRow> {
  /** package_id — one card per course. */
  courseId: string;
  /** Every row (level) of the course, in catalogue order. */
  variants: T[];
  /** The version the card shows first: the visitor's preferred language, else the first row. */
  primary: T;
  /** Distinct languages offered, in the site's configured order. */
  languages: CourseLanguageOption[];
}

/**
 * Package id -> "vg:<n>" for the authored version groups (a list of 2+ ids is
 * one course). An id listed twice keeps its first group. Null when none.
 */
export const versionGroupIndex = (groups: string[][] | null | undefined): Map<string, string> | null => {
  if (!Array.isArray(groups) || !groups.length) return null;
  const out = new Map<string, string>();
  groups.forEach((group, i) => {
    if (!Array.isArray(group)) return;
    for (const id of group) {
      const key = typeof id === "string" ? id.trim() : "";
      if (key && !out.has(key)) out.set(key, `vg:${i}`);
    }
  });
  return out.size ? out : null;
};

/**
 * Folds rows into one group per course, keeping the catalogue's order (a
 * course sits where its first row sat). With grouping disabled every row is a
 * group of one — the pre-existing one-card-per-level behaviour.
 */
export const groupCourseVariants = <T extends VariantRow>(
  rows: T[],
  opts: {
    enabled: boolean;
    languages: CourseLanguageOption[];
    preferredLanguage?: string | null;
    /** Packages that are one course (CourseLanguageSettings.versionGroups); only read when enabled. */
    versionGroups?: string[][] | null;
  },
): CourseGroup<T>[] => {
  const groups: CourseGroup<T>[] = [];
  const byCourse = new Map<string, CourseGroup<T>>();
  const groupOf = opts.enabled ? versionGroupIndex(opts.versionGroups) : null;
  for (const row of rows) {
    const courseId = String(row.package_id || row.package_session_id || "");
    const key =
      opts.enabled && row.package_id
        ? groupOf?.get(String(row.package_id)) ?? String(row.package_id)
        : `${courseId}::${row.package_session_id ?? groups.length}`;
    let group = byCourse.get(key);
    if (!group) {
      group = { courseId, variants: [], primary: row, languages: [] };
      byCourse.set(key, group);
      groups.push(group);
    }
    group.variants.push(row);
  }
  for (const group of groups) {
    const present = new Set<string>();
    for (const v of group.variants) {
      const lang = languageOfRow(v, opts.languages);
      if (lang) present.add(lang.code);
    }
    group.languages = opts.languages.filter((l) => present.has(l.code));
    if (opts.preferredLanguage) {
      const preferred = group.variants.find(
        (v) => languageOfRow(v, opts.languages)?.code === opts.preferredLanguage,
      );
      if (preferred) group.primary = preferred;
    }
  }
  return groups;
};

/** The course's row for a language, if it has one. */
export const variantForLanguage = <T extends VariantRow>(
  group: CourseGroup<T>,
  languageCode: string,
  languages: CourseLanguageOption[],
): T | undefined => group.variants.find((v) => languageOfRow(v, languages)?.code === languageCode);

/** Does a row belong to any of the selected languages? An empty selection matches everything. */
export const rowMatchesLanguages = (
  row: VariantRow,
  selected: string[],
  languages: CourseLanguageOption[],
): boolean => {
  if (!selected.length) return true;
  const lang = languageOfRow(row, languages);
  return !!lang && selected.includes(lang.code);
};

/**
 * Site-locale → course-language default: a visitor reading the site in Hindi
 * sees the Hindi version of a course first. Codes line up by convention
 * ('hi' ↔ 'hi'); anything else has no preference.
 */
export const preferredCourseLanguage = (
  siteLocale: string | null | undefined,
  languages: CourseLanguageOption[],
): string | null => {
  const code = (siteLocale || "").toLowerCase();
  return languages.some((l) => l.code === code) ? code : null;
};
