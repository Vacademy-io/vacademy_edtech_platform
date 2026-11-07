// Client-side CSV export for the learner list.
//
// The legacy export hit a backend endpoint that built the CSV via Java reflection,
// so headers came out as raw field names (e.g. "packageSessionId") and IDs were
// never resolved to readable names. We instead build the CSV in the browser from
// the same JSON the table already uses, which lets us (a) apply the institute's
// custom terminology to headers and (b) resolve package_session_id -> Course /
// Level / Session names. Column selection is driven by the export dialog.
import { StudentTable, StudentFilterRequest } from '@/types/student-table-types';
import { BatchForSessionType } from '@/schemas/student/student-list/institute-schema';
import { fetchStudents } from '../-services/getStudentTable';
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
    getValue: (student: StudentTable, ctx: ExportContext) => string;
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

const formatDate = (value: unknown): string => {
    if (value === null || value === undefined || value === '') return '';
    const date = new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? str(value) : date.toLocaleDateString();
};

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
            getValue: (s) => str(s.mobile_number),
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
                getValue: (s) =>
                    formatCustomFieldValue(str(s.custom_fields?.[field.id]), field.type),
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

/** Build a CSV string (with BOM for Excel) from students and the selected columns. */
export const buildStudentsCsv = (
    students: StudentTable[],
    columns: ExportColumn[],
    ctx: ExportContext
): string => {
    const header = columns.map((c) => escapeCsvCell(c.label)).join(',');
    const rows = students.map((student) =>
        columns.map((c) => escapeCsvCell(c.getValue(student, ctx))).join(',')
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

/**
 * Fetch every learner matching the current filters (one page, sized to the total),
 * mirroring the sub-org access restriction the old export applied.
 */
export const fetchAllStudentsForExport = async (
    filters: StudentFilterRequest,
    totalElements: number
): Promise<StudentTable[]> => {
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

    const response = await fetchStudents({
        pageNo: 0,
        pageSize: totalElements > 0 ? totalElements : 1,
        filters: exportFilters,
    });
    return response.content ?? [];
};
