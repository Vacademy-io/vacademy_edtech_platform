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
        { title: 'Observe', body: 'Look first', points: ' See \n\n Note ', takeaway: '' },
        { title: '', body: '', points: '', takeaway: '' },
    ];
    t.learning.callout = '<p></p>';
    t.testimonials = [
        { quote: 'Loved it', name: 'A. Learner', details: '', review: '' },
        { quote: ' ', name: '', details: '', review: '' },
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
            body: 'Look first',
            points: 'See\nNote',
            takeaway: '',
        });
        expect(back.template.inclusions.items).toBe('Videos\nWorksheets');
        expect(back.template.enrolment.imageId).toBe('file-1');
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
