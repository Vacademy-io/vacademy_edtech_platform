/**
 * The head of a shop page once the app is running. The edge writes title, description,
 * canonical, hreflang, Open Graph and JSON-LD into the document of the page a visitor lands
 * on (edge/commerce-edge.ts); those tags stay for as long as that page is on screen, so a
 * crawler that runs the app still finds them. When the visitor moves to another shop page the
 * edge's tags are removed and the SAME pure builders (productHead, collectionHead) write the
 * new page's tags from the data the page loaded.
 */
import React, { useEffect, useMemo } from 'react';
import { Helmet } from 'react-helmet';
import { RouteMatcher } from '../../../-services/route-matcher';
import { SEED_ELEMENT_ID, type EdgeHead, type EdgePageInput, type EdgeSeed } from '../edge/commerce-edge';
import { useCommerceSite } from './site';

const EDGE_SELECTOR = '[data-commerce-edge]';
const APP_ATTR = 'data-commerce-app';

/**
 * The address the edge's tags describe: the page the document was served for. Null once they
 * are gone (or when the edge wrote none: a dev server, an edge fault, a search or cart page).
 */
let edgePage: string | null | undefined;

const pageKey = (): string => `${window.location.pathname.replace(/\/+$/, '')}|${new URLSearchParams(window.location.search).get('lang') || ''}`;

/** True while the tags the edge wrote are in the document and still describe `key`. */
export const edgeOwnsHead = (key: string): boolean => {
    if (typeof document === 'undefined') return false;
    if (edgePage === undefined) edgePage = document.head.querySelector(EDGE_SELECTOR) ? pageKey() : null;
    if (edgePage === null) return false;
    if (edgePage === key) return true;
    // Another page (or the other language of this one): the edge's tags are stale from here on.
    document.head.querySelectorAll(EDGE_SELECTOR).forEach((node) => node.remove());
    edgePage = null;
    return false;
};

/** For tests: forget what the document looked like at load. */
export const resetEdgeHead = (): void => {
    edgePage = undefined;
};

/** Parses the builders' tag strings into nodes. A template never runs scripts or loads anything. */
const nodesOf = (tags: readonly string[]): Element[] => {
    const template = document.createElement('template');
    template.innerHTML = tags.join('');
    return Array.from(template.content.children);
};

/**
 * title, description, canonical and robots of a shop page; with `head`, also the page's
 * hreflang pairs, Open Graph tags and JSON-LD.
 */
export const ShopHead: React.FC<{
    title: string;
    description?: string;
    canonical?: string;
    noindex?: boolean;
    /** The full head of a product or collection page, from the pure edge builders. */
    head?: EdgeHead | null;
}> = ({ title, description, canonical, noindex, head }) => {
    const { locale, siteName } = useCommerceSite();
    const tags = head?.tags;
    const signature = tags ? tags.join('\n') : '';
    useEffect(() => {
        if (typeof document === 'undefined') return;
        const key = pageKey();
        // The landing page keeps the edge's tags: same content, already in the document.
        if (edgeOwnsHead(key) || !tags || tags.length === 0) return;
        const nodes = nodesOf(tags);
        for (const node of nodes) {
            node.removeAttribute('data-commerce-edge');
            node.setAttribute(APP_ATTR, '1');
            document.head.appendChild(node);
        }
        return () => nodes.forEach((node) => node.remove());
        // `signature` stands for `tags`: the same strings give the same nodes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signature]);
    const fullTitle = head?.title || (siteName && !title.includes(siteName) ? `${title} | ${siteName}` : title);
    const metaDescription = head?.description || description;
    // With a full head the canonical is among its tags (or the edge's).
    const ownCanonical = !tags || tags.length === 0 ? canonical : undefined;
    return (
        <Helmet htmlAttributes={{ lang: head?.lang || locale }}>
            <title>{fullTitle}</title>
            {metaDescription && <meta name="description" content={metaDescription} />}
            {ownCanonical && <link rel="canonical" href={ownCanonical} />}
            {noindex && <meta name="robots" content="noindex" />}
        </Helmet>
    );
};

/**
 * What the edge builders need to know about the page on screen, from the site context: the
 * same input the middleware gives them, so both write the same tags.
 */
export const useEdgePage = (to: string, ogImage = ''): EdgePageInput => {
    const { tagName, config, locale, baseLocale, locales, siteName } = useCommerceSite();
    const leadTag = config.media.leadTag;
    return useMemo(
        () => ({
            origin: typeof window === 'undefined' ? '' : window.location.origin,
            pathname: RouteMatcher.pagePath(tagName, to),
            basePath: RouteMatcher.basePath(tagName),
            // Fonts stay empty: the app loads its own stylesheet (useCommerceFonts).
            shop: { publishableKey: '', baseLocale, locales, leadTag, fonts: [], redirects: false },
            locale,
            siteName,
            ogImage,
        }),
        [tagName, to, baseLocale, locales, leadTag, locale, siteName, ogImage]
    );
};

/* ── page data the edge handed over ───────────────────────────────── */

let seed: Partial<EdgeSeed> | null | undefined;

/**
 * The product the edge already fetched for this document: the page starts from it instead of
 * asking again. Ignored when it is for another product or language (the visitor's remembered
 * language can differ from the address the edge saw).
 */
export const productSeed = (slug: string, locale: string): EdgeSeed['data'] | undefined => {
    if (!slug || typeof document === 'undefined') return undefined;
    if (seed === undefined) {
        seed = null;
        try {
            const node = document.getElementById(SEED_ELEMENT_ID);
            if (node) {
                seed = JSON.parse(node.textContent || 'null') as Partial<EdgeSeed> | null;
                node.remove();
            }
        } catch {
            seed = null;
        }
    }
    if (!seed || seed.kind !== 'product' || seed.slug !== slug || seed.locale !== locale) return undefined;
    return seed.data && seed.data.slug === slug ? seed.data : undefined;
};

/** When the document (and so the seed) was produced, as a clock time. */
export const seedTime = (): number =>
    typeof performance !== 'undefined' && typeof performance.timeOrigin === 'number' ? Math.round(performance.timeOrigin) : Date.now();

/** For tests. */
export const resetProductSeed = (): void => {
    seed = undefined;
};
