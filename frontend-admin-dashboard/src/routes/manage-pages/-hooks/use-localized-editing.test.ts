import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useEditorStore } from '../-stores/editor-store';
import type { CatalogueConfig } from '../-types/editor-types';
import { localizeDeep } from '../-utils/catalogue-i18n';
import { enableBadges } from '../-components/catalog/catalog-discovery-props';
import {
    REFUSAL_RESYNC_MIN_MS,
    activeEditingLocale,
    buildLocalizedView,
    decideLocalizedEdit,
    delocalizeSwapProps,
    restoreSlotsFromBase,
    reverseDictionary,
    useLocalizedEditNotice,
    useLocalizedEditing,
    useLocalizedPanelKey,
} from './use-localized-editing';

/**
 * The builder's Hindi editing mode at the PropertyPanel seam. English mode
 * must be a strict passthrough (the panel's render tests mock the store as a
 * plain function); Hindi mode must route text into the dictionary and
 * everything else into the shared base, atomically, and refuse the edits a
 * dictionary cannot represent.
 */

const HI = {
    'Learn the Indian way': 'भारतीय तरीके से सीखें',
    Courses: 'कोर्स',
    Course: 'कोर्स',
    'Live classes': 'लाइव कक्षाएं',
    'Smart Academy': 'स्मार्ट अकादमी',
    'Home of learning': 'सीखने का घर',
    New: 'नया',
};

const makeConfig = (): CatalogueConfig =>
    ({
        globalSettings: {
            courseCatalogeType: { enabled: true, value: 'Course' },
            mode: 'light',
            compactness: 'medium',
            audience: 'all',
            leadCollection: { enabled: false, mandatory: false, inviteLink: null, fields: [] },
            payment: { enabled: false, provider: 'razorpay', fields: [] },
            layout: {
                header: {
                    type: 'header',
                    enabled: true,
                    props: {
                        title: 'Smart Academy',
                        navigation: [{ label: 'Courses', route: 'courses' }],
                    },
                },
                footer: {
                    type: 'footer',
                    enabled: true,
                    props: { bottomNote: 'All rights reserved' },
                },
            },
            i18n: {
                enabled: false,
                defaultLocale: 'en',
                locales: [
                    { code: 'en', label: 'EN' },
                    { code: 'hi', label: 'हिन्दी' },
                ],
                strings: { hi: { ...HI } },
            },
        },
        pages: [
            {
                id: 'home',
                route: 'home',
                title: 'Home',
                seo: { metaTitle: 'Home of learning', metaDescription: '' },
                components: [
                    {
                        id: 'hero',
                        type: 'heroSection',
                        enabled: true,
                        props: {
                            title: 'Learn the Indian way',
                            subtitle: '',
                            eyebrow: 'New',
                            showBadge: true,
                            layout: 'split',
                            features: [
                                { title: 'Live classes', icon: 'star' },
                                { title: 'Recorded lessons', icon: 'play' },
                            ],
                        },
                    },
                    {
                        id: 'cols',
                        type: 'columnLayout',
                        enabled: true,
                        props: {
                            columns: 2,
                            slots: [
                                [
                                    {
                                        id: 'txt',
                                        type: 'textBlock',
                                        enabled: true,
                                        props: { content: 'Courses' },
                                    },
                                ],
                                [],
                            ],
                        },
                    },
                ],
            },
        ],
    }) as unknown as CatalogueConfig;

const heroOf = (config: CatalogueConfig | null) => config!.pages[0]!.components[0]!;
const strings = () => useEditorStore.getState().config!.globalSettings.i18n!.strings!.hi!;

/* ── which language is being edited ─────────────────────────────────── */

describe('activeEditingLocale', () => {
    const i18n = makeConfig().globalSettings.i18n;
    it('is null for the base language, nothing chosen, or a language the site does not offer', () => {
        expect(activeEditingLocale(i18n, null)).toBeNull();
        expect(activeEditingLocale(i18n, 'en')).toBeNull();
        expect(activeEditingLocale(i18n, 'mr')).toBeNull();
        expect(
            activeEditingLocale({ ...i18n, locales: [{ code: 'en', label: 'EN' }] }, 'hi')
        ).toBeNull();
        expect(activeEditingLocale(undefined, 'hi')).toBeNull();
    });
    it('accepts an offered language, enabled for visitors or not (translations are prepared before going live)', () => {
        expect(activeEditingLocale(i18n, 'hi')).toBe('hi');
        expect(activeEditingLocale({ ...i18n, enabled: true }, 'HI')).toBe('hi');
    });
});

/* ── the localized view ─────────────────────────────────────────────── */

describe('buildLocalizedView', () => {
    it('localizes sections, column children, page SEO and the global header — never other site settings', () => {
        const config = makeConfig();
        const view = buildLocalizedView(config, 'hi')!;
        expect(heroOf(view).props.title).toBe('भारतीय तरीके से सीखें');
        expect(view.pages[0]!.components[1]!.props.slots[0][0].props.content).toBe('कोर्स');
        expect(view.pages[0]!.seo!.metaTitle).toBe('सीखने का घर');
        expect(view.globalSettings.layout!.header.props.title).toBe('स्मार्ट अकादमी');
        expect(view.globalSettings.layout!.header.props.navigation[0]).toEqual({
            label: 'कोर्स',
            route: 'courses',
        });
        // 'Course' has a translation, but courseCatalogeType.value is data.
        expect(view.globalSettings.courseCatalogeType.value).toBe('Course');
        // Untouched parts keep their identity; the base config is not mutated.
        expect(view.globalSettings.layout!.footer).toBe(config.globalSettings.layout!.footer);
        expect(heroOf(view).props.features[1]).toBe(heroOf(config).props.features[1]);
        expect(heroOf(config).props.title).toBe('Learn the Indian way');
    });

    it('is one shared object per (config, language), and the config itself without a dictionary', () => {
        const config = makeConfig();
        expect(buildLocalizedView(config, 'hi')).toBe(buildLocalizedView(config, 'hi'));
        expect(buildLocalizedView(config, 'ta')).toBe(config);
        expect(buildLocalizedView(config, null)).toBe(config);
    });
});

/* ── splitting one edit ─────────────────────────────────────────────── */

