/**
 * Service layer for the Reports → Admissions tab.
 *
 *   GET /admin-core-service/v1/reports/admissions          (the report)
 *   GET /admin-core-service/v1/reports/admissions/students (its students, opened on demand)
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

// ── GET /v1/reports/admissions/students ────────────────────────────────

/**
 * One admission in the student list: a student x the month they enrolled, from the same rows as
 * the report's totals. A course package is one row listing all its courses.
 */
export interface AdmissionStudentRow {
    user_id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    /** Admission month, yyyy-MM. */
    month: string;
    /** First enrolment day of the admission, yyyy-MM-dd. */
    admission_date: string | null;
    /** Every course of the admission, comma separated. */
    courses: string | null;
    course_count: number;
    /** The course the admission is counted under in the report's course tables. */
    main_course: string | null;
    course_tag: string | null;
    source: string | null;
    counsellor_id: string | null;
    counsellor_name: string | null;
    /** Value of the report's custom field (e.g. Branch). */
    field_value: string | null;
    fees: number;
    paid: number;
    due: number;
}

export interface AdmissionStudents {
    currency: string;
    field_name: string | null;
    rows: AdmissionStudentRow[];
    /** More admissions than the list returns; narrow the date range for the rest. */
    truncated: boolean;
}

export const admissionStudentsQueryKey = (p: AdmissionParams) =>
    [
        'crm-reports-admission-students',
        p.instituteId,
        p.fromDate,
        p.toDate,
        p.teamId,
        p.counsellorUserId,
    ] as const;

export async function fetchAdmissionStudents(p: AdmissionParams): Promise<AdmissionStudents> {
    const { data } = await authenticatedAxiosInstance.get(`${ADMISSIONS_URL}/students`, {
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
