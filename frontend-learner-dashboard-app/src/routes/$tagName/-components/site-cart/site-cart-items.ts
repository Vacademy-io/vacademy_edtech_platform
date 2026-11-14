/**
 * Pure helpers shared by everything that puts courses into the site cart
 * (catalogue offer cards, learning paths, the drawer). The cart model and the
 * store live in -utils/site-cart.ts and -stores/site-cart-store.ts.
 */
import {
  DEFAULT_COURSE_LANGUAGES,
  languageOfLevel,
  type CourseLanguageOption,
} from "../../-utils/course-variants";
import { SITE_CART_MAX_ITEMS, upsertCartItems, type SiteCartItem, type SiteCartSource } from "../../-utils/site-cart";

/** One order through the store checkout holds at most this many courses (defined with the cart model). */
export { SITE_CART_MAX_ITEMS };

/** `?source=` on the store checkout when the site cart sent the visitor there. */
export const SITE_CART_CHECKOUT_SOURCE = "siteCart";

/**
 * Is this location the store checkout itself? Checking out again from there
 * (its header has the cart too) replaces the history entry, so the
 * checkout's Back still returns to the page the cart was first opened on and
 * never to a stale basket.
 */
export const isStoreCheckoutPath = (pathname: string | null | undefined, storeCode: string): boolean => {
  const code = storeCode.trim();
  if (!code) return false;
  const path = (pathname || "").replace(/\/+$/, "");
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // A malformed escape: compare it as it is.
  }
  return decoded === `/product-pages/${code}`;
};

export interface CapResult {
  /** The cart after the accepted items were added. */
  next: SiteCartItem[];
  /** Incoming items now in the cart (new courses, or a course switched to this version). */
  accepted: SiteCartItem[];
  /** Incoming items left out because the cart would grow past the cap. */
  rejected: SiteCartItem[];
  /** Incoming items that were already in the cart (same version) — nothing to do. */
  alreadyIn: SiteCartItem[];
}

/**
 * Adds `incoming` with the cart's one-version-per-course rule, but never lets
 * the cart grow past `max`. Swapping a course to another language version does
 * not grow the cart, so it is always accepted — even in a full cart. Items are
 * taken in order, so a learning path keeps its first steps when it overflows.
 */
export const capCartAdd = (
  current: SiteCartItem[],
  incoming: SiteCartItem[],
  max: number = SITE_CART_MAX_ITEMS,
): CapResult => {
  let next = current;
  const accepted: SiteCartItem[] = [];
  const rejected: SiteCartItem[] = [];
  const alreadyIn: SiteCartItem[] = [];
  for (const item of incoming) {
    if (next.some((i) => i.packageSessionId === item.packageSessionId)) {
      alreadyIn.push(item);
      continue;
    }
    const grows = !next.some((i) => i.courseId === item.courseId);
    if (grows && next.length >= max) {
      rejected.push(item);
      continue;
    }
    next = upsertCartItems(next, [item]);
    accepted.push(item);
  }
  return { next, accepted, rejected, alreadyIn };
};

/** The minimum of a product-page mapping (by-code response) a cart item is built from. */
export interface CartMappingLike {
  package_session_id: string;
  package_id?: string | null;
  package_name?: string | null;
  level_name?: string | null;
  enroll_invite_id?: string | null;
  course_preview_image_media_id?: string | null;
  payment_plan?: {
    actual_price?: number | null;
    elevated_price?: number | null;
    currency?: string | null;
  } | null;
}

const numberOrUndefined = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

const textOrUndefined = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

/**
 * A cart item for one product-page mapping (one language version of one
 * course). The title is the RAW course name — it is translated when shown,
 * never when stored. A mapping without a package id stands alone as its own
 * "course", so it can never replace an unrelated item.
 */
export const cartItemFromMapping = (
  m: CartMappingLike,
  opts: { languages?: CourseLanguageOption[]; source?: SiteCartSource } = {},
): SiteCartItem => {
  const languages = opts.languages?.length ? opts.languages : DEFAULT_COURSE_LANGUAGES;
  const language = languageOfLevel(m.level_name, languages);
  return {
    packageSessionId: m.package_session_id,
    courseId: textOrUndefined(m.package_id) ?? m.package_session_id,
    title: textOrUndefined(m.package_name) ?? "",
    levelName: textOrUndefined(m.level_name),
    languageCode: language?.code,
    price: numberOrUndefined(m.payment_plan?.actual_price),
    elevatedPrice: numberOrUndefined(m.payment_plan?.elevated_price),
    currency: textOrUndefined(m.payment_plan?.currency),
    image: textOrUndefined(m.course_preview_image_media_id),
    enrollInviteId: textOrUndefined(m.enroll_invite_id),
    ...(opts.source ? { source: opts.source } : {}),
  };
};

