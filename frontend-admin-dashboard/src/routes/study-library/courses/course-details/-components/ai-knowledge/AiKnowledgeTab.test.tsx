import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Some Node versions expose a global `localStorage` that is undefined without
// --localstorage-file and shadows happy-dom's; MyTable's global dialogs read it.
vi.hoisted(() => {
    if (typeof globalThis.localStorage?.getItem === 'function') return;
    let store: Record<string, string> = {};
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => store[key] ?? null,
            setItem: (key: string, value: string) => {
                store[key] = String(value);
            },
            removeItem: (key: string) => {
                delete store[key];
            },
            clear: () => {
                store = {};
            },
            key: (index: number) => Object.keys(store)[index] ?? null,
            get length() {
                return Object.keys(store).length;
            },
        },
    });
});

// Backed by the REAL en locale, so a key the tab renders but the locale never
// defines shows up as the raw key path and fails the copy assertions.
vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>();
    const en = (await import('../../../../../../../public/locales/en/courseAiKnowledge.json'))
        .default as Record<string, unknown>;
    const lookup = (key: string) =>
        key
            .split('.')
            .reduce<unknown>(
                (acc, part) =>
                    acc && typeof acc === 'object'
                        ? (acc as Record<string, unknown>)[part]
                        : undefined,
                en
            );
    const translate = (key: string, vars?: Record<string, unknown>) => {
        let value = lookup(key);
        if (typeof value !== 'string' && typeof vars?.count === 'number') {
            value = lookup(`${key}_${vars.count === 1 ? 'one' : 'other'}`);
        }
        if (typeof value !== 'string') return key;
        return value.replace(/{{(\w+)}}/g, (_, name: string) => String(vars?.[name] ?? ''));
    };
    return { ...actual, useTranslation: () => ({ t: translate, i18n: { language: 'en' } }) };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const statusMock = vi.fn();
const coverageMock = vi.fn();
const processMock = vi.fn();
const scanMock = vi.fn();
const putMock = vi.fn();
const keptMock = vi.fn();
const useKeptMock = vi.fn();

const httpError = (status: number, data: unknown) =>
    Object.assign(new Error(`HTTP ${status}`), {
        isAxiosError: true,
        response: { status, data },
    });

vi.mock('@/lib/auth/axiosInstance', () => ({
    default: {
        get: async (url: string) => {
            if (url.endsWith('/course-knowledge/v1/status')) return { data: await statusMock() };
            if (url.endsWith('/coverage')) return { data: await coverageMock() };
            if (url.endsWith('/kept-transcript')) return { data: await keptMock(url) };
            if (url.includes('/credits/v1/')) return { data: { current_balance: '1200' } };
            throw new Error(`GET ${url}`);
        },
        post: async (url: string, body: unknown) => {
            if (url.endsWith('/process')) return { data: await processMock(body) };
            if (url.endsWith('/scan')) return { data: await scanMock() };
            if (url.endsWith('/use-kept-transcript')) return { data: await useKeptMock(url, body) };
            throw new Error(`POST ${url}`);
        },
        put: async (url: string, body: unknown) => {
            if (url.endsWith('/course-knowledge/v1/settings')) return { data: await putMock(body) };
            throw new Error(`PUT ${url}`);
        },
    },
}));

import { AiKnowledgeTab } from './AiKnowledgeTab';
import {
    COURSE_KNOWLEDGE_UNAVAILABLE,
    type CourseKnowledgeStatus,
} from '@/services/course-knowledge-settings';
import type { CourseCoverage, CourseCoverageLesson } from '@/services/course-knowledge';

const status = (over: Partial<CourseKnowledgeStatus> = {}): CourseKnowledgeStatus => ({
    ...COURSE_KNOWLEDGE_UNAVAILABLE,
    available: true,
    enabled: true,
    paid_available: true,
    retrieval_mode: 'on',
    can_manage: true,
    ...over,
});

