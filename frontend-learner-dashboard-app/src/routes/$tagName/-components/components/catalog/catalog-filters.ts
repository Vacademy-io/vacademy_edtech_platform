/**
 * Courses-page filtering and live facet counts. Pure.
 *
 * Filters are GROUPS: options inside a group are OR-ed (English or Hindi),
 * groups are AND-ed (Hindi and Free). A group's option count is the number
 * of cards that would show if that option were the group's only choice,
 * given every OTHER active group — so counts stay meaningful while the
 * visitor narrows the grid.
 *
 * Two kinds of group:
 *   - card groups (search, stream, category, badge) test the course;
 *   - row groups (language, price, level, session, tags, author, price range)
 *     test a VERSION, and a card matches when ONE of its versions passes every
 *     active row group — "Hindi and Paid" means a paid Hindi version, not a
 *     Hindi version plus some other paid one.
 * Without grouping a card has exactly one row, so every original filter
 * behaves exactly as it did before.
 */

import type { CourseBadge } from "../../../-utils/course-badges";
import type { CourseLanguageOption } from "../../../-utils/course-variants";
import { isComingSoonRow, rowLanguage, type CatalogCard, type CatalogRowLike } from "./catalog-cards";
import type { CatalogCategory, CatalogStream } from "./catalog-streams";
import type { PriceChoice } from "./catalog-url";
import { cardMatchesCustomOption, customGroupId, type ResolvedCustomOption } from "./catalog-custom-filters";

/* ── engine ─────────────────────────────────────────────────────────── */

export interface FacetGroup<T extends { rows: R[] }, R> {
  id: string;
  active: boolean;
  /** Card-level test. */
  matches?: (item: T) => boolean;
  /** Version-level test: all active row groups must hold on the SAME row. */
  rowMatches?: (row: R) => boolean;
}

export interface FacetOption<T, R> {
  value: string;
  matches?: (item: T) => boolean;
  rowMatches?: (row: R) => boolean;
}

const partition = <T extends { rows: R[] }, R>(groups: FacetGroup<T, R>[], exceptId?: string) => {
  const active = groups.filter((g) => g.active && g.id !== exceptId);
  return {
    cardTests: active.filter((g) => g.matches).map((g) => g.matches!),
    rowTests: active.filter((g) => g.rowMatches).map((g) => g.rowMatches!),
  };
};

const passes = <T extends { rows: R[] }, R>(
  item: T,
  cardTests: ((item: T) => boolean)[],
  rowTests: ((row: R) => boolean)[],
  extraRowTest?: (row: R) => boolean,
): boolean => {
  for (const test of cardTests) if (!test(item)) return false;
  if (!rowTests.length && !extraRowTest) return true;
  return item.rows.some((row) => rowTests.every((test) => test(row)) && (!extraRowTest || extraRowTest(row)));
};

/** Items passing every active group (except `exceptId`, for counting that group's options). */
export const applyFacetGroups = <T extends { rows: R[] }, R>(
  items: T[],
  groups: FacetGroup<T, R>[],
  exceptId?: string,
): T[] => {
  const { cardTests, rowTests } = partition(groups, exceptId);
  if (!cardTests.length && !rowTests.length) return items;
  return items.filter((item) => passes(item, cardTests, rowTests));
};

/** The versions of an item that pass every active row group — all of them when none is active. */
export const rowsMatchingGroups = <T extends { rows: R[] }, R>(item: T, groups: FacetGroup<T, R>[]): R[] => {
  const { rowTests } = partition(groups);
  if (!rowTests.length) return item.rows;
  return item.rows.filter((row) => rowTests.every((test) => test(row)));
};

/** Per option: how many items pass every OTHER active group and match the option. */
export const countFacetOptions = <T extends { rows: R[] }, R>(
  items: T[],
  groups: FacetGroup<T, R>[],
  groupId: string,
  options: FacetOption<T, R>[],
): Record<string, number> => {
  const { cardTests, rowTests } = partition(groups, groupId);
  const out: Record<string, number> = {};
  for (const option of options) {
    const optionCardTests = option.matches ? [...cardTests, option.matches] : cardTests;
    let n = 0;
    for (const item of items) if (passes(item, optionCardTests, rowTests, option.rowMatches)) n++;
    out[option.value] = n;
  }
  return out;
};

/* ── row tests ──────────────────────────────────────────────────────── */

type AnyRow = CatalogRowLike & Record<string, unknown>;

