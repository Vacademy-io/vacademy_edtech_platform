/**
 * A listing's filters, sort and search text live in the URL, in the
 * names the API reads, so a filtered view can be shared and the back button works:
 *
 *   /c/sarees?filter.colour=red,blue&filter.fabric=cotton&price_min=500&price_max=2000&sort=price_asc
 *
 * Availability is ON by default (only what can be bought now); `in_stock=0` shows everything
 * with sold-out products last. OR within a facet, AND across facets. Every other parameter of
 * the address (lang, utm_*, preview) is left as it is.
 */
import type { ProductListParams, ProductSort } from '../api/types';

export const SORTS: readonly ProductSort[] = ['recommended', 'newest', 'price_asc', 'price_desc'];

const FILTER_PREFIX = 'filter.';
const MAX_FACETS = 20;
const MAX_VALUES = 50;
const CODE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export interface FacetState {
    q: string;
    /** Attribute code to picked value codes, both in a stable order. */
    filters: Record<string, string[]>;
    priceMin: number | null;
    priceMax: number | null;
    inStockOnly: boolean;
    sort: ProductSort;
}

export const EMPTY_FACET_STATE: FacetState = {
    q: '',
    filters: {},
    priceMin: null,
    priceMax: null,
    inStockOnly: true,
    sort: 'recommended',
};

const amount = (raw: string | null): number | null => {
    if (raw === null || raw.trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 1e10 ? n : null;
};

const toParams = (search: string | URLSearchParams | null | undefined): URLSearchParams =>
    typeof search === 'string' || !search ? new URLSearchParams((search || '').replace(/^\?/, '')) : new URLSearchParams(search);

export const parseFacetState = (search: string | URLSearchParams | null | undefined): FacetState => {
    const params = toParams(search);
    const filters: Record<string, string[]> = {};
    const keys = Array.from(new Set(Array.from(params.keys())))
        .filter((k) => k.startsWith(FILTER_PREFIX))
        .sort();
    for (const key of keys) {
        const code = key.slice(FILTER_PREFIX.length);
        if (!CODE.test(code) || Object.keys(filters).length >= MAX_FACETS) continue;
        const values: string[] = [];
        for (const raw of params.getAll(key)) {
            for (const part of raw.split(',')) {
                const value = part.trim();
                if (value && !values.includes(value) && values.length < MAX_VALUES) values.push(value);
            }
        }
        if (values.length) filters[code] = values.sort();
    }
    let priceMin = amount(params.get('price_min'));
    let priceMax = amount(params.get('price_max'));
    if (priceMin !== null && priceMax !== null && priceMin > priceMax) [priceMin, priceMax] = [priceMax, priceMin];
    const stock = (params.get('in_stock') || '').toLowerCase();
    const sort = params.get('sort') as ProductSort | null;
    return {
        q: (params.get('q') || '').trim().slice(0, 120),
        filters,
        priceMin,
        priceMax,
        inStockOnly: !(stock === '0' || stock === 'false'),
        sort: sort && SORTS.includes(sort) ? sort : 'recommended',
    };
};

/**
 * The state written back into a query string ("" or "?..."). Defaults are left out, so the
 * bare address is the unfiltered listing, and parameters this module does not own are kept.
 */
export const serializeFacetState = (state: FacetState, currentSearch?: string | URLSearchParams | null): string => {
    const params = toParams(currentSearch);
    for (const key of Array.from(new Set(Array.from(params.keys())))) {
        if (key.startsWith(FILTER_PREFIX)) params.delete(key);
    }
    for (const key of ['q', 'price_min', 'price_max', 'in_stock', 'sort', 'page']) params.delete(key);
    if (state.q) params.set('q', state.q);
    for (const code of Object.keys(state.filters).sort()) {
        const values = (state.filters[code] || []).filter(Boolean);
        if (values.length) params.set(`${FILTER_PREFIX}${code}`, [...values].sort().join(','));
    }
    if (state.priceMin !== null) params.set('price_min', String(state.priceMin));
    if (state.priceMax !== null) params.set('price_max', String(state.priceMax));
    if (!state.inStockOnly) params.set('in_stock', '0');
    if (state.sort !== 'recommended') params.set('sort', state.sort);
    // Commas are legal in a query value; keeping them unescaped keeps the address readable.
    const out = params.toString().replace(/%2C/gi, ',');
    return out ? `?${out}` : '';
};

export const toggleFacetValue = (state: FacetState, code: string, value: string): FacetState => {
    const current = state.filters[code] || [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value].sort();
    const filters = { ...state.filters };
    if (next.length) filters[code] = next;
    else delete filters[code];
    return { ...state, filters };
};

/** A price band picked or unpicked: the same band again clears it. */
export const togglePriceBand = (state: FacetState, from: number | null, to: number | null): FacetState =>
    state.priceMin === from && state.priceMax === to
        ? { ...state, priceMin: null, priceMax: null }
        : { ...state, priceMin: from, priceMax: to };

/** Everything a shopper picked is dropped; the search text and the sort stay. */
export const clearFacets = (state: FacetState): FacetState => ({
    ...state,
    filters: {},
    priceMin: null,
    priceMax: null,
    inStockOnly: true,
});

/** How many filters are on, for the badge on the mobile Filter button. */
export const activeFacetCount = (state: FacetState): number =>
    Object.values(state.filters).reduce((n, values) => n + values.length, 0) +
    (state.priceMin !== null || state.priceMax !== null ? 1 : 0) +
    (state.inStockOnly ? 0 : 1);

/** True when the address is a filtered or sorted view (canonical points at the bare listing). */
export const isFilteredView = (state: FacetState): boolean => activeFacetCount(state) > 0 || state.sort !== 'recommended';

/** The API call of a listing page. A price band's `from` is exclusive in the API response. */
export const facetStateToParams = (
    state: FacetState,
    extra: Pick<ProductListParams, 'collection' | 'page' | 'pageSize' | 'facets'>
): ProductListParams => ({
    ...extra,
    q: state.q || undefined,
    filters: state.filters,
    priceMin: state.priceMin,
    priceMax: state.priceMax,
    inStock: state.inStockOnly ? true : undefined,
    sort: state.sort,
});