const lesson = (over: Partial<CourseCoverageLesson>): CourseCoverageLesson => ({
    slide_id: 's1',
    title: 'Kinematics',
    chapter_id: 'c1',
    chapter_name: 'Motion',
    source_type: 'DOCUMENT',
    doc_type: 'PDF',
    state: 'READY',
    reason: null,
    units: null,
    credits: 0,
    credits_charged: 0,
    chunk_count: 4,
    anchor_kind: 'page',
    updated_at: null,
    ...over,
});

const coverage = (over: Partial<CourseCoverage> = {}): CourseCoverage => ({
    package_id: 'pkg-1',
    totals: {
        lessons: 5,
        ready: 2,
        needs_processing: 2,
        processing: 0,
        not_scanned: 0,
        cant_read: 1,
        failed: 0,
        excluded: 0,
        credits_required: 281,
        credits_charged: 0,
    },
    quote: {
        credits: 281,
        approx: false,
        items: [
            { kind: 'ocr_pages', units: 312, credits: 156, lessons: 1 },
            { kind: 'transcribe_minutes', units: 250, credits: 125, lessons: 1 },
        ],
    },
    balance: { current_balance: 1200, balance_after: 919, sufficient: true },
    active_run: null,
    lessons: [
        lesson({ slide_id: 's1' }),
        lesson({ slide_id: 's2', title: 'Vectors' }),
        lesson({
            slide_id: 's3',
            title: 'Scanned notes',
            state: 'NEEDS_PROCESSING',
            reason: 'Scanned PDF · 312 pages need reading',
            credits: 156,
        }),
        lesson({
            slide_id: 's4',
            title: 'Lecture',
            source_type: 'VIDEO',
            doc_type: null,
            state: 'NEEDS_PROCESSING',
            credits: 125,
        }),
        lesson({
            slide_id: 's5',
            title: 'Old deck',
            doc_type: 'DOC',
            state: 'CANT_READ',
            reason: 'Word file: upload it as PDF to make it readable',
        }),
    ],
    ...over,
});

const renderTab = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <AiKnowledgeTab packageId="pkg-1" />
        </QueryClientProvider>
    );
};

const openDialog = async () => {
    fireEvent.click(await screen.findByRole('button', { name: /make course ai-ready/i }));
    return screen.findByText('Step 2 · Process scans and videos');
};

beforeEach(() => {
    statusMock.mockReset();
    coverageMock.mockReset();
    processMock.mockReset();
    scanMock.mockReset();
    putMock.mockReset();
    keptMock.mockReset();
    useKeptMock.mockReset();
});

