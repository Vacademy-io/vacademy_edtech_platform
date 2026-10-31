import { beforeEach, describe, expect, it } from 'vitest';
import { useProductPageStore } from './product-page-store';
import type { ProductPageData } from '../-types/product-page-types';

const mapping = (id: string, price: number, status = 'ACTIVE') => ({
    id: `m-${id}`,
    ps_invite_payment_option_id: id,
    package_session_id: `ps-${id}`,
    payment_plan_id: `plan-${id}-${price}`,
    payment_plan: { id: `plan-${id}-${price}`, actual_price: price, currency: 'INR' },
    status,
});

const page = (mappings: ReturnType<typeof mapping>[], settings: object | null = null): ProductPageData =>
    ({
        id: 'page-1',
        code: 'store',
        institute_id: 'inst-1',
        settings_json: settings ? JSON.stringify(settings) : null,
        currency: 'INR',
        mappings,
    }) as unknown as ProductPageData;

const store = () => useProductPageStore.getState();

/**
 * The checkout's totals, the Pay button and the receipt are all priced from
 * the store's copy of the page. After the 409 "price changed" refetch that
 * copy must follow the page the learner is looking at — otherwise the retry is
 * charged the new price while every figure on screen still shows the old one.
 */
describe('syncPageData — the page arrives again mid-checkout', () => {
    beforeEach(() => store().reset());

    it('reprices every total from the new copy', () => {
        store().setPageData(page([mapping('a', 1000), mapping('b', 500)]));
        store().setSelection(['a', 'b']);
        expect(store().finalPrice()).toBe(1500);

        const repriced = page([mapping('a', 1500), mapping('b', 500)]);
        store().syncPageData(repriced);

        expect(store().pageData).toBe(repriced);
        expect(store().totalPrice()).toBe(2000);
        expect(store().finalPrice()).toBe(2000);
        expect(store().selectedPsOptionIds).toEqual(['a', 'b']);
    });

    it('drops a coupon worked out for the old price; the learner can apply it again', () => {
        store().setPageData(page([mapping('a', 1000)]));
        store().setSelection(['a']);
        store().applyCoupon('coupon-1', 'applied-1', 100);
        store().setCouponCode('SAVE10');
        expect(store().finalPrice()).toBe(900);

        store().syncPageData(page([mapping('a', 1500)]));

        expect(store().couponCode).toBe('');
        expect(store().couponId).toBe('');
        expect(store().appliedCouponDiscountId).toBe('');
        expect(store().discountAmount).toBe(0);
        expect(store().finalPrice()).toBe(1500);
    });

    it('keeps the coupon when the basket still costs the same', () => {
        store().setPageData(page([mapping('a', 1000), mapping('b', 500)]));
        store().setSelection(['a']);
        store().applyCoupon('coupon-1', 'applied-1', 100);
        store().setCouponCode('SAVE10');

        // Another course's price moved, and the page text changed — not this basket.
        store().syncPageData(page([mapping('a', 1000), mapping('b', 800)]));

        expect(store().couponCode).toBe('SAVE10');
        expect(store().discountAmount).toBe(100);
        expect(store().finalPrice()).toBe(900);
    });

    it('drops a course the page no longer sells, and the coupon with it', () => {
        store().setPageData(page([mapping('a', 1000), mapping('b', 500), mapping('c', 300)]));
        store().setSelection(['a', 'b', 'c']);
        store().applyCoupon('coupon-1', 'applied-1', 100);
        store().setCouponCode('SAVE10');

        // b was removed from the page, c is no longer ACTIVE.
        store().syncPageData(page([mapping('a', 1000), mapping('c', 300, 'INACTIVE')]));

        expect(store().selectedPsOptionIds).toEqual(['a']);
        expect(store().couponCode).toBe('');
        expect(store().finalPrice()).toBe(1000);
    });

    it('follows a changed page offer, not just item prices', () => {
        const offer = (value: number) => ({
            offers: { enabled: true, rules: [{ id: 'o1', label: 'Launch', discountType: 'FIXED', discountValue: value }] },
        });
        store().setPageData(page([mapping('a', 1000)], offer(100)));
        store().setSelection(['a']);
        store().applyCoupon('coupon-1', 'applied-1', 50);
        store().setCouponCode('SAVE50');
        expect(store().finalPrice()).toBe(850);

        store().syncPageData(page([mapping('a', 1000)], offer(300)));

        // 1000 − 300 offer; the coupon was worked out against 900, so it goes.
        expect(store().couponCode).toBe('');
        expect(store().finalPrice()).toBe(700);
    });

    it('is a no-op for the same copy', () => {
        const same = page([mapping('a', 1000)]);
        store().setPageData(same);
        store().setSelection(['a']);
        store().applyCoupon('coupon-1', 'applied-1', 100);
        store().setCouponCode('SAVE10');
        const selection = store().selectedPsOptionIds;

        store().syncPageData(same);

        expect(store().selectedPsOptionIds).toBe(selection);
        expect(store().couponCode).toBe('SAVE10');
    });
});

describe('clearBasketState — a different basket on the same page', () => {
    beforeEach(() => store().reset());

    it('drops the coupon and the CPO plan and pick, and keeps the learner', () => {
        store().setPageData(page([mapping('a', 1000)]));
        store().applyCoupon('coupon-1', 'applied-1', 300);
        store().setCouponCode('SAVE10');
        store().setCpoEnrollResult('user-plan-1');
        store().setCpoSelection(['sfp-1', 'sfp-2'], 2000);
        store().setCpoCustomAmount(500);
        store().setFormSubmitResult('user-1', ['cart-1']);
        store().setRegistrationData({ email: { id: 'f1', name: 'Email', value: 'a@b.c', is_mandatory: true, type: 'EMAIL' } });

        store().clearBasketState();

        expect(store().couponCode).toBe('');
        expect(store().couponId).toBe('');
        expect(store().appliedCouponDiscountId).toBe('');
        expect(store().discountAmount).toBe(0);
        expect(store().cpoUserPlanId).toBeNull();
        expect(store().cpoSelectedSfpIds).toEqual([]);
        expect(store().cpoSelectedTotal).toBe(0);
        expect(store().cpoCustomAmount).toBeUndefined();
        expect(store().userId).toBe('user-1');
        expect(Object.keys(store().registrationData)).toEqual(['email']);
    });
});

/**
 * The figure the server checks a coupon against at enrolment
 * (ProductPageEnrollmentService: the basket price, less the best page offer).
 * The cart asks about a coupon on the same figure, so both work out one discount.
 */
describe('priceBeforeCoupon — what a coupon is worked out against', () => {
    beforeEach(() => store().reset());

    it('is what the selected courses cost on a page with no basket price or offer', () => {
        store().setPageData(page([mapping('a', 1000), mapping('b', 500), mapping('c', 300)]));
        store().setSelection(['a', 'b']);

        expect(store().priceBeforeCoupon()).toBe(1500);
    });

    it('is the basket price less the best page offer, and leaves the coupon out', () => {
        store().setPageData(
            page([mapping('a', 600), mapping('b', 600), mapping('c', 600)], {
                basketPricing: { enabled: true, ladder: { prices: [349, 599, 799], perExtra: 150 } },
                offers: { enabled: true, rules: [{ id: 'o1', label: 'Launch', discountType: 'FIXED', discountValue: 100 }] },
            })
        );
        store().setSelection(['a', 'b', 'c']);
        store().applyCoupon('coupon-1', 'applied-1', 200);

        expect(store().totalPrice()).toBe(1800);
        expect(store().priceBeforeCoupon()).toBe(699);
        expect(store().finalPrice()).toBe(499);
    });
});
