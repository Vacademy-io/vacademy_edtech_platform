import { describe, expect, it } from 'vitest';
import {
    nextTier,
    quoteBasket,
    savingsPercent,
    tierAmount,
    tierApplies,
    tierDiscount,
    type BasketPricingSettings,
} from './basket-pricing';

/**
 * The engine that decides what a parent is charged. BasketPricingCalculator.java
 * is the authority; these cases are the shared contract, so a change that breaks
 * one of them must be made in both files or not at all.
 */

const PRICE = 349; // what one subject costs on its enroll invite
const items = (n: number, price = PRICE) =>
    Array.from({ length: n }, (_, i) => ({
        levelName: 'Class 5',
        packageName: `Subject ${i}`,
        price,
    }));

const GROUPS = [{ label: 'Class 5', levels: ['Class 5'] }];

/** The iThinkers B2C price card, as absolute prices per count. */
const FLAT: BasketPricingSettings = {
    enabled: true,
    ladder: { prices: [349, 599, 799], perExtra: 150 },
    groups: GROUPS,
};

/** The same card, as discounts off what the courses cost on their invites. */
const DISCOUNT: BasketPricingSettings = {
    enabled: true,
    pricingBasis: 'DISCOUNT',
    ladder: { prices: [], perExtra: 0 },
    tiers: [
        { minCourses: 2, type: 'AMOUNT', value: 99 },
        { minCourses: 3, type: 'AMOUNT', value: 248 },
        { minCourses: 4, type: 'AMOUNT', value: 447 },
        { minCourses: 5, type: 'AMOUNT', value: 646 },
    ],
    groups: GROUPS,
};

const CARD: Record<number, number> = { 1: 349, 2: 599, 3: 799, 4: 949, 5: 1099 };

describe('the published price card', () => {
    it.each([1, 2, 3, 4, 5])('charges the card price for %i subject(s) on a FLAT page', (n) => {
        expect(quoteBasket(FLAT, items(n))!.total).toBe(CARD[n]);
    });

    it.each([1, 2, 3, 4, 5])('charges the same on a DISCOUNT page for %i subject(s)', (n) => {
        expect(quoteBasket(DISCOUNT, items(n))!.total).toBe(CARD[n]);
    });

    it('reports what the courses cost apart, so the saving can be shown', () => {
        const quote = quoteBasket(DISCOUNT, items(3))!;
        expect(quote.itemTotal).toBe(1047);
        expect(quote.total).toBe(799);
        expect(savingsPercent(quote)).toBe(24);
    });
});

describe('percentage tiers', () => {
    const PCT: BasketPricingSettings = {
        enabled: true,
        pricingBasis: 'DISCOUNT',
        ladder: { prices: [], perExtra: 0 },
        tiers: [
            { minCourses: 2, type: 'PERCENT', value: 15 },
            { minCourses: 4, type: 'PERCENT', value: 25 },
        ],
        groups: GROUPS,
    };

    it('keeps scaling past the last rung, which a flat ladder cannot', () => {
        expect(quoteBasket(PCT, items(2))!.total).toBe(593); // 698 − 15%
        expect(quoteBasket(PCT, items(6))!.total).toBe(1571); // 2094 − 25%
    });

    it('follows the courses when the invite reprices them', () => {
        // The whole point: nothing in the page settings says 349.
        expect(quoteBasket(PCT, items(2, 500))!.total).toBe(850);
    });

    it('names how far the next tier is, in courses rather than rupees', () => {
        expect(nextTier(PCT, 1)).toEqual({
            coursesAway: 1,
            amountAway: 0,
            label: '15% off',
            offer: { type: 'PERCENT', value: 15, incremental: false },
        });
        expect(nextTier(PCT, 3)).toEqual({
            coursesAway: 1,
            amountAway: 0,
            label: '25% off',
            offer: { type: 'PERCENT', value: 25, incremental: false },
        });
        expect(nextTier(PCT, 4)).toBeNull();
    });

    it('quotes the EXTRA saving, not the new total, once a tier already applies', () => {
        // 2 subjects already carry ₹99 off; a third takes the discount to ₹248,
        // which is ₹149 MORE — promising ₹248 would overstate the gain.
        expect(nextTier(DISCOUNT, 2, 698)).toEqual({
            coursesAway: 1,
            amountAway: 0,
            label: '₹149 more off',
            offer: { type: 'AMOUNT', value: 149, incremental: true },
        });
        // Nothing applied yet, so the tier's own figure is the honest one.
        expect(nextTier(DISCOUNT, 1, 349)).toEqual({
            coursesAway: 1,
            amountAway: 0,
            label: '₹99 off',
            offer: { type: 'AMOUNT', value: 99, incremental: false },
        });
    });

    it('carries the offer as data so a translated surface can phrase it', () => {
        // The bar renders in four locales; a baked English label would strand
        // ar / fr / hi on "₹149 more off".
        const ahead = nextTier(PCT, 1)!;
        expect(ahead.offer.type).toBe('PERCENT');
        expect(ahead.offer.incremental).toBe(false);
    });
});

