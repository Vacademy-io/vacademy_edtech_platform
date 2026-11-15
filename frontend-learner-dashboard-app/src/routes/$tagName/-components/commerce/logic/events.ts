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
    | { name: 'view_search_results'; term: string; results: number };

export interface BuiltEvent {
    ga: { name: string; params: Record<string, unknown> };
    /** The Meta standard event this maps to, when there is one. */
    meta?: { name: string; params: Record<string, unknown> };
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
        if (built.meta) win.fbq?.('track', built.meta.name, built.meta.params);
        return built;
    } catch {
        return null;
    }
};