/** Level names the backend uses as placeholders for an unlevelled package. */
const SENTINEL_LEVELS = new Set(["default", "none", "null", "undefined", ""]);

export const isMeaningfulLevel = (level: string | null | undefined): boolean =>
  !!level && !SENTINEL_LEVELS.has(level.trim().toLowerCase());

/** The language option for a code, from the site's languages (or the EN / हिं defaults). */
export const languageOption = (
  code: string | null | undefined,
  languages?: CourseLanguageOption[],
): CourseLanguageOption | null => {
  if (!code) return null;
  const list = languages?.length ? languages : DEFAULT_COURSE_LANGUAGES;
  return list.find((l) => l.code === code) ?? null;
};

const isAsciiToken = (s: string) => /^[\x00-\x7F]*$/.test(s);
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The words that name a language inside a level name — its match words, label
 * and code (as languageOfLevel reads them), lower-case, longest first so a
 * longer word is never left half-removed by a shorter one.
 */
export const languageTokens = (language: CourseLanguageOption): string[] =>
  [...(language.match || []), language.label, language.code]
    .filter(Boolean)
    .map((t) => t.toLowerCase().trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

const SEPARATOR = "[,;:|/·•\\-–—_]";
const DANGLING_SEPARATORS = new RegExp(`^(?:\\s|${SEPARATOR})+|(?:\\s|${SEPARATOR})+$`, "g");
const REPEATED_SEPARATORS = new RegExp(`\\s(${SEPARATOR})(?:\\s*${SEPARATOR})+\\s`, "g");

/**
 * A level name for display without its language words, as written:
 * "Advanced Hindi" → "Advanced", "Beginner (English)" → "Beginner",
 * "Hindi - Batch 2" → "Batch 2", and "" when only the language is left.
 * Matches like languageOfLevel: whole words for ASCII, anywhere otherwise.
 */
export const stripLanguageWords = (text: string, language: CourseLanguageOption): string => {
  let out = ` ${text} `;
  for (const token of languageTokens(language)) {
    out = isAsciiToken(token)
      ? out.replace(new RegExp(`(^|[^a-z0-9])${escapeRegExp(token)}(?=[^a-z0-9]|$)`, "gi"), "$1")
      : out.replace(new RegExp(escapeRegExp(token), "giu"), "");
  }
  const cleaned = out
    // Brackets the language word sat in: "Beginner ()" / "(, Live)".
    .replace(new RegExp(`\\(\\s*(?:${SEPARATOR}\\s*)*\\)|\\[\\s*\\]|\\{\\s*\\}`, "g"), " ")
    .replace(new RegExp(`\\(\\s*(?:${SEPARATOR}\\s*)+`, "g"), "(")
    .replace(new RegExp(`(?:\\s*${SEPARATOR})+\\s*\\)`, "g"), ")")
    .replace(/\s+/g, " ")
    // "Beginner - - Batch 2" → "Beginner - Batch 2".
    .replace(REPEATED_SEPARATORS, " $1 ")
    .replace(DANGLING_SEPARATORS, "")
    .trim();
  return /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : "";
};

/**
 * What a version's level says beyond its language, for display: "Advanced"
 * for "Advanced Hindi", "" for a level that is only its language ("Hindi") or
 * a placeholder; without a language, the level itself. The level is
 * translated first (live data), then its language words come out — so a Hindi
 * page shows "उन्नत" for "Advanced Hindi" when the site translates it.
 */
export const levelBeyondLanguage = (
  levelName: string | null | undefined,
  language: CourseLanguageOption | null | undefined,
  translate: (s: string) => string = (s) => s,
): string => {
  // Translated as stored (the dictionary is keyed by the stored text).
  const raw = levelName || "";
  if (!isMeaningfulLevel(raw)) return "";
  if (!language) return translate(raw).trim();
  if (!stripLanguageWords(raw, language)) return "";
  const shown = translate(raw).trim();
  return stripLanguageWords(shown, language) || shown;
};

/**
 * What a cart row says about its version: the language chip ("हिं") when the
 * level names a language — with the rest of the level ("Advanced") when it
 * says more than the language — otherwise the level itself ("Batch 2"),
 * otherwise nothing. `level` comes out translated (pass the site's translate).
 */
export const versionLabel = (
  item: Pick<SiteCartItem, "languageCode" | "levelName">,
  languages?: CourseLanguageOption[],
  translate?: (s: string) => string,
): { chip: string; label: string; level?: string } | null => {
  const lang = languageOption(item.languageCode, languages);
  if (lang) {
    const level = levelBeyondLanguage(item.levelName, lang, translate);
    return { chip: lang.chip || lang.label, label: lang.label, ...(level ? { level } : {}) };
  }
  if (item.languageCode) return { chip: item.languageCode.toUpperCase(), label: item.languageCode };
  if (isMeaningfulLevel(item.levelName)) return { chip: item.levelName!, label: item.levelName! };
  return null;
};
