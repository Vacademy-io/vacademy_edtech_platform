/**
 * The follow-up CSV shape.
 *
 * The reporting team asked for four columns the export did not have — lead owner,
 * lead status, interest level and the course — plus whatever the counsellor wrote
 * on the follow-up. The course is the interesting one: it is a custom field, so
 * naming it here (or keying off an institute id) would give exactly one institute
 * a course column and leave every other one broken. These tests pin that it comes
 * from the institute's own configured fields instead.
 */
import { describe, it, expect } from 'vitest';
import {
    buildExportHeader,
    completedToExportRow,
    exportCustomFields,
    leadToExportRow,
    type ExportColumnLabels,
} from './follow-up-export-columns';
import type { CustomFieldSetupItem } from '@/routes/audience-manager/list/-services/get-custom-field-setup';
import type { RecentLeadDetail } from '@/routes/audience-manager/list/-services/get-recent-leads';
import type { CompletedFollowUp } from '../-services/get-completed-follow-ups';

const field = (over: Partial<CustomFieldSetupItem>): CustomFieldSetupItem => ({
    custom_field_id: 'cf-1',
    field_key: 'applied_for',
    field_name: 'Courses',
    field_type: 'dropdown',
    form_order: 3,
    ...over,
});

const LABELS: ExportColumnLabels = {
    name: 'Lead name',
    email: 'Email',
    phone: 'Phone',
    source: 'Source',
    leadOwner: 'Lead owner',
    status: 'Status',
    interestLevel: 'Interest level',
    dueAt: 'Due at',
    followUpNote: 'Follow-up note',
    studentResponse: 'Student response',
    followUpMode: 'Follow-up mode',
    nextAction: 'Next action',
};

describe('exportCustomFields', () => {
    it("turns the institute's own fields into columns, in form order", () => {
        const fields = exportCustomFields([
            field({
                custom_field_id: 'cf-branch',
                field_key: 'branch',
                field_name: 'Branch',
                form_order: 6,
            }),
            field({ custom_field_id: 'cf-course', field_name: 'Courses', form_order: 3 }),
        ]);
        expect(fields.map((f) => f.label)).toEqual(['Courses', 'Branch']);
    });

    // The setup lists one row per audience form, so an institute with 26 lists
    // repeats the same field 26 times and the CSV would get 26 Courses columns.
    it('collapses a field that the setup repeats once per audience form', () => {
        const fields = exportCustomFields([field({}), field({}), field({})]);
        expect(fields).toEqual([{ id: 'cf-1', label: 'Courses' }]);
    });

    it('leaves out hidden fields', () => {
        const fields = exportCustomFields([
            field({ custom_field_id: 'cf-hidden', field_name: 'Select Branch', is_hidden: true }),
        ]);
        expect(fields).toEqual([]);
    });

    // Name / email / phone already have dedicated columns.
    it.each(['full_name', 'email', 'phone', 'phone_number'])(
        'leaves out the identity field %s, which is already its own column',
        (field_key) => {
            expect(exportCustomFields([field({ field_key })])).toEqual([]);
        }
    );

    it('is empty, not broken, when the institute has configured nothing', () => {
        expect(exportCustomFields(undefined)).toEqual([]);
        expect(exportCustomFields([])).toEqual([]);
    });
});

describe('buildExportHeader', () => {
    it('carries the four columns the reporting team asked for', () => {
        const header = buildExportHeader(LABELS, []);
        expect(header).toContain('Lead owner');
        expect(header).toContain('Status');
        expect(header).toContain('Interest level');
        expect(header).toContain('Follow-up note');
    });

    it('appends one column per custom field, so a Courses field becomes a Courses column', () => {
        const header = buildExportHeader(LABELS, [{ id: 'cf-course', label: 'Courses' }]);
        expect(header[header.length - 1]).toBe('Courses');
        expect(header).toHaveLength(13);
    });
});

describe('rows line up with the header', () => {
    const fields = [{ id: 'cf-course', label: 'Courses' }];

    it('a pending/overdue/today row', () => {
        const lead: RecentLeadDetail = {
            assigned_counselor_name: 'Aparna Gaikwad',
            lead_status: 'Call Back',
            lead_tier: 'WARM',
            follow_up_due_at: '2026-10-08T06:30:00',
            follow_up_content: 'CNR, sent WhatsApp',
            follow_up_student_response: 'Not reachable',
            follow_up_mode: 'CALL',
            follow_up_next_action: 'Call again',
            custom_field_values: { 'cf-course': 'ADCT OFFLINE PUNE' },
        };
        const row = leadToExportRow(lead, 'Asha', 'a@x.com', '9000000000', 'Facebook', fields);
        expect(row).toHaveLength(buildExportHeader(LABELS, fields).length);
        expect(row).toEqual([
            'Asha',
            'a@x.com',
            '9000000000',
            'Facebook',
            'Aparna Gaikwad',
            'Call Back',
            'WARM',
            '2026-10-08T06:30:00',
            'CNR, sent WhatsApp',
            'Not reachable',
            'CALL',
            'Call again',
            'ADCT OFFLINE PUNE',
        ]);
    });

    it('a completed row, which is a closed follow-up and not a lead', () => {
        const done: CompletedFollowUp = {
            id: 'f1',
            audience_response_id: 'ar1',
            schedule_time: '2026-10-06T06:30:00',
            closed_at: '2026-10-06T08:00:00',
            closed_by: 'u1',
            closer_reason: 'Not interested',
            content: 'Spoke, wants next batch',
            student_response: 'Interested later',
            follow_up_mode: 'CALL',
            next_action: 'Send fee structure',
            lead_name: 'Asha',
            lead_mobile: '9000000000',
            lead_user_id: 'u9',
            lead_email: 'a@x.com',
            lead_source: 'Facebook',
            lead_status: 'Call Back',
            lead_tier: 'WARM',
            assigned_counselor_name: 'Aparna Gaikwad',
            custom_field_values: { 'cf-course': 'ADCT OFFLINE PUNE' },
        };
        const row = completedToExportRow(done, fields);
        expect(row).toHaveLength(buildExportHeader(LABELS, fields).length);
        // Nothing the counsellor typed is dropped: the note and the closing reason
        // both land in the note column.
        expect(row[8]).toBe('Spoke, wants next batch — Not interested');
        expect(row[4]).toBe('Aparna Gaikwad');
        expect(row[12]).toBe('ADCT OFFLINE PUNE');
    });

    it('writes an empty cell, never "undefined", for anything the lead has not got', () => {
        const row = leadToExportRow({}, 'Asha', '', '', '', fields);
        expect(row.every((c) => typeof c === 'string')).toBe(true);
        expect(row).not.toContain(undefined);
        expect(row.slice(4).every((c) => c === '')).toBe(true);
    });
});
