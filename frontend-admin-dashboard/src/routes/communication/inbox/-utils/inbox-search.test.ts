import { describe, expect, it } from 'vitest';
import { parseInboxSearch } from '@/routes/communication/inbox/-utils/inbox-search';

/**
 * Refreshing the inbox used to land on the empty "Select a conversation" pane, losing the chat the
 * admin was reading. The open conversation now rides in the URL — which means the URL is also an
 * input a person can edit, so it is treated as one.
 */
describe('the ?phone= search param', () => {
    it('keeps a phone number so a refresh re-opens the same chat', () => {
        expect(parseInboxSearch({ phone: '919811586839' })).toEqual({ phone: '919811586839' });
        expect(parseInboxSearch({ phone: '+919811586839' })).toEqual({ phone: '+919811586839' });
    });

    it('trims stray whitespace from a pasted link', () => {
        expect(parseInboxSearch({ phone: ' 919811586839 ' })).toEqual({ phone: '919811586839' });
    });

    it('drops anything that is not a phone number rather than querying with it', () => {
        expect(parseInboxSearch({ phone: 'null' })).toEqual({});
        expect(parseInboxSearch({ phone: '919811586839; DROP TABLE' })).toEqual({});
        expect(parseInboxSearch({ phone: '12' })).toEqual({});
        expect(parseInboxSearch({ phone: '9'.repeat(40) })).toEqual({});
        expect(parseInboxSearch({ phone: '' })).toEqual({});
    });

    it('opens the plain inbox when the URL carries no conversation', () => {
        expect(parseInboxSearch({})).toEqual({});
        expect(parseInboxSearch({ phone: 42 })).toEqual({});
        expect(parseInboxSearch({ other: 'x' })).toEqual({});
    });
});
