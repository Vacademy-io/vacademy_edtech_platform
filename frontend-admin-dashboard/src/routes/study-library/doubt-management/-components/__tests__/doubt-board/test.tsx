import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Doubt } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-types/get-doubts-type';

// `t` is backed by the REAL en catalog so a key the board renders but the locale never defines
// shows up as the raw key — exactly what an admin would see, and what the copy assertions catch.
vi.mock('react-i18next', async () => {
    const en = (await import('../../../../../../../public/locales/en/studyLibraryDoubtBoard.json'))
        .default as Record<string, unknown>;
    const translate = (key: string, vars?: Record<string, unknown>) => {
        const bare = key.includes(':') ? key.split(':')[1]! : key;
        const value = bare
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

vi.mock('@/i18n', () => ({
    default: { t: (key: string) => key.split(':').pop(), language: 'en' },
}));

const axiosPost = vi.fn<unknown[], Promise<{ data: unknown }>>();
const axiosGet = vi.fn<unknown[], Promise<{ data: unknown }>>(async () => ({ data: {} }));
const axiosCall = vi.fn<unknown[], Promise<{ data: unknown }>>(async () => ({
    data: { data: null },
}));
vi.mock('@/lib/auth/axiosInstance', () => ({
    __esModule: true,
    default: Object.assign((...args: unknown[]) => axiosCall(...args), {
        get: (...args: unknown[]) => axiosGet(...args),
        post: (...args: unknown[]) => axiosPost(...args),
    }),
}));

vi.mock('@/constants/helper', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/constants/helper')>();
    return { ...actual, getInstituteId: () => 'inst-1' };
});
vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));
vi.mock('@/utils/userDetails', () => ({
    isUserAdmin: () => true,
    isUserTeacher: () => false,
    getUserId: () => 'admin-1',
}));
vi.mock('@/routes/dashboard/-hooks/useInstituteAssignees', () => ({
    useInstituteAssignees: () => ({
        assignees: [
            { id: 'u-1', name: 'Asha Rao', subtitle: 'Teacher' },
            { id: 'u-2', name: 'Vikram Shah', subtitle: 'Evaluator' },
        ],
        isLoading: false,
    }),
}));
vi.mock('@/stores/students/students-list/useInstituteDetailsStore', () => ({
    useInstituteDetailsStore: () => ({ instituteDetails: { batches_for_sessions: [] } }),
}));
// The conversation pane pulls in the rich-text reply editor; the board only needs to prove it
// hands the clicked doubt over.
vi.mock('@/routes/study-library/doubt-management/-components/inbox/conversation-pane', () => ({
    ConversationPane: ({ doubt }: { doubt: Doubt }) => (
        <div data-testid="conversation-pane">{doubt.id}</div>
    ),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DoubtBoard } from '@/routes/study-library/doubt-management/-components/board/doubt-board';
import {
    applyPatchLocally,
    buildDoubtUpdatePayload,
    columnKeysForDoubt,
    groupDoubtsByColumn,
    planMove,
    RESOLVED_KEY,
    UNASSIGNED_KEY,
} from '@/routes/study-library/doubt-management/-components/board/board-model';

const assignee = (rowId: string, userId: string) => ({
    id: rowId,
    source: 'USER',
    source_id: userId,
    status: 'ACTIVE',
});

const doubt = (overrides: Partial<Doubt> & { id: string }): Doubt =>
    ({
        user_id: 'learner-1',
        name: '',
        source: 'GENERAL',
        source_id: '',
        type: 'DOUBT',
        raised_time: '2026-09-16T07:40:00Z',
        resolved_time: null,
        content_position: '',
        content_type: '',
        html_text: '<p>How do I solve this?</p>',
        status: 'ACTIVE',
        parent_id: null,
        parent_level: 0,
        doubt_assignee_request_user_ids: [],
        all_doubt_assignee: [],
        delete_assignee_request: [],
        source_name: '',
        batch_id: '',
        subject_id: '',
        chapter_id: '',
        module_id: '',
        replies: [],
        ...overrides,
    }) as Doubt;

describe('board model — placement', () => {
    it('puts resolved doubts only in Resolved, unassigned open doubts in Unassigned', () => {
        expect(columnKeysForDoubt(doubt({ id: 'a' }))).toEqual([UNASSIGNED_KEY]);
        expect(
            columnKeysForDoubt(
                doubt({ id: 'b', status: 'RESOLVED', all_doubt_assignee: [assignee('r1', 'u-1')] })
            )
        ).toEqual([RESOLVED_KEY]);
    });

    it('lists a doubt shared by two teachers under both, deduping repeated rows', () => {
        const shared = doubt({
            id: 'c',
            all_doubt_assignee: [
                assignee('r1', 'u-1'),
                assignee('r2', 'u-2'),
                assignee('r3', 'u-1'),
            ],
        });
        expect(columnKeysForDoubt(shared)).toEqual(['u-1', 'u-2']);
        const groups = groupDoubtsByColumn([shared, doubt({ id: 'd' })]);
        expect(groups.get('u-1')?.map((d) => d.id)).toEqual(['c']);
        expect(groups.get('u-2')?.map((d) => d.id)).toEqual(['c']);
        expect(groups.get(UNASSIGNED_KEY)?.map((d) => d.id)).toEqual(['d']);
    });
});

describe('board model — planMove', () => {
    it('is a no-op for same-column drops', () => {
        expect(planMove('u-1', 'u-1')).toBeNull();
        expect(planMove(UNASSIGNED_KEY, UNASSIGNED_KEY)).toBeNull();
    });

    it('maps every column transition to the right patch', () => {
        expect(planMove(UNASSIGNED_KEY, 'u-1')).toEqual({
            patch: { addUserIds: ['u-1'] },
            outcome: 'assigned',
        });
        expect(planMove('u-1', 'u-2')).toEqual({
            patch: { addUserIds: ['u-2'], removeUserIds: ['u-1'] },
            outcome: 'reassigned',
        });
        expect(planMove('u-1', UNASSIGNED_KEY)).toEqual({
            patch: { removeUserIds: ['u-1'] },
            outcome: 'unassigned',
        });
        expect(planMove('u-1', RESOLVED_KEY)).toEqual({
            patch: { status: 'RESOLVED' },
            outcome: 'resolved',
        });
        expect(planMove(RESOLVED_KEY, UNASSIGNED_KEY)).toEqual({
            patch: { status: 'ACTIVE' },
            outcome: 'reopened',
        });
        expect(planMove(RESOLVED_KEY, 'u-2')).toEqual({
            patch: { status: 'ACTIVE', addUserIds: ['u-2'] },
            outcome: 'reopenedAssigned',
        });
    });
});

describe('board model — update payload', () => {
    const shared = doubt({
        id: 'c',
        all_doubt_assignee: [assignee('r1', 'u-1'), assignee('r2', 'u-2')],
    });

    it('translates user ids into assignee ROW ids for deletion and skips already-assigned adds', () => {
        const payload = buildDoubtUpdatePayload(shared, {
            addUserIds: ['u-2', 'u-3'],
            removeUserIds: ['u-1'],
        });
        // u-2 is already assigned — sending it again would create a duplicate row server-side.
        expect(payload.doubt_assignee_request_user_ids).toEqual(['u-3']);
        expect(payload.delete_assignee_request).toEqual(['r1']);
        expect(payload.status).toBe('ACTIVE');
        expect(payload.id).toBe('c');
        // Unchanged fields are echoed so the backend's update-if-not-null keeps them.
        expect(payload.html_text).toBe(shared.html_text);
        expect(payload.all_doubt_assignee).toBe(shared.all_doubt_assignee);
    });

    it('stamps resolved_time on resolve and clears it on reopen', () => {
        expect(buildDoubtUpdatePayload(shared, { status: 'RESOLVED' })).toMatchObject({
            status: 'RESOLVED',
            resolved_time: expect.any(String),
            doubt_assignee_request_user_ids: [],
            delete_assignee_request: [],
        });
        const resolved = doubt({
            id: 'r',
            status: 'RESOLVED',
            resolved_time: '2026-09-01T00:00:00Z',
        });
        expect(buildDoubtUpdatePayload(resolved, { status: 'ACTIVE' })).toMatchObject({
            status: 'ACTIVE',
            resolved_time: null,
        });
    });

    it('applies the patch locally so the optimistic card lands in its new column', () => {
        const moved = applyPatchLocally(shared, { addUserIds: ['u-3'], removeUserIds: ['u-1'] });
        expect(columnKeysForDoubt(moved)).toEqual(['u-2', 'u-3']);
        // Placeholder rows never leak into a real payload: the board always rebuilds from the
        // server copy, but even from the patched copy the placeholder id isn't a deletable row.
        expect(moved.all_doubt_assignee.find((a) => a.source_id === 'u-3')?.id).toBe('pending-u-3');
        expect(applyPatchLocally(shared, { status: 'RESOLVED' }).status).toBe('RESOLVED');
    });
});

describe('DoubtBoard', () => {
    const PAGE = {
        content: [
            doubt({ id: 'd-unassigned', html_text: '<p>Nobody has this one</p>' }),
            doubt({
                id: 'd-asha',
                html_text: '<p>With Asha</p>',
                all_doubt_assignee: [assignee('r1', 'u-1')],
            }),
            doubt({
                id: 'd-done',
                status: 'RESOLVED',
                html_text: '<p>Already resolved</p>',
                all_doubt_assignee: [assignee('r2', 'u-2')],
            }),
            doubt({
                id: 'd-gone',
                html_text: '<p>Held by someone no longer on staff</p>',
                all_doubt_assignee: [assignee('r3', 'u-gone')],
            }),
        ],
        page_no: 0,
        page_size: 50,
        total_elements: 4,
        total_pages: 1,
        last: true,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        axiosPost.mockImplementation(async (url: unknown, body: unknown) => {
            if (String(url).includes('/doubts/get-all')) return { data: PAGE };
            // user basic details — learner + the departed assignee
            if (Array.isArray(body)) {
                return {
                    data: (body as string[]).map((id) => ({
                        id,
                        name: id === 'u-gone' ? 'Old Teacher' : 'Priya Verma',
                        face_file_id: null,
                    })),
                };
            }
            return { data: {} };
        });
    });

    const renderBoard = () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        return render(
            <QueryClientProvider client={client}>
                <DoubtBoard />
            </QueryClientProvider>
        );
    };

    const column = (name: string) => screen.getByRole('region', { name });

    it('groups cards into Unassigned / per-teacher / Resolved and hides idle staff by default', async () => {
        renderBoard();
        await screen.findByText('Nobody has this one');

        expect(within(column('Unassigned')).getByText('Nobody has this one')).toBeInTheDocument();
        expect(within(column('Asha Rao')).getByText('With Asha')).toBeInTheDocument();
        expect(within(column('Resolved')).getByText('Already resolved')).toBeInTheDocument();
        // Vikram only holds a RESOLVED doubt, so he has no open cards → no column until pinned.
        expect(screen.queryByRole('region', { name: 'Vikram Shah' })).not.toBeInTheDocument();
        // A departed assignee still gets a column, named from user-basic-details.
        expect(
            within(await screen.findByRole('region', { name: 'Old Teacher' })).getByText(
                'Held by someone no longer on staff'
            )
        ).toBeInTheDocument();
        expect(screen.getByText('Showing 4 of 4 doubts')).toBeInTheDocument();
    });

    it('lets the admin pin a teacher column from the Columns picker and remembers it', async () => {
        renderBoard();
        await screen.findByText('With Asha');

        fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
        fireEvent.click(await screen.findByRole('checkbox', { name: 'Vikram Shah' }));

        const vikram = await screen.findByRole('region', { name: 'Vikram Shah' });
        expect(
            within(vikram).getByText('Drop a doubt here to assign it to Vikram Shah')
        ).toBeInTheDocument();
        expect(JSON.parse(localStorage.getItem('doubt-board-columns:inst-1') ?? '{}')).toEqual({
            'u-2': true,
        });
    });

    it('opens the conversation for a clicked card in the side sheet', async () => {
        renderBoard();
        // Every fixture doubt is from the same learner; the first card in DOM order is the one
        // in the Unassigned column.
        const cards = await screen.findAllByRole('button', { name: 'Open doubt from Priya Verma' });
        fireEvent.click(cards[0]!);
        await waitFor(() =>
            expect(screen.getByTestId('conversation-pane')).toHaveTextContent('d-unassigned')
        );
    });
});
