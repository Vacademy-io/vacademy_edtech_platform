// Client-side CSV export for the learner list.
//
// The legacy export hit a backend endpoint that built the CSV via Java reflection,
// so headers came out as raw field names (e.g. "packageSessionId") and IDs were
// never resolved to readable names. We instead build the CSV in the browser from
// the same JSON the table already uses, which lets us (a) apply the institute's
// custom terminology to headers and (b) resolve package_session_id -> Course /
// Level / Session names. Column selection is driven by the export dialog.
import {
    StudentTable,
    StudentFilterRequest,
    StudentListResponse,
} from '@/types/student-table-types';
import { BatchForSessionType } from '@/schemas/student/student-list/institute-schema';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_STUDENTS } from '@/constants/urls';
import { getAccessiblePackageFilters } from '@/lib/auth/facultyAccessUtils';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getCustomFieldSettingsFromCache } from '@/services/custom-field-settings';
import { formatCustomFieldValue } from '@/components/design-system/utils/constants/custom-field-columns';
import { getSystemFieldColumnVisibility } from '@/components/design-system/utils/constants/system-field-columns';
import { convertToUpperCase } from '@/utils/customFields';
import type { TFunction } from 'i18next';

export interface ExportContext {
    /** Resolve a package_session_id to its batch (course/level/session) details. */
    getBatch: (packageSessionId: string) => BatchForSessionType | null;
}

