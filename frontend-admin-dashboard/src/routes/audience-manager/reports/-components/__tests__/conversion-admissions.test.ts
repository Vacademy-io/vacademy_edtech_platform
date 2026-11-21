import { describe, expect, it, vi } from 'vitest';
import type { ConversionLeadRow } from '../../-services/get-conversion-reports';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

import { groupConversionAdmissions, type ConversionAdmissionRow } from '../conversion-admissions';

const only = (rows: ConversionAdmissionRow[]): ConversionAdmissionRow => {
    expect(rows).toHaveLength(1);
    const [row] = rows;
    if (!row) throw new Error('expected one admission row');
    return row;
};

const enrolment = (over: Partial<ConversionLeadRow>): ConversionLeadRow => ({
    enrolment_id: Math.random().toString(36).slice(2),
    user_id: 'u1',
    lead_name: 'Asha',
    phone: '9000000000',
    email: null,
    package_id: 'p1',
    course_name: 'Course A',
    enrolled_at: '2026-10-05T00:00',
    enrolment_status: 'ACTIVE',
    counsellor_id: 'c1',
    counsellor_name: 'Counsellor',
    campaign_name: 'Website',
    source_type: 'Website',
    plan_shared: false,
    fee: null,
    paid: null,
    installments: null,
    installments_paid: null,
    next_due_amount: null,
    next_due_date: null,
    ...over,
});

describe('groupConversionAdmissions', () => {
    it('shows a course package once, with every course and the fees added up', () => {
        const rows = groupConversionAdmissions([
            enrolment({
                course_name: 'PG Diploma',
                fee: 60000,
                paid: 20000,
                installments: 3,
                installments_paid: 1,
            }),
            enrolment({
                course_name: 'BB Glow',
                fee: 20000,
                paid: 20000,
                installments: 1,
                installments_paid: 1,
            }),
            // One plan bought for two courses: its amounts sit on the other row only.
            enrolment({ course_name: 'Microblading', plan_shared: true }),
        ]);
        const row = only(rows);
        expect(row.course_name).toBe('BB Glow, Microblading, PG Diploma');
        expect(row.course_count).toBe(3);
        expect(row.fee).toBe(80000);
        expect(row.paid).toBe(40000);
        expect(row.money.installments).toBe(4);
    });

    it('keeps admissions of different months and different students apart', () => {
        const rows = groupConversionAdmissions([
            enrolment({ enrolled_at: '2026-09-28T00:00', fee: 10000, paid: 10000 }),
            enrolment({ enrolled_at: '2026-10-02T00:00', fee: 50000, paid: 5000 }),
            enrolment({
                user_id: 'u2',
                lead_name: 'Ravi',
                enrolled_at: '2026-10-02T00:00',
                fee: 30000,
                paid: 0,
            }),
        ]);
        expect(rows.map((r) => r.key)).toEqual(['u1|2026-09', 'u1|2026-10', 'u2|2026-10']);
        expect(rows.map((r) => r.fee)).toEqual([10000, 50000, 30000]);
    });

    it('keeps the first enrolment date of the admission', () => {
        const row = only(
            groupConversionAdmissions([
                enrolment({ enrolled_at: '2026-10-20T10:00' }),
                enrolment({ enrolled_at: '2026-10-03T09:00', course_name: 'Course B' }),
            ])
        );
        expect(row.enrolled_at).toBe('2026-10-03T09:00');
        expect(row.fee).toBeNull();
    });
});
