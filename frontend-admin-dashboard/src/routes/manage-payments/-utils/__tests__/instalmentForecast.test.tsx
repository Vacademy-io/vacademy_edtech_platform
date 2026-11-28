import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const post = vi.fn();
vi.mock('@/lib/auth/axiosInstance', () => ({ default: { post: (...a: unknown[]) => post(...a) } }));
vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));
vi.mock('@/components/common/layout-container/sidebar/utils', () => ({
    getTerminology: () => 'Course',
}));
vi.mock('@/routes/settings/-components/NamingSettings', () => ({
    ContentTerms: { Course: 'Course' },
    SystemTerms: { Course: 'Course' },
}));
// Render the column defs directly — what matters is which columns a list asks for.
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

import {
    fetchBillingSummary,
    fetchInstalmentForecast,
    fetchOutstandingLearners,
    type InstalmentForecast as ForecastData,
    type OutstandingLearnersPage,
} from '@/services/payment-logs';
import { formatMoney } from '@/utils/payment-currency';
import {
    InstalmentForecast,
    formatForecastMonth,
    isInstalmentFirst,
} from '../../-components/InstalmentForecast';
import { DueLearnersTable } from '../../-components/DueLearnersTable';
import { PaymentKpiCards, type KpiBilling } from '../../-components/PaymentKpiCards';
import { emptyPaymentSummary } from '../paymentSummary';

/**
 * Vasco Maritime runs everything on instalments: ₹14,65,000 billed, ₹6,20,000 paid, nothing
 * overdue, ₹8,45,000 falling due Nov / Feb / May / Aug. Manage Payments showed only "next due
 * 6 Nov" and an empty Due list. These pin the month view without moving any existing list.
 */
const VASCO: ForecastData = {
    instalment_billed: 1465000,
    instalment_paid: 620000,
    instalment_overdue: 0,
    instalment_to_come: 845000,
    instalment_plans: 28,
    instalment_learners: 28,
    months: [
        { month: '2026-11', amount: 99000, learners: 9, dues: 9, first_due_on: '2026-11-06' },
        { month: '2027-02', amount: 446715, learners: 22, dues: 22, first_due_on: '2027-02-06' },
        { month: '2027-05', amount: 259285, learners: 18, dues: 18, first_due_on: '2027-05-06' },
        { month: '2027-08', amount: 40000, learners: 1, dues: 1, first_due_on: '2027-08-06' },
    ],
};

/** The app formats in the admin's own locale (₹14,65,000 in India), so expectations do too. */
const inr = (amount: number) => formatMoney(amount, 'INR', { maximumFractionDigits: 0 });

const renderForecast = (overrides: Partial<Parameters<typeof InstalmentForecast>[0]> = {}) => {
    const onSelectMonth = vi.fn();
    render(
        <InstalmentForecast
            data={VASCO}
            isLoading={false}
            error={null}
            currency="INR"
            selectedMonth={null}
            onSelectMonth={onSelectMonth}
            {...overrides}
        />
    );
    return onSelectMonth;
};

describe('outstanding-learners request', () => {
    beforeEach(() => {
        post.mockReset();
        post.mockResolvedValue({ data: { content: [] } });
    });

    it('asks exactly what it asked before when no month is picked', async () => {
        await fetchOutstandingLearners({}, 0, 20);
        await fetchOutstandingLearners({}, 1, 20, true);
        expect(post.mock.calls[0]![2]).toEqual({ params: { pageNo: 0, pageSize: 20 } });
        expect(post.mock.calls[1]![2]).toEqual({
            params: { pageNo: 1, pageSize: 20, includeNotYetDue: true },
        });
    });

    it('adds dueMonth only when a month is picked', async () => {
        await fetchOutstandingLearners({}, 0, 20, true, '2026-11');
        await fetchOutstandingLearners({}, 0, 20, true, null);
        expect(post.mock.calls[0]![2]).toEqual({
            params: { pageNo: 0, pageSize: 20, includeNotYetDue: true, dueMonth: '2026-11' },
        });
        expect(post.mock.calls[1]![2]).toEqual({
            params: { pageNo: 0, pageSize: 20, includeNotYetDue: true },
        });
    });
});