export interface ExportColumn {
    id: string;
    /** Display header — already has custom terminology applied. */
    label: string;
    /** Section the column is grouped under in the picker dialog. */
    group: string;
    /** Whether the column is pre-checked when the dialog opens. */
    defaultSelected: boolean;
    /**
     * Write the cell as forced text. Phone numbers are stored as long digit
     * strings (e.g. 917736011420); written bare, Excel turns them into a number
     * and shows 9.17736E+11, dropping any leading + or 0.
     */
    asText?: boolean;
    getValue: (student: StudentTable, ctx: ExportContext) => string;
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

const formatDate = (value: unknown): string => {
    if (value === null || value === undefined || value === '') return '';
    const date = new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? str(value) : date.toLocaleDateString();
};

const PHONE_FIELD_NAMES = new Set(['phone', 'phone number', 'mobile', 'mobile number']);

/**
 * Ids of the institute's phone custom fields: any field named Phone / Phone
 * Number / Mobile / Mobile Number, or of type phone. Institutes collect the
 * phone through these fields on enrol-invite and audience forms, while
 * imports and admin edits write student.mobile_number, so a learner usually
 * has the number in only one of the two places. Settings also treats a field
 * named Phone Number as a system field (SYSTEM_FIELD_NAMES), so it can sit in
 * fixedFields rather than the custom-field lists.
 */
const getPhoneCustomFieldIds = (): Set<string> => {
    const cache = getCustomFieldSettingsFromCache();
    if (!cache) return new Set();
    const fields = [
        ...cache.fixedFields,
        ...cache.instituteFields,
        ...cache.customFields,
        ...cache.fieldGroups.flatMap((g) => g.fields),
    ];
    return new Set(
        fields
            .filter(
                (f) =>
                    f.id &&
                    (f.type === 'phone' ||
                        PHONE_FIELD_NAMES.has((f.name ?? '').trim().toLowerCase()))
            )
            .map((f) => f.id)
    );
};

/** First non-empty value among the learner's phone custom fields. */
const phoneFromCustomFields = (student: StudentTable, phoneFieldIds: Set<string>): string => {
    for (const id of phoneFieldIds) {
        const value = str(student.custom_fields?.[id]).trim();
        if (value) return value;
    }
    return '';
};

/**
 * The learner's phone from wherever it is stored: student.mobile_number
 * first, then any phone custom field.
 */
const learnerPhone = (student: StudentTable, phoneFieldIds: Set<string>): string =>
    str(student.mobile_number).trim() || phoneFromCustomFields(student, phoneFieldIds);

/**
 * Build the full list of selectable export columns. Headers use the institute's
 * custom terminology and the list ends with one column per custom field.
 *
 * Takes the translation function rather than importing the i18next singleton —
 * this is called from a single dialog component (export-columns-dialog.tsx),
 * which already loads the 'manageStudentsExportUtil' namespace via useTranslation
 * and owns the render that consumes these labels.
 */
export const getStudentExportColumns = (t: TFunction): ExportColumn[] => {
    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const levelTerm = getTerminology(ContentTerms.Level, SystemTerms.Level);
    const sessionTerm = getTerminology(ContentTerms.Session, SystemTerms.Session);
    const learnerTerm = getTerminology('Learner', SystemTerms.Learner);
    const inviteTerm = getTerminology(OtherTerms.Invite, SystemTerms.Invite);
    const phoneFieldIds = getPhoneCustomFieldIds();

    const columns: ExportColumn[] = [
        // Identity
        {
            id: 'full_name',
            label: t('manageStudentsExportUtil:columns.learnerName', { term: learnerTerm }),
            group: t('manageStudentsExportUtil:groups.identity'),
            defaultSelected: true,
            getValue: (s) => str(s.full_name),
        },
        {
            id: 'institute_enrollment_number',
            label: t('manageStudentsExportUtil:columns.enrollmentNumber'),
            group: t('manageStudentsExportUtil:groups.identity'),
            defaultSelected: true,
            getValue: (s) => str(s.institute_enrollment_number ?? s.institute_enrollment_id),
        },
        {
            id: 'username',
            label: t('manageStudentsExportUtil:columns.username'),
            group: t('manageStudentsExportUtil:groups.identity'),
            defaultSelected: true,
            getValue: (s) => str(s.username),
        },
        {
            id: 'email',
            label: t('manageStudentsExportUtil:columns.email'),
            group: t('manageStudentsExportUtil:groups.identity'),
            defaultSelected: true,
            getValue: (s) => str(s.email),
        },
        {
            id: 'mobile_number',
            label: t('manageStudentsExportUtil:columns.mobileNumber'),
            group: t('manageStudentsExportUtil:groups.identity'),
            defaultSelected: true,
            asText: true,
            getValue: (s) => learnerPhone(s, phoneFieldIds),
        },
        {
            id: 'gender',
            label: t('manageStudentsExportUtil:columns.gender'),
            group: t('manageStudentsExportUtil:groups.identity'),
            defaultSelected: true,
            getValue: (s) => str(s.gender),
        },
        {
            id: 'date_of_birth',
            label: t('manageStudentsExportUtil:columns.dateOfBirth'),
            group: t('manageStudentsExportUtil:groups.identity'),
            defaultSelected: false,
            getValue: (s) => str(s.date_of_birth),
        },
        // Enrollment — IDs resolved to readable names using terminology
        {
            id: 'course',
            label: courseTerm,
            group: `${courseTerm} / ${levelTerm} / ${sessionTerm}`,
            defaultSelected: true,
            getValue: (s, ctx) => str(ctx.getBatch(s.package_session_id)?.package_dto?.package_name),
        },
        {
            id: 'level',
            label: levelTerm,
            group: `${courseTerm} / ${levelTerm} / ${sessionTerm}`,
            defaultSelected: true,
            getValue: (s, ctx) => str(ctx.getBatch(s.package_session_id)?.level?.level_name),
        },
        {
            id: 'session',
            label: sessionTerm,
            group: `${courseTerm} / ${levelTerm} / ${sessionTerm}`,
            defaultSelected: true,
            getValue: (s, ctx) => str(ctx.getBatch(s.package_session_id)?.session?.session_name),
        },
        {
            id: 'status',
            label: t('manageStudentsExportUtil:columns.status'),
            group: `${courseTerm} / ${levelTerm} / ${sessionTerm}`,
            defaultSelected: true,
            getValue: (s) => str(s.status),
        },
        {
            id: 'expiry_date',
            label: t('manageStudentsExportUtil:columns.sessionExpiryDate', { term: sessionTerm }),
            group: `${courseTerm} / ${levelTerm} / ${sessionTerm}`,
            defaultSelected: false,
            getValue: (s) => formatDate(s.expiry_date),
        },
        {
            id: 'enroll_invite_name',
            label: inviteTerm,
            group: `${courseTerm} / ${levelTerm} / ${sessionTerm}`,
            defaultSelected: false,
            getValue: (s) => str(s.enroll_invite_name),
        },
        // Contact & address
        {
            id: 'address_line',
            label: t('manageStudentsExportUtil:columns.address'),
            group: t('manageStudentsExportUtil:groups.contactAddress'),
            defaultSelected: false,
            getValue: (s) => str(s.address_line),
        },
        {
            id: 'city',
            label: t('manageStudentsExportUtil:columns.city'),
            group: t('manageStudentsExportUtil:groups.contactAddress'),
            defaultSelected: false,
            getValue: (s) => str(s.city),
        },
        {
            id: 'region',
            label: t('manageStudentsExportUtil:columns.state'),
            group: t('manageStudentsExportUtil:groups.contactAddress'),
            defaultSelected: false,
            getValue: (s) => str(s.region),
        },
        {
            id: 'country',
            label: t('manageStudentsExportUtil:columns.country'),
            group: t('manageStudentsExportUtil:groups.contactAddress'),
            defaultSelected: false,
            getValue: (s) => str(s.country),
        },
        {
            id: 'pin_code',
            label: t('manageStudentsExportUtil:columns.pinCode'),
            group: t('manageStudentsExportUtil:groups.contactAddress'),
            defaultSelected: false,
            getValue: (s) => str(s.pin_code),
        },
        {
            id: 'linked_institute_name',
            label: t('manageStudentsExportUtil:columns.collegeSchool'),
            group: t('manageStudentsExportUtil:groups.contactAddress'),
            defaultSelected: false,
            getValue: (s) => str(s.linked_institute_name),
        },
        // Guardian
        {
            id: 'fathers_name',
            label: t('manageStudentsExportUtil:columns.fatherName'),
            group: t('manageStudentsExportUtil:groups.guardian'),
            defaultSelected: false,
            getValue: (s) => str(s.fathers_name),
        },
        {
            id: 'parents_mobile_number',
            label: t('manageStudentsExportUtil:columns.fatherMobile'),
            group: t('manageStudentsExportUtil:groups.guardian'),
            defaultSelected: false,
            asText: true,
            getValue: (s) => str(s.parents_mobile_number),
        },
        {
            id: 'parents_email',
            label: t('manageStudentsExportUtil:columns.fatherEmail'),
            group: t('manageStudentsExportUtil:groups.guardian'),
            defaultSelected: false,
            getValue: (s) => str(s.parents_email),
        },
        {
            id: 'mothers_name',
            label: t('manageStudentsExportUtil:columns.motherName'),
            group: t('manageStudentsExportUtil:groups.guardian'),
            defaultSelected: false,
            getValue: (s) => str(s.mothers_name),
        },
        {
            id: 'parents_to_mother_mobile_number',
            label: t('manageStudentsExportUtil:columns.motherMobile'),
            group: t('manageStudentsExportUtil:groups.guardian'),
            defaultSelected: false,
            asText: true,
            getValue: (s) => str(s.parents_to_mother_mobile_number),
        },
        {
            id: 'parents_to_mother_email',
            label: t('manageStudentsExportUtil:columns.motherEmail'),
            group: t('manageStudentsExportUtil:groups.guardian'),
            defaultSelected: false,
            getValue: (s) => str(s.parents_to_mother_email),
        },
        // Other
        {
            id: 'attendance_percent',
            label: t('manageStudentsExportUtil:columns.attendancePercent'),
            group: t('manageStudentsExportUtil:groups.other'),
            defaultSelected: false,
            getValue: (s) => str(s.attendance_percent),
        },
        {
            id: 'referral_count',
            label: t('manageStudentsExportUtil:columns.referralsCount'),
            group: t('manageStudentsExportUtil:groups.other'),
            defaultSelected: false,
            getValue: (s) => str(s.referral_count),
        },
        {
            id: 'created_at',
            label: t('manageStudentsExportUtil:columns.createdAt'),
            group: t('manageStudentsExportUtil:groups.other'),
            defaultSelected: false,
            getValue: (s) => formatDate(s.created_at),
        },
    ];

    // Append a column per institute custom field, formatted the same way the table does.
    // Mirror the learner-list table exactly: it includes EVERY institute custom field
    // (see generateCustomFieldColumns / getAllCustomFieldsForLearnerList) and
    // intentionally ignores the institute-wide `visibility.learnersList` flag — so the
    // export must too, otherwise a field shown in the table is silently dropped here.
    const cache = getCustomFieldSettingsFromCache();
    if (cache) {
        const seen = new Set<string>();
        const customFields = [
            ...cache.instituteFields,
            ...cache.customFields,
            ...cache.fieldGroups.flatMap((g) => g.fields),
        ];
        for (const field of customFields) {
            if (!field.id || !field.name || seen.has(field.id)) continue;
            seen.add(field.id);
            columns.push({
                id: `custom_${field.id}`,
                label: convertToUpperCase(field.name),
                group: t('manageStudentsExportUtil:groups.customFields'),
                defaultSelected: true,
                asText: phoneFieldIds.has(field.id),
                // A phone column falls back to the learner's phone stored
                // elsewhere (usually student.mobile_number) when this field is
                // empty, so the column is not blank for learners who gave
                // their number through another path.
                getValue: (s) => {
                    const raw = str(s.custom_fields?.[field.id]);
                    if (phoneFieldIds.has(field.id) && !raw.trim()) {
                        return learnerPhone(s, phoneFieldIds);
                    }
                    return formatCustomFieldValue(raw, field.type);
                },
            });
        }
    }

    // Drop any system column whose system-field toggle is off (Settings → Custom
    // Fields). Export column ids equal the system accessor key, so we look them up
    // directly. Derived columns (course/level/session, created_at, enroll invite)
    // and custom fields aren't system accessors, so they stay on.
    const systemVisibility = getSystemFieldColumnVisibility();
    return columns.filter((col) => systemVisibility[col.id] !== false);
};

/** Escape a single CSV cell per RFC 4180 (quote if it contains , " or newlines). */
const escapeCsvCell = (value: string): string => {
    if (/[",\n\r]/.test(value)) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
};

/**
 * Wrap a value as an Excel text formula (="...") so spreadsheet apps keep it
 * verbatim instead of coercing it to a number. Excel, Google Sheets and
 * LibreOffice all evaluate it to the plain string. Empty and placeholder
 * values are left as they are.
 */
const asTextCell = (value: string): string => {
    if (!value || value === '-') return value;
    return `="${value.replace(/"/g, '""')}"`;
};

/** Build a CSV string (with BOM for Excel) from students and the selected columns. */
export const buildStudentsCsv = (
    students: StudentTable[],
    columns: ExportColumn[],
    ctx: ExportContext
): string => {
    const header = columns.map((c) => escapeCsvCell(c.label)).join(',');
    const rows = students.map((student) =>
        columns
            .map((c) => {
                const value = c.getValue(student, ctx);
                return escapeCsvCell(c.asText ? asTextCell(value) : value);
            })
            .join(',')
    );
    // Prefix a BOM so Excel opens the UTF-8 CSV with correct encoding.
    return '﻿' + [header, ...rows].join('\r\n');
};

/** Trigger a browser download of the given CSV content. */
export const downloadCsv = (filename: string, csv: string): void => {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.parentNode?.removeChild(link);
    window.URL.revokeObjectURL(url);
};

/** Rows fetched per request while exporting. */
export const EXPORT_FETCH_PAGE_SIZE = 1000;
/** Runaway-loop guard only (5M rows at 1000 per page), not a row cap. */
const EXPORT_MAX_PAGES = 5000;
/** One page may not take longer than this before it is abandoned and retried. */
const EXPORT_PAGE_TIMEOUT_MS = 90_000;
/** Extra attempts per page after the first one fails. */
const EXPORT_PAGE_RETRIES = 2;

export interface ExportProgress {
    /** Pages fetched so far. */
    pagesDone: number;
    /** Total pages the server reported (0 until the first page arrives). */
    totalPages: number;
    /** Distinct rows collected so far. */
    rowsFetched: number;
    /** Total rows the server reported for these filters. */
    totalRows: number;
    /** Set while a page is being retried after a failure. */
    retrying?: { pageNo: number; attempt: number };
    /** Server-job stages. Absent while paging in the browser. */
    phase?: 'queued' | 'server' | 'downloading';
}

export interface FetchAllStudentsOptions {
    onProgress?: (progress: ExportProgress) => void;
    /** Aborts the export, for example when the dialog is closed. */
    signal?: AbortSignal;
}

/** Thrown when a page still fails after every retry. Carries the page for the error toast. */
export class ExportPageError extends Error {
    constructor(
        public readonly pageNo: number,
        public readonly reason: unknown
    ) {
        super(`Export failed on page ${pageNo + 1}`);
        this.name = 'ExportPageError';
    }
}

const wait = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            'abort',
            () => {
                clearTimeout(timer);
                reject(new DOMException('Export cancelled', 'AbortError'));
            },
            { once: true }
        );
    });

