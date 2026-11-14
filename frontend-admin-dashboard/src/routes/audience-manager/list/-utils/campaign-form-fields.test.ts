import { describe, expect, it } from 'vitest';
import { configHoldsOptions, isOptionFieldType, parseFieldOptions } from './parseFieldOptions';
import {
    convertExistingCustomFields,
    convertFieldsToPayload,
    mapApiFieldTypeToUi,
    mapFieldTypeToPayload,
    nextFieldId,
    withUniqueFieldIds,
} from './campaignFormFields';

const INSTITUTE = 'inst-1';

/**
 * First converted field, asserted present. `convertExistingCustomFields` returns
 * `null` for an empty input and its elements are index-access checked, so the
 * assertion belongs in one place rather than at every call site.
 */
const firstField = (converted: ReturnType<typeof convertExistingCustomFields>) => {
    const field = converted?.[0];
    if (!field) throw new Error('expected at least one converted field');
    return field;
};

/** One field as the campaign API returns it. */
const apiField = (over: Record<string, unknown> = {}) => ({
    id: 'map-1',
    institute_id: INSTITUTE,
    type: 'AUDIENCE_FORM',
    type_id: 'aud-1',
    individual_order: 0,
    status: 'ACTIVE',
    custom_field: {
        id: 'cf-1',
        fieldKey: 'how_did_you_hear',
        fieldName: 'How did you hear about us',
        fieldType: 'DROPDOWN',
        formOrder: 7,
        isMandatory: true,
        config: JSON.stringify([
            { id: 1, value: 'SOCIAL MEDIA', label: 'SOCIAL MEDIA' },
            { id: 2, value: 'FRIEND', label: 'FRIEND' },
        ]),
    },
    ...over,
});

describe('parseFieldOptions', () => {
    it('reads the JSON array the builder writes', () => {
        expect(
            parseFieldOptions('[{"id":1,"value":"A","label":"A"},{"id":2,"value":"B","label":"B"}]')
        ).toEqual(['A', 'B']);
    });

    it('reads the legacy comma-separated shapes', () => {
        expect(parseFieldOptions('{"coommaSepartedOptions":"A,B,C"}')).toEqual(['A', 'B', 'C']);
        expect(parseFieldOptions('A, B ,C')).toEqual(['A', 'B', 'C']);
    });

    it('reads options nested under an object', () => {
        expect(parseFieldOptions('{"options":[{"value":"A"},{"value":"B"}]}')).toEqual(['A', 'B']);
    });

    it('never splits a JSON blob into fragments', () => {
        const options = parseFieldOptions(
            '[{"id":1,"value":"SOCIAL MEDIA","label":"SOCIAL MEDIA"}]'
        );
        expect(options).toEqual(['SOCIAL MEDIA']);
        expect(options.some((o) => o.includes('{') || o.includes('"id"'))).toBe(false);
    });

    it('returns nothing for a settings config or empty input', () => {
        expect(parseFieldOptions('{"helpText":"hi","maxSizeMB":5}')).toEqual([]);
        expect(parseFieldOptions('')).toEqual([]);
        expect(parseFieldOptions(undefined)).toEqual([]);
    });
});

describe('configHoldsOptions', () => {
    it('separates an option list from field settings', () => {
        expect(configHoldsOptions('[{"value":"A"}]')).toBe(true);
        expect(configHoldsOptions('{"coommaSepartedOptions":"A,B"}')).toBe(true);
        expect(configHoldsOptions('A,B')).toBe(true);
        expect(configHoldsOptions('{"helpText":"hi"}')).toBe(false);
        expect(configHoldsOptions('{"allowedFileTypes":["pdf"],"maxSizeMB":5}')).toBe(false);
        expect(configHoldsOptions('')).toBe(false);
    });
});

