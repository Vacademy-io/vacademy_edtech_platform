import { beforeEach, describe, expect, it } from 'vitest';
import { checkoutEntryOf, isDifferentProductPage, isSameSelection } from './page-switch';
import { useProductPageStore } from '../-stores/product-page-store';

describe('isDifferentProductPage', () => {
    it('is a switch only when another page was served before', () => {
        expect(isDifferentProductPage(null, { id: 'a', code: 'A' })).toBe(false);
        expect(isDifferentProductPage({ id: 'a', code: 'A' }, { id: 'a', code: 'A' })).toBe(false);
        expect(isDifferentProductPage({ id: 'a', code: 'A' }, { id: 'b', code: 'B' })).toBe(true);
    });

    it('falls back to the code when an id is missing', () => {
        expect(isDifferentProductPage({ id: '', code: 'A' }, { id: '', code: 'A' })).toBe(false);
        expect(isDifferentProductPage({ id: '', code: 'A' }, { id: '', code: 'B' })).toBe(true);
    });
});

describe('switching pages clears what must not carry over', () => {
    beforeEach(() => useProductPageStore.getState().reset());

    it('a reset on switch drops the previous page coupon and learner', () => {
        const store = useProductPageStore.getState();
        store.setPageData({ id: 'a', code: 'A', mappings: [] } as never);
        store.applyCoupon('coupon-1', 'applied-1', 100);
        store.setFormSubmitResult('user-1', ['cart-1']);

        const next = { id: 'b', code: 'B' };
        if (isDifferentProductPage(useProductPageStore.getState().pageData, next)) {
            useProductPageStore.getState().reset();
        }
        const after = useProductPageStore.getState();
        expect(after.couponId).toBe('');
        expect(after.discountAmount).toBe(0);
        expect(after.userId).toBeNull();
    });
});

describe('isSameSelection', () => {
    it('compares the courses, not their order', () => {
        expect(isSameSelection(['a', 'b'], ['b', 'a'])).toBe(true);
        expect(isSameSelection([], [])).toBe(true);
        expect(isSameSelection(['a'], ['a', 'b'])).toBe(false);
        expect(isSameSelection(['a', 'b'], ['a', 'c'])).toBe(false);
        expect(isSameSelection(['a', 'a'], ['a'])).toBe(true);
    });
});

/**
 * The store outlives the page, so a second checkout in the same visit — the
 * site cart sends every purchase through one store page — must not inherit
 * the first one's coupon, discount or CPO plan.
 */
describe('checkoutEntryOf — what a new mount keeps', () => {
    const page = { id: 'store-1', code: 'STORE' };

    it('starts clean after a finished order, even for the same basket', () => {
        expect(checkoutEntryOf({ pageData: page, step: 'SUCCESS', selectedPsOptionIds: ['a'] }, page, ['a'])).toBe('RESET');
        expect(checkoutEntryOf({ pageData: page, step: 'SUCCESS', selectedPsOptionIds: ['a'] }, page, ['b'])).toBe('RESET');
    });

    it('starts clean on another page', () => {
        expect(
            checkoutEntryOf({ pageData: { id: 'other', code: 'OTHER' }, step: 'CART', selectedPsOptionIds: ['a'] }, page, ['a'])
        ).toBe('RESET');
    });

    it('drops the basket state for a different basket on the same page', () => {
        expect(checkoutEntryOf({ pageData: page, step: 'PAYMENT', selectedPsOptionIds: ['a'] }, page, ['a', 'b'])).toBe('NEW_BASKET');
        expect(checkoutEntryOf({ pageData: page, step: 'CART', selectedPsOptionIds: ['a'] }, page, [])).toBe('NEW_BASKET');
    });

    it('keeps everything for the same basket on the same page, as before', () => {
        expect(checkoutEntryOf({ pageData: page, step: 'CART', selectedPsOptionIds: ['a', 'b'] }, page, ['b', 'a'])).toBe('KEEP');
        expect(checkoutEntryOf({ pageData: page, step: 'PAYMENT', selectedPsOptionIds: ['a'] }, page, ['a'])).toBe('KEEP');
    });

    it('treats a first visit as nothing to drop', () => {
        // An untouched store: no page served, nothing finished.
        expect(checkoutEntryOf({ pageData: null, step: 'CATALOG', selectedPsOptionIds: [] }, page, [])).toBe('KEEP');
        expect(checkoutEntryOf({ pageData: null, step: 'CATALOG', selectedPsOptionIds: [] }, page, ['a'])).toBe('NEW_BASKET');
    });
});
