// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// React 19 requires this before act(); the repo has no shared test setup file.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const mocks = vi.hoisted(() => ({ validateCoupon: vi.fn() }));

type MutationOptions = {
    mutationFn: () => Promise<unknown>;
    onSuccess?: (data: unknown) => void;
    onError?: (err: unknown) => void;
};

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));
// Runs the request the way React Query would, without the cache.
vi.mock('@tanstack/react-query', () => ({
    useMutation: (options: MutationOptions) => ({
        mutate: () => {
            void options.mutationFn().then(options.onSuccess, options.onError);
        },
        isPending: false,
    }),
}));
vi.mock('../-services/product-page-service', () => ({ validateCoupon: mocks.validateCoupon }));
vi.mock('@/components/common/enroll-by-invite/-utils/gtm', () => ({
    pushCartViewed: () => undefined,
    pushCouponApplied: () => undefined,
}));
vi.mock('@/components/common/coupon/use-coupons-enabled', () => ({ useCouponsEnabled: () => true }));
vi.mock('@/routes/$tagName/-utils/catalogue-naming', () => ({
    useCourseTerms: () => ({ course: 'Course', courses: 'Courses' }),
}));
vi.mock('./PlanTiles', () => ({ PlanTiles: () => null }));
vi.mock('./CartItemList', () => ({ CartItemList: () => null }));
vi.mock('./OffersStrip', () => ({ OffersStrip: () => null }));
vi.mock('./MobileCheckoutBar', () => ({ MobileCheckoutBar: () => null }));

import { CartStep } from './CartStep';
import { useProductPageStore } from '../-stores/product-page-store';
import type { ProductPageData, ProductPageSettings } from '../-types/product-page-types';

const settings = {
    defaultStep: 'CART',
    allowCourseDeselection: true,
    tnc: { enabled: false, content: '', externalUrl: '' },
    invoice: { enabled: false, channels: [] },
    coupon: { enabled: true },
} as ProductPageSettings;

const page = (price: number): ProductPageData =>
    ({
        id: 'store-1',
        name: 'Store',
        code: 'STORE',
        institute_id: 'inst-1',
        status: 'ACTIVE',
        page_json: null,
        settings_json: JSON.stringify(settings),
        short_url: null,
        mappings: [
            {
                id: 'm-a',
                ps_invite_payment_option_id: 'opt-a',
                package_session_id: 'ps-a',
                payment_plan_id: `plan-${price}`,
                payment_plan: { id: `plan-${price}`, name: 'Plan', actual_price: price, currency: 'INR' },
                status: 'ACTIVE',
            },
        ],
        aggregated_custom_fields: [],
        vendor: 'RAZORPAY',
        currency: 'INR',
        gtm_container_id: null,
    }) as unknown as ProductPageData;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const mountWithCoupon = () => {
    const store = useProductPageStore.getState();
    store.setPageData(page(1000));
    store.setSelection(['opt-a']);
    store.applyCoupon('coupon-1', 'applied-1', 100);
    store.setCouponCode('SAVE10');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
        root!.render(
            React.createElement(CartStep, {
                pageData: page(1000),
                settings,
                onBack: () => undefined,
                onNext: () => undefined,
            })
        )
    );
};

const text = () => container!.textContent ?? '';
const couponInput = () => container!.querySelector('input[aria-label="cartStep.couponCard.title"]') as HTMLInputElement | null;

beforeEach(() => {
    useProductPageStore.getState().reset();
    mocks.validateCoupon.mockReset();
});
afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
});

describe('the cart coupon box', () => {
    it('shows an applied coupon as applied', () => {
        mountWithCoupon();
        expect(text()).toContain('SAVE10');
        expect(couponInput()).toBeNull();
    });

    it('stops showing a coupon as applied once the page reprices the basket', () => {
        mountWithCoupon();

        // The page arrives again with a new price (see syncPageData).
        act(() => useProductPageStore.getState().syncPageData(page(1500)));

        expect(text()).not.toContain('cartStep.couponCard.discountOff');
        expect(couponInput()?.value).toBe('SAVE10');
        expect(text()).toContain('cartStep.couponChanged');
    });

    it('says nothing when the learner removes the coupon themselves', () => {
        mountWithCoupon();
        const remove = container!.querySelector('button[aria-label="cartStep.item.removeTooltip"]') as HTMLButtonElement;

        act(() => remove.click());

        expect(couponInput()?.value).toBe('');
        expect(text()).not.toContain('cartStep.couponChanged');
    });
});

