/**
 * The `collection` and `search` templates: header, child
 * collections, filter and sort bar (a sheet on a phone, a sidebar on a desktop), the product
 * grid with "Show more", the sold-out note, and the empty and error states. Filters, sort and
 * the search text live in the URL (state/facet-url.ts).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useRouter } from '@tanstack/react-router';
import { CaretDown, CaretRight, Faders, MagnifyingGlass, WhatsappLogo, X } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { Category, Facets, ProductCard, ProductSort } from '../api/types';
import { collectionHead, findCategory } from '../edge/commerce-edge';
import { sendCommerceEvent } from '../logic/events';
import { formatMoney } from '../logic/format';
import {
    SORTS,
    activeFacetCount,
    clearFacets,
    facetStateToParams,
    parseFacetState,
    serializeFacetState,
    toggleFacetValue,
    togglePriceBand,
    type FacetState,
} from '../state/facet-url';
import { withQuery } from '../routes';
import { listingFilterColumn, stickyListingToolbar } from '../config';
import { ShopHead, useEdgePage } from './Head';
import { EmptyState, ErrorState, GridSkeleton, Layer, isNotFound, useIsNarrow } from './primitives';
import { ProductGrid } from './ProductCard';
import { ReassuranceRows } from './Product';
import { menuCategories, useCategoryTree, useProductPages } from './queries';
import { useShopFlag } from './shop-flags';
import { ShopLink, useCommerceSite, useShopNavigate, whatsappLink } from './site';

/** The listing's state, read from and written to the address (replace, so Back leaves the listing). */
export const useFacetUrl = (): [FacetState, (next: FacetState) => void] => {
    const router = useRouter();
    const searchStr = useLocation({ select: (l) => l.searchStr || '' });
    const state = useMemo(() => parseFacetState(searchStr), [searchStr]);
    const setState = useCallback(
        (next: FacetState) => {
            const location = router.history.location;
            const search = serializeFacetState(next, location.search || '');
            if (search === (location.search || '')) return;
            router.history.replace(`${location.pathname}${search}${location.hash || ''}`);
        },
        [router]
    );
    return [state, setState];
};

const bandLabel = (t: ReturnType<typeof useCommerceSite>['t'], from: number | null, to: number | null, currency: string): string => {
    if (from === null && to !== null) return t('listing.priceUpTo', { to: formatMoney(to, currency) });
    if (to === null && from !== null) return t('listing.priceAbove', { from: formatMoney(from, currency) });
    return t('listing.priceBetween', { from: formatMoney(from, currency), to: formatMoney(to, currency) });
};

