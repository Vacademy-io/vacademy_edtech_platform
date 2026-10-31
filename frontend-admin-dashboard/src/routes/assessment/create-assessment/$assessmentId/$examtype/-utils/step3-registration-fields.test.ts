import { describe, expect, it } from 'vitest';
import { convertDataToStep3, convertToCustomFieldsData } from './helper';
import { diffBaseForSave, withMissingBuiltInFieldsOnTop } from './step3-registration-fields';

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

// A public assessment saved with custom fields only and no built-ins (positions 3-6).
const codingPractice2 = [
    savedField('a', 'School/College', 'school/college', 3),
    savedField('b', 'Branch', 'branch', 4),
    savedField('c', 'Stream', 'stream', 5),
    savedField('d', 'Semester', 'semester', 6),
];

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

/** What the edit screen does: load saved + missing built-ins, diff an open test against what is saved. */
const openEditForm = (saved: ReturnType<typeof savedField>[], isOpenTest = true) => {
    const shown = withMissingBuiltInFieldsOnTop(convertToCustomFieldsData(saved));
    const loaded = formWith(structuredClone(shown));
    const old = diffBaseForSave(loaded, convertToCustomFieldsData(saved), isOpenTest);
    return { shown, old };
};

describe('assessment edit — registration form built-ins', () => {
    it('saves the Full Name / Email / Phone rows the editor shows on a form that lacks them', () => {
        const { shown, old } = openEditForm(codingPractice2);
        const diff = convertDataToStep3(old, formWith(shown));
        const form = diff.open_test_details.registration_form_details;

        expect(
            form.added_custom_added_fields.map((f) => [f.name, f.is_mandatory, f.order_field])
        ).toEqual([
            ['Full Name', true, 0],
            ['Email', true, 1],
            ['Phone Number', true, 2],
        ]);
        // Already below them at 3-6, so the saved fields are left alone.
        expect(form.updated_custom_added_fields).toEqual([]);
        expect(form.removed_custom_added_fields).toEqual([]);
    });

    it('moves a form that started at order 0 below the new rows instead of tying with them', () => {
        const saved = [
            savedField('a', 'College', 'college', 0),
            savedField('b', 'Email', 'email', 1),
        ];
        const { shown, old } = openEditForm(saved);
        const form = convertDataToStep3(old, formWith(shown)).open_test_details
            .registration_form_details;
        expect(form.added_custom_added_fields.map((f) => [f.name, f.order_field])).toEqual([
            ['Full Name', 0],
            ['Phone Number', 1],
        ]);
        expect(form.updated_custom_added_fields.map((f) => [f.id, f.order_field])).toEqual([
            ['a', 2],
            ['b', 3],
        ]);
    });

    it('adds only the missing one, never a second copy of a renamed built-in', () => {
        const saved = [savedField('a', 'Name', 'name', 0), savedField('b', 'E-mail', 'e-mail', 1)];
        const { shown, old } = openEditForm(saved);
        const added = convertDataToStep3(old, formWith(shown)).open_test_details
            .registration_form_details.added_custom_added_fields;
        expect(added.map((f) => f.name)).toEqual(['Phone Number']);
    });

    it('leaves a complete form untouched — nothing added, nothing reordered', () => {
        const saved = [
            savedField('a', 'Full Name', 'full_name', 0),
            savedField('b', 'Email', 'email', 1),
            savedField('c', 'Phone Number', 'phone_number', 2),
            savedField('d', 'Branch', 'branch', 3),
        ];
        const { shown, old } = openEditForm(saved);
        const form = convertDataToStep3(old, formWith(shown)).open_test_details
            .registration_form_details;
        expect(form.added_custom_added_fields).toEqual([]);
        expect(form.updated_custom_added_fields).toEqual([]);
        expect(form.removed_custom_added_fields).toEqual([]);
    });

    it('sends nothing for a built-in row the admin deletes before saving', () => {
        const { shown, old } = openEditForm(codingPractice2);
        const withoutPhone = shown.filter((f) => f.key !== 'phone_number');
        const form = convertDataToStep3(old, formWith(withoutPhone)).open_test_details
            .registration_form_details;
        expect(form.added_custom_added_fields.map((f) => f.name)).toEqual(['Full Name', 'Email']);
        expect(form.removed_custom_added_fields).toEqual([]);
    });

    it('adds nothing to a closed test, which has no registration page', () => {
        const { shown, old } = openEditForm([], false);
        const closed = { ...formWith(shown), closed_test: true };
        closed.open_test.checked = false;
        const form = convertDataToStep3(old, closed).open_test_details.registration_form_details;
        expect(form.added_custom_added_fields).toEqual([]);
        expect(form.updated_custom_added_fields).toEqual([]);
        expect(form.removed_custom_added_fields).toEqual([]);
    });

    it('adds the built-ins when a closed test is switched to open in the same edit', () => {
        const { shown, old } = openEditForm([], true);
        const form = convertDataToStep3(old, formWith(shown)).open_test_details
            .registration_form_details;
        expect(form.added_custom_added_fields.map((f) => f.name)).toEqual([
            'Full Name',
            'Email',
            'Phone Number',
        ]);
    });
});
