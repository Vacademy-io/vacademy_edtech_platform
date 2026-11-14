import { describe, expect, it } from 'vitest';
import { zodResolver } from '@hookform/resolvers/zod';
import { addParticipantsSchema } from './schema';
import { AccessType } from '../../-constants/enums';

/**
 * The rules that span the whole field list are raised on the array itself (`path: ['fields']`),
 * and the builder renders them from `formState.errors.fields?.message`. A resolver that filed
 * them anywhere else — under `fields.root`, or per-index — would leave the admin with a Save
 * that does nothing and no explanation on screen.
 */
describe('cross-field registration errors reach the form state the UI reads', () => {
    const resolve = async (fields: { label: string; type: string; required: boolean }[]) => {
        const resolver = zodResolver(addParticipantsSchema);
        const values = {
            accessType: AccessType.PUBLIC,
            batchSelectionType: 'batch',
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
            fields: fields.map((f) => ({ ...f, isDefault: true })),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return resolver(values as any, undefined, { fields: {}, shouldUseNativeValidation: false });
    };

    it('puts the identity message exactly where the Registration Form section reads it', async () => {
        const { errors } = await resolve([
            { label: 'Full Name', type: 'text', required: true },
            { label: 'Email', type: 'email', required: false },
            { label: 'Phone Number', type: 'phone', required: false },
        ]);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((errors as any).fields?.message).toBe(
            'Keep either Email or Phone Number required — a registration needs one of them to identify the learner.'
        );
    });

    it('reports no field error on a form that keeps one identity required', async () => {
        const { errors } = await resolve([
            { label: 'Full Name', type: 'text', required: true },
            { label: 'Email', type: 'email', required: true },
            { label: 'Phone Number', type: 'phone', required: false },
        ]);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((errors as any).fields?.message).toBeUndefined();
    });
});