describe('decideLocalizedEdit', () => {
    // base = the stored props; view = the exact localized object an editor renders from.
    const setup = () => {
        const config = makeConfig();
        return {
            base: heroOf(config).props,
            view: heroOf(buildLocalizedView(config, 'hi')).props,
            reverse: reverseDictionary(HI),
        };
    };

    it('a text edit becomes a dictionary entry; the base keeps its text', () => {
        const { base, view, reverse } = setup();
        const d = decideLocalizedEdit(
            base,
            view,
            { ...view, title: 'भारतीय तरीके से सीखिए' },
            reverse
        );
        expect(d).toMatchObject({
            kind: 'commit',
            translations: { 'Learn the Indian way': 'भारतीय तरीके से सीखिए' },
        });
        if (d.kind !== 'commit') throw new Error();
        expect(d.base.title).toBe('Learn the Indian way');
        expect(d.base.features).toBe(base.features);
    });

    it('a toggle edits the shared base and records no translation', () => {
        const { base, view, reverse } = setup();
        const d = decideLocalizedEdit(base, view, { ...view, showBadge: false }, reverse);
        expect(d).toMatchObject({ kind: 'commit', translations: {} });
        if (d.kind !== 'commit') throw new Error();
        expect(d.base.showBadge).toBe(false);
        expect(d.base.title).toBe('Learn the Indian way');
    });

    it('removing an item matches it by identity and removes the right BASE item', () => {
        const { base, view, reverse } = setup();
        const d = decideLocalizedEdit(
            base,
            view,
            { ...view, features: view.features.filter((_: unknown, i: number) => i !== 0) },
            reverse
        );
        if (d.kind !== 'commit') throw new Error(d.kind);
        expect(d.translations).toEqual({});
        expect(d.base.features).toEqual([{ title: 'Recorded lessons', icon: 'play' }]);
    });

    it('reordering keeps base text with each item', () => {
        const { base, view, reverse } = setup();
        const d = decideLocalizedEdit(
            base,
            view,
            { ...view, features: [view.features[1], view.features[0]] },
            reverse
        );
        if (d.kind !== 'commit') throw new Error(d.kind);
        expect(d.translations).toEqual({});
        expect(d.base.features.map((f: { title: string }) => f.title)).toEqual([
            'Recorded lessons',
            'Live classes',
        ]);
    });

    it('duplicating a translated item writes the BASE text into the copy', () => {
        const { base, view, reverse } = setup();
        const copy = JSON.parse(JSON.stringify(view.features[0]));
        const d = decideLocalizedEdit(
            base,
            view,
            { ...view, features: [view.features[0], copy, view.features[1]] },
            reverse
        );
        if (d.kind !== 'commit') throw new Error(d.kind);
        expect(d.base.features.map((f: { title: string }) => f.title)).toEqual([
            'Live classes',
            'Live classes',
            'Recorded lessons',
        ]);
        expect(d.base.features[0]).toBe(base.features[0]);
    });

    it('a duplicated item keeps ITS base text even when two base texts share its translation', () => {
        // 'Courses' and 'Course' are both 'कोर्स': the reverse dictionary cannot
        // tell them apart, so it maps neither; the copy is matched to the item
        // it was copied from instead.
        const reverse = reverseDictionary(HI);
        expect(reverse.has('कोर्स')).toBe(false);
        expect(reverse.get('लाइव कक्षाएं')).toBe('Live classes');
        const base = {
            items: [
                { title: 'Courses', icon: 'book' },
                { title: 'Course', icon: 'cap' },
                { title: 'Live classes', icon: 'cam' },
            ],
        };
        const view = {
            items: [
                { title: 'कोर्स', icon: 'book' },
                { title: 'कोर्स', icon: 'cap' },
                { title: 'लाइव कक्षाएं', icon: 'cam' },
            ],
        };
        const copy = JSON.parse(JSON.stringify(view.items[1]));
        const d = decideLocalizedEdit(
            base,
            view,
            { items: [view.items[0], view.items[1], copy, view.items[2]] },
            reverse
        );
        if (d.kind !== 'commit') throw new Error(d.kind);
        expect(d.translations).toEqual({});
        expect(d.base.items.map((x: { title: string }) => x.title)).toEqual([
            'Courses',
            'Course',
            'Course',
            'Live classes',
        ]);
        // A copy of the base item, never the same object twice.
        expect(d.base.items[2]).not.toBe(base.items[1]);
        expect(d.base.items[1]).toBe(base.items[1]);
    });

    it('a new item is added to the base as is', () => {
        const { base, view, reverse } = setup();
        const d = decideLocalizedEdit(
            base,
            view,
            { ...view, features: [...view.features, { title: 'Doubt sessions', icon: 'q' }] },
            reverse
        );
        if (d.kind !== 'commit') throw new Error(d.kind);
        expect(d.base.features).toHaveLength(3);
        expect(d.base.features[2]).toEqual({ title: 'Doubt sessions', icon: 'q' });
    });

    it('typing into a field that is empty in the base language is refused ("add the English text first")', () => {
        const { base, view, reverse } = setup();
        expect(decideLocalizedEdit(base, view, { ...view, subtitle: 'उपशीर्षक' }, reverse)).toEqual(
            { kind: 'blocked', reason: 'emptySource' }
        );
        expect(decideLocalizedEdit(base, view, { ...view, tagline: 'नई पंक्ति' }, reverse)).toEqual(
            { kind: 'blocked', reason: 'emptySource' }
        );
        // …also when typing creates a whole object (a highlight phrase).
        expect(
            decideLocalizedEdit(
                base,
                view,
                { ...view, highlight: { text: 'खास', style: 'gradient' } },
                reverse
            )
        ).toEqual({ kind: 'blocked', reason: 'emptySource' });
    });

    it.each(['l', '2', '2025', '2025 ', 'naya batch', 'neet', '#1 coaching', '#', ' '])(
        'typing %j into a field that is empty in the base language is refused, however data-like it looks',
        (typed) => {
            // '2025 बैच', 'naya batch' or a lowercase brand begin like data; letting
            // those keystrokes through would write them into the English text.
            const { base, view, reverse } = setup();
            expect(decideLocalizedEdit(base, view, { ...view, subtitle: typed }, reverse)).toEqual({
                kind: 'blocked',
                reason: 'emptySource',
            });
            // …also when typing creates the object that holds the text.
            expect(
                decideLocalizedEdit(base, view, { ...view, highlight: { text: typed } }, reverse)
            ).toEqual({ kind: 'blocked', reason: 'emptySource' });
        }
    );

    it('a link, anchor or colour put into an empty field is shared, so it goes to the base', () => {
        const { base, view, reverse } = setup();
        for (const value of [
            '/courses',
            'https://example.org/a?b=1',
            'mailto:hi@example.org',
            '#contact',
            '#ff6600', // design-lint-ignore: test data — a colour value typed into a field, not styling
            'rgb(0,0,0)',
        ]) {
            const d = decideLocalizedEdit(base, view, { ...view, ctaLink: value }, reverse);
            expect(d).toMatchObject({ kind: 'commit', translations: {} });
            if (d.kind !== 'commit') throw new Error(value);
            expect(d.base.ctaLink).toBe(value);
            expect(d.base.title).toBe('Learn the Indian way');
        }
    });

    it('typing over a value that looks like data (a code) is refused — it is shared by every language', () => {
        const base = { title: 'faq', subtitle: 'Hello there' };
        expect(decideLocalizedEdit(base, base, { ...base, title: 'सामान्य प्रश्न' })).toEqual({
            kind: 'blocked',
            reason: 'sharedData',
        });
    });

    it('clearing a translated field clears the translation, never the base text', () => {
        const { base, view, reverse } = setup();
        expect(view.eyebrow).toBe('नया');
        const d = decideLocalizedEdit(base, view, { ...view, eyebrow: undefined }, reverse);
        expect(d).toMatchObject({ kind: 'commit', translations: { New: '' } });
        if (d.kind !== 'commit') throw new Error();
        expect(d.base.eyebrow).toBe('New');
    });

    it('one action rewriting translated text and settings at once is refused; over untranslated text it is a base edit', () => {
        const { base, view, reverse } = setup();
        expect(
            decideLocalizedEdit(base, view, { ...view, title: 'X', layout: 'centered' }, reverse)
        ).toEqual({ kind: 'blocked', reason: 'bulk' });

        const plain = { html: '<style>.a{}</style><p>Hi there</p>', css: '' };
        const d = decideLocalizedEdit(plain, plain, { html: '<p>Hi there</p>', css: '.a{}' });
        expect(d).toEqual({
            kind: 'commit',
            base: { html: '<p>Hi there</p>', css: '.a{}' },
            translations: {},
        });
    });

    it('removing an object that holds base text is refused (it would vanish in every language)', () => {
        const base: Record<string, unknown> = {
            title: 'Hello there',
            highlight: { text: 'Big news', style: 'mark' },
        };
        expect(decideLocalizedEdit(base, base, { ...base, highlight: undefined })).toEqual({
            kind: 'blocked',
            reason: 'structure',
        });
    });

    it('an unchanged edit is a no-op', () => {
        const { base, view } = setup();
        expect(decideLocalizedEdit(base, view, view)).toEqual({ kind: 'noop' });
        expect(decideLocalizedEdit(base, view, { ...view })).toEqual({ kind: 'noop' });
    });

    it("turning on 'Badges on cards' in a section saved before badges existed is a shared setting, not new text", () => {
        // enableBadges introduces { types: ['bestseller', 'popular', 'new', 'free'], … }:
        // enum tokens, never something typed that needs an English source.
        const base: Record<string, unknown> = { title: 'Our courses', showFilters: true };
        const view = localizeDeep(base, { 'Our courses': 'हमारे कोर्स' });
        const d = decideLocalizedEdit(
            base,
            view,
            { ...view, badges: enableBadges(undefined) },
            reverseDictionary({ 'Our courses': 'हमारे कोर्स' })
        );
        expect(d).toMatchObject({ kind: 'commit', translations: {} });
        if (d.kind !== 'commit') throw new Error(d.kind);
        expect(d.base.title).toBe('Our courses');
        expect(d.base.badges).toMatchObject({
            enabled: true,
            types: ['bestseller', 'popular', 'new', 'free'],
        });
    });

    it('column children carried back by a layout edit are the base ones (matched by id)', () => {
        const config = makeConfig();
        const view = buildLocalizedView(config, 'hi')!;
        const viewSlots = view.pages[0]!.components[1]!.props.slots;
        const baseSlots = config.pages[0]!.components[1]!.props.slots;
        const restored = restoreSlotsFromBase([...viewSlots, []], baseSlots) as unknown[][];
        expect(restored[0]![0]).toBe(baseSlots[0][0]);
        expect(restored).toHaveLength(3);
    });
});

