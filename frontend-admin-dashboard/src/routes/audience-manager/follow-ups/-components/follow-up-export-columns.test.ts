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
    activityNotes: 'Activity & Notes',
    leadJourney: 'Lead Journey',
    followUpHistory: 'Follow-up history',
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
        expect(header).toHaveLength(16);
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
            '',
            '',
            '',
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
        expect(row[15]).toBe('ADCT OFFLINE PUNE');
    });

    // The table's Activity column was on screen but not in the CSV.
    it('carries the Activity & Notes and lead journey the table shows', () => {
        const note = {
            id: 'n1',
            action_type: 'NOTE',
            title: 'Note',
            description: '<p>CNR, call tomorrow</p>',
            actor_name: 'Simran',
            created_at: '2026-10-27T09:21:00Z',
        };
        const status = {
            ...note,
            id: 's1',
            title: 'Status changed',
            description: 'New → Call Back',
        };
        const header = buildExportHeader(LABELS, fields);
        const row = leadToExportRow({}, 'Asha', '', '', '', fields, {
            notes: { recent: [note], count: 1 },
            journey: [status, note],
        });
        const notesCell = row[header.indexOf('Activity & Notes')]!;
        const journeyCell = row[header.indexOf('Lead Journey')]!;
        expect(notesCell).toContain('Note: CNR, call tomorrow (Simran)');
        expect(notesCell).not.toContain('<p>');
        expect(journeyCell.split('\n')).toHaveLength(2);
        expect(journeyCell).toContain('Status changed: New → Call Back (Simran)');

        const done = completedToExportRow({ lead_user_id: 'u9' } as CompletedFollowUp, fields, {
            notes: { recent: [note], count: 1 },
        });
        expect(done[header.indexOf('Activity & Notes')]).toContain('CNR, call tomorrow');
    });

    // Leads migrated from an old CRM have no timeline; their notes are the follow-ups.
    it('carries every follow-up and what the counsellor wrote on it', () => {
        const header = buildExportHeader(LABELS, fields);
        const row = leadToExportRow({}, 'Asha', '', '', '', fields, {
            followUps: [
                {
                    id: 'f1',
                    audience_response_id: 'ar1',
                    status: 'COMPLETED',
                    created_at: '2026-10-13T03:58:00Z',
                    schedule_time: '2026-10-13T10:57:00Z',
                    content: '<p>cnr, msg done</p>',
                    student_response: 'CNR (Call not Receive)',
                    follow_up_mode: 'Telephonic Call',
                    next_action: 'Send Course Details',
                    closer_reason: 'will let us know',
                    created_by_name: 'Simran',
                },
                {
                    id: 'f2',
                    audience_response_id: 'ar1',
                    status: 'OVERDUE',
                    created_at: '2026-10-14T03:58:00Z',
                    // Old-CRM "no date".
                    schedule_time: '1970-01-01T00:00:00Z',
                    content: 'call later',
                },
            ],
        });
        const lines = row[header.indexOf('Follow-up history')]!.split('\n');
        expect(lines).toHaveLength(2);
        expect(lines[0]).toContain('· due ');
        expect(lines[0]).toContain(
            'COMPLETED: cnr, msg done | Response: CNR (Call not Receive) | Mode: Telephonic Call | Next: Send Course Details | Closed: will let us know (Simran)'
        );
        expect(lines[1]).not.toContain('due');
        expect(lines[1]).toContain('OVERDUE: call later');
    });

    it('writes an empty cell, never "undefined", for anything the lead has not got', () => {
        const row = leadToExportRow({}, 'Asha', '', '', '', fields);
        expect(row.every((c) => typeof c === 'string')).toBe(true);
        expect(row).not.toContain(undefined);
        expect(row.slice(4).every((c) => c === '')).toBe(true);
    });
});
