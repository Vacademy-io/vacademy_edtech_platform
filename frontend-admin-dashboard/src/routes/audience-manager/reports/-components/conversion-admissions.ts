/**
 * Conversions tab — the lead list as admissions.
 *
 * The API returns one row per course enrolment, so a student who bought a course package showed
 * once per course (and the money split across those rows). An admission is a student x the month
 * they enrolled, exactly as the Admissions tab counts them: this folds a student's enrolments of
 * one month into one row with every course listed and the fee plans added up.
 */
import type { ConversionLeadRow } from '../-services/get-conversion-reports';
import { EMPTY_FEE, addFee, type FeeSummary } from './conversion-fee-cells';

export interface ConversionAdmissionRow {
    /** user_id + admission month. */
    key: string;
    user_id: string;
    lead_name: string | null;
    phone: string | null;
    email: string | null;
    /** Admission month, yyyy-MM (null when the enrolment has no date). */
    month: string | null;
    /** Every course of the admission, A–Z, comma separated. */
    course_name: string | null;
    course_count: number;
    /** First enrolment of the admission, institute-local yyyy-MM-ddTHH:mm. */
    enrolled_at: string | null;
    /** Distinct enrolment statuses of the admission. */
    enrolment_status: string | null;
    counsellor_id: string | null;
    counsellor_name: string | null;
    campaign_name: string | null;
    source_type: string | null;
    /** The admission's fee plans added up (shown by the fee cells). */
    money: FeeSummary;
    /** money's fee / paid / next due date, flat so the list can sort on them. */
    fee: number | null;
    paid: number | null;
    next_due_date: string | null;
}

/** Admission month of an enrolment: the month of its institute-local enrolment date. */
export const admissionMonth = (enrolledAt: string | null): string | null =>
    enrolledAt && enrolledAt.length >= 7 ? enrolledAt.slice(0, 7) : null;

/** One row per student per admission month, in the order the admissions first appear. */
export function groupConversionAdmissions(rows: ConversionLeadRow[]): ConversionAdmissionRow[] {
    const byKey = new Map<
        string,
        { row: ConversionAdmissionRow; courses: Set<string>; statuses: Set<string> }
    >();
    for (const r of rows) {
        const month = admissionMonth(r.enrolled_at);
        const key = `${r.user_id}|${month ?? ''}`;
        let cur = byKey.get(key);
        if (!cur) {
            cur = {
                row: {
                    key,
                    user_id: r.user_id,
                    lead_name: r.lead_name,
                    phone: r.phone,
                    email: r.email,
                    month,
                    course_name: null,
                    course_count: 0,
                    enrolled_at: r.enrolled_at,
                    enrolment_status: null,
                    counsellor_id: r.counsellor_id,
                    counsellor_name: r.counsellor_name,
                    campaign_name: r.campaign_name,
                    source_type: r.source_type,
                    money: EMPTY_FEE,
                    fee: null,
                    paid: null,
                    next_due_date: null,
                },
                courses: new Set(),
                statuses: new Set(),
            };
            byKey.set(key, cur);
        }
        const out = cur.row;
        out.money = addFee(out.money, r);
        if (r.course_name) cur.courses.add(r.course_name);
        if (r.enrolment_status) cur.statuses.add(r.enrolment_status);
        if (r.enrolled_at && (!out.enrolled_at || r.enrolled_at < out.enrolled_at))
            out.enrolled_at = r.enrolled_at;
        out.lead_name ??= r.lead_name;
        out.phone ??= r.phone;
        out.email ??= r.email;
        out.campaign_name ??= r.campaign_name;
    }
    return [...byKey.values()].map(({ row, courses, statuses }) => {
        const names = [...courses].sort((a, b) => a.localeCompare(b));
        return {
            ...row,
            course_name: names.length ? names.join(', ') : null,
            course_count: names.length,
            enrolment_status: statuses.size ? [...statuses].join(', ') : null,
            fee: row.money.fee,
            paid: row.money.paid,
            next_due_date: row.money.next_due_date,
        };
    });
}
