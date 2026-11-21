import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Doubt } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-types/get-doubts-type';
import type { DoubtActivity } from '@/routes/study-library/doubt-management/-types/doubt-activity';

// Namespace-aware `t` backed by the REAL en catalogs, so copy assertions here would catch a key
// the UI renders that the locale never defines (it would show up as the raw key).
vi.mock('react-i18next', async () => {
    const load = async (ns: string) =>
        (await import(`../../../../../../../public/locales/en/${ns}.json`)).default as Record<
            string,
            unknown
        >;
    const catalogs: Record<string, Record<string, unknown>> = {
        studyLibraryDoubtStatus: await load('studyLibraryDoubtStatus'),
        studyLibraryDoubtActivity: await load('studyLibraryDoubtActivity'),
        studyLibraryAssigneeFilter: await load('studyLibraryAssigneeFilter'),
        studyLibraryStatusFilter: await load('studyLibraryStatusFilter'),
        studyLibraryDoubtBoard: await load('studyLibraryDoubtBoard'),
    };
    const lookup = (ns: string, key: string, vars?: Record<string, unknown>) => {
        const value = key
            .split('.')
            .reduce<unknown>(
                (acc, part) =>
                    acc && typeof acc === 'object'
                        ? (acc as Record<string, unknown>)[part]
                        : undefined,
                catalogs[ns]
            );
        if (typeof value !== 'string') return key;
        return value.replace(/{{(\w+)}}/g, (_, name: string) => String(vars?.[name] ?? ''));
    };
    return {
        useTranslation: (ns: string) => ({
            t: (key: string, vars?: Record<string, unknown>) => {
                const [maybeNs, rest] = key.includes(':') ? key.split(':', 2) : [ns, key];
                return lookup(maybeNs!, rest!, vars);
            },
            i18n: { language: 'en' },
        }),
    };
});
vi.mock('@/i18n', () => ({
    default: {
        t: (key: string) =>
            key.endsWith('builtIn.pending')
                ? 'Pending'
                : key.endsWith('builtIn.resolved')
                  ? 'Resolved'
                  : key.endsWith('UseDoubtQueryTypes:doubt')
                    ? 'Doubt'
                    : key.split(':').pop(),
        language: 'en',
    },
}));

