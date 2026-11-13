import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    clearPlanBuyIntent,
    isPaidPlanKey,
    rememberPlanBuyIntent,
    takePlanBuyIntent,
} from './plan-buy-intent';
import { findPlanByKey, type StorefrontPlan } from '@/services/ai-plans/storefront';

const plan = (plan_key: string) => ({ plan_key }) as StorefrontPlan;

describe('plan buy intent', () => {
    afterEach(() => {
        localStorage.clear();
        vi.useRealTimers();
    });

    it('treats trial and junk as no purchase', () => {
        expect(isPaidPlanKey('team')).toBe(true);
        expect(isPaidPlanKey('trial')).toBe(false);
        expect(isPaidPlanKey('')).toBe(false);
        expect(isPaidPlanKey(undefined)).toBe(false);
        expect(isPaidPlanKey('<script>')).toBe(false);
    });

    it('is read once, for the same product only', () => {
        rememberPlanBuyIntent('Team', 'evalezy');
        expect(takePlanBuyIntent('other')).toBeNull();
        rememberPlanBuyIntent('Team', 'evalezy');
        expect(takePlanBuyIntent('evalezy')).toBe('team');
        expect(takePlanBuyIntent('evalezy')).toBeNull();
    });

    it('expires after a day and is cleared by a trial sign-up', () => {
        vi.useFakeTimers();
        rememberPlanBuyIntent('starter', 'evalezy');
        vi.advanceTimersByTime(25 * 60 * 60 * 1000);
        expect(takePlanBuyIntent('evalezy')).toBeNull();
        rememberPlanBuyIntent('starter', 'evalezy');
        clearPlanBuyIntent();
        expect(takePlanBuyIntent('evalezy')).toBeNull();
    });
});

describe('findPlanByKey', () => {
    const plans = [plan('evalezy_starter'), plan('evalezy_team'), plan('team')];
    it('prefers an exact key, then a product-prefixed one', () => {
        expect(findPlanByKey(plans, 'team')?.plan_key).toBe('team');
        expect(findPlanByKey(plans, 'Starter')?.plan_key).toBe('evalezy_starter');
        expect(findPlanByKey(plans, 'pro')).toBeNull();
        expect(findPlanByKey(plans, null)).toBeNull();
    });
});