describe('isOptionFieldType', () => {
    it('covers every choice type, multi-select included', () => {
        ['dropdown', 'DROPDOWN', 'radio', 'multi_select', 'select'].forEach((t) =>
            expect(isOptionFieldType(t)).toBe(true)
        );
        ['text', 'textarea', 'checkbox', 'file', 'date', undefined].forEach((t) =>
            expect(isOptionFieldType(t)).toBe(false)
        );
    });
});

describe('field type mapping', () => {
    it('keeps a text area distinct from a text field', () => {
        expect(mapFieldTypeToPayload('textarea')).toBe('TEXTAREA');
        expect(mapFieldTypeToPayload('text')).toBe('TEXT');
        expect(mapApiFieldTypeToUi('TEXTAREA')).toBe('textarea');
    });

    it('round-trips every type the picker offers', () => {
        const uiTypes = [
            'text',
            'textarea',
            'dropdown',
            'radio',
            'multi_select',
            'checkbox',
            'number',
            'email',
            'url',
            'date',
            'phone',
            'file',
        ];
        uiTypes.forEach((type) => {
            expect(mapApiFieldTypeToUi(mapFieldTypeToPayload(type))).toBe(type);
        });
    });
});

describe('convertExistingCustomFields', () => {
    it('shows a dropdown with its real options, not JSON fragments', () => {
        const field = firstField(convertExistingCustomFields([apiField()]));
        expect(field.type).toBe('dropdown');
        expect(field.options?.map((o) => o.value)).toEqual(['SOCIAL MEDIA', 'FRIEND']);
    });

    it('orders by the per-form individual_order, not the shared catalog order', () => {
        const fields = convertExistingCustomFields([
            apiField({
                id: 'map-a',
                individual_order: 2,
                custom_field: {
                    ...apiField().custom_field,
                    id: 'cf-a',
                    fieldName: 'Third',
                    formOrder: 1,
                },
            }),
            apiField({
                id: 'map-b',
                individual_order: 0,
                custom_field: {
                    ...apiField().custom_field,
                    id: 'cf-b',
                    fieldName: 'First',
                    formOrder: 9,
                },
            }),
            apiField({
                id: 'map-c',
                individual_order: 1,
                custom_field: {
                    ...apiField().custom_field,
                    id: 'cf-c',
                    fieldName: 'Second',
                    formOrder: 5,
                },
            }),
        ])!;
        expect(fields.map((f) => f.name)).toEqual(['First', 'Second', 'Third']);
        expect(fields.map((f) => f.order)).toEqual([0, 1, 2]);
    });

    it('does not attach options to a field that is no longer a choice type', () => {
        const field = firstField(convertExistingCustomFields([
            apiField({ custom_field: { ...apiField().custom_field, fieldType: 'TEXT' } }),
        ]));
        expect(field.type).toBe('text');
        expect(field.options).toBeUndefined();
    });
});

