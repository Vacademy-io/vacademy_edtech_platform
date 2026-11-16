/**
 * commerce-events: what a shopper does, as GA4 ecommerce
 * events and Meta Pixel browser events. The scripts themselves are the site's own
 * (globalSettings.tracking, injected by useCatalogueTracking); this module only speaks to
 * whatever is on the page, and says nothing when nothing is. No identifiers are sent: only
 * product ids, names, prices and the search text.
 *
 * Pure builders (tested) and one sender. Never throws: analytics must not break a page.
 */
import { perUnitAmount } from './format';

export interface EventItem {
    /** SKU when known, else the variant or product id. */
    id: string;
    name: string;
    /** Price of ONE base unit, as the API sends it. */
    unitPrice: number | null | undefined;
    /** Base units. */
    quantity?: number;
    qtyScale?: number | null;
    variant?: string | null;
    category?: string | null;
    /** Position in a list, from 0. */
    index?: number;
}

export type CommerceEvent =
    | { name: 'view_item_list'; listId: string; listName?: string; items: EventItem[] }
    | { name: 'select_item'; listId: string; listName?: string; item: EventItem }
    | { name: 'view_item'; item: EventItem; currency?: string | null }
    | { name: 'add_to_cart'; item: EventItem; currency?: string | null }
    | { name: 'remove_from_cart'; item: EventItem; currency?: string | null }
    | { name: 'view_cart'; items: EventItem[]; value?: number | null; currency?: string | null }
    | { name: 'search'; term: string }
    | { name: 'view_search_results'; term: string; results: number }
    | { name: 'begin_checkout'; items: EventItem[]; value?: number | null; currency?: string | null; coupon?: string | null }
    | { name: 'add_shipping_info'; items: EventItem[]; value?: number | null; currency?: string | null }
    | { name: 'add_payment_info'; items: EventItem[]; value?: number | null; currency?: string | null; paymentType: 'prepaid' | 'cod' }
    | {
          name: 'purchase';
          /** The order NUMBER (what the shopper sees), never the order id. */
          transactionId: string;
          items: EventItem[];
          value?: number | null;
          tax?: number | null;
          shipping?: number | null;
          coupon?: string | null;
          currency?: string | null;
          paymentType: 'prepaid' | 'cod';
      }
    | { name: 'login' }
    | { name: 'commerce_checkout_error'; code: string }
    /** A tap on a WhatsApp, call, email or directions link of a content block. */
    | { name: 'contact'; method: 'whatsapp' | 'call' | 'email' | 'directions'; placement: string };

