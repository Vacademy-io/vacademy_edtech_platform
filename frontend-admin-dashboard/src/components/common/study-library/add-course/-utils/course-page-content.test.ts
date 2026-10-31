import { describe, expect, it } from 'vitest';

import {
    COURSE_PAGE_MAX_FAQS,
    buildCoursePageJson,
    buildFaqSuggestionPrompt,
    htmlToPlainText,
    isBlankHtml,
    normalizeFaqs,
    parseCoursePageJson,
    parseFaqsFromHtml,
    readCoursePageJsonFromCourseInit,
} from './course-page-content';

const manyFaqs = (n: number) => Array.from({ length: n }, (_, i) => ({ q: `Q${i}`, a: `A${i}` }));

describe('parseCoursePageJson', () => {
    it('reads a stored value', () => {
        const raw = JSON.stringify({
            v: 1,
            mode: 'LIVE',
            faqs: [{ q: 'Is it live?', a: '<p>Yes</p>' }],
        });
        expect(parseCoursePageJson(raw)).toEqual({
            mode: 'LIVE',
            faqs: [{ q: 'Is it live?', a: '<p>Yes</p>' }],
        });
    });

    it.each([null, undefined, '', '   ', '{not json', '[]', '42', 'null', '"text"'])(
        'treats %s as empty without throwing',
        (raw) => {
            expect(parseCoursePageJson(raw)).toEqual({ mode: null, faqs: [] });
        }
    );

    it('drops unknown modes, malformed rows and empty rows, and trims', () => {
        const raw = JSON.stringify({
            mode: 'HYBRID',
            faqs: [
                null,
                'string row',
                { q: 42, a: '<p>orphan answer</p>' },
                { q: '  Spaced?  ', a: ' <p>Yes</p> ' },
                { q: '', a: '<p></p>' },
            ],
        });
        expect(parseCoursePageJson(raw)).toEqual({
            mode: null,
            faqs: [
                { q: '', a: '<p>orphan answer</p>' },
                { q: 'Spaced?', a: '<p>Yes</p>' },
            ],
        });
    });

    it('accepts an already-parsed object and caps the list', () => {
        const parsed = parseCoursePageJson({ mode: 'SELF_PACED', faqs: manyFaqs(40) });
        expect(parsed.mode).toBe('SELF_PACED');
        expect(parsed.faqs).toHaveLength(COURSE_PAGE_MAX_FAQS);
    });
});

describe('buildCoursePageJson', () => {
    const loadedEdit = { isEdit: true, storedValueLoaded: true };

    it('omits the field when adding a course with nothing filled in', () => {
        expect(buildCoursePageJson({ mode: null, faqs: [] }, { isEdit: false })).toBeNull();
        expect(buildCoursePageJson(undefined, { isEdit: false })).toBeNull();
        expect(
            buildCoursePageJson({ mode: null, faqs: [{ q: ' ', a: '<p></p>' }] }, { isEdit: false })
        ).toBeNull();
    });

    it('sends "" on edit only when the stored value was loaded and everything was removed', () => {
        expect(buildCoursePageJson({ mode: null, faqs: [] }, loadedEdit)).toBe('');
    });

    it('never sends anything on edit when the stored value was not loaded', () => {
        // The institute-wide init list always carries null: clearing or overwriting from
        // that would wipe FAQs the admin never saw.
        expect(buildCoursePageJson({ mode: null, faqs: [] }, { isEdit: true })).toBeNull();
        expect(
            buildCoursePageJson(
                { mode: 'LIVE', faqs: [{ q: 'Q', a: '<p>A</p>' }] },
                { isEdit: true, storedValueLoaded: false }
            )
        ).toBeNull();
    });

    it('always sends the full JSON on a loaded edit when something is set', () => {
        const json = buildCoursePageJson(
            {
                mode: 'LIVE',
                faqs: [
                    { q: '  When are classes? ', a: '<p>Weekends</p>' },
                    { q: '', a: '<p>&nbsp;</p>' },
                ],
            },
            loadedEdit
        );
        expect(json).not.toBeNull();
        expect(JSON.parse(json as string)).toEqual({
            v: 1,
            mode: 'LIVE',
            faqs: [{ q: 'When are classes?', a: '<p>Weekends</p>' }],
        });
    });

    it('sends mode alone, with an empty FAQ list', () => {
        expect(
            JSON.parse(buildCoursePageJson({ mode: 'SELF_PACED', faqs: [] }, { isEdit: false })!)
        ).toEqual({ v: 1, mode: 'SELF_PACED', faqs: [] });
    });

    it('caps the FAQs at the maximum', () => {
        const json = buildCoursePageJson({ mode: null, faqs: manyFaqs(35) }, { isEdit: false });
        expect(JSON.parse(json as string).faqs).toHaveLength(COURSE_PAGE_MAX_FAQS);
    });

    it('round-trips through parse', () => {
        const state = { mode: 'LIVE' as const, faqs: [{ q: 'Q', a: '<p>A</p>' }] };
        expect(parseCoursePageJson(buildCoursePageJson(state, loadedEdit))).toEqual(state);
    });
});