/**
 * The original Level filter, verbatim: exact level match, plus the Buy/Rent
 * book-store convention where "Buy"/"Rent" may live in level_name, the type
 * or any field of the row.
 */
export const rowMatchesLevels = (row: AnyRow, selected: string[]): boolean => {
  if (!selected.length) return true;
  const matchesLevel = selected.includes(row.level);
  const isBuyRentFilter = selected.some(
    (level) => level?.toLowerCase() === "buy" || level?.toLowerCase() === "rent",
  );
  if (isBuyRentFilter) {
    const levelName = String(row.level_name || row.level || "").trim();
    const courseType = String(row.type || row.package_type || "").trim();
    const matchesBuyRent = selected.some((level) => {
      const filterValue = level.toString().trim();
      return (
        levelName.toLowerCase() === filterValue.toLowerCase() ||
        courseType.toLowerCase() === filterValue.toLowerCase() ||
        Object.values(row).some(
          (val) => !!val && String(val).toLowerCase() === filterValue.toLowerCase(),
        )
      );
    });
    if (matchesBuyRent) return true;
  }
  return matchesLevel;
};

/** The original Tags filter: exact, case-sensitive tag match. */
export const rowMatchesExactTags = (row: AnyRow, selected: string[]): boolean => {
  const courseTags =
    typeof row.comma_separeted_tags === "string"
      ? row.comma_separeted_tags.split(",").map((t) => t.trim())
      : [];
  return selected.some((tag) => courseTags.includes(tag));
};

const rowPrice = (row: CatalogRowLike) => (typeof row.price === "number" ? row.price : Number(row.price) || 0);

/** Price choice (Free / Paid / Under X). Coming-soon rows have no price yet and never match. */
export const rowMatchesPrice = (row: CatalogRowLike, choice: PriceChoice): boolean => {
  if (isComingSoonRow(row)) return false;
  const price = rowPrice(row);
  if (choice.kind === "free") return price === 0;
  if (choice.kind === "paid") return price > 0;
  return price <= choice.max;
};

/** The original min/max price range filter. */
export const rowInPriceRange = (row: CatalogRowLike, range: { min?: number; max?: number }): boolean => {
  const price = rowPrice(row);
  const meetsMin = range.min !== undefined ? price >= range.min : true;
  const meetsMax = range.max !== undefined ? price <= range.max : true;
  return meetsMin && meetsMax;
};

/** Search over base AND translated title/description (the original matched the base only). */
export const rowMatchesSearch = (
  row: CatalogRowLike,
  term: string,
  translate: (s: string) => string,
): boolean => {
  const needle = term.toLowerCase();
  const title = row.title || "";
  const description = row.description || "";
  if (title.toLowerCase().includes(needle) || description.toLowerCase().includes(needle)) return true;
  const tTitle = translate(title);
  const tDescription = translate(description);
  return (
    (tTitle !== title && tTitle.toLowerCase().includes(needle)) ||
    (tDescription !== description && tDescription.toLowerCase().includes(needle))
  );
};

export const cardHasAnyTag = (card: { tagSet: Set<string> }, tags: string[]): boolean =>
  tags.some((t) => card.tagSet.has(t));

const rowInLanguages = (row: CatalogRowLike, codes: string[], languages: CourseLanguageOption[]) => {
  const lang = rowLanguage(row, languages);
  return !!lang && codes.includes(lang.code);
};

/* ── criteria -> groups ─────────────────────────────────────────────── */

export interface CatalogCriteria {
  search: string;
  stream: CatalogStream | null;
  categories: CatalogCategory[];
  languages: string[];
  price: PriceChoice | null;
  badges: CourseBadge[];
  levels: string[];
  sessions: string[];
  tags: string[];
  instructors: string[];
  /** Only applied while the section shows its price-range filter. */
  priceRange: { min?: number; max?: number } | null;
  priceRangeOn: boolean;
  /** Selected options of the authored groups (customFilters), groups with a selection only. */
  custom?: { id: string; options: ResolvedCustomOption[] }[];
}

export const EMPTY_CRITERIA: CatalogCriteria = {
  search: "",
  stream: null,
  categories: [],
  languages: [],
  price: null,
  badges: [],
  levels: [],
  sessions: [],
  tags: [],
  instructors: [],
  priceRange: null,
  priceRangeOn: false,
};

export interface CriteriaContext {
  languages: CourseLanguageOption[];
  /** Every badge a course has earned (uncapped), by course id. */
  earnedBadges: Map<string, CourseBadge[]>;
  translate: (s: string) => string;
}

