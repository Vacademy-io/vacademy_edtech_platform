import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import copy from '../../../../../public/locales/en/dashboardIndex.json';
import { AssistantLaunchBar } from '../../AssistantLaunchBar';
import { useAssistDock } from '@/components/assist-dock/store';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import type { AssistantCapabilities } from '../../types';

vi.mock('@/lib/auth/axiosInstance', () => ({ default: { get: vi.fn() } }));
vi.mock('@/constants/urls', () => ({ ASSISTANT_CAPABILITIES: '/assistant/capabilities' }));

const i18n = createInstance();
void i18n.init({
    lng: 'en',
    resources: { en: { dashboardIndex: copy } },
    interpolation: { escapeValue: false },
});

const groups: AssistantCapabilities['groups'] = [
    { key: 'announcements', mode: 'WRITE', tools: ['list_announcements', 'send_announcement'] },
    { key: 'assessments', mode: 'READ', tools: ['get_assessment_results'] },
    { key: 'institute_overview', mode: 'READ', tools: ['get_institute_overview'] },
    { key: 'learner_data', mode: 'READ', tools: ['find_learner'] },
    { key: 'schedule', mode: 'READ', tools: ['get_class_schedule'] },
];

function mount(capabilities?: AssistantCapabilities) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    if (capabilities) client.setQueryData(['assistant-capabilities'], capabilities);
    return render(
        <I18nextProvider i18n={i18n}>
            <QueryClientProvider client={client}>
                <AssistantLaunchBar />
            </QueryClientProvider>
        </I18nextProvider>
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    useAssistDock.setState({ panel: 'none', pendingPrompt: null });
});

describe('dashboard assistant entry', () => {
    it('offers four distinct tasks by relevance regardless of API order', () => {
        mount({ groups });
        const suggestions = screen.getByRole('group', { name: copy.assistant.suggestionsLabel });
        expect(
            Array.from(suggestions.querySelectorAll('button')).map((button) => button.textContent)
        ).toEqual([
            'Check pending fees',
            'Find a learner',
            'Pending evaluations',
            'Draft an announcement',
        ]);
    });

    it('does not advertise a write tool to a read-only user or use an unrelated placeholder', () => {
        mount({ groups: [{ key: 'announcements', mode: 'READ', tools: ['list_announcements'] }] });
        expect(
            screen.queryByRole('button', { name: 'Draft an announcement' })
        ).not.toBeInTheDocument();
        expect(screen.getByRole('textbox')).toHaveAttribute(
            'placeholder',
            copy.assistant.placeholder
        );
    });

    it('lets the admin edit a suggested task before handing it to the existing chat', () => {
        mount({ groups });
        fireEvent.click(screen.getByRole('button', { name: 'Draft an announcement' }));
        const input = screen.getByRole('textbox');
        expect(input).toHaveFocus();
        expect(input).toHaveValue(copy.assistant.starters.announcement.prompt);
        expect(useAssistDock.getState().pendingPrompt).toBeNull();
        fireEvent.change(input, {
            target: { value: '  Draft an announcement for the weekend batch.  ' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Ask assistant' }));
        expect(useAssistDock.getState()).toMatchObject({
            panel: 'assistant',
            pendingPrompt: 'Draft an announcement for the weekend batch.',
        });
        expect(input).toHaveValue('');
    });

    it('does not submit whitespace, Shift+Enter, or an IME composition', () => {
        mount({ groups });
        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: '   ' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(screen.getByRole('button', { name: 'Ask assistant' })).toBeDisabled();
        expect(useAssistDock.getState().pendingPrompt).toBeNull();
        fireEvent.change(input, { target: { value: 'Check fees\nfor today' } });
        fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
        fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
        // happy-dom does not implement KeyboardEvent.keyCode.
        const safariComposition = createEvent.keyDown(input, { key: 'Enter' });
        Object.defineProperty(safariComposition, 'keyCode', { value: 229 });
        fireEvent(input, safariComposition);
        expect(useAssistDock.getState().pendingPrompt).toBeNull();
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(useAssistDock.getState().pendingPrompt).toBe('Check fees\nfor today');
    });

    it('opens chat without submitting or discarding the current draft', () => {
        mount({ groups });
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A draft question' } });
        fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));
        expect(useAssistDock.getState()).toMatchObject({ panel: 'assistant', pendingPrompt: null });
        expect(screen.getByRole('textbox')).toHaveValue('A draft question');
    });

    it('hides the entry when no capabilities are enabled', () => {
        const { container } = mount({ groups: [] });
        expect(container).toBeEmptyDOMElement();
    });

    it('keeps the composer unavailable while permissions load and allows retry on failure', async () => {
        vi.mocked(authenticatedAxiosInstance.get).mockRejectedValueOnce(new Error('offline'));
        mount();
        expect(screen.getByRole('status', { name: copy.assistant.loading })).toBeInTheDocument();
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
        await screen.findByText(copy.assistant.unavailable);
        vi.mocked(authenticatedAxiosInstance.get).mockResolvedValueOnce({ data: { groups } });
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument());
    });
});