const isAbort = (error: unknown, signal?: AbortSignal) =>
    signal?.aborted ||
    (error instanceof DOMException && error.name === 'AbortError') ||
    (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ERR_CANCELED');

/** One page with a hard timeout, retried with a short backoff before giving up. */
const fetchExportPage = async (
    pageNo: number,
    filters: StudentFilterRequest,
    options: FetchAllStudentsOptions,
    report: (retrying: ExportProgress['retrying']) => void
): Promise<StudentListResponse> => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= EXPORT_PAGE_RETRIES; attempt++) {
        if (attempt > 0) {
            report({ pageNo, attempt });
            await wait(2_000 * attempt, options.signal);
        }
        try {
            const response = await authenticatedAxiosInstance.post<StudentListResponse>(
                `${GET_STUDENTS}?pageNo=${pageNo}&pageSize=${EXPORT_FETCH_PAGE_SIZE}`,
                filters,
                { timeout: EXPORT_PAGE_TIMEOUT_MS, signal: options.signal }
            );
            return response.data;
        } catch (error) {
            if (isAbort(error, options.signal)) throw error;
            lastError = error;
        }
    }
    throw new ExportPageError(pageNo, lastError);
};

/**
 * Fetch every learner matching the current filters, mirroring the sub-org access
 * restriction the old export applied. Pages through the list EXPORT_FETCH_PAGE_SIZE
 * rows at a time. It stops only when the server says the last page was reached: a
 * page can hold fewer rows than asked for in the middle of the list (users with no
 * active enrolment row are dropped after the id page is cut), so a short page is not
 * the end. Each page has a timeout and retries, so a slow page fails loudly instead
 * of leaving the dialog spinning forever.
 */
