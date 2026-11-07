/**
 * Checkout pre-check: can the store product page sell everything in the cart?
 *
 * The store checkout selects courses by `?courseIds=` (package session ids)
 * and silently drops any id it has no ACTIVE mapping for, and it selects EVERY
 * mapping that matches an id — so a course listed twice on the store page is
 * charged twice. Both are decided here, before the visitor leaves the cart, so
 * an item is never dropped or double-charged without them seeing why.
 *
 * One order is charged in ONE currency (the checkout adds its lines up), so an
 * item priced in another currency than the order's is set aside to be checked
 * out on its own. A free item costs nothing in any currency: it never sets or
 * splits the order's currency, as the server's checkout currency skips
 * zero-priced lines too. A price that changed since the item was added (a
 * promo or a product page's own price, against the store's plan) is put in
 * front of the visitor before checkout, never applied silently.
 */
import type { SiteCartItem } from "../../-utils/site-cart";
import { SITE_CART_MAX_ITEMS } from "./site-cart-items";

export type PrecheckIssue =
  /** The store page has no ACTIVE mapping for this version. */
  | "notInStore"
  /** The store page maps this version more than once — checking out would charge it twice. */
  | "listedTwice"
  /** The cart holds this course (or this exact version) more than once. */
  | "duplicateInCart"
  /** Priced in another currency than the rest of the order — it is checked out separately. */
  | "otherCurrency";

export interface StoreMappingLike {
  package_session_id?: string | null;
  status?: string | null;
  payment_plan?: { actual_price?: number | null; currency?: string | null } | null;
}

export interface FlaggedItem {
  item: SiteCartItem;
  issue: PrecheckIssue;
}

export interface PriceChange {
  item: SiteCartItem;
  /** What the store checkout charges for it now. */
  storePrice: number;
  /** The store's currency for it (else the item's). */
  currency?: string;
}

export interface SiteCartPrecheck {
  /** Items the store checkout can sell, in cart order — one currency. */
  ready: SiteCartItem[];
  /** Items that must not go to checkout as they are, each with the reason. */
  flagged: FlaggedItem[];
  /** Ready items whose store price (or currency) differs from what the cart showed. */
  priceChanges: PriceChange[];
  /** The cart holds more items than one order may. */
  overLimit: boolean;
  /** True when every item can go to checkout in this order (nothing flagged). */
  ok: boolean;
}

const isActive = (m: StoreMappingLike) => (m.status ?? "ACTIVE").toUpperCase() === "ACTIVE";

const currencyCode = (value: string | null | undefined): string => (value || "").trim().toUpperCase();

/** The store's ACTIVE mappings, by package session. */
const activeBySession = (storeMappings: StoreMappingLike[] | null | undefined) => {
  const bySession = new Map<string, StoreMappingLike[]>();
  for (const m of storeMappings || []) {
    const id = m.package_session_id;
    if (!id || !isActive(m)) continue;
    const list = bySession.get(id);
    if (list) list.push(m);
    else bySession.set(id, [m]);
  }
  return bySession;
};

/**
 * How many ACTIVE mappings a product page has for each version it lists. Its
 * checkout sells a version with exactly one as it is; none is "not on sale",
 * and two or more would charge it twice — the rule the pre-check applies to
 * every cart item.
 */
export const activeMappingCounts = (mappings: StoreMappingLike[] | null | undefined): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const [id, matches] of activeBySession(mappings)) counts.set(id, matches.length);
  return counts;
};

