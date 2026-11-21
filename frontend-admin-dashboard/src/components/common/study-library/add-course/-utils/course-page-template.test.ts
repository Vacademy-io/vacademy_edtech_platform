import { describe, expect, it } from 'vitest';

import { buildCoursePageJson, parseCoursePageJson } from './course-page-content';
import {
    countTemplateBlocks,
    emptyCoursePageTemplate,
    parseCoursePageTemplate,
    serializeCoursePageTemplate,
} from './course-page-template';

const filled = () => {
    const t = emptyCoursePageTemplate();
    t.tagline = '  A calm start  ';
    t.framework.heading = 'The method';
    t.framework.cards = [
        { title: 'Observe', subtitle: '', body: 'Look first', points: ' See \n\n Note ', takeaway: '' },
        { title: '', subtitle: '', body: '', points: '', takeaway: '' },
    ];
    t.learning.callout = '<p></p>';
    t.testimonials = [
        { stars: '', quote: 'Loved it', name: 'A. Learner', details: '', review: '' },
        { stars: '', quote: ' ', name: '', details: '', review: '' },
    ];
    t.enrolment.imageId = 'file-1';
    t.inclusions.items = 'Videos\nWorksheets\n';
    return t;
};

describe('serializeCoursePageTemplate', () => {
    it('is null when nothing is filled in', () => {
        expect(serializeCoursePageTemplate(emptyCoursePageTemplate())).toBeNull();
        expect(serializeCoursePageTemplate(undefined)).toBeNull();
        expect(countTemplateBlocks(emptyCoursePageTemplate())).toBe(0);
    });

    it('keeps only filled values, trims, splits lines and drops empty rows', () => {
        expect(serializeCoursePageTemplate(filled())).toEqual({
            tagline: 'A calm start',
            framework: {
                heading: 'The method',
                cards: [{ title: 'Observe', body: 'Look first', points: ['See', 'Note'] }],
            },
            testimonials: [{ quote: 'Loved it', name: 'A. Learner' }],
            enrolment: { image_id: 'file-1' },
            inclusions: { items: ['Videos', 'Worksheets'] },
        });
        expect(countTemplateBlocks(filled())).toBe(5);
    });
});

describe('course_page_json with template', () => {
    it('stores the template next to mode and FAQs and reads it back', () => {
        const json = buildCoursePageJson(
            { mode: null, faqs: [], template: filled() },
            { isEdit: true, storedValueLoaded: true }
        );
        expect(JSON.parse(json as string).template.tagline).toBe('A calm start');
        const back = parseCoursePageJson(json);
        expect(back.template.framework.cards[0]).toEqual({
            title: 'Observe',
            subtitle: '',
            body: 'Look first',
            points: 'See\nNote',
            takeaway: '',
        });
        expect(back.template.inclusions.items).toBe('Videos\nWorksheets');
        expect(back.template.enrolment.imageId).toBe('file-1');
    });

    it('keeps the main image, small lines, subtitles, card labels and stars', () => {
        const t = emptyCoursePageTemplate();
        t.heroImageId = 'hero-1';
        t.aboutImageId = 'about-1';
        t.framework.eyebrow = 'The method';
        t.framework.cards = [
            { title: 'See', subtitle: 'Look first', body: '', points: '', takeaway: '' },
        ];
        t.learning.eyebrow = 'Daily';
        t.learning.calloutEyebrow = 'After';
        t.learning.calloutHeading = 'Next step';
        t.learning.cards = [{ label: 'WATCH', title: 'Videos', body: '' }];
        t.testimonials = [{ stars: '5', quote: 'Q', name: 'N', details: '', review: '' }];
        expect(serializeCoursePageTemplate(t)).toEqual({
            hero_image_id: 'hero-1',
            about_image_id: 'about-1',
            framework: {
                eyebrow: 'The method',
                cards: [{ title: 'See', subtitle: 'Look first' }],
            },
            learning_experience: {
                eyebrow: 'Daily',
                callout_eyebrow: 'After',
                callout_heading: 'Next step',
                cards: [{ label: 'WATCH', title: 'Videos' }],
            },
            testimonials: [{ stars: 5, quote: 'Q', name: 'N' }],
        });
        const back = parseCoursePageTemplate(serializeCoursePageTemplate(t));
        expect(back.heroImageId).toBe('hero-1');
        expect(back.aboutImageId).toBe('about-1');
        expect(back.framework.cards[0]?.subtitle).toBe('Look first');
        expect(back.learning.cards[0]?.label).toBe('WATCH');
        expect(back.learning.calloutHeading).toBe('Next step');
        expect(back.testimonials[0]?.stars).toBe('5');
    });

    it('drops stars outside 1 to 5', () => {
        const t = emptyCoursePageTemplate();
        t.testimonials = [{ stars: '9', quote: 'Q', name: 'N', details: '', review: '' }];
        expect(serializeCoursePageTemplate(t)).toEqual({ testimonials: [{ quote: 'Q', name: 'N' }] });
        expect(
            parseCoursePageTemplate({ testimonials: [{ stars: 'x', quote: 'Q', name: 'N' }] })
                .testimonials[0]?.stars
        ).toBe('');
    });

    it('clears on edit when template, FAQs and mode are all empty', () => {
        expect(
            buildCoursePageJson(
                { mode: null, faqs: [], template: emptyCoursePageTemplate() },
                { isEdit: true, storedValueLoaded: true }
            )
        ).toBe('');
    });

    it('stores headings and button text under labels and reads them back', () => {
        const t = emptyCoursePageTemplate();
        t.labels.about = '  About the course ';
        t.labels.enrol_button = 'Start the journey';
        expect(serializeCoursePageTemplate(t)).toEqual({
            labels: { about: 'About the course', enrol_button: 'Start the journey' },
        });
        const json = buildCoursePageJson(
            { mode: null, faqs: [], template: t },
            { isEdit: true, storedValueLoaded: true }
        );
        const back = parseCoursePageJson(json).template.labels;
        expect(back.about).toBe('About the course');
        expect(back.enrol_button).toBe('Start the journey');
        expect(back.faq).toBe('');
        // a stored key the form does not know is dropped, not kept
        expect(
            parseCoursePageTemplate({ labels: { faq: 'FAQs', other: 'x', about: 3 } }).labels
        ).toEqual({
            ...emptyCoursePageTemplate().labels,
            faq: 'FAQs',
        });
    });

    it('reads malformed template values as empty', () => {
        expect(parseCoursePageTemplate({ framework: 'x', testimonials: [null, 3] })).toEqual(
            emptyCoursePageTemplate()
        );
    });
});
