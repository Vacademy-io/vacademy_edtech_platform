import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/axiosInstance', () => ({
    default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

import {
    apiErrorCode,
    isLiveSubscription,
    isPayableCharge,
    normalizeBillingDocuments,
    normalizeIndianMobile,
    normalizeStorefront,
} from './storefront';
import {
    parsePlanReturn,
    pollDelayMs,
} from '@/routes/settings/-components/ai-plan/plan-payment-return';

const PLAN = {
    plan_id: 'p-pro',
    plan_key: 'pro',
    plan_version_id: 'v-pro-2',
    name: 'AI Pro',
    period_months: 1,
    price: { base_minor: 500000, tax_minor: 90000, total_minor: 590000, tax_rate_bps: 1800 },
    allowance_credits: 2000,
    features: [
        {
            feature_key: 'chat',
            tenant_label: 'Assistant',
            mode: 'INCLUDED',
            display_cap_text: '500 a day',
        },
        { feature_key: 'video', label: 'Video', mode: 'weird' },
    ],
    action: 'SUBSCRIBE',
    sort_order: 20,
};

describe('normalizeStorefront', () => {
    it('is null (no storefront) for anything that is not a catalog', () => {
        expect(normalizeStorefront(null)).toBeNull();
        expect(normalizeStorefront('oops')).toBeNull();
        expect(normalizeStorefront({ brand_mode: 'VACADEMY' })).toBeNull();
    });

    it('parses plans, tenant labels and unknown modes safely', () => {
        const sf = normalizeStorefront({ brand_mode: 'NEUTRAL', plans: [PLAN] });
        expect(sf).not.toBeNull();
        const p = sf!.plans[0]!;
        expect(p.price.total_minor).toBe(590000);
        expect(p.features[0]).toMatchObject({ label: 'Assistant', mode: 'INCLUDED' });
        // An unknown mode is never shown as "Unlimited".
        expect(p.features[1]!.mode).toBe('CHARGED');
        expect(p.action).toBe('SUBSCRIBE');
    });

    it('anything but an explicit VACADEMY is NEUTRAL', () => {
        expect(normalizeStorefront({ plans: [] })!.brand_mode).toBe('NEUTRAL');
        expect(normalizeStorefront({ brand_mode: 'vacademy', plans: [] })!.brand_mode).toBe(
            'VACADEMY'
        );
        expect(normalizeStorefront({ brand_mode: 'OTHER', plans: [] })!.brand_mode).toBe('NEUTRAL');
    });

    it('marks the current plan from the subscription and sorts by sort_order then price', () => {
        const cheap = {
            ...PLAN,
            plan_version_id: 'v-lite',
            name: 'AI Lite',
            sort_order: 20,
            price: { base_minor: 100000, total_minor: 118000 },
        };
        const sf = normalizeStorefront({
            plans: [PLAN, cheap],
            subscription: {
                id: 's1',
                status: 'active',
                plan_version_id: 'v-pro-2',
                plan_name: 'AI Pro',
            },
        })!;
        expect(sf.plans.map((p) => p.name)).toEqual(['AI Lite', 'AI Pro']);
        expect(sf.plans[1]!.is_current).toBe(true);
        expect(sf.plans[1]!.action).toBe('CURRENT');
        expect(sf.subscription!.status).toBe('ACTIVE');
        expect(isLiveSubscription(sf.subscription)).toBe(true);
        // The server's action is kept as sent...
        expect(sf.plans[0]!.action).toBe('SUBSCRIBE');
        // ...but with none, while subscribed, the card never offers a self-serve purchase.
        const noAction = normalizeStorefront({
            plans: [{ ...cheap, action: undefined }],
            subscription: { id: 's1', status: 'ACTIVE', plan_version_id: 'v-pro-2' },
        })!;
        expect(noAction.plans[0]!.action).toBe('CONTACT_SALES');
    });

    it('defaults autopay off with the Rs 15,000 ceiling', () => {
        const sf = normalizeStorefront({ plans: [] })!;
        expect(sf.autopay).toEqual({ enabled: false, max_debit_minor: 1_500_000 });
    });

    it('accepts camelCase from the facade too', () => {
        const sf = normalizeStorefront({
            brandMode: 'NEUTRAL',
            plans: [
                {
                    planVersionId: 'v1',
                    name: 'X',
                    price: { baseMinor: 100, taxMinor: 18, totalMinor: 118 },
                },
            ],
            openCharge: {
                chargeId: 'c1',
                status: 'link_sent',
                totalMinor: 118,
                paymentLinkUrl: 'https://rzp.io/x',
            },
        })!;
        expect(sf.plans[0]!.price.total_minor).toBe(118);
        expect(sf.open_charge).toMatchObject({
            charge_id: 'c1',
            status: 'LINK_SENT',
            link_url: 'https://rzp.io/x',
        });
        expect(isPayableCharge(sf.open_charge)).toBe(true);
    });
});