const FilterPanel: React.FC<{
    facets: Facets | null | undefined;
    state: FacetState;
    onChange(next: FacetState): void;
    currency: string;
}> = ({ facets, state, onChange, currency }) => {
    const { t } = useCommerceSite();
    const attributes = (facets?.attributes || []).filter((f) => f.values.length > 0);
    const bands = (facets?.price?.bands || []).filter((b) => b.count > 0 || (state.priceMin === b.from && state.priceMax === b.to));
    return (
        <div>
            <label className="cmx-check cmx-facet">
                <input
                    type="checkbox"
                    checked={state.inStockOnly}
                    onChange={(e) => onChange({ ...state, inStockOnly: e.target.checked })}
                />
                <span className="font-semibold">{t('listing.inStockOnly')}</span>
                {facets?.availability && <span className="cmx-check__count">{facets.availability.in_stock}</span>}
            </label>
            {bands.length > 0 && (
                <details className="cmx-facet" open>
                    <summary>
                        {t('listing.price')}
                        <CaretDown size={14} className="cmx-caret" aria-hidden="true" />
                    </summary>
                    <ul className="list-none p-0">
                        {bands.map((band) => {
                            const on = state.priceMin === band.from && state.priceMax === band.to;
                            return (
                                <li key={`${band.from}-${band.to}`}>
                                    <label className="cmx-check">
                                        <input type="checkbox" checked={on} onChange={() => onChange(togglePriceBand(state, band.from, band.to))} />
                                        <span>{bandLabel(t, band.from, band.to, currency)}</span>
                                        <span className="cmx-check__count">{band.count}</span>
                                    </label>
                                </li>
                            );
                        })}
                    </ul>
                </details>
            )}
            {attributes.map((facet) => {
                const picked = state.filters[facet.code] || [];
                const swatches = (facet.kind || '').toUpperCase() === 'SWATCH';
                const chips = (facet.kind || '').toUpperCase() === 'SIZE';
                return (
                    <details key={facet.code} className="cmx-facet" open={picked.length > 0 || attributes.length <= 4}>
                        <summary>
                            <span>
                                {facet.name || facet.code}
                                {picked.length > 0 && <span className="cmx-muted font-normal"> · {picked.length}</span>}
                            </span>
                            <CaretDown size={14} className="cmx-caret" aria-hidden="true" />
                        </summary>
                        {chips ? (
                            <ul className="cmx-pills pb-2">
                                {facet.values.map((value) => (
                                    <li key={value.code}>
                                        <button
                                            type="button"
                                            className="cmx-chip"
                                            aria-pressed={picked.includes(value.code)}
                                            disabled={value.count === 0 && !picked.includes(value.code)}
                                            onClick={() => onChange(toggleFacetValue(state, facet.code, value.code))}
                                        >
                                            {value.label || value.code}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <ul className="list-none p-0">
                                {facet.values.map((value) => (
                                    <li key={value.code}>
                                        <label className="cmx-check">
                                            <input
                                                type="checkbox"
                                                checked={picked.includes(value.code)}
                                                disabled={value.count === 0 && !picked.includes(value.code)}
                                                onChange={() => onChange(toggleFacetValue(state, facet.code, value.code))}
                                            />
                                            {swatches && value.swatch_hex && (
                                                <span
                                                    className="cmx-swatch"
                                                    aria-hidden="true"
                                                    // The seller's colour value, not a theme colour.
                                                    style={{ ['--cmx-swatch' as string]: value.swatch_hex }}
                                                />
                                            )}
                                            <span>{value.label || value.code}</span>
                                            <span className="cmx-check__count">{value.count}</span>
                                        </label>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </details>
                );
            })}
        </div>
    );
};

/** What is switched on, as removable pills above the grid. */
const ActivePills: React.FC<{ facets: Facets | null | undefined; state: FacetState; onChange(next: FacetState): void; currency: string }> = ({
    facets,
    state,
    onChange,
    currency,
}) => {
    const { t } = useCommerceSite();
    const pills: Array<{ key: string; label: string; remove(): void }> = [];
    for (const [code, values] of Object.entries(state.filters)) {
        const facet = (facets?.attributes || []).find((f) => f.code === code);
        for (const value of values) {
            const label = facet?.values.find((v) => v.code === value)?.label || value;
            pills.push({ key: `${code}:${value}`, label, remove: () => onChange(toggleFacetValue(state, code, value)) });
        }
    }
    if (state.priceMin !== null || state.priceMax !== null) {
        pills.push({
            key: 'price',
            label: bandLabel(t, state.priceMin, state.priceMax, currency),
            remove: () => onChange({ ...state, priceMin: null, priceMax: null }),
        });
    }
    if (pills.length === 0) return null;
    return (
        <ul className="cmx-pills">
            {pills.map((pill) => (
                <li key={pill.key}>
                    <button type="button" className="cmx-chip cmx-chip--on" onClick={pill.remove} aria-label={t('listing.remove', { label: pill.label })}>
                        {pill.label}
                        <X size={14} aria-hidden="true" />
                    </button>
                </li>
            ))}
            <li>
                <button type="button" className="cmx-btn cmx-btn--ghost cmx-small" onClick={() => onChange(clearFacets(state))}>
                    {t('listing.clearAll')}
                </button>
            </li>
        </ul>
    );
};

/** Filter bar, grid and paging of one listing; `collection` or the search text scope it. */
export const ListingView: React.FC<{
    collection?: string;
    /** Shown when the unfiltered listing has nothing. */
    empty: React.ReactNode;
    onTotal?(total: number, inStock: number | null): void;
    /** The first page of products, for the page's structured data. */
    onProducts?(products: readonly ProductCard[]): void;
    /** What the list is called in analytics ("c/sarees", "search") and, for a search, its text. */
    listId: string;
    listName?: string;
    searchTerm?: string;
    /** The name of the collection, for the WhatsApp question about a sold-out piece. */
    soldOutAbout?: string;
    /** The page's header line already says how many: the pinned bar does not repeat it on a phone. */
    countInHeader?: boolean;
}> = ({ collection, empty, onTotal, onProducts, listId, listName, searchTerm, soldOutAbout, countInHeader = false }) => {
    const { t, config } = useCommerceSite();
    const [state, setState] = useFacetUrl();
    const narrow = useIsNarrow();
    // templates.collection.stickyToolbar: Filter·Sort is one row pinned under the header.
    const sticky = stickyListingToolbar(config);
    const [sheetOpen, setSheetOpen] = useState(false);
    const params = useMemo(
        () => facetStateToParams(state, { collection, pageSize: config.pageSize, facets: true }),
        [state, collection, config.pageSize]
    );
    const query = useProductPages(params);
    const pages = query.data?.pages || [];
    const first = pages[0];
    const products = pages.flatMap((page) => page.data || []);
    const total = first?.total ?? 0;
    const facets = first?.facets;
    const currency = products[0]?.price?.currency || 'INR';
    const active = activeFacetCount(state);
    const hasFilters = !!facets && ((facets.attributes || []).length > 0 || (facets.price?.bands || []).length > 0);
    // Whether this shop's listings have filters, as this device last saw (a shop without price bands
    // or filterable attributes has none, on every listing).
    const knownFilters = useShopFlag('filters', first ? hasFilters : undefined);
    const inStock = facets?.availability?.in_stock ?? null;
    const soldOut = facets?.availability?.out_of_stock ?? 0;

    useEffect(() => {
        if (first) onTotal?.(first.total, inStock);
    }, [first, inStock, onTotal]);
    useEffect(() => {
        if (first && !query.isPlaceholderData) onProducts?.(first.data || []);
    }, [first, query.isPlaceholderData, onProducts]);

    // One list view per answer the shopper actually sees (a new filter is a new list), and for
    // a search its result count: zero is the query the seller wants to know about.
    const reported = useRef<unknown>(null);
    useEffect(() => {
        if (!first || query.isPlaceholderData || reported.current === first) return;
        reported.current = first;
        if (searchTerm) sendCommerceEvent({ name: 'view_search_results', term: searchTerm, results: first.total ?? 0 });
        const items = (first.data || []).map((p, index) => ({ id: p.id, name: p.name, unitPrice: p.price?.amount, qtyScale: p.qty_scale, index }));
        if (items.length > 0) sendCommerceEvent({ name: 'view_item_list', listId, listName, items });
    }, [first, query.isPlaceholderData, listId, listName, searchTerm]);

    if (query.isError && !first) {
        return isNotFound(query.error) ? (
            <EmptyState title={t('listing.notFound.title')} body={t('listing.notFound.body')}>
                <ShopLink to="" className="cmx-btn cmx-btn--primary">
                    {t('product.browse')}
                </ShopLink>
            </EmptyState>
        ) : (
            // A failed FILTERED request must not strand the shopper: the filters that led
            // here can be taken off again without the filter panel.
            <div className="flex flex-col items-center gap-3">
                <ErrorState error={query.error} onRetry={() => void query.refetch()} />
                {active > 0 && (
                    <button type="button" className="cmx-btn cmx-btn--outline" onClick={() => setState(clearFacets(state))}>
                        {t('listing.clearAll')}
                    </button>
                )}
            </div>
        );
    }
    const soldOutWhatsapp = soldOutAbout ? whatsappLink(config.whatsappNumber, t('listing.soldOutWhatsappText', { name: soldOutAbout })) : '';

    const panel = <FilterPanel facets={facets} state={state} onChange={setState} currency={currency} />;
    const loading = query.isPending;
    const refreshing = query.isPlaceholderData;
    // On a desktop the filter column of a shop known to have filters is there from the first paint
    // (a skeleton until the first page answers), so the grid does not jump sideways when the
    // filters arrive. A shop without filters, or one not seen yet on this device, holds no column.
    // A site can say it outright (templates.collection.filterColumn), which also covers the first visit.
    const configured = listingFilterColumn(config);
    const sidebar = hasFilters || (loading && (configured ?? knownFilters) === true);

    return (
        <div className={cn('cmx-listing', sidebar && 'cmx-listing--sidebar')}>
            {sidebar && !narrow && (
                <aside aria-label={t('listing.filters')} className="hidden lg:block" aria-busy={loading || undefined}>
                    <h2 className="cmx-h3 mb-2">{t('listing.filters')}</h2>
                    {hasFilters ? (
                        panel
                    ) : (
                        <div className="flex flex-col gap-3 pt-3" aria-hidden="true">
                            {Array.from({ length: 4 }, (_, i) => (
                                <div key={i} className="cmx-skel h-6 w-3/4" />
                            ))}
                        </div>
                    )}
                </aside>
            )}
            <div className="flex min-w-0 flex-col gap-4">
                <div className={cn('cmx-toolbar', sticky && 'cmx-toolbar--sticky', sticky && countInHeader && 'cmx-toolbar--nocount')}>
                    {/* With the pinned bar the count is said once, in the page's header line; it stays a live region. */}
                    <p className="cmx-small cmx-muted cmx-toolbar__count" role="status" aria-live="polite">
                        {loading ? t('common.loading') : t('search.count', { count: total })}
                    </p>
                    <div className="cmx-toolbar__actions flex items-center gap-2">
                        {hasFilters && (
                            <button
                                type="button"
                                className="cmx-btn cmx-btn--outline cmx-small cmx-toolbar__filter lg:hidden"
                                onClick={() => setSheetOpen(true)}
                                aria-haspopup="dialog"
                                aria-label={active > 0 ? t('listing.filtersActive', { count: active }) : t('listing.filters')}
                            >
                                <Faders size={18} aria-hidden="true" />
                                {t('listing.filters')}
                                {active > 0 && <span className="cmx-badge">{active}</span>}
                            </button>
                        )}
                        <label className="cmx-toolbar__sort flex items-center gap-2">
                            <span className="cmx-sr">{t('listing.sort')}</span>
                            <select
                                className="cmx-select"
                                value={state.sort}
                                onChange={(e) => setState({ ...state, sort: e.target.value as ProductSort })}
                            >
                                {SORTS.map((sort) => (
                                    <option key={sort} value={sort}>
                                        {t(`listing.sort.${sort}`)}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                </div>
                <ActivePills facets={facets} state={state} onChange={setState} currency={currency} />
                {loading ? (
                    <GridSkeleton count={8} className={sidebar ? 'cmx-grid--with-sidebar' : undefined} />
                ) : products.length === 0 ? (
                    active > 0 ? (
                        <EmptyState title={t('listing.emptyFiltered.title')} body={t('listing.emptyFiltered.body')}>
                            <button type="button" className="cmx-btn cmx-btn--outline" onClick={() => setState(clearFacets(state))}>
                                {t('listing.clearAll')}
                            </button>
                        </EmptyState>
                    ) : (
                        empty
                    )
                ) : (
                    <div aria-busy={refreshing} className={cn(refreshing && 'opacity-60 transition-opacity')}>
                        {/* Two cards are above the fold on a phone; the rest load as they come near. */}
                        <ProductGrid products={products} className={hasFilters ? 'cmx-grid--with-sidebar' : undefined} eagerCount={2} listId={listId} listName={listName} />
                    </div>
                )}
                {products.length > 0 && (
                    <div className="flex flex-col items-center gap-3 pt-4">
                        <p className="cmx-small cmx-muted">{t('listing.shown', { shown: products.length, total })}</p>
                        {query.hasNextPage && (
                            <button
                                type="button"
                                className="cmx-btn cmx-btn--outline"
                                onClick={() => void query.fetchNextPage()}
                                disabled={query.isFetchingNextPage}
                            >
                                {query.isFetchingNextPage ? t('common.loading') : t('listing.loadMore')}
                            </button>
                        )}
                        {query.isFetchNextPageError && <ErrorState compact error={query.error} onRetry={() => void query.fetchNextPage()} />}
                    </div>
                )}
                {state.inStockOnly && soldOut > 0 && !loading && (
                    <div className="cmx-note flex-wrap items-center justify-between">
                        <span>{t('listing.soldOut', { count: soldOut })}</span>
                        <span className="flex flex-wrap items-center gap-x-4">
                            <button type="button" className="cmx-link" onClick={() => setState({ ...state, inStockOnly: false })}>
                                {t('listing.showSoldOut')}
                            </button>
                            {soldOutWhatsapp && (
                                <a href={soldOutWhatsapp} target="_blank" rel="noopener noreferrer" className="cmx-link cmx-tap inline-flex items-center gap-1">
                                    <WhatsappLogo size={16} aria-hidden="true" />
                                    {t('listing.soldOutAsk')}
                                </a>
                            )}
                        </span>
                    </div>
                )}
            </div>
            {hasFilters && (
                <Layer
                    open={sheetOpen && narrow}
                    onClose={() => setSheetOpen(false)}
                    side="bottom"
                    title={t('listing.filters')}
                    footer={
                        <div className="flex gap-3">
                            <button type="button" className="cmx-btn cmx-btn--outline" onClick={() => setState(clearFacets(state))} disabled={active === 0}>
                                {t('listing.clearAll')}
                            </button>
                            <button type="button" className="cmx-btn cmx-btn--primary flex-1" onClick={() => setSheetOpen(false)}>
                                {t('listing.apply', { count: total })}
                            </button>
                        </div>
                    }
                >
                    <div className="cmx-layer__body">{panel}</div>
                </Layer>
            )}
        </div>
    );
};

const Breadcrumb: React.FC<{ parents: Category[]; current: string }> = ({ parents, current }) => {
    const { t } = useCommerceSite();
    return (
        <nav aria-label={t('nav.breadcrumb')} className="cmx-small cmx-muted">
            <ol className="flex flex-wrap items-center gap-1">
                <li>
                    <ShopLink to="" className="cmx-tap inline-flex min-w-11 items-center hover:underline">
                        {t('nav.home')}
                    </ShopLink>
                </li>
                {parents.map((parent) => (
                    <li key={parent.slug} className="flex items-center gap-1">
                        <CaretRight size={10} aria-hidden="true" />
                        <ShopLink to={`c/${parent.slug}`} className="cmx-tap inline-flex min-w-11 items-center hover:underline">
                            {parent.name || parent.slug}
                        </ShopLink>
                    </li>
                ))}
                <li className="flex items-center gap-1" aria-current="page">
                    <CaretRight size={10} aria-hidden="true" />
                    <span>{current}</span>
                </li>
            </ol>
        </nav>
    );
};

export const CollectionTemplate: React.FC<{ slug: string; sections: readonly string[] }> = ({ slug, sections }) => {
    const { t, siteT, config, absoluteUrl } = useCommerceSite();
    const tree = useCategoryTree();
    const found = useMemo(() => findCategory(tree.data?.data, slug), [tree.data, slug]);
    const [counts, setCounts] = useState<{ total: number; inStock: number | null } | null>(null);
    const [expanded, setExpanded] = useState(false);
    const onTotal = useCallback((total: number, inStock: number | null) => setCounts({ total, inStock }), []);
    const [listed, setListed] = useState<readonly ProductCard[]>([]);
    const edgePage = useEdgePage(`c/${slug}`, found?.node.image_url || '');
    // The same head the edge writes: canonical on the bare listing, hreflang, BreadcrumbList, ItemList.
    const head = useMemo(() => (found ? collectionHead(edgePage, found, listed) : null), [edgePage, found, listed]);
    const name = found?.node.name || '';
    const description = found?.node.description || '';
    const children = (found?.node.children || []).filter((c) => c.product_count > 0).sort((a, b) => a.position - b.position);
    const others = useMemo(() => menuCategories(tree.data?.data, config.minInStock).filter((c) => c.slug !== slug).slice(0, 6), [tree.data, config.minInStock, slug]);
    const has = (section: string) => sections.includes(section);
    const promise = siteT(config.dispatchPromise);
    return (
        <div className="cmx-shell cmx-section flex flex-col gap-6">
            {/* Until the tree has answered the document keeps the title the edge wrote. */}
            {(found || !tree.isLoading) && (
                <ShopHead
                    title={name || t('nav.categories')}
                    description={description || undefined}
                    // A filtered or sorted view points at the bare listing.
                    canonical={absoluteUrl(`c/${slug}`)}
                    head={head}
                />
            )}
            {/* An unknown collection has no header: the listing below says it is not available. */}
            {has('header') && (tree.isLoading || found) && (
                <header className="flex flex-col gap-2">
                    {found ? (
                        <Breadcrumb parents={found.parents} current={name} />
                    ) : (
                        // As tall as the breadcrumb's 44px links, so the page does not move when it arrives.
                        <div className="flex min-h-11 items-center" aria-hidden="true">
                            <div className="cmx-skel h-4 w-40" />
                        </div>
                    )}
                    {/* As tall as the H1's line (34px, 44px from 1024px), so the listing below does not move when the name arrives. */}
                    {tree.isLoading ? <div className="cmx-skel h-9 w-2/3 lg:h-11" aria-hidden="true" /> : <h1 className="cmx-h1">{name || slug}</h1>}
                    <p className="cmx-small cmx-muted">
                        {counts && counts.inStock !== null ? t('listing.inStockCount', { count: counts.inStock }) : '\u00a0'}
                        {promise && counts ? ` · ${promise}` : ''}
                    </p>
                    {description && (
                        <div>
                            <p className={cn('cmx-body max-w-prose', !expanded && 'cmx-clamp')}>{description}</p>
                            {description.length > 160 && (
                                <button type="button" className="cmx-link cmx-small" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
                                    {expanded ? t('listing.readLess') : t('listing.readMore')}
                                </button>
                            )}
                        </div>
                    )}
                </header>
            )}
            {has('subCollections') && children.length > 0 && (
                <nav aria-label={t('listing.subCollections')}>
                    <ul className="cmx-scroll-x">
                        {children.map((child) => (
                            <li key={child.slug}>
                                <ShopLink to={`c/${child.slug}`} className="cmx-chip">
                                    {child.name || child.slug}
                                    <span className="cmx-muted cmx-small">{child.in_stock_count}</span>
                                </ShopLink>
                            </li>
                        ))}
                    </ul>
                </nav>
            )}
            {has('grid') && (
                <ListingView
                    collection={slug}
                    countInHeader={has('header')}
                    onTotal={onTotal}
                    onProducts={setListed}
                    listId={`c/${slug}`}
                    listName={name || slug}
                    soldOutAbout={name || slug}
                    empty={
                        <EmptyState title={t('listing.empty.title')} body={t('listing.empty.body')}>
                            <ul className="cmx-pills justify-center">
                                {others.map((c) => (
                                    <li key={c.slug}>
                                        <ShopLink to={`c/${c.slug}`} className="cmx-chip">
                                            {c.name || c.slug}
                                        </ShopLink>
                                    </li>
                                ))}
                            </ul>
                        </EmptyState>
                    }
                />
            )}
            {/* The promises a shopper wants before buying, at the foot of every listing. */}
            {has('trustStrip') && config.reassurance.length > 0 && <ReassuranceRows items={config.reassurance.slice(0, 4)} variant="strip" />}
        </div>
    );
};

export const SearchTemplate: React.FC<{ sections: readonly string[] }> = ({ sections }) => {
    const { t, config } = useCommerceSite();
    const [state] = useFacetUrl();
    const sticky = stickyListingToolbar(config);
    const [found, setFound] = useState<number | null>(null);
    const onTotal = useCallback((total: number) => setFound(total), []);
    const navigate = useShopNavigate();
    const tree = useCategoryTree();
    const [text, setText] = useState(state.q);
    useEffect(() => setText(state.q), [state.q]);
    const categories = useMemo(() => menuCategories(tree.data?.data, config.minInStock).slice(0, 8), [tree.data, config.minInStock]);
    const whatsapp = whatsappLink(config.whatsappNumber, t('search.whatsappText', { q: state.q }));
    useEffect(() => {
        if (state.q) sendCommerceEvent({ name: 'search', term: state.q });
    }, [state.q]);
    return (
        <div className="cmx-shell cmx-section flex flex-col gap-6">
            <ShopHead title={state.q ? t('search.resultsFor', { q: state.q }) : t('search.title')} noindex />
            {sections.includes('header') && (
                <header className="flex flex-col gap-4">
                    <h1 className="cmx-h1">{state.q ? t('search.resultsFor', { q: state.q }) : t('search.title')}</h1>
                    {/* With the pinned Filter·Sort bar the count lives here, said once. */}
                    {sticky && <p className="cmx-small cmx-muted m-0">{found !== null ? t('search.count', { count: found }) : '\u00a0'}</p>}
                    <form
                        role="search"
                        className="flex max-w-xl gap-2"
                        onSubmit={(event) => {
                            event.preventDefault();
                            void navigate(withQuery('search', { q: text.trim() || null }));
                        }}
                    >
                        <label className="cmx-search__field">
                            <MagnifyingGlass size={20} aria-hidden="true" className="shrink-0" />
                            <span className="cmx-sr">{t('search.label')}</span>
                            <input
                                className="cmx-search__input"
                                type="search"
                                enterKeyHint="search"
                                maxLength={120}
                                value={text}
                                onChange={(e) => setText(e.target.value)}
                                placeholder={t('search.placeholder')}
                            />
                        </label>
                        <button type="submit" className="cmx-btn cmx-btn--primary">
                            {t('search.submit')}
                        </button>
                    </form>
                </header>
            )}
            {sections.includes('grid') && (
                <ListingView
                    listId="search"
                    countInHeader={sections.includes('header')}
                    onTotal={sticky ? onTotal : undefined}
                    searchTerm={state.q || undefined}
                    empty={
                        <EmptyState
                            title={state.q ? t('search.none.title', { q: state.q }) : t('listing.empty.title')}
                            body={state.q ? t('search.none.body') : undefined}
                        >
                            <ul className="cmx-pills justify-center">
                                {categories.map((c) => (
                                    <li key={c.slug}>
                                        <ShopLink to={`c/${c.slug}`} className="cmx-chip">
                                            {c.name || c.slug}
                                        </ShopLink>
                                    </li>
                                ))}
                            </ul>
                            {whatsapp && state.q && (
                                <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="cmx-btn cmx-btn--outline">
                                    <WhatsappLogo size={18} aria-hidden="true" />
                                    {t('search.askWhatsapp')}
                                </a>
                            )}
                        </EmptyState>
                    }
                />
            )}
        </div>
    );
};
