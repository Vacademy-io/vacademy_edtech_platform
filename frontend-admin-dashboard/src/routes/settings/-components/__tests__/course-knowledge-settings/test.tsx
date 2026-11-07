import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Backed by the REAL en locale, so a key the section renders but the locale
// never defines shows up as the raw key path and fails the copy assertions.
vi.mock('react-i18next', async () => {
    const en = (await import('../../../../../../public/locales/en/settingsCourseKnowledge.json'))
        .default as Record<string, unknown>;
    const translate = (key: string, vars?: Record<string, unknown>) => {
        const value = key
            .split('.')
            .reduce<unknown>(
                (acc, part) =>
                    acc && typeof acc === 'object'
                        ? (acc as Record<string, unknown>)[part]
                        : undefined,
                en
            );
        if (typeof value !== 'string') return key;
        return value.replace(/{{(\w+)}}/g, (_, name: string) => String(vars?.[name] ?? ''));
    };
    return { useTranslation: () => ({ t: translate, i18n: { language: 'en' } }) };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// The hooks call the service functions from inside their own module, so the
// HTTP layer is what gets mocked: GET /status, PUT /settings, DELETE /data.
const statusMock = vi.fn();
const putMock = vi.fn();
const deleteMock = vi.fn();
vi.mock('@/lib/auth/axiosInstance', () => ({
    default: {
        get: async (url: string) => {
            if (!url.endsWith('/course-knowledge/v1/status')) throw new Error(`GET ${url}`);
            return { data: await statusMock() };
        },
        put: async (url: string, body: unknown) => {
            if (!url.endsWith('/course-knowledge/v1/settings')) throw new Error(`PUT ${url}`);
            return { data: await putMock(body) };
        },
        delete: async (url: string) => {
            if (!url.endsWith('/course-knowledge/v1/data')) throw new Error(`DELETE ${url}`);
            return { data: await deleteMock() };
        },
    },
}));

import { CourseKnowledgeSettingsSection } from '@/routes/settings/-components/CourseKnowledgeSettingsSection';
import {
    COURSE_KNOWLEDGE_UNAVAILABLE,
    type CourseKnowledgeStatus,
} from '@/services/course-knowledge-settings';

const status = (over: Partial<CourseKnowledgeStatus> = {}): CourseKnowledgeStatus => ({
    ...COURSE_KNOWLEDGE_UNAVAILABLE,
    available: true,
    enabled: true,
    learner_answers_enabled: false,
    auto_paid_enabled: true,
    monthly_auto_cap_credits: 500,
    month_auto_spent_credits: 140,
    max_monthly_auto_cap: 5000,
    paid_available: true,
    retrieval_mode: 'on',
    can_manage: true,
    ...over,
});

const renderSection = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <CourseKnowledgeSettingsSection />
        </QueryClientProvider>
    );
};

beforeEach(() => {
    statusMock.mockReset();
    putMock.mockReset();
    deleteMock.mockReset();
});

describe('CourseKnowledgeSettingsSection', () => {
    it('renders nothing when the feature is not available', async () => {
        statusMock.mockResolvedValue({ ...COURSE_KNOWLEDGE_UNAVAILABLE });
        const { container } = renderSection();
        await waitFor(() => expect(statusMock).toHaveBeenCalled());
        await new Promise((r) => setTimeout(r, 0));
        expect(container).toBeEmptyDOMElement();
        expect(screen.queryByText('Course knowledge')).toBeNull();
    });

    it('renders nothing when the status call fails', async () => {
        statusMock.mockRejectedValue(new Error('boom'));
        const { container } = renderSection();
        await waitFor(() => expect(statusMock).toHaveBeenCalled());
        await new Promise((r) => setTimeout(r, 0));
        expect(container).toBeEmptyDOMElement();
    });

    it('is fully read-only for staff who cannot manage', async () => {
        statusMock.mockResolvedValue(status({ can_manage: false }));
        renderSection();
        expect(await screen.findByText('Course knowledge')).toBeInTheDocument();
        expect(screen.getByText('Only admins can change these settings.')).toBeInTheDocument();

        const switches = screen.getAllByRole('switch');
        expect(switches).toHaveLength(3);
        switches.forEach((s) => expect(s).toBeDisabled());
        screen.getAllByRole('checkbox').forEach((c) => expect(c).toBeDisabled());
        expect(
            screen.getByLabelText('Monthly credit limit for automatic processing')
        ).toBeDisabled();

        expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /delete course ai data/i })).toBeNull();
        expect(screen.getByText('Used this month: 140 of 500 credits')).toBeInTheDocument();
    });

    it('hides the automatic processing controls when paid processing is off', async () => {
        statusMock.mockResolvedValue(status({ paid_available: false }));
        renderSection();
        expect(await screen.findByText('Course knowledge')).toBeInTheDocument();
        expect(screen.getAllByRole('switch')).toHaveLength(2);
        expect(screen.queryByText('Automatically process scans and videos')).toBeNull();
        expect(screen.queryByRole('checkbox')).toBeNull();
    });

    it('keeps learner answers disabled while lessons are not made AI-ready', async () => {
        statusMock.mockResolvedValue(status({ enabled: false }));
        renderSection();
        await screen.findByText('Course knowledge');
        expect(screen.getByLabelText('Answer learners from course content')).toBeDisabled();
        fireEvent.click(screen.getByLabelText('Make new and edited lessons AI-ready'));
        expect(screen.getByLabelText('Answer learners from course content')).not.toBeDisabled();
    });

    it('saves only the changed fields for admins', async () => {
        statusMock.mockResolvedValue(status());
        putMock.mockResolvedValue(status({ learner_answers_enabled: true }));
        renderSection();
        await screen.findByText('Course knowledge');
        const save = screen.getByRole('button', { name: /save/i });
        expect(save).toBeDisabled();

        fireEvent.click(screen.getByLabelText('Answer learners from course content'));
        fireEvent.change(screen.getByLabelText('Monthly credit limit for automatic processing'), {
            target: { value: '800' },
        });
        fireEvent.click(screen.getByRole('button', { name: /save/i }));

        await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
        expect(putMock.mock.calls[0]?.[0]).toEqual({
            learner_answers_enabled: true,
            monthly_auto_cap_credits: 800,
        });
    });

    it('rejects a cap above the platform maximum without calling the API', async () => {
        statusMock.mockResolvedValue(status({ max_monthly_auto_cap: 1000 }));
        renderSection();
        await screen.findByText('Course knowledge');
        fireEvent.change(screen.getByLabelText('Monthly credit limit for automatic processing'), {
            target: { value: '1500' },
        });
        fireEvent.click(screen.getByRole('button', { name: /save/i }));
        expect(await screen.findByText(/at most/)).toBeInTheDocument();
        expect(putMock).not.toHaveBeenCalled();
    });

    it('deletes course AI data only after confirming in the dialog', async () => {
        statusMock.mockResolvedValue(status());
        deleteMock.mockResolvedValue({ deleted: true, queue_rows_deleted: 3, runs_cancelled: 0 });
        renderSection();
        await screen.findByText('Course knowledge');
        fireEvent.click(screen.getByRole('button', { name: /delete course ai data/i }));
        expect(deleteMock).not.toHaveBeenCalled();
        fireEvent.click(await screen.findByRole('button', { name: 'Delete data' }));
        await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(1));
    });
});