export interface BuiltEvent {
    ga: { name: string; params: Record<string, unknown> };
    /** The Meta standard event this maps to, when there is one. */
    meta?: { name: string; params: Record<string, unknown>; eventId?: string };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * A GA4 item. Goods sold by length are reported per whole unit: price per metre and the
 * number of metres, so price times quantity is the money, as GA4 expects.
 */
export const gaItem = (item: EventItem): Record<string, unknown> => {
    const scale = Math.max(1, Math.floor(item.qtyScale || 1));
    const price = perUnitAmount(item.unitPrice, scale);
    const quantity = round2((item.quantity ?? scale) / scale);
    return {
        item_id: item.id,
        item_name: item.name,
        ...(price !== null ? { price } : {}),
        quantity,
        ...(item.variant ? { item_variant: item.variant } : {}),
        ...(item.category ? { item_category: item.category } : {}),
        ...(typeof item.index === 'number' ? { index: item.index } : {}),
    };
};

const valueOf = (items: EventItem[]): number | null => {
    let total = 0;
    for (const item of items) {
        if (typeof item.unitPrice !== 'number') return null;
        const scale = Math.max(1, Math.floor(item.qtyScale || 1));
        total += item.unitPrice * (item.quantity ?? scale);
    }
    return round2(total);
};

const money = (items: EventItem[], currency: string | null | undefined, given?: number | null): Record<string, unknown> => {
    const value = typeof given === 'number' ? round2(given) : valueOf(items);
    return value === null ? {} : { currency: (currency || 'INR').toUpperCase(), value };
};

export const buildCommerceEvent = (event: CommerceEvent): BuiltEvent => {
    switch (event.name) {
        case 'view_item_list':
            return {
                ga: {
                    name: 'view_item_list',
                    params: {
                        item_list_id: event.listId,
                        ...(event.listName ? { item_list_name: event.listName } : {}),
                        // GA4 reads at most 200 items; a listing page shows far fewer.
                        items: event.items.slice(0, 50).map(gaItem),
                    },
                },
            };
        case 'select_item':
            return {
                ga: {
                    name: 'select_item',
                    params: {
                        item_list_id: event.listId,
                        ...(event.listName ? { item_list_name: event.listName } : {}),
                        items: [gaItem(event.item)],
                    },
                },
            };
        case 'view_item': {
            const sums = money([event.item], event.currency);
            return {
                ga: { name: 'view_item', params: { ...sums, items: [gaItem(event.item)] } },
                meta: { name: 'ViewContent', params: { content_ids: [event.item.id], content_name: event.item.name, content_type: 'product', ...sums } },
            };
        }
        case 'add_to_cart': {
            const sums = money([event.item], event.currency);
            return {
                ga: { name: 'add_to_cart', params: { ...sums, items: [gaItem(event.item)] } },
                meta: { name: 'AddToCart', params: { content_ids: [event.item.id], content_name: event.item.name, content_type: 'product', ...sums } },
            };
        }
        case 'remove_from_cart':
            return { ga: { name: 'remove_from_cart', params: { ...money([event.item], event.currency), items: [gaItem(event.item)] } } };
        case 'view_cart':
            return { ga: { name: 'view_cart', params: { ...money(event.items, event.currency, event.value), items: event.items.map(gaItem) } } };
        case 'search':
            return {
                ga: { name: 'search', params: { search_term: event.term } },
                meta: { name: 'Search', params: { search_string: event.term } },
            };
        case 'view_search_results':
            // results_count 0 is the "zero-result query" the seller reads to learn what is missing.
            return { ga: { name: 'view_search_results', params: { search_term: event.term, results_count: event.results, zero_results: event.results === 0 } } };
        case 'begin_checkout': {
            const sums = money(event.items, event.currency, event.value);
            const coupon = event.coupon ? { coupon: event.coupon } : {};
            return {
                ga: { name: 'begin_checkout', params: { ...sums, ...coupon, items: event.items.map(gaItem) } },
                meta: { name: 'InitiateCheckout', params: { content_ids: event.items.map((i) => i.id), content_type: 'product', num_items: event.items.length, ...sums } },
            };
        }
        case 'add_shipping_info':
            return {
                ga: { name: 'add_shipping_info', params: { ...money(event.items, event.currency, event.value), shipping_tier: 'standard', items: event.items.map(gaItem) } },
            };
        case 'add_payment_info': {
            const sums = money(event.items, event.currency, event.value);
            return {
                ga: { name: 'add_payment_info', params: { ...sums, payment_type: event.paymentType, items: event.items.map(gaItem) } },
                meta: { name: 'AddPaymentInfo', params: { content_ids: event.items.map((i) => i.id), content_type: 'product', ...sums } },
            };
        }
        case 'purchase': {
            const sums = money(event.items, event.currency, event.value);
            const extra = {
                ...(typeof event.tax === 'number' ? { tax: round2(event.tax) } : {}),
                ...(typeof event.shipping === 'number' ? { shipping: round2(event.shipping) } : {}),
                ...(event.coupon ? { coupon: event.coupon } : {}),
            };
            return {
                ga: {
                    name: 'purchase',
                    params: { transaction_id: event.transactionId, ...sums, ...extra, payment_type: event.paymentType, items: event.items.map(gaItem) },
                },
                // The same id lets Meta drop a duplicate sent by the server later.
                meta: {
                    name: 'Purchase',
                    params: { content_ids: event.items.map((i) => i.id), content_type: 'product', num_items: event.items.length, ...sums },
                    eventId: event.transactionId,
                },
            };
        }
        case 'login':
            return { ga: { name: 'login', params: { method: 'whatsapp_otp' } } };
        case 'commerce_checkout_error':
            return { ga: { name: 'commerce_checkout_error', params: { code: (event.code || 'unknown').slice(0, 40) } } };
        case 'contact':
            return {
                ga: { name: 'commerce_contact', params: { method: event.method, placement: (event.placement || '').slice(0, 40) } },
                meta: { name: 'Contact', params: { content_category: event.method } },
            };
    }
};

interface TrackingWindow {
    location?: { search?: string };
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
}

/** The page editor's preview (?preview=true) is an admin looking at a draft, not a shopper. */
export const isBuilderPreview = (win: TrackingWindow | undefined): boolean => {
    try {
        return new URLSearchParams(win?.location?.search || '').get('preview') === 'true';
    } catch {
        return false;
    }
};

/**
 * Sends one event to GA4 (gtag), to a GTM container (dataLayer, ecommerce object cleared
 * first as GTM asks) and to the Meta Pixel, whichever the site has. Returns what was sent,
 * for tests.
 */
export const sendCommerceEvent = (
    event: CommerceEvent,
    win: TrackingWindow | undefined = typeof window === 'undefined' ? undefined : (window as unknown as TrackingWindow)
): BuiltEvent | null => {
    try {
        if (!win || isBuilderPreview(win)) return null;
        const built = buildCommerceEvent(event);
        win.gtag?.('event', built.ga.name, built.ga.params);
        if (Array.isArray(win.dataLayer)) {
            win.dataLayer.push({ ecommerce: null });
            win.dataLayer.push({ event: `commerce_${built.ga.name}`, ecommerce: built.ga.params });
        }
        if (built.meta) {
            if (built.meta.eventId) win.fbq?.('track', built.meta.name, built.meta.params, { eventID: built.meta.eventId });
            else win.fbq?.('track', built.meta.name, built.meta.params);
        }
        return built;
    } catch {
        return null;
    }
};

/* ── once-only events of the buying pages ─────────────────────────── */

interface SmallStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

const PURCHASED_KEY = 'cmx.purchased.v1';
const BEGUN_KEY = 'cmx.begin.v1';

const readList = (storage: SmallStorage | null | undefined, key: string): string[] => {
    try {
        const parsed = JSON.parse(storage?.getItem(key) || '[]') as unknown;
        return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
        return [];
    }
};

/** Adds `value` to a short list in storage; false when it was already there. */
const firstTime = (storage: SmallStorage | null | undefined, key: string, value: string, keep: number): boolean => {
    const list = readList(storage, key);
    if (list.includes(value)) return false;
    try {
        storage?.setItem(key, JSON.stringify([...list, value].slice(-keep)));
    } catch {
        // Without storage the event may repeat on a reload; that is the lesser harm.
    }
    return true;
};

const local = (): SmallStorage | null => {
    try {
        if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
};

const session = (): SmallStorage | null => {
    try {
        if (typeof window !== 'undefined' && window.sessionStorage) return window.sessionStorage;
        return typeof sessionStorage === 'undefined' ? null : sessionStorage;
    } catch {
        return null;
    }
};

/**
 * `purchase` once per order number of a shop on this device (a reload of the order page sends
 * nothing). Order numbers restart per shop, so the list is kept per institute (`scope`).
 */
export const sendPurchaseOnce = (
    event: Extract<CommerceEvent, { name: 'purchase' }>,
    scope: string,
    storage: SmallStorage | null | undefined = local(),
    win?: Parameters<typeof sendCommerceEvent>[1]
): BuiltEvent | null => {
    if (!event.transactionId) return null;
    const target = win === undefined ? (typeof window === 'undefined' ? undefined : (window as unknown as Parameters<typeof sendCommerceEvent>[1])) : win;
    // Nothing is remembered from an editor preview, so the real visit still counts.
    if (!target || isBuilderPreview(target)) return null;
    if (!firstTime(storage, `${PURCHASED_KEY}.${scope}`, event.transactionId, 50)) return null;
    return sendCommerceEvent(event, target);
};

/** `begin_checkout` once per cart (its hash) per browser session. */
export const sendBeginCheckoutOnce = (
    hash: string,
    event: Extract<CommerceEvent, { name: 'begin_checkout' }>,
    storage: SmallStorage | null | undefined = session(),
    win?: Parameters<typeof sendCommerceEvent>[1]
): BuiltEvent | null => {
    const target = win === undefined ? (typeof window === 'undefined' ? undefined : (window as unknown as Parameters<typeof sendCommerceEvent>[1])) : win;
    if (!target || isBuilderPreview(target)) return null;
    if (!firstTime(storage, BEGUN_KEY, hash, 20)) return null;
    return sendCommerceEvent(event, target);
};
