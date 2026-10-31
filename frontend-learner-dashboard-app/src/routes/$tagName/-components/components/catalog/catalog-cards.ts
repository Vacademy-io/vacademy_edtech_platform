/**
 * Catalogue rows -> cards. Pure.
 *
 * The open catalogue search returns one row per package session (one level of
 * one course). Without grouping every row is its own card — the original
 * grid. With grouping (groupLanguageVersions) a course's language versions
 * fold into ONE card that knows its languages (EN / हिं chips), its lowest
 * price ("from ₹X" when versions differ) and which version it opens.
 */

import { resolveInviteAvailability } from "@/lib/invite-availability";
import {
  groupCourseVariants,
  languageOfLevel,
  languageOfRow,
  type CourseLanguageOption,
} from "../../../-utils/course-variants";
import { readComingSoon } from "../../../-utils/coming-soon";
import { LEVEL_KEY_PREFIX, levelKeys } from "../../../-utils/level-key";

/** The fields of a catalogue row the discovery logic reads. */
export interface CatalogRowLike {
  /** package id */
  id: string;
  title: string;
  description: string;
  price: number;
  elevatedPrice?: number;
  currency?: string;
  level: string;
  rating: number;
  instructor: string;
  createdAt?: string;
  sessionId?: string;
  packageSessionId?: string;
  enrollInviteId?: string;
  package_id?: string | null;
  package_session_id?: string | null;
  level_name?: string | null;
  comma_separeted_tags?: string | null;
  coming_soon?: unknown;
  enroll_invite_availability?: string | null;
}

export interface CatalogCard<R extends CatalogRowLike> {
  /** package id */
  courseId: string;
  /** The card's versions (one row when grouping is off). */
  rows: R[];
  /** The version the card shows and links to. */
  primary: R;
  /** Languages offered (grouping only; [] otherwise). */
  languages: CourseLanguageOption[];
  /** Lower-case course tags of every version. */
  tagSet: Set<string>;
  /**
   * Price used by the price sorts: the lowest price that can be paid now,
   * else the lowest version price (a single-row card: its own price).
   */
  sortPrice: number;
  /** Lowest / highest price among the versions that can be bought now. */
  minPrice: number | null;
  maxPrice: number | null;
  /** The versions differ in price ("from ₹X"). */
  priceVaries: boolean;
  /**
   * Every package id of the card, first-seen order — set ONLY when the card
   * folds several packages (globalSettings.courseLanguages.versionGroups), so
   * every other card keeps exactly its previous shape.
   */
  courseIds?: string[];
}

export interface PriceSummary {
  minPrice: number | null;
  maxPrice: number | null;
  priceVaries: boolean;
}

const toNumber = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);

/** A row's course tags, trimmed (comma_separeted_tags is the v2 search field). */
export const courseTagsOf = (row: { comma_separeted_tags?: string | null; tags?: unknown }): string[] => {
  const out: string[] = [];
  if (typeof row.comma_separeted_tags === "string") {
    for (const t of row.comma_separeted_tags.split(",")) if (t.trim()) out.push(t.trim());
  }
  if (Array.isArray(row.tags)) {
    for (const t of row.tags) if (typeof t === "string" && t.trim()) out.push(t.trim());
  }
  return out;
};

/** Coming-soon rows have no real price yet. */
export const isComingSoonRow = (row: { coming_soon?: unknown }): boolean => readComingSoon(row.coming_soon) !== null;

/** A version that can be bought right now: not coming soon, and its enrolment window is open. */
export const isBuyableNowRow = (row: Pick<CatalogRowLike, "coming_soon" | "enroll_invite_availability">): boolean =>
  !isComingSoonRow(row) && resolveInviteAvailability(row.enroll_invite_availability) === "AVAILABLE";

/**
 * A level that is ONLY a language ("Hindi", "English", "हिन्दी") — with
 * grouping on, the language chips already say it, so it is noise as a Level
 * filter option or card label. "Beginner Hindi" is a real level and stays.
 */
export const isPureLanguageLevel = (
  levelName: string | null | undefined,
  languages: CourseLanguageOption[],
): boolean => {
  const lang = languageOfLevel(levelName, languages);
  if (!lang) return false;
  const name = (levelName || "").toLowerCase().replace(/[\s\-_.,:;()/|]+/g, " ").trim();
  const tokens = [...(lang.match || []), lang.label, lang.code]
    .filter((t): t is string => typeof t === "string" && !!t.trim())
    .map((t) => t.toLowerCase().trim());
  return tokens.includes(name);
};

/** Lowest / highest price among the versions that can be bought now (coming soon, closed and not-yet-open ones are left out). */
export const priceSummaryOf = (rows: CatalogRowLike[]): PriceSummary => {
  const prices = rows.filter(isBuyableNowRow).map((r) => toNumber(r.price));
  if (!prices.length) return { minPrice: null, maxPrice: null, priceVaries: false };
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  return { minPrice, maxPrice, priceVaries: minPrice !== maxPrice };
};

