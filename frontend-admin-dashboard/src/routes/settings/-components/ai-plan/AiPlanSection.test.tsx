import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import planStrings from '../../../../../public/locales/en/settingsAiPlan.json';
import usageStrings from '../../../../../public/locales/en/aiCreditsUsage.json';

/** Resolve against the REAL en catalogues so a missing key shows up as a raw key. */
function translatorFor(ns: string) {
    const catalog = (ns === 'aiCreditsUsage' ? usageStrings : planStrings) as unknown;
    return (key: string, vars?: Record<string, unknown>): string => {
        const value = key.split('.').reduce<unknown>((node, part) => {
            if (node && typeof node === 'object') return (node as Record<string, unknown>)[part];
            return undefined;
        }, catalog);
        if (typeof value !== 'string') return key;
        return value.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars?.[name] ?? ''));
    };
}

vi.mock('react-i18next', () => ({
    useTranslation: (ns: string) => ({ t: translatorFor(ns), i18n: { language: 'en' } }),
}));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-a' }));
vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-a' }));

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/auth/axiosInstance', () => ({ default: api }));

import { AiPlanSection } from './AiPlanSection';
import { PlanSummaryCard } from '@/components/common/ai-credits/PlanSummaryCard';
import { UsageHistoryV2 } from '@/components/common/ai-credits/UsageHistoryV2';
import {
    allowancePart,
    allowancePct,
    featuresByMode,
    isPlanInEffect,
    normalizeTenantPlan,
    planRowBadge,
} from '@/components/common/ai-credits/aiPlan';

const PLAN = {
    plan: {
        name: 'AI Pro',
        version_no: 1,
        period_start: '2026-10-01T00:00:00Z',
        period_end: '2026-11-01T00:00:00Z',
        enforcement: 'LIVE',
        status: 'ACTIVE',
    },
    allowance: { credits: '2000', used: '500', remaining: '1500' },
    features: [
        {
            feature_key: 'learner_assistant',
            label: 'AI learner assistant chat',
            mode: 'INCLUDED',
            display_cap_text: 'Fair use: 300 messages per learner per month',
            usage_pct: 42,
            included_models: ['z-ai/glm-5.3-flash'],
        },
        { feature_key: 'image_generation', label: 'AI images', mode: 'ALLOWANCE', usage_pct: null },
        { feature_key: 'ai_calling', label: 'AI phone calls', mode: 'CHARGED' },
        { label: 'no key', mode: 'INCLUDED' },
    ],
};

