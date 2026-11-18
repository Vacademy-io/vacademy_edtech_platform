import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import copy from '../../../../../public/locales/en/dashboardIndex.json';
import { VacademyAssistant } from '../../VacademyAssistant';
import { messagesFromHistory } from '../../useVacademyAssistant';
import { groupChatsByDay } from '../../assistant-format';
import { useAssistDock } from '@/components/assist-dock/store';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import type { AssistantChatSummary, AssistantChatView } from '../../types';

vi.mock('@/lib/auth/axiosInstance', () => ({
    default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
    useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
        select({ location: { pathname: '/dashboard' } }),
}));
vi.mock('@/lib/auth/sessionUtility', () => ({
    getTokenFromCookie: () => 'token',
    isTokenExpired: () => false,
    getTokenDecodedData: () => ({ fullname: 'Asha Rao' }),
}));
vi.mock('../../useInstituteChatbotName', () => ({
    useInstituteChatbotName: () => 'Sunrise Institute Chatbot',
}));

const panel = copy.assistant.panel;
const i18n = createInstance();
void i18n.init({
    lng: 'en',
    resources: { en: { dashboardIndex: copy } },
    interpolation: { escapeValue: false },
});

const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

const CHATS: AssistantChatSummary[] = [
    {
        id: 's-1',
        title: 'Who owes fees this week?',
        last_active: now.toISOString(),
        message_count: 4,
        is_open: false,
    },
    {
        id: 's-2',
        title: 'How do I create a course?',
        last_active: daysAgo(3),
        message_count: 2,
        is_open: false,
    },
    {
        id: 's-3',
        title: 'Pending evaluations',
        last_active: daysAgo(5),
        message_count: 2,
        is_open: false,
    },
    {
        id: 's-4',
        title: 'Older question',
        last_active: daysAgo(9),
        message_count: 2,
        is_open: false,
    },
];

const VIEW: AssistantChatView = {
    id: 's-1',
    title: 'Who owes fees this week?',
    is_open: false,
    last_active: now.toISOString(),
    messages: [
        {
            id: '1',
            role: 'user',
            content: 'Who owes fees this week?',
            created_at: now.toISOString(),
        },
        {
            id: '2',
            role: 'action',
            content: 'Remind 3 learners',
            action: { summary: 'Remind 3 learners', status: 'pending', details: ['Asha: ₹5,000'] },
        },
        {
            id: '3',
            role: 'action',
            content: 'Move Ravi to Paid',
            action: { summary: 'Move Ravi to Paid', status: 'executed' },
        },
        {
            id: '4',
            role: 'assistant',
            content: 'Three learners owe fees.\n\n| Name | Due |\n|---|---|\n| Asha | 5,000 |',
            created_at: now.toISOString(),
            suggestions: ['Show their payment history', 'Who paid this week?'],
        },
    ],
};

let chats: AssistantChatSummary[] = [];

function tree() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    return (
        <I18nextProvider i18n={i18n}>
            <QueryClientProvider client={client}>
                <VacademyAssistant />
            </QueryClientProvider>
        </I18nextProvider>
    );
}