export const GROUP_IDS = {
  search: "search",
  stream: "stream",
  category: "category",
  language: "language",
  price: "price",
  badge: "badge",
  level: "level",
  session: "session",
  tags: "tags",
  instructor: "instructor",
  priceRange: "priceRange",
} as const;

const rawFacetGroups = <R extends CatalogRowLike>(
  c: CatalogCriteria,
  ctx: CriteriaContext,
): FacetGroup<CatalogCard<R>, R>[] => {
  const range = c.priceRange;
  const rangeActive = c.priceRangeOn && !!range && (range.min !== undefined || range.max !== undefined);
  const price = c.price;
  const stream = c.stream;
  return [
    {
      id: GROUP_IDS.search,
      active: !!c.search,
      matches: (card) => card.rows.some((r) => rowMatchesSearch(r, c.search, ctx.translate)),
    },
    {
      id: GROUP_IDS.stream,
      active: !!stream,
      matches: (card) => !!stream && cardHasAnyTag(card, stream.tags),
    },
    {
      id: GROUP_IDS.category,
      active: c.categories.length > 0,
      matches: (card) => c.categories.some((cat) => cardHasAnyTag(card, cat.tags)),
    },
    {
      id: GROUP_IDS.badge,
      active: c.badges.length > 0,
      matches: (card) => (ctx.earnedBadges.get(card.courseId) || []).some((b) => c.badges.includes(b)),
    },
    {
      id: GROUP_IDS.language,
      active: c.languages.length > 0,
      rowMatches: (r) => rowInLanguages(r, c.languages, ctx.languages),
    },
    {
      id: GROUP_IDS.price,
      active: !!price,
      rowMatches: (r) => !!price && rowMatchesPrice(r, price),
    },
    {
      id: GROUP_IDS.level,
      active: c.levels.length > 0,
      rowMatches: (r) => rowMatchesLevels(r as AnyRow, c.levels),
    },
    {
      id: GROUP_IDS.session,
      active: c.sessions.length > 0,
      rowMatches: (r) => !!r.sessionId && c.sessions.includes(r.sessionId),
    },
    {
      id: GROUP_IDS.tags,
      active: c.tags.length > 0,
      rowMatches: (r) => rowMatchesExactTags(r as AnyRow, c.tags),
    },
    {
      id: GROUP_IDS.instructor,
      active: c.instructors.length > 0,
      rowMatches: (r) => c.instructors.includes(r.instructor),
    },
    {
      id: GROUP_IDS.priceRange,
      active: rangeActive,
      rowMatches: (r) => !!range && rowInPriceRange(r, range),
    },
    // Authored groups (FORMAT, FOR…): card-level, OR inside the group.
    ...(c.custom ?? []).map((g) => ({
      id: customGroupId(g.id),
      active: g.options.length > 0,
      matches: (card: CatalogCard<R>) => g.options.some((o) => cardMatchesCustomOption(card, o)),
    })),
  ];
};

/** A test that remembers its answer per card / row object. */
const remember = <K extends object>(test: (k: K) => boolean): ((k: K) => boolean) => {
  const known = new WeakMap<K, boolean>();
  return (k) => {
    const hit = known.get(k);
    if (hit !== undefined) return hit;
    const answer = test(k);
    known.set(k, answer);
    return answer;
  };
};

/**
 * The filter groups for one set of criteria. Each group's test remembers its
 * answer per card / row: the groups are rebuilt whenever the criteria change,
 * so an answer never goes stale, and counting the options of one group no
 * longer re-runs every OTHER group's test (search above all) once per option.
 */
export const buildFacetGroups = <R extends CatalogRowLike>(
  c: CatalogCriteria,
  ctx: CriteriaContext,
): FacetGroup<CatalogCard<R>, R>[] =>
  rawFacetGroups<R>(c, ctx).map((group) => ({
    ...group,
    ...(group.matches ? { matches: remember(group.matches) } : {}),
    ...(group.rowMatches ? { rowMatches: remember(group.rowMatches) } : {}),
  }));

/* ── option lists for counting ──────────────────────────────────────── */

type CardOption<R extends CatalogRowLike> = FacetOption<CatalogCard<R>, R>;

export const categoryOptions = <R extends CatalogRowLike>(categories: CatalogCategory[]): CardOption<R>[] =>
  categories.map((cat) => ({ value: cat.slug, matches: (card) => cardHasAnyTag(card, cat.tags) }));

