import { describe, it, expect } from 'vitest';
import { transformFormToDTOStep2 } from '@/routes/study-library/live-session/-constants/helper';
import { AccessType } from '@/routes/study-library/live-session/-constants/enums';

/**
 * "Notify Before" reminders are a plain list with no on/off switch, so a row the admin added
 * must reach the payload. They used to be dropped unless `beforeLive` was true, which only
 * happened when an institute default reminder pre-filled the list.
 */
const buildForm = (notifySettings: Record<string, unknown>) =>
    ({
        accessType: AccessType.PRIVATE,
        batchSelectionType: 'batch',
        selectedLearners: [],
        fields: [],
        notifyBy: { mail: true, whatsapp: false },
        notifySettings: { onCreate: false, onLive: false, onAttendance: false, ...notifySettings },
        paymentEnabled: false,
    }) as unknown as Parameters<typeof transformFormToDTOStep2>[0];

const beforeLive = (dto: ReturnType<typeof transformFormToDTOStep2>) =>
    (dto.added_notification_actions ?? []).filter((a) => a.type === 'BEFORE_LIVE');

describe('Notify Before reminders', () => {
    it('sends reminders added by hand even when beforeLive was never set', () => {
        const dto = transformFormToDTOStep2(
            buildForm({ beforeLive: false, beforeLiveTime: [{ time: '30m' }, { time: '1h' }] }),
            'session-1',
            ['ps-1']
        );
        expect(beforeLive(dto).map((a) => a.time)).toEqual(['30m', '1h']);
    });

    it('skips empty rows (Add clicked, no time picked)', () => {
        const dto = transformFormToDTOStep2(
            buildForm({ beforeLive: true, beforeLiveTime: [{ time: '' }, { time: '10m' }] }),
            'session-1',
            ['ps-1']
        );
        expect(beforeLive(dto).map((a) => a.time)).toEqual(['10m']);
    });

    it('sends no reminder when the list is empty', () => {
        const dto = transformFormToDTOStep2(
            buildForm({ beforeLive: true, beforeLiveTime: [] }),
            'session-1',
            ['ps-1']
        );
        expect(beforeLive(dto)).toEqual([]);
    });
});