beforeEach(() => {
    chats = [...CHATS];
    vi.mocked(authenticatedAxiosInstance.get).mockReset();
    vi.mocked(authenticatedAxiosInstance.post).mockReset();
    vi.mocked(authenticatedAxiosInstance.delete).mockReset();
    vi.mocked(authenticatedAxiosInstance.get).mockImplementation(
        async (url: string, config?: unknown) => {
            if (url.endsWith('/assistant/capabilities')) {
                return {
                    data: {
                        groups: [
                            {
                                key: 'search_help_knowledge',
                                mode: 'READ',
                                tools: ['search_help_knowledge'],
                            },
                            { key: 'payments', mode: 'READ', tools: ['get_fee_dues'] },
                        ],
                    },
                };
            }
            if (url.endsWith('/assistant/sessions')) {
                const params =
                    (config as { params?: { q?: string; page_size?: number } })?.params ?? {};
                const q = (params.q ?? '').toLowerCase();
                const items = chats
                    .filter((c) => c.title.toLowerCase().includes(q))
                    .slice(0, params.page_size ?? 20);
                return {
                    data: { items, page: 0, page_size: params.page_size ?? 20, has_more: false },
                };
            }
            if (url.endsWith('/assistant/sessions/s-1')) return { data: VIEW };
            throw new Error(`unexpected GET ${url}`);
        }
    );
    vi.mocked(authenticatedAxiosInstance.post).mockResolvedValue({ data: {} });
    vi.mocked(authenticatedAxiosInstance.delete).mockImplementation(async (url: string) => {
        chats = chats.filter((c) => !url.endsWith(`/assistant/sessions/${c.id}`));
        return { data: { status: 'DELETED' } };
    });
    useAssistDock.setState({ panel: 'assistant', pendingPrompt: null });
});

describe('assistant panel empty state', () => {
    it('greets by first name, lists capabilities, starters and the three latest chats', async () => {
        render(tree());
        expect(
            await screen.findByRole('heading', { name: 'Hi Asha, how can I help?' })
        ).toBeTruthy();
        expect(await screen.findByText('How-to guidance')).toBeTruthy();
        expect(screen.getByText('Fees & payments')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'How do I create a course?' })).toBeTruthy();
        const recent = await screen.findByRole('region', { name: panel.recentChats });
        const rows = within(recent).getAllByRole('button', { name: /^Open chat:/ });
        expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
            'Open chat: Who owes fees this week?',
            'Open chat: How do I create a course?',
            'Open chat: Pending evaluations',
        ]);
        const listCall = vi
            .mocked(authenticatedAxiosInstance.get)
            .mock.calls.find(([url]) => String(url).endsWith('/assistant/sessions'));
        expect((listCall?.[1] as { params: { page_size: number } }).params.page_size).toBe(3);
    });
});

