import { useMemo } from 'react';
import { useProductPageStore } from '../-stores/product-page-store';
import type { ProductPageData } from '../-types/product-page-types';
import { nextTier, parseBasketPricing } from './basket-pricing';
import { currencySymbolFor } from './cart-item-display';

/**
 * The one place every basket bar gets its numbers.
 *
 * The catalogue bar used to add up `actual_price` and show that — so a page
 * selling "any 2 for ₹599" told the parent ₹698 right up to the moment
 * checkout charged them ₹599. Anything that shows a running total reads it
 * from here, and here reads the same engine the server bills on.
 */
export interface BasketSavings {
    count: number;
    /** What the selected courses cost bought separately. */
    itemTotal: number;
    /** What will actually be charged: basket price, then offer, then coupon. */
    total: number;
    /**
     * The same figure WITHOUT the coupon.
     *
     * The coupon is invalidated by a cart change, but that only happens while
     * the cart step is mounted — a parent who applies a code, walks back to the
     * catalogue and adds a course would otherwise be shown a total still
     * carrying a discount the server is about to drop. Browse surfaces quote
     * this one, so the number on screen is never LESS than what is charged.
     */
    totalBeforeCoupon: number;
    saved: number;
    savedPercent: number;
    /**
     * The next discount threshold, on pages that price by tier. Derived from
     * nextTier rather than restated, so the two cannot drift — a hand-copied
     * shape here is what hid `amountAway` from every caller.
     */
    tierAhead: ReturnType<typeof nextTier>;
    symbol: string;
    money: (n: number) => string;
}

export const useBasketSavings = (pageData: ProductPageData): BasketSavings => {
    // Subscribing to the whole store, as every other basket surface does: the
    // computed values are plain functions, so a narrower selector would leave
    // the bar showing a stale total after a course is added.
    const store = useProductPageStore();
    const { selectedPsOptionIds } = store;

    return useMemo(() => {
        const count = selectedPsOptionIds.length;
        const quote = store.basketQuote();
        const itemTotal = quote ? quote.itemTotal : store.totalPrice();
        const total = store.finalPrice();
        const afterOffer = Math.max(
            0,
            (quote ? quote.total : store.totalPrice()) - (store.appliedOffer()?.amount ?? 0)
        );
        const saved = Math.max(0, Math.round(itemTotal - afterOffer));
        const symbol = currencySymbolFor(
            pageData.currency || pageData.mappings[0]?.payment_plan?.currency || 'INR'
        );

        return {
            count,
            itemTotal,
            total,
            totalBeforeCoupon: Math.round(afterOffer),
            saved,
            savedPercent: itemTotal > 0 ? Math.round((saved / itemTotal) * 100) : 0,
            tierAhead: nextTier(parseBasketPricing(pageData.settings_json), count, itemTotal),
            symbol,
            money: (n: number) => `${symbol}${n.toLocaleString('en-IN')}`,
        };
        // The store object identity changes on every mutation, which is the
        // signal we want — recompute whenever anything in the basket moves.
    }, [store, selectedPsOptionIds, pageData]);
};
