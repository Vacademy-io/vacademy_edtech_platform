import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { CourseSessionSelector } from './CourseSessionSelector';
import type { MappingRow } from '../-types/product-page-types';

/**
 * The Courses tab used to fetch an invite list AND full invite details per
 * course row, so opening it on Shiksha Nation's 163-course page fired ~326
 * requests at once. These tests pin the request count, which nothing else
 * would notice creeping back.
 */

const post = vi.fn();
const get = vi.fn();

vi.mock('@/lib/auth/axiosInstance', () => ({
    default: {
        post: (...args: unknown[]) => post(...args),
        get: (...args: unknown[]) => get(...args),
    },
}));
vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/components/common/layout-container/sidebar/utils', () => ({
    getTerminology: (a: string) => a,
    getTerminologyPlural: (a: string) => a,
}));
vi.mock('@/routes/settings/-components/NamingSettings', () => ({
    ContentTerms: { Course: 'Course', Level: 'Level', Session: 'Session' },
    SystemTerms: { Course: 'Course', Level: 'Level', Session: 'Session' },
}));

const invite = (id: string, packageSessionIds: string[]) => ({
    id,
    name: `Invite ${id}`,
    invite_code: id,
    package_session_ids: packageSessionIds,
});

const savedRow = (packageSessionId: string, inviteId: string): MappingRow => ({
    rowId: `row-${packageSessionId}`,
    inviteId,
    inviteName: '',
    psInvitePaymentOptionId: `bridge-${packageSessionId}`,
    packageSessionId,
    paymentPlanId: 'plan-1',
    paymentPlanName: 'Default Plan',
    paymentPlanPrice: 499,
    currency: 'INR',
    preselected: false,
    displayOrder: 0,
});

const newRow = (packageSessionId: string): MappingRow => ({
    ...savedRow(packageSessionId, ''),
    psInvitePaymentOptionId: '',
    paymentPlanId: '',
    paymentPlanName: '',
    paymentPlanPrice: 0,
    currency: '',
});

const inviteListCalls = () =>
    post.mock.calls.filter(([url]) => String(url).includes('get-enroll-invite'));

function Harness({
    initialRows,
    onReorder,
}: {
    initialRows: MappingRow[];
    onReorder?: (orderedRowIds: string[]) => void;
}) {
    const [rows, setRows] = useState(initialRows);
    return (
        <CourseSessionSelector
            mappingRows={rows}
            onAdd={(r) => {
                setRows((prev) => [...prev, r]);
            }}
            onUpdate={(rowId, updated) => {
                setRows((prev) => prev.map((r) => (r.rowId === rowId ? updated : r)));
            }}
            onRemove={(rowId) => {
                setRows((prev) => prev.filter((r) => r.rowId !== rowId));
            }}
            suggestions={{}}
            onUpdateSuggestions={vi.fn()}
            onReorder={onReorder}
        />
    );
}

const renderWithClient = (rows: MappingRow[], onReorder?: (orderedRowIds: string[]) => void) =>
    render(
        <QueryClientProvider
            client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
            <Harness initialRows={rows} onReorder={onReorder} />
        </QueryClientProvider>
    );

