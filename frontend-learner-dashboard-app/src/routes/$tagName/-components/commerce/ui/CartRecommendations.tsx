/**
 * "You may also like" under a cart that has something in it: on the cart page and in the cart
 * drawer, when the site switches it on (globalSettings.commerce.cart.recommendations). Products
 * come from the public listing call the shop already makes (no endpoint of its own); what is
 * already in the cart and what cannot be bought now are left out.
 *
 * Quick add here puts the product in the cart where the shopper is: no drawer opens, the card
 * says "In your cart", and the row keeps its place on screen while the cart above it grows.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CartRecommendations as Settings } from '../config';
import { findCategory } from '../edge/commerce-edge';
import { stockView } from '../logic/stock';
import { useCommerceCart } from '../state/cart-store';
import { CardAddContext, type CardAddMode } from './card-add';
import { ProductRail } from './ProductCard';
import { useCategoryTree, useProduct, useProductRail } from './queries';
import { useCommerceSite } from './site';

/** The nearest ancestor that scrolls (the drawer's body), or null for the page itself. */
const scrollParentOf = (el: HTMLElement): HTMLElement | null => {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
        const { overflowY } = window.getComputedStyle(node);
        if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
    }
    return null;
};

/** How long after an add the row is held in place while the cart above it settles (price, notes). */
const HOLD_MS = 1500;

/**
 * Keeps an element where it is on screen across the redraws that follow an add: the new cart
 * line and the "added" note above it would otherwise push it down under the shopper's finger.
 * Stops at once when the shopper scrolls on their own.
 */
const useHoldInPlace = (ref: React.RefObject<HTMLElement | null>) => {
    const held = useRef<{ top: number; until: number } | null>(null);
    const frame = useRef(0);

    const correct = useCallback(() => {
        const el = ref.current;
        const hold = held.current;
        if (!el || !hold) return;
        const delta = el.getBoundingClientRect().top - hold.top;
        if (Math.abs(delta) < 1) return;
        const scroller = scrollParentOf(el);
        if (scroller) scroller.scrollTop += delta;
        else window.scrollBy(0, delta);
    }, [ref]);

    const release = useCallback(() => {
        held.current = null;
        if (frame.current) cancelAnimationFrame(frame.current);
        frame.current = 0;
    }, []);

    const hold = useCallback(() => {
        const el = ref.current;
        if (!el) return;
        held.current = { top: el.getBoundingClientRect().top, until: Date.now() + HOLD_MS };
        const tick = () => {
            if (!held.current || Date.now() > held.current.until) {
                release();
                return;
            }
            correct();
            frame.current = requestAnimationFrame(tick);
        };
        if (frame.current) cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(tick);
    }, [ref, correct, release]);

    useEffect(() => {
        // The shopper's own scrolling wins.
        const stop = () => release();
        window.addEventListener('wheel', stop, { passive: true });
        window.addEventListener('touchmove', stop, { passive: true });
        window.addEventListener('keydown', stop);
        return () => {
            release();
            window.removeEventListener('wheel', stop);
            window.removeEventListener('touchmove', stop);
            window.removeEventListener('keydown', stop);
        };
    }, [release]);

    return { hold, correct };
};

