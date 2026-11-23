import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import copy from '../../../../../public/locales/en/dashboardIndex.json';
import { useAssistDock } from '@/components/assist-dock/store';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { PageAskButton } from '../../PageAskButton';
import { AssistantTip, TIP_VISIBLE_MS } from '../../AssistantTip';
import { AssistantEmptyState } from '../../AssistantEmptyState';
import { WELCOME_DELAY_MS, useAssistantWelcome } from '../../useAssistantWelcome';
import {
    TIP_GAP_MS,
    TIP_LIMIT_PER_TOPIC,
    canShowTip,
    nudgeAssistant,
    questionsFor,
    recordTipShown,
    topicForPath,
    turnTipsOff,
    welcomeSeen,
} from '../../page-ask';
import type { AssistantCapabilities } from '../../types';

let pathname = '/audience-manager/recent-leads';
let admin = true;

vi.mock('@/lib/auth/axiosInstance', () => ({ default: { get: vi.fn() } }));
vi.mock('@/constants/urls', () => ({
    ASSISTANT_CAPABILITIES: '/assistant/capabilities',
    ASSISTANT_SESSIONS: '/assistant/sessions',
}));
vi.mock('@tanstack/react-router', () => ({
    useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
        select({ location: { pathname } }),
}));
vi.mock('../../useInstituteChatbotName', () => ({
    useInstituteChatbotName: () => 'Sunrise Chatbot',
}));
vi.mock('@/utils/userDetails', () => ({ isUserAdmin: () => admin }));

const ask = copy.assistant.pageAsk;
const i18n = createInstance();
void i18n.init({
    lng: 'en',
    resources: { en: { dashboardIndex: copy } },
    interpolation: { escapeValue: false },
});

const crm: AssistantCapabilities = {
    groups: [{ key: 'crm_reports', mode: 'READ', tools: ['crm_reports'] }],
};
const fees: AssistantCapabilities = {
    groups: [
        { key: 'payments', mode: 'READ', tools: ['get_collections_summary'] },
        { key: 'institute_overview', mode: 'READ', tools: ['get_institute_overview'] },
    ],
};

function wrapper(capabilities?: AssistantCapabilities) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    if (capabilities) client.setQueryData(['assistant-capabilities'], capabilities);
    return ({ children }: { children: ReactNode }) => (
        <I18nextProvider i18n={i18n}>
            <QueryClientProvider client={client}>{children}</QueryClientProvider>
        </I18nextProvider>
    );
}

// The test DOM does not always expose localStorage; an in-memory Storage is enough here.
if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage) {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => void store.set(k, String(v)),
            removeItem: (k: string) => void store.delete(k),
            clear: () => store.clear(),
        },
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    pathname = '/audience-manager/recent-leads';
    admin = true;
    useAssistDock.setState({
        panel: 'none',
        pendingPrompt: null,
        assistantFabEnabled: true,
        tipTopic: null,
        welcome: false,
    });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('page topics and questions', () => {
    it('matches a page and the pages under it, not a lookalike', () => {
        expect(topicForPath('/audience-manager/recent-leads')).toBe('leads');
        expect(topicForPath('/audience-manager/list/campaign-users/')).toBe('leads');
        expect(topicForPath('/manage-students/students-list')).toBe('learners');
        expect(topicForPath('/financial-management/pay-installments')).toBe('fees');
        expect(topicForPath('/assessment/assessment-list/assessment-details/a/b/c/d')).toBe(
            'assessments'
        );
        expect(topicForPath('/audience-manager/listings')).toBeNull();
        expect(topicForPath('/dashboard')).toBeNull();
    });

    it('offers only questions whose tool the caller has, at most three', () => {
        expect(questionsFor('fees', fees).map((q) => q.key)).toEqual([
            'feesCollectedMonth',
            'feesOutstanding',
        ]);
        expect(questionsFor('leads', crm)).toHaveLength(3);
        expect(questionsFor('assessments', crm)).toEqual([]);
        expect(questionsFor('leads', undefined)).toEqual([]);
    });

    it('has every question and welcome text in each language', async () => {
        for (const lang of ['hi', 'fr', 'ar']) {
            const other = (
                await import(`../../../../../public/locales/${lang}/dashboardIndex.json`)
            ).default.assistant.pageAsk;
            expect(Object.keys(other.questions).sort()).toEqual(Object.keys(ask.questions).sort());
            expect(Object.keys(other.welcome.questions).sort()).toEqual(
                Object.keys(ask.welcome.questions).sort()
            );
            expect(Object.keys(other.tip).sort()).toEqual(Object.keys(ask.tip).sort());
        }
    });
});

