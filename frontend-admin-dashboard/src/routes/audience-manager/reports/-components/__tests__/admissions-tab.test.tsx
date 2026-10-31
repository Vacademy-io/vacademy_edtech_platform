import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AdmissionReport, AdmissionRow } from '../../-services/get-admission-reports';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, opts?: Record<string, unknown>) =>
            opts && 'field' in opts ? `${key}:${String(opts.field)}` : key,
        i18n: { language: 'en' },
    }),
}));

const row = (
    key: string,
    admissions: number,
    fees: number,
    paid: number,
    tags: Record<string, number>,
    extra: Partial<AdmissionRow> = {}
): AdmissionRow => ({
    key,
    label: null,
    admissions,
    fees,
    paid,
    due: fees - paid,
    tag_counts: tags,
    ...extra,
});

const report: AdmissionReport = {
    currency: 'INR',
    totals: row('', 3, 150000, 100000, { Doctor: 2, Nutrition: 1 }),
    course_tags: ['Doctor', 'Nutrition'],
    field_name: null,
    multi_course_admissions: 1,
    by_month: [
        row('2026-07', 2, 100000, 80000, { Doctor: 2, Nutrition: 0 }),
        row('2026-08', 1, 50000, 20000, { Doctor: 0, Nutrition: 1 }),
    ],
    by_source: [
        row(
            'Reference',
            2,
            100000,
            80000,
            { Doctor: 2, Nutrition: 0 },
            { campaign_type: 'Reference' }
        ),
        row('UNKNOWN', 1, 50000, 20000, { Doctor: 0, Nutrition: 1 }),
    ],
    by_course_tag: [
        row('Doctor', 2, 100000, 80000, { Doctor: 2, Nutrition: 0 }),
        row('Nutrition', 1, 50000, 20000, { Doctor: 0, Nutrition: 1 }),
    ],
    by_course: [
        row(
            'p1',
            3,
            150000,
            100000,
            { Doctor: 2, Nutrition: 1 },
            { label: 'PG Diploma', course_tag: 'Doctor' }
        ),
    ],
    by_counsellor: [row('', 3, 150000, 100000, { Doctor: 2, Nutrition: 1 })],
    by_field: [],
};

vi.mock('../../-services/get-admission-reports', () => ({
    admissionsQueryKey: () => ['admissions-test'],
    fetchAdmissions: () => Promise.resolve(report),
}));

import { AdmissionsTab } from '../admissions-tab';

const renderTab = () =>
    render(
        <QueryClientProvider
            client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
            <AdmissionsTab instituteId="inst" fromDate="2026-07-01" toDate="2026-08-31" />
        </QueryClientProvider>
    );

describe('AdmissionsTab', () => {
    it('splits source admissions by course group and totals each table', async () => {
        renderTab();
        const section =
            (await screen.findByText('sections.bySource')).closest('section') ?? document.body;
        const table = within(section as HTMLElement).getByRole('table');
        expect(within(table).getByText('Doctor')).toBeTruthy();
        expect(within(table).getByText('Nutrition')).toBeTruthy();
        // A student with no enquiry is named, not shown as a raw UNKNOWN key.
        expect(within(table).getByText('labels.noEnquiry')).toBeTruthy();
        const totalRow = within(table).getByText('column.total').closest('tr') as HTMLElement;
        expect(within(totalRow).getByText('3')).toBeTruthy();
    });

    it('asks for the breakdown field when none is configured', async () => {
        renderTab();
        expect(await screen.findByText('footnotes.fieldHint')).toBeTruthy();
    });
});
