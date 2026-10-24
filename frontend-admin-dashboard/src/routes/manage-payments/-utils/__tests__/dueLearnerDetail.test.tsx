import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { LearnerPlanBreakdown, OutstandingLearner } from '@/services/payment-logs';
import type { PaymentLogEntry } from '@/types/payment-logs';
import type { CpoSideViewInstallmentsResponse } from '@/routes/manage-students/students-list/-types/cpo-side-view-types';

/**
 * The Due side view exists to answer one question an admin could not answer before: "I cancelled
 * this learner's plan — why do they still show a balance?" So the thing worth testing is that a
 * cancelled enrolment is VISIBLE and shown as contributing nothing, rather than silently dropped.
 */
const mockFetch = vi.fn();
const mockFetchPayments = vi.fn();
vi.mock('@/services/payment-logs', () => ({
    fetchLearnerPlanBreakdown: (...args: unknown[]) => mockFetch(...args),
    fetchPaymentLogs: (...args: unknown[]) => mockFetchPayments(...args),
}));
const mockOpenOverlay = vi.fn();
vi.mock('@/routes/manage-students/students-list/-context/selected-student-sidebar-context', () => ({
    useStudentSidebar: () => ({ openOverlay: mockOpenOverlay }),
}));
const mockInstallments = vi.fn();
const mockModify = vi.fn();
vi.mock('@/routes/manage-students/students-list/-services/cpoSideViewService', () => ({
    fetchUserPlanInstallments: (userPlanId: string) => mockInstallments(userPlanId),
    useModifyInstallment: () => ({ mutateAsync: mockModify, isPending: false }),
}));
vi.mock('@/components/common/layout-container/sidebar/utils', () => ({
    getTerminology: () => 'Course',
}));
vi.mock('@/routes/settings/-components/NamingSettings', () => ({
    ContentTerms: { Course: 'Course' },
    SystemTerms: { Course: 'Course' },
}));

import { DueLearnerDetailSheet } from '../../-components/DueLearnerDetailSheet';

const learner: OutstandingLearner = {
    user_id: 'u1',
    full_name: 'Rachna',
    email: 'raachsri@gmail.com',
    mobile_number: null,
    course_name: 'Suchbliss Health & Wellness Membership',
    payment_type: 'Enroll Invite',
    plan_status: 'ACTIVE',
    billed: 8400,
    paid: 3,
    due: 8397,
    upcoming: 0,
    plan_count: 2,
    pending_installments: 0,
    next_due_date: null,
    currency: 'INR',
};

const plans: LearnerPlanBreakdown[] = [
    {
        user_plan_id: 'p1',
        course_name: 'Suchbliss Health & Wellness Membership',
        plan_status: 'ACTIVE',
        payment_type: 'Enroll Invite',
        billed: 7200,
        paid: 1,
        due: 7199,
        upcoming: 0,
        counts_towards_due: true,
        currency: 'INR',
    },
    {
        user_plan_id: 'p2',
        course_name: 'Suchbliss Health & Wellness Membership — Monthly',
        plan_status: 'ACTIVE',
        payment_type: 'Enroll Invite',
        billed: 1200,
        paid: 1,
        due: 1199,
        upcoming: 0,
        counts_towards_due: true,
        currency: 'INR',
    },
    {
        user_plan_id: 'p3',
        course_name: 'Suchbliss Health & Wellness Membership — Monthly',
        plan_status: 'CANCELED',
        payment_type: 'Enroll Invite',
        billed: 1200,
        paid: 1,
        due: 0,
        upcoming: 0,
        counts_towards_due: false,
        currency: 'INR',
    },
];

const payment = {
    payment_log: {
        id: 'pl1',
        payment_status: 'PAID',
        vendor: 'MANUAL',
        date: '2026-09-27T00:00:00.000+00:00',
        created_at: '2026-09-27T14:38:16.000+00:00',
        currency: 'INR',
        payment_amount: 15000,
        transaction_id: 'cash-001',
    },
    user_plan: { enroll_invite: { name: 'Installment' } },
    current_payment_status: 'PAID',
} as unknown as PaymentLogEntry;

const cpoPlan: LearnerPlanBreakdown = {
    user_plan_id: 'cpo1',
    course_name: 'Installment',
    plan_status: 'ACTIVE',
    payment_type: 'Custom Installment',
    billed: 50000,
    paid: 15000,
    due: 0,
    upcoming: 0,
    counts_towards_due: true,
    currency: 'INR',
};

