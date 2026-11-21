import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import copy from '../../../../../public/locales/en/dashboardIndex.json';
import { VacademyAssistant } from '../../VacademyAssistant';
import { followUps } from '../../useVacademyAssistant';
import { useAssistDock } from '@/components/assist-dock/store';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';

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
    getTokenDecodedData: () => ({ fullname: '' }),
}));
vi.mock('../../useInstituteChatbotName', () => ({ useInstituteChatbotName: () => 'Assistant' }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));

const panel = copy.assistant.panel;
const i18n = createInstance();
void i18n.init({
    lng: 'en',
    resources: { en: { dashboardIndex: copy } },
    interpolation: { escapeValue: false },
});

/** An SSE answer, as the stream endpoint writes it. */
function sse(...frames: Array<[string, unknown]>) {
    const text = frames
        .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        .join('');
    const bytes = new TextEncoder().encode(text);
    let sent = false;
    return {
        ok: true,
        status: 200,
        body: {
            getReader: () => ({
                read: async () => {
                    if (sent) return { done: true, value: undefined };
                    sent = true;
                    return { done: false, value: bytes };
                },
            }),
        },
    };
}

const answer = (content: string, suggestions?: string[]) =>
    sse(
        [
            'message',
            {
                id: 1,
                type: 'tool_call',
                content: 'Calling get_fee_dues',
                metadata: { tool_name: 'get_fee_dues' },
            },
        ],
        ['token', { content }],
        [
            'message',
            {
                id: 2,
                type: 'assistant',
                content,
                metadata: {},
                ...(suggestions ? { suggestions } : {}),
            },
        ]
    );

const fetchMock = vi.fn();

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
    vi.mocked(authenticatedAxiosInstance.get).mockReset();
    vi.mocked(authenticatedAxiosInstance.post).mockReset();
    vi.mocked(authenticatedAxiosInstance.get).mockImplementation(async (url: string) =>
        url.endsWith('/assistant/sessions')
            ? { data: { items: [], page: 0, page_size: 3, has_more: false } }
            : { data: { groups: [] } }
    );
    vi.mocked(authenticatedAxiosInstance.post).mockImplementation(async (url: string) =>
        url.endsWith('/assistant/session/init') ? { data: { session_id: 's-9' } } : { data: {} }
    );
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    useAssistDock.setState({ panel: 'assistant', pendingPrompt: null });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

async function ask(text: string) {
    const box = screen.getByRole('textbox', { name: 'Message Assistant' });
    fireEvent.change(box, { target: { value: text } });
    await act(async () => {
        fireEvent.keyDown(box, { key: 'Enter' });
    });
}

describe('follow-up suggestions', () => {
    it('shows the answer’s suggestions as chips that send when clicked', async () => {
        fetchMock.mockResolvedValueOnce(
            answer('Asha owes 5,000.', ['Show her payments', 'Who else is overdue?'])
        );
        render(tree());
        await ask('Does Asha owe fees?');

        const chips = await screen.findByRole('group', { name: panel.followUps });
        expect(
            within(chips)
                .getAllByRole('button')
                .map((b) => b.textContent)
        ).toEqual(['Show her payments', 'Who else is overdue?']);

        fetchMock.mockResolvedValueOnce(answer('Two payments this year.'));
        await act(async () => {
            fireEvent.click(within(chips).getByRole('button', { name: 'Show her payments' }));
        });
        const sent = vi
            .mocked(authenticatedAxiosInstance.post)
            .mock.calls.find(([url]) => String(url).endsWith('/assistant/session/s-9/message'));
        expect((sent?.[1] as { message: string }).message).toBe('Show her payments');
        await screen.findByText('Two payments this year.');
        // the new answer came without suggestions: no chips, none made up
        expect(screen.queryByRole('group', { name: panel.followUps })).toBeNull();
    });

    it('shows no chips when the answer has none', async () => {
        fetchMock.mockResolvedValueOnce(answer('Nobody owes fees.'));
        render(tree());
        await ask('Who owes fees?');
        await screen.findByText('Nobody owes fees.');
        expect(screen.queryByRole('group', { name: panel.followUps })).toBeNull();
    });

    it('copies an answer and says so', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        fetchMock.mockResolvedValueOnce(answer('Asha owes 5,000.'));
        render(tree());
        await ask('Does Asha owe fees?');
        await screen.findByText('Asha owes 5,000.');
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: panel.actions.copy }));
        });
        expect(writeText).toHaveBeenCalledWith('Asha owes 5,000.');
        await waitFor(() =>
            expect(screen.getByRole('button', { name: panel.actions.copied })).toBeTruthy()
        );
    });
});

describe('followUps', () => {
    it('keeps at most three non-empty strings and never makes any up', () => {
        expect(followUps(undefined)).toBeUndefined();
        expect(followUps('one')).toBeUndefined();
        expect(followUps([])).toBeUndefined();
        expect(followUps(['', '  ', 4, null])).toBeUndefined();
        expect(followUps([' a ', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c']);
        expect(followUps(['x'.repeat(121), 'ok'])).toEqual(['ok']);
    });
});