const RecsRow: React.FC<{ settings: Settings; variant: 'page' | 'drawer'; onNavigate?: () => void }> = ({ settings, variant, onNavigate }) => {
    const { t, siteT } = useCommerceSite();
    const lines = useCommerceCart((s) => s.cart.lines);
    const lastAdded = useCommerceCart((s) => s.lastAdded);
    const { source } = settings;

    // same-category follows the product added last, chosen once: adding from this row must not
    // swap the row under the shopper's finger.
    const [anchorSlug] = useState(() => {
        if (source.kind !== 'same-category') return '';
        const line = lines.find((l) => l.variantId === lastAdded) || lines[lines.length - 1];
        return line?.slug || '';
    });
    const anchor = useProduct(anchorSlug);
    const tree = useCategoryTree(source.kind === 'bestsellers');

    let collection: string | undefined;
    let ready = true;
    if (source.kind === 'collection') {
        collection = source.slug;
    } else if (source.kind === 'bestsellers') {
        ready = !tree.isPending;
        // The shop's hand-kept collection; without one, the shop's own recommended order.
        collection = findCategory(tree.data?.data, 'bestsellers') ? 'bestsellers' : undefined;
    } else if (source.kind === 'same-category') {
        ready = !anchorSlug || !anchor.isPending;
        collection = (anchor.data?.collections || []).find((c) => (c.kind || '').toUpperCase() === 'CATEGORY')?.slug || undefined;
    }

    // A few spare cards make up for the ones already in the cart. Fixed when the row first shows:
    // a later add must not ask again (the row would blink back to its skeleton).
    const [pageSize] = useState(() => Math.min(24, settings.limit + Math.min(lines.length, 12)));
    const query = useProductRail(
        { collection, sort: 'recommended', inStock: true, priceMax: settings.maxPrice ?? undefined, pageSize },
        ready && lines.length > 0
    );

    // Products added from this row stay in it (now "In your cart"), so nothing jumps sideways.
    const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set());
    const [said, setSaid] = useState('');
    const inCart = useMemo(() => new Set(lines.map((l) => l.slug)), [lines]);
    const products = useMemo(
        () =>
            (query.data?.data || [])
                .filter((p) => stockView(p.stock).purchasable && (!inCart.has(p.slug) || kept.has(p.id)))
                .slice(0, settings.limit),
        [query.data, inCart, kept, settings.limit]
    );

    const box = useRef<HTMLElement>(null);
    const { hold, correct } = useHoldInPlace(box);
    // The redraw right after an add: put the row back before the browser paints it.
    useLayoutEffect(() => {
        correct();
    }, [lines, correct]);

    const mode = useMemo<CardAddMode>(
        () => ({
            onAdded: (id) => {
                hold();
                setKept((prev) => new Set(prev).add(id));
                const name = (query.data?.data || []).find((p) => p.id === id)?.name;
                if (name) setSaid(t('cart.recs.added', { name }));
            },
        }),
        [hold, query.data, t]
    );

    const title = siteT(settings.title) || t('cart.recs.title');
    const drawer = variant === 'drawer';
    if (query.isError || (ready && !query.isPending && products.length === 0)) return null;
    const loading = !ready || query.isPending;
    return (
        <section
            ref={box}
            className={drawer ? 'cmx-recs cmx-recs--drawer' : 'cmx-recs cmx-section'}
            aria-labelledby={`cmx-recs-${variant}`}
            // In the drawer, a tap on a product (or on "details" in its options sheet) leaves the cart: close it.
            onClickCapture={(event) => {
                if (onNavigate && (event.target as Element | null)?.closest?.('a[href]')) onNavigate();
            }}
        >
            <div className="cmx-head">
                <h2 className={drawer ? 'cmx-h3' : 'cmx-h2'} id={`cmx-recs-${variant}`}>
                    {title}
                </h2>
            </div>
            {loading ? (
                <ul className="cmx-rail" aria-hidden="true">
                    {Array.from({ length: Math.min(settings.limit, 4) }, (_, i) => (
                        <li key={i} className="cmx-card">
                            <div className="cmx-img cmx-skel" />
                            <div className="cmx-card__body">
                                <div className="cmx-skel h-4 w-11/12" />
                                <div className="cmx-skel h-5 w-1/3" />
                                <div className="cmx-skel cmx-card__quick h-11 w-full" />
                            </div>
                        </li>
                    ))}
                </ul>
            ) : (
                <CardAddContext.Provider value={mode}>
                    <ProductRail products={products} columns={Math.min(settings.limit, 4)} listId={`cart-recs:${source.kind}`} listName={title} />
                </CardAddContext.Provider>
            )}
            <p className="cmx-sr" role="status" aria-live="polite">
                {said}
            </p>
        </section>
    );
};

/** The row, or nothing on a site that has not switched it on or with an empty cart. */
export const CartRecommendations: React.FC<{ variant: 'page' | 'drawer'; onNavigate?: () => void }> = ({ variant, onNavigate }) => {
    const { config } = useCommerceSite();
    const empty = useCommerceCart((s) => s.cart.lines.length === 0);
    if (!config.cartRecommendations || empty) return null;
    return <RecsRow settings={config.cartRecommendations} variant={variant} onNavigate={onNavigate} />;
};
