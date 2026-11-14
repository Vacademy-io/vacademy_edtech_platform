import { describe, expect, it } from 'vitest';
import { messageOriginKey } from './message-origin';

describe('messageOriginKey', () => {
    it('names the workflow or chatbot flow when the backend resolved it', () => {
        expect(messageOriginKey({ type: 'WORKFLOW', id: 'wf-1', name: 'UnlockX Registration' })).toBe(
            'origin.workflow'
        );
        expect(messageOriginKey({ type: 'CHATBOT_FLOW', id: 'f-1', name: 'New Flow' })).toBe(
            'origin.chatbotFlow'
        );
    });

    it('still says who sent it when the name could not be resolved', () => {
        expect(messageOriginKey({ type: 'WORKFLOW' })).toBe('origin.workflowUnnamed');
        expect(messageOriginKey({ type: 'CHATBOT_FLOW', id: 'f-1' })).toBe('origin.chatbotFlowUnnamed');
    });

    it('shows nothing for no origin or a type the UI does not know', () => {
        expect(messageOriginKey(null)).toBeNull();
        expect(messageOriginKey(undefined)).toBeNull();
        expect(messageOriginKey({ type: 'SOMETHING_NEW', name: 'x' })).toBeNull();
    });
});
