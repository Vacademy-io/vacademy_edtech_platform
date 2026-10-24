import { describe, expect, it } from 'vitest';

import { leadMessagingContext } from './lead-messaging-context';

/**
 * Which builder WhatsApp nodes get the lead variable pickers. Getting "messages
 * leads" wrong either hides the pickers from a lead workflow, or offers lead
 * details to a node that sends to students — where they resolve to nothing.
 */
const leadTrigger = {
    eventName: 'AUDIENCE_LEAD_SUBMISSION',
    eventAppliedType: 'AUDIENCE',
    eventId: 'aud-1',
};
const noTrigger = { eventName: '', eventAppliedType: '' };

describe('leadMessagingContext', () => {
    it('treats the lead submitter under a lead-submission trigger as a confirmation', () => {
        expect(leadMessagingContext("{#ctx['user']}", leadTrigger, [])).toEqual({
            kind: 'confirmation',
            audienceId: 'aud-1',
        });
    });

    it('recognises the trigger from the TRIGGER node when the store has not loaded it', () => {
        const nodes = [
            { data: { nodeType: 'TRIGGER', config: { triggerEvent: 'AUDIENCE_LEAD_SUBMISSION' } } },
        ];
        expect(leadMessagingContext("{#ctx['user']}", noTrigger, nodes)).toEqual({
            kind: 'confirmation',
            audienceId: undefined,
        });
    });

    // One form per list: with several lists (or all of them) there is no single form to read.
    it('names the list only when the trigger is scoped to exactly one', () => {
        expect(
            leadMessagingContext(
                "{#ctx['user']}",
                { ...leadTrigger, eventId: undefined, eventIds: ['aud-1', 'aud-2'] },
                []
            )
        ).toEqual({ kind: 'confirmation', audienceId: undefined });
        expect(
            leadMessagingContext(
                "{#ctx['user']}",
                { ...leadTrigger, eventId: undefined, eventIds: ['aud-2'] },
                []
            )
        ).toEqual({ kind: 'confirmation', audienceId: 'aud-2' });
    });

    it('treats a node over the follow-up query’s leads as a follow-up of that list', () => {
        const nodes = [
            {
                data: {
                    nodeType: 'QUERY',
                    config: {
                        prebuiltKey: 'fetch_audience_responses_filtered',
                        params: { audienceId: 'aud-7', daysAgo: 3 },
                    },
                },
            },
        ];
        expect(leadMessagingContext("#ctx['leads']", noTrigger, nodes)).toEqual({
            kind: 'followup',
            audienceId: 'aud-7',
        });
    });

    it('leaves every other recipient list to the generic picker', () => {
        expect(leadMessagingContext("#ctx['students']", leadTrigger, [])).toBeNull();
        expect(leadMessagingContext("#ctx['ssigm_list']", leadTrigger, [])).toBeNull();
        // The same `{#ctx['user']}` under an enrolment trigger is a learner, not a lead.
        expect(
            leadMessagingContext(
                "{#ctx['user']}",
                { eventName: 'LEARNER_BATCH_ENROLLMENT', eventAppliedType: 'PACKAGE_SESSION' },
                []
            )
        ).toBeNull();
    });
});
