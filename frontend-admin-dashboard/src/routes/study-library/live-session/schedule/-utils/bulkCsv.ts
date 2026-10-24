// CSV import/export helpers for Bulk Live-Session Scheduling.
//
// Batches are identified by `package_session_id` (the unique batch id, =
// `batch.id` in institute details). Names can repeat across courses/sessions,
// so the CSV always carries the ID; admins look IDs up via the downloadable
// "batch reference" CSV. On import we reverse-map each id back to the
// { courseId, sessionId, levelId } triple the grid's batch picker expects.

import Papa from 'papaparse';
import type { TFunction } from 'i18next';
import type { BulkSessionRow } from '../-schema/bulkSchema';

/** Minimal shape we need from `instituteDetails.batches_for_sessions`. */
export interface BatchForSessionLite {
    id: string;
    level: { id: string; level_name: string };
    session: { id: string; session_name: string };
    package_dto: { id: string; package_name: string };
}

/** Header row of the schedule template, in order. */
export const SCHEDULE_CSV_HEADERS = [
    'title',
    'subject',
    'start_date',
    'start_time',
    'duration_hours',
    'duration_minutes',
    'platform',
    'link',
    'package_session_ids',
    'teacher_emails',
    'description',
] as const;

/**
 * Headers accepted for the teacher column. `instructors` is what the template
 * shipped with first, so files downloaded before the rename keep importing.
 */
const TEACHER_HEADERS = [
    'teacher_emails',
    'teacher_email',
    'teachers',
    'teacher',
    'instructors',
    'instructor_emails',
    'instructor_email',
    'instructor',
] as const;

const REQUIRED_HEADERS = ['title', 'start_date', 'start_time'] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

// Platforms that auto-provision a meeting link, so `link` is optional for them.
const AUTO_LINK_PLATFORMS = new Set(['zoho', 'bbb']);