describe('Ask button next to the page heading', () => {
    it('asks the picked question in the chat', () => {
        render(<PageAskButton />, { wrapper: wrapper(crm) });
        const trigger = screen.getByRole('button', {
            name: 'Ask Sunrise Chatbot about this page',
        });
        fireEvent.keyDown(trigger, { key: 'Enter' });
        fireEvent.click(screen.getByRole('menuitem', { name: ask.questions.leadsBySource }));
        expect(useAssistDock.getState()).toMatchObject({
            panel: 'assistant',
            pendingPrompt: ask.questions.leadsBySource,
        });
    });

    it('opens the empty chat for anything else', () => {
        render(<PageAskButton />, { wrapper: wrapper(crm) });
        fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
        fireEvent.click(screen.getByRole('menuitem', { name: ask.somethingElse }));
        expect(useAssistDock.getState()).toMatchObject({ panel: 'assistant', pendingPrompt: null });
    });

    it('is absent where the assistant is off, on other pages, or with no matching tool', () => {
        useAssistDock.setState({ assistantFabEnabled: false });
        const { unmount } = render(<PageAskButton />, { wrapper: wrapper(crm) });
        expect(screen.queryByRole('button')).toBeNull();
        unmount();

        useAssistDock.setState({ assistantFabEnabled: true });
        pathname = '/dashboard';
        const second = render(<PageAskButton />, { wrapper: wrapper(crm) });
        expect(screen.queryByRole('button')).toBeNull();
        second.unmount();

        pathname = '/payment-dashboard';
        render(<PageAskButton />, { wrapper: wrapper(crm) });
        expect(screen.queryByRole('button')).toBeNull();
        expect(authenticatedAxiosInstance.get).not.toHaveBeenCalled();
    });
});

describe('tips after a manual task', () => {
    it('allows one tip a day, three per page type, and none once turned off', () => {
        const start = 1_000_000;
        expect(canShowTip('leads', start)).toBe(true);
        recordTipShown('leads', start);
        expect(canShowTip('fees', start + 60_000)).toBe(false);
        expect(canShowTip('fees', start + TIP_GAP_MS)).toBe(true);
        for (let i = 1; i < TIP_LIMIT_PER_TOPIC; i += 1)
            recordTipShown('leads', start + i * TIP_GAP_MS);
        expect(canShowTip('leads', start + 10 * TIP_GAP_MS)).toBe(false);
        expect(canShowTip('fees', start + 10 * TIP_GAP_MS)).toBe(true);
        turnTipsOff();
        expect(canShowTip('fees', start + 20 * TIP_GAP_MS)).toBe(false);
    });

    it('only nudges while the assistant is available and its panel is closed', () => {
        useAssistDock.setState({ panel: 'assistant' });
        nudgeAssistant('leads');
        expect(useAssistDock.getState().tipTopic).toBeNull();
        useAssistDock.setState({ panel: 'none', assistantFabEnabled: false });
        nudgeAssistant('leads');
        expect(useAssistDock.getState().tipTopic).toBeNull();
        useAssistDock.setState({ assistantFabEnabled: true });
        nudgeAssistant('leads');
        expect(useAssistDock.getState().tipTopic).toBe('leads');
    });

    it('suggests the question, asks it on request and counts the showing', () => {
        useAssistDock.setState({ tipTopic: 'fees' });
        render(<AssistantTip />, { wrapper: wrapper(fees) });
        expect(screen.getByText(`“${ask.questions.feesCollectedMonth}”`)).toBeInTheDocument();
        expect(canShowTip('fees')).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: ask.tip.ask }));
        expect(useAssistDock.getState()).toMatchObject({
            tipTopic: null,
            panel: 'assistant',
            pendingPrompt: ask.questions.feesCollectedMonth,
        });
    });

    it('goes away by itself, and can turn tips off for good', () => {
        vi.useFakeTimers();
        useAssistDock.setState({ tipTopic: 'leads' });
        const { unmount } = render(<AssistantTip />, { wrapper: wrapper(crm) });
        act(() => vi.advanceTimersByTime(TIP_VISIBLE_MS));
        expect(useAssistDock.getState().tipTopic).toBeNull();
        unmount();
        vi.useRealTimers();

        localStorage.clear();
        useAssistDock.setState({ tipTopic: 'leads' });
        render(<AssistantTip />, { wrapper: wrapper(crm) });
        fireEvent.click(screen.getByRole('button', { name: ask.tip.stop }));
        expect(useAssistDock.getState().tipTopic).toBeNull();
        expect(canShowTip('assessments', Date.now() + 10 * TIP_GAP_MS)).toBe(false);
    });

    it('drops a tip it has no question for', () => {
        useAssistDock.setState({ tipTopic: 'assessments' });
        render(<AssistantTip />, { wrapper: wrapper(crm) });
        expect(screen.queryByRole('status')).toBeNull();
        expect(useAssistDock.getState().tipTopic).toBeNull();
    });
});

