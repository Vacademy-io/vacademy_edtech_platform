/**
 * Site-wide course cart — pure helpers (the zustand store is in
 * -stores/site-cart-store.ts).
 *
 * ONE cart for the whole site: courses added from the Courses page, from a
 * learning path or from a course page all land here, and checkout hands every
 * item to the site's STORE product page (globalSettings.siteCart) — the
 * existing product-page checkout, which already takes many courses in one
 * payment with coupons, offers and the institute's gateways. Each item is a
 * package session (one language version of one course).
 *
 * Opt-in: a site without globalSettings.siteCart.enabled never touches this,
 * and its catalogue keeps the original book-store cart.
 */

export interface SiteCartSettings {
  enabled?: boolean;
  /** Code of the product page whose checkout takes the whole cart. */
  storeProductPageCode?: string;
  storeProductPageName?: string;
}

export type SiteCartSource =
  | { kind: "catalog" }
  | { kind: "course" }
  | { kind: "path"; productPageCode: string; pathTitle?: string };

export interface SiteCartItem {
  /** Identity: one language version of one course. */
  packageSessionId: string;
  /** package_id — at most one version per course in the cart. */
  courseId: string;
  title: string;
  levelName?: string;
  languageCode?: string;
  price?: number;
  elevatedPrice?: number;
  currency?: string;
  image?: string;
  enrollInviteId?: string;
  source?: SiteCartSource;
  addedAt?: number;
}

export const isSiteCartEnabled = (settings: SiteCartSettings | undefined | null): boolean =>
  !!settings?.enabled && !!settings.storeProductPageCode?.trim();

/** Storage key: one cart per institute (its sites share courses and checkout rules). */
export const siteCartStorageKey = (instituteId: string) => `site-cart:${instituteId}`;

/**
 * Adds an item. A second version of a course REPLACES the first (choosing
 * Hindi after English swaps it), the same version twice is a no-op.
 */
export const upsertCartItem = (items: SiteCartItem[], item: SiteCartItem): SiteCartItem[] => {
  if (items.some((i) => i.packageSessionId === item.packageSessionId)) return items;
  const rest = items.filter((i) => i.courseId !== item.courseId);
  return [...rest, { ...item, addedAt: item.addedAt ?? rest.length }];
};

/** Adds several (a whole learning path) with the same one-version-per-course rule. */
export const upsertCartItems = (items: SiteCartItem[], incoming: SiteCartItem[]): SiteCartItem[] =>
  incoming.reduce((acc, item) => upsertCartItem(acc, item), items);

/** One order through the store checkout holds at most this many courses. */
export const SITE_CART_MAX_ITEMS = 40;

/**
 * upsertCartItems that never grows the cart past `max` courses. Swapping a
 * course to another language version does not grow it, so that is always
 * accepted. The store applies this to every add, so no caller can overfill it.
 */
export const upsertCartItemsCapped = (
  items: SiteCartItem[],
  incoming: SiteCartItem[],
  max: number = SITE_CART_MAX_ITEMS,
): SiteCartItem[] =>
  incoming.reduce((acc, item) => {
    const grows = !acc.some((i) => i.courseId === item.courseId);
    if (grows && acc.length >= max) return acc;
    return upsertCartItem(acc, item);
  }, items);

export const removeCartItems = (items: SiteCartItem[], packageSessionIds: string[]): SiteCartItem[] => {
  const drop = new Set(packageSessionIds);
  return items.filter((i) => !drop.has(i.packageSessionId));
};

export interface CartTotals {
  count: number;
  /** Sum of prices; null when the priced items' currencies differ (no honest single number). */
  total: number | null;
  elevatedTotal: number | null;
  currency: string | null;
}

const currencyOf = (item: SiteCartItem) => (item.currency || "INR").toUpperCase();

export const cartTotals = (items: SiteCartItem[]): CartTotals => {
  // A free item costs nothing in any currency, so the priced items name the
  // total's currency (every item when none is priced) — as one checkout
  // charges a free course beside paid ones in theirs.
  const priced = items.filter((i) => typeof i.price === "number" && i.price > 0);
  const currencies = new Set((priced.length ? priced : items).map(currencyOf));
  if (currencies.size > 1) return { count: items.length, total: null, elevatedTotal: null, currency: null };
  const currency = items.length ? [...currencies][0] : null;
  let total = 0;
  let elevated = 0;
  let hasElevated = false;
  for (const i of items) {
    const p = typeof i.price === "number" ? i.price : 0;
    total += p;
    // A free item labelled in another currency adds nothing, its list price included.
    if (typeof i.elevatedPrice === "number" && i.elevatedPrice > p && currencyOf(i) === currency) {
      elevated += i.elevatedPrice;
      hasElevated = true;
    } else {
      elevated += p;
    }
  }
  return {
    count: items.length,
    total,
    elevatedTotal: hasElevated ? elevated : null,
    currency,
  };
};

/** Splits the cart by whether the store product page can sell each item. */
export const partitionByStore = (
  items: SiteCartItem[],
  storePackageSessionIds: Set<string>,
): { available: SiteCartItem[]; unavailable: SiteCartItem[] } => ({
  available: items.filter((i) => storePackageSessionIds.has(i.packageSessionId)),
  unavailable: items.filter((i) => !storePackageSessionIds.has(i.packageSessionId)),
});

/**
 * Router target for the store checkout: the product page opens straight on its
 * cart with exactly these courses selected (?courseIds= matches package
 * session ids; defaultTab=CART skips the catalogue step).
 */
export const storeCheckoutTarget = (
  storeCode: string,
  items: SiteCartItem[],
  ctx: { instituteId?: string; tagName?: string },
) => ({
  to: "/product-pages/$productPageCode" as const,
  params: { productPageCode: storeCode },
  search: {
    courseIds: items.map((i) => i.packageSessionId).join(","),
    defaultTab: "CART" as const,
    ...(ctx.instituteId ? { instituteId: ctx.instituteId } : {}),
    ...(ctx.tagName ? { tagName: ctx.tagName } : {}),
  },
});
