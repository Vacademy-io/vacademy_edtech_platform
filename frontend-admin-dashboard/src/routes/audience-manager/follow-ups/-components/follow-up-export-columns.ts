/**
 * One CSV shape for all four follow-up queues.
 *
 * The reporting team reads the export without the app next to them, so a row has
 * to answer "who owns this lead, where is it in the pipeline, how warm is it, and
 * what did the counsellor actually say" on its own. It used to carry six columns
 * — name, email, phone, source, status, due date — and none of the four they
 * asked for.
 *
 * The course column is NOT special-cased. Every custom field the institute has
 * configured becomes a column, so the institute that calls its field "Courses"
 * gets a Courses column and one that calls it something else gets that instead,
 * with no institute id anywhere in this file.
 */
import type { CustomFieldSetupItem } from '@/routes/audience-manager/list/-services/get-custom-field-setup';
import type { RecentLeadDetail } from '@/routes/audience-manager/list/-services/get-recent-leads';
import type { CompletedFollowUp } from '../-services/get-completed-follow-ups';

/**
 * Fields that already have a dedicated column. Matched on field_key, which is
 * stable; field_name is whatever the institute typed.
 */
const IDENTITY_FIELD_KEYS = new Set(['full_name', 'email', 'phone', 'phone_number']);

export interface ExportCustomField {
    id: string;
    label: string;
}

/**
 * The custom-field columns for this institute, in form order. Hidden fields and
 * the identity fields are left out; duplicates by id are collapsed, because the
 * setup lists one row per audience form and an institute with 26 lists repeats
 * the same field 26 times.
 */
export const exportCustomFields = (
    setup: CustomFieldSetupItem[] | undefined
): ExportCustomField[] => {
    const seen = new Set<string>();
    const out: ExportCustomField[] = [];
    for (const field of [...(setup ?? [])].sort(
        (a, b) => (a.form_order ?? 0) - (b.form_order ?? 0)
    )) {
        if (!field.custom_field_id || seen.has(field.custom_field_id)) continue;
        if (field.is_hidden) continue;
        if (IDENTITY_FIELD_KEYS.has(field.field_key)) continue;
        seen.add(field.custom_field_id);
        out.push({ id: field.custom_field_id, label: field.field_name || field.field_key });
    }
    return out;
};

/** The fixed column titles, as the page's i18n namespace renders them. */
export interface ExportColumnLabels {
    name: string;
    email: string;
    phone: string;
    source: string;
    leadOwner: string;
    status: string;
    interestLevel: string;
    dueAt: string;
    followUpNote: string;
    studentResponse: string;
    followUpMode: string;
    nextAction: string;
}

/** Column titles, in order: the fixed ones, then one per custom field. */
export const buildExportHeader = (
    labels: ExportColumnLabels,
    customFields: ExportCustomField[]
): string[] => [
    labels.name,
    labels.email,
    labels.phone,
    labels.source,
    labels.leadOwner,
    labels.status,
    labels.interestLevel,
    labels.dueAt,
    labels.followUpNote,
    labels.studentResponse,
    labels.followUpMode,
    labels.nextAction,
    ...customFields.map((f) => f.label),
];

const cell = (value: string | null | undefined): string => value ?? '';

/** A lead row from the pending / overdue / today queues. */
export const leadToExportRow = (
    lead: RecentLeadDetail,
    name: string,
    email: string,
    phone: string,
    source: string,
    customFields: ExportCustomField[]
): string[] => [
    name,
    email,
    phone,
    source,
    cell(lead.assigned_counselor_name),
    cell(lead.lead_status),
    cell(lead.lead_tier),
    cell(lead.follow_up_due_at ?? lead.tat_due_at),
    cell(lead.follow_up_content),
    cell(lead.follow_up_student_response),
    cell(lead.follow_up_mode),
    cell(lead.follow_up_next_action),
    ...customFields.map((f) => cell(lead.custom_field_values?.[f.id])),
];

/**
 * A closed follow-up. Same columns; "due at" is the time the call was scheduled
 * for, and the closing reason is appended to the note so nothing the counsellor
 * typed is dropped.
 */
export const completedToExportRow = (
    row: CompletedFollowUp,
    customFields: ExportCustomField[]
): string[] => [
    cell(row.lead_name),
    cell(row.lead_email),
    cell(row.lead_mobile),
    cell(row.lead_source),
    cell(row.assigned_counselor_name),
    cell(row.lead_status),
    cell(row.lead_tier),
    cell(row.schedule_time),
    [row.content, row.closer_reason].filter(Boolean).join(' — '),
    cell(row.student_response),
    cell(row.follow_up_mode),
    cell(row.next_action),
    ...customFields.map((f) => cell(row.custom_field_values?.[f.id])),
];
