import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// ─── Module mocks ──────────────────────────────────
vi.mock('@/lib/auth/instituteUtils', () => ({
    getCurrentInstituteId: () => 'inst-a',
}));
vi.mock('@/utils/userDetails', () => ({ getUserId: () => 'user-1' }));
vi.mock('@/native', () => ({ isIOS: () => false }));
vi.mock('@/components/common/ai-credits/TopUpModal', () => ({ TopUpModal: () => null }));
vi.mock('@/services/ai-credits/credit-pack-services', () => ({
    usePlatformInvoicesQuery: () => ({ data: [], isLoading: false, isError: false }),
    downloadInvoicePdf: vi.fn(),
}));

const v1Calls = { transactions: 0, analytics: 0 };
vi.mock('@/services/ai-credits/get-ai-credits', () => ({
    useAiCreditsQuery: () => ({
        data: {
            institute_id: 'inst-a',
            total_credits: '200',
            used_credits: '20',
            current_balance: '180',
            low_balance_threshold: '10',
            is_low_balance: false,
            created_at: '2026-10-01T00:00:00Z',
            updated_at: '2026-10-14T00:00:00Z',
        },
        isError: false,
        isLoading: false,
    }),
    useAiUsageForecastQuery: () => ({ data: undefined, isLoading: false }),
    useUserAiUsageQuery: () => ({ data: undefined, isLoading: false }),
    useAiUsageAnalyticsQuery: () => {
        v1Calls.analytics++;
        return { data: undefined, isLoading: false };
    },
    useAiTransactionsQuery: () => {
        v1Calls.transactions++;
        return {
            data: {
                transactions: [
                    {
                        id: 'tx1',
                        institute_id: 'inst-a',
                        transaction_type: 'USAGE_DEDUCTION',
                        amount: -2,
                        balance_after: 180,
                        description: 'v1 ledger row',
                        model_name: 'z-ai/glm-5.3-flash',
                        created_at: '2026-10-14T10:00:00Z',
                    },
                ],
                total_count: 1,
                page: 1,
                page_size: 8,
                total_pages: 1,
            },
            isLoading: false,
        };
    },
}));

const getMock = vi.fn();
vi.mock('@/lib/auth/axiosInstance', () => ({
    default: { get: (...args: unknown[]) => getMock(...args), post: vi.fn() },
}));

import { AiCreditsPanel } from '@/components/common/ai-credits/AiCreditsPanel';
import {
    eventAmount,
    lastIstDays,
    modelShortName,
    unitLines,
    contextEntries,
} from '@/components/common/ai-credits/usageV2Format';
import { filtersToParams, toNumber, type UsageEventItem } from '@/services/ai-credits/usage-v2';

const baseEvent: UsageEventItem = {
    kind: 'usage',
    id: 'e1',
    occurred_at: '2026-10-14T10:00:00Z',
    label: 'AI tutor chat — learner Ravi',
    use_case: 'tutor_chat',
    use_case_label: 'AI tutor chat',
    feature_group: 'tutor',
    actor_user_id: 'u1',
    actor_name: 'Ravi',
    actor_role_class: 'LEARNER',
    subject_user_id: null,
    subject_name: null,
    surface: 'LEARNER_APP',
    model_id: 'z-ai/glm-5.3-flash',
    model_short: null,
    units: { prompt_tokens: 1200, completion_tokens: 0, image_count: null },
    list_credits: '4.8',
    credits_charged: '4.8',
    refunded_credits: null,
    billing_mode: 'CHARGED',
    charge_status: 'POSTED',
    batch_id: null,
    ledger_tx_id: 'tx1',
    balance_after: '175.2',
    context: { flow_name: 'Welcome', nested: { a: 1 }, empty: '' },
};

