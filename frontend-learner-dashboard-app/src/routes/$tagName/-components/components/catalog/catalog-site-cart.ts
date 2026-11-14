/**
 * Courses-page cards → the site-wide cart (-utils/site-cart.ts). Pure.
 *
 * A card can add a version to the cart only when that version can be bought
 * right now: it has a package session, a price, an open enrolment window and
 * is not "coming soon" — and the store page sells it (cardCartOffer). Free
 * versions keep the course-page enrol path.
 */

import type { CourseLanguageOption } from "../../../-utils/course-variants";
import type { SiteCartItem } from "../../../-utils/site-cart";
import { levelBeyondLanguage } from "../../site-cart/site-cart-items";
import { storeCartRoute, type StoreSale } from "../../site-cart/store-sale";
import { isBuyableNowRow, rowLanguage, type CatalogRowLike } from "./catalog-cards";

export const packageSessionOf = (row: CatalogRowLike): string =>
  String(row.packageSessionId || row.package_session_id || "").trim();

export const isPurchasableRow = (row: CatalogRowLike): boolean =>
  !!packageSessionOf(row) && typeof row.price === "number" && row.price > 0 && isBuyableNowRow(row);

/** The versions of a card that can go in the cart, in catalogue order. */
export const purchasableVersions = <R extends CatalogRowLike>(rows: R[]): R[] => rows.filter(isPurchasableRow);

/**
 * What a card's cart CTA offers. The cart checks out through the store page,
 * so a version goes in only when the store sells it as it is — the rule of
 * the course page, offers and learning paths (storeCartRoute). "cart": those
 * versions, for SiteCartCta, with all the card's purchasable versions
 * (`purchasable`, the store's or not) — the card's language chips and "from"
 * price speak for them all, so SiteCartCta names versions against them and
 * lets the visitor pick, seeing the language and price, even when the store
 * sells only one. "page": none of them (or the store page will not load) —
 * the card keeps its own CTA to the course page, as on a site without a site
 * cart. "pending": the store page is loading; a card with a version to sell
 * offers nothing until it is known.
 */
export type CardCartOffer<R> = { route: "cart"; versions: R[]; purchasable: R[] } | { route: "page" | "pending" };

// The course page a card leads to enrols through the version's invite, which
// sells it once — what storeCartRoute asks of a section's own checkout.
const coursePageSells = () => true;

export const cardCartOffer = <R extends CatalogRowLike>(rows: R[], sale: StoreSale): CardCartOffer<R> => {
  const candidates = purchasableVersions(rows);
  const routes = candidates.map((v) => storeCartRoute(sale, [packageSessionOf(v)], coursePageSells));
  if (routes.includes("pending")) return { route: "pending" };
  const versions = candidates.filter((_, i) => routes[i] === "cart");
  return versions.length ? { route: "cart", versions, purchasable: candidates } : { route: "page" };
};

/** A cart line for one version. Title and level stay in the base language (translated at display). */
export const toSiteCartItem = (
  row: CatalogRowLike & { thumbnail?: string },
  courseId: string,
  languages: CourseLanguageOption[],
): SiteCartItem => {
  const lang = rowLanguage(row, languages);
  const image = typeof row.thumbnail === "string" && !row.thumbnail.includes("/api/placeholder/") ? row.thumbnail : undefined;
  return {
    packageSessionId: packageSessionOf(row),
    courseId,
    title: row.title,
    ...(row.level_name || row.level ? { levelName: String(row.level_name || row.level) } : {}),
    ...(lang ? { languageCode: lang.code } : {}),
    price: row.price,
    ...(typeof row.elevatedPrice === "number" ? { elevatedPrice: row.elevatedPrice } : {}),
    ...(row.currency ? { currency: row.currency } : {}),
    ...(image ? { image } : {}),
    ...(row.enrollInviteId ? { enrollInviteId: row.enrollInviteId } : {}),
    source: { kind: "catalog" },
  };
};

/** The version of this course already in the cart, if any (the cart holds one version per course). */
export const cartVersionOf = <R extends CatalogRowLike>(
  versions: R[],
  cartPackageSessionIds: Set<string>,
): R | undefined => versions.find((v) => cartPackageSessionIds.has(packageSessionOf(v)));

const levelOf = (row: CatalogRowLike): string => String(row.level_name || row.level || "");

/** Is another version of the card in this version's language? Then the language alone cannot tell them apart. */
const sharesLanguage = <R extends CatalogRowLike>(v: R, versions: R[], languages: CourseLanguageOption[]): boolean => {
  const code = rowLanguage(v, languages)?.code;
  return !!code && versions.some((o) => o !== v && rowLanguage(o, languages)?.code === code);
};

/**
 * Does the card's chooser pick between languages only (every version a
 * different language)? Otherwise it picks between versions — levels.
 */
export const choosesLanguageOnly = <R extends CatalogRowLike>(versions: R[], languages: CourseLanguageOption[]): boolean => {
  const codes = versions.map((v) => rowLanguage(v, languages)?.code);
  return codes.every(Boolean) && new Set(codes).size === codes.length;
};

/**
 * How the chooser names a version (its language chip shows beside it): the
 * language — unless another version is in the same language ("Beginner Hindi"
 * / "Advanced Hindi"), then the level without its language word ("Advanced"),
 * or the whole level name when the language has no chip to say it. A version
 * without a language is named by its level.
 */
export const versionChoiceLabel = <R extends CatalogRowLike>(
  v: R,
  versions: R[],
  languages: CourseLanguageOption[],
  translate: (s: string) => string,
): string => {
  const lang = rowLanguage(v, languages);
  const level = levelOf(v);
  if (!lang) return translate(level);
  const languageName = translate(lang.label || lang.code);
  if (!sharesLanguage(v, versions, languages)) return languageName;
  const shown = translate(level).trim() || languageName;
  return lang.chip ? levelBeyondLanguage(level, lang, translate) || shown : shown;
};

/**
 * What "In cart · …" names for the version in the cart: its language chip,
 * with the rest of its level when that says more than the language
 * ("Advanced · हिं"); a version without a language, its level. "" when there
 * is nothing to name.
 */
export const inCartVersionText = (
  v: CatalogRowLike,
  languages: CourseLanguageOption[],
  translate: (s: string) => string,
): string => {
  const lang = rowLanguage(v, languages);
  const level = levelBeyondLanguage(levelOf(v), lang, translate);
  if (!lang) return level;
  const chip = lang.chip || lang.label || lang.code;
  return level ? `${level} · ${chip}` : chip;
};
