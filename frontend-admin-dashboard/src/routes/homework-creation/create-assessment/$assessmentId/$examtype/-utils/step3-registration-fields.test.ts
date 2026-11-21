import { describe, expect, it } from 'vitest';
import {
    convertDataToStep3,
    convertToCustomFieldsData,
    getCustomFieldsWhileEditStep3,
} from './helper';

const savedField = (id: string, name: string, key: string, order: number) => ({
    id,
    field_name: name,
    field_key: key,
    field_type: 'textfield',
    is_mandatory: true,
    comma_separated_options: '',
    field_order: order,
    status: 'ACTIVE',
    created_at: '2026-10-01T05:25:02Z',
    updated_at: '2026-10-01T05:25:02Z',
});

const notify = {
    when_assessment_created: false,
    before_assessment_goes_live: { checked: false, value: '' },
    when_assessment_live: false,
    when_assessment_report_generated: false,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const formWith = (customFields: any[]): any => ({
    status: 'COMPLETE',
    closed_test: false,
    open_test: {
        checked: true,
        start_date: '2026-10-01T10:54',
        end_date: '2030-12-01T10:54',
        instructions: '',
        custom_fields: customFields,
    },
    select_batch: { checked: true, batch_details: {} },
    select_individually: { checked: false, student_details: [] },
    join_link: 'https://learner.example.com/register?code=123456',
    show_leaderboard: false,
    notify_student: notify,
    notify_parent: notify,
});

describe('homework edit — registration form built-ins', () => {
    it('saves the Full Name / Email / Phone rows the editor shows, under their canonical names', () => {
        const saved = [
            savedField('a', 'Branch', 'branch', 3),
            savedField('b', 'Semester', 'semester', 4),
        ];
        const steps = { 2: { saved_data: { registration_form_fields: saved } } };
        const shown = getCustomFieldsWhileEditStep3(
            steps as unknown as Parameters<typeof getCustomFieldsWhileEditStep3>[0]
        );
        const old = formWith(convertToCustomFieldsData(saved));
        const form = convertDataToStep3(old, formWith(shown)).open_test_details
            .registration_form_details;

        expect(
            form.added_custom_added_fields.map((f) => [f.name, f.is_mandatory, f.order_field])
        ).toEqual([
            ['Full Name', true, 0],
            ['Email', true, 1],
            ['Phone Number', true, 2],
        ]);
        expect(form.updated_custom_added_fields).toEqual([]);
        expect(form.removed_custom_added_fields).toEqual([]);
    });
});
