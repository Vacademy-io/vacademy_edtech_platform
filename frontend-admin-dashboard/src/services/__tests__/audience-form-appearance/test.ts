import { describe, expect, it } from 'vitest';
import {
    applyFormAppearance,
    DEFAULT_FORM_APPEARANCE,
    FORM_APPEARANCE_KEY,
    isDefaultFormAppearance,
    MAX_FORM_HIGHLIGHTS,
    normalizeFormAppearance,
    parseFormAppearance,
    validateFormAppearance,
} from '../../audience-form-appearance';
import { POST_SUBMIT_CONFIG_KEY } from '../../audience-post-submit-settings';

const CONFIG = {
    ...DEFAULT_FORM_APPEARANCE,
    layout: 'split' as const,
    width: 'wide' as const,
    background: 'muted' as const,
    accent: 'info' as const,
    cardStyle: 'outlined' as const,
    eyebrow: 'Admissions 2026',
    headline: 'Talk to our team',
    formTitle: 'Your details',
    submitLabel: 'Request a callback',
    highlights: [{ id: 'h1', icon: 'shield' as const, text: 'We never share your details' }],
    footerNote: '<p>Questions? hello@example.com</p>',
};

describe('parseFormAppearance', () => {
    it.each([
        ['undefined', undefined],
        ['null', null],
        ['empty', ''],
        ['whitespace', '   '],
        ['malformed JSON', '{not json'],
        ['a JSON array', '[1,2,3]'],
        ['an unrelated blob', `{"${POST_SUBMIT_CONFIG_KEY}":{"enabled":true}}`],
        ['a null appearance', `{"${FORM_APPEARANCE_KEY}":null}`],
    ])('falls back to the defaults for %s', (_label, settingJson) => {
        expect(parseFormAppearance(settingJson as string | null | undefined)).toEqual(
            DEFAULT_FORM_APPEARANCE
        );
    });

    it('round-trips a saved appearance', () => {
        const json = applyFormAppearance(null, CONFIG);
        expect(parseFormAppearance(json)).toEqual(CONFIG);
    });
});

describe('normalizeFormAppearance', () => {
    it('replaces unrecognised enum values with the defaults', () => {
        const parsed = normalizeFormAppearance({
            layout: 'carousel',
            width: 'gigantic',
            background: 'rainbow',
            accent: 'chartreuse',
            cardStyle: 'brutalist',
        });
        expect(parsed).toMatchObject({
            layout: DEFAULT_FORM_APPEARANCE.layout,
            width: DEFAULT_FORM_APPEARANCE.width,
            background: DEFAULT_FORM_APPEARANCE.background,
            accent: DEFAULT_FORM_APPEARANCE.accent,
            cardStyle: DEFAULT_FORM_APPEARANCE.cardStyle,
        });
    });

    it('honours booleans and ignores non-booleans', () => {
        // Each value flips its own default, so nothing passes by falling through.
        expect(
            normalizeFormAppearance({
                showDescription: false,
                showProgress: true,
                showRequiredLegend: true,
            })
        ).toMatchObject({
            showDescription: false,
            showProgress: true,
            showRequiredLegend: true,
        });
        expect(normalizeFormAppearance({ showDescription: 'no', showProgress: 1 })).toMatchObject({
            showDescription: DEFAULT_FORM_APPEARANCE.showDescription,
            showProgress: DEFAULT_FORM_APPEARANCE.showProgress,
        });
    });

    it('caps a runaway string rather than storing it', () => {
        const normalized = normalizeFormAppearance({
            eyebrow: 'x'.repeat(5000),
            headline: 'x'.repeat(9000),
            formSubtitle: 'x'.repeat(9000),
        });
        expect(normalized.eyebrow).toHaveLength(500);
        // Rich-text fields get the learner's larger cap — markup is longer
        // than its words, and a cut at 500 would split a tag.
        expect(normalized.headline).toHaveLength(5000);
        expect(normalized.formSubtitle).toHaveLength(5000);
    });

    it('keeps a rich-text heading intact and reads the alignments', () => {
        const headline = `<p><strong>${'Fill this form '.repeat(40)}</strong></p>`;
        const normalized = normalizeFormAppearance({
            headline,
            headingAlign: 'center',
            formHeaderAlign: 'sideways',
        });
        expect(normalized.headline).toBe(headline);
        expect(normalized.headingAlign).toBe('center');
        expect(normalized.formHeaderAlign).toBe('left');
    });

    it('keeps blank highlight rows — the admin is still typing into them', () => {
        const parsed = normalizeFormAppearance({
            highlights: [{ id: 'a', icon: 'clock', text: '' }],
        });
        expect(parsed.highlights).toEqual([{ id: 'a', icon: 'clock', text: '' }]);
    });

    it(`keeps at most ${MAX_FORM_HIGHLIGHTS} highlights`, () => {
        const parsed = normalizeFormAppearance({
            highlights: Array.from({ length: 20 }, (_, i) => ({ text: `h${i}` })),
        });
        expect(parsed.highlights).toHaveLength(MAX_FORM_HIGHLIGHTS);
    });

    it('falls back to a known icon', () => {
        expect(
            normalizeFormAppearance({ highlights: [{ text: 'x', icon: 'explosion' }] })
                .highlights[0]?.icon
        ).toBe('check');
    });
});

