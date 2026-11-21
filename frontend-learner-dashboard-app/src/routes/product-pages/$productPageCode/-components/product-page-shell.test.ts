// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// React 19 requires this before act(); the repo has no shared test setup file.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@tanstack/react-router', () => ({
    useCanGoBack: () => false,
    useNavigate: () => () => undefined,
    useRouter: () => ({ history: { back: () => undefined } }),
}));
vi.mock('@/components/common/enroll-by-invite/-utils/gtm', () => ({
    injectGtm: () => undefined,
    pushProductPageView: () => undefined,
}));
vi.mock('@/routes/$tagName/-utils/reopen-course-finder', () => ({ requestCourseFinder: () => undefined }));
vi.mock('@/routes/$tagName/-components/site-cart/site-cart-events', () => ({ requestSiteCartReopen: () => undefined }));
vi.mock('@/routes/$tagName/-components/CatalogueChrome', () => ({
    CatalogueChrome: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('./CheckoutLayout', () => ({
    CheckoutLayout: ({ children }: { children: React.ReactNode }) => children,
}));
// Each step renders a marker; the shell's own job is the store and the step.
const steps = vi.hoisted(() => ({
    stub: async (name: string) => {
        const { createElement } = await import('react');
        return () => createElement('div', { 'data-step': name });
    },
}));
vi.mock('./CatalogStep', async () => ({ CatalogStep: await steps.stub('CATALOG') }));
vi.mock('./CartStep', async () => ({ CartStep: await steps.stub('CART') }));
vi.mock('./MultiEnrollForm', async () => ({ MultiEnrollForm: await steps.stub('FORM') }));
vi.mock('./CombinedPaymentStep', async () => ({ CombinedPaymentStep: await steps.stub('PAYMENT') }));
vi.mock('./CpoInstallmentsCheckoutStep', async () => ({
    CpoInstallmentsCheckoutStep: await steps.stub('CPO_INSTALLMENTS'),
}));
vi.mock('./ProductPageSuccess', async () => ({ ProductPageSuccess: await steps.stub('SUCCESS') }));

import { ProductPageShell } from './ProductPageShell';
import { useProductPageStore } from '../-stores/product-page-store';
import type { ProductPageData } from '../-types/product-page-types';

const mapping = (id: string, price: number) => ({
    id: `m-${id}`,
    ps_invite_payment_option_id: `opt-${id}`,
    package_session_id: `ps-${id}`,
    enroll_invite_id: `inv-${id}`,
    payment_option_id: `po-${id}`,
    payment_plan_id: `plan-${id}-${price}`,
    payment_plan: { id: `plan-${id}-${price}`, name: 'Plan', actual_price: price, currency: 'INR' },
    preselected: false,
    display_order: 0,
    status: 'ACTIVE',
});

const page = (mappings: ReturnType<typeof mapping>[], extra: Partial<ProductPageData> = {}): ProductPageData =>
    ({
        id: 'store-1',
        name: 'Store',
        code: 'STORE',
        institute_id: 'inst-1',
        status: 'ACTIVE',
        page_json: null,
        settings_json: null,
        short_url: null,
        mappings,
        aggregated_custom_fields: [],
        vendor: 'RAZORPAY',
        currency: 'INR',
        gtm_container_id: null,
        ...extra,
    }) as unknown as ProductPageData;

const store = () => useProductPageStore.getState();

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const shell = (pageData: ProductPageData, courseIds?: string, defaultTab?: 'CATALOG' | 'CART' | 'PAYMENT') =>
    React.createElement(ProductPageShell, {
        productPageCode: 'STORE',
        instituteId: 'inst-1',
        pageData,
        courseIds,
        defaultTab,
        utmParams: {},
    });

const mount = (pageData: ProductPageData, courseIds?: string, defaultTab?: 'CATALOG' | 'CART' | 'PAYMENT') => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(shell(pageData, courseIds, defaultTab)));
};

/** The same mounted shell receiving a refetched page as its prop. */
const rerender = (pageData: ProductPageData, courseIds?: string, defaultTab?: 'CATALOG' | 'CART' | 'PAYMENT') =>
    act(() => root!.render(shell(pageData, courseIds, defaultTab)));

const renderedStep = () => container?.querySelector('[data-step]')?.getAttribute('data-step');

/** A previous checkout's leftovers, as the module-level store keeps them. */
const leftovers = (pageData: ProductPageData, step: 'CART' | 'PAYMENT' | 'SUCCESS', selection: string[]) => {
    store().setPageData(pageData);
    store().setStep(step);
    store().setSelection(selection);
    store().applyCoupon('coupon-1', 'applied-1', 300);
    store().setCouponCode('SAVE10');
    store().setCpoEnrollResult('user-plan-1');
    store().setCpoSelection(['sfp-1'], 1000);
    store().setCpoCustomAmount(400);
    store().setFormSubmitResult('user-1', ['cart-1']);
    store().setRegistrationData({ email: { id: 'f1', name: 'Email', value: 'a@b.c', is_mandatory: true, type: 'EMAIL' } });
};

beforeEach(() => store().reset());
afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
});