describe('guardrails', () => {
    it('never discounts below zero', () => {
        expect(tierDiscount({ ...DISCOUNT, tiers: [{ minCourses: 1, type: 'AMOUNT', value: 99999 }] }, 349, 1)).toBe(349);
    });

    it('leaves a free course free under DISCOUNT', () => {
        expect(quoteBasket(DISCOUNT, items(1, 0))!.total).toBe(0);
    });

    it('leaves FLAT pages with free courses exactly as they were', () => {
        expect(quoteBasket(FLAT, items(2, 0))!.total).toBe(599);
        expect(quoteBasket(FLAT, items(5, 0))!.total).toBe(1099);
    });

    it('does not let a DISCOUNT tier charge more than the courses cost apart', () => {
        const bad: BasketPricingSettings = {
            ...DISCOUNT,
            tiers: [{ minCourses: 1, type: 'AMOUNT', value: -500 }],
        };
        expect(quoteBasket(bad, items(1))!.total).toBe(349);
    });

    it('never takes a discount away for adding another subject', () => {
        // A tier list whose later rung is worth less would, under a
        // highest-threshold rule, punish the parent for a fifth subject.
        const backwards: BasketPricingSettings = {
            ...DISCOUNT,
            tiers: [
                { minCourses: 2, type: 'AMOUNT', value: 500 },
                { minCourses: 5, type: 'AMOUNT', value: 100 },
            ],
        };
        expect(tierDiscount(backwards, 698, 2)).toBe(500);
        expect(tierDiscount(backwards, 1745, 5)).toBe(500);
    });

    it('still prefers a full pack or combo when one is cheaper', () => {
        const withPack: BasketPricingSettings = {
            ...DISCOUNT,
            groups: [{ label: 'Class 5', levels: ['Class 5'], packPrice: 499 }],
        };
        expect(quoteBasket(withPack, items(3))!.total).toBe(499);
    });
});

describe('a combo the basket has outgrown', () => {
    // iThinkers sells English+Maths+Science together for ₹749 while the plain
    // three-subject price is ₹799 — a ₹50 saving. The reported bug: adding a
    // fourth subject to that trio charged ₹200, not the ₹150 the page
    // advertises, because the combo simply stopped applying.
    const EMS = ['English', 'Maths', 'Science'];
    const subject = (packageName: string) => ({
        levelName: 'Class 5',
        packageName,
        price: PRICE,
    });
    const withCombo = (base: BasketPricingSettings): BasketPricingSettings => ({
        ...base,
        combos: [{ label: 'EMS combo', packages: EMS, price: 749 }],
    });

    it.each([
        ['FLAT', FLAT],
        ['DISCOUNT', DISCOUNT],
    ])('prices the combo itself unchanged on a %s page', (_name, base) => {
        expect(quoteBasket(withCombo(base), EMS.map(subject))!.total).toBe(749);
    });

    it.each([
        ['FLAT', FLAT],
        ['DISCOUNT', DISCOUNT],
    ])('charges the ladder step, not ₹200, for the fourth subject on a %s page', (_name, base) => {
        const quote = quoteBasket(withCombo(base), [...EMS, 'G.K.'].map(subject))!;
        expect(quote.total).toBe(899); // 749 + (949 − 799)
        expect(quote.total - 749).toBe(CARD[4] - CARD[3]);
    });

    it('keeps the combo saving as the basket grows', () => {
        const five = quoteBasket(withCombo(DISCOUNT), [...EMS, 'G.K.', 'Cyber AI'].map(subject))!;
        expect(five.total).toBe(CARD[5] - 50);
    });

    it('ignores a combo the basket only partly holds', () => {
        const two = quoteBasket(withCombo(DISCOUNT), ['English', 'Maths'].map(subject))!;
        expect(two.total).toBe(CARD[2]);
    });

    it('never charges more than the plain price', () => {
        // A combo priced above the ordinary rung must lose, extension or not.
        const overpriced: BasketPricingSettings = {
            ...DISCOUNT,
            combos: [{ label: 'bad combo', packages: EMS, price: 900 }],
        };
        expect(quoteBasket(overpriced, EMS.map(subject))!.total).toBe(CARD[3]);
        expect(quoteBasket(overpriced, [...EMS, 'G.K.'].map(subject))!.total).toBe(CARD[4]);
    });
});

