import { describe, expect, it } from 'vitest';
import {
    EMPTY_FOLLOW_UP_FIELDS,
    followUpFieldsPayload,
} from '@/components/shared/leads/follow-up-fields';

describe('followUpFieldsPayload', () => {
    it('sends nothing when the counsellor answered nothing', () => {
        // An institute with the block on but a counsellor who skipped the dropdowns
        // must post the same body as before the feature existed.
        expect(followUpFieldsPayload(EMPTY_FOLLOW_UP_FIELDS)).toEqual({});
    });

    it('omits only the blank ones', () => {
        expect(
            followUpFieldsPayload({
                interestLevel: '',
                studentResponse: 'Call Back',
                followUpMode: '',
                nextAction: 'Send Course Details',
            })
        ).toEqual({ student_response: 'Call Back', next_action: 'Send Course Details' });
    });

    it('uses the snake_case keys the create endpoint expects', () => {
        expect(
            followUpFieldsPayload({
                interestLevel: 'Warm',
                studentResponse: 'Interested',
                followUpMode: 'Call',
                nextAction: 'Meeting Fixed',
            })
        ).toEqual({
            interest_level: 'Warm',
            student_response: 'Interested',
            follow_up_mode: 'Call',
            next_action: 'Meeting Fixed',
        });
    });
});
