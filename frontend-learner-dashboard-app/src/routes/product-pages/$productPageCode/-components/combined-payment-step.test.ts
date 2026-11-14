// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// React 19 requires this before act(); the repo has no shared test setup file.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AxiosError, AxiosHeaders } from 'axios';

type FormProps = {
    onPaymentReady?: (data: Record<string, string>) => void;
    onError?: (err: string) => void;
};

const mocks = vi.hoisted(() => ({
    enroll: vi.fn(),
    invalidate: vi.fn(),
    opened: [] as Array<Record<string, unknown>>,
    lastFormProps: null as FormProps | null,
    // false: Razorpay's script never finishes loading in this test.
    scriptLoads: true,
    initiated: vi.fn(),
    succeeded: vi.fn(),
    failed: vi.fn(),
    clearPurchased: vi.fn(async () => undefined),
    notePending: vi.fn(async () => undefined),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));
vi.mock('@tanstack/react-query', () => ({
    useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));
vi.mock('../-services/product-page-service', () => ({
    enrollForProductPage: mocks.enroll,
    handleGetProductPage: (code: string, instituteId: string) => ({
        queryKey: ['PRODUCT_PAGE_BY_CODE', code, instituteId],
    }),
}));
vi.mock('@/components/common/enroll-by-invite/-utils/gtm', () => ({
    pushCombinedPaymentInitiated: mocks.initiated,
    pushCombinedEnrollmentSuccess: mocks.succeeded,
    pushCombinedPaymentFailed: mocks.failed,
}));
vi.mock('@/components/common/layout-container/sidebar/utils', () => ({
    getTerminology: () => 'Course',
    getTerminologyPlural: () => 'Courses',
}));
vi.mock('../-utils/site-cart-housekeeping', async (importOriginal: () => Promise<unknown>) => ({
    ...((await importOriginal()) as typeof import('../-utils/site-cart-housekeeping')),
    clearPurchasedFromSiteCart: mocks.clearPurchased,
    notePendingSiteCartPurchase: mocks.notePending,
}));
// Behaves like the real checkout form where it matters: Razorpay's script
// loads after mount, and until it has, openPayment reports an error instead
// of opening anything. The handle is rebuilt on every render.
vi.mock('@/components/common/enroll-by-invite/-components/razorpay-checkout-form', async () => {
    const { forwardRef, useEffect, useImperativeHandle, useState, createElement } = await import('react');
    const RazorpayCheckoutForm = forwardRef((props: FormProps, ref) => {
        const [scriptLoaded, setScriptLoaded] = useState(false);
        useEffect(() => {
            if (mocks.scriptLoads) setScriptLoaded(true);
        }, []);
        mocks.lastFormProps = props;
        useImperativeHandle(ref, () => ({
            openPayment: (details: Record<string, unknown>) => {
                if (!scriptLoaded) {
                    props.onError?.('Payment gateway is not ready');
                    return;
                }
                mocks.opened.push(details);
            },
        }));
        return createElement('div', { 'data-razorpay-form': '' });
    });
    return { RazorpayCheckoutForm };
});

import { CombinedPaymentStep } from './CombinedPaymentStep';
import { useProductPageStore } from '../-stores/product-page-store';
import type { ProductPageData, ProductPageEnrollResponse } from '../-types/product-page-types';

const mapping = (id: string, price: number) => ({
    id: `m-${id}`,
    ps_invite_payment_option_id: `opt-${id}`,
    package_session_id: `ps-${id}`,
    enroll_invite_id: `inv-${id}`,
    payment_option_id: `po-${id}`,
    payment_plan_id: `plan-${id}`,
    payment_plan: { id: `plan-${id}`, name: 'Plan', actual_price: price, currency: 'INR' },
    preselected: false,
    display_order: 0,
    status: 'ACTIVE',
});

const pageFor = (vendor: string): ProductPageData =>
    ({
        id: 'store-1',
        name: 'Store',
        code: 'STORE',
        institute_id: 'inst-1',
        status: 'ACTIVE',
        page_json: null,
        settings_json: null,
        short_url: null,
        mappings: [mapping('a', 1000), mapping('free', 0)],
        aggregated_custom_fields: [],
        vendor,
        currency: 'INR',
        gtm_container_id: null,
    }) as unknown as ProductPageData;

const answer = (fields: Partial<ProductPageEnrollResponse>): ProductPageEnrollResponse => ({
    payment_log_id: 'log-1',
    user_id: 'user-1',
    status: 'PAID',
    message: '',
    enrolled_package_session_ids: ['ps-a'],
    payment_url: null,
    order_id: null,
    razorpay_key_id: null,
    access_token: null,
    refresh_token: null,
    ...fields,
});

const RAZORPAY_ORDER = answer({ status: 'PAYMENT_PENDING', order_id: 'order_1', razorpay_key_id: 'rzp_key' });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let onSuccess = vi.fn();

const flush = () =>
    act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });

const mount = async (
    vendor: string,
    selection: string[],
    state: Partial<ReturnType<typeof useProductPageStore.getState>> = {}
) => {
    useProductPageStore.setState({
        pageData: pageFor(vendor),
        selectedPsOptionIds: selection,
        registrationData: {
            email: { id: 'f1', key: 'email', name: 'Email', value: 'a@b.c', is_mandatory: true, type: 'EMAIL' },
            phone: { id: 'f2', key: 'mobile_number', name: 'Phone', value: '+919999999999', is_mandatory: true, type: 'PHONE' },
        },
        ...state,
    });
    onSuccess = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
        root!.render(
            React.createElement(CombinedPaymentStep, {
                pageData: pageFor(vendor),
                settings: { defaultStep: 'CATALOG', allowCourseDeselection: true } as never,
                instituteId: 'inst-1',
                vendor,
                onBack: () => undefined,
                onSuccess,
            })
        )
    );
    await flush();
};

const pay = async () => {
    const button = [...container!.querySelectorAll('button')].find((b) => b.textContent === 'common.pay');
    expect(button, 'Pay button').toBeTruthy();
    await act(async () => {
        button!.click();
    });
    await flush();
};

const text = () => container!.textContent ?? '';
const razorpayCheckout = () => container!.querySelector('[data-razorpay-form]');

beforeEach(() => {
    useProductPageStore.getState().reset();
    vi.clearAllMocks();
    // clearAllMocks keeps queued once-answers; a test that stops early must
    // not hand its leftovers to the next one.
    mocks.enroll.mockReset();
    mocks.opened.length = 0;
    mocks.lastFormProps = null;
    mocks.scriptLoads = true;
    window.location.hash = '';
});
afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
});