export const fetchAllStudentsForExport = async (
    filters: StudentFilterRequest,
    options: FetchAllStudentsOptions = {}
): Promise<StudentTable[]> => {
    const exportFilters = scopeExportFilters(filters);
    const rows = new Map<string, StudentTable>();
    let totalPages = 0;
    let totalRows = 0;
    for (let pageNo = 0; pageNo < EXPORT_MAX_PAGES; pageNo++) {
        const response = await fetchExportPage(pageNo, exportFilters, options, (retrying) =>
            options.onProgress?.({
                pagesDone: pageNo,
                totalPages,
                rowsFetched: rows.size,
                totalRows,
                retrying,
            })
        );
        const content = response.content ?? [];
        for (const row of content) {
            rows.set(row.id, row);
        }
        totalPages = response.total_pages ?? totalPages;
        totalRows = response.total_elements ?? totalRows;
        options.onProgress?.({
            pagesDone: pageNo + 1,
            totalPages,
            rowsFetched: rows.size,
            totalRows,
        });
        // The server's last flag (or the page count it reported) is the only end
        // signal. An empty page is a safety stop so a bad total can never loop.
        const lastPage =
            response.last || (totalPages > 0 && pageNo + 1 >= totalPages) || content.length === 0;
        if (lastPage) break;
    }
    return Array.from(rows.values());
};