describe('readCoursePageJsonFromCourseInit', () => {
    const stored = JSON.stringify({ v: 1, mode: 'LIVE', faqs: [] });

    it('reads the course from a course-init array', () => {
        const data = [
            { course: { id: 'other', course_page_json: 'x' } },
            { course: { id: 'c1', course_page_json: stored } },
        ];
        expect(readCoursePageJsonFromCourseInit(data, 'c1')).toEqual({ loaded: true, raw: stored });
    });

    it('counts an explicit null as loaded (nothing stored)', () => {
        expect(
            readCoursePageJsonFromCourseInit(
                [{ course: { id: 'c1', course_page_json: null } }],
                'c1'
            )
        ).toEqual({ loaded: true, raw: null });
    });

    it('is not loaded when the course or the key is missing', () => {
        expect(readCoursePageJsonFromCourseInit([{ course: { id: 'c1' } }], 'c1').loaded).toBe(
            false
        );
        expect(readCoursePageJsonFromCourseInit([{ course: { id: 'c2' } }], 'c1').loaded).toBe(
            false
        );
        expect(readCoursePageJsonFromCourseInit(null, 'c1').loaded).toBe(false);
        expect(readCoursePageJsonFromCourseInit({ unexpected: true }, 'c1').loaded).toBe(false);
    });
});

describe('normalizeFaqs / isBlankHtml', () => {
    it('treats editor-empty values as blank but keeps media-only answers', () => {
        expect(isBlankHtml('<p></p>')).toBe(true);
        expect(isBlankHtml('<p>&nbsp; </p><p><br></p>')).toBe(true);
        expect(isBlankHtml('<p><img src="x.png"></p>')).toBe(false);
    });

    it('keeps half-filled rows so nothing typed is silently lost', () => {
        expect(normalizeFaqs([{ q: 'Only a question', a: '<p></p>' }])).toEqual([
            { q: 'Only a question', a: '' },
        ]);
    });
});

describe('parseFaqsFromHtml', () => {
    it('splits <h3> questions from their answer paragraphs', () => {
        const html =
            '<p>Intro to ignore</p>' +
            '<h3>1. Who is this for?</h3><p>Beginners.</p><ul><li>No experience needed</li></ul>' +
            '<h3>Is there a certificate?</h3><p>Ask the institute.</p>';
        expect(parseFaqsFromHtml(html)).toEqual([
            { q: 'Who is this for?', a: '<p>Beginners.</p><ul><li>No experience needed</li></ul>' },
            { q: 'Is there a certificate?', a: '<p>Ask the institute.</p>' },
        ]);
    });

    it('accepts bold-paragraph questions', () => {
        expect(
            parseFaqsFromHtml('<p><strong>Q: Live or recorded?</strong></p><p>Both.</p>')
        ).toEqual([{ q: 'Live or recorded?', a: '<p>Both.</p>' }]);
    });

    it('returns nothing for text without questions', () => {
        expect(parseFaqsFromHtml('<p>Just some copy.</p>')).toEqual([]);
        expect(parseFaqsFromHtml('')).toEqual([]);
    });
});

describe('FAQ suggestion prompt', () => {
    it('uses the institute term, the count and a bounded context', () => {
        const prompt = buildFaqSuggestionPrompt({
            courseTerm: 'Program',
            count: 5,
            context: 'x'.repeat(10_000),
        });
        expect(prompt).toContain('exactly 5 frequently asked questions');
        expect(prompt).toContain('before joining this program');
        expect(prompt).toContain('<h3>');
        expect(prompt.length).toBeLessThan(4000);
    });

    it('turns editor html into plain text', () => {
        expect(
            htmlToPlainText('<p>Learn&nbsp;<strong>typing</strong> &amp; more</p><p>Fast</p>')
        ).toBe('Learn typing & more\nFast');
    });
});
