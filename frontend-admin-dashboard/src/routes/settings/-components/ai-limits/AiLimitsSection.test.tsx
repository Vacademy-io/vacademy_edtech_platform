import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import enStrings from '../../../../../public/locales/en/settingsAiLimits.json';

/** Resolve against the REAL en catalogue so a missing key shows up as a raw key. */
function translate(key: string, vars?: Record<string, unknown>): string {
    const count = vars?.count as number | undefined;
    const lookup = (path: string) =>
        path.split('.').reduce<unknown>((node, part) => {
            if (node && typeof node === 'object') return (node as Record<string, unknown>)[part];
            return undefined;
        }, enStrings as unknown);
    let value = count !== undefined && count !== 1 ? lookup(`${key}_other`) : undefined;
    if (typeof value !== 'string' && count === 1) value = lookup(`${key}_one`);
    if (typeof value !== 'string') value = lookup(key);
    if (typeof value !== 'string') {
        if (typeof vars?.defaultValue === 'string') return vars.defaultValue;
        return key;
    }
    return value.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars?.[name] ?? ''));
}

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));

const toastSpies = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastSpies }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-a' }));
vi.mock('@/utils/roleUtils', () => ({ mapRoleToCustomName: (r: string) => r }));
vi.mock('@/routes/manage-custom-teams/-services/custom-team-services', () => ({
    getAllRoles: async () => [{ name: 'EVALUATOR' }],
}));
vi.mock('@/services/ai-credits/usage-v2', () => ({
    useUsageSummaryQuery: (_i: string, _d: number, groupBy: string) => ({
        isLoading: false,
        data: {
            rows:
                groupBy === 'user'
                    ? [{ key: 'u1', label: 'Asha', credits: 3, events: 2, share_pct: 50 }]
                    : groupBy === 'use_case'
                      ? [
                            {
                                key: 'tutor_chat',
                                label: 'AI tutor chat',
                                credits: 3,
                                events: 2,
                                share_pct: 50,
                            },
                        ]
                      : [{ key: 'tutor', label: 'AI tutor', credits: 3, events: 2, share_pct: 50 }],
        },
    }),
}));

const api = vi.hoisted(() => ({
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
}));
vi.mock('@/lib/auth/axiosInstance', () => ({ default: api }));

import { AiLimitsSection } from './AiLimitsSection';

const BASE = '/credits/v2/institutes/inst-a/limits';

const OVERVIEW = {
    policy: {
        mode: 'OFF',
        tenant_may_enforce: false,
        timezone: 'UTC',
        notify_admins_on_soft: true,
        show_numbers_to_learners: false,
    },
    rows: [
        {
            id: 'r1',
            subject_kind: 'ROLE_CLASS',
            subject_value: 'LEARNER',
            subject_label: 'Learners',
            per_member: true,
            scope_kind: 'GROUP',
            scope_value: 'tutor',
            scope_label: 'AI tutor',
            period: 'DAY',
            metric: 'CREDITS',
            soft_limit: '8',
            hard_limit: '10',
            origin: 'TENANT',
            locked: false,
            is_active: true,
            reason: 'Fair share',
        },
    ],
    platform_rows: [
        {
            id: 'p1',
            subject_kind: 'INSTITUTE',
            subject_value: null,
            per_member: false,
            scope_kind: 'ALL',
            scope_value: null,
            period: 'MONTH',
            metric: 'CREDITS',
            soft_limit: null,
            hard_limit: 5000,
            origin: 'PLATFORM',
            locked: true,
            is_active: true,
            reason: 'Plan fair use',
        },
    ],
    enforce_globally_enabled: true,
};

function renderSection() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={qc}>
            <TooltipProvider>
                <AiLimitsSection />
            </TooltipProvider>
        </QueryClientProvider>
    );
}