export interface CardPriceView<R> {
  /** The version whose price (and MRP) is shown — the card's own version when it is one of them. */
  row: R;
  /** The lowest price on offer. */
  minPrice: number;
  /** The versions on offer differ in price: show "from {minPrice}". */
  from: boolean;
}

/**
 * What a merged card's price area shows: the versions that match the active
 * filters (`rows`) AND can be bought now — so a "Paid" filter never shows a
 * free version's "Free", and a closed version never sets the "from" price.
 * Null when none of them can be bought now (the card then shows its own
 * version's status, as a single-version card does).
 */
export const cardPriceView = <R extends CatalogRowLike>(
  card: Pick<CatalogCard<R>, "primary">,
  rows: R[],
): CardPriceView<R> | null => {
  const buyable = rows.filter(isBuyableNowRow);
  if (!buyable.length) return null;
  const prices = buyable.map((r) => toNumber(r.price));
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const cheapest = (r: R) => toNumber(r.price) === minPrice;
  const row = buyable.find((r) => r === card.primary && cheapest(r)) ?? buyable.find(cheapest) ?? buyable[0];
  return { row, minPrice, from: minPrice !== maxPrice };
};

/** What a stream or category matches a course by: its tags, and its level as a level key. */
export const courseMatchKeysOf = (row: {
  comma_separeted_tags?: string | null;
  tags?: unknown;
  level_name?: string | null;
  level?: unknown;
}): string[] => [
  // A tag spelt like a level key ("level:x") is not one.
  ...courseTagsOf(row)
    .map((t) => t.toLowerCase())
    .filter((t) => !t.startsWith(LEVEL_KEY_PREFIX)),
  ...levelKeys(row.level_name ?? row.level),
];

const tagSetOf = (rows: CatalogRowLike[]) => new Set(rows.flatMap((r) => courseMatchKeysOf(r)));

const makeCard = <R extends CatalogRowLike>(
  courseId: string,
  rows: R[],
  primary: R,
  languages: CourseLanguageOption[],
): CatalogCard<R> => {
  const summary = priceSummaryOf(rows);
  const packageIds = [...new Set(rows.map((r) => String(r.package_id || r.id || "")).filter(Boolean))];
  return {
    courseId,
    rows,
    primary,
    languages,
    tagSet: tagSetOf(rows),
    // For a single-row card both branches give the row's own price — the original sort.
    sortPrice: summary.minPrice ?? Math.min(...rows.map((r) => toNumber(r.price))),
    ...summary,
    ...(packageIds.length > 1 ? { courseIds: packageIds } : {}),
  };
};

/**
 * Cards in catalogue order. Grouping off: one card per row, in row order (the
 * original grid). Grouping on: one card per course where its first row sat,
 * opening the preferred language's version when the course has one.
 */
export const buildCatalogCards = <R extends CatalogRowLike>(
  rows: R[],
  opts: {
    grouping: boolean;
    languages: CourseLanguageOption[];
    preferredLanguage?: string | null;
    /** Separate packages that are one course (opt-in, grouping only). */
    versionGroups?: string[][] | null;
  },
): CatalogCard<R>[] => {
  if (!opts.grouping) return rows.map((row) => makeCard(String(row.id || ""), [row], row, []));
  const withPackage = rows.map((row) => ({ row, package_id: row.package_id || row.id || null, package_session_id: row.package_session_id ?? row.packageSessionId ?? null, level_name: row.level_name ?? row.level, comma_separeted_tags: (row as { comma_separeted_tags?: string | null }).comma_separeted_tags ?? null }));
  return groupCourseVariants(withPackage, {
    enabled: true,
    languages: opts.languages,
    preferredLanguage: opts.preferredLanguage,
    versionGroups: opts.versionGroups,
  }).map((group) =>
    makeCard(
      group.courseId,
      group.variants.map((v) => v.row),
      group.primary.row,
      group.languages,
    ),
  );
};

// Per language list, per row: the facet counts ask for the same rows' language
// many times on every keystroke, and languageOfLevel builds a RegExp per token.
const rowLanguageCache = new WeakMap<CourseLanguageOption[], WeakMap<object, CourseLanguageOption | null>>();

/**
 * The language a row is in, read from its level name. Remembered per row
 * object and language list (rows and the resolved language list are not
 * mutated), so repeated filter and count tests are lookups.
 */
export const rowLanguage = (
  row: { level_name?: string | null; level?: string; comma_separeted_tags?: string | null },
  languages: CourseLanguageOption[],
): CourseLanguageOption | null => {
  let byRow = rowLanguageCache.get(languages);
  if (!byRow) {
    byRow = new WeakMap();
    rowLanguageCache.set(languages, byRow);
  }
  const known = byRow.get(row);
  if (known !== undefined) return known;
  const lang = languageOfRow(row, languages);
  byRow.set(row, lang);
  return lang;
};