function wrapper({ children }: { children: ReactNode }) {
    const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('aiPlan helpers', () => {
    it('normalises the tenant plan and drops rows without a key', () => {
        const p = normalizeTenantPlan(PLAN);
        expect(p?.allowance).toEqual({ credits: 2000, used: 500, remaining: 1500 });
        expect(p?.features.map((f) => f.feature_key)).toEqual([
            'learner_assistant',
            'image_generation',
            'ai_calling',
        ]);
        expect(allowancePct(p!)).toBe(25);
        expect(featuresByMode(p!).INCLUDED).toHaveLength(1);
        expect(normalizeTenantPlan({ plan: null })).toBeNull();
        expect(normalizeTenantPlan(null)).toBeNull();
    });

    it('is in effect only when LIVE and trial / active / grace', () => {
        const p = normalizeTenantPlan(PLAN);
        expect(isPlanInEffect(p)).toBe(true);
        expect(isPlanInEffect(normalizeTenantPlan({ ...PLAN, plan: { ...PLAN.plan, enforcement: 'SHADOW' } }))).toBe(false);
        expect(isPlanInEffect(normalizeTenantPlan({ ...PLAN, plan: { ...PLAN.plan, status: 'EXPIRED' } }))).toBe(false);
        expect(isPlanInEffect(normalizeTenantPlan({ ...PLAN, plan: { ...PLAN.plan, status: 'GRACE' } }))).toBe(true);
        expect(isPlanInEffect(null)).toBe(false);
        // Platform staff also receive plans that are not in effect; effective=false hides them.
        expect(isPlanInEffect(normalizeTenantPlan({ ...PLAN, plan: { ...PLAN.plan, effective: false } }))).toBe(false);
        expect(isPlanInEffect(normalizeTenantPlan({ ...PLAN, plan: { ...PLAN.plan, effective: true } }))).toBe(true);
    });

    it('labels History v2 rows by billing mode', () => {
        expect(planRowBadge('INCLUDED', 0)).toBe('includedInPlan');
        expect(planRowBadge('ALLOWANCE', 0)).toBe('fromAllowance');
        expect(planRowBadge('SPLIT', 1.5)).toBe('splitAllowance');
        expect(planRowBadge('ALLOWANCE', 2)).toBe('splitAllowance');
        expect(planRowBadge('CHARGED', 4)).toBeNull();
        expect(planRowBadge(null, 0)).toBeNull();
        expect(allowancePart(10, 1.5)).toBe(8.5);
        expect(allowancePart(1, 3)).toBe(0);
    });
});

describe('PlanSummaryCard (credits popover)', () => {
    // Braces matter: a function returned from beforeEach runs as a cleanup hook.
    beforeEach(() => {
        api.get.mockReset();
    });

    it('renders the plan name and allowance left for a LIVE plan', async () => {
        api.get.mockResolvedValue({ data: PLAN });
        render(<PlanSummaryCard />, { wrapper });
        expect(await screen.findByText('AI Pro')).toBeTruthy();
        expect(screen.getByText('1,500 of 2,000 left')).toBeTruthy();
        expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/credits/v2/institutes/inst-a/plan'));
    });

    const expectEmpty = async () => {
        const { container } = render(<PlanSummaryCard />, { wrapper });
        await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
        // Let the query settle, then assert the card stayed empty.
        await new Promise((r) => setTimeout(r, 20));
        expect(container.innerHTML).toBe('');
    };

    it('renders nothing when the institute has no plan', async () => {
        api.get.mockResolvedValue({ data: { plan: null, allowance: null, features: [] } });
        await expectEmpty();
    });

    it('renders nothing for a SHADOW plan (charged as today)', async () => {
        api.get.mockResolvedValue({ data: { ...PLAN, plan: { ...PLAN.plan, enforcement: 'SHADOW' } } });
        await expectEmpty();
    });

    it('renders nothing when the endpoint fails (not deployed / 403)', async () => {
        api.get.mockRejectedValue(Object.assign(new Error('Request failed'), { response: { status: 404 } }));
        await expectEmpty();
    });
});

describe('AiPlanSection (Settings → AI → Plan)', () => {
    // Braces matter: a function returned from beforeEach runs as a cleanup hook.
    beforeEach(() => {
        api.get.mockReset();
    });

    it('lists features by mode with fair-use text, bar and models', async () => {
        api.get.mockResolvedValue({ data: PLAN });
        render(<AiPlanSection />, { wrapper });
        expect(await screen.findByText('AI Pro')).toBeTruthy();
        expect(screen.getByText('Included in your plan')).toBeTruthy();
        expect(screen.getByText('Paid from the plan allowance')).toBeTruthy();
        // Group title + the badge on the AI calling row.
        expect(screen.getAllByText('Uses credits')).toHaveLength(2);
        expect(screen.getByText('Fair use: 300 messages per learner per month')).toBeTruthy();
        expect(screen.getByText('42% of fair use used this period')).toBeTruthy();
        expect(screen.getByText('Included models: z-ai/glm-5.3-flash')).toBeTruthy();
        expect(screen.getByText('500 of 2,000 credits used · 1,500 left')).toBeTruthy();
        // No raw i18n keys leaked.
        expect(document.body.textContent).not.toMatch(/groups\.|fairUse\.|allowance\.line/);
    });

    it('shows the no-plan note when the plan is not in effect', async () => {
        api.get.mockResolvedValue({ data: { ...PLAN, plan: { ...PLAN.plan, enforcement: 'SHADOW' } } });
        render(<AiPlanSection />, { wrapper });
        expect(
            await screen.findByText('This institute has no AI plan. Every AI use is charged from credits.')
        ).toBeTruthy();
    });
});

describe('History v2 rows under a plan', () => {
    // Braces matter: a function returned from beforeEach runs as a cleanup hook.
    beforeEach(() => {
        api.get.mockReset();
    });

    const event = (id: string, label: string, billing_mode: string, list: number, charged: number) => ({
        kind: 'usage',
        id,
        occurred_at: '2026-10-14T10:00:00Z',
        label,
        use_case: 'tutor_chat',
        use_case_label: null,
        feature_group: 'tutor',
        actor_user_id: null,
        actor_name: null,
        actor_role_class: null,
        subject_user_id: null,
        subject_name: null,
        surface: null,
        model_id: null,
        model_short: null,
        units: null,
        list_credits: String(list),
        credits_charged: String(charged),
        refunded_credits: null,
        billing_mode,
        charge_status: 'POSTED',
        batch_id: null,
        ledger_tx_id: null,
        balance_after: null,
        context: null,
    });

    it('says Included in plan / From plan allowance / part from allowance', async () => {
        api.get.mockImplementation((url: string) => {
            if (url.includes('/usage-events')) {
                return Promise.resolve({
                    data: {
                        items: [
                            event('e1', 'Row included', 'INCLUDED', 4, 0),
                            event('e2', 'Row allowance', 'ALLOWANCE', 6, 0),
                            event('e3', 'Row split', 'SPLIT', 10, 1.5),
                            event('e4', 'Row charged', 'CHARGED', 3, 3),
                        ],
                        page: 1,
                        page_size: 10,
                        total: 4,
                    },
                });
            }
            return Promise.resolve({ data: { rows: [], total_credits: 0, total_events: 0 } });
        });
        render(<UsageHistoryV2 instituteId="inst-a" isAdmin />, { wrapper });
        expect(await screen.findByText('Row included')).toBeTruthy();
        expect(screen.getByText('Included in plan')).toBeTruthy();
        expect(screen.getByText('From plan allowance')).toBeTruthy();
        // SPLIT: the wallet part as a debit, the rest from the allowance.
        expect(screen.getByText('−1.5')).toBeTruthy();
        expect(screen.getByText('8.5 from plan allowance')).toBeTruthy();
        expect(screen.getByText('−3')).toBeTruthy();
        expect(screen.queryByText('Included')).toBeNull();
        // Expanded SPLIT row lists the allowance part.
        fireEvent.click(screen.getByText('Row split'));
        expect(await screen.findByText('From plan allowance', { selector: 'dt' })).toBeTruthy();
    });
});