const axiosPost = vi.fn<unknown[], Promise<{ data: unknown }>>();
const axiosGet = vi.fn<unknown[], Promise<{ data: unknown }>>();
const axiosCall = vi.fn<unknown[], Promise<{ data: unknown }>>();
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
vi.mock('@/routes/dashboard/-hooks/useInstituteAssignees', () => ({
    useInstituteAssignees: () => ({
        assignees: [
            { id: 'u-1', name: 'Asha Rao', subtitle: 'Teacher' },
            { id: 'u-2', name: 'Vikram Shah', subtitle: 'Evaluator' },
        ],
        isLoading: false,
    }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DoubtStatusPicker } from '@/routes/study-library/doubt-management/-components/status/doubt-status-picker';
import { DoubtActivityTimeline } from '@/routes/study-library/doubt-management/-components/activity/doubt-activity-timeline';
import { AssigneeFilter } from '@/routes/study-library/doubt-management/-components/filters/assignee-filter';
import { StatusFilter } from '@/routes/study-library/doubt-management/-components/filters/status-filter';
import { useDoubtFilters } from '@/routes/study-library/doubt-management/-stores/filter-store';
import {
    buildDoubtUpdatePayload,
    groupDoubtsByStatus,
    planStatusMove,
} from '@/routes/study-library/doubt-management/-components/board/board-model';
import { normalizeStatuses } from '@/routes/study-library/doubt-management/-services/use-doubt-statuses';
import { AddStatusDialog } from '@/routes/study-library/doubt-management/-components/status/add-status-dialog';

/** Institute settings with one custom status between the built-ins. */
const SETTING = {
    data: {
        default_assignee_source: 'BATCH_TEACHER',
        query_types: [{ key: 'DOUBT', label: 'Doubt', is_system: true }],
        statuses: [
            { key: 'PENDING', label: 'Pending', kind: 'OPEN', is_system: true },
            {
                key: 'IN_PROGRESS',
                label: 'In progress',
                learner_label: 'Being looked into',
                kind: 'IN_PROGRESS',
            },
            { key: 'RESOLVED', label: 'Resolved', kind: 'RESOLVED', is_system: true },
        ],
    },
};

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
        html_text: '<p>q</p>',
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

const activity = (
    overrides: Partial<DoubtActivity> & { id: string; action: DoubtActivity['action'] }
): DoubtActivity => ({
    doubt_id: 'd-1',
    actor_type: 'USER',
    created_at: '2026-09-16T08:00:00Z',
    ...overrides,
});

const wrap = (ui: ReactNode) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

beforeEach(() => {
    vi.clearAllMocks();
    // Institute-settings GET envelope: { data: { data: <setting json> } }.
    axiosCall.mockResolvedValue({ data: SETTING });
    axiosPost.mockImplementation(async (_url: unknown, body: unknown) =>
        Array.isArray(body)
            ? {
                  data: (body as string[]).map((id) => ({
                      id,
                      name: id === 'learner-1' ? 'Priya Verma' : 'Old Teacher',
                      face_file_id: null,
                  })),
              }
            : { data: 'd-1' }
    );
    useDoubtFilters.getState().resetFilters();
});

describe('status model', () => {
    it('normalises stored statuses with the built-ins guaranteed', () => {
        const list = normalizeStatuses([{ key: 'escalated', label: 'Escalated' }]);
        expect(list.map((s) => s.key)).toEqual(['PENDING', 'ESCALATED', 'RESOLVED']);
        expect(list[1]!.kind).toBe('OPEN');
    });

    it('groups by effective status (legacy rows derive from the coarse status) in catalog order', () => {
        const statuses = normalizeStatuses(SETTING.data.statuses);
        const groups = groupDoubtsByStatus(
            [
                doubt({ id: 'legacy-open' }),
                doubt({ id: 'legacy-done', status: 'RESOLVED' }),
                doubt({ id: 'wip', workflow_status: 'IN_PROGRESS' }),
                doubt({ id: 'orphan', workflow_status: 'GONE' }),
            ],
            statuses
        );
        expect([...groups.keys()]).toEqual(['PENDING', 'IN_PROGRESS', 'RESOLVED', 'GONE']);
        expect(groups.get('PENDING')!.map((d) => d.id)).toEqual(['legacy-open']);
        expect(groups.get('RESOLVED')!.map((d) => d.id)).toEqual(['legacy-done']);
        expect(groups.get('IN_PROGRESS')!.map((d) => d.id)).toEqual(['wip']);
    });

    it('a status drop sends workflow_status (+ remark) and nothing about assignees', () => {
        const plan = planStatusMove('PENDING', 'IN_PROGRESS')!;
        expect(plan.outcome).toBe('statusChanged');
        const payload = buildDoubtUpdatePayload(doubt({ id: 'd-1' }), {
            ...plan.patch,
            remark: '  on it ',
        });
        expect(payload.workflow_status).toBe('IN_PROGRESS');
        expect(payload.remark).toBe('on it');
        expect(payload.doubt_assignee_request_user_ids).toEqual([]);
        expect(payload.delete_assignee_request).toEqual([]);
        // Assignment-only updates never touch status.
        expect(
            buildDoubtUpdatePayload(doubt({ id: 'd-1' }), { addUserIds: ['u-1'] }).workflow_status
        ).toBeUndefined();
        expect(planStatusMove('RESOLVED', 'RESOLVED')).toBeNull();
    });
});

describe('DoubtStatusPicker', () => {
    it('moves the doubt to a custom status with a remark', async () => {
        wrap(<DoubtStatusPicker doubt={doubt({ id: 'd-1' })} canChange />);
        fireEvent.click(await screen.findByRole('button', { name: 'Change status' }));
        fireEvent.click(await screen.findByRole('radio', { name: /In progress/ }));
        fireEvent.change(screen.getByPlaceholderText('Why is it moving? Visible to staff only.'), {
            target: { value: 'Waiting for the lab file' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Move to In progress' }));

        await waitFor(() => expect(axiosPost).toHaveBeenCalled());
        const [url, body] = axiosPost.mock.calls.find(([u]) => String(u).includes('doubtId=d-1'))!;
        expect(String(url)).toContain('/doubts/create?doubtId=d-1');
        expect(body).toMatchObject({
            workflow_status: 'IN_PROGRESS',
            status: 'ACTIVE',
            remark: 'Waiting for the lab file',
        });
    });

    it('is a read-only chip for people who cannot change the status', async () => {
        wrap(
            <DoubtStatusPicker
                doubt={doubt({ id: 'd-1', workflow_status: 'IN_PROGRESS' })}
                canChange={false}
            />
        );
        // The catalog loads async; the chip shows the configured label once it lands.
        expect(await screen.findByText('In progress')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Change status' })).not.toBeInTheDocument();
    });
});

describe('DoubtActivityTimeline', () => {
    it('renders who did what — rule vs person — with status labels and remarks, and posts a new remark', async () => {
        axiosGet.mockResolvedValue({
            data: [
                activity({
                    id: 'a1',
                    action: 'CREATED',
                    actor_user_id: 'learner-1',
                    to_value: 'PENDING',
                }),
                activity({
                    id: 'a2',
                    action: 'ASSIGNED',
                    actor_type: 'RULE',
                    target_user_id: 'u-1',
                    rule_source: 'TYPE:DOUBT:SUBJECT_TEACHER',
                }),
                activity({
                    id: 'a3',
                    action: 'ASSIGNED',
                    actor_user_id: 'u-2',
                    target_user_id: 'u-gone',
                }),
                activity({
                    id: 'a4',
                    action: 'STATUS_CHANGED',
                    actor_user_id: 'u-1',
                    from_value: 'PENDING',
                    to_value: 'IN_PROGRESS',
                    remark: 'Called the parent',
                }),
                activity({
                    id: 'a5',
                    action: 'REMARK',
                    actor_user_id: 'u-2',
                    to_value: 'IN_PROGRESS',
                    remark: 'Escalating tomorrow',
                }),
            ],
        });
        wrap(
            <DoubtActivityTimeline
                doubt={doubt({ id: 'd-1', workflow_status: 'IN_PROGRESS' })}
                canRemark
                defaultOpen
            />
        );

        await screen.findByText('Priya Verma raised this doubt');
        expect(
            screen.getByText(/Asha Rao auto-assigned by rule: Doubt → Subject teacher/)
        ).toBeInTheDocument();
        expect(screen.getByText('Rule')).toBeInTheDocument();
        expect(screen.getByText('Vikram Shah assigned Old Teacher')).toBeInTheDocument();
        expect(
            screen.getByText('Asha Rao changed status Pending → In progress')
        ).toBeInTheDocument();
        expect(screen.getByText('Called the parent')).toBeInTheDocument();
        expect(screen.getByText('Vikram Shah left a remark on In progress')).toBeInTheDocument();
        expect(screen.getByText('Escalating tomorrow')).toBeInTheDocument();

        fireEvent.change(
            screen.getByPlaceholderText('Add a remark for staff (learners never see this)'),
            {
                target: { value: 'Parent confirmed' },
            }
        );
        fireEvent.click(screen.getByRole('button', { name: 'Add remark' }));
        await waitFor(() =>
            expect(
                axiosPost.mock.calls.some(
                    ([u, b]) =>
                        String(u).includes('doubtId=d-1') &&
                        (b as { remark?: string }).remark === 'Parent confirmed'
                )
            ).toBe(true)
        );
        // A remark alone must not move the status.
        const [, body] = axiosPost.mock.calls.find(([u]) => String(u).includes('doubtId=d-1'))!;
        expect((body as { workflow_status?: string }).workflow_status).toBeUndefined();
    });
});

describe('filters', () => {
    it('Assigned-to filter sends staff ids and the unassigned flag to the store', async () => {
        wrap(<AssigneeFilter />);
        await waitFor(() =>
            expect(useDoubtFilters.getState().filters.assignee_user_ids).toEqual([])
        );
        const trigger = screen.getByText('All');
        fireEvent.click(trigger);
        fireEvent.click(await screen.findByText(/Asha Rao/));
        await waitFor(() =>
            expect(useDoubtFilters.getState().filters.assignee_user_ids).toEqual(['u-1'])
        );
        fireEvent.click(screen.getByText('Unassigned'));
        await waitFor(() => expect(useDoubtFilters.getState().filters.unassigned_only).toBe(true));
        expect(useDoubtFilters.getState().filters.assignee_user_ids).toEqual(['u-1']);
    });

    it('Status filter lists the configured statuses and sends workflow keys, keeping DELETED out', async () => {
        wrap(<StatusFilter />);
        await waitFor(() =>
            expect(useDoubtFilters.getState().filters.status).toEqual(['ACTIVE', 'RESOLVED'])
        );
        fireEvent.click(screen.getByText('All'));
        fireEvent.click(await screen.findByText('In progress'));
        await waitFor(() =>
            expect(useDoubtFilters.getState().filters.workflow_statuses).toEqual(['IN_PROGRESS'])
        );
        // The coarse status narrows with the picked kinds — an older backend still gets the old
        // "Unresolved" behaviour, the new one gets the exact key on top.
        expect(useDoubtFilters.getState().filters.status).toEqual(['ACTIVE']);
        fireEvent.click(await screen.findByText('Resolved'));
        await waitFor(() =>
            expect(useDoubtFilters.getState().filters.status).toEqual(['ACTIVE', 'RESOLVED'])
        );
        expect(within(document.body).queryByText('Unresolved')).not.toBeInTheDocument();
    });
});

describe('AddStatusDialog', () => {
    it('adds a custom status before Resolved and writes the whole setting blob back', async () => {
        wrap(<AddStatusDialog open onOpenChange={() => {}} />);
        fireEvent.change(await screen.findByPlaceholderText(/e\.g\. In progress/), {
            target: { value: 'Waiting on learner' },
        });
        expect(screen.getByText('Saved as WAITING_ON_LEARNER')).toBeInTheDocument();
        fireEvent.change(screen.getByRole('combobox', { name: 'Counts as' }), {
            target: { value: 'OPEN' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Add status' }));

        await waitFor(() =>
            expect(axiosPost.mock.calls.some(([u]) => String(u).includes('save-setting'))).toBe(
                true
            )
        );
        const [, body] = axiosPost.mock.calls.find(([u]) => String(u).includes('save-setting'))!;
        const saved = body as {
            setting_data: {
                statuses: { key: string; kind: string }[];
                default_assignee_source: string;
                query_types: unknown[];
            };
        };
        expect(saved.setting_data.statuses.map((st) => st.key)).toEqual([
            'PENDING',
            'IN_PROGRESS',
            'WAITING_ON_LEARNER',
            'RESOLVED',
        ]);
        expect(saved.setting_data.statuses[2]!.kind).toBe('OPEN');
        // Routing / query-type config rides along untouched — the save endpoint replaces the blob.
        expect(saved.setting_data.default_assignee_source).toBe('BATCH_TEACHER');
        expect(saved.setting_data.query_types).toHaveLength(1);
    });

    it('refuses a duplicate key without saving', async () => {
        wrap(<AddStatusDialog open onOpenChange={() => {}} />);
        fireEvent.change(await screen.findByPlaceholderText(/e\.g\. In progress/), {
            target: { value: 'in progress' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Add status' }));
        expect(
            await screen.findByText('A status with key IN_PROGRESS already exists')
        ).toBeInTheDocument();
        expect(axiosPost.mock.calls.some(([u]) => String(u).includes('save-setting'))).toBe(false);
    });
});
