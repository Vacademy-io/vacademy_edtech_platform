import { describe, expect, it } from 'vitest';
import { formatReviewer, parseReviewMeta } from './review-meta';

describe('formatReviewer', () => {
    it('joins ref and name like the spec example', () => {
        expect(formatReviewer({ ref: 'T-0042', name: 'Mrs. Iyer' })).toBe('T-0042 (Mrs. Iyer)');
    });

    it('uses whichever part is present', () => {
        expect(formatReviewer({ name: 'Mrs. Iyer' })).toBe('Mrs. Iyer');
        expect(formatReviewer({ ref: 'T-0042' })).toBe('T-0042');
        expect(formatReviewer('Mr. Rao')).toBe('Mr. Rao');
        expect(formatReviewer({})).toBe('');
        expect(formatReviewer(null)).toBe('');
    });

    it('collapses whitespace and caps very long partner text', () => {
        expect(formatReviewer({ name: '  Mrs.\n  Iyer ' })).toBe('Mrs. Iyer');
        const long = formatReviewer({ name: 'x'.repeat(200) });
        expect(long.length).toBe(80);
        expect(long.endsWith('…')).toBe(true);
    });
});

describe('parseReviewMeta', () => {
    it('reads an API override from an object', () => {
        expect(
            parseReviewMeta({
                reviewer: { ref: 'T-0042', name: 'Mrs. Iyer' },
                reason: 'teacher review',
            })
        ).toEqual({
            kind: 'reviewed',
            reviewer: 'T-0042 (Mrs. Iyer)',
            viaApi: true,
            reason: 'teacher review',
        });
    });

    it('reads a JSON string (jsonb surfaced as text)', () => {
        expect(parseReviewMeta('{"reviewer":{"name":"Mrs. Iyer"},"via":"api"}')).toMatchObject({
            kind: 'reviewed',
            reviewer: 'Mrs. Iyer',
            viaApi: true,
        });
    });

    it('reports an approval without changes', () => {
        expect(parseReviewMeta({ approved_by: { ref: 'T-7' } })).toMatchObject({
            kind: 'approved',
            reviewer: 'T-7',
        });
    });

    it('flags a non-API channel', () => {
        expect(parseReviewMeta({ reviewer: 'Ms. Das', via: 'dashboard' })?.viaApi).toBe(false);
    });

    it('drops a stale API override once a dashboard user edited the question after it', () => {
        const meta = { reviewer: { ref: 'T-0042' }, via: 'api' };
        expect(parseReviewMeta(meta, '6f1c-dashboard-user')).toBeNull();
        // The API's own edit (or no edited_by on the payload) keeps the line.
        expect(parseReviewMeta(meta, 'apikey:k1')?.kind).toBe('reviewed');
        expect(parseReviewMeta(meta, null)?.kind).toBe('reviewed');
        expect(parseReviewMeta(meta, '')?.kind).toBe('reviewed');
        // An approval is still true history after a later dashboard edit.
        expect(parseReviewMeta({ approved_by: { ref: 'T-7' } }, 'dash-user')?.kind).toBe(
            'approved'
        );
    });

    it('returns null for absent, empty or malformed meta', () => {
        expect(parseReviewMeta(undefined)).toBeNull();
        expect(parseReviewMeta(null)).toBeNull();
        expect(parseReviewMeta('')).toBeNull();
        expect(parseReviewMeta('{not json')).toBeNull();
        expect(parseReviewMeta([])).toBeNull();
        expect(parseReviewMeta({ reason: 'only a reason' })).toBeNull();
    });
});