describe('amount-gated tiers', () => {
    const spend = (tiers: BasketPricingSettings['tiers']): BasketPricingSettings => ({
        enabled: true,
        pricingBasis: 'DISCOUNT',
        ladder: { prices: [], perExtra: 0 },
        tiers,
        groups: GROUPS,
    });

    it('applies once the basket is worth enough, whatever the count', () => {
        const s = spend([{ minAmount: 1000, type: 'PERCENT', value: 10 }]);
        expect(tierDiscount(s, 900, 5)).toBe(0); // under the threshold
        expect(tierDiscount(s, 1000, 1)).toBe(100); // exactly on it, one course
        expect(tierDiscount(s, 2000, 2)).toBe(200);
    });

    it('requires BOTH conditions when both are set', () => {
        const s = spend([{ minCourses: 3, minAmount: 1000, type: 'PERCENT', value: 10 }]);
        expect(tierDiscount(s, 1200, 2)).toBe(0); // enough money, too few courses
        expect(tierDiscount(s, 800, 4)).toBe(0); // enough courses, too little money
        expect(tierDiscount(s, 1200, 3)).toBe(120);
    });

    it('caps a percentage at maxDiscount', () => {
        const s = spend([{ minAmount: 1000, type: 'PERCENT', value: 50, maxDiscount: 300 }]);
        expect(tierDiscount(s, 1000, 3)).toBe(300); // 500 capped to 300
        expect(tierDiscount(s, 1100, 3)).toBe(300);
        // Under the cap it behaves normally.
        expect(tierDiscount(spend([{ minAmount: 1000, type: 'PERCENT', value: 10, maxDiscount: 300 }]), 1000, 3)).toBe(100);
    });

    it('treats a zero or absent cap as no cap', () => {
        expect(tierAmount({ minAmount: 1, type: 'PERCENT', value: 50, maxDiscount: 0 }, 1000)).toBe(500);
        expect(tierAmount({ minAmount: 1, type: 'PERCENT', value: 50 }, 1000)).toBe(500);
    });

    it('closes a band at the top so two rules do not fight', () => {
        const s = spend([
            { minAmount: 500, maxAmount: 999, type: 'PERCENT', value: 10 },
            { minAmount: 1000, type: 'PERCENT', value: 20 },
        ]);
        expect(tierDiscount(s, 600, 2)).toBe(60); // in the low band
        expect(tierDiscount(s, 1500, 4)).toBe(300); // only the high band applies
    });

    it('ignores a tier with no condition at all rather than firing on everything', () => {
        expect(tierApplies({ type: 'PERCENT', value: 50 }, 1000, 3)).toBe(false);
        expect(tierDiscount(spend([{ type: 'PERCENT', value: 50 }]), 1000, 3)).toBe(0);
    });

    it('never discounts more than the courses cost', () => {
        expect(tierDiscount(spend([{ minAmount: 1, type: 'AMOUNT', value: 99999 }]), 500, 2)).toBe(500);
        expect(tierDiscount(spend([{ minAmount: 1, type: 'PERCENT', value: 300 }]), 500, 2)).toBe(500);
    });

    it('ignores negative and zero values', () => {
        expect(tierDiscount(spend([{ minAmount: 1, type: 'AMOUNT', value: -100 }]), 500, 2)).toBe(0);
        expect(tierDiscount(spend([{ minAmount: 1, type: 'PERCENT', value: 0 }]), 500, 2)).toBe(0);
    });

    it('still takes the best of a count tier and an amount tier', () => {
        const s = spend([
            { minCourses: 2, type: 'AMOUNT', value: 99 },
            { minAmount: 600, type: 'PERCENT', value: 25 },
        ]);
        // 698 qualifies for both: 99 flat vs 174.5 percent — the better wins.
        expect(tierDiscount(s, 698, 2)).toBeCloseTo(174.5, 5);
    });
});

describe('nextTier with amount gates', () => {
    const s: BasketPricingSettings = {
        enabled: true,
        pricingBasis: 'DISCOUNT',
        ladder: { prices: [], perExtra: 0 },
        tiers: [
            { minCourses: 3, type: 'AMOUNT', value: 200 },
            { minAmount: 2000, type: 'PERCENT', value: 20 },
        ],
        groups: GROUPS,
    };

    it('reports a course gap when courses are what is missing', () => {
        const ahead = nextTier(s, 2, 698)!;
        expect(ahead.coursesAway).toBe(1);
        expect(ahead.amountAway).toBe(0);
    });

    it('reports an amount gap when only spend is missing', () => {
        const onlySpend: BasketPricingSettings = {
            ...s,
            tiers: [{ minAmount: 2000, type: 'PERCENT', value: 20 }],
        };
        const ahead = nextTier(onlySpend, 4, 1500)!;
        expect(ahead.coursesAway).toBe(0);
        expect(ahead.amountAway).toBe(500);
    });

    it('never promises a tier already worth less than what is applied', () => {
        const worse: BasketPricingSettings = {
            ...s,
            tiers: [
                { minCourses: 2, type: 'AMOUNT', value: 500 },
                { minCourses: 5, type: 'AMOUNT', value: 100 },
            ],
        };
        // At 2 courses the 500 tier is live; the 5-course tier is worth less.
        expect(nextTier(worse, 2, 698)).toBeNull();
    });

    it('never promises a band the basket has already priced past', () => {
        const past: BasketPricingSettings = {
            ...s,
            tiers: [{ minAmount: 100, maxAmount: 500, type: 'PERCENT', value: 50 }],
        };
        expect(nextTier(past, 4, 900)).toBeNull();
    });

    it('returns null once every tier is reached', () => {
        expect(nextTier(s, 5, 3000)).toBeNull();
    });
});