describe('first-visit welcome', () => {
    const scope = 'inst-1:user-1';
    const setBatches = (n: number) =>
        useInstituteDetailsStore.setState({
            instituteDetails: {
                batches_for_sessions: Array.from({ length: n }, () => ({})),
            } as never,
        });

    beforeEach(() => {
        pathname = '/dashboard';
        setBatches(0);
        window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as never;
    });

    function chats(items: unknown[]) {
        vi.mocked(authenticatedAxiosInstance.get).mockResolvedValue({
            data: { items, page: 0, page_size: 3, has_more: false },
        });
    }

    // Once for the chat list to load, once for the welcome delay.
    async function settle() {
        for (let i = 0; i < 2; i += 1) {
            await act(async () => {
                await vi.advanceTimersByTimeAsync(WELCOME_DELAY_MS + 10);
            });
        }
    }

    it('opens once for an admin of an institute still being set up', async () => {
        vi.useFakeTimers();
        chats([]);
        const { rerender } = renderHook(() => useAssistantWelcome(true, scope), {
            wrapper: wrapper(),
        });
        await settle();
        expect(useAssistDock.getState()).toMatchObject({ panel: 'assistant', welcome: true });
        expect(welcomeSeen(scope)).toBe(true);

        useAssistDock.setState({ panel: 'none', welcome: false });
        rerender();
        await settle();
        expect(useAssistDock.getState().panel).toBe('none');
    });

    it('stays closed for someone who has chatted before, and remembers that', async () => {
        vi.useFakeTimers();
        chats([{ id: 'c1', title: 'Hi', updated_at: '2026-11-01T00:00:00Z', message_count: 1 }]);
        renderHook(() => useAssistantWelcome(true, scope), { wrapper: wrapper() });
        await settle();
        expect(useAssistDock.getState().panel).toBe('none');
        expect(welcomeSeen(scope)).toBe(true);
    });

    it('does not open for an institute with batches, a non-admin, a phone or another page', async () => {
        vi.useFakeTimers();
        chats([]);
        const cases: Array<() => void> = [
            () => setBatches(2),
            () => {
                admin = false;
            },
            () => {
                window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never;
            },
            () => {
                pathname = '/manage-students/students-list';
            },
        ];
        for (const arrange of cases) {
            arrange();
            const { unmount } = renderHook(() => useAssistantWelcome(true, scope), {
                wrapper: wrapper(),
            });
            await settle();
            expect(useAssistDock.getState().panel).toBe('none');
            unmount();
            setBatches(0);
            admin = true;
            pathname = '/dashboard';
            window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as never;
        }
        expect(welcomeSeen(scope)).toBe(false);
        expect(authenticatedAxiosInstance.get).not.toHaveBeenCalled();
    });

    it('shows the setup questions first in the panel', () => {
        render(
            <AssistantEmptyState
                firstName="Asha"
                capabilities={[]}
                starters={[ask.welcome.questions.firstSteps]}
                recentChats={[]}
                busy={false}
                welcome
                onAsk={() => {}}
                onOpenChat={() => {}}
                onViewAllChats={() => {}}
            />,
            { wrapper: wrapper() }
        );
        expect(screen.getByText(ask.welcome.hint)).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: ask.welcome.startHere })).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: ask.welcome.questions.firstSteps })
        ).toBeEnabled();
    });
});
