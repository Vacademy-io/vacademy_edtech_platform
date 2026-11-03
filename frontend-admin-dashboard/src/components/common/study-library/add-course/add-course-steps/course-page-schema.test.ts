import { describe, expect, it } from 'vitest';
import { step1Schema } from './add-course-step1';
import { emptyCoursePageContent } from '../-utils/course-page-content';

const base = { course: 'Typing', courseMedia: { type: '', id: '' }, tags: [] };
const errs = (r: ReturnType<typeof step1Schema.safeParse>) =>
    r.success ? [] : r.error.issues.map((i) => i.path.join('.') + ': ' + i.message);

describe('step1Schema with course page', () => {
    it('old shapes still pass: no coursePage, mode+faqs without template, empty content', () => {
        expect(errs(step1Schema.safeParse(base))).toEqual([]);
        const old = step1Schema.safeParse({ ...base, coursePage: { mode: 'LIVE', faqs: [{ q: 'Q', a: '<p>A</p>' }] } });
        expect(errs(old)).toEqual([]);
        expect(old.success && old.data.coursePage?.template.tagline).toBe('');
        expect(errs(step1Schema.safeParse({ ...base, coursePage: emptyCoursePageContent() }))).toEqual([]);
    });
    it('existing FAQ rules unchanged', () => {
        const r = step1Schema.safeParse({ ...base, coursePage: { mode: null, faqs: [{ q: '', a: '<p>A</p>' }] } });
        expect(errs(r)).toEqual(['coursePage.faqs.0.q: Add the question, or remove this FAQ']);
    });
    it('defaults are not shared between parses', () => {
        const a = step1Schema.parse({ ...base, coursePage: { mode: null, faqs: [] } });
        a.coursePage!.template.tagline = 'mutated';
        const b = step1Schema.parse({ ...base, coursePage: { mode: null, faqs: [] } });
        expect(b.coursePage!.template.tagline).toBe('');
    });
    it('flags half-filled template rows and over-size content only', () => {
        const c = emptyCoursePageContent();
        c.template.framework.cards = [{ title: '', body: 'x', points: '', takeaway: '' }, { title: '', body: '', points: '', takeaway: '' }];
        c.template.testimonials = [{ quote: 'q', name: '', details: '', review: '' }];
        expect(errs(step1Schema.safeParse({ ...base, coursePage: c }))).toEqual([
            'coursePage.template.framework.cards.0.title: Add a title, or remove this card',
            'coursePage.template.testimonials.0.name: Add the reviewer name',
        ]);
        const big = emptyCoursePageContent();
        big.faqs = Array.from({ length: 30 }, (_, i) => ({ q: `Q${i}`, a: `<p>${'a'.repeat(3500)}</p>` }));
        const r = errs(step1Schema.safeParse({ ...base, coursePage: big }));
        expect(r).toHaveLength(1);
        expect(r[0]).toMatch(/^coursePage.template: Page content is too long/);
    });
});
