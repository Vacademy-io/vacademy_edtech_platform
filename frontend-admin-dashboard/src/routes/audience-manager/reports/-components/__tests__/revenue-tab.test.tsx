import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
    RevenuePaymentRow,
    RevenuePayments,
    RevenueReport,
} from '../../-services/get-revenue-reports';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, opts?: Record<string, unknown>) =>
            opts && 'name' in opts ? `${key}:${String(opts.name)}` : key,
        i18n: { language: 'en' },
    }),
}));

const report: RevenueReport = {
    currency: 'INR',
    totals: { revenue: 25000, paying_leads: 2, payments: 3, avg_deal_value: 12500 },
    by_source: [
        {
            source_type: 'Reference',
            revenue: 25000,
            paying_leads: 2,
            payments: 3,
            avg_deal_value: 12500,
        },
    ],
    by_counsellor: [
        {
            user_id: 'c1',
            name: 'Priyanka',
            revenue: 15000,
            paying_leads: 1,
            payments: 2,
            avg_deal_value: 15000,
        },
        {
            user_id: 'c2',
            name: 'Simran',
            revenue: 10000,
            paying_leads: 1,
            payments: 1,
            avg_deal_value: 10000,
        },
    ],
    trend: [],
} as unknown as RevenueReport;

const payment = (
    id: string,
    name: string,
    amount: number,
    day: string,
    entered: string
): RevenuePaymentRow => ({
    payment_id: id,
    user_id: `u-${id}`,
    student_name: name,
    phone: '919000000000',
    payment_date: day,
    entered_on: entered,
    amount,
    payment_mode: 'ONLINE_PAYMENT',
    payment_sub_mode: 'ICICI_BANK',
    payment_reference: 'UTR123',
    receipt_number: `RCPT-${id}`,
    courses: 'PGDAM Pune Online',
    source_type: 'Reference',
    counsellor_id: 'c1',
    counsellor_name: 'Priyanka',
});

const fetchRevenuePayments = vi.fn(
    (): Promise<RevenuePayments> =>
        Promise.resolve({
            currency: 'INR',
            total: 15000,
            count: 2,
            truncated: false,
            payments: [
                payment('p1', 'Dr Riya', 10000, '2026-10-20', '2026-10-22'),
                payment('p2', 'Dr Meera', 5000, '2026-10-05', '2026-10-05'),
            ],
        })
);

vi.mock('../../-services/get-revenue-reports', () => ({
    revenueQueryKey: () => ['revenue-test'],
    fetchRevenue: () => Promise.resolve(report),
    revenuePaymentsQueryKey: (p: { counsellorUserId?: string }) => [
        'payments-test',
        p.counsellorUserId,
    ],
    fetchRevenuePayments: (p: unknown) => fetchRevenuePayments(p as never),
}));

import { RevenueTab } from '../revenue-tab';

beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
});

const renderTab = () =>
    render(
        <QueryClientProvider
            client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
            <RevenueTab instituteId="inst" fromDate="2026-10-01" toDate="2026-10-31" teamId="t1" />
        </QueryClientProvider>
    );

describe('RevenueTab counsellor payments', () => {
    it('lists the clicked counsellor’s payments below the table', async () => {
        renderTab();
        fireEvent.click(await screen.findByText('Priyanka'));

        const title = await screen.findByText('payments.title:Priyanka');
        expect(await screen.findByText('Dr Riya')).toBeTruthy();
        expect(screen.getByText('Dr Meera')).toBeTruthy();
        expect(screen.getByText('RCPT-p1')).toBeTruthy();
        expect(screen.getAllByText('Online Payment / Icici Bank').length).toBe(2);

        const section = title.closest('section') as HTMLElement;
        expect(within(section).getAllByRole('row')).toHaveLength(4); // header + 2 + total
        // Scoped to the clicked counsellor, keeping the page's team filter.
        expect(fetchRevenuePayments).toHaveBeenCalledWith(
            expect.objectContaining({
                counsellorUserId: 'c1',
                teamId: 't1',
                fromDate: '2026-10-01',
            })
        );
    });

    it('closes the list when the same counsellor is clicked again', async () => {
        renderTab();
        fireEvent.click(await screen.findByText('Priyanka'));
        expect(await screen.findByText('payments.title:Priyanka')).toBeTruthy();
        fireEvent.click(screen.getByText('Priyanka'));
        expect(screen.queryByText('payments.title:Priyanka')).toBeNull();
    });
});
