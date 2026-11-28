import { describe, expect, it } from 'vitest';
import {
    describeKeptSettings,
    keepUnmentionedProps,
    mergeSectionVersion,
    parseSectionJson,
} from './section-edits';

describe('parseSectionJson', () => {
    it('accepts an object', () => {
        expect(parseSectionJson('{ "title": "Courses", "hero": { "enabled": true } }')).toEqual({
            ok: true,
            value: { title: 'Courses', hero: { enabled: true } },
        });
    });

    it('refuses arrays, plain values and null', () => {
        for (const text of ['[]', '"x"', '3', 'null']) {
            expect(parseSectionJson(text)).toEqual({ ok: false, error: 'not-object' });
        }
    });

    it('reports where a typo is', () => {
        const result = parseSectionJson('{\n  "title": "Courses",\n  "hero": }\n}');
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toBeTruthy();
        expect([result.line, result.column]).toEqual([3, 11]);
    });

    it('points at a trailing comma and an unclosed string', () => {
        const trailing = parseSectionJson('{\n  "a": [1, 2,]\n}');
        expect(trailing.ok || [trailing.line, trailing.column]).toEqual([2, 14]);
        const open = parseSectionJson('{ "a": "x }');
        expect(open.ok || [open.line, open.column]).toEqual([1, 12]);
    });
});

describe('keepUnmentionedProps', () => {
    it('keeps what the new props leave out, at any depth, and lists it', () => {
        const { props, kept } = keepUnmentionedProps(
            {
                title: 'Old',
                hero: { enabled: true, title: 'All courses' },
                render: {
                    layout: 'grid',
                    cardStyle: 'editorial',
                    card: { ctaLabels: { paid: 'View' } },
                },
                columnSections: [{ id: 'free' }],
            },
            { title: 'New', render: { layout: 'list', cardFields: [] } }
        );
        expect(props).toEqual({
            title: 'New',
            hero: { enabled: true, title: 'All courses' },
            render: {
                layout: 'list',
                cardFields: [],
                cardStyle: 'editorial',
                card: { ctaLabels: { paid: 'View' } },
            },
            columnSections: [{ id: 'free' }],
        });
        expect(kept).toEqual(['hero', 'render.cardStyle', 'render.card', 'columnSections']);
    });

    it('takes arrays and values from the new props', () => {
        expect(
            keepUnmentionedProps(
                { steps: [1, 2, 3], variant: 'cards' },
                { steps: [1], variant: 'plain' }
            )
        ).toEqual({ props: { steps: [1], variant: 'plain' }, kept: [] });
    });
});

describe('mergeSectionVersion', () => {
    it('merges a version of the same section type', () => {
        const { patch, kept } = mergeSectionVersion(
            {
                type: 'courseCatalog',
                props: { title: '', hero: { enabled: true } },
                style: { padding: 'lg' },
            },
            { type: 'courseCatalog', props: { title: 'Browse' }, style: { padding: 'sm' } }
        );
        expect(patch).toEqual({
            type: 'courseCatalog',
            props: { title: 'Browse', hero: { enabled: true } },
            style: { padding: 'sm' },
        });
        expect(kept).toEqual(['hero']);
    });

    it('a version without a picture or colours drops them (the light design applies)', () => {
        const WHITE = '#fff'; // design-lint-ignore: fixture colour
        const DARK = '#111'; // design-lint-ignore: fixture colour
        const BLUE = '#06c'; // design-lint-ignore: fixture colour
        const { patch, kept } = mergeSectionVersion(
            {
                type: 'ctaBanner',
                props: {
                    heading: 'Join',
                    backgroundImage: 'https://cdn.example/dark.jpg',
                    textColor: WHITE,
                    backgroundColor: DARK,
                    left: { title: 'x', imageUrl: 'https://cdn.example/a.png', badge: 'New' },
                    statChip: { label: '10k learners' },
                },
            },
            { type: 'ctaBanner', props: { heading: 'Start today', buttonColor: BLUE, left: { title: 'y' } } }
        );
        expect(patch.props).toEqual({
            heading: 'Start today',
            buttonColor: BLUE,
            left: { title: 'y', badge: 'New' },
            statChip: { label: '10k learners' },
        });
        expect(kept).toEqual(['left.badge', 'statChip']);
    });

    it('replaces a section that changes type', () => {
        const { patch, kept } = mergeSectionVersion(
            { type: 'heroSection', props: { left: { title: 'x' } } },
            { type: 'ctaBanner', props: { heading: 'y' } }
        );
        expect(patch).toEqual({ type: 'ctaBanner', props: { heading: 'y' }, style: undefined });
        expect(kept).toEqual([]);
    });
});

describe('describeKeptSettings', () => {
    it('names each kept setting by its last part, in words, once', () => {
        expect(
            describeKeptSettings([
                'hero',
                'filterSidebar',
                'render.cardStyle',
                'card.cardStyle',
                'x_y',
            ])
        ).toEqual(['hero', 'filter sidebar', 'card style', 'x y']);
        expect(describeKeptSettings([])).toEqual([]);
    });
});
