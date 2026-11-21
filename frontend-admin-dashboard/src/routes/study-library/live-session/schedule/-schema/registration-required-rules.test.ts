import { describe, expect, it } from 'vitest';
import { addParticipantsSchema } from './schema';
import { AccessType } from '../../-constants/enums';

const field = (label: string, type: string, required: boolean) => ({
    label,
    type,
    required,
    isDefault: true,
});

const form = (overrides: Record<string, unknown> = {}) => ({
    accessType: AccessType.PUBLIC,
    batchSelectionType: 'batch' as const,
    selectedLevels: [],
    joinLink: 'https://learner.vacademy.io/register/live-class?sessionId=abc',
    notifyBy: {
        mail: true,
        whatsapp: false,
        push_notification: false,
        system_notification: false,
    },
    notifySettings: {
        onCreate: true,
        beforeLive: false,
        onLive: true,
        onAttendance: false,
    },
    fields: [
        field('Full Name', 'text', true),
        field('Email', 'email', true),
        field('Phone Number', 'phone', true),
    ],
    ...overrides,
});

const errorsOn = (input: Record<string, unknown>) => {
    const result = addParticipantsSchema.safeParse(input);
    return result.success
        ? []
        : result.error.issues.filter((issue) => issue.path[0] === 'fields').map((i) => i.message);
};

describe('live class registration form — required rules', () => {
    it('lets an institute that does not collect phone numbers make Phone Number optional', () => {
        expect(
            errorsOn(
                form({
                    fields: [
                        field('Full Name', 'text', true),
                        field('Email', 'email', true),
                        field('Phone Number', 'phone', false),
                    ],
                })
            )
        ).toEqual([]);
    });

    it('lets Email go optional on a phone-identity form', () => {
        expect(
            errorsOn(
                form({
                    fields: [
                        field('Full Name', 'text', true),
                        field('Email', 'email', false),
                        field('Phone Number', 'phone', true),
                    ],
                })
            )
        ).toEqual([]);
    });

    it('stops a form that requires neither email nor phone — nothing would identify the learner', () => {
        expect(
            errorsOn(
                form({
                    fields: [
                        field('Full Name', 'text', true),
                        field('Email', 'email', false),
                        field('Phone Number', 'phone', false),
                    ],
                })
            )
        ).toEqual([
            'Keep either Email or Phone Number required — a registration needs one of them to identify the learner.',
        ]);
    });

    it('keeps the OTP-verified mobile number required', () => {
        expect(
            errorsOn(
                form({
                    requirePhoneVerification: true,
                    fields: [
                        field('Full Name', 'text', true),
                        field('Email', 'email', true),
                        field('Phone Number', 'phone', false),
                    ],
                })
            )
        ).toEqual([
            '"Phone Number" has to stay required while the WhatsApp OTP verification is on, or turn that verification off.',
        ]);
    });

    it('keeps the email required on a paid class — the invoice is mailed to it', () => {
        expect(
            errorsOn(
                form({
                    paymentEnabled: true,
                    paymentPrice: '499',
                    paymentCurrency: 'INR',
                    fields: [
                        field('Full Name', 'text', true),
                        field('Email', 'email', false),
                        field('Phone Number', 'phone', true),
                    ],
                })
            )
        ).toEqual([
            '"Email" has to stay required on a paid class — the invoice is billed and mailed to it.',
        ]);
    });

    it('catches an OTP-verified field that was deleted, not just made optional', () => {
        // Fields can be removed now, so "no phone field at all" has to fail the same rule.
        expect(
            errorsOn(
                form({
                    requirePhoneVerification: true,
                    fields: [
                        field('Full Name', 'text', true),
                        field('Email', 'email', true),
                    ],
                })
            )
        ).toEqual([
            'This form needs a required Phone Number field while the WhatsApp OTP verification is on, or turn that verification off.',
        ]);
    });

    it('catches a paid class whose email field was deleted', () => {
        expect(
            errorsOn(
                form({
                    paymentEnabled: true,
                    paymentPrice: '499',
                    paymentCurrency: 'INR',
                    fields: [
                        field('Full Name', 'text', true),
                        field('Phone Number', 'phone', true),
                    ],
                })
            )
        ).toEqual([
            'This form needs a required Email field on a paid class — the invoice is billed and mailed to it.',
        ]);
    });

    it('leaves private classes alone — they have no registration form', () => {
        expect(
            errorsOn(
                form({
                    accessType: AccessType.PRIVATE,
                    joinLink: 'https://learner.vacademy.io/study-library/live-class',
                    fields: [],
                })
            )
        ).toEqual([]);
    });
});