describe('AiKnowledgeTab', () => {
    it('renders nothing when course knowledge is not available', async () => {
        statusMock.mockResolvedValue({ ...COURSE_KNOWLEDGE_UNAVAILABLE });
        const { container } = renderTab();
        await waitFor(() => expect(statusMock).toHaveBeenCalled());
        await new Promise((r) => setTimeout(r, 0));
        expect(container).toBeEmptyDOMElement();
        expect(coverageMock).not.toHaveBeenCalled();
    });

    it('offers admins to turn the feature on', async () => {
        statusMock.mockResolvedValue(status({ enabled: false }));
        putMock.mockResolvedValue(status());
        renderTab();
        fireEvent.click(await screen.findByRole('button', { name: 'Turn on course knowledge' }));
        await waitFor(() => expect(putMock).toHaveBeenCalledWith({ enabled: true }));
    });

    it('tells teachers to ask an admin', async () => {
        statusMock.mockResolvedValue(status({ enabled: false, can_manage: false }));
        renderTab();
        expect(await screen.findByText('Ask an admin to turn this on.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Turn on course knowledge' })).toBeNull();
    });

    it('shows the empty state for a course with no published lessons', async () => {
        statusMock.mockResolvedValue(status());
        coverageMock.mockResolvedValue(
            coverage({
                totals: { ...coverage().totals, lessons: 0, ready: 0, needs_processing: 0 },
                lessons: [],
            })
        );
        renderTab();
        expect(await screen.findByText('No published lessons yet.')).toBeInTheDocument();
    });

    it('shows an error with a retry when coverage fails', async () => {
        statusMock.mockResolvedValue(status());
        // A 4xx is final (no automatic retry), so the error state shows at once.
        coverageMock.mockRejectedValueOnce(
            httpError(404, { detail: { code: 'course_not_found', message: 'Course not found' } })
        );
        coverageMock.mockResolvedValue(coverage());
        renderTab();
        expect(await screen.findByText('Course not found')).toBeInTheDocument();
        fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
        expect(await screen.findByText(/AI can answer from 2 of 5 lessons\./)).toBeInTheDocument();
    });

    it('summarises coverage and lists lessons', async () => {
        statusMock.mockResolvedValue(status());
        coverageMock.mockResolvedValue(coverage());
        renderTab();
        expect(
            await screen.findByText(
                /AI can answer from 2 of 5 lessons\. 2 need processing \(≈ 281 credits\)\. 1 can't be read\./
            )
        ).toBeInTheDocument();
        expect(screen.getByText('Scanned notes')).toBeInTheDocument();
        expect(
            screen.getByText('Word file: upload it as PDF to make it readable')
        ).toBeInTheDocument();
        expect(screen.getAllByText('Test what the AI finds').length).toBeGreaterThan(0);
        expect(
            screen.getByText('Preview searches every published lesson and ignores drip locks.')
        ).toBeInTheDocument();
    });

    it('disables the button with All set when there is nothing to do', async () => {
        statusMock.mockResolvedValue(status());
        coverageMock.mockResolvedValue(
            coverage({
                quote: { credits: 0, approx: false, items: [] },
                totals: { ...coverage().totals, needs_processing: 0, not_scanned: 0 },
            })
        );
        renderTab();
        expect(await screen.findByRole('button', { name: /all set/i })).toBeDisabled();
    });

    it('shows the exact coverage quote and processes it for the quoted credits', async () => {
        statusMock.mockResolvedValue(status());
        coverageMock.mockResolvedValue(coverage());
        processMock.mockResolvedValue({ run_id: 'run-1', quoted_credits: 281, lessons_queued: 2 });
        renderTab();
        await openDialog();
        expect(screen.getByText('Scanned PDFs: 312 pages · 156 credits')).toBeInTheDocument();
        expect(screen.getByText('Videos and audio: 4 h 10 min · 125 credits')).toBeInTheDocument();
        expect(await screen.findByText('Balance 1,200 → 919 after')).toBeInTheDocument();
        expect(
            screen.getByText(
                'You will never be charged more than 281 credits. Files already processed elsewhere are free.'
            )
        ).toBeInTheDocument();
        expect(scanMock).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: /process for 281 credits/i }));
        await waitFor(() => expect(processMock).toHaveBeenCalledWith({ expected_credits: 281 }));
    });

    it('refreshes the quote and says so on 409 QUOTE_CHANGED', async () => {
        statusMock.mockResolvedValue(status());
        coverageMock.mockResolvedValue(coverage());
        processMock.mockRejectedValue(
            httpError(409, {
                detail: {
                    code: 'QUOTE_CHANGED',
                    message: 'The amount changed to 430 credits.',
                    quote: { credits: 430, approx: false, items: [] },
                },
            })
        );
        renderTab();
        await openDialog();
        const callsBefore = coverageMock.mock.calls.length;
        fireEvent.click(screen.getByRole('button', { name: /process for 281 credits/i }));
        expect(await screen.findByText('The amount changed to 430 credits.')).toBeInTheDocument();
        expect(coverageMock.mock.calls.length).toBeGreaterThan(callsBefore);
    });

    it('shows Not enough credits on 402', async () => {
        statusMock.mockResolvedValue(status());
        coverageMock.mockResolvedValue(coverage());
        processMock.mockRejectedValue(
            httpError(402, {
                detail: {
                    message:
                        'This needs about 281 credits but only 20 are available. Top up to continue.',
                    estimate: { estimated_credits: 281, current_balance: 20, sufficient: false },
                },
            })
        );
        renderTab();
        await openDialog();
        fireEvent.click(screen.getByRole('button', { name: /process for 281 credits/i }));
        expect(await screen.findByText('Not enough credits')).toBeInTheDocument();
        expect(
            screen.getByText(
                'This needs about 281 credits but only 20 are available. Top up to continue.'
            )
        ).toBeInTheDocument();
    });

    it('shows teachers the quote read-only', async () => {
        statusMock.mockResolvedValue(status({ can_manage: false }));
        coverageMock.mockResolvedValue(coverage());
        renderTab();
        await openDialog();
        expect(screen.getByText('Scanned PDFs: 312 pages · 156 credits')).toBeInTheDocument();
        expect(screen.getByText('Ask an admin to approve.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /process for/i })).toBeNull();
    });

    it('explains when paid processing is off', async () => {
        statusMock.mockResolvedValue(status({ paid_available: false }));
        coverageMock.mockResolvedValue(coverage());
        renderTab();
        await openDialog();
        expect(
            screen.getByText('Paid processing is not available for your institute yet.')
        ).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /process for/i })).toBeNull();
    });

    it('lets an admin use a transcript the speech check rejected', async () => {
        statusMock.mockResolvedValue(status());
        coverageMock.mockResolvedValue(
            coverage({
                lessons: [
                    lesson({
                        slide_id: 's9',
                        title: 'Morning chanting',
                        source_type: 'VIDEO',
                        doc_type: null,
                        state: 'CANT_READ',
                        reason: 'The recording has no clear speech',
                        kept_transcript: { minutes: 74, credits: 37 },
                    }),
                ],
            })
        );
        keptMock.mockResolvedValue({
            slide_id: 's9',
            minutes: 74,
            credits: 37,
            words: 5120,
            preview: 'Om namah shivaya, today we chant',
        });
        useKeptMock.mockResolvedValue({ slide_id: 's9', queued: true, credits_charged: 37 });
        renderTab();
        fireEvent.click(await screen.findByRole('button', { name: /use transcript/i }));
        expect(await screen.findByText('Om namah shivaya, today we chant')).toBeInTheDocument();
        expect(screen.getByText('74 minutes')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Use it · 37 credits' }));
        await waitFor(() =>
            expect(useKeptMock).toHaveBeenCalledWith(
                expect.stringContaining('/packages/pkg-1/lessons/s9/use-kept-transcript'),
                { expected_credits: 37 }
            )
        );
    });

    it('hides the kept transcript action from teachers', async () => {
        statusMock.mockResolvedValue(status({ can_manage: false }));
        coverageMock.mockResolvedValue(
            coverage({
                lessons: [
                    lesson({
                        slide_id: 's9',
                        source_type: 'VIDEO',
                        doc_type: null,
                        state: 'CANT_READ',
                        kept_transcript: { minutes: 74, credits: 37 },
                    }),
                ],
            })
        );
        renderTab();
        await screen.findByText('Lessons');
        expect(screen.queryByRole('button', { name: /use transcript/i })).toBeNull();
    });

    it('starts the free scan when lessons are not scanned yet', async () => {
        statusMock.mockResolvedValue(status());
        coverageMock.mockResolvedValue(
            coverage({ totals: { ...coverage().totals, not_scanned: 3 } })
        );
        scanMock.mockResolvedValue({ run_id: 'run-scan', lessons_queued: 3 });
        renderTab();
        fireEvent.click(await screen.findByRole('button', { name: /make course ai-ready/i }));
        expect(
            await screen.findByText('Reading the text in your lessons. This is free.')
        ).toBeInTheDocument();
        await waitFor(() => expect(scanMock).toHaveBeenCalledTimes(1));
    });
});