const course = (id: string, price: number) => ({
    id: `m-${id}`,
    ps_invite_payment_option_id: `opt-${id}`,
    package_session_id: `ps-${id}`,
    payment_plan_id: `plan-${id}`,
    payment_plan: { id: `plan-${id}`, name: 'Plan', actual_price: price, currency: 'INR' },
    status: 'ACTIVE',
});

const pageWith = (courses: ReturnType<typeof course>[], pricing: object = {}): ProductPageData =>
    ({
        ...page(0),
        settings_json: JSON.stringify({ ...settings, ...pricing }),
        mappings: courses,
    }) as unknown as ProductPageData;

const mount = (pageData: ProductPageData) => {
    const store = useProductPageStore.getState();
    store.setPageData(pageData);
    store.setSelection(pageData.mappings.map((m) => m.ps_invite_payment_option_id));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
        root!.render(
            React.createElement(CartStep, { pageData, settings, onBack: () => undefined, onNext: () => undefined })
        )
    );
};

const applyCode = async (code: string) => {
    const input = couponInput()!;
    // React tracks an input's value itself; set it the way typing does.
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, code);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const apply = [...container!.querySelectorAll('button')].find((b) => b.textContent === 'cartStep.couponCard.apply');
    await act(async () => {
        apply!.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
};

/** The server's validate endpoint for a 50% coupon: half of whatever it is asked about. */
const halfOff = async (_page: string, _code: string, amount: number) => ({
    valid: true,
    coupon_code_id: 'coupon-1',
    applied_coupon_discount_id: 'applied-1',
    discount_type: 'PERCENTAGE',
    discount_value: amount / 2,
    max_discount_value: null,
    message: 'VALID',
});

/**
 * At enrolment the server works a coupon out on what the basket costs before
 * it: the basket price, less the best page offer (ProductPageEnrollmentService).
 * Asked about any other figure, a percentage coupon comes out bigger in the
 * cart than the server allows, and the page shows a price nobody is charged —
 * at worst "free" for a basket the server bills.
 */
describe('checking a coupon in the cart', () => {
    it('asks about the basket price, not what the courses cost apart', async () => {
        // "Any 3 for 799": three courses at 600 cost 1,800 apart, 799 together.
        mount(
            pageWith([course('a', 600), course('b', 600), course('c', 600)], {
                basketPricing: { enabled: true, ladder: { prices: [349, 599, 799], perExtra: 150 } },
            })
        );
        mocks.validateCoupon.mockImplementation(halfOff);

        await applyCode('HALF');

        expect(mocks.validateCoupon).toHaveBeenCalledWith('STORE', 'HALF', 799, 3);
        // What the server charges: half of 799. Half of 1,800 made it free.
        expect(useProductPageStore.getState().discountAmount).toBe(399.5);
        expect(useProductPageStore.getState().finalPrice()).toBe(399.5);
    });

    it('asks about the price after the page offer', async () => {
        mount(
            pageWith([course('a', 1000)], {
                offers: { enabled: true, rules: [{ id: 'o1', label: 'Launch', discountType: 'FIXED', discountValue: 100 }] },
            })
        );
        mocks.validateCoupon.mockImplementation(halfOff);

        await applyCode('HALF');

        expect(mocks.validateCoupon).toHaveBeenCalledWith('STORE', 'HALF', 900, 1);
        expect(useProductPageStore.getState().finalPrice()).toBe(450);
    });

    it('asks about the plain course price on a page with neither, as it always has', async () => {
        mount(pageWith([course('a', 1000), course('b', 500)]));
        mocks.validateCoupon.mockImplementation(halfOff);

        await applyCode('HALF');

        expect(mocks.validateCoupon).toHaveBeenCalledWith('STORE', 'HALF', 1500, 2);
        expect(useProductPageStore.getState().couponCode).toBe('HALF');
        expect(useProductPageStore.getState().finalPrice()).toBe(750);
    });
});