export const languageOptions = <R extends CatalogRowLike>(
  codes: string[],
  languages: CourseLanguageOption[],
): CardOption<R>[] =>
  codes.map((code) => ({ value: code, rowMatches: (r) => rowLanguage(r, languages)?.code === code }));

export const priceOptions = <R extends CatalogRowLike>(
  choices: { value: string; choice: PriceChoice }[],
): CardOption<R>[] =>
  choices.map(({ value, choice }) => ({ value, rowMatches: (r) => rowMatchesPrice(r, choice) }));

export const levelOptions = <R extends CatalogRowLike>(levels: string[]): CardOption<R>[] =>
  levels.map((level) => ({ value: level, rowMatches: (r) => rowMatchesLevels(r as AnyRow, [level]) }));

export const sessionOptions = <R extends CatalogRowLike>(sessionIds: string[]): CardOption<R>[] =>
  sessionIds.map((id) => ({ value: id, rowMatches: (r) => r.sessionId === id }));

export const tagOptions = <R extends CatalogRowLike>(tags: string[]): CardOption<R>[] =>
  tags.map((tag) => ({ value: tag, rowMatches: (r) => rowMatchesExactTags(r as AnyRow, [tag]) }));

/** The options of one authored group, for countFacetOptions(…, customGroupId(id), …). */
export const customOptions = <R extends CatalogRowLike>(options: ResolvedCustomOption[]): CardOption<R>[] =>
  options.map((o) => ({ value: o.id, matches: (card) => cardMatchesCustomOption(card, o) }));

export const instructorOptions = <R extends CatalogRowLike>(names: string[]): CardOption<R>[] =>
  names.map((name) => ({ value: name, rowMatches: (r) => r.instructor === name }));

/** Language codes some row of the catalogue is actually in, in the site's order. */
export const presentLanguageCodes = (rows: CatalogRowLike[], languages: CourseLanguageOption[]): string[] => {
  const present = new Set<string>();
  for (const r of rows) {
    const lang = rowLanguage(r, languages);
    if (lang) present.add(lang.code);
  }
  return languages.filter((l) => present.has(l.code)).map((l) => l.code);
};

/* ── applied-filter chips ───────────────────────────────────────────── */

export type ChipGroup =
  | "category"
  | "language"
  | "price"
  | "badge"
  | "level"
  | "session"
  | "tags"
  | "instructor"
  | "priceRange"
  | "search"
  | "custom";

export interface AppliedChip {
  key: string;
  group: ChipGroup;
  value: string;
  label: string;
}

export interface ChipLabels {
  category: (slug: string) => string;
  language: (code: string) => string;
  price: (choice: PriceChoice) => string;
  badge: (badge: CourseBadge) => string;
  level: (level: string) => string;
  session: (id: string) => string;
  instructor: (name: string) => string;
  priceRange: (range: { min?: number; max?: number }) => string;
  search: (term: string) => string;
  /** Authored group options; default = the option's own label. */
  custom?: (groupId: string, option: ResolvedCustomOption) => string;
}

/** One removable chip per applied filter value, in sidebar order. */
export const buildAppliedChips = (c: CatalogCriteria, labels: ChipLabels): AppliedChip[] => {
  const chips: AppliedChip[] = [];
  const push = (group: ChipGroup, value: string, label: string) =>
    chips.push({ key: `${group}:${value}`, group, value, label });
  c.categories.forEach((cat) => push("category", cat.slug, labels.category(cat.slug)));
  c.languages.forEach((code) => push("language", code, labels.language(code)));
  if (c.price) push("price", c.price.kind === "max" ? `max:${c.price.max}` : c.price.kind, labels.price(c.price));
  c.badges.forEach((b) => push("badge", b, labels.badge(b)));
  (c.custom ?? []).forEach((g) =>
    g.options.forEach((o) => push("custom", `${g.id}:${o.id}`, labels.custom ? labels.custom(g.id, o) : o.label)),
  );
  c.levels.forEach((l) => push("level", l, labels.level(l)));
  c.sessions.forEach((s) => push("session", s, labels.session(s)));
  c.tags.forEach((t) => push("tags", t, t));
  c.instructors.forEach((i) => push("instructor", i, labels.instructor(i)));
  if (c.priceRangeOn && c.priceRange && (c.priceRange.min !== undefined || c.priceRange.max !== undefined)) {
    push("priceRange", "range", labels.priceRange(c.priceRange));
  }
  if (c.search.trim()) push("search", c.search, labels.search(c.search.trim()));
  return chips;
};