describe('a Razorpay order on a page drawn for another gateway', () => {
    it('opens Razorpay for that order instead of reporting a success', async () => {
        mocks.enroll.mockResolvedValueOnce(RAZORPAY_ORDER);
        await mount('STRIPE', ['opt-a']);
        expect(razorpayCheckout()).toBeNull();

        await pay();

        expect(mocks.enroll).toHaveBeenCalledTimes(1);
        expect(mocks.enroll.mock.calls[0][0].paymentInitiationRequest).toEqual({ vendor: 'STRIPE', amount: 1000, currency: 'INR' });
        expect(onSuccess).not.toHaveBeenCalled();
        expect(mocks.succeeded).not.toHaveBeenCalled();
        expect(mocks.clearPurchased).not.toHaveBeenCalled();
        // Razorpay's checkout took the Pay button's place and opened the
        // server's order once Razorpay had loaded…
        expect(razorpayCheckout()).not.toBeNull();
        expect(mocks.opened).toEqual([
            {
                razorpayKeyId: 'rzp_key',
                razorpayOrderId: 'order_1',
                amount: 100000,
                currency: 'INR',
                contact: '+919999999999',
                email: 'a@b.c',
            },
        ]);
        // …and the wait for the script never reached the screen as an error.
        expect(text()).not.toContain('Payment gateway is not ready');
    });

    it("leaves Razorpay's own Pay button as the way through if the order cannot open by itself", async () => {
        mocks.scriptLoads = false;
        mocks.enroll.mockResolvedValueOnce(RAZORPAY_ORDER).mockResolvedValueOnce(
            answer({ status: 'PAYMENT_PENDING', order_id: 'order_2', razorpay_key_id: 'rzp_key' })
        );
        await mount('STRIPE', ['opt-a']);
        await pay();

        // Nothing opened and nothing failed loudly while Razorpay was loading.
        expect(mocks.opened).toEqual([]);
        expect(text()).not.toContain('Payment gateway is not ready');
        expect(razorpayCheckout()).not.toBeNull();

        // The Pay button now belongs to Razorpay's checkout: a fresh order,
        // whose failure to open is shown rather than swallowed.
        await pay();

        expect(mocks.enroll).toHaveBeenCalledTimes(2);
        expect(mocks.enroll.mock.calls[1][0].paymentInitiationRequest).toEqual({
            vendor: 'RAZORPAY',
            amount: 1000,
            currency: 'INR',
            razorpay_request: {},
        });
        expect(text()).toContain('Payment gateway is not ready');
        expect(onSuccess).not.toHaveBeenCalled();
    });

    it('enrols once the learner pays in Razorpay (Phase 2)', async () => {
        mocks.enroll.mockResolvedValueOnce(RAZORPAY_ORDER).mockResolvedValueOnce(answer({ status: 'PAID' }));
        await mount('STRIPE', ['opt-a']);
        await pay();

        await act(async () => {
            mocks.lastFormProps!.onPaymentReady!({
                razorpay_payment_id: 'pay_1',
                razorpay_order_id: 'order_1',
                razorpay_signature: 'sig',
            });
        });
        await flush();

        expect(mocks.enroll).toHaveBeenCalledTimes(2);
        expect(mocks.enroll.mock.calls[1][0].paymentInitiationRequest).toMatchObject({
            vendor: 'RAZORPAY',
            razorpay_request: { razorpay_payment_id: 'pay_1', razorpay_order_id: 'order_1' },
        });
        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(mocks.clearPurchased).toHaveBeenCalledWith(['inst-1', 'inst-1'], ['ps-a']);
    });

    it('shows the cancelled payment like the Razorpay page does', async () => {
        mocks.enroll.mockResolvedValueOnce(RAZORPAY_ORDER);
        await mount('STRIPE', ['opt-a']);
        await pay();

        await act(async () => {
            mocks.lastFormProps!.onError!('Payment cancelled');
        });

        expect(text()).toContain('Payment cancelled');
        expect(onSuccess).not.toHaveBeenCalled();
    });

    it('shows the generic error when the order cannot be opened (no key)', async () => {
        mocks.enroll.mockResolvedValueOnce(answer({ status: 'PAYMENT_PENDING', order_id: 'order_1', razorpay_key_id: null }));
        await mount('STRIPE', ['opt-a']);

        await pay();

        expect(text()).toContain('common.genericPaymentFailed');
        expect(onSuccess).not.toHaveBeenCalled();
        expect(mocks.succeeded).not.toHaveBeenCalled();
        expect(mocks.failed).toHaveBeenCalledWith('common.genericPaymentFailed', 'STRIPE', {});
        expect(mocks.opened).toEqual([]);
    });

    it('never charges a basket this page showed as free: it refreshes the prices instead', async () => {
        mocks.enroll.mockResolvedValueOnce(RAZORPAY_ORDER);
        // The free course: the step enrols on mount.
        await mount('RAZORPAY', ['opt-free']);

        expect(mocks.enroll).toHaveBeenCalledTimes(1);
        expect(mocks.enroll.mock.calls[0][0].paymentInitiationRequest).toMatchObject({ vendor: 'FREE', amount: 0 });
        expect(onSuccess).not.toHaveBeenCalled();
        expect(mocks.opened).toEqual([]);
        expect(text()).toContain('common.priceChangedReload');
        expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ['PRODUCT_PAGE_BY_CODE', 'STORE', 'inst-1'] });
    });

    it('drops a coupon that made the basket look free, so the next attempt is priced without it', async () => {
        // The coupon no longer takes off what it did when it was applied. A
        // refetch of the page cannot correct that: the page comes back the
        // same, and every retry would ask for another unpaid order.
        mocks.enroll
            .mockResolvedValueOnce(RAZORPAY_ORDER)
            .mockResolvedValueOnce(answer({ status: 'PAYMENT_PENDING', order_id: 'order_2', razorpay_key_id: 'rzp_key' }));
        await mount('RAZORPAY', ['opt-a'], {
            couponCode: 'FREE100',
            couponId: 'coupon-1',
            appliedCouponDiscountId: 'applied-1',
            discountAmount: 1000,
        });

        expect(mocks.enroll).toHaveBeenCalledTimes(1);
        expect(mocks.enroll.mock.calls[0][0]).toMatchObject({
            couponCode: 'FREE100',
            paymentInitiationRequest: { vendor: 'FREE', amount: 0 },
        });
        expect(onSuccess).not.toHaveBeenCalled();
        expect(mocks.opened).toEqual([]);
        expect(useProductPageStore.getState()).toMatchObject({
            couponCode: '',
            couponId: '',
            appliedCouponDiscountId: '',
            discountAmount: 0,
        });
        expect(text()).toContain('cartStep.couponChanged');
        expect(text()).not.toContain('common.priceChangedReload');
        // The page is still refetched, in case its prices moved as well.
        expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ['PRODUCT_PAGE_BY_CODE', 'STORE', 'inst-1'] });

        // The step now asks for the real price, and paying it opens Razorpay.
        await pay();

        expect(mocks.enroll).toHaveBeenCalledTimes(2);
        expect(mocks.enroll.mock.calls[1][0].couponCode).toBeUndefined();
        expect(mocks.enroll.mock.calls[1][0].paymentInitiationRequest).toEqual({
            vendor: 'RAZORPAY',
            amount: 1000,
            currency: 'INR',
            razorpay_request: {},
        });
        expect(mocks.opened).toEqual([expect.objectContaining({ razorpayOrderId: 'order_2', amount: 100000 })]);
    });
});