describe('CourseSessionSelector requests', () => {
    let invites: ReturnType<typeof invite>[] = [];

    beforeEach(() => {
        post.mockReset();
        get.mockReset();
        post.mockImplementation((url: string) => {
            if (url.includes('get-enroll-invite')) {
                return Promise.resolve({ data: { content: invites, last: true } });
            }
            // course browser
            return Promise.resolve({
                data: { content: [], totalElements: 0, last: true, number: 0 },
            });
        });
        get.mockImplementation(() =>
            Promise.resolve({
                data: {
                    id: 'inv-new',
                    name: 'Invite inv-new',
                    invite_code: 'inv-new',
                    package_session_to_payment_options: [
                        {
                            id: 'bridge-ps-new',
                            package_session_id: 'ps-new',
                            payment_option: {
                                id: 'po-1',
                                payment_plans: [
                                    {
                                        id: 'plan-9',
                                        name: 'Full',
                                        actual_price: 999,
                                        elevated_price: 999,
                                        currency: 'INR',
                                        validity_in_days: 365,
                                    },
                                ],
                            },
                        },
                    ],
                },
            })
        );
    });

    it('opens a 150-course page with ONE invite-list call and no detail calls', async () => {
        const rows = Array.from({ length: 150 }, (_, i) => savedRow(`ps-${i}`, `inv-${i}`));
        invites = rows.map((r) => invite(r.inviteId, [r.packageSessionId]));

        renderWithClient(rows);

        // Saved rows get their invite name from the batched list.
        expect(await screen.findByText('Invite inv-149')).toBeInTheDocument();
        expect(screen.getByText('Invite inv-0')).toBeInTheDocument();

        expect(inviteListCalls()).toHaveLength(1);
        const body = inviteListCalls()[0]![1] as { package_session_ids: string[] };
        expect(body.package_session_ids).toHaveLength(150);
        expect(get).not.toHaveBeenCalled();
    }, 30_000);

    it('gives each row only the invites of its own session', async () => {
        invites = [
            invite('inv-a', ['ps-1']),
            invite('inv-b', ['ps-2']),
            invite('inv-shared', ['ps-1', 'ps-2']),
        ];
        renderWithClient([savedRow('ps-1', 'inv-a'), savedRow('ps-2', 'inv-b')]);

        expect(await screen.findByText('Invite inv-a')).toBeInTheDocument();
        expect(screen.getByText('Invite inv-b')).toBeInTheDocument();
        expect(inviteListCalls()).toHaveLength(1);
    });

    it('still resolves a new row: first invite, then its payment option and plan', async () => {
        invites = [invite('inv-new', ['ps-new'])];
        renderWithClient([newRow('ps-new')]);

        // Price badge appears only once option + plan are resolved from details.
        expect(await screen.findByText(/999/)).toBeInTheDocument();
        expect(inviteListCalls()).toHaveLength(1);
        expect(get).toHaveBeenCalledTimes(1);
        expect(String(get.mock.calls[0]![0])).toContain('inv-new');
    });
});

describe('CourseSessionSelector newest/oldest first', () => {
    beforeEach(() => {
        post.mockReset();
        get.mockReset();
        post.mockImplementation((url: string, body: { package_session_ids?: string[] }) => {
            if (url.includes('get-enroll-invite')) {
                return Promise.resolve({ data: { content: [], last: true } });
            }
            // The search sorts by created_at DESC: ps-3 is the newest course.
            const content = body?.package_session_ids?.length
                ? ['ps-3', 'ps-1', 'ps-2'].map((id) => ({ id: `pkg-${id}`, package_session_id: id }))
                : [];
            return Promise.resolve({
                data: { content, totalElements: content.length, last: true, number: 0 },
            });
        });
    });

    const rows = () => ['ps-1', 'ps-2', 'ps-3'].map((id) => savedRow(id, `inv-${id}`));

    it('orders the rows by course creation, newest first', async () => {
        const onReorder = vi.fn();
        renderWithClient(rows(), onReorder);

        fireEvent.click(await screen.findByText('selectedCourses.newestFirst'));

        await waitFor(() => expect(onReorder).toHaveBeenCalledTimes(1));
        expect(onReorder).toHaveBeenCalledWith(['row-ps-3', 'row-ps-1', 'row-ps-2']);
    });

    it('orders the rows by course creation, oldest first', async () => {
        const onReorder = vi.fn();
        renderWithClient(rows(), onReorder);

        fireEvent.click(await screen.findByText('selectedCourses.oldestFirst'));

        await waitFor(() => expect(onReorder).toHaveBeenCalledTimes(1));
        expect(onReorder).toHaveBeenCalledWith(['row-ps-2', 'row-ps-1', 'row-ps-3']);
    });

    it('hides the buttons when the page has no reorder handler', async () => {
        renderWithClient(rows());
        expect(await screen.findByText('selectedCourses.heading')).toBeInTheDocument();
        expect(screen.queryByText('selectedCourses.newestFirst')).not.toBeInTheDocument();
    });
});