const schedule: CpoSideViewInstallmentsResponse = {
    user_plan_id: 'cpo1',
    user_id: 'u1',
    cpo_id: 'c1',
    gross_total: 50000,
    net_total: 50000,
    paid_total: 15000,
    outstanding_total: 35000,
    installments: [
        {
            id: 's1',
            original_amount: 15000,
            amount_expected: 15000,
            amount_paid: 15000,
            outstanding: 0,
            due_date: '2026-09-01',
            status: 'PAID',
        },
        {
            id: 's2',
            original_amount: 35000,
            amount_expected: 35000,
            amount_paid: 0,
            outstanding: 35000,
            start_date: '2099-09-01',
            due_date: '2099-09-06',
            status: 'PENDING',
        },
        {
            id: 's3',
            original_amount: 21666,
            amount_expected: 0,
            amount_paid: 0,
            outstanding: 0,
            due_date: '2100-05-06',
            status: 'PENDING',
        },
    ],
};

const renderSheet = (
    filters?: Record<string, unknown>,
    props: Partial<{
        onOpenChange: (open: boolean) => void;
        onViewPayment: (e: PaymentLogEntry) => void;
    }> = {}
) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <DueLearnerDetailSheet
                learner={learner}
                open
                onOpenChange={props.onOpenChange ?? (() => {})}
                filters={filters as never}
                onViewPayment={props.onViewPayment}
            />
        </QueryClientProvider>
    );
};