describe('applyFormAppearance', () => {
    it('preserves the rest of setting_json', () => {
        const existing = JSON.stringify({
            [POST_SUBMIT_CONFIG_KEY]: { enabled: true },
            somethingElse: 42,
        });
        const merged = JSON.parse(applyFormAppearance(existing, CONFIG));
        expect(merged[POST_SUBMIT_CONFIG_KEY]).toEqual({ enabled: true });
        expect(merged.somethingElse).toBe(42);
        expect(merged[FORM_APPEARANCE_KEY].headline).toBe('Talk to our team');
    });

    it('survives an unparsable existing blob rather than throwing', () => {
        const merged = JSON.parse(applyFormAppearance('{not json', CONFIG));
        expect(merged[FORM_APPEARANCE_KEY].headline).toBe('Talk to our team');
    });

    it('drops blank highlight rows on the way out', () => {
        const merged = JSON.parse(
            applyFormAppearance(null, {
                ...CONFIG,
                highlights: [
                    { id: 'a', icon: 'shield', text: 'Kept' },
                    { id: 'b', icon: 'clock', text: '   ' },
                ],
            })
        );
        expect(merged[FORM_APPEARANCE_KEY].highlights).toEqual([
            { id: 'a', icon: 'shield', text: 'Kept' },
        ]);
    });

    it('composes with the post-submit helper in either order', () => {
        // The campaign form chains these on one save; neither may clobber the other.
        const postSubmitBlob = JSON.stringify({ [POST_SUBMIT_CONFIG_KEY]: { enabled: true } });
        const merged = JSON.parse(applyFormAppearance(postSubmitBlob, CONFIG));
        expect(merged[POST_SUBMIT_CONFIG_KEY]).toBeDefined();
        expect(merged[FORM_APPEARANCE_KEY]).toBeDefined();
    });
});

describe('validateFormAppearance', () => {
    it('accepts an appearance with no cover image', () => {
        expect(validateFormAppearance(DEFAULT_FORM_APPEARANCE)).toBeNull();
    });

    it.each(['https://cdn.example.com/a.png', 'http://cdn.example.com/a.png', '/assets/a.png'])(
        'accepts %s',
        (coverImageUrl) => {
            expect(
                validateFormAppearance({ ...DEFAULT_FORM_APPEARANCE, coverImageUrl })
            ).toBeNull();
        }
    );

    it.each(['javascript:alert(1)', 'data:text/html;base64,x', '//evil.example.com/a.png'])(
        'blocks the save for %s',
        (coverImageUrl) => {
            expect(validateFormAppearance({ ...DEFAULT_FORM_APPEARANCE, coverImageUrl })).toContain(
                'Cover image'
            );
        }
    );
});

describe('isDefaultFormAppearance', () => {
    it('is true for the shipped defaults', () => {
        expect(isDefaultFormAppearance(DEFAULT_FORM_APPEARANCE)).toBe(true);
    });

    it('is true when the only highlights are blank rows', () => {
        expect(
            isDefaultFormAppearance({
                ...DEFAULT_FORM_APPEARANCE,
                highlights: [{ id: 'a', icon: 'check', text: '  ' }],
            })
        ).toBe(true);
    });

    it.each([
        ['layout', { layout: 'split' as const }],
        ['accent', { accent: 'info' as const }],
        ['formTitle', { formTitle: 'Your details' }],
        ['headline', { headline: '<p>Fill this form</p>' }],
        ['headingAlign', { headingAlign: 'center' as const }],
        ['formHeaderAlign', { formHeaderAlign: 'right' as const }],
        ['showObjective', { showObjective: false }],
        ['showProgress', { showProgress: true }],
    ])('is false once %s is customised', (_label, changes) => {
        expect(isDefaultFormAppearance({ ...DEFAULT_FORM_APPEARANCE, ...changes })).toBe(false);
    });
});

describe('the custom HTML / CSS escape hatch', () => {
    it('is empty by default, so no campaign styles itself by accident', () => {
        expect(DEFAULT_FORM_APPEARANCE.heroHtml).toBe('');
        expect(DEFAULT_FORM_APPEARANCE.customCss).toBe('');
    });

    it('round-trips markup untouched — the learner app sanitizes at render', () => {
        const config = {
            ...DEFAULT_FORM_APPEARANCE,
            heroHtml: '<h1 class="x">Hi</h1>',
            customCss: '.vac-af-page > .vac-af-card { border-radius: 24px; }',
        };
        expect(parseFormAppearance(applyFormAppearance(null, config))).toEqual(config);
    });

    it('is not length-capped like a label — a stylesheet is longer than 500 chars', () => {
        const customCss = '.a{color:red}'.repeat(200);
        expect(normalizeFormAppearance({ customCss }).customCss).toBe(customCss);
    });

    it('ignores non-strings', () => {
        expect(normalizeFormAppearance({ heroHtml: 42, customCss: {} })).toMatchObject({
            heroHtml: '',
            customCss: '',
        });
    });

    it.each([
        ['heroHtml', { heroHtml: '<h1>Hi</h1>' }],
        ['customCss', { customCss: '.a{color:red}' }],
    ])('makes the campaign read as customised once %s is set', (_label, changes) => {
        expect(isDefaultFormAppearance({ ...DEFAULT_FORM_APPEARANCE, ...changes })).toBe(false);
    });

    it('still reads as default when the boxes hold only whitespace', () => {
        expect(
            isDefaultFormAppearance({
                ...DEFAULT_FORM_APPEARANCE,
                heroHtml: '   ',
                customCss: '\n',
            })
        ).toBe(true);
    });
});
