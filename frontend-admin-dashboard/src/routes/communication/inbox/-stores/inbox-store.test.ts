import { beforeEach, describe, expect, it } from 'vitest';
import { useInboxStore } from '@/routes/communication/inbox/-stores/inbox-store';
import type { InboxMessage } from '@/routes/communication/inbox/-services/inbox-api';

/**
 * Double-clicking a conversation used to blank the chat: the second click cleared the messages,
 * and since the open phone had not changed nothing loaded them again.
 */
const loaded = [{ id: 'm1' }, { id: 'm2' }] as unknown as InboxMessage[];

describe('selectPhone', () => {
    beforeEach(() => {
        useInboxStore.setState({ selectedPhone: null, messages: [], hasMoreMessages: true });
    });

    it('keeps the loaded messages when the open chat is clicked again', () => {
        const { selectPhone, setMessages } = useInboxStore.getState();
        selectPhone('919000000001');
        setMessages(loaded);

        selectPhone('919000000001');

        expect(useInboxStore.getState().selectedPhone).toBe('919000000001');
        expect(useInboxStore.getState().messages).toBe(loaded);
    });

    it('still clears the old chat when a different one is opened', () => {
        const { selectPhone, setMessages } = useInboxStore.getState();
        selectPhone('919000000001');
        setMessages(loaded);

        selectPhone('919000000002');

        expect(useInboxStore.getState().selectedPhone).toBe('919000000002');
        expect(useInboxStore.getState().messages).toEqual([]);
    });

    it('still closes the chat (mobile back button)', () => {
        const { selectPhone } = useInboxStore.getState();
        selectPhone('919000000001');

        selectPhone(null);

        expect(useInboxStore.getState().selectedPhone).toBeNull();
    });
});