describe('decideLocalizedEdit — a tag is copy in some lists and data elsewhere', () => {
    const TAGS = {
        News: 'समाचार',
        Latest: 'ताज़ा',
        'Flagship Program': 'प्रमुख कार्यक्रम',
    };
    const reverse = reverseDictionary(TAGS);

    it("an announcement's tag pill is translated like any text: a dictionary entry, the English base kept", () => {
        const base = {
            headerText: 'Latest',
            announcements: [{ title: 'Latest', date: '2025-01-15', summary: '', tag: 'News' }],
        };
        const view = localizeDeep(base, TAGS);
        expect(view.announcements[0]!.tag).toBe('समाचार');
        const edited = {
            ...view,
            announcements: [{ ...view.announcements[0]!, tag: 'खबर' }],
        };
        const d = decideLocalizedEdit(base, view, edited, reverse);
        expect(d).toMatchObject({ kind: 'commit', translations: { News: 'खबर' } });
        if (d.kind !== 'commit') throw new Error(d.kind);
        expect(d.base).toEqual(base);
    });

    it("a detail block's eyebrow too — and an eyebrow that is empty in English cannot be typed in Hindi", () => {
        const base = {
            blocks: [
                { title: 'Flagship Program', tag: 'Flagship Program', items: [] },
                { title: 'Latest', tag: '', items: [] },
            ],
        };
        const view = localizeDeep(base, TAGS);
        const retag = (i: number, tag: string) => ({
            ...view,
            blocks: view.blocks.map((b, j) => (j === i ? { ...b, tag } : b)),
        });
        const d = decideLocalizedEdit(base, view, retag(0, 'मुख्य कार्यक्रम'), reverse);
        expect(d).toMatchObject({
            kind: 'commit',
            translations: { 'Flagship Program': 'मुख्य कार्यक्रम' },
        });
        if (d.kind !== 'commit') throw new Error(d.kind);
        expect(d.base.blocks[0]!.tag).toBe('Flagship Program');
        expect(decideLocalizedEdit(base, view, retag(1, 'नया'), reverse)).toEqual({
            kind: 'blocked',
            reason: 'emptySource',
        });
    });

    it('anything typed over a course tag to filter by (data) is refused, never written into the base', () => {
        const base: Record<string, unknown> = { title: 'Latest', source: 'tag', tag: 'Featured' };
        const view = localizeDeep(base, TAGS);
        expect(view.tag).toBe('Featured');
        // A Hindi word, a first keystroke, a longer phrase, a lowercase code:
        // the filter is shared, so another language cannot retype it at all.
        for (const typed of ['विशेष', 'F', 'Featured courses', 'f', 'featured-2026']) {
            expect(decideLocalizedEdit(base, view, { ...view, tag: typed }, reverse)).toEqual({
                kind: 'blocked',
                reason: 'sharedData',
            });
        }
        // Clearing it to type afresh would empty the filter for every language.
        for (const cleared of ['', undefined]) {
            expect(decideLocalizedEdit(base, view, { ...view, tag: cleared }, reverse)).toEqual({
                kind: 'blocked',
                reason: 'sharedData',
            });
        }
    });

    it('typing a tag into an empty filter is refused from the first keystroke, so no half-typed tag is stored', () => {
        // Each keystroke that got through would become the next one's base:
        // letting 'J' through and refusing 'JE' would leave 'J' as the filter
        // of every language.
        const base: Record<string, unknown> = { title: 'Latest', source: 'tag', tag: '' };
        for (const typed of ['J', '2', 'j']) {
            expect(decideLocalizedEdit(base, base, { ...base, tag: typed }, reverse)).toEqual({
                kind: 'blocked',
                reason: 'sharedData',
            });
        }
        // An editor writing an empty default on mount is no change.
        const unset: Record<string, unknown> = { title: 'Latest', source: 'tag' };
        expect(decideLocalizedEdit(unset, unset, { ...unset, tag: '' }, reverse)).toMatchObject({
            kind: 'commit',
            translations: {},
        });
    });

    it("a stream tab's tag is refused even when its URL key changes with it, and so is a level filter value", () => {
        const base = {
            streams: {
                enabled: true,
                source: 'tags',
                items: [{ label: 'Latest', slug: 'jee', tag: 'JEE' }],
            },
            buy: { buttonLabel: 'Latest', levelFilterValue: 'Buy' },
        };
        const view = localizeDeep(base, TAGS);
        const tab = view.streams.items[0]!;
        // The tab editor re-derives the URL key from the tag as it is typed
        // ('ज' has no Latin letters: the key empties) — two values in one edit.
        const retagged = {
            ...view,
            streams: { ...view.streams, items: [{ ...tab, tag: 'ज', slug: '' }] },
        };
        expect(decideLocalizedEdit(base, view, retagged, reverse)).toEqual({
            kind: 'blocked',
            reason: 'sharedData',
        });
        const relevelled = { ...view, buy: { ...view.buy, levelFilterValue: 'खरीदें' } };
        expect(decideLocalizedEdit(base, view, relevelled, reverse)).toEqual({
            kind: 'blocked',
            reason: 'sharedData',
        });
        // The tab's label is copy: a dictionary entry, the tag and key untouched.
        const relabelled = {
            ...view,
            streams: { ...view.streams, items: [{ ...tab, label: 'नवीनतम' }] },
        };
        const d = decideLocalizedEdit(base, view, relabelled, reverse);
        expect(d).toMatchObject({ kind: 'commit', translations: { Latest: 'नवीनतम' } });
        if (d.kind !== 'commit') throw new Error(d.kind);
        expect(d.base).toEqual(base);
    });

    it('data values that are not prose still change in any language (codes, links, icon picks)', () => {
        const coded: Record<string, unknown> = {
            title: 'Latest',
            productPageCode: 'neet-2026',
            ctaLink: '/a',
        };
        const d = decideLocalizedEdit(
            coded,
            coded,
            { ...coded, productPageCode: 'jee-2026' },
            reverse
        );
        expect(d).toMatchObject({ kind: 'commit', translations: {} });
        if (d.kind !== 'commit') throw new Error(d.kind);
        expect(d.base.productPageCode).toBe('jee-2026');

        const features = {
            features: [{ title: 'Latest', iconName: 'GraduationCap', icon: '🎓' }],
        };
        const view = localizeDeep(features, TAGS);
        for (const [key, value] of [
            ['iconName', 'Rocket'],
            ['icon', '🚀'],
        ] as const) {
            const picked = decideLocalizedEdit(
                features,
                view,
                { ...view, features: [{ ...view.features[0]!, [key]: value }] },
                reverse
            );
            expect(picked).toMatchObject({ kind: 'commit', translations: {} });
            if (picked.kind !== 'commit') throw new Error(key);
            expect(picked.base.features[0]).toEqual({ ...features.features[0], [key]: value });
        }
    });
});