describe('assistant chat history', () => {
    it('lists chats under Today and Earlier and searches by title', async () => {
        render(tree());
        fireEvent.click(screen.getByRole('button', { name: panel.actions.history }));
        const today = await screen.findByRole('region', { name: panel.history.today });
        const earlier = screen.getByRole('region', { name: panel.history.earlier });
        expect(within(today).getAllByRole('button', { name: /^Open chat:/ })).toHaveLength(1);
        expect(within(earlier).getAllByRole('button', { name: /^Open chat:/ })).toHaveLength(3);

        const search = screen.getByRole('searchbox', { name: panel.history.search });
        expect(document.activeElement).toBe(search);
        fireEvent.change(search, { target: { value: 'course' } });
        await waitFor(() =>
            expect(screen.getAllByRole('button', { name: /^Open chat:/ })).toHaveLength(1)
        );
        expect(
            screen.getByRole('button', { name: 'Open chat: How do I create a course?' })
        ).toBeTruthy();
        fireEvent.change(search, { target: { value: 'zzz' } });
        expect(await screen.findByText('No chats match “zzz”.')).toBeTruthy();
    });

    it('opens a past chat read-only with its cards settled, then continues it', async () => {
        render(tree());
        fireEvent.click(screen.getByRole('button', { name: panel.actions.history }));
        fireEvent.click(
            await screen.findByRole('button', { name: 'Open chat: Who owes fees this week?' })
        );

        expect(await screen.findByText(panel.pastChat.notice)).toBeTruthy();
        expect(screen.getByText('Three learners owe fees.')).toBeTruthy();
        // the table scrolls inside its own region
        expect(
            screen.getByRole('region', { name: panel.tableLabel }).querySelector('table')
        ).toBeTruthy();
        // an old open card is shown as expired and cannot be confirmed; a used one stays applied
        expect(screen.getByText(panel.card.expired)).toBeTruthy();
        expect(screen.getByText(panel.card.executed)).toBeTruthy();
        expect(screen.queryByRole('button', { name: panel.card.confirm })).toBeNull();
        // follow-ups of the last answer
        const chips = screen.getByRole('group', { name: panel.followUps });
        expect(
            within(chips)
                .getAllByRole('button')
                .map((b) => b.textContent)
        ).toEqual(['Show their payment history', 'Who paid this week?']);

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: panel.actions.continue }));
        });
        const posted = vi
            .mocked(authenticatedAxiosInstance.post)
            .mock.calls.map(([u]) => String(u));
        expect(posted.some((u) => /\/assistant\/sessions\/s-1\/continue$/.test(u))).toBe(true);
        expect(screen.queryByText(panel.pastChat.notice)).toBeNull();
    });

    it('a chat that cannot be loaded leaves the panel usable with an error', async () => {
        render(tree());
        fireEvent.click(screen.getByRole('button', { name: panel.actions.history }));
        fireEvent.click(
            await screen.findByRole('button', { name: 'Open chat: Pending evaluations' })
        );
        expect(await screen.findByText(panel.errors.loadChat)).toBeTruthy();
        expect(screen.queryByText(panel.pastChat.notice)).toBeNull();
    });

    it('deletes a chat after confirming, and keeps it on Keep', async () => {
        render(tree());
        fireEvent.click(screen.getByRole('button', { name: panel.actions.history }));
        fireEvent.click(
            await screen.findByRole('button', { name: 'Delete chat: How do I create a course?' })
        );
        expect(screen.getByText(panel.history.deletePrompt)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: panel.history.keep }));
        expect(
            screen.getByRole('button', { name: 'Open chat: How do I create a course?' })
        ).toBeTruthy();
        expect(authenticatedAxiosInstance.delete).not.toHaveBeenCalled();

        fireEvent.click(
            screen.getByRole('button', { name: 'Delete chat: How do I create a course?' })
        );
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: panel.history.confirmDelete }));
        });
        expect(vi.mocked(authenticatedAxiosInstance.delete).mock.calls[0]?.[0]).toMatch(
            /\/assistant\/sessions\/s-2$/
        );
        await waitFor(() =>
            expect(
                screen.queryByRole('button', { name: 'Open chat: How do I create a course?' })
            ).toBeNull()
        );
    });

    it('Escape and the back button return to the chat', async () => {
        render(tree());
        fireEvent.click(screen.getByRole('button', { name: panel.actions.history }));
        const search = await screen.findByRole('searchbox', { name: panel.history.search });
        fireEvent.keyDown(search, { key: 'Escape' });
        expect(screen.queryByRole('searchbox')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: panel.actions.history }));
        fireEvent.click(await screen.findByRole('button', { name: panel.actions.back }));
        expect(screen.queryByRole('searchbox')).toBeNull();
    });
});

describe('history helpers', () => {
    it('groups by local day, keeping order', () => {
        const { today, earlier } = groupChatsByDay(CHATS, now);
        expect(today.map((c) => c.id)).toEqual(['s-1']);
        expect(earlier.map((c) => c.id)).toEqual(['s-2', 's-3', 's-4']);
        expect(groupChatsByDay([{ ...CHATS[0]!, last_active: null }], now).earlier).toHaveLength(1);
    });

    it('maps history messages, settling open cards as expired', () => {
        const msgs = messagesFromHistory(VIEW);
        expect(msgs.map((m) => m.role)).toEqual(['user', 'action', 'action', 'assistant']);
        expect(msgs[1]?.action).toMatchObject({
            actionId: '',
            status: 'expired',
            details: ['Asha: ₹5,000'],
        });
        expect(msgs[2]?.action?.status).toBe('executed');
        expect(msgs[3]?.suggestions).toEqual(['Show their payment history', 'Who paid this week?']);
    });
});
