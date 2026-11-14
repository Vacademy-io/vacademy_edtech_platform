import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/editor/RichTextEditor', () => ({ RichTextEditor: () => null }));

import { emptyCoursePageTemplate } from '../-utils/course-page-template';
import { step1Schema } from './add-course-step1';

describe('step 1 schema and the page template', () => {
    // Zod drops keys it does not list, which would lose the field on save.
    it('keeps every template field', () => {
        const template = emptyCoursePageTemplate();
        template.heroImageId = 'hero';
        template.aboutImageId = 'about';
        template.framework.eyebrow = 'small';
        template.framework.cards = [
            { title: 'T', subtitle: 'S', body: 'B', points: 'P', takeaway: 'K' },
        ];
        template.learning.eyebrow = 'small';
        template.learning.calloutEyebrow = 'after';
        template.learning.calloutHeading = 'next';
        template.learning.cards = [{ label: 'WATCH', title: 'T', body: 'B' }];
        template.testimonials = [{ stars: '5', quote: 'Q', name: 'N', details: 'D', review: 'R' }];
        template.labels.hero_note = 'note';
        const parsed = step1Schema.safeParse({
            course: 'Course',
            courseMedia: {},
            coursePage: { mode: null, faqs: [], template },
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.coursePage?.template).toEqual(template);
    });

    it('rejects stars outside 1 to 5', () => {
        const template = emptyCoursePageTemplate();
        template.testimonials = [{ stars: '9', quote: 'Q', name: 'N', details: '', review: '' }];
        const parsed = step1Schema.safeParse({
            course: 'Course',
            courseMedia: {},
            coursePage: { mode: null, faqs: [], template },
        });
        expect(parsed.success).toBe(false);
    });
});
