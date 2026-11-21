import { describe, expect, it } from 'vitest';
import type { LinkTarget } from '../-types/learner-home-types';
import {
    emptyLinkDraft,
    isConditionalFeature,
    normalizeLinkTarget,
    normalizeUrl,
    offeredFeatures,
    readerModeEffect,
    toLinkDraft,
    toLinkTarget,
} from './link-target';

const ALL: LinkTarget[] = [
    { kind: 'COURSE', package_id: 'p1' },
    { kind: 'COURSE_LIST', tag: 'JEE 2027' },
    { kind: 'COURSE_LIST' },
    { kind: 'PRODUCT_PAGE', code: 'SUMMER' },
    { kind: 'LIVE_CLASS', session_id: 's1' },
    { kind: 'ASSESSMENT', assessment_id: 'a1' },
    { kind: 'FEATURE', feature: 'NOTEBOOK' },
    { kind: 'URL', url: 'https://example.com/pay', sells_something: true },
    { kind: 'APP_PATH', path: '/x?y=1' },
];

describe('link target serialisation', () => {
    it.each(ALL)('round-trips %j through the picker draft', (link) => {
        expect(toLinkTarget(toLinkDraft(link))).toEqual(link);
    });

    it.each(ALL)('normalises %j unchanged', (link) => {
        expect(normalizeLinkTarget(link)).toEqual(link);
    });

    it('drops unknown keys and unknown kinds', () => {
        expect(normalizeLinkTarget({ kind: 'COURSE', package_id: 'p', extra: 1 })).toEqual({
            kind: 'COURSE',
            package_id: 'p',
        });
        expect(normalizeLinkTarget({ kind: 'NOPE' })).toBeNull();
        expect(normalizeLinkTarget({ kind: 'FEATURE', feature: 'NOT_A_FEATURE' })).toBeNull();
        expect(normalizeLinkTarget(null)).toBeNull();
    });

    it('stores nothing for an incomplete draft', () => {
        expect(toLinkTarget(emptyLinkDraft('COURSE'))).toBeNull();
        expect(toLinkTarget(emptyLinkDraft('PRODUCT_PAGE'))).toBeNull();
        expect(toLinkTarget(emptyLinkDraft('URL'))).toBeNull();
        expect(toLinkTarget({ kind: 'FEATURE', value: 'BAD', sellsSomething: false })).toBeNull();
        expect(
            toLinkTarget({ kind: 'APP_PATH', value: 'no-slash', sellsSomething: false })
        ).toBeNull();
        // "All courses" is complete with no tag.
        expect(toLinkTarget(emptyLinkDraft('COURSE_LIST'))).toEqual({ kind: 'COURSE_LIST' });
        expect(toLinkTarget(null)).toBeNull();
    });

    it('trims values and keeps the payment flag on URLs', () => {
        expect(toLinkTarget({ kind: 'COURSE', value: '  p9 ', sellsSomething: false })).toEqual({
            kind: 'COURSE',
            package_id: 'p9',
        });
        expect(toLinkTarget({ kind: 'URL', value: 'example.com/a', sellsSomething: true })).toEqual(
            {
                kind: 'URL',
                url: 'https://example.com/a',
                sells_something: true,
            }
        );
    });
});

describe('normalizeUrl', () => {
    it.each([
        ['https://a.com', { url: 'https://a.com' }],
        ['http://a.com/x?y', { url: 'http://a.com/x?y' }],
        ['a.com', { url: 'https://a.com' }],
        ['//a.com', { url: 'https://a.com' }],
        ['mailto:x@y.com', { url: 'mailto:x@y.com' }],
        ['tel:+91123', { url: 'tel:+91123' }],
        ['javascript:alert(1)', { problem: 'scheme' }],
        ['JavaScript:alert(1)', { problem: 'scheme' }],
        ['data:text/html,hi', { problem: 'scheme' }],
        ['ftp://a.com', { problem: 'scheme' }],
        ['', { problem: 'empty' }],
        ['not a url', { problem: 'invalid' }],
    ])('%s', (input, expected) => {
        expect(normalizeUrl(input)).toEqual(expected);
    });
});

describe('reader mode and conditions', () => {
    it('marks commerce links', () => {
        expect(readerModeEffect({ kind: 'PRODUCT_PAGE', code: 'x' })).toBe('hidden');
        expect(readerModeEffect({ kind: 'FEATURE', feature: 'STORE_BOOKS' })).toBe('hidden');
        expect(readerModeEffect({ kind: 'FEATURE', feature: 'NOTEBOOK' })).toBe('none');
        expect(readerModeEffect({ kind: 'URL', url: 'https://a.com', sells_something: true })).toBe(
            'hidden'
        );
        expect(
            readerModeEffect({ kind: 'URL', url: 'https://a.com', sells_something: false })
        ).toBe('none');
        expect(readerModeEffect({ kind: 'COURSE', package_id: 'p' })).toBe('hiddenIfNotOwned');
        expect(readerModeEffect({ kind: 'LIVE_CLASS', session_id: 's' })).toBe('hiddenIfPaid');
        expect(readerModeEffect(null)).toBe('none');
    });

    it('hides store features without a store site', () => {
        expect(offeredFeatures(false)).not.toContain('STORE_MEMBERSHIPS');
        expect(offeredFeatures(true)).toContain('STORE_MEMBERSHIPS');
        expect(offeredFeatures(false)).toContain('NOTEBOOK');
    });

    it('flags conditional features', () => {
        expect(isConditionalFeature({ kind: 'FEATURE', feature: 'HOMEWORK' })).toBe(true);
        expect(isConditionalFeature({ kind: 'FEATURE', feature: 'COURSES' })).toBe(false);
        expect(isConditionalFeature({ kind: 'COURSE', package_id: 'p' })).toBe(false);
    });
});
