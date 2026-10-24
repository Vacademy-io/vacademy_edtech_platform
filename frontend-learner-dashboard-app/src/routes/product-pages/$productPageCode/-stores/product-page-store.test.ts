import { beforeEach, describe, expect, it } from 'vitest';
import { useProductPageStore } from './product-page-store';

/**
 * The figures the checkout quotes and the success page prints as a receipt.
 *
 * The receipt used to show the payment plan's LIST price beside every course,
 * so a real ₹949 four-subject order read "₹349" four times — ₹1,396 of receipts
 * for one ₹949 payment. On a page that prices the basket as a whole the list
 * price is not a figure the parent ever paid, so these are the numbers that must
 * reach the screen instead.
 */

const settings = JSON.stringify({
    basketPricing: {
        enabled: true,
        pricingBasis: 'DISCOUNT',
        ladder: { prices: [], perExtra: 0 },
        tiers: [
            { minCourses: 2, type: 'AMOUNT', value: 99 },
            { minCourses: 3, type: 'AMOUNT', value: 248 },
            { minCourses: 4, type: 'AMOUNT', value: 447 },
        ],
        groups: [{ label: 'Class 5', levels: ['Class 5'] }],
    },
});

const mappings = [0, 1, 2, 3].map((i) => ({
    ps_invite_payment_option_id: `opt-${i}`,
    level_name: 'Class 5',
    package_name: `Subject ${i}`,
    payment_plan: { actual_price: 349, currency: 'INR' },
}));

const select = (n: number) =>
    useProductPageStore.setState({
        pageData: { settings_json: settings, currency: 'INR', mappings } as never,
        selectedPsOptionIds: mappings.slice(0, n).map((m) => m.ps_invite_payment_option_id),
    });

describe('what the receipt shows', () => {
    beforeEach(() => useProductPageStore.getState().reset());

    it.each([
        [1, 349],
        [2, 599],
        [3, 799],
        [4, 949],
    ])('charges the card price for %i subject(s)', (count, expected) => {
        select(count);
        expect(useProductPageStore.getState().finalPrice()).toBe(expected);
    });

    it('knows what the same subjects would have cost apart', () => {
        select(4);
        const { totalPrice, finalPrice } = useProductPageStore.getState();
        expect(totalPrice()).toBe(4 * 349); // 1396 — the four ₹349 figures the receipt used to print
        expect(totalPrice() - finalPrice()).toBe(447);
    });
});
