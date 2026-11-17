import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import copy from '../../../../../public/locales/en/assistDock.json';
import { AssistantFab } from '../../AssistantFab';
import { useAssistDock } from '../../store';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import type { AssistantCapabilities } from '@/components/vacademy-assistant/types';

const session = vi.hoisted(() => {
    // Node's unconfigured Web Storage global shadows happy-dom's, leaving
    // `localStorage` undefined in this environment; install an in-memory one.
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        value: {
            getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
            setItem: (k: string, v: string) => void store.set(k, String(v)),
            removeItem: (k: string) => void store.delete(k),
            clear: () => store.clear(),
        },
        configurable: true,
        writable: true,
    });
    return {
        token: 'token' as string | null,
        expired: false,
        pathname: '/dashboard',
    };
});

vi.mock('@/lib/auth/axiosInstance', () => ({ default: { get: vi.fn() } }));
vi.mock('@/constants/urls', () => ({ ASSISTANT_CAPABILITIES: '/assistant/capabilities' }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('@/lib/auth/sessionUtility', () => ({
    getTokenFromCookie: () => session.token,
    isTokenExpired: () => session.expired,
    getTokenDecodedData: () => ({ user: 'user-1' }),
}));
vi.mock('@tanstack/react-router', () => ({
    useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
        select({ location: { pathname: session.pathname } }),
}));

const i18n = createInstance();
void i18n.init({
    lng: 'en',
    resources: { en: { assistDock: copy } },
    interpolation: { escapeValue: false },
});

const enabledCapabilities: AssistantCapabilities = {
    groups: [{ key: 'search_help_knowledge', mode: 'READ', tools: ['search_help_knowledge'] }],
};

const fabLabel = copy.assistantFab.label;
const hintText = copy.assistantFab.hint;

function mount(capabilities?: AssistantCapabilities) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    if (capabilities) client.setQueryData(['assistant-capabilities'], capabilities);
    return render(
        <I18nextProvider i18n={i18n}>
            <QueryClientProvider client={client}>
                <AssistantFab />
            </QueryClientProvider>
        </I18nextProvider>
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    session.token = 'token';
    session.expired = false;
    session.pathname = '/dashboard';
    useAssistDock.setState({
        panel: 'none',
        activeTutorial: null,
        minimized: false,
        dockVisible: true,
        assistantFabEnabled: false,
    });
});

describe('assistant floating button', () => {
    it('opens the assistant panel in one click and then steps aside', () => {
        mount(enabledCapabilities);
        fireEvent.click(screen.getByRole('button', { name: fabLabel }));
        expect(useAssistDock.getState().panel).toBe('assistant');
        expect(screen.queryByRole('button', { name: fabLabel })).not.toBeInTheDocument();
    });

    it('opens the panel while the rail is collapsed to its pull-tab', () => {
        useAssistDock.setState({ minimized: true });
        mount(enabledCapabilities);
        fireEvent.click(screen.getByRole('button', { name: fabLabel }));
        expect(useAssistDock.getState().panel).toBe('assistant');
    });

    it('stays hidden while any dock panel or walkthrough is open', () => {
        useAssistDock.setState({ panel: 'tutorials' });
        const first = mount(enabledCapabilities);
        expect(screen.queryByRole('button', { name: fabLabel })).not.toBeInTheDocument();
        first.unmount();

        useAssistDock.setState({ panel: 'none', activeTutorial: { file: 'a.html', title: 'A' } });
        const second = mount(enabledCapabilities);
        expect(screen.queryByRole('button', { name: fabLabel })).not.toBeInTheDocument();
        second.unmount();

        // Still offered on the page, so layouts keep its room while it steps aside.
        expect(useAssistDock.getState().assistantFabEnabled).toBe(true);
        useAssistDock.setState({ activeTutorial: null });
        mount(enabledCapabilities);
        expect(screen.getByRole('button', { name: fabLabel })).toBeInTheDocument();
    });

    it('is hidden when signed out or the session has expired', () => {
        session.token = null;
        const first = mount(enabledCapabilities);
        expect(first.container).toBeEmptyDOMElement();
        first.unmount();

        session.token = 'token';
        session.expired = true;
        const second = mount(enabledCapabilities);
        expect(second.container).toBeEmptyDOMElement();
    });

    it.each(['/login', '/signup/onboarding', '/demo', '/pricing', '/mcp/authorize'])(
        'is hidden on the public route %s',
        (pathname) => {
            session.pathname = pathname;
            const { container } = mount(enabledCapabilities);
            expect(container).toBeEmptyDOMElement();
        }
    );

    it('is hidden, without asking the server, when the dock is off for this role', () => {
        useAssistDock.setState({ dockVisible: false });
        const { container } = mount();
        expect(container).toBeEmptyDOMElement();
        expect(authenticatedAxiosInstance.get).not.toHaveBeenCalled();
    });

    it('is hidden when the user has no assistant capabilities', () => {
        const { container } = mount({ groups: [] });
        expect(container).toBeEmptyDOMElement();
        expect(useAssistDock.getState().assistantFabEnabled).toBe(false);
    });

    it('is hidden while capabilities load and when they fail to load', async () => {
        vi.mocked(authenticatedAxiosInstance.get).mockRejectedValueOnce(new Error('offline'));
        const { container } = mount();
        expect(container).toBeEmptyDOMElement();
        await waitFor(() => expect(authenticatedAxiosInstance.get).toHaveBeenCalledTimes(1));
        expect(container).toBeEmptyDOMElement();
    });

    it('asks the server once and remembers the answer for the next page load', async () => {
        vi.mocked(authenticatedAxiosInstance.get).mockResolvedValueOnce({
            data: enabledCapabilities,
        });
        const first = mount();
        await screen.findByRole('button', { name: fabLabel });
        expect(useAssistDock.getState().assistantFabEnabled).toBe(true);
        first.unmount();

        mount();
        expect(screen.getByRole('button', { name: fabLabel })).toBeInTheDocument();
        expect(authenticatedAxiosInstance.get).toHaveBeenCalledTimes(1);
    });

    it('asks again when the remembered answer is stale or belongs to someone else', async () => {
        localStorage.setItem(
            'assistantFabAvailability',
            JSON.stringify({
                scope: 'inst-1:user-1',
                at: Date.now() - 6 * 60 * 1000,
                available: true,
            })
        );
        vi.mocked(authenticatedAxiosInstance.get).mockResolvedValue({ data: { groups: [] } });
        const first = mount();
        await waitFor(() => expect(authenticatedAxiosInstance.get).toHaveBeenCalledTimes(1));
        expect(first.container).toBeEmptyDOMElement();
        first.unmount();

        localStorage.setItem(
            'assistantFabAvailability',
            JSON.stringify({ scope: 'inst-2:user-9', at: Date.now(), available: true })
        );
        mount();
        await waitFor(() => expect(authenticatedAxiosInstance.get).toHaveBeenCalledTimes(2));
    });

    it('shows a first-visit hint that is dismissed for good', () => {
        const first = mount(enabledCapabilities);
        expect(screen.getByRole('button', { name: hintText })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: copy.assistantFab.dismissHint }));
        expect(screen.queryByRole('button', { name: hintText })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: fabLabel })).toBeInTheDocument();
        expect(localStorage.getItem('assistantFabHintSeen')).toBe('1');
        first.unmount();

        mount(enabledCapabilities);
        expect(screen.queryByRole('button', { name: hintText })).not.toBeInTheDocument();
    });

    it('opens the assistant from the hint and stops showing it', () => {
        mount(enabledCapabilities);
        fireEvent.click(screen.getByRole('button', { name: hintText }));
        expect(useAssistDock.getState().panel).toBe('assistant');
        expect(localStorage.getItem('assistantFabHintSeen')).toBe('1');
    });

    it('still works when storage throws', () => {
        const getItem = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        mount(enabledCapabilities);
        fireEvent.click(screen.getByRole('button', { name: hintText }));
        expect(useAssistDock.getState().panel).toBe('assistant');
        getItem.mockRestore();
        setItem.mockRestore();
    });
});