describe('answers that already worked keep working exactly as before', () => {
    it('a synchronous charge (Stripe, Eway) finishes and clears the site cart', async () => {
        mocks.enroll.mockResolvedValueOnce(answer({ status: 'PAID' }));
        await mount('STRIPE', ['opt-a']);

        await pay();

        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(mocks.succeeded).toHaveBeenCalledWith(1000, 1, {});
        expect(mocks.clearPurchased).toHaveBeenCalledWith(['inst-1', 'inst-1'], ['ps-a']);
        expect(razorpayCheckout()).toBeNull();
    });

    it('a payment recorded to settle later (INITIATED) finishes without clearing the cart', async () => {
        mocks.enroll.mockResolvedValueOnce(answer({ status: 'INITIATED' }));
        await mount('MANUAL', ['opt-a']);

        await pay();

        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(mocks.clearPurchased).not.toHaveBeenCalled();
    });

    it('a free basket enrols on mount', async () => {
        mocks.enroll.mockResolvedValueOnce(answer({ status: 'PAID', enrolled_package_session_ids: ['ps-free'] }));
        await mount('RAZORPAY', ['opt-free']);

        expect(mocks.enroll.mock.calls[0][0].paymentInitiationRequest).toEqual({ vendor: 'FREE', amount: 0, currency: 'INR' });
        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(mocks.clearPurchased).toHaveBeenCalledWith(['inst-1', 'inst-1'], ['ps-free']);
    });

    it('a hosted payment page is followed, with the purchase noted for the site cart', async () => {
        mocks.enroll.mockResolvedValueOnce(
            answer({ status: 'PAYMENT_PENDING', payment_url: 'http://localhost:3000/#gateway', payment_log_id: 'log-9' })
        );
        await mount('CASHFREE', ['opt-a']);

        await pay();

        expect(mocks.notePending).toHaveBeenCalledWith({
            paymentLogId: 'log-9',
            instituteIds: ['inst-1', 'inst-1'],
            packageSessionIds: ['ps-a'],
        });
        expect(window.location.hash).toBe('#gateway');
        expect(onSuccess).not.toHaveBeenCalled();
    });

    it('the Razorpay page opens its own checkout for its order', async () => {
        mocks.enroll.mockResolvedValueOnce(RAZORPAY_ORDER);
        await mount('RAZORPAY', ['opt-a']);
        expect(razorpayCheckout()).not.toBeNull();

        await pay();

        expect(mocks.enroll.mock.calls[0][0].paymentInitiationRequest).toEqual({
            vendor: 'RAZORPAY',
            amount: 1000,
            currency: 'INR',
            razorpay_request: {},
        });
        expect(mocks.opened).toEqual([expect.objectContaining({ razorpayOrderId: 'order_1', razorpayKeyId: 'rzp_key', amount: 100000 })]);
        expect(onSuccess).not.toHaveBeenCalled();
    });

    it('the Razorpay page finishes once Razorpay confirms the payment (Phase 2)', async () => {
        mocks.enroll.mockResolvedValueOnce(RAZORPAY_ORDER).mockResolvedValueOnce(answer({ status: 'PAID' }));
        await mount('RAZORPAY', ['opt-a']);
        await pay();

        await act(async () => {
            mocks.lastFormProps!.onPaymentReady!({
                razorpay_payment_id: 'pay_1',
                razorpay_order_id: 'order_1',
                razorpay_signature: 'sig',
            });
        });
        await flush();

        expect(mocks.enroll.mock.calls[1][0].paymentInitiationRequest).toEqual({
            vendor: 'RAZORPAY',
            amount: 1000,
            currency: 'INR',
            razorpay_request: { razorpay_payment_id: 'pay_1', razorpay_order_id: 'order_1', razorpay_signature: 'sig' },
        });
        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(mocks.clearPurchased).toHaveBeenCalledWith(['inst-1', 'inst-1'], ['ps-a']);
    });
});

