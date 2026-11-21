import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import copy from '../../../../../public/locales/en/dashboardIndex.json';
import { VacademyAssistant } from '../../VacademyAssistant';
import { useAssistDock } from '@/components/assist-dock/store';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';

const session = vi.hoisted(() => ({ expired: false, pathname: '/dashboard' }));

vi.mock('@/lib/auth/axiosInstance', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/constants/urls', () => ({
    ASSISTANT_CAPABILITIES: '/assistant/capabilities',
    ASSISTANT_SPEECH_TO_TEXT: '/assistant/speech-to-text',
    ASSISTANT_SESSIONS: '/assistant/sessions',
    ASSISTANT_SESSION_VIEW: (id: string) => `/assistant/sessions/${id}`,
}));
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
    useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
        select({ location: { pathname: session.pathname } }),
}));
vi.mock('@/lib/auth/sessionUtility', () => ({
    getTokenFromCookie: () => 'token',
    isTokenExpired: () => session.expired,
    getTokenDecodedData: () => ({ fullname: 'Asha Rao' }),
}));
vi.mock('../../useVacademyAssistant', () => ({
    useVacademyAssistant: () => ({
        messages: [],
        status: 'idle',
        error: null,
        activity: null,
        sessionId: null,
        pastChat: null,
        loadingChat: false,
        sendMessage: vi.fn(),
        reset: vi.fn(),
        resolveAction: vi.fn(),
        openChat: vi.fn(),
        continueChat: vi.fn(),
        forgetChat: vi.fn(),
    }),
}));
vi.mock('../../useInstituteChatbotName', () => ({ useInstituteChatbotName: () => 'Assistant' }));

const i18n = createInstance();
void i18n.init({
    lng: 'en',
    resources: { en: { dashboardIndex: copy } },
    interpolation: { escapeValue: false },
});
const voiceCopy = copy.assistant.voice;

class FakeMediaRecorder {
    static instances: FakeMediaRecorder[] = [];
    static isTypeSupported = () => true;
    state: 'inactive' | 'recording' = 'inactive';
    mimeType = 'audio/webm;codecs=opus';
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
        FakeMediaRecorder.instances.push(this);
    }
    start() {
        this.state = 'recording';
    }
    stop() {
        this.state = 'inactive';
        void Promise.resolve().then(() => {
            this.ondataavailable?.({ data: new Blob(['a'.repeat(64)], { type: this.mimeType }) });
            this.onstop?.();
        });
    }
}

const getUserMedia = vi.fn();
const track = { stop: vi.fn(), addEventListener: vi.fn() };

function tree() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    client.setQueryData(['assistant-capabilities'], { groups: [] });
    return (
        <I18nextProvider i18n={i18n}>
            <QueryClientProvider client={client}>
                <VacademyAssistant />
            </QueryClientProvider>
        </I18nextProvider>
    );
}

beforeEach(() => {
    session.expired = false;
    session.pathname = '/dashboard';
    FakeMediaRecorder.instances = [];
    track.stop.mockReset();
    getUserMedia.mockReset();
    vi.mocked(authenticatedAxiosInstance.post).mockReset();
    vi.mocked(authenticatedAxiosInstance.get).mockResolvedValue({ data: { groups: [] } });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(window, 'MediaRecorder', {
        value: FakeMediaRecorder,
        configurable: true,
        writable: true,
    });
    Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia },
        configurable: true,
    });
    useAssistDock.setState({ panel: 'assistant', pendingPrompt: null });
});

describe('assistant panel microphone', () => {
    it('closing the panel during the permission prompt never starts recording', async () => {
        let grant: (stream: unknown) => void = () => {};
        getUserMedia.mockImplementationOnce(() => new Promise((resolve) => (grant = resolve)));
        render(tree());
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: voiceCopy.start }));
        });
        act(() => useAssistDock.setState({ panel: 'none' }));
        await act(async () => {
            grant({ getTracks: () => [track] });
        });
        expect(track.stop).toHaveBeenCalled();
        expect(FakeMediaRecorder.instances).toHaveLength(0);
        expect(authenticatedAxiosInstance.post).not.toHaveBeenCalled();
    });

    it.each([
        ['the session expires', () => (session.expired = true)],
        ['the route becomes public', () => (session.pathname = '/login')],
    ])('a recording is discarded when %s and the panel stops rendering', async (_label, hide) => {
        getUserMedia.mockResolvedValue({ getTracks: () => [track] });
        const { rerender } = render(tree());
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: voiceCopy.start }));
        });
        expect(FakeMediaRecorder.instances[0]?.state).toBe('recording');

        hide();
        await act(async () => {
            rerender(tree());
        });
        expect(screen.queryByRole('button', { name: voiceCopy.stop })).toBeNull();
        expect(FakeMediaRecorder.instances[0]?.state).toBe('inactive');
        expect(track.stop).toHaveBeenCalled();
        expect(authenticatedAxiosInstance.post).not.toHaveBeenCalled();
    });

    it('closing the panel while recording discards the recording', async () => {
        getUserMedia.mockResolvedValue({ getTracks: () => [track] });
        render(tree());
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: voiceCopy.start }));
        });
        await act(async () => useAssistDock.setState({ panel: 'none' }));
        expect(FakeMediaRecorder.instances[0]?.state).toBe('inactive');
        expect(track.stop).toHaveBeenCalled();
        expect(authenticatedAxiosInstance.post).not.toHaveBeenCalled();
    });
});
