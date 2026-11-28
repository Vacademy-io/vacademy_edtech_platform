import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PaymentLogEntry } from '@/types/payment-logs';
import type { OutstandingLearnersPage } from '@/services/payment-logs';

vi.mock('@/components/common/layout-container/sidebar/utils', () => ({
    getTerminology: () => 'Course',
}));
vi.mock('@/routes/settings/-components/NamingSettings', () => ({
    ContentTerms: { Course: 'Course' },
    SystemTerms: { Course: 'Course' },
}));
// MyTable drags in bulk-action dialogs that read the institute from localStorage at render. What
// is under test here is which columns each list asks for and what their cells say, so render the
// column defs directly.
vi.mock('@/components/design-system/table', () => ({
    MyTable: ({
        data,
        columns,
    }: {
        data?: { content: unknown[] };
        columns: {
            id?: string;
            header?: unknown;
            cell?: (ctx: { row: { original: unknown } }) => React.ReactNode;
        }[];
    }) => (
        <table>
            <thead>
                <tr>
                    {columns.map((c) => (
                        <th key={c.id}>{typeof c.header === 'string' ? c.header : c.id}</th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {(data?.content ?? []).map((row, i) => (
                    <tr key={i}>
                        {columns.map((c) => (
                            <td key={c.id}>{c.cell ? c.cell({ row: { original: row } }) : null}</td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    ),
}));

import { computePaymentSummary, isCancelledEntry } from '../paymentSummary';
import { emptyPaymentSummary } from '../paymentSummary';
import { PaymentKpiCards, hasNotYetDueBalance, type KpiBilling } from '../../-components/PaymentKpiCards';
import { isVoidablePayment } from '@/services/payment-logs';
import { DueLearnersTable } from '../../-components/DueLearnersTable';

/**
 * Two things Vasco Maritime could not do on Manage Payments:
 *  - see money still to come in when none of it was overdue yet (₹8,45,000 across 23 learners
 *    read as Due ₹0 / Upcoming ₹0), and
 *  - take back a payment entered by mistake.
 * A voided payment must drop out of every total, and only a hand-recorded one may be voided.
 */

const row = (paymentStatus: string, current: string, amount: number): PaymentLogEntry =>
    ({
        payment_log: { payment_status: paymentStatus, payment_amount: amount, currency: 'INR' },
        current_payment_status: current,
        user_plan: { status: 'ACTIVE' },
    }) as unknown as PaymentLogEntry;

describe('voided payments', () => {
    it('counts in no card — not Paid, not Pending, not the total', () => {
        const summary = computePaymentSummary([
            row('PAID', 'PAID', 25000),
            row('VOIDED', 'CANCELLED', 10000),
        ]);
        expect(summary.paid.count).toBe(1);
        expect(summary.paid.amountByCurrency.INR).toBe(25000);
        expect(summary.pending.count).toBe(0);
        expect(summary.total.count).toBe(1);
    });

    it('is treated as cancelled even if a server reports the raw VOIDED status', () => {
        expect(isCancelledEntry(row('VOIDED', 'VOIDED', 10000))).toBe(true);
        expect(isCancelledEntry(row('PAID', 'PAID', 10000))).toBe(false);
    });

    it('can only be done to a paid payment an admin recorded by hand', () => {
        expect(isVoidablePayment('MANUAL', 'PAID')).toBe(true);
        expect(isVoidablePayment('offline', 'paid')).toBe(true);
        expect(isVoidablePayment('RAZORPAY', 'PAID')).toBe(false);
        expect(isVoidablePayment('MANUAL', 'VOIDED')).toBe(false);
        expect(isVoidablePayment('MANUAL', 'PAYMENT_PENDING')).toBe(false);
        expect(isVoidablePayment(null, 'PAID')).toBe(false);
    });
});

const page = (overrides: Partial<OutstandingLearnersPage['content'][number]>): OutstandingLearnersPage => ({
    content: [
        {
            user_id: 'u1',
            full_name: 'MD ARSELAN',
            email: 'arsalaniyanomaniya@gmail.com',
            mobile_number: null,
            course_name: 'DNS / IMUCET Course - Installment',
            payment_type: 'Custom Installment',
            plan_status: 'ACTIVE',
            billed: 65000,
            paid: 35000,
            due: 0,
            upcoming: 0,
            plan_count: 1,
            pending_installments: 2,
            next_due_date: '2027-02-06',
            outstanding: 30000,
            next_due_amount: 25357.15,
            currency: 'INR',
            ...overrides,
        },
    ],
    totalPages: 1,
    totalElements: 1,
    number: 0,
    size: 20,
    last: true,
});

describe('Outstanding learners list', () => {
    it('shows the balance and the next instalment instead of the Due columns', () => {
        render(
            <DueLearnersTable
                data={page({})}
                mode="outstanding"
                isLoading={false}
                error={null}
                currentPage={0}
                onPageChange={() => {}}
            />
        );
        expect(screen.getByText('Outstanding')).toBeTruthy();
        expect(screen.getByText('Next instalment')).toBeTruthy();
        expect(screen.queryByText('Upcoming')).toBeNull();
        expect(screen.getByText(/Due\s+6 Feb 2027|Due\s+Feb 6, 2027|Due\s+6 Feb/)).toBeTruthy();
    });

    it('keeps the Due list exactly as it was', () => {
        render(
            <DueLearnersTable
                data={page({ due: 5000 })}
                isLoading={false}
                error={null}
                currentPage={0}
                onPageChange={() => {}}
            />
        );
        expect(screen.getByText('Due')).toBeTruthy();
        expect(screen.getByText('Upcoming')).toBeTruthy();
        expect(screen.queryByText('Next instalment')).toBeNull();
        expect(screen.queryByText('Outstanding')).toBeNull();
    });

    it('says nothing is outstanding rather than nothing overdue', () => {
        render(
            <DueLearnersTable
                data={{ content: [], totalPages: 1, totalElements: 0, number: 0, size: 20, last: true }}
                mode="outstanding"
                isLoading={false}
                error={null}
                currentPage={0}
                onPageChange={() => {}}
            />
        );
        expect(screen.getByText('Nothing outstanding')).toBeTruthy();
    });
});

const billing = (outstanding: number, due: number, upcoming: number): KpiBilling => ({
    collected: 52365,
    due,
    upcoming,
    upcomingDays: 30,
    learnersOwing: due > 0 ? 2 : 0,
    learnersUpcoming: upcoming > 0 ? 3 : 0,
    activatedWithoutPaymentCount: 0,
    outstanding,
    learnersOutstanding: outstanding > 0 ? 23 : 0,
    currency: 'INR',
});

describe('Outstanding card', () => {
    it('stays hidden where it would only repeat Due (Suchbliss: subscriptions only)', () => {
        const suchbliss = billing(7299, 7299, 23400);
        expect(hasNotYetDueBalance(suchbliss)).toBe(false);
        render(<PaymentKpiCards summary={emptyPaymentSummary()} billing={suchbliss} />);
        expect(screen.queryByText('Outstanding')).toBeNull();
        expect(screen.getByText('Due')).toBeTruthy();
        expect(screen.getByText('Upcoming')).toBeTruthy();
    });

    it('appears when instalments are still to come (Vasco: ₹8,45,000, nothing overdue yet)', () => {
        const vasco = billing(845000, 0, 0);
        expect(hasNotYetDueBalance(vasco)).toBe(true);
        render(<PaymentKpiCards summary={emptyPaymentSummary()} billing={vasco} />);
        expect(screen.getByText('Outstanding')).toBeTruthy();
        expect(screen.getByText('23 learners')).toBeTruthy();
    });

    it('stays hidden without billing figures', () => {
        expect(hasNotYetDueBalance(null)).toBe(false);
    });
});