describe('AiLimitsSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        api.get.mockImplementation(async (url: string) => {
            if (url.endsWith(BASE)) return { data: OVERVIEW };
            if (url.endsWith(`${BASE}/usage`)) {
                return {
                    data: [
                        {
                            key: 'R:LEARNER|G:tutor',
                            label: 'Learners · AI tutor',
                            period: 'DAY',
                            credits_used: 4,
                            count_used: 3,
                            soft: 8,
                            hard: 10,
                            pct: 40,
                        },
                    ],
                };
            }
            return { data: [] };
        });
        api.put.mockResolvedValue({ data: {} });
        api.post.mockImplementation(async (url: string) => {
            if (url.endsWith('/preview')) {
                return {
                    data: {
                        events_considered: 120,
                        would_block: 7,
                        would_warn: 4,
                        affected_users: 2,
                        by_user: [{ user_id: 'u1', name: 'Asha', would_block: 5, would_warn: 1 }],
                        by_use_case: [
                            {
                                use_case: 'tutor_chat',
                                use_case_label: 'AI tutor chat',
                                would_block: 7,
                                would_warn: 4,
                            },
                        ],
                    },
                };
            }
            return { data: { id: 'new' } };
        });
    });

    it('shows the policy, tenant rows with actions and platform rows read-only', async () => {
        renderSection();
        expect(await screen.findByText('Your limits')).toBeInTheDocument();

        // Enforce is locked until the platform unlocks it.
        const enforce = screen.getByRole('radio', { name: /Enforce/ });
        expect(enforce).toBeDisabled();
        expect(screen.getByRole('radio', { name: /Off/ })).toHaveAttribute('aria-checked', 'true');

        // Tenant row: label, limits and edit/remove.
        expect(screen.getByText('Each Learners')).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Edit limit' })).toHaveLength(1);
        expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);

        // Platform row: shown, but no actions. No storefront answer (the default: storefront
        // off) on a Vacademy-owned host (jsdom: localhost) = the copy from before plans existed.
        expect(screen.getByText('Set by Vacademy')).toBeInTheDocument();
        expect(screen.getByText('Plan fair use')).toBeInTheDocument();

        // Usage meter from /usage.
        expect(await screen.findByText('Learners · AI tutor')).toBeInTheDocument();

        // No raw keys leaked.
        expect(document.body.textContent).not.toMatch(
            /\b(mode|rows|table|dialog|usage|platform)\.[a-zA-Z]+/
        );
    });

    it('changes the mode only with a reason', async () => {
        renderSection();
        fireEvent.click(await screen.findByRole('radio', { name: /Preview/ }));
        const save = screen.getByRole('button', { name: 'Save' });
        expect(save).toBeDisabled();
        fireEvent.change(screen.getByPlaceholderText(/Why are you changing this/), {
            target: { value: 'Measure first' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(api.put).toHaveBeenCalled());
        expect(api.put.mock.calls[0][0]).toContain(`${BASE}/policy`);
        expect(api.put.mock.calls[0][1]).toEqual({
            mode: 'SHADOW',
            notify_admins_on_soft: true,
            show_numbers_to_learners: false,
            reason: 'Measure first',
        });
    });

    it('requires Preview impact before a new limit can be saved', async () => {
        renderSection();
        fireEvent.click(await screen.findByRole('button', { name: /Add limit/ }));
        const dialog = await screen.findByRole('dialog');
        const d = within(dialog);

        fireEvent.change(d.getByLabelText(/Limit \(credits\)/), { target: { value: '10' } });
        fireEvent.change(d.getByPlaceholderText(/Why\? \(saved/), {
            target: { value: 'Cap learners' },
        });
        expect(d.getByRole('button', { name: 'Save' })).toBeDisabled();
        expect(d.getByText(/Run Preview impact/)).toBeInTheDocument();

        fireEvent.click(d.getByRole('button', { name: 'Preview impact' }));
        expect(await d.findByText('Impact over the last 30 days')).toBeInTheDocument();
        expect(d.getByText('Asha')).toBeInTheDocument();
        const previewCall = api.post.mock.calls.find((c) => String(c[0]).endsWith('/preview'));
        expect(previewCall?.[1]).toEqual({
            rows: [
                {
                    subject_kind: 'ROLE_CLASS',
                    subject_value: 'LEARNER',
                    per_member: true,
                    scope_kind: 'ALL',
                    scope_value: null,
                    period: 'DAY',
                    metric: 'CREDITS',
                    soft_limit: null,
                    hard_limit: 10,
                },
            ],
        });

        // Changing a value invalidates the preview again.
        fireEvent.change(d.getByLabelText(/Limit \(credits\)/), { target: { value: '12' } });
        expect(d.getByRole('button', { name: 'Save' })).toBeDisabled();
        fireEvent.click(d.getByRole('button', { name: 'Preview impact' }));
        await waitFor(() => expect(d.getByRole('button', { name: 'Save' })).not.toBeDisabled());

        fireEvent.click(d.getByRole('button', { name: 'Save' }));
        await waitFor(() =>
            expect(api.post.mock.calls.some((c) => String(c[0]).endsWith(`${BASE}/rows`))).toBe(
                true
            )
        );
        const createCall = api.post.mock.calls.find((c) => String(c[0]).endsWith(`${BASE}/rows`));
        expect(createCall?.[1]).toMatchObject({ hard_limit: 12, reason: 'Cap learners' });
        expect(toastSpies.success).toHaveBeenCalled();
    });

    it('rejects a warning level above the limit', async () => {
        renderSection();
        fireEvent.click(await screen.findByRole('button', { name: /Add limit/ }));
        const d = within(await screen.findByRole('dialog'));
        fireEvent.change(d.getByLabelText(/Warn at \(credits\)/), { target: { value: '20' } });
        fireEvent.change(d.getByLabelText(/Limit \(credits\)/), { target: { value: '10' } });
        expect(d.getByText("Warn at can't be higher than the limit.")).toBeInTheDocument();
        expect(d.getByRole('button', { name: 'Preview impact' })).toBeDisabled();
    });
});