describe('fetchInstalmentForecast', () => {
    it('posts the billing-summary body and normalises what comes back', async () => {
        post.mockReset();
        post.mockResolvedValue({
            data: {
                instalment_billed: 1465000,
                instalment_paid: 620000,
                months: [
                    { month: '2026-11', amount: 98999.97, learners: 9, dues: 9 },
                    { month: null },
                ],
            },
        });
        const f = await fetchInstalmentForecast({ start_date_in_utc: '2026-06-30T00:00:00' });
        expect(post.mock.calls[0]![0]).toMatch(/\/payment-logs\/instalment-forecast$/);
        expect(post.mock.calls[0]![1]).toEqual({
            start_date_in_utc: '2026-06-30T00:00:00',
            institute_id: 'inst-1',
        });
        expect(f.instalment_overdue).toBe(0);
        expect(f.instalment_to_come).toBe(0);
        expect(f.months).toEqual([
            { month: '2026-11', amount: 98999.97, learners: 9, dues: 9, first_due_on: null },
            { month: null, amount: 0, learners: 0, dues: 0, first_due_on: null },
        ]);
    });
});

describe('isInstalmentFirst', () => {
    it('is on where instalments are the fee model', () => {
        expect(isInstalmentFirst(28, 28)).toBe(true); // Vasco: 28 of 28
        expect(isInstalmentFirst(28, 54)).toBe(true); // Newton: 28 of 54
    });

    it('stays off where a few instalment plans sit among one-time sales', () => {
        expect(isInstalmentFirst(2, 14032)).toBe(false); // Shiksha Nation
        expect(isInstalmentFirst(25, 299)).toBe(false); // Enark
    });

    it('stays off with no instalment plan, or against an older server that sends no count', () => {
        expect(isInstalmentFirst(0, 0)).toBe(false);
        expect(isInstalmentFirst(null, 28)).toBe(false);
        expect(isInstalmentFirst(undefined, 28)).toBe(false);
        // Half an answer is no answer: the page stays as it was.
        expect(isInstalmentFirst(2, null)).toBe(false);
    });
});

describe('billing summary instalment count', () => {
    it('is read when the server sends it and null when it does not', async () => {
        post.mockReset();
        post.mockResolvedValueOnce({
            data: { plan_count: 3, instalment_plan_count: 28, live_plan_count: 54 },
        });
        post.mockResolvedValueOnce({ data: { plan_count: 28 } });
        const fresh = await fetchBillingSummary();
        expect(fresh.instalment_plan_count).toBe(28);
        expect(fresh.live_plan_count).toBe(54);
        const older = await fetchBillingSummary();
        expect(older.instalment_plan_count).toBeNull();
        expect(older.live_plan_count).toBeNull();
    });
});

