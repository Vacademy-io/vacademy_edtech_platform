/**
 * Service layer for the Reports → Admissions tab.
 *
 *   GET /admin-core-service/v1/reports/admissions          (the report)
 *
 * An admission is one student enrolled in a month of the range. Fees are the student's fee plans
 * for those enrolments, paid is what has been collected on them so far, due = fees - paid. A
 * student who joined several courses at once counts once, under their main course (the course
 * whose tag comes first in Settings → Reports → Course group order, else the first enrolled).
 */
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import type { CrmReportParams } from './get-crm-reports';

const ADMISSIONS_URL = `${BASE_URL}/admin-core-service/v1/reports/admissions`;

export interface AdmissionRow {
    /** Month yyyy-MM, source, course tag, package id, counsellor id or field value ("" = none). */
    key: string;
    /** Display name when the key is an id (course, counsellor); null otherwise. */
    label: string | null;
    /** Set on source rows named after the leads' campaign type. */
    campaign_type?: string | null;
    /** Course tag of a course row. */
    course_tag?: string | null;
    admissions: number;
    fees: number;
    paid: number;
    due: number;
    /** Admissions per course tag (keys from AdmissionReport.course_tags). */
    tag_counts: Record<string, number>;
}

export interface AdmissionReport {
    currency: string;
    totals: AdmissionRow | null;
    /** Course tags in column order; "" = courses with no tag. */
    course_tags: string[];
    /** Name of the custom field behind by_field; null when none is configured. */
    field_name: string | null;
    multi_course_admissions: number;
    by_month: AdmissionRow[];
    by_source: AdmissionRow[];
    by_course_tag: AdmissionRow[];
    by_course: AdmissionRow[];
    by_counsellor: AdmissionRow[];
    by_field: AdmissionRow[];
}

type AdmissionParams = Pick<
    CrmReportParams,
    'instituteId' | 'fromDate' | 'toDate' | 'teamId' | 'counsellorUserId'
>;

export const admissionsQueryKey = (p: AdmissionParams) =>
    [
        'crm-reports-admissions',
        p.instituteId,
        p.fromDate,
        p.toDate,
        p.teamId,
        p.counsellorUserId,
    ] as const;

export async function fetchAdmissions(p: AdmissionParams): Promise<AdmissionReport> {
    const { data } = await authenticatedAxiosInstance.get(ADMISSIONS_URL, {
        params: {
            instituteId: p.instituteId,
            fromDate: p.fromDate || undefined,
            toDate: p.toDate || undefined,
            teamId: p.teamId || undefined,
            counsellorUserId: p.counsellorUserId || undefined,
        },
    });
    return data;
}