// ---------------------------------------------------------------------------
// Server-side export job. The server pages through the list itself (no gateway
// timeout applies to it) and hands back one gzipped JSON file with the same rows
// /get/v2/all returns, so buildStudentsCsv makes the same CSV as before.
// ---------------------------------------------------------------------------

const EXPORT_JOBS_URL = GET_STUDENTS.replace(/\/all$/, '/export-jobs');
const JOB_POLL_INTERVAL_MS = 2_000;
/** Consecutive failed polls tolerated (a deploy or a blip) before giving up. */
const JOB_MAX_POLL_FAILURES = 10;

interface LearnerExportJob {
    job_id: string;
    status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
    processed_rows: number;
    total_rows: number | null;
    file_ready: boolean;
    error_message?: string | null;
}

/** Thrown when the server reports the job failed. The message is safe to show. */
export class ExportJobError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ExportJobError';
    }
}

const httpStatus = (error: unknown): number | undefined =>
    (error as { response?: { status?: number } })?.response?.status;

/** Decompresses the gzipped JSON file. Falls back to plain JSON if it is not gzipped. */
const parseExportFile = async (buffer: ArrayBuffer): Promise<StudentTable[]> => {
    const bytes = new Uint8Array(buffer);
    const gzipped = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    const text = gzipped
        ? await new Response(
              new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
          ).text()
        : new TextDecoder().decode(bytes);
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
};