const triggerDownload = (content: string, filename: string) => {
    // Prepend a BOM so Excel opens UTF-8 (course names with accents) correctly.
    const blob = new Blob(['﻿', content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

/** Build + download the empty schedule template (headers + a couple examples). */
export const downloadScheduleTemplate = (batches: BatchForSessionLite[]) => {
    const exampleIds = batches.slice(0, 2).map((b) => b.id);
    const idCell = exampleIds.length
        ? exampleIds.join('|')
        : 'PASTE_PACKAGE_SESSION_ID|FROM_BATCH_REFERENCE';
    const rows = [
        {
            title: 'Algebra Recap',
            subject: 'Maths',
            start_date: '2026-06-10',
            start_time: '10:00',
            duration_hours: '1',
            duration_minutes: '0',
            platform: 'zoom',
            link: 'https://zoom.us/j/123456789',
            package_session_ids: idCell,
            teacher_emails: 'teacher@example.com|another.teacher@example.com',
            description: 'Quick revision before the test',
        },
        {
            title: 'Doubt Clearing (Vacademy Meet)',
            subject: '',
            start_date: '2026-06-11',
            start_time: '17:30',
            duration_hours: '0',
            duration_minutes: '45',
            platform: 'bbb',
            link: '',
            package_session_ids: exampleIds[0] ?? 'PASTE_PACKAGE_SESSION_ID',
            teacher_emails: '',
            description: '',
        },
    ];
    const csv = Papa.unparse({ fields: [...SCHEDULE_CSV_HEADERS], data: rows });
    triggerDownload(csv, 'live-session-bulk-template.csv');
};

/** Build + download the batch reference (every package_session_id + names). */
export const downloadBatchReference = (batches: BatchForSessionLite[]) => {
    const data = batches.map((b) => ({
        package_session_id: b.id,
        course_name: b.package_dto.package_name,
        session_name: b.session.session_name,
        level_name: b.level.level_name,
    }));
    const csv = Papa.unparse({
        fields: ['package_session_id', 'course_name', 'session_name', 'level_name'],
        data,
    });
    triggerDownload(csv, 'live-session-batch-reference.csv');
};

/**
 * Build + download the teacher reference: every staff member the teacher
 * column can name, with the email (recommended) and username that match them.
 */
export const downloadTeacherReference = (
    users: Array<{ full_name: string; email: string | null; username?: string | null; roles?: string[] }>
) => {
    const data = [...users]
        .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
        .map((u) => ({
            name: u.full_name ?? '',
            email: u.email ?? '',
            username: u.username ?? '',
            roles: (u.roles ?? []).join('|'),
        }));
    const csv = Papa.unparse({ fields: ['name', 'email', 'username', 'roles'], data });
    triggerDownload(csv, 'live-session-teacher-reference.csv');
};

/** One row's creation outcome, used to build the downloadable results report. */
export interface ScheduleResultRow {
    /** 0-based row index in the submitted grid. */
    index: number;
    title?: string;
    success: boolean;
    session_id?: string;
    error?: string;
    /** Non-fatal per-row notes (e.g. instructors that couldn't be matched). */
    warnings?: string[];
}

/**
 * Download a row-wise outcome report (one line per session) with a status and a
 * remarks column — the error message for failed rows, "Created" for successes.
 */
export const downloadResultsCsv = (results: ScheduleResultRow[], t: TFunction) => {
    const data = [...results]
        .sort((a, b) => a.index - b.index)
        .map((r) => ({
            row: r.index + 1,
            title: r.title ?? '',
            status: r.success ? t('status.success') : t('status.failed'),
            session_id: r.success ? r.session_id ?? '' : '',
            // A successful row with warnings reports them instead of a bare
            // "Created" — an instructor that didn't stick is exactly the kind of
            // thing an admin will otherwise never notice.
            remarks: r.success
                ? r.warnings?.length
                    ? r.warnings.join(' ')
                    : t('status.created')
                : r.error ?? t('status.unknownError'),
        }));
    const csv = Papa.unparse({
        fields: ['row', 'title', 'status', 'session_id', 'remarks'],
        data,
    });
    triggerDownload(csv, 'live-session-bulk-results.csv');
};

export interface ScheduleCsvRowError {
    /** 1-based data-row number (header excluded). 0 = file-level error. */
    rowNumber: number;
    title?: string;
    messages: string[];
}

export interface ScheduleCsvParseResult {
    validRows: BulkSessionRow[];
    errors: ScheduleCsvRowError[];
    /** Number of data rows seen (excludes blank lines and the header). */
    totalCount: number;
}

const cell = (row: Record<string, unknown>, key: string): string =>
    String(row[key] ?? '').trim();

/** The first non-empty cell among several accepted spellings of one column. */
const firstCell = (row: Record<string, unknown>, keys: readonly string[]): string => {
    for (const key of keys) {
        const value = cell(row, key);
        if (value) return value;
    }
    return '';
};

/**
 * Parse a schedule CSV into grid rows, validating each row and reverse-mapping
 * `package_session_ids` to the grid's `selectedLevels`. Invalid rows are
 * collected in `errors` (and skipped from `validRows`) so the caller can show a
 * summary and import only the good ones.
 */
export const parseScheduleCsv = (
    file: File,
    opts: { batches: BatchForSessionLite[]; allowedPlatforms: string[] },
    t: TFunction
): Promise<ScheduleCsvParseResult> => {
    const batchById = new Map(opts.batches.map((b) => [b.id, b]));
    const allowed = new Set(opts.allowedPlatforms.map((p) => p.toLowerCase()));

    return new Promise((resolve) => {
        Papa.parse<Record<string, unknown>>(file, {
            header: true,
            skipEmptyLines: 'greedy',
            transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
            complete: (results) => {
                const fields = (results.meta.fields ?? []).map((f) => f);
                const missing = REQUIRED_HEADERS.filter((h) => !fields.includes(h));
                if (missing.length) {
                    resolve({
                        validRows: [],
                        totalCount: results.data.length,
                        errors: [
                            {
                                rowNumber: 0,
                                messages: [
                                    t('errors.missingColumns', { columns: missing.join(', ') }),
                                ],
                            },
                        ],
                    });
                    return;
                }

                const validRows: BulkSessionRow[] = [];
                const errors: ScheduleCsvRowError[] = [];

                results.data.forEach((raw, i) => {
                    const rowNumber = i + 1;
                    const messages: string[] = [];

                    const title = cell(raw, 'title');
                    const subject = cell(raw, 'subject');
                    const startDate = cell(raw, 'start_date');
                    const startTime = cell(raw, 'start_time');
                    const durationHours = cell(raw, 'duration_hours') || '1';
                    const durationMinutes = cell(raw, 'duration_minutes') || '0';
                    const platform = (cell(raw, 'platform') || 'other').toLowerCase();
                    const link = cell(raw, 'link');
                    const description = cell(raw, 'description');

                    if (!title) messages.push(t('errors.titleRequired'));
                    if (!startDate) messages.push(t('errors.startDateRequired'));
                    else if (!DATE_RE.test(startDate))
                        messages.push(t('errors.invalidStartDate'));
                    if (!startTime) messages.push(t('errors.startTimeRequired'));
                    else if (!TIME_RE.test(startTime))
                        messages.push(t('errors.invalidStartTime'));

                    const h = parseInt(durationHours, 10);
                    const m = parseInt(durationMinutes, 10);
                    if ((isNaN(h) ? 0 : h) === 0 && (isNaN(m) ? 0 : m) === 0)
                        messages.push(t('errors.durationRequired'));

                    if (allowed.size && !allowed.has(platform))
                        messages.push(
                            t('errors.unknownPlatform', {
                                platform,
                                allowed: opts.allowedPlatforms.join(', '),
                            })
                        );

                    if (!AUTO_LINK_PLATFORMS.has(platform)) {
                        if (!link)
                            messages.push(t('errors.linkRequired', { platform }));
                        else {
                            try {
                                new URL(link);
                            } catch {
                                messages.push(t('errors.invalidLink'));
                            }
                        }
                    }

                    const selectedLevels: BulkSessionRow['selectedLevels'] = [];
                    const idsCell = cell(raw, 'package_session_ids');
                    if (idsCell) {
                        const ids = idsCell
                            .split(/[|;\n]+/)
                            .map((s) => s.trim())
                            .filter(Boolean);
                        for (const id of ids) {
                            const b = batchById.get(id);
                            if (!b) {
                                messages.push(t('errors.unknownBatchId', { id }));
                                continue;
                            }
                            selectedLevels.push({
                                courseId: b.package_dto.id,
                                sessionId: b.session.id,
                                levelId: b.level.id,
                            });
                        }
                    }

                    // Teachers: email (recommended), username or user id,
                    // separated by | ; or , (none of which can appear in an
                    // email or username). Deliberately NOT validated here:
                    // the grid matches them against the staff directory and
                    // flags what matched nobody on the row itself. Failing a
                    // whole row over one mistyped email would cost the admin
                    // the import.
                    const instructorsCell = firstCell(raw, TEACHER_HEADERS);
                    const instructorIdentifiers = instructorsCell
                        ? Array.from(
                              new Set(
                                  instructorsCell
                                      .split(/[|;,\n]+/)
                                      .map((v) => v.trim())
                                      .filter(Boolean)
                              )
                          )
                        : [];

                    if (messages.length) {
                        errors.push({ rowNumber, title: title || undefined, messages });
                        return;
                    }

                    validRows.push({
                        title,
                        subject,
                        startDate,
                        startTime,
                        durationHours,
                        durationMinutes,
                        platform,
                        link,
                        description,
                        selectedLevels,
                        instructorIdentifiers,
                    });
                });

                resolve({ validRows, errors, totalCount: results.data.length });
            },
            error: (error) => {
                resolve({
                    validRows: [],
                    totalCount: 0,
                    errors: [
                        { rowNumber: 0, messages: [error.message || t('errors.failedToReadCsv')] },
                    ],
                });
            },
        });
    });
};
