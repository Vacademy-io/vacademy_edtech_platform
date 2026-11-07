// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// React 19 requires this before act(); the repo has no shared test setup file.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AxiosError, AxiosHeaders } from 'axios';

type FormProps = { onPaymentReady?: (data: Record<string, string>) => void };

const mocks = vi.hoisted(() => ({
    enrollCpo: vi.fn(),
    invalidate: vi.fn(),
    schedule: vi.fn(),
    dues: vi.fn(),
    pay: vi.fn(),
    opened: [] as Array<Record<string, unknown>>,
    lastFormProps: null as FormProps | null,
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
    enrollCpoForProductPage: mocks.enrollCpo,
    handleGetProductPage: (code: string, instituteId: string) => ({
        queryKey: ['PRODUCT_PAGE_BY_CODE', code, instituteId],
    }),
}));
vi.mock('@/components/common/enroll-by-invite/-services/enroll-invite-services', () => ({
    fetchCpoSchedule: mocks.schedule,
    fetchCpoDues: mocks.dues,
    payCpoInstallments: mocks.pay,
    mapCpoScheduleToDues: () => [],
}));
vi.mock('@/components/common/enroll-by-invite/-components', () => ({
    CpoInstallmentSelectionStep: () => null,
}));
vi.mock('@/components/common/enroll-by-invite/-components/razorpay-checkout-form', async () => {
    const { forwardRef, useImperativeHandle, createElement } = await import('react');
    const RazorpayCheckoutForm = forwardRef((props: FormProps, ref) => {
        mocks.lastFormProps = props;
        useImperativeHandle(ref, () => ({
            openPayment: (details: Record<string, unknown>) => mocks.opened.push(details),
        }));
        return createElement('div', { 'data-razorpay-form': '' });
    });
    return { RazorpayCheckoutForm };
});
vi.mock('../-utils/site-cart-housekeeping', async (importOriginal: () => Promise<unknown>) => ({
    ...((await importOriginal()) as typeof import('../-utils/site-cart-housekeeping')),
    clearPurchasedFromSiteCart: mocks.clearPurchased,
    notePendingSiteCartPurchase: mocks.notePending,
}));

import { CpoInstallmentsCheckoutStep } from './CpoInstallmentsCheckoutStep';
import { useProductPageStore } from '../-stores/product-page-store';
import type { ProductPageData } from '../-types/product-page-types';

/** The page as by-code returned it: one CPO mapping, sold on `planId`. */
const pageWith = (vendor: string, planId: string): ProductPageData =>
    ({
        id: 'page-1',
        name: 'Diploma',
        code: 'DIPLOMA',
        institute_id: 'inst-1',
        status: 'ACTIVE',
        page_json: null,
        settings_json: null,
        short_url: null,
        mappings: [
            {
                id: 'm-cpo',
                ps_invite_payment_option_id: 'opt-cpo',
                package_session_id: 'ps-cpo',
                enroll_invite_id: 'inv-cpo',
                payment_option_id: 'po-cpo',
                payment_option_type: 'CPO',
                payment_plan_id: planId,
                payment_plan: { id: planId, name: 'Plan', actual_price: 30000, currency: 'INR' },
                preselected: true,
                display_order: 0,
                status: 'ACTIVE',
            },
        ],
        aggregated_custom_fields: [],
        vendor,
        currency: 'INR',
        gtm_container_id: null,
    }) as unknown as ProductPageData;

const axiosError = (status: number, data: unknown) => {
    const err = new AxiosError(`Request failed with status code ${status}`);
    err.response = { status, data, statusText: '', headers: {}, config: { headers: new AxiosHeaders() } };
    return err;
};

const PRICE_CHANGED = 'The price of a course in your cart has changed. Please reload the page and try again.';
const BY_CODE = { queryKey: ['PRODUCT_PAGE_BY_CODE', 'DIPLOMA', 'inst-1'] };

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let onSuccess = vi.fn();

const flush = () =>
    act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });

const element = (vendor: string, planId: string) =>
    React.createElement(CpoInstallmentsCheckoutStep, {
        pageData: pageWith(vendor, planId),
        settings: { defaultStep: 'CATALOG', allowCourseDeselection: true } as never,
        vendor,
        onBack: () => undefined,
        onSuccess,
    });

const mount = async (vendor: string, planId = 'plan-old') => {
    useProductPageStore.setState({
        selectedPsOptionIds: ['opt-cpo'],
        registrationData: {
            email: { id: 'f1', key: 'email', name: 'Email', value: 'a@b.c', is_mandatory: true, type: 'EMAIL' },
        },
        // The learner picked the first installment.
        cpoSelectedSfpIds: ['tpl-1'],
        cpoSelectedTotal: 10000,
    } as never);
    onSuccess = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(element(vendor, planId)));
    await flush();
};

/** The page's data after a refetch: by-code now sells the mapping on `planId`. */
const refetchedPage = async (vendor: string, planId: string) => {
    act(() => root!.render(element(vendor, planId)));
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

beforeEach(() => {
    useProductPageStore.getState().reset();
    vi.clearAllMocks();
    mocks.enrollCpo.mockReset();
    mocks.dues.mockReset();
    mocks.pay.mockReset();
    mocks.schedule.mockReset();
    mocks.schedule.mockResolvedValue({ id: 'cpo-1', fee_types: [] });
    mocks.dues.mockResolvedValue([{ id: 'sfp-1', status: 'PENDING' }]);
    mocks.opened.length = 0;
    mocks.lastFormProps = null;
});
afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
});