describe('InstalmentForecast', () => {
    it('shows how far the instalment plans have got', () => {
        renderForecast();
        expect(screen.getByText(`of ${inr(1465000)} paid`)).toBeTruthy();
        expect(screen.getByText('42%')).toBeTruthy();
        expect(screen.getByText('28 instalment plans · 28 learners')).toBeTruthy();
        expect(screen.getByText(inr(845000))).toBeTruthy(); // "To come" in the legend
    });

    it('leaves out the progress row when the Collected card already says the same', () => {
        renderForecast({ cardTotals: { collected: 620000, outstanding: 845000 } });
        expect(screen.queryByText(`of ${inr(1465000)} paid`)).toBeNull();
        expect(screen.getByText('Nov 2026')).toBeTruthy();
        expect(screen.getByText('28 instalment plans · 28 learners')).toBeTruthy();
    });

    it('keeps it where instalments are only part of the fee book', () => {
        // Newton-like: 28 instalment plans beside 26 one-time sales.
        renderForecast({ cardTotals: { collected: 900000, outstanding: 845000 } });
        expect(screen.getByText(`of ${inr(1465000)} paid`)).toBeTruthy();
    });

    it('lists every month, and the months add up to the Upcoming card', () => {
        renderForecast();
        expect(screen.getByText('Nov 2026')).toBeTruthy();
        expect(screen.getByText('Aug 2027')).toBeTruthy();
        expect(screen.getByText('9 learners · from 6 Nov')).toBeTruthy();
        expect(
            screen.getByText(`${inr(845000)} over 4 months · click a month to see who pays`)
        ).toBeTruthy();
    });

    it('picks a month on click and clears it when the picked month is clicked again', () => {
        const pick = renderForecast();
        fireEvent.click(screen.getByText('Feb 2027'));
        expect(pick).toHaveBeenCalledWith('2027-02');

        const clear = vi.fn();
        render(
            <InstalmentForecast
                data={{ ...VASCO, months: [VASCO.months[0]!] }}
                isLoading={false}
                error={null}
                currency="INR"
                selectedMonth="2026-11"
                onSelectMonth={clear}
            />
        );
        const picked = screen.getAllByRole('button', { pressed: true });
        expect(picked).toHaveLength(1);
        fireEvent.click(picked[0]!);
        expect(clear).toHaveBeenCalledWith(null);
    });

    it('shows undated instalments in the total but not as a clickable month', () => {
        renderForecast({
            data: {
                ...VASCO,
                months: [{ month: null, amount: 5000, learners: 1, dues: 1, first_due_on: null }],
            },
        });
        expect(screen.getByText('No due date')).toBeTruthy();
        expect(screen.queryAllByRole('button')).toHaveLength(0);
    });

    it('drops the progress bar when the view holds no instalment plan', () => {
        renderForecast({
            data: {
                ...VASCO,
                instalment_billed: 0,
                instalment_paid: 0,
                instalment_to_come: 0,
                instalment_plans: 0,
                instalment_learners: 0,
                months: [],
            },
        });
        expect(screen.queryByText(/paid$/)).toBeNull();
        expect(screen.getByText('Nothing scheduled ahead in this view.')).toBeTruthy();
    });

    it('fails quietly — the cards and lists keep working without it', () => {
        renderForecast({ error: new Error('boom') });
        expect(screen.getByText(/Couldn’t load the instalment schedule/)).toBeTruthy();
    });

    it('formats yyyy-MM as a short month and year', () => {
        expect(formatForecastMonth('2027-02')).toBe('Feb 2027');
    });
});

const page = (content: object[]): OutstandingLearnersPage => ({
    content: content as OutstandingLearnersPage['content'],
    totalPages: 1,
    totalElements: content.length,
    number: 0,
    size: 20,
    last: true,
});

const learner = {
    user_id: 'u1',
    full_name: 'Md Arselan',
    email: 'a@x.in',
    mobile_number: null,
    course_name: 'DNS',
    payment_type: 'Custom Installment',
    plan_status: 'ACTIVE',
    billed: 65000,
    paid: 20000,
    due: 0,
    upcoming: 0,
    plan_count: 1,
    pending_installments: 3,
    next_due_date: '2026-11-06',
    outstanding: 45000,
    next_due_amount: 11000,
    month_amount: 11000,
    currency: 'INR',
};