// ─── Pure helpers ──────────────────────────────────
describe('usage v2 format helpers', () => {
    it('maps billing mode / charge status to the amount column', () => {
        expect(eventAmount(baseEvent)).toEqual({ kind: 'charged', credits: 4.8, refunded: 0 });
        expect(eventAmount({ ...baseEvent, billing_mode: 'BYO_KEY' }).kind).toBe('ownKey');
        expect(
            eventAmount({ ...baseEvent, billing_mode: 'INCLUDED', credits_charged: 0 }).kind
        ).toBe('included');
        expect(
            eventAmount({ ...baseEvent, billing_mode: 'ALLOWANCE', credits_charged: '0' }).kind
        ).toBe('included');
        expect(eventAmount({ ...baseEvent, billing_mode: 'FREE', credits_charged: 0 }).kind).toBe(
            'free'
        );
        expect(
            eventAmount({
                ...baseEvent,
                charge_status: 'DROPPED_INSUFFICIENT',
                credits_charged: 0,
            }).kind
        ).toBe('notCharged');
        // SPLIT still debits the wallet for its charged part.
        expect(eventAmount({ ...baseEvent, billing_mode: 'SPLIT', credits_charged: 1.5 })).toEqual({
            kind: 'charged',
            credits: 1.5,
            refunded: 0,
        });
        expect(eventAmount({ ...baseEvent, refunded_credits: '4.8' }).refunded).toBe(4.8);
    });

    it('derives the short model name and the non-zero units', () => {
        expect(modelShortName(baseEvent)).toBe('glm-5.3-flash');
        expect(modelShortName({ ...baseEvent, model_short: 'GLM flash' })).toBe('GLM flash');
        expect(modelShortName({ ...baseEvent, model_id: null })).toBeNull();
        expect(unitLines(baseEvent).map((u) => u.key)).toEqual(['prompt_tokens']);
    });

    it('keeps only primitive, non-empty context entries', () => {
        expect(contextEntries(baseEvent.context)).toEqual([['flow name', 'Welcome']]);
        expect(contextEntries(null)).toEqual([]);
    });

    it('builds the IST day axis (UTC+05:30)', () => {
        // 20:00 UTC on 14 Oct is already 15 Oct in IST.
        expect(lastIstDays(3, new Date('2026-10-14T20:00:00Z'))).toEqual([
            '2026-10-13',
            '2026-10-14',
            '2026-10-15',
        ]);
    });

    it('drops empty filters from the query string and parses decimals', () => {
        expect(
            filtersToParams({
                role_class: 'LEARNER',
                user_id: '',
                feature_group: undefined,
            }).toString()
        ).toBe('role_class=LEARNER');
        expect(toNumber('4.80')).toBe(4.8);
        expect(toNumber(null)).toBe(0);
        expect(toNumber('x')).toBe(0);
    });
});

// ─── Panel gating ──────────────────────────────────
const wrapperFor = (client: QueryClient) =>
    function Wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    };

function routeGet(config: unknown) {
    getMock.mockImplementation((url: string) => {
        if (url.includes('/usage-config')) {
            if (config instanceof Error) return Promise.reject(config);
            return Promise.resolve({ data: config });
        }
        if (url.includes('/usage-events')) {
            return Promise.resolve({
                data: { items: [baseEvent], page: 1, page_size: 10, total: 1 },
            });
        }
        if (url.includes('/usage-summary')) {
            return Promise.resolve({
                data: {
                    group_by: 'use_case',
                    days: 90,
                    metric: 'charged',
                    total_credits: 0,
                    total_events: 0,
                    rows: [],
                },
            });
        }
        return Promise.reject(new Error(`unexpected GET ${url}`));
    });
}

async function openHistory() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<AiCreditsPanel />, { wrapper: wrapperFor(client) });
    fireEvent.click(screen.getByRole('button', { name: /AI Credits/i }));
    const historyTab = await screen.findByRole('button', { name: /History/ });
    fireEvent.click(historyTab);
}

describe('AiCreditsPanel v1/v2 gating', () => {
    beforeEach(() => {
        getMock.mockReset();
        v1Calls.transactions = 0;
        v1Calls.analytics = 0;
    });

    it('asks for usage-config only after the popover opens', async () => {
        routeGet({ history_v2_enabled: false, is_admin: true });
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(<AiCreditsPanel />, { wrapper: wrapperFor(client) });
        expect(getMock).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: /AI Credits/i }));
        await waitFor(() =>
            expect(getMock).toHaveBeenCalledWith(
                expect.stringContaining('/credits/v2/institutes/inst-a/usage-config')
            )
        );
    });

    it('flag off → v1 History, no v2 data requests', async () => {
        routeGet({ history_v2_enabled: false, is_admin: true });
        await openHistory();
        expect(await screen.findByText('v1 ledger row')).toBeTruthy();
        const urls = getMock.mock.calls.map((c) => String(c[0]));
        expect(urls.some((u) => u.includes('/usage-events'))).toBe(false);
        expect(urls.some((u) => u.includes('/usage-summary'))).toBe(false);
    });

    it('config error → v1 History', async () => {
        routeGet(new Error('404'));
        await openHistory();
        expect(await screen.findByText('v1 ledger row')).toBeTruthy();
    });

    it('flag on → v2 History renders events and skips the v1 ledger list', async () => {
        routeGet({ history_v2_enabled: true, is_admin: true });
        await openHistory();
        expect(await screen.findByText('AI tutor chat — learner Ravi')).toBeTruthy();
        expect(screen.queryByText('v1 ledger row')).toBeNull();
        expect(v1Calls.transactions).toBe(0);
    });
});