describe('decideLocalizedEdit — picking another product page in हिन्दी', () => {
    // The pickers write the page code and its cached name in one edit
    // (ProductPageOfferEditor, LearningPathEditor). The cached name is the
    // page's own name, which the Translations panel offers as a live text, so
    // it is often translated already: the pick must still reach the base.
    const DICT = {
        'JEE Store': 'जेईई स्टोर',
        'Courses on offer': 'ऑफ़र पर कोर्स',
        'Learning paths': 'सीखने के रास्ते',
    };
    const reverse = reverseDictionary(DICT);
    const sections: Array<[string, Record<string, unknown>]> = [
        [
            'productPageOffer',
            {
                productPageCode: 'jee-store',
                productPageName: 'JEE Store',
                title: 'Courses on offer',
                columns: 3,
                showViewAll: true,
            },
        ],
        [
            'learningPath',
            {
                mode: 'single',
                productPageCode: 'jee-store',
                productPageName: 'JEE Store',
                libraryId: '',
                libraryName: '',
                title: 'Learning paths',
            },
        ],
    ];

    it.each(sections)(
        'a %s section takes the new page code and cached name for every language, with the name translated',
        (_type, base) => {
            const view = localizeDeep(base, DICT);
            // The cached name is builder data, shown as stored; the title is copy.
            expect(view.productPageName).toBe('JEE Store');
            expect(view.title).not.toBe(base.title);
            const d = decideLocalizedEdit(
                base,
                view,
                { ...view, productPageCode: 'neet-store', productPageName: 'NEET Store' },
                reverse
            );
            expect(d).toEqual({
                kind: 'commit',
                base: { ...base, productPageCode: 'neet-store', productPageName: 'NEET Store' },
                translations: {},
            });
        }
    );
});