describe('re-entering a product page', () => {
    const P = page([mapping('a', 3000), mapping('b', 1000)]);

    it('starts clean after a finished order — nothing from that order rides into the next', () => {
        leftovers(P, 'SUCCESS', ['opt-a']);

        mount(P, 'ps-b', 'CART');

        expect(store().couponCode).toBe('');
        expect(store().discountAmount).toBe(0);
        expect(store().cpoUserPlanId).toBeNull();
        expect(store().cpoSelectedSfpIds).toEqual([]);
        expect(store().userId).toBeNull();
        expect(store().registrationData).toEqual({});
        expect(store().selectedPsOptionIds).toEqual(['opt-b']);
        // The new basket is priced on its own: no stale ₹300 off a ₹1,000 course.
        expect(store().finalPrice()).toBe(1000);
        expect(renderedStep()).toBe('CART');
    });

    it('starts clean after a finished order even for the same basket', () => {
        leftovers(P, 'SUCCESS', ['opt-a']);

        mount(P, 'ps-a', 'CART');

        expect(store().couponCode).toBe('');
        expect(store().cpoUserPlanId).toBeNull();
        expect(store().finalPrice()).toBe(3000);
    });

    it('drops the coupon and CPO state for a different basket on the same page', () => {
        leftovers(P, 'PAYMENT', ['opt-a']);

        mount(P, 'ps-b', 'CART');

        expect(store().couponCode).toBe('');
        expect(store().couponId).toBe('');
        expect(store().discountAmount).toBe(0);
        expect(store().cpoUserPlanId).toBeNull();
        expect(store().cpoSelectedSfpIds).toEqual([]);
        expect(store().cpoSelectedTotal).toBe(0);
        expect(store().cpoCustomAmount).toBeUndefined();
        // The learner's details are not part of the basket.
        expect(store().userId).toBe('user-1');
        expect(store().selectedPsOptionIds).toEqual(['opt-b']);
        expect(store().finalPrice()).toBe(1000);
    });

    it('keeps everything for the same basket on the same page, exactly as before', () => {
        leftovers(P, 'CART', ['opt-a']);

        mount(P, 'ps-a', 'CART');

        expect(store().couponCode).toBe('SAVE10');
        expect(store().discountAmount).toBe(300);
        expect(store().cpoUserPlanId).toBe('user-plan-1');
        expect(store().userId).toBe('user-1');
        expect(store().finalPrice()).toBe(2700);
    });

    it('starts clean on another product page', () => {
        leftovers(page([mapping('x', 500)], { id: 'other-page', code: 'OTHER' }), 'PAYMENT', ['opt-x']);

        mount(P, 'ps-a', 'CART');

        expect(store().couponCode).toBe('');
        expect(store().userId).toBeNull();
        expect(store().pageData).toBe(P);
    });
});

describe('the page arriving again while it is open (the 409 refetch)', () => {
    const P1 = page([mapping('a', 1000), mapping('b', 500)]);

    const atPayment = () => {
        mount(P1, 'ps-a', 'CART');
        act(() => {
            store().applyCoupon('coupon-1', 'applied-1', 100);
            store().setCouponCode('SAVE10');
            store().setStep('PAYMENT');
        });
        expect(store().finalPrice()).toBe(900);
        expect(renderedStep()).toBe('PAYMENT');
    };

    it('prices the Pay button, the summary and the receipt from the new copy', () => {
        atPayment();
        const P2 = page([mapping('a', 1500), mapping('b', 500)]);

        rerender(P2, 'ps-a', 'CART');

        expect(store().pageData).toBe(P2);
        expect(store().totalPrice()).toBe(1500);
        // The coupon was worked out for ₹1,000; it goes and can be applied again.
        expect(store().couponCode).toBe('');
        expect(store().finalPrice()).toBe(1500);
        // Same basket: the learner stays where they were, now seeing the real price.
        expect(store().selectedPsOptionIds).toEqual(['opt-a']);
        expect(renderedStep()).toBe('PAYMENT');
    });

    it('keeps the coupon when nothing about the basket price changed', () => {
        atPayment();

        rerender(page([mapping('a', 1000), mapping('b', 500)], { page_json: '{"components":[]}' }), 'ps-a', 'CART');

        expect(store().couponCode).toBe('SAVE10');
        expect(store().finalPrice()).toBe(900);
    });

    it('sends the learner back to the cart when a course left the page', () => {
        atPayment();

        rerender(page([mapping('b', 500)]), 'ps-a', 'CART');

        expect(store().selectedPsOptionIds).toEqual([]);
        expect(store().couponCode).toBe('');
        expect(renderedStep()).toBe('CART');
    });

    it("leaves a finished order's receipt as it was paid", () => {
        atPayment();
        act(() => store().setStep('SUCCESS'));

        rerender(page([mapping('a', 1500), mapping('b', 500)]), 'ps-a', 'CART');

        expect(store().pageData).toBe(P1);
        expect(store().couponCode).toBe('SAVE10');
        expect(store().finalPrice()).toBe(900);
        expect(renderedStep()).toBe('SUCCESS');
    });

    it('changes nothing for a re-render with the same page', () => {
        atPayment();
        const selection = store().selectedPsOptionIds;

        rerender(P1, 'ps-a', 'CART');

        expect(store().pageData).toBe(P1);
        expect(store().selectedPsOptionIds).toBe(selection);
        expect(store().couponCode).toBe('SAVE10');
        expect(renderedStep()).toBe('PAYMENT');
    });
});
