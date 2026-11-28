import { describe, expect, it } from 'vitest';
import {
    isBuiltInRegistrationField,
    withBuiltInRegistrationFields,
} from '@/components/common/custom-fields/builtin-registration-fields';

interface Seeded {
    label: string;
    type: string;
    required: boolean;
}

const topUp = (fields: Seeded[]) =>
    withBuiltInRegistrationFields<Seeded>(
        fields,
        (field) => ({ label: field.label, type: field.type }),
        (builtIn) => ({ label: builtIn.label, type: builtIn.type, required: true })
    );

describe('every institute gets the three registration fields', () => {
    it('seeds all three for an institute with no default fields at all', () => {
        expect(topUp([])).toEqual([
            { label: 'Full Name', type: 'text', required: true },
            { label: 'Email', type: 'email', required: true },
            { label: 'Phone Number', type: 'phone', required: true },
        ]);
    });

    it('adds only what is missing, and leaves the existing order alone', () => {
        const result = topUp([
            { label: 'Email', type: 'email', required: false },
            { label: 'School', type: 'text', required: true },
        ]);

        expect(result.map((f) => f.label)).toEqual(['Email', 'School', 'Full Name', 'Phone Number']);
        // An institute that already made its email optional keeps that choice.
        expect(result[0]?.required).toBe(false);
    });

    it('recognises an institute\'s own wording instead of adding a duplicate', () => {
        const result = topUp([
            { label: 'Name', type: 'text', required: true },
            { label: 'E-mail', type: 'text', required: true },
            { label: 'Mobile Number', type: 'text', required: true },
        ]);

        expect(result).toHaveLength(3);
    });

    it('does not let someone else\'s details stand in for the registrant\'s', () => {
        // "Parent Name" and "School Name" both classify as NAME, and "Parent Email" as EMAIL —
        // none of them is the person filling the form in.
        const result = topUp([
            { label: 'Parent Name', type: 'text', required: true },
            { label: 'Parent Email', type: 'text', required: true },
        ]);

        expect(result.map((f) => f.label)).toEqual([
            'Parent Name',
            'Parent Email',
            'Full Name',
            'Email',
            'Phone Number',
        ]);
    });
});

describe('the three built-ins default to Required, however the institute worded them', () => {
    const cases: [string, string][] = [
        ['Full Name', 'text'],
        ['Name', 'text'],
        ['Email', 'text'],
        ['E-mail', 'text'],
        ['Phone Number', 'number'],
        ['Mobile Number', 'text'],
        ['Mobile', 'text'],
    ];

    it.each(cases)('treats %s as a built-in', (label, type) => {
        expect(isBuiltInRegistrationField({ label, type })).toBe(true);
    });

    it('leaves ordinary fields to the institute\'s own setting', () => {
        expect(isBuiltInRegistrationField({ label: 'City', type: 'text' })).toBe(false);
        expect(isBuiltInRegistrationField({ label: 'CUET Marks', type: 'number' })).toBe(false);
    });

    it('does not treat someone else\'s details as the registrant\'s', () => {
        expect(isBuiltInRegistrationField({ label: 'Parent Name', type: 'text' })).toBe(false);
        expect(isBuiltInRegistrationField({ label: 'School Name', type: 'text' })).toBe(false);
        expect(isBuiltInRegistrationField({ label: 'Emergency Contact', type: 'text' })).toBe(false);
    });

    it('reads institute-suffixed keys', () => {
        expect(
            isBuiltInRegistrationField({ key: 'phone_number_inst_1c9d0e2f', label: 'Sampark' })
        ).toBe(true);
    });
});
