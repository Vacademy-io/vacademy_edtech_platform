/**
 * Data hooks of the shop. Catalogue reads are kept for 60 seconds, the lifetime the API gives
 * them (Cache-Control: max-age=60), so moving between pages inside that window asks nothing
 * twice; the cart price is never kept.
 */
import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { COMMERCE_STALE_MS } from '../api/client';
import type { Category, ProductListParams } from '../api/types';
import { priceRequestKey, toPriceRequest } from '../state/cart-logic';
import { useCommerceCart } from '../state/cart-store';
import { productSeed, seedTime } from './Head';
import { shouldRetry } from './primitives';
import { useCommercePage, useCommerceSite } from './site';

const base = { staleTime: COMMERCE_STALE_MS, gcTime: 5 * 60_000, retry: shouldRetry, refetchOnWindowFocus: false } as const;

/** The whole collection tree (categories and collections), once per language. */
export const useCategoryTree = (enabled = true) => {
    const { client, instituteId, locale } = useCommerceSite();
    return useQuery({
        ...base,
        queryKey: ['commerce', instituteId, locale, 'categories'],
        queryFn: ({ signal }) => client.getCategories(undefined, signal),
        enabled,
    });
};

/** Menu entries: top-level categories with enough in stock, children filtered the same way. */
export const menuCategories = (tree: readonly Category[] | undefined, minInStock: number): Category[] => {
    const keep = (node: Category) => node.in_stock_count >= Math.max(1, minInStock);
    return (tree || [])
        .filter((node) => (node.kind || 'CATEGORY').toUpperCase() === 'CATEGORY' && keep(node))
        .sort((a, b) => a.position - b.position)
        .map((node) => ({ ...node, children: (node.children || []).filter(keep).sort((a, b) => a.position - b.position) }));
};

export const useProduct = (slug: string) => {
    const { client, instituteId, locale } = useCommerceSite();
    return useQuery({
        ...base,
        queryKey: ['commerce', instituteId, locale, 'product', slug],
        queryFn: ({ signal }) => client.getProduct(slug, signal),
        enabled: !!slug,
        // The product the edge already fetched for this document (at most as old as the
        // document); it goes stale and is refreshed like any other read.
        initialData: () => productSeed(slug, locale),
        initialDataUpdatedAt: seedTime,
    });
};

/** The Product of the page on screen (page data context); disabled on any other page. */
export const usePageProduct = () => {
    const page = useCommercePage();
    return useProduct(page?.kind === 'product' ? page.slug : '');
};

/** A listing, page after page ("Show more"). The first page carries the facets. */
export const useProductPages = (params: ProductListParams, enabled = true) => {
    const { client, instituteId, locale } = useCommerceSite();
    return useInfiniteQuery({
        ...base,
        queryKey: ['commerce', instituteId, locale, 'products', params],
        queryFn: ({ pageParam, signal }) => client.listProducts({ ...params, page: pageParam }, signal),
        initialPageParam: 1,
        getNextPageParam: (last) => (last.has_more ? last.page + 1 : undefined),
        placeholderData: keepPreviousData,
        enabled,
    });
};

/** One page of products, for rails. */
export const useProductRail = (params: ProductListParams, enabled = true) => {
    const { client, instituteId, locale } = useCommerceSite();
    return useQuery({
        ...base,
        queryKey: ['commerce', instituteId, locale, 'rail', params],
        queryFn: ({ signal }) => client.listProducts(params, signal),
        enabled,
    });
};

/** A value that follows `value` after it has been still for `ms`. */
export const useDebounced = <T>(value: T, ms: number): T => {
    const [settled, setSettled] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setSettled(value), ms);
        return () => clearTimeout(timer);
    }, [value, ms]);
    return settled;
};

/** Search suggestions: after 2 characters, 200 ms after the last keystroke. */
export const useSuggestions = (text: string) => {
    const { client, instituteId, locale } = useCommerceSite();
    const q = useDebounced(text.trim(), 200);
    return useQuery({
        ...base,
        queryKey: ['commerce', instituteId, locale, 'suggest', q],
        queryFn: ({ signal }) => client.suggest(q, signal),
        enabled: q.length >= 2,
        placeholderData: keepPreviousData,
    });
};

/**
 * The server's price of the cart on screen: asked again on every change (a short pause after
 * the last one), never cached, and the answer is folded back into the remembered lines. Only
 * while something shows it (`active`), so a page with a closed drawer makes no calls.
 */
export const useCartPrice = (active: boolean) => {
    const { client, instituteId, locale } = useCommerceSite();
    const cart = useCommerceCart((s) => s.cart);
    const applyPrice = useCommerceCart((s) => s.applyPrice);
    const liveKey = useMemo(() => priceRequestKey(cart, locale), [cart, locale]);
    const key = useDebounced(liveKey, 250);
    const query = useQuery({
        queryKey: ['commerce', instituteId, 'cart-price', key],
        // The cart is read when the call starts: `key` only says when to ask again.
        queryFn: ({ signal }) => client.priceCart(toPriceRequest(useCommerceCart.getState().cart), signal),
        enabled: active && cart.lines.length > 0,
        staleTime: 0,
        gcTime: 0,
        retry: shouldRetry,
        refetchOnWindowFocus: true,
        placeholderData: keepPreviousData,
    });
    const { data } = query;
    useEffect(() => {
        if (data) applyPrice(data);
    }, [data, applyPrice]);
    return {
        price: cart.lines.length > 0 ? data : undefined,
        /** The numbers on screen are for an older cart. */
        pending: active && cart.lines.length > 0 && (query.isFetching || key !== liveKey),
        error: query.error,
        refetch: query.refetch,
    };
};