describe('decideLocalizedEdit — an option picked from a list is a shared setting in any language', () => {
    const HI_COPY = {
        'Our courses': 'हमारे कोर्स',
        'Hot right now': 'अभी लोकप्रिय',
        'Apply now': 'अभी आवेदन करें',
        'From the blog': 'ब्लॉग से',
    };
    const reverse = reverseDictionary(HI_COPY);

    /** Applies `change` to the Hindi view the way an editor would, and expects a plain base edit. */
    const expectBaseEdit = <T extends object>(base: T, change: (view: T) => T, expected: T) => {
        const view = localizeDeep(base, HI_COPY);
        const d = decideLocalizedEdit(base, view, change(view), reverse);
        expect(d).toEqual({ kind: 'commit', base: expected, translations: {} });
    };

    it("the catalogue's default sort ('Newest' → 'Popular'), even once one is set", () => {
        expectBaseEdit(
            { title: 'Our courses', defaultSort: 'Newest' },
            (v) => ({ ...v, defaultSort: 'Popular' }),
            { title: 'Our courses', defaultSort: 'Popular' }
        );
        expectBaseEdit(
            { title: 'Our courses', defaultSort: 'Popular' },
            (v) => ({ ...v, defaultSort: 'Price: Low to High' }),
            { title: 'Our courses', defaultSort: 'Price: Low to High' }
        );
    });

    it("a course strip's source ('onSale' → 'comingSoon')", () => {
        expectBaseEdit(
            { title: 'Hot right now', source: 'onSale' },
            (v) => ({ ...v, source: 'comingSoon' }),
            { title: 'Hot right now', source: 'comingSoon' }
        );
    });

    it("a hero button's action ('openLeadCollection' → 'openForm')", () => {
        const base = {
            left: {
                title: 'Hot right now',
                buttons: [{ text: 'Apply now', action: 'openLeadCollection' }],
            },
        };
        expectBaseEdit(
            base,
            (v) => ({
                ...v,
                left: { ...v.left, buttons: [{ ...v.left.buttons[0]!, action: 'openForm' }] },
            }),
            { left: { ...base.left, buttons: [{ text: 'Apply now', action: 'openForm' }] } }
        );
    });

    it("a blog section's category, and back to 'All categories' (empty)", () => {
        expectBaseEdit(
            { headerText: 'From the blog', category: 'Exam Tips' },
            (v) => ({ ...v, category: 'News' }),
            { headerText: 'From the blog', category: 'News' }
        );
        expectBaseEdit(
            { headerText: 'From the blog', category: 'Exam Tips' },
            (v) => ({ ...v, category: '' }),
            { headerText: 'From the blog', category: '' }
        );
    });

    it('a currency, a font, a typed contact e-mail and a toggle under a tag key (showTag)', () => {
        expectBaseEdit(
            { title: 'Our courses', currency: 'INR' },
            (v) => ({ ...v, currency: 'USD' }),
            { title: 'Our courses', currency: 'USD' }
        );
        expectBaseEdit(
            { title: 'Our courses', fontFamily: 'Inter' },
            (v) => ({ ...v, fontFamily: 'Poppins' }),
            { title: 'Our courses', fontFamily: 'Poppins' }
        );
        expectBaseEdit(
            { title: 'Our courses', email: 'info@academy.org' },
            (v) => ({ ...v, email: 'info@academy.or' }),
            { title: 'Our courses', email: 'info@academy.or' }
        );
        expectBaseEdit(
            { headerText: 'From the blog', showTag: true },
            (v) => ({ ...v, showTag: false }),
            { headerText: 'From the blog', showTag: false }
        );
    });
});

/* ── the hook ───────────────────────────────────────────────────────── */

const latestConfig = () => useEditorStore.getState().config;

const useStoreBackedEditing = () => {
    const s = useEditorStore();
    return useLocalizedEditing({
        config: s.config,
        editingLocale: s.editingLocale,
        commitLocalizedEdit: s.commitLocalizedEdit,
        updateComponent: s.updateComponent,
        updateGlobalSettings: s.updateGlobalSettings,
        updatePageSeo: s.updatePageSeo,
        getLatestConfig: latestConfig,
    });
};

describe('useLocalizedEditing — base language passthrough', () => {
    const fns = () => ({
        updateComponent: vi.fn(),
        updateGlobalSettings: vi.fn(),
        updatePageSeo: vi.fn(),
        commitLocalizedEdit: vi.fn(),
    });

    it('returns the store config and functions themselves', () => {
        const config = makeConfig();
        const f = fns();
        const { result } = renderHook(() =>
            useLocalizedEditing({ config, editingLocale: null, ...f })
        );
        expect(result.current.locale).toBeNull();
        expect(result.current.config).toBe(config);
        expect(result.current.baseConfig).toBe(config);
        expect(result.current.updateComponent).toBe(f.updateComponent);
        expect(result.current.updateGlobalSettings).toBe(f.updateGlobalSettings);
        expect(result.current.updatePageSeo).toBe(f.updatePageSeo);
    });

    it('stays a passthrough with a mocked store (no commit action) or a site with one language', () => {
        const config = makeConfig();
        const f = fns();
        const noCommit = renderHook(() =>
            useLocalizedEditing({
                config,
                editingLocale: 'hi',
                updateComponent: f.updateComponent,
                updateGlobalSettings: f.updateGlobalSettings,
                updatePageSeo: f.updatePageSeo,
            })
        );
        expect(noCommit.result.current.config).toBe(config);
        expect(noCommit.result.current.updateComponent).toBe(f.updateComponent);

        const single = {
            ...config,
            globalSettings: {
                ...config.globalSettings,
                i18n: { locales: [{ code: 'en', label: 'EN' }] },
            },
        } as CatalogueConfig;
        const oneLanguage = renderHook(() =>
            useLocalizedEditing({ config: single, editingLocale: 'hi', ...f })
        );
        expect(oneLanguage.result.current.config).toBe(single);
        expect(oneLanguage.result.current.updatePageSeo).toBe(f.updatePageSeo);
    });
});