describe('isPayableCharge', () => {
    it('autopay debits in flight and settled charges are not payable by link', () => {
        const c = {
            charge_id: 'c',
            kind: 'PERIOD',
            total_minor: 1,
            currency: 'INR',
            due_at: null,
            link_url: null,
            platform_payment_id: null,
            next_attempt_at: null,
        };
        expect(isPayableCharge({ ...c, status: 'DUE' })).toBe(true);
        expect(isPayableCharge({ ...c, status: 'FAILED' })).toBe(true);
        expect(isPayableCharge({ ...c, status: 'DEBIT_SCHEDULED' })).toBe(false);
        expect(isPayableCharge({ ...c, status: 'PAID' })).toBe(false);
        expect(isPayableCharge(null)).toBe(false);
    });
});

describe('normalizeBillingDocuments', () => {
    it('merges invoices and credit notes from either response shape', () => {
        const flat = normalizeBillingDocuments([
            {
                id: 'i1',
                doc_type: 'INVOICE',
                item_kind: 'AI_SUBSCRIPTION',
                number: 'VT/2026-27/I00001',
                total_minor: 590000,
            },
            { id: 'c1', doc_type: 'CREDIT_NOTE', number: 'VT/2026-27/C00001', total_minor: 590000 },
        ]);
        expect(flat.map((d) => d.doc_type)).toEqual(['INVOICE', 'CREDIT_NOTE']);
        const split = normalizeBillingDocuments({
            invoices: [{ invoice_id: 'i1', invoice_number: 'N1', total_amount_minor: 5 }],
            credit_notes: [
                { credit_note_id: 'c1', credit_note_number: 'C1', total_amount_minor: 5 },
            ],
        });
        expect(split).toHaveLength(2);
        expect(split[1]).toMatchObject({ id: 'c1', doc_type: 'CREDIT_NOTE', number: 'C1' });
        expect(normalizeBillingDocuments({ nope: true })).toEqual([]);
    });
});

describe('apiErrorCode / normalizeIndianMobile', () => {
    it('reads the facade code, else a code in the message, else 404 = STOREFRONT_OFF', () => {
        expect(
            apiErrorCode({ response: { status: 409, data: { code: 'ALREADY_SUBSCRIBED' } } })
        ).toBe('ALREADY_SUBSCRIBED');
        expect(
            apiErrorCode({
                response: { status: 422, data: { ex: 'BUYER_STATE_REQUIRED: pick a state' } },
            })
        ).toBe('BUYER_STATE_REQUIRED');
        expect(apiErrorCode({ response: { status: 404, data: {} } })).toBe('STOREFRONT_OFF');
        expect(apiErrorCode(new Error('x'))).toBeNull();
    });

    it('accepts Indian mobiles in common spellings only', () => {
        expect(normalizeIndianMobile('+91 98765 43210')).toBe('9876543210');
        expect(normalizeIndianMobile('09876543210')).toBe('9876543210');
        expect(normalizeIndianMobile('5876543210')).toBeNull();
        expect(normalizeIndianMobile('98765')).toBeNull();
    });
});

describe('plan payment return', () => {
    it('reads plan_pp, the autopay marker, or a Razorpay return with a remembered payment', () => {
        expect(parsePlanReturn('?plan_pp=pp1&razorpay_payment_link_status=paid', null)).toEqual({
            paymentId: 'pp1',
            mandate: false,
            linkStatus: 'paid',
        });
        expect(parsePlanReturn('?plan_mandate=1', null)).toMatchObject({
            paymentId: null,
            mandate: true,
        });
        expect(parsePlanReturn('?razorpay_payment_id=pay_1', 'pp9')).toMatchObject({
            paymentId: 'pp9',
        });
        expect(parsePlanReturn('?razorpay_payment_id=pay_1', null)).toBeNull();
        expect(parsePlanReturn('?selectedTab=aiSettings', 'pp9')).toBeNull();
    });

    it('polls quickly, then backs off, then stops after ten minutes', () => {
        expect(pollDelayMs(0)).toBe(2_000);
        expect(pollDelayMs(60_000)).toBe(5_000);
        expect(pollDelayMs(300_000)).toBe(15_000);
        expect(pollDelayMs(600_000)).toBeNull();
    });
});
