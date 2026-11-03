import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CounselorPerformance, CounselorRow } from '../../-services/get-lead-reports';
import type { ConversionLeadRow, ConversionReport } from '../../-services/get-conversion-reports';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, opts?: Record<string, unknown>) =>
            opts && 'name' in opts ? `${key}:${String(opts.name)}` : key,
        i18n: { language: 'en' },
    }),
}));

vi.mock('@/hooks/use-lead-terminology', () => ({
    useLeadTerminology: () => ({ campaignType: 'Source' }),
}));

const counsellor = (id: string, name: string, conversions: number): CounselorRow => ({
    counselor_id: id,
    counselor_name: name,
    leads_assigned: 100,
    leads_responded: 90,
    conversions,
    conversion_rate: conversions,
    avg_response_minutes: 60,
    tat_met_count: 50,
    tat_met_rate: 50,
    open_leads: 10,
    overdue_leads: 2,
});

const performance = {
    from_date: '2026-10-01',
    to_date: '2026-10-31',
    tat_hours: null,
    rows: [counsellor('c1', 'Aparna', 2), counsellor('c2', 'Simran', 1)],
    summary: { total_counselors: 2, avg_response_minutes: 60, avg_conversion_rate: 1.5 },
} as unknown as CounselorPerformance;

const lead = (
    user: string,
    name: string,
    course: string,
    csl: string,
    enrolledAt: string,
    money: Partial<ConversionLeadRow> = {}
): ConversionLeadRow => ({
    enrolment_id: `${user}-${course}`,
    user_id: user,
    lead_name: name,
    phone: '9000000000',
    email: null,
    package_id: course,
    course_name: course,
    enrolled_at: enrolledAt,
    enrolment_status: 'ACTIVE',
    counsellor_id: csl,
    counsellor_name: csl,
    campaign_name: 'Reference',
    source_type: 'Reference',
    plan_shared: false,
    fee: null,
    paid: null,
    installments: null,
    installments_paid: null,
    next_due_amount: null,
    next_due_date: null,
    ...money,
});

const conversions: ConversionReport = {
    totals: { converted_leads: 3, enrolments: 4 },
    by_counsellor: [],
    leads: [
        // A student in two courses is ONE converted lead.
        lead('u1', 'Dr Riya', 'PGDAM Pune Online', 'c1', '2026-10-05T10:00', {
            fee: 50000,
            paid: 5000,
            installments: 4,
            installments_paid: 1,
            next_due_amount: 10000,
            next_due_date: '2099-11-23',
        }),
        lead('u1', 'Dr Riya', 'B&WSSC', 'c1', '2026-10-05T10:00', {
            fee: 8000,
            paid: 1000,
            installments: 3,
            installments_paid: 1,
            next_due_amount: 3500,
            next_due_date: '2099-11-30',
        }),
        lead('u2', 'Dr Meera', 'ADCT Offline Pune', 'c1', '2026-10-20T11:00'),
        lead('u3', 'Dr Kavya', 'MMBB', 'c2', '2026-10-21T12:00'),
    ],
    leads_truncated: false,
    currency: 'INR',
};

vi.mock('../../-services/get-lead-reports', () => ({
    fetchCounselorPerformance: () => Promise.resolve(performance),
}));
vi.mock('../../-services/get-conversion-reports', () => ({
    conversionsQueryKey: () => ['conversions-test'],
    fetchConversions: () => Promise.resolve(conversions),
}));

import { CounsellorsTab } from '../counsellors-tab';

const scrollIntoView = vi.fn();
beforeAll(() => {
    Element.prototype.scrollIntoView = scrollIntoView;
});

const renderTab = () =>
    render(
        <QueryClientProvider
            client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
            <CounsellorsTab instituteId="inst" fromDate="2026-10-01" toDate="2026-10-31" />
        </QueryClientProvider>
    );

describe('CounsellorsTab', () => {
    it('opens the clicked counsellor’s converted leads below the table, one row per student', async () => {
        renderTab();
        fireEvent.click(await screen.findByText('Aparna'));

        const title = await screen.findByText('leads.title:Aparna');
        expect(await screen.findByText('Dr Riya')).toBeTruthy();
        expect(screen.getByText('Dr Meera')).toBeTruthy();
        // Simran's student is not in Aparna's list.
        expect(screen.queryByText('Dr Kavya')).toBeNull();

        const section = title.closest('section') as HTMLElement;
        // Riya's two courses sit on her single row.
        expect(within(section).getByText('PGDAM Pune Online, B&WSSC')).toBeTruthy();
        expect(within(section).getAllByRole('row')).toHaveLength(3); // header + 2 students
        // Riya's two fee plans add up; the next installment is the earliest one due.
        const riya = within(section).getByText('Dr Riya').closest('tr') as HTMLElement;
        expect(within(riya).getByText('₹58,000')).toBeTruthy();
        expect(within(riya).getByText('₹6,000')).toBeTruthy();
        expect(within(riya).getByText('₹10,000')).toBeTruthy();
        // Source column is headed by the institute's own name for campaign type.
        expect(within(section).getByText('Source')).toBeTruthy();

        await new Promise((r) => requestAnimationFrame(() => r(null)));
        expect(scrollIntoView).toHaveBeenCalled();
    });

    it('closes the list when the same counsellor is clicked again', async () => {
        renderTab();
        fireEvent.click(await screen.findByText('Aparna'));
        expect(await screen.findByText('leads.title:Aparna')).toBeTruthy();
        fireEvent.click(screen.getByText('Aparna'));
        expect(screen.queryByText('leads.title:Aparna')).toBeNull();
    });

    it('no longer shows the Admissions button', async () => {
        renderTab();
        await screen.findByText('Aparna');
        expect(screen.queryByText('table.viewAdmissions')).toBeNull();
    });
});