describe('useLocalizedEditing — editing हिन्दी against the real store', () => {
    beforeEach(() => {
        useEditorStore.getState().setConfig(makeConfig());
        useEditorStore.getState().setEditingLocale('hi');
        useLocalizedEditNotice.getState().clear();
    });

    it('shows the localized view and turns a text edit into ONE atomic, undoable dictionary entry', () => {
        const { result } = renderHook(useStoreBackedEditing);
        const hero = heroOf(result.current.config);
        expect(hero.props.title).toBe('भारतीय तरीके से सीखें');
        const historyBefore = useEditorStore.getState().history.length;

        act(() =>
            result.current.updateComponent('home', 'hero', {
                props: { ...hero.props, title: 'भारतीय तरीके से सीखिए' },
            })
        );

        const state = useEditorStore.getState();
        expect(heroOf(state.config).props.title).toBe('Learn the Indian way');
        expect(strings()['Learn the Indian way']).toBe('भारतीय तरीके से सीखिए');
        expect(state.history.length).toBe(historyBefore + 1);

        act(() => useEditorStore.getState().undo());
        expect(strings()['Learn the Indian way']).toBe('भारतीय तरीके से सीखें');
        expect(heroOf(useEditorStore.getState().config).props.title).toBe('Learn the Indian way');
    });

    it('routes a toggle and an item removal to the shared base', () => {
        const { result } = renderHook(useStoreBackedEditing);
        let hero = heroOf(result.current.config);
        act(() =>
            result.current.updateComponent('home', 'hero', {
                props: { ...hero.props, showBadge: false },
            })
        );
        expect(heroOf(useEditorStore.getState().config).props.showBadge).toBe(false);
        expect(strings()).toEqual(HI);

        hero = heroOf(result.current.config);
        act(() =>
            result.current.updateComponent('home', 'hero', {
                props: { ...hero.props, features: hero.props.features.slice(1) },
            })
        );
        expect(heroOf(useEditorStore.getState().config).props.features).toEqual([
            { title: 'Recorded lessons', icon: 'play' },
        ]);
    });

    it('diffs a late (async) commit against the latest state, not the render that started it', () => {
        const { result } = renderHook(useStoreBackedEditing);
        const staleUpdate = result.current.updateComponent; // e.g. captured before a network call
        let hero = heroOf(result.current.config);
        act(() =>
            result.current.updateComponent('home', 'hero', {
                props: { ...hero.props, title: 'नया शीर्षक' },
            })
        );
        // The editor re-rendered; its props ref now holds the latest view.
        hero = heroOf(result.current.config);
        act(() =>
            staleUpdate('home', 'hero', { props: { ...hero.props, gateAudienceId: 'list-1' } })
        );
        expect(useLocalizedEditNotice.getState().notice).toBeNull();
        expect(heroOf(useEditorStore.getState().config).props.gateAudienceId).toBe('list-1');
        expect(strings()['Learn the Indian way']).toBe('नया शीर्षक');
    });

    it("saves an announcement's tag pill typed in हिन्दी as its translation — the English pill stays", () => {
        const config = makeConfig();
        config.pages[0]!.components.push({
            id: 'feed',
            type: 'announcementFeed',
            enabled: true,
            props: {
                headerText: 'Courses',
                announcements: [{ title: 'Live classes', date: '2025-01-15', tag: 'New' }],
            },
        } as never);
        useEditorStore.getState().setConfig(config);
        useEditorStore.getState().setEditingLocale('hi');
        const { result } = renderHook(useStoreBackedEditing);
        const feed = result.current.config!.pages[0]!.components[2]!;
        expect(feed.props.announcements[0].tag).toBe('नया');
        act(() =>
            result.current.updateComponent('home', 'feed', {
                props: {
                    ...feed.props,
                    announcements: [{ ...feed.props.announcements[0], tag: 'नई खबर' }],
                },
            })
        );
        const stored = useEditorStore.getState().config!.pages[0]!.components[2]!;
        expect(stored.props.announcements[0]).toEqual({
            title: 'Live classes',
            date: '2025-01-15',
            tag: 'New',
        });
        expect(strings().New).toBe('नई खबर');
        expect(useLocalizedEditNotice.getState().notice).toBeNull();
    });

    it('in हिन्दी a picked sort is saved for every language; a typed course tag is refused and left as it was', () => {
        const config = makeConfig();
        config.pages[0]!.components.push(
            {
                id: 'catalog',
                type: 'courseCatalog',
                enabled: true,
                props: { title: 'Courses', defaultSort: 'Newest' },
            } as never,
            {
                id: 'strip',
                type: 'courseShowcase',
                enabled: true,
                props: { title: 'Courses', source: 'tag', tag: 'Featured' },
            } as never
        );
        useEditorStore.getState().setConfig(config);
        useEditorStore.getState().setEditingLocale('hi');
        const { result } = renderHook(useStoreBackedEditing);
        const stored = (id: string) =>
            useEditorStore.getState().config!.pages[0]!.components.find((c) => c.id === id)!;

        const catalog = result.current.config!.pages[0]!.components[2]!;
        act(() =>
            result.current.updateComponent('home', 'catalog', {
                props: { ...catalog.props, defaultSort: 'Popular' },
            })
        );
        expect(stored('catalog').props).toEqual({ title: 'Courses', defaultSort: 'Popular' });
        expect(useLocalizedEditNotice.getState().notice).toBeNull();

        const strip = result.current.config!.pages[0]!.components[3]!;
        act(() =>
            result.current.updateComponent('home', 'strip', {
                props: { ...strip.props, tag: 'व' },
            })
        );
        expect(stored('strip').props.tag).toBe('Featured');
        expect(useLocalizedEditNotice.getState().notice?.reason).toBe('sharedData');
    });

    it('in हिन्दी, picking another product page saves the pick for every language once its name is translated', () => {
        const config = makeConfig();
        config.globalSettings.i18n!.strings!.hi!['JEE Store'] = 'जेईई स्टोर';
        config.pages[0]!.components.push({
            id: 'offer',
            type: 'productPageOffer',
            enabled: true,
            props: { productPageCode: 'jee-store', productPageName: 'JEE Store', title: 'Courses' },
        } as never);
        useEditorStore.getState().setConfig(config);
        useEditorStore.getState().setEditingLocale('hi');
        const { result } = renderHook(useStoreBackedEditing);
        const offer = result.current.config!.pages[0]!.components[2]!;
        expect(offer.props.title).toBe('कोर्स');
        act(() =>
            result.current.updateComponent('home', 'offer', {
                props: {
                    ...offer.props,
                    productPageCode: 'neet-store',
                    productPageName: 'NEET Store',
                },
            })
        );
        expect(useLocalizedEditNotice.getState().notice).toBeNull();
        expect(useEditorStore.getState().config!.pages[0]!.components[2]!.props).toEqual({
            productPageCode: 'neet-store',
            productPageName: 'NEET Store',
            title: 'Courses',
        });
        expect(strings()).toEqual({ ...HI, 'JEE Store': 'जेईई स्टोर' });
    });

    it('passes non-props updates (enabled, anchor, style) straight through', () => {
        const { result } = renderHook(useStoreBackedEditing);
        act(() => result.current.updateComponent('home', 'hero', { enabled: false }));
        expect(heroOf(useEditorStore.getState().config).enabled).toBe(false);
    });

    it.each(['l', '2025', 'naya batch'])(
        'refuses typing %j into a field that is empty in English and leaves English untouched',
        (typed) => {
            const { result } = renderHook(useStoreBackedEditing);
            const before = useEditorStore.getState().config;
            const hero = heroOf(result.current.config);
            act(() =>
                result.current.updateComponent('home', 'hero', {
                    props: { ...hero.props, subtitle: typed },
                })
            );
            expect(useEditorStore.getState().config).toBe(before);
            expect(heroOf(useEditorStore.getState().config).props.subtitle).toBe('');
            expect(strings()).toEqual(HI);
            expect(useLocalizedEditNotice.getState().notice?.reason).toBe('emptySource');
        }
    );

    it('refuses a blocked edit without touching the store, and says why', () => {
        const { result } = renderHook(useStoreBackedEditing);
        const before = useEditorStore.getState().config;
        const hero = heroOf(result.current.config);
        act(() =>
            result.current.updateComponent('home', 'hero', {
                props: { ...hero.props, subtitle: 'उपशीर्षक' },
            })
        );
        expect(useEditorStore.getState().config).toBe(before);
        expect(useLocalizedEditNotice.getState().notice?.reason).toBe('emptySource');
    });

    it('sends a section-type swap to the base, reverting carried-over text to its base source', () => {
        const { result } = renderHook(useStoreBackedEditing);
        const hero = heroOf(result.current.config);
        act(() =>
            result.current.updateComponent('home', 'hero', {
                type: 'productPageOffer',
                props: { title: hero.props.title, columns: 3, heading: 'लाइव कक्षाएं' },
            })
        );
        const swapped = heroOf(useEditorStore.getState().config);
        expect(swapped.type).toBe('productPageOffer');
        expect(swapped.props).toEqual({
            title: 'Learn the Indian way',
            columns: 3,
            heading: 'Live classes',
        });
        expect(strings()).toEqual(HI);
    });

    it('never guesses the base text of a translation two base texts share', () => {
        const reverse = reverseDictionary(HI);
        // 'कोर्स' is both 'Courses' and 'Course': left as it is rather than
        // silently written back as the wrong English word.
        expect(delocalizeSwapProps({}, {}, { heading: 'कोर्स' }, reverse)).toEqual({
            heading: 'कोर्स',
        });
        expect(delocalizeSwapProps({}, {}, { heading: 'नया' }, reverse)).toEqual({
            heading: 'New',
        });
    });

    it('edits the global header through layout without disturbing the footer', () => {
        const { result } = renderHook(useStoreBackedEditing);
        const layout = result.current.config!.globalSettings.layout!;
        const baseFooter = useEditorStore.getState().config!.globalSettings.layout!.footer;
        act(() =>
            result.current.updateGlobalSettings({
                layout: {
                    ...layout,
                    header: {
                        ...layout.header,
                        props: { ...layout.header.props, title: 'स्मार्ट एकेडमी' },
                    },
                },
            })
        );
        const after = useEditorStore.getState().config!.globalSettings;
        expect(after.layout!.header.props.title).toBe('Smart Academy');
        expect(after.layout!.footer).toBe(baseFooter);
        expect(strings()['Smart Academy']).toBe('स्मार्ट एकेडमी');
    });

    it('passes other global settings through untouched', () => {
        const { result } = renderHook(useStoreBackedEditing);
        act(() => result.current.updateGlobalSettings({ stickyHeader: true }));
        expect(useEditorStore.getState().config!.globalSettings.stickyHeader).toBe(true);
    });

    it('translates page SEO; the share image stays shared; an empty description is refused', () => {
        const { result } = renderHook(useStoreBackedEditing);
        act(() => result.current.updatePageSeo('home', { metaTitle: 'सीखने की जगह' }));
        expect(strings()['Home of learning']).toBe('सीखने की जगह');
        expect(useEditorStore.getState().config!.pages[0]!.seo!.metaTitle).toBe('Home of learning');

        act(() =>
            result.current.updatePageSeo('home', { ogImage: 'https://cdn.example.org/og.png' })
        );
        expect(useEditorStore.getState().config!.pages[0]!.seo).toEqual({
            metaTitle: 'Home of learning',
            metaDescription: '',
            ogImage: 'https://cdn.example.org/og.png',
        });

        act(() => result.current.updatePageSeo('home', { metaDescription: 'विवरण' }));
        expect(useEditorStore.getState().config!.pages[0]!.seo!.metaDescription).toBe('');
        expect(useLocalizedEditNotice.getState().notice?.reason).toBe('emptySource');
    });
});