describe('DueLearnersTable with a forecast month', () => {
    const baseProps = {
        isLoading: false,
        error: null,
        currentPage: 0,
        onPageChange: () => {},
    };

    it('adds "Due in <month>" to the Upcoming list for that month', () => {
        render(
            <DueLearnersTable
                {...baseProps}
                data={page([learner])}
                mode="outstanding"
                monthLabel="Nov 2026"
            />
        );
        expect(screen.getByText('Due in Nov 2026')).toBeTruthy();
        expect(screen.getAllByText(inr(11000)).length).toBeGreaterThan(0);
    });

    it('leaves the Outstanding and Due lists exactly as they were', () => {
        const { unmount } = render(
            <DueLearnersTable {...baseProps} data={page([learner])} mode="outstanding" />
        );
        const outstandingHeaders = screen.getAllByRole('columnheader').map((h) => h.textContent);
        expect(outstandingHeaders).toEqual([
            'Learner',
            'Course/Membership',
            'Fee Type',
            'Billed',
            'Paid',
            'Outstanding',
            'Next instalment',
            'Instalments',
        ]);
        unmount();
        render(<DueLearnersTable {...baseProps} data={page([learner])} mode="due" />);
        const dueHeaders = screen.getAllByRole('columnheader').map((h) => h.textContent);
        expect(dueHeaders).toEqual([
            'Learner',
            'Course/Membership',
            'Fee Type',
            'Billed',
            'Paid',
            'Due',
            'Upcoming',
            'Instalments',
        ]);
    });

    it('says which month is empty', () => {
        render(
            <DueLearnersTable
                {...baseProps}
                data={page([])}
                mode="outstanding"
                monthLabel="Nov 2026"
            />
        );
        expect(screen.getByText('Nothing due in Nov 2026')).toBeTruthy();
    });

    it('offers a way out of an empty Due list only when given one', () => {
        const onClick = vi.fn();
        const { unmount } = render(
            <DueLearnersTable
                {...baseProps}
                data={page([])}
                mode="due"
                emptyAction={{ label: 'See upcoming instalments', onClick }}
            />
        );
        fireEvent.click(screen.getByText('See upcoming instalments'));
        expect(onClick).toHaveBeenCalled();
        unmount();

        render(<DueLearnersTable {...baseProps} data={page([])} mode="due" />);
        expect(screen.getByText('Nothing overdue')).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
    });
});

describe('Total card', () => {
    const base: KpiBilling = {
        collected: 620000,
        due: 0,
        upcoming: 0,
        upcomingDays: 30,
        learnersOwing: 0,
        learnersUpcoming: 0,
        activatedWithoutPaymentCount: 0,
        outstanding: 845000,
        learnersOutstanding: 23,
        upcomingAll: 845000,
        learnersUpcomingAll: 23,
        nextDueDate: '2026-11-06',
        usesInstallments: true,
        currency: 'INR',
    };
    const summary = () => {
        const s = emptyPaymentSummary();
        s.paid.count = 30;
        return s;
    };

    it('shows the total fee and how much of it has come in, in a card of its own', () => {
        render(
            <PaymentKpiCards
                summary={summary()}
                billing={base}
                visibleKeys={new Set(['billed', 'paid'])}
            />
        );
        expect(screen.getByText('Total')).toBeTruthy();
        expect(screen.getByText(inr(1465000))).toBeTruthy();
        expect(screen.getByText(`42% collected · ${inr(845000)} to collect`)).toBeTruthy();
        // Collected reads exactly as it always did.
        expect(screen.getByText('30 payments')).toBeTruthy();
        // It opens no list, so it is not a button.
        expect(screen.queryByRole('button', { name: /Total/ })).toBeNull();
    });

    it('puts four cards in one row only when Total is one of them', () => {
        const { container, unmount } = render(
            <PaymentKpiCards
                summary={summary()}
                billing={base}
                visibleKeys={new Set(['paid', 'outstanding', 'due', 'upcoming'])}
            />
        );
        // An admin's own 4-card row without Total keeps the layout it always had.
        expect(container.firstElementChild!.className).toContain('lg:grid-cols-3');
        unmount();
        const withTotal = render(
            <PaymentKpiCards
                summary={summary()}
                billing={base}
                visibleKeys={new Set(['billed', 'paid', 'due', 'upcoming'])}
            />
        );
        expect(withTotal.container.firstElementChild!.className).toContain('lg:grid-cols-4');
    });

    it('is not in the built-in row (screens without card settings keep their old row)', () => {
        render(<PaymentKpiCards summary={summary()} billing={base} />);
        expect(screen.queryByText('Total')).toBeNull();
    });
});
