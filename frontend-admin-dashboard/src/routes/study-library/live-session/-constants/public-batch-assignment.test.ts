import { describe, it, expect } from 'vitest';
import { transformFormToDTOStep2 } from '@/routes/study-library/live-session/-constants/helper';
import { AccessType } from '@/routes/study-library/live-session/-constants/enums';

/**
 * A public live class may ALSO be assigned to batches.
 *
 * The open registration link and batch enrolment are independent on the backend:
 * `Step2Service` calls `updateSessionAccessLevel` and `linkParticipants` without
 * either consulting the other, and no learner-facing query filters on
 * `access_level` (the repository selects it but never puts it in a WHERE clause).
 * So an enrolled learner sees the class inside their course while outsiders still
 * register through the public form.
 *
 * The single-class wizard used to hide the batch picker for public classes, which
 * made the combination look impossible from the admin UI. These tests pin the
 * payload contract so the picker can't be silently re-gated.
 */
const buildForm = (overrides: Record<string, unknown> = {}) =>
    ({
        accessType: AccessType.PUBLIC,
        joinLink: 'https://learner.example.com/register/live-class?sessionId=s1',
        batchSelectionType: 'batch',
        selectedLearners: [],
        fields: [],
        notifyBy: { mail: true, whatsapp: false },
        notifySettings: {
            onCreate: false,
            beforeLive: false,
            beforeLiveTime: [],
            onLive: false,
            onAttendance: false,
        },
        paymentEnabled: false,
        ...overrides,
    }) as unknown as Parameters<typeof transformFormToDTOStep2>[0];

const BATCHES = ['pkg-session-1', 'pkg-session-2'];

describe('public live class + batch assignment', () => {
    it('keeps the batch ids in the payload for a PUBLIC class', () => {
        const dto = transformFormToDTOStep2(buildForm(), 'session-1', BATCHES);

        expect(dto.access_type).toBe(AccessType.PUBLIC);
        // The whole point: public does NOT strip the batches.
        expect(dto.package_session_ids).toEqual(BATCHES);
    });

    it('sends the same batch ids for PUBLIC as for PRIVATE', () => {
        const publicDto = transformFormToDTOStep2(buildForm(), 'session-1', BATCHES);
        const privateDto = transformFormToDTOStep2(
            buildForm({ accessType: AccessType.PRIVATE }),
            'session-1',
            BATCHES
        );

        expect(publicDto.package_session_ids).toEqual(privateDto.package_session_ids);
    });

    it('removes nothing when the caller passes no unlinked batches', () => {
        // Creating a class, or editing one without touching the batch selection.
        const dto = transformFormToDTOStep2(buildForm(), 'session-1', BATCHES);

        expect(dto.deleted_package_session_ids).toEqual([]);
    });

    it('forwards deselected batches so the backend actually unlinks them', () => {
        // `linkParticipants` deletes ONLY the ids named here. This used to be
        // hardcoded to [], which is why a deselected batch stayed linked and kept
        // showing under the class after every save.
        const dto = transformFormToDTOStep2(
            buildForm(),
            'session-1',
            ['pkg-session-1'],
            null,
            ['pkg-session-2']
        );

        expect(dto.package_session_ids).toEqual(['pkg-session-1']);
        expect(dto.deleted_package_session_ids).toEqual(['pkg-session-2']);
    });

    it('does not unlink batches while the admin is in individual-learner mode', () => {
        // That mode sends no batches at all; forwarding removals there would
        // detach every batch the moment someone switched tabs.
        const dto = transformFormToDTOStep2(
            buildForm({ batchSelectionType: 'individual', selectedLearners: ['user-1'] }),
            'session-1',
            [],
            null,
            ['pkg-session-2']
        );

        expect(dto.deleted_package_session_ids).toEqual([]);
    });

    it('still drops batches when the admin picked individual learners instead', () => {
        const dto = transformFormToDTOStep2(
            buildForm({ batchSelectionType: 'individual', selectedLearners: ['user-1'] }),
            'session-1',
            BATCHES
        );

        expect(dto.package_session_ids).toEqual([]);
        expect(dto.individual_user_ids).toEqual(['user-1']);
    });
});