describe('editor store — editing locale and commitLocalizedEdit', () => {
    beforeEach(() => {
        useEditorStore.getState().setConfig(makeConfig());
    });

    it('keeps the editing language out of the config and the undo history', () => {
        const before = JSON.stringify(useEditorStore.getState().config);
        const historyBefore = useEditorStore.getState().history.length;
        useEditorStore.getState().setEditingLocale('hi');
        expect(useEditorStore.getState().editingLocale).toBe('hi');
        expect(JSON.stringify(useEditorStore.getState().config)).toBe(before);
        expect(useEditorStore.getState().history.length).toBe(historyBefore);
        useEditorStore.getState().setConfig(makeConfig());
        expect(useEditorStore.getState().editingLocale).toBeNull();
    });

    it('commits a base change and dictionary entries as one history entry that one undo reverts', () => {
        const store = useEditorStore.getState();
        const historyBefore = store.history.length;
        store.commitLocalizedEdit({
            locale: 'hi',
            component: { pageId: 'home', componentId: 'txt', updates: { enabled: false } },
            translations: { Courses: 'पाठ्यक्रम', 'Live classes': '' },
        });
        const after = useEditorStore.getState();
        expect(after.history.length).toBe(historyBefore + 1);
        expect(after.config!.pages[0]!.components[1]!.props.slots[0][0].enabled).toBe(false);
        expect(strings().Courses).toBe('पाठ्यक्रम');
        expect('Live classes' in strings()).toBe(false);

        after.undo();
        expect(
            useEditorStore.getState().config!.pages[0]!.components[1]!.props.slots[0][0].enabled
        ).toBe(true);
        expect(strings()).toEqual(HI);
    });

    it('creates the dictionary for a language that has none yet, and ignores an empty commit', () => {
        const store = useEditorStore.getState();
        const historyBefore = store.history.length;
        store.commitLocalizedEdit({ locale: 'hi', translations: {} });
        expect(useEditorStore.getState().history.length).toBe(historyBefore);
        store.commitLocalizedEdit({ locale: 'mr', translations: { Courses: 'अभ्यासक्रम' } });
        expect(useEditorStore.getState().config!.globalSettings.i18n!.strings!.mr).toEqual({
            Courses: 'अभ्यासक्रम',
        });
    });
});