describe('the Razorpay page when the server charges through another gateway', () => {
    it('follows the payment page the server answered with', async () => {
        mocks.enroll.mockResolvedValueOnce(
            answer({ status: 'PAYMENT_PENDING', payment_url: 'http://localhost:3000/#phonepe', payment_log_id: 'log-2' })
        );
        await mount('RAZORPAY', ['opt-a']);

        await pay();

        expect(window.location.hash).toBe('#phonepe');
        expect(mocks.notePending).toHaveBeenCalledWith(expect.objectContaining({ paymentLogId: 'log-2' }));
        expect(mocks.opened).toEqual([]);
    });

    it('finishes an enrolment the server already completed', async () => {
        mocks.enroll.mockResolvedValueOnce(answer({ status: 'PAID' }));
        await mount('RAZORPAY', ['opt-a']);

        await pay();

        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(mocks.opened).toEqual([]);
    });

    it('says so when the order it got back cannot be opened', async () => {
        mocks.enroll.mockResolvedValueOnce(answer({ status: 'PAYMENT_PENDING', order_id: 'order_1', razorpay_key_id: null }));
        await mount('RAZORPAY', ['opt-a']);

        await pay();

        expect(text()).toContain('common.couldNotInitiatePayment');
        expect(onSuccess).not.toHaveBeenCalled();
        expect(mocks.opened).toEqual([]);
    });
});

describe('failures', () => {
    const axiosError = (status: number, data: unknown) => {
        const err = new AxiosError(`Request failed with status code ${status}`);
        err.response = { status, data, statusText: '', headers: {}, config: { headers: new AxiosHeaders() } };
        return err;
    };

    it("shows the translated message, not the server's raw exception text", async () => {
        mocks.enroll.mockRejectedValueOnce(axiosError(511, { ex: 'could not execute statement [insert into user_plan …]' }));
        await mount('STRIPE', ['opt-a']);

        await pay();

        expect(text()).toContain('common.genericPaymentFailed');
        expect(text()).not.toContain('insert into user_plan');
        expect(mocks.invalidate).not.toHaveBeenCalled();
    });

    it('refreshes the page on a 409 and shows why', async () => {
        mocks.enroll.mockRejectedValueOnce(axiosError(409, { ex: 'The price of a course in your cart has changed.' }));
        await mount('STRIPE', ['opt-a']);

        await pay();

        expect(text()).toContain('The price of a course in your cart has changed.');
        expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ['PRODUCT_PAGE_BY_CODE', 'STORE', 'inst-1'] });
    });
});
