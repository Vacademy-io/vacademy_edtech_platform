import { describe, expect, it } from 'vitest';
import { ReTransformCustomFields } from './-components/create-invite/-utils/helper';
import type { IndividualInviteLinkDetails } from '@/types/study-library/individual-invite-interface';

/**
 * The Required switch on an invite writes the per-form mapping row (`is_mandatory`), not the
 * master `custom_field.isMandatory` that every other form using the same field reads. Reading the
 * master back is what made a switched-off field come back on the next time the invite was opened,
 * and the next save then wrote that back.
 */
const invite = (
    fields: { name: string; key: string; is_mandatory?: boolean | null; master: boolean | null }[]
) =>
    ({
        institute_custom_fields: fields.map((f, index) => ({
            id: `map-${index}`,
            institute_id: 'inst-1',
            type: 'ENROLL_INVITE',
            type_id: 'invite-1',
            individual_order: index,
            is_mandatory: f.is_mandatory,
            custom_field: {
                id: `cf-${index}`,
                fieldKey: f.key,
                fieldName: f.name,
                fieldType: 'text',
                config: '',
                isMandatory: f.master,
            },
        })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any as IndividualInviteLinkDetails;

const requiredOf = (details: IndividualInviteLinkDetails) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ReTransformCustomFields(details).map((f: any) => [f.name, f.isRequired]);

describe('reopening an invite shows what THIS invite stored', () => {
    it('keeps a built-in the admin made optional, optional', () => {
        expect(
            requiredOf(
                invite([
                    { name: 'Full Name', key: 'full_name_inst_a1', is_mandatory: true, master: true },
                    // Switched off on this invite; the shared master still says required because
                    // the institute's other forms need it.
                    { name: 'Phone Number', key: 'phone_number_inst_a1', is_mandatory: false, master: true },
                ])
            )
        ).toEqual([
            ['Full Name', true],
            ['Phone Number', false],
        ]);
    });

    it('falls back to the master when this invite never answered', () => {
        expect(
            requiredOf(
                invite([
                    { name: 'Email', key: 'email_inst_a1', is_mandatory: null, master: true },
                    { name: 'City', key: 'city_inst_a1', is_mandatory: null, master: false },
                ])
            )
        ).toEqual([
            ['Email', true],
            ['City', false],
        ]);
    });

    it('starts a seeded field required when neither has an answer', () => {
        expect(
            requiredOf(
                invite([
                    { name: 'Email', key: 'email_inst_a1', is_mandatory: null, master: null },
                    { name: 'City', key: 'city_inst_a1', is_mandatory: null, master: null },
                ])
            )
        ).toEqual([
            ['Email', true],
            ['City', false],
        ]);
    });
});