describe('DueLearnerDetailSheet', () => {
    beforeEach(() => {
        mockFetch.mockReset();
        mockFetch.mockResolvedValue(plans);
        mockFetchPayments.mockReset();
        mockFetchPayments.mockResolvedValue({ content: [payment], totalElements: 1 });
        mockOpenOverlay.mockReset();
        mockInstallments.mockReset();
        mockInstallments.mockResolvedValue(schedule);
        mockModify.mockReset();
        mockModify.mockResolvedValue(schedule);
    });

    it('splits the enrolments into counted and not-counted', async () => {
        renderSheet();
        await waitFor(() => {
            expect(screen.getByText(/Counted towards this balance \(2\)/)).toBeInTheDocument();
        });
        expect(screen.getByText(/Not counted \(1\)/)).toBeInTheDocument();
    });

    it('shows the cancelled enrolment rather than hiding it', async () => {
        renderSheet();
        await waitFor(() => expect(screen.getByText('Cancelled')).toBeInTheDocument());
    });

    it("asks the server for this learner under the row's own window and course scope", async () => {
        // Not a detail: unscoped, the sheet would list enrolments the clicked row never counted
        // and the sections would stop adding up to the totals above them.
        const filters = { start_date_in_utc: '2026-08-01T00:00:00', package_session_ids: ['ps1'] };
        renderSheet(filters);
        await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('u1', filters));
    });

    it('still shows the totals when the breakdown request fails', async () => {
        mockFetch.mockRejectedValue(new Error('boom'));
        renderSheet();
        await waitFor(() => expect(screen.getByText(/could not load/i)).toBeInTheDocument());
        // The header figures come from the row, not the request, so they must survive.
        expect(screen.getByText('Billed')).toBeInTheDocument();
    });

    it('opens the learner profile from the header and closes itself', () => {
        const onOpenChange = vi.fn();
        renderSheet(undefined, { onOpenChange });
        fireEvent.click(screen.getByRole('button', { name: /view profile/i }));
        expect(onOpenChange).toHaveBeenCalledWith(false);
        expect(mockOpenOverlay).toHaveBeenCalledWith(
            expect.objectContaining({ user_id: 'u1', full_name: 'Rachna' })
        );
    });

    it('lists an instalment plan schedule with dated, labelled instalments', async () => {
        mockFetch.mockResolvedValue([cpoPlan]);
        renderSheet();
        await waitFor(() =>
            expect(screen.getByText(/Instalment schedule \(3\)/)).toBeInTheDocument()
        );
        expect(mockInstallments).toHaveBeenCalledWith('cpo1');
        // The year is always shown — "6 Sept" alone read as a date already gone.
        expect(screen.getByText(/Due .*2099/)).toBeInTheDocument();
        expect(screen.getByText('Upcoming')).toBeInTheDocument();
        // Discounted down to nothing: there was nothing to pay, so it is not "Paid".
        expect(screen.getByText('No charge')).toBeInTheDocument();
    });

    it('takes the next-due callout from the schedule, not the clicked row', async () => {
        // The row says nothing is due next; after a date is changed in the sheet the row is stale
        // and the schedule is what was just refetched.
        mockFetch.mockResolvedValue([cpoPlan]);
        renderSheet();
        await waitFor(() => expect(screen.getByText('Next instalment due')).toBeInTheDocument());
        expect(screen.getByText(/35,000 · .*2099/)).toBeInTheDocument();
    });

    it('offers to change the due date only where money is still owed', async () => {
        mockFetch.mockResolvedValue([cpoPlan]);
        renderSheet();
        await waitFor(() =>
            expect(screen.getByText(/Instalment schedule \(3\)/)).toBeInTheDocument()
        );
        // Paid (1) and no-charge (3) rows have nothing left to collect.
        expect(screen.getAllByRole('button', { name: /change due date/i })).toHaveLength(1);
        expect(
            screen.getByRole('button', { name: 'Change due date of instalment 2' })
        ).toBeInTheDocument();
    });

    it('sends only the new due date for that instalment', async () => {
        mockFetch.mockResolvedValue([cpoPlan]);
        renderSheet();
        fireEvent.click(
            await screen.findByRole('button', { name: 'Change due date of instalment 2' })
        );
        fireEvent.change(screen.getByLabelText('New due date for instalment 2'), {
            target: { value: '2099-10-15' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() =>
            expect(mockModify).toHaveBeenCalledWith({
                sfpId: 's2',
                body: { due_date: '2099-10-15' },
            })
        );
    });

    it('allows a date before the start date, as the profile editor does', async () => {
        // Nothing reads an instalment's start_date, so the sheet must not be stricter than the
        // server and the existing editor.
        mockFetch.mockResolvedValue([cpoPlan]);
        renderSheet();
        fireEvent.click(
            await screen.findByRole('button', { name: 'Change due date of instalment 2' })
        );
        fireEvent.change(screen.getByLabelText('New due date for instalment 2'), {
            target: { value: '2099-08-01' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() =>
            expect(mockModify).toHaveBeenCalledWith({
                sfpId: 's2',
                body: { due_date: '2099-08-01' },
            })
        );
    });

    it('will not save an empty date', async () => {
        mockFetch.mockResolvedValue([cpoPlan]);
        renderSheet();
        fireEvent.click(
            await screen.findByRole('button', { name: 'Change due date of instalment 2' })
        );
        fireEvent.change(screen.getByLabelText('New due date for instalment 2'), {
            target: { value: '' },
        });
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
        expect(mockModify).not.toHaveBeenCalled();
    });

    it('does not offer to move a date on a cancelled instalment', async () => {
        // The server leaves CANCELLED rows out of every balance, whatever their amounts say.
        mockFetch.mockResolvedValue([cpoPlan]);
        mockInstallments.mockResolvedValue({
            ...schedule,
            installments: [{ ...schedule.installments[1]!, status: 'CANCELLED' }],
        });
        renderSheet();
        await waitFor(() => expect(screen.getByText('Cancelled')).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: /change due date/i })).not.toBeInTheDocument();
    });

    it('does not ask for a schedule on a plan that has none', async () => {
        renderSheet();
        await waitFor(() =>
            expect(screen.getByText(/Counted towards this balance \(2\)/)).toBeInTheDocument()
        );
        expect(mockInstallments).not.toHaveBeenCalled();
    });

    it("lists the learner's payments across all dates, and a row opens the payment", async () => {
        const onViewPayment = vi.fn();
        const filters = { start_date_in_utc: '2026-08-01T00:00:00', package_session_ids: ['ps1'] };
        renderSheet(filters, { onViewPayment });
        await waitFor(() => expect(screen.getByText(/Payments \(1\)/)).toBeInTheDocument());
        expect(mockFetchPayments).toHaveBeenCalledWith(0, 20, {
            user_id: 'u1',
            package_session_ids: ['ps1'],
        });
        fireEvent.click(screen.getByText(/cash-001/));
        expect(onViewPayment).toHaveBeenCalledWith(payment);
    });
});