describe('a plan that changed while the page was open (409)', () => {
    it('says why instead of the transport error, refetches the page, and the retry sends the current plan', async () => {
        mocks.enrollCpo.mockRejectedValueOnce(axiosError(409, { ex: PRICE_CHANGED }));
        await mount('STRIPE');

        await pay();

        expect(mocks.enrollCpo).toHaveBeenCalledWith(expect.objectContaining({ paymentPlanId: 'plan-old' }));
        expect(text()).toContain(PRICE_CHANGED);
        expect(text()).not.toContain('Request failed with status code');
        expect(mocks.invalidate).toHaveBeenCalledWith(BY_CODE);
        expect(mocks.pay).not.toHaveBeenCalled();

        // The refetched page sells the mapping on its new plan; paying again uses it.
        await refetchedPage('STRIPE', 'plan-new');
        mocks.enrollCpo.mockResolvedValueOnce({ user_id: 'user-1', user_plan_id: 'up-1' });
        mocks.pay.mockResolvedValueOnce({ status: 'PAID', order_id: 'log-1' });
        await pay();

        expect(mocks.enrollCpo).toHaveBeenCalledTimes(2);
        expect(mocks.enrollCpo.mock.calls[1][0]).toMatchObject({ paymentPlanId: 'plan-new' });
        expect(mocks.pay).toHaveBeenCalledWith(expect.objectContaining({ userPlanId: 'up-1', studentFeePaymentIds: ['sfp-1'] }));
        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(text()).not.toContain(PRICE_CHANGED);
    });

    it('does the same before a Razorpay order is opened', async () => {
        mocks.enrollCpo.mockRejectedValueOnce(axiosError(409, {}));
        await mount('RAZORPAY');

        await pay();

        // No server words: the translated notice.
        expect(text()).toContain('common.priceChangedReload');
        expect(mocks.invalidate).toHaveBeenCalledWith(BY_CODE);
        expect(mocks.opened).toEqual([]);

        await refetchedPage('RAZORPAY', 'plan-new');
        mocks.enrollCpo.mockResolvedValueOnce({ user_id: 'user-1', user_plan_id: 'up-1' });
        mocks.pay.mockResolvedValueOnce({ order_id: 'order_1', razorpay_key_id: 'rzp_key' });
        await pay();

        expect(mocks.enrollCpo.mock.calls[1][0]).toMatchObject({ paymentPlanId: 'plan-new' });
        expect(mocks.opened).toEqual([expect.objectContaining({ razorpayOrderId: 'order_1', razorpayKeyId: 'rzp_key' })]);
    });
});

describe('other failures', () => {
    it("shows the translated message, not the server's raw exception text, and refetches nothing", async () => {
        mocks.enrollCpo.mockRejectedValueOnce(axiosError(511, { ex: 'could not execute statement [insert into user_plan …]' }));
        await mount('STRIPE');

        await pay();

        expect(text()).toContain('common.genericPaymentFailed');
        expect(text()).not.toContain('insert into user_plan');
        expect(mocks.invalidate).not.toHaveBeenCalled();
    });

    it("shows the server's explanation of a refused request", async () => {
        mocks.enrollCpo.mockResolvedValueOnce({ user_id: 'user-1', user_plan_id: 'up-1' });
        mocks.pay.mockRejectedValueOnce(axiosError(400, { message: 'This installment is already paid.' }));
        await mount('STRIPE');

        await pay();

        expect(text()).toContain('This installment is already paid.');
        expect(mocks.invalidate).not.toHaveBeenCalled();
    });

    it('says a failed Razorpay start in its own words when the network fails', async () => {
        mocks.enrollCpo.mockRejectedValueOnce(new AxiosError('Network Error', 'ERR_NETWORK'));
        await mount('RAZORPAY');

        await pay();

        expect(text()).toContain('common.couldNotInitiatePayment');
        expect(text()).not.toContain('Network Error');
    });

    it("keeps the step's own explanations", async () => {
        mocks.enrollCpo.mockResolvedValueOnce({ user_id: 'user-1', user_plan_id: 'up-1' });
        mocks.dues.mockResolvedValueOnce([{ id: 'sfp-1', status: 'PAID' }]);
        await mount('STRIPE');

        await pay();

        expect(text()).toContain('cpoInstallments.noPendingInstallmentsFound');
        expect(mocks.pay).not.toHaveBeenCalled();
    });

    it('explains a failed Razorpay confirmation without the transport error', async () => {
        mocks.enrollCpo.mockResolvedValueOnce({ user_id: 'user-1', user_plan_id: 'up-1' });
        mocks.pay.mockResolvedValueOnce({ order_id: 'order_1', razorpay_key_id: 'rzp_key' });
        await mount('RAZORPAY');
        await pay();
        expect(mocks.opened).toHaveLength(1);

        mocks.pay.mockRejectedValueOnce(axiosError(502, '<html>Bad gateway</html>'));
        await act(async () => {
            mocks.lastFormProps!.onPaymentReady!({
                razorpay_payment_id: 'pay_1',
                razorpay_order_id: 'order_1',
                razorpay_signature: 'sig',
            });
        });
        await flush();

        expect(text()).toContain('cpoInstallments.paymentConfirmationFailed');
        expect(text()).not.toContain('Request failed with status code');
        expect(onSuccess).not.toHaveBeenCalled();
    });
});