describe('refused edits rebuild the property panel', () => {
    beforeEach(() => {
        useLocalizedEditNotice.setState({ notice: null, refusals: 0, lastRefusalAt: 0 });
    });

    it('the panel key changes with the language and after a refusal, not when the notice is cleared', () => {
        const { result, rerender } = renderHook(({ locale }) => useLocalizedPanelKey(locale), {
            initialProps: { locale: 'hi' as string | null },
        });
        expect(result.current).toBe('hi:0');
        act(() => useLocalizedEditNotice.getState().show('emptySource'));
        expect(result.current).toBe('hi:1');
        act(() => useLocalizedEditNotice.getState().clear());
        expect(useLocalizedEditNotice.getState().notice).toBeNull();
        expect(result.current).toBe('hi:1');
        rerender({ locale: null });
        expect(result.current).toBe('base:1');
    });

    it('rebuilds at most once per interval, so an editor refused from a mount effect cannot loop', () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(1_000_000);
            const notices = useLocalizedEditNotice.getState();
            notices.show('emptySource');
            expect(useLocalizedEditNotice.getState().refusals).toBe(1);
            // Refused again straight away (e.g. while the rebuilt panel mounts):
            // the notice updates, the panel is not rebuilt again.
            notices.show('emptySource');
            expect(useLocalizedEditNotice.getState().refusals).toBe(1);
            expect(useLocalizedEditNotice.getState().notice?.id).toBe(2);
            vi.setSystemTime(1_000_000 + REFUSAL_RESYNC_MIN_MS);
            notices.show('sharedData');
            expect(useLocalizedEditNotice.getState().refusals).toBe(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('a refused edit through the hook counts', () => {
        useEditorStore.getState().setConfig(makeConfig());
        useEditorStore.getState().setEditingLocale('hi');
        const { result } = renderHook(useStoreBackedEditing);
        const hero = heroOf(result.current.config);
        act(() =>
            result.current.updateComponent('home', 'hero', {
                props: { ...hero.props, subtitle: 'उपशीर्षक' },
            })
        );
        expect(useLocalizedEditNotice.getState().refusals).toBe(1);
        // An accepted edit does not.
        act(() =>
            result.current.updateComponent('home', 'hero', {
                props: { ...heroOf(result.current.config).props, showBadge: false },
            })
        );
        expect(useLocalizedEditNotice.getState().refusals).toBe(1);
    });
});

/* ── a course grid's card texts and format labels in हिन्दी ─────────── */

describe('decideLocalizedEdit — card texts under render and format-keyed labels', () => {
    const HI_CARDS = {
        ...HI,
        'View course': 'पाठ्यक्रम देखें',
        'Load more': 'और देखें',
        Video: 'वीडियो',
        Animation: 'एनिमेशन',
    };
    const catalogConfig = () => {
        const config = makeConfig();
        config.globalSettings.i18n!.strings = { hi: { ...HI_CARDS } };
        config.pages[0]!.components.push({
            id: 'cat',
            type: 'courseCatalog',
            enabled: true,
            props: {
                title: 'Courses',
                render: {
                    layout: 'grid',
                    cardStyle: 'editorial',
                    card: {
                        ctaLabels: { paid: 'View course' },
                        freeCtaByFormat: { video: 'watch' },
                        descriptions: { 'pkg-1': 'The Vedic science of conception.' },
                    },
                    pagination: { mode: 'loadMore', pageSize: 9, loadMoreLabel: 'Load more' },
                },
            },
        } as never);
        config.pages[0]!.components.push({
            id: 'path',
            type: 'learningPath',
            enabled: true,
            props: { formatLabels: { video: 'Video', animation: 'Animation' } },
        } as never);
        return config;
    };
    const setup = (index: number) => {
        const config = catalogConfig();
        return {
            base: config.pages[0]!.components[index]!.props,
            view: buildLocalizedView(config, 'hi')!.pages[0]!.components[index]!.props,
            reverse: reverseDictionary(HI_CARDS),
        };
    };

    it('the हिन्दी view shows the card texts in हिन्दी and leaves the settings alone', () => {
        const { base, view } = setup(2);
        expect(view.render.card.ctaLabels.paid).toBe('पाठ्यक्रम देखें');
        expect(view.render.pagination.loadMoreLabel).toBe('और देखें');
        expect(view.render.card.freeCtaByFormat).toBe(base.render.card.freeCtaByFormat);
        expect(base.render.card.ctaLabels.paid).toBe('View course');
    });

    it('a card text typed in हिन्दी is saved as its translation; the English base is unchanged', () => {
        const { base, view, reverse } = setup(2);
        const render = {
            ...view.render,
            card: { ...view.render.card, ctaLabels: { paid: 'कोर्स देखें' } },
        };
        const d = decideLocalizedEdit(base, view, { ...view, render }, reverse);
        expect(d).toEqual({
            kind: 'commit',
            base,
            translations: { 'View course': 'कोर्स देखें' },
        });
    });

    it('a card setting changed in हिन्दी is shared, and the English card texts stay', () => {
        const { base, view, reverse } = setup(2);
        const render = { ...view.render, pagination: { ...view.render.pagination, pageSize: 12 } };
        const d = decideLocalizedEdit(base, view, { ...view, render }, reverse);
        if (d.kind !== 'commit') throw new Error(d.kind);
        expect(d.translations).toEqual({});
        expect(d.base.render.pagination).toEqual({
            mode: 'loadMore',
            pageSize: 12,
            loadMoreLabel: 'Load more',
        });
        expect(d.base.render.card.ctaLabels.paid).toBe('View course');
    });

    it('a card description typed in हिन्दी where English has none is refused', () => {
        const { base, view, reverse } = setup(2);
        const card = {
            ...view.render.card,
            descriptions: { ...view.render.card.descriptions, 'pkg-2': 'नया विवरण' },
        };
        const d = decideLocalizedEdit(
            base,
            view,
            { ...view, render: { ...view.render, card } },
            reverse
        );
        expect(d).toEqual({ kind: 'blocked', reason: 'emptySource' });
    });

    it("format labels keyed 'video' and 'animation' are translated like any text", () => {
        const { base, view, reverse } = setup(3);
        expect(view.formatLabels).toEqual({ video: 'वीडियो', animation: 'एनिमेशन' });
        const d = decideLocalizedEdit(
            base,
            view,
            { ...view, formatLabels: { ...view.formatLabels, animation: 'लघु फ़िल्म' } },
            reverse
        );
        expect(d).toEqual({ kind: 'commit', base, translations: { Animation: 'लघु फ़िल्म' } });
    });

    it('removing a card label entry in हिन्दी is refused: its text is shared by other fields', () => {
        const config = catalogConfig();
        const cat = config.pages[0]!.components[2]!;
        cat.props.render.card.formatLabels = { video: 'Video' };
        const base = cat.props;
        const view = buildLocalizedView(config, 'hi')!.pages[0]!.components[2]!.props;
        expect(view.render.card.formatLabels.video).toBe('वीडियो');
        const card = { ...view.render.card, formatLabels: {} };
        const d = decideLocalizedEdit(
            base,
            view,
            { ...view, render: { ...view.render, card } },
            reverseDictionary(HI_CARDS)
        );
        // Not { Video: '' }: that would drop the हिन्दी of every "Video" on the site.
        expect(d).toEqual({ kind: 'blocked', reason: 'structure' });
    });

    it('an item added together with a new card text in हिन्दी is refused, not written to English', () => {
        const { base, view, reverse } = setup(2);
        const edited = {
            ...view,
            items: ['new'],
            render: { ...view.render, card: { ...view.render.card, freeLabel: 'मुफ़्त' } },
        };
        expect(decideLocalizedEdit(base, view, edited, reverse)).toEqual({
            kind: 'blocked',
            reason: 'emptySource',
        });
    });
});