/**
 * Runs the export as a server-side job and returns every matching row.
 * Returns null when the server does not have the job endpoint yet (older deploy),
 * so the caller can fall back to paging in the browser.
 */
export const fetchAllStudentsViaServerJob = async (
    filters: StudentFilterRequest,
    options: FetchAllStudentsOptions = {}
): Promise<StudentTable[] | null> => {
    const exportFilters = scopeExportFilters(filters);
    let job: LearnerExportJob;
    try {
        const started = await authenticatedAxiosInstance.post<LearnerExportJob>(
            EXPORT_JOBS_URL,
            exportFilters,
            { timeout: 30_000, signal: options.signal }
        );
        job = started.data;
    } catch (error) {
        if (isAbort(error, options.signal)) throw error;
        const status = httpStatus(error);
        if (status === 404 || status === 405) return null;
        throw error;
    }

    let failures = 0;
    while (job.status === 'QUEUED' || job.status === 'RUNNING') {
        options.onProgress?.({
            pagesDone: 0,
            totalPages: 0,
            rowsFetched: job.processed_rows ?? 0,
            totalRows: job.total_rows ?? 0,
            phase: job.status === 'QUEUED' ? 'queued' : 'server',
        });
        await wait(JOB_POLL_INTERVAL_MS, options.signal);
        try {
            const polled = await authenticatedAxiosInstance.get<LearnerExportJob>(
                `${EXPORT_JOBS_URL}/${job.job_id}`,
                { timeout: 30_000, signal: options.signal }
            );
            job = polled.data;
            failures = 0;
        } catch (error) {
            if (isAbort(error, options.signal)) throw error;
            failures += 1;
            if (failures >= JOB_MAX_POLL_FAILURES) throw error;
        }
    }

    if (job.status !== 'COMPLETED') {
        throw new ExportJobError(job.error_message || 'The export failed on the server.');
    }

    options.onProgress?.({
        pagesDone: 0,
        totalPages: 0,
        rowsFetched: job.processed_rows ?? 0,
        totalRows: job.total_rows ?? job.processed_rows ?? 0,
        phase: 'downloading',
    });
    const file = await authenticatedAxiosInstance.get<ArrayBuffer>(
        `${EXPORT_JOBS_URL}/${job.job_id}/file`,
        { responseType: 'arraybuffer', timeout: 5 * 60_000, signal: options.signal }
    );
    return parseExportFile(file.data);
};

/**
 * Applies the sub-org / faculty access restriction the old export applied, so a
 * scoped user only ever exports the batches they can see.
 */
const scopeExportFilters = (filters: StudentFilterRequest): StudentFilterRequest => {
    const exportFilters: StudentFilterRequest = { ...filters };
    const accessibleFilters = getAccessiblePackageFilters();
    if (accessibleFilters?.package_session_ids?.length) {
        const allowed = new Set(accessibleFilters.package_session_ids);
        if (exportFilters.package_session_ids?.length) {
            exportFilters.package_session_ids = exportFilters.package_session_ids.filter((id) =>
                allowed.has(id)
            );
        } else {
            exportFilters.package_session_ids = accessibleFilters.package_session_ids;
        }
    }
    return exportFilters;
};