export const precheckSiteCart = (
  items: SiteCartItem[],
  storeMappings: StoreMappingLike[] | null | undefined,
  opts: { max?: number } = {},
): SiteCartPrecheck => {
  const max = opts.max ?? SITE_CART_MAX_ITEMS;
  const bySession = activeBySession(storeMappings);

  const ready: SiteCartItem[] = [];
  const flagged: FlaggedItem[] = [];
  const priceChanges: PriceChange[] = [];
  const seenSessions = new Set<string>();
  const seenCourses = new Set<string>();
  // The order's currency: that of its first priced sellable item that names one.
  let orderCurrency = "";

  for (const item of items) {
    // Later copies are the duplicates; the first stays sellable.
    if (seenSessions.has(item.packageSessionId) || seenCourses.has(item.courseId)) {
      flagged.push({ item, issue: "duplicateInCart" });
      continue;
    }
    seenSessions.add(item.packageSessionId);
    seenCourses.add(item.courseId);

    const matches = bySession.get(item.packageSessionId) || [];
    if (matches.length === 0) {
      flagged.push({ item, issue: "notInStore" });
      continue;
    }
    if (matches.length > 1) {
      flagged.push({ item, issue: "listedTwice" });
      continue;
    }

    const plan = matches[0]!.payment_plan;
    const currency = currencyCode(plan?.currency || item.currency);
    // Priced: what the store's plan charges, else (no plan price) what the
    // cart showed. A free item goes to checkout whatever its currency label.
    const priced = typeof plan?.actual_price === "number" ? plan.actual_price > 0 : (item.price ?? 0) > 0;
    if (priced && currency) {
      if (!orderCurrency) orderCurrency = currency;
      else if (currency !== orderCurrency) {
        flagged.push({ item, issue: "otherCurrency" });
        continue;
      }
    }

    ready.push(item);
    const storePrice = plan?.actual_price;
    if (typeof item.price === "number" && typeof storePrice === "number" && Number.isFinite(storePrice)) {
      const shownCurrency = currencyCode(item.currency);
      const changed =
        Math.abs(storePrice - item.price) >= 0.01 || (!!shownCurrency && !!currency && shownCurrency !== currency);
      if (changed) priceChanges.push({ item, storePrice, currency: plan?.currency || item.currency });
    }
  }

  const overLimit = items.length > max;
  return {
    ready,
    flagged,
    priceChanges,
    overLimit,
    ok: !overLimit && flagged.length === 0 && ready.length > 0,
  };
};

/**
 * Can the checkout go ahead without asking the visitor? Only when every item
 * can be sold in this order and — where prices are shown at all — at the
 * prices the cart showed. A changed price is confirmed first, never charged
 * silently.
 */
export const canCheckOutDirectly = (result: SiteCartPrecheck, opts: { pricesShown: boolean }): boolean =>
  result.ok && (!opts.pricesShown || result.priceChanges.length === 0);

export interface PrecheckReview {
  /** Items the store cannot sell as they are (everything flagged but the other-currency ones). */
  blocked: FlaggedItem[];
  /** Items left for an order of their own, in their own currency. */
  otherCurrency: FlaggedItem[];
  /** Nothing is flagged: the review is only about changed prices. */
  priceOnly: boolean;
}

/** What a review has to say, for the cart drawer. */
export const reviewSummary = (result: SiteCartPrecheck): PrecheckReview => ({
  blocked: result.flagged.filter((f) => f.issue !== "otherCurrency"),
  otherCurrency: result.flagged.filter((f) => f.issue === "otherCurrency"),
  priceOnly: result.ok && result.priceChanges.length > 0,
});

/**
 * The items that go to checkout, at the prices the checkout will charge — what
 * a review's total adds up. A changed line drops its old struck-through price,
 * which no longer belongs to it.
 */
export const readyAtStorePrices = (result: Pick<SiteCartPrecheck, "ready" | "priceChanges">): SiteCartItem[] => {
  const changes = new Map(result.priceChanges.map((c) => [c.item, c]));
  return result.ready.map((item) => {
    const change = changes.get(item);
    if (!change) return item;
    const atStore: SiteCartItem = {
      ...item,
      price: change.storePrice,
      ...(change.currency ? { currency: change.currency } : {}),
    };
    delete atStore.elevatedPrice;
    return atStore;
  });
};

/**
 * Package session ids "Remove unavailable" takes out: the versions the store
 * cannot sell (or would charge twice). A duplicate copy is left to the visitor
 * — it can share its id with the copy that stays, and removing by id would
 * take both. An item in another currency is not unavailable: it can be bought
 * in an order of its own, so it stays too.
 */
export const unavailableSessionIds = (result: Pick<SiteCartPrecheck, "flagged">): string[] => [
  ...new Set(
    result.flagged
      .filter((f) => f.issue === "notInStore" || f.issue === "listedTwice")
      .map((f) => f.item.packageSessionId),
  ),
];
