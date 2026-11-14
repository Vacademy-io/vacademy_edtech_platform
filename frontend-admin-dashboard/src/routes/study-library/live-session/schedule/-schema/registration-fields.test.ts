import { describe, expect, it } from 'vitest';
import {
    FieldRole,
    classifyFieldRole,
    hasRequiredIdentityField,
} from '@/components/common/custom-fields/field-roles';

describe('classifyFieldRole', () => {
    it('reads the role off institute-suffixed keys, not an exact match', () => {
        expect(
            classifyFieldRole({ fieldKey: 'phone_number_inst_1c9d0e2f_2', label: 'Phone Number' })
        ).toBe(FieldRole.PHONE);
        expect(classifyFieldRole({ fieldKey: 'email_inst_1c9d0e2f', label: 'Email' })).toBe(
            FieldRole.EMAIL
        );
    });

    it('keeps name ahead of phone so "contact name" is not claimed as a phone field', () => {
        expect(classifyFieldRole({ label: 'Contact Name' })).toBe(FieldRole.NAME);
        expect(classifyFieldRole({ label: 'Contact Number' })).toBe(FieldRole.PHONE);
    });

    it('trusts an explicit field type over the label', () => {
        expect(classifyFieldRole({ type: 'phone', label: 'WhatsApp' })).toBe(FieldRole.PHONE);
        expect(classifyFieldRole({ type: 'email', label: 'Where do we reach you' })).toBe(
            FieldRole.EMAIL
        );
    });

    it('leaves ordinary fields alone', () => {
        expect(classifyFieldRole({ type: 'text', label: 'School' })).toBe(FieldRole.OTHER);
    });
});

describe('hasRequiredIdentityField', () => {
    const fullName = { label: 'Full Name', type: 'text', required: true };
    const email = { label: 'Email', type: 'email', required: true };
    const phone = { label: 'Phone Number', type: 'phone', required: true };

    it('accepts an optional phone number as long as email still identifies the learner', () => {
        expect(hasRequiredIdentityField([fullName, email, { ...phone, required: false }])).toBe(
            true
        );
    });

    it('accepts an optional email on a phone-identity form', () => {
        expect(hasRequiredIdentityField([fullName, { ...email, required: false }, phone])).toBe(
            true
        );
    });

    it('rejects a form where neither identity field is required', () => {
        expect(
            hasRequiredIdentityField([
                fullName,
                { ...email, required: false },
                { ...phone, required: false },
            ])
        ).toBe(false);
    });

    it('does not count a required name as an identity', () => {
        expect(hasRequiredIdentityField([fullName])).toBe(false);
    });
});
