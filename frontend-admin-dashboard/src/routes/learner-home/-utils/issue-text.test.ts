import { describe, expect, it } from 'vitest';
import { issueFieldKey, issueTextKey } from './issue-text';

const exists = (keys: string[]) => (k: string) => keys.includes(k);

describe('issue text', () => {
    it('uses the full sentence when its numbers are known', () => {
        expect(
            issueTextKey(
                { block_key: 'b', path: 'config.title', code: 'TOO_LONG', params: { max: 80 } },
                exists(['issues.TOO_LONG', 'issuesPlain.TOO_LONG'])
            )
        ).toEqual({ key: 'issues.TOO_LONG', params: { max: 80 } });
    });

    it('falls back to the plain sentence for a server issue without numbers', () => {
        expect(
            issueTextKey(
                { block_key: null, path: 'blocks', code: 'TOO_MANY', message: 'At most 30 blocks' },
                exists(['issues.TOO_MANY', 'issuesPlain.TOO_MANY'])
            )
        ).toEqual({ key: 'issuesPlain.TOO_MANY', params: {} });
    });

    it('returns null for an unknown code so the server message shows', () => {
        expect(
            issueTextKey({ block_key: null, path: null, code: 'NEW_THING' }, exists([]))
        ).toBeNull();
    });

    it('names the field from the path', () => {
        expect(issueFieldKey('config.slides[0].image.alt')).toBe('fields.alt');
        expect(issueFieldKey('config.title')).toBe('fields.title');
        expect(issueFieldKey('audience.all_of[1]')).toBe('fields.audience');
        expect(issueFieldKey('config.tiles[2].link.url')).toBe('fields.link');
        expect(issueFieldKey('blocks')).toBeNull();
        expect(issueFieldKey(null)).toBeNull();
    });
});
