import { describe, expect, it } from 'vitest';
import {
    filterPlans,
    normalizePlanType,
    sortPlansNewestFirst,
    splitPlansByType,
    type PaymentOption,
} from './helper';

/**
 * The "Select a Payment Plan" picker sorts newest-first, searches by name and
 * filters by type. The backend already orders by created_at, but a plan appended
 * locally after "Add New Payment Plan" has no date yet and legacy rows carry
 * lowercase types — both would silently misplace or hide a plan.
 */
describe('sortPlansNewestFirst', () => {
    it('orders by createdAt descending and floats undated plans (just created) to the top', () => {
        const sorted = sortPlansNewestFirst([
            { id: 'old', createdAt: '2026-01-01T00:00:00Z' },
            { id: 'new', createdAt: '2026-09-01T00:00:00Z' },
            { id: 'local' },
            { id: 'mid', createdAt: '2026-05-01T00:00:00Z' },
        ]);
        expect(sorted.map((p) => p.id)).toEqual(['local', 'new', 'mid', 'old']);
    });

    it('is stable for ties so the backend order survives', () => {
        const sorted = sortPlansNewestFirst([
            { id: 'a', createdAt: '2026-09-01T00:00:00Z' },
            { id: 'b', createdAt: '2026-09-01T00:00:00Z' },
            { id: 'c', createdAt: 'not a date' },
        ]);
        expect(sorted.map((p) => p.id)).toEqual(['c', 'a', 'b']);
    });
});

describe('normalizePlanType', () => {
    it('maps legacy lowercase and upfront spellings onto the five filter values', () => {
        expect(normalizePlanType('free')).toBe('FREE');
        expect(normalizePlanType('FREE')).toBe('FREE');
        expect(normalizePlanType('upfront')).toBe('ONE_TIME');
        expect(normalizePlanType('ONE_TIME')).toBe('ONE_TIME');
        expect(normalizePlanType('donation')).toBe('DONATION');
        expect(normalizePlanType('SUBSCRIPTION')).toBe('SUBSCRIPTION');
        expect(normalizePlanType('CPO')).toBe('CPO');
        expect(normalizePlanType(undefined)).toBeNull();
        expect(normalizePlanType('')).toBeNull();
    });
});

describe('filterPlans', () => {
    const plans = [
        { id: '1', name: 'Annual Membership', type: 'SUBSCRIPTION' },
        { id: '2', name: 'Focus on Dentistry 2026', type: 'ONE_TIME' },
        { id: '3', name: 'Old upfront', type: 'upfront' },
        { id: '4', name: 'Institute Payment Option', type: 'FREE' },
    ];

    it('matches the name case-insensitively as a substring', () => {
        expect(filterPlans(plans, '  dentistry ', null).map((p) => p.id)).toEqual(['2']);
        expect(filterPlans(plans, 'MEMBER', null).map((p) => p.id)).toEqual(['1']);
    });

    it('filters by normalised type, so ONE_TIME also finds legacy upfront rows', () => {
        expect(filterPlans(plans, '', 'ONE_TIME').map((p) => p.id)).toEqual(['2', '3']);
        expect(filterPlans(plans, '', 'FREE').map((p) => p.id)).toEqual(['4']);
    });

    it('combines search and type, and an empty query with no type returns everything', () => {
        expect(filterPlans(plans, 'old', 'ONE_TIME').map((p) => p.id)).toEqual(['3']);
        expect(filterPlans(plans, '', null)).toHaveLength(4);
    });
});

describe('splitPlansByType provenance', () => {
    it('carries created date and creator onto every picker plan', () => {
        const base = {
            status: 'ACTIVE',
            source: 'INSTITUTE',
            source_id: 'inst',
            tag: '',
            require_approval: false,
            payment_plans: [],
            created_at: '2026-09-11T08:53:52.705+00:00',
            created_by_user_id: 'u-1',
            created_by_name: 'Neeraj',
        };
        const data: PaymentOption[] = [
            {
                ...base,
                id: 'free',
                name: 'Free',
                type: 'FREE',
                payment_option_metadata_json: JSON.stringify({ freeData: { validityDays: 30 } }),
            },
            {
                ...base,
                id: 'one',
                name: 'One-time',
                type: 'ONE_TIME',
                payment_option_metadata_json: JSON.stringify({
                    currency: 'AUD',
                    upfrontData: { fullPrice: '99' },
                }),
            },
            {
                ...base,
                id: 'cpo',
                name: 'Fee plan',
                type: 'CPO',
                payment_option_metadata_json: '',
                complex_payment_option_id: 'cpo-1',
                payment_plans: [{ actual_price: 1200, currency: 'INR' } as never],
            },
        ];
        const { freePlans, paidPlans } = splitPlansByType(data);
        for (const plan of [...freePlans, ...paidPlans]) {
            expect(plan.createdAt).toBe(base.created_at);
            expect(plan.createdByUserId).toBe('u-1');
            expect(plan.createdByName).toBe('Neeraj');
        }
        expect(paidPlans.map((p) => p.id)).toEqual(['one', 'cpo']);
    });
});