describe('convertFieldsToPayload', () => {
    it('sends the edited type and options for a field that already exists', () => {
        const field = firstField(convertExistingCustomFields([
            apiField({
                custom_field: { ...apiField().custom_field, fieldType: 'TEXT', config: '' },
            }),
        ]));

        // The admin switches the field to a multi-select and adds options.
        const edited = {
            ...field,
            type: 'multi_select',
            options: [
                { id: '0', value: 'Email' },
                { id: '1', value: 'SMS' },
            ],
        };

        const [payload] = convertFieldsToPayload([edited], INSTITUTE);
        expect(payload.custom_field.id).toBe('cf-1');
        expect(payload.custom_field.fieldType).toBe('MULTI_SELECT');
        expect(JSON.parse(payload.custom_field.config)).toEqual([
            { id: 1, value: 'Email', label: 'Email' },
            { id: 2, value: 'SMS', label: 'SMS' },
        ]);
    });

    it('drops a stale option list when the field stops being a choice type', () => {
        const field = firstField(convertExistingCustomFields([apiField()]));
        const [payload] = convertFieldsToPayload(
            [{ ...field, type: 'text', options: undefined }],
            INSTITUTE
        );
        expect(payload.custom_field.fieldType).toBe('TEXT');
        expect(payload.custom_field.config).toBe('');
    });

    it('keeps a settings config that is not an option list', () => {
        const settings = '{"helpText":"Upload your CV","maxSizeMB":5}';
        const field = firstField(convertExistingCustomFields([
            apiField({
                custom_field: { ...apiField().custom_field, fieldType: 'FILE', config: settings },
            }),
        ]));
        const [payload] = convertFieldsToPayload([field], INSTITUTE);
        expect(payload.custom_field.config).toBe(settings);
    });

    it('writes a dense 0..n-1 order taken from the on-screen position', () => {
        const fields = convertExistingCustomFields([
            apiField({
                id: 'm1',
                individual_order: 0,
                custom_field: { ...apiField().custom_field, id: 'cf-1' },
            }),
            apiField({
                id: 'm2',
                individual_order: 1,
                custom_field: { ...apiField().custom_field, id: 'cf-2' },
            }),
            apiField({
                id: 'm3',
                individual_order: 2,
                custom_field: { ...apiField().custom_field, id: 'cf-3' },
            }),
        ])!;

        // The middle field is deleted, so the survivors must close the gap
        // rather than keep their old 0 / 2 positions.
        const remaining = fields.filter((f) => f.custom_field_data.id !== 'cf-2');
        const payload = convertFieldsToPayload(remaining, INSTITUTE);
        expect(payload.map((p) => p.individual_order)).toEqual([0, 1]);
        expect(payload.map((p) => p.custom_field.individualOrder)).toEqual([0, 1]);
    });

    it('carries the required flag on the mapping as well as the field', () => {
        const field = firstField(convertExistingCustomFields([apiField()]));
        const [payload] = convertFieldsToPayload([{ ...field, isRequired: false }], INSTITUTE);
        expect(payload.is_mandatory).toBe(false);
        expect(payload.custom_field.isMandatory).toBe(false);
    });
});

describe('withUniqueFieldIds — every editor row needs its own id', () => {
    it('leaves already-unique ids, and the row objects, untouched', () => {
        const rows = [{ id: 'map-1' }, { id: 'map-2' }, { id: '7' }];
        const out = withUniqueFieldIds(rows);
        expect(out.map((row) => row.id)).toEqual(['map-1', 'map-2', '7']);
        out.forEach((row, index) => expect(row).toBe(rows[index]));
    });

    it('re-ids a repeat, keeping the first holder', () => {
        // A default field at list index 0 and the Full Name seed both carry '0'.
        const out = withUniqueFieldIds([
            { id: '0', name: 'Course' },
            { id: '0', name: 'Full Name' },
            { id: '2', name: 'Phone Number' },
        ]);
        expect(out.map((row) => row.name)).toEqual(['Course', 'Full Name', 'Phone Number']);
        expect(out.map((row) => row.id).slice(0, 1)).toEqual(['0']);
        expect(new Set(out.map((row) => row.id)).size).toBe(3);
    });

    it('fills blank ids and never reuses one already taken', () => {
        const out = withUniqueFieldIds([{ id: 'local-0' }, { id: '' }, {}, { id: 'local-0' }]);
        expect(out.map((row) => row.id).slice(0, 1)).toEqual(['local-0']);
        expect(new Set(out.map((row) => row.id)).size).toBe(4);
    });
});

describe('nextFieldId', () => {
    it('is the list length when that is free — the old behaviour', () => {
        expect(nextFieldId([{ id: '0' }, { id: '1' }])).toBe('2');
        expect(nextFieldId([])).toBe('0');
        expect(nextFieldId(undefined)).toBe('0');
    });

    it('skips past an id a row already holds', () => {
        expect(nextFieldId([{ id: '0' }, { id: '2' }])).toBe('3');
        expect(nextFieldId([{ id: '2' }, { id: '3' }])).toBe('4');
    });
});
