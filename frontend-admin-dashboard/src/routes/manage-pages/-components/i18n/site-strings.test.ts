import { describe, expect, it } from 'vitest';
import type { CatalogueConfig } from '../../-types/editor-types';
import {
    batchForTranslation,
    collectSiteStringEntries,
    collectSiteStrings,
    coverageOf,
    isKeptAsBase,
    keepAsBase,
    mergeAiTranslations,
    setTranslation,
    siteCoverage,
} from './site-strings';
import {
    courseCardDescription,
    courseRichText,
    courseTextsFromRows,
    dedupeLiveTexts,
    displayedLevelName,
    folderTextsFromNodes,
    isLiveText,
    offerChipName,
} from './translation-sources';
import type { FolderNode } from '../../-services/folder-library-service';
import { translateText } from '../../-utils/catalogue-i18n';

const site = (i18n?: Record<string, unknown>) =>
    ({
        globalSettings: {
            courseCatalogeType: { enabled: true, value: 'Course' },
            layout: {
                header: {
                    type: 'header',
                    props: {
                        title: 'Smart Academy',
                        navigation: [{ label: 'Courses', route: 'courses' }],
                    },
                },
                footer: {
                    type: 'footer',
                    enabled: false,
                    props: { bottomNote: 'Hidden footer note' },
                },
            },
            ...(i18n ? { i18n } : {}),
        },
        pages: [
            {
                id: 'home',
                route: 'home',
                seo: {
                    metaTitle: 'Home of learning',
                    metaDescription: '',
                    ogImage: 'https://cdn.example.org/a.png',
                },
                components: [
                    {
                        id: 'h',
                        type: 'heroSection',
                        enabled: true,
                        props: {
                            title: 'Learn the Indian way',
                            layout: 'split',
                            defaultSort: 'Newest',
                        },
                    },
                    {
                        id: 'x',
                        type: 'faqSection',
                        enabled: false,
                        props: { title: 'Hidden section' },
                    },
                    {
                        id: 'c',
                        type: 'columnLayout',
                        enabled: true,
                        props: {
                            slots: [
                                [
                                    {
                                        id: 't',
                                        type: 'textBlock',
                                        enabled: true,
                                        props: { content: 'Inside a column' },
                                    },
                                ],
                            ],
                        },
                    },
                    {
                        id: 'd',
                        type: 'ctaBanner',
                        enabled: true,
                        props: { text: 'Courses', buttonText: 'Join now' },
                    },
                ],
            },
        ],
    }) as unknown as CatalogueConfig;

describe('collectSiteStrings', () => {
    it('collects header, sections, column children and page SEO in reading order, once each', () => {
        expect(collectSiteStrings(site())).toEqual([
            'Smart Academy',
            'Courses',
            'Learn the Indian way',
            'Inside a column',
            'Join now',
            'Home of learning',
        ]);
    });

    it('skips hidden sections, hidden header/footer and values that are data (sorts, layouts, links)', () => {
        const strings = collectSiteStrings(site());
        expect(strings).not.toContain('Hidden section');
        expect(strings).not.toContain('Hidden footer note');
        expect(strings).not.toContain('Newest');
        expect(strings).not.toContain('split');
        expect(strings).not.toContain('https://cdn.example.org/a.png');
    });

    it('is empty without a config', () => {
        expect(collectSiteStrings(null)).toEqual([]);
    });

    it('leaves out text-shaped props no visitor reads (campaign/library names, icon identifiers)', () => {
        const config = site();
        config.pages[0]!.components.push(
            {
                id: 'lead',
                type: 'leadForm',
                enabled: true,
                props: {
                    title: 'Talk to us',
                    audienceId: 'aud-1',
                    audienceName: 'Spring Campaign',
                    gateAudienceName: 'Brochure Leads',
                },
            } as never,
            {
                id: 'fg',
                type: 'featureGrid',
                enabled: true,
                props: {
                    libraryName: 'Streams Library',
                    features: [{ title: 'Expert mentors', iconName: 'GraduationCap' }],
                },
            } as never
        );
        const strings = collectSiteStrings(config);
        expect(strings).toContain('Talk to us');
        expect(strings).toContain('Expert mentors');
        for (const hidden of ['Spring Campaign', 'Brochure Leads', 'Streams Library', 'GraduationCap'])
            expect(strings).not.toContain(hidden);
        // The same text where a visitor does read it still counts.
        config.pages[0]!.components.push({
            id: 'b',
            type: 'ctaBanner',
            enabled: true,
            props: { text: 'Spring Campaign' },
        } as never);
        expect(collectSiteStrings(config)).toContain('Spring Campaign');
    });

    it("leaves out a picked product page's cached name: the live tab lists the page's own name", () => {
        const config = site();
        config.pages[0]!.components.push(
            {
                id: 'offer',
                type: 'productPageOffer',
                enabled: true,
                props: {
                    productPageCode: 'jee-store',
                    productPageName: 'JEE Store',
                    title: 'On offer',
                },
            } as never,
            {
                id: 'path',
                type: 'learningPath',
                enabled: true,
                props: { mode: 'single', productPageCode: 'neet', productPageName: 'NEET Path' },
            } as never
        );
        const strings = collectSiteStrings(config);
        expect(strings).toContain('On offer');
        expect(strings).not.toContain('JEE Store');
        expect(strings).not.toContain('NEET Path');
    });

    it("counts an announcement's tag pill and a detail block's eyebrow — not a course tag to filter by", () => {
        const config = site();
        config.pages[0]!.components.push(
            {
                id: 'feed',
                type: 'announcementFeed',
                enabled: true,
                props: {
                    announcements: [{ title: 'Admissions open', tag: 'News', date: '2025-01-15' }],
                },
            } as never,
            {
                id: 'programs',
                type: 'detailBlocks',
                enabled: true,
                props: {
                    anchorPrefix: 'fees-',
                    blocks: [{ title: 'Weekend Batch', tag: 'Flagship Program' }],
                },
            } as never,
            {
                id: 'showcase',
                type: 'courseShowcase',
                enabled: true,
                props: {
                    title: 'Picked for you',
                    source: 'tag',
                    tag: 'Featured',
                    badges: { types: ['Popular'] },
                },
            } as never
        );
        const strings = collectSiteStrings(config);
        for (const shown of [
            'Admissions open',
            'News',
            'Weekend Batch',
            'Flagship Program',
            'Picked for you',
        ])
            expect(strings).toContain(shown);
        for (const data of ['Featured', 'Popular', 'fees-', '2025-01-15'])
            expect(strings).not.toContain(data);
    });

    it("leaves out a contact form's field names (the keys answers are submitted under) and counts its labels", () => {
        const config = site({
            enabled: true,
            locales: [
                { code: 'en', label: 'EN' },
                { code: 'hi', label: 'हिन्दी' },
            ],
            strings: { hi: {} },
        });
        config.pages[0]!.components = [
            {
                id: 'form',
                type: 'contactForm',
                enabled: true,
                props: {
                    heading: 'Ask us',
                    fields: [
                        { name: 'fullName', label: 'Your name', type: 'text', required: true },
                        { name: 'City', label: 'Your city', type: 'text' },
                        { name: 'email', label: 'Email', type: 'email' },
                    ],
                    submitLabel: 'Send',
                },
            } as never,
            {
                id: 'team',
                type: 'teamSection',
                enabled: true,
                props: { members: [{ name: 'Asha Rao', role: 'Mentor' }] },
            } as never,
        ];
        // What a visitor reads, in order — a team member's name included; the
        // field names 'fullName' and 'City' are not on it.
        const shown = [
            'Smart Academy',
            'Courses',
            'Ask us',
            'Your name',
            'Your city',
            'Email',
            'Send',
            'Asha Rao',
            'Mentor',
            'Home of learning',
        ];
        expect(collectSiteStrings(config)).toEqual(shown);

        // Every shown text translated = complete: no field name left "missing".
        config.globalSettings.i18n!.strings!.hi = Object.fromEntries(
            shown.map((s) => [s, `हि ${s}`])
        );
        const [hi] = siteCoverage(config);
        expect(hi).toMatchObject({ code: 'hi', percent: 100, missing: [] });
    });

    it("counts every published page's title (title band, site search), once and trimmed", () => {
        const config = site();
        config.pages.push(
            { id: 'about', route: 'about', title: ' About us ', components: [] } as never,
            { id: 'faq', route: 'faq', title: 'faq', components: [] } as never,
            { id: 'courses', route: 'courses', title: 'Courses', components: [] } as never,
            {
                id: 'draft',
                route: 'draft',
                title: 'Coming soon',
                published: false,
                components: [],
            } as never
        );
        const strings = collectSiteStrings(config);
        expect(strings).toEqual(expect.arrayContaining(['About us', 'faq']));
        expect(strings.filter((s) => s === 'Courses')).toHaveLength(1);
        expect(strings).not.toContain('Coming soon');
    });
});

describe('course languages', () => {
    const withLanguages = (
        courseLanguages: NonNullable<CatalogueConfig['globalSettings']['courseLanguages']>
    ) => {
        const config = site();
        config.globalSettings.courseLanguages = courseLanguages;
        return collectSiteStrings(config);
    };

    it("counts the site's language names and chips while course languages are on", () => {
        const strings = withLanguages({
            enabled: true,
            languages: [
                { code: 'en', label: 'English', chip: 'EN' },
                { code: 'ta', label: 'Tamil', chip: 'TA', match: ['tamil'] },
            ],
        });
        expect(strings).toEqual(expect.arrayContaining(['English', 'EN', 'Tamil', 'TA']));
        expect(strings).not.toContain('tamil');
    });

    it('counts the built-in English / Hindi pair when the site keeps no list, and nothing while off', () => {
        expect(withLanguages({ enabled: true })).toEqual(
            expect.arrayContaining(['English', 'EN', 'Hindi', 'हिं'])
        );
        const off = withLanguages({ enabled: false, languages: [{ code: 'ta', label: 'Tamil' }] });
        expect(off).not.toContain('Tamil');
        expect(off).not.toContain('English');
    });
});

describe('coverage', () => {
    it('counts translated texts per offered language, rounding the percentage down', () => {
        const config = site({
            enabled: true,
            locales: [
                { code: 'en', label: 'EN' },
                { code: 'hi', label: 'हिन्दी' },
                { code: 'mr', label: 'मराठी' },
            ],
            strings: { hi: { 'Smart Academy': 'स्मार्ट अकादमी', Courses: 'कोर्स' } },
        });
        const [hi, mr] = siteCoverage(config);
        expect(hi).toMatchObject({ code: 'hi', total: 6, translated: 2, percent: 33 });
        expect(hi!.missing).toContain('Join now');
        expect(mr).toMatchObject({ code: 'mr', total: 6, translated: 0, percent: 0 });
        expect(coverageOf([], undefined).percent).toBe(100);
        expect(coverageOf(['a', 'b', 'c'], { a: 'x', b: 'y' }).percent).toBe(66);
    });

    it('a text kept "same as English" counts as translated and is reported as kept', () => {
        const dict = keepAsBase({ Courses: 'कोर्स' }, ['Smart Academy']);
        expect(dict).toEqual({ Courses: 'कोर्स', 'Smart Academy': 'Smart Academy' });
        expect(isKeptAsBase(dict, 'Smart Academy')).toBe(true);
        expect(isKeptAsBase(dict, 'Courses')).toBe(false);
        expect(coverageOf(['Courses', 'Smart Academy'], dict).translated).toBe(2);
    });
});

describe('editing translations', () => {
    it('an inline edit sets the entry; empty or the base text itself removes it', () => {
        expect(setTranslation({}, 'Courses', 'कोर्स')).toEqual({ Courses: 'कोर्स' });
        expect(setTranslation({ Courses: 'कोर्स' }, 'Courses', '')).toEqual({});
        expect(setTranslation({ Courses: 'कोर्स' }, 'Courses', 'Courses')).toEqual({});
    });

    it('AI results equal to their source are returned as unchanged instead of being stored', () => {
        const { dict, unchanged } = mergeAiTranslations(
            { A: 'a' },
            { Courses: 'कोर्स', NEET: 'NEET', Empty: ' ' }
        );
        expect(dict).toEqual({ A: 'a', Courses: 'कोर्स' });
        expect(unchanged).toEqual(['NEET']);
    });
});

describe('batchForTranslation', () => {
    it('packs short texts by count and size, sends long ones alone and skips whole pasted pages', () => {
        const short = Array.from({ length: 45 }, (_, i) => `Text number ${i}`);
        const long = 'L'.repeat(3500);
        const huge = 'H'.repeat(40000);
        const { batches, tooLong } = batchForTranslation([
            ...short.slice(0, 10),
            long,
            ...short.slice(10),
            huge,
        ]);
        expect(tooLong).toEqual([huge]);
        expect(batches).toContainEqual([long]);
        const shortBatches = batches.filter((b) => b[0] !== long);
        expect(shortBatches.map((b) => b.length)).toEqual([40, 5]);
        expect(shortBatches.flat()).toEqual(short);
    });

    it('starts a new batch when the character budget would be exceeded', () => {
        const texts = ['a'.repeat(2500), 'b'.repeat(2500), 'c'.repeat(2500)];
        expect(batchForTranslation(texts).batches.map((b) => b.length)).toEqual([2, 1]);
    });
});

describe('live data texts', () => {
    it('takes course names, levels and the card description (HTML stripped like the learner card)', () => {
        const texts = courseTextsFromRows([
            {
                package_name: 'Vedic Maths',
                level_name: 'Beginner Hindi',
                course_html_description_html: '<p>Learn&nbsp;fast</p>',
            },
            {
                package_name: 'Vedic Maths',
                level_name: 'Beginner Hindi',
                course_html_description_html: '',
            },
            { package_name: 'physics', level_name: null },
        ]);
        expect(texts).toEqual([
            { source: 'Vedic Maths', group: 'Course name' },
            { source: 'physics', group: 'Course name' },
            { source: 'Beginner Hindi', group: 'Level' },
            { source: 'Learn fast', group: 'Course description' },
            // With no About text, the course page's About shows the description as HTML.
            { source: '<p>Learn&nbsp;fast</p>', group: 'About the course' },
        ]);
        expect(courseCardDescription('  <b>Hi</b> there ')).toBe('Hi there');
    });

    it('takes each level name as stored AND as the Courses page shows it (title-cased, placeholders hidden)', () => {
        expect(displayedLevelName('beginner')).toBe('Beginner');
        expect(displayedLevelName('class_10')).toBe('Class 10');
        expect(displayedLevelName('Pre-Foundation')).toBe('Pre Foundation');
        expect(displayedLevelName(' IIT JEE advanced ')).toBe('IIT JEE Advanced');
        expect(displayedLevelName('Default')).toBe('');
        const levels = courseTextsFromRows([
            { package_name: 'Vedic Maths', level_name: 'class_10' },
            { package_name: 'Algebra', level_name: 'Beginner Hindi' },
            { package_name: 'Geometry', level_name: 'default' },
        ])
            .filter((t) => t.group === 'Level')
            .map((t) => t.source);
        expect(levels).toEqual(['class_10', 'Class 10', 'Beginner Hindi', 'default']);
    });

    /** The sources of one group, in order. */
    const groupOf = (texts: ReturnType<typeof courseTextsFromRows>, group: string) =>
        texts.filter((t) => t.group === group).map((t) => t.source);

    it('takes each course tag as the Tags filter shows it, each session as stored and as shown, and the card category', () => {
        const texts = courseTextsFromRows([
            {
                package_name: 'Vedic Maths',
                comma_separeted_tags: ' JEE, Board exams ,,JEE ',
                session_name: 'summer_batch',
                package_type: 'COURSE',
            },
            {
                package_name: 'Algebra',
                comma_separeted_tags: '',
                session_name: 'Default',
                package_type: 'General',
            },
            {
                package_name: 'Geometry',
                comma_separeted_tags: null,
                session_name: null,
                package_type: null,
            },
        ]);
        expect(groupOf(texts, 'Course tag')).toEqual(['JEE', 'Board exams']);
        // A learning path shows 'summer_batch'; the session filter 'Summer Batch'.
        expect(groupOf(texts, 'Session')).toEqual(['summer_batch', 'Summer Batch']);
        // The card's category label: the course type unless it is 'General'.
        expect(groupOf(texts, 'Card category')).toEqual(['COURSE']);
    });

    it("takes each level and session name as a product page offer card's chips show it", () => {
        // Acronyms of up to three letters stay; longer all-caps words keep one capital.
        expect(offerChipName('NEET 2025')).toBe('Neet 2025');
        expect(offerChipName(' CBSE ')).toBe('Cbse');
        expect(offerChipName('JEE MAIN')).toBe('JEE Main');
        expect(offerChipName('class_10')).toBe('class_10');
        expect(offerChipName('Class   10')).toBe('Class 10');
        expect(offerChipName('DEFAULT')).toBe('');
        expect(offerChipName(null)).toBe('');
        const texts = courseTextsFromRows([
            { package_name: 'Physics', level_name: 'CBSE', session_name: 'NEET 2025' },
            // Chips matching a form already listed add nothing; placeholders show no chip.
            { package_name: 'Chemistry', level_name: 'class_10', session_name: 'DEFAULT' },
        ]);
        expect(texts.map((t) => t.source)).toEqual([
            'Physics',
            'Chemistry',
            'CBSE',
            'Cbse',
            'class_10',
            'Class 10',
            'NEET 2025',
            'Neet 2025',
        ]);
        expect(groupOf(texts, 'Level')).toEqual(['CBSE', 'Cbse', 'class_10', 'Class 10']);
        expect(groupOf(texts, 'Session')).toEqual(['NEET 2025', 'Neet 2025']);
    });

    it("takes the course page's About / What learners will gain / Who should join as the page passes them to the dictionary", () => {
        const texts = courseTextsFromRows([
            {
                package_name: 'Vedic Maths',
                about_the_course_html: '\n<p>All about <b>Vedic</b> maths</p>\n',
                why_learn_html: '<ul><li>Speed</li></ul>',
                // A field-name echo for an unset field: the page shows nothing.
                who_should_learn_html: 'who_should_learn',
            },
            {
                package_name: 'Algebra',
                // No visible text: the page's About falls back to the description.
                about_the_course_html: '<p>&nbsp;</p>',
                course_html_description_html: '<p>Equations made easy</p>',
                why_learn_html: '<p></p>',
                who_should_learn_html: '<p>Class 9 students</p>',
            },
        ]);
        expect(groupOf(texts, 'About the course')).toEqual([
            '<p>All about <b>Vedic</b> maths</p>',
            '<p>Equations made easy</p>',
        ]);
        expect(groupOf(texts, 'What learners will gain')).toEqual(['<ul><li>Speed</li></ul>']);
        expect(groupOf(texts, 'Who should join')).toEqual(['<p>Class 9 students</p>']);
        // The card shows the description as plain text: a text of its own.
        expect(groupOf(texts, 'Course description')).toEqual(['Equations made easy']);
        // The page passes the HTML as stored; the trimmed key still matches it.
        expect(
            translateText('\n<p>All about <b>Vedic</b> maths</p>\n', {
                '<p>All about <b>Vedic</b> maths</p>': '<p>वैदिक गणित के बारे में</p>',
            })
        ).toBe('\n<p>वैदिक गणित के बारे में</p>\n');
        expect(courseRichText('<p>about_the_course</p>')).toBe('');
        expect(courseRichText(null)).toBe('');
    });

    it("takes the course page's authors as it shows them: name and subtitle trimmed, a bio only with text", () => {
        const texts = courseTextsFromRows([
            {
                package_name: 'Vedic Maths',
                instructors: [
                    {
                        full_name: ' Asha Rao ',
                        author_subtitle: 'Maths mentor ',
                        author_description: '<p>Ten years of teaching.</p>',
                    },
                    { full_name: 'Ravi Kumar', author_subtitle: '', author_description: '<p></p>' },
                ],
            },
            { package_name: 'Algebra', instructors: [{ full_name: 'Asha Rao' }, { full_name: '' }] },
            { package_name: 'Geometry', instructors: null },
        ]);
        expect(groupOf(texts, 'Author')).toEqual([
            'Asha Rao',
            'Maths mentor',
            '<p>Ten years of teaching.</p>',
            'Ravi Kumar',
        ]);
    });

    it('a text shown in several places is listed once, under the first group that has it', () => {
        const texts = courseTextsFromRows([
            {
                package_name: 'Physics',
                comma_separeted_tags: 'Physics, Mechanics',
                level_name: 'Mechanics',
            },
        ]);
        expect(texts).toEqual([
            { source: 'Physics', group: 'Course name' },
            { source: 'Mechanics', group: 'Level' },
        ]);
    });

    it('walks folders (title, subtitle, tagline, description, call to action), skipping hidden ones', () => {
        const node = (over: Partial<FolderNode>): FolderNode =>
            ({
                id: 'n',
                node_type: 'FOLDER',
                display_order: 0,
                status: 'ACTIVE',
                children: [],
                ...over,
            }) as FolderNode;
        const roots = [
            node({
                title: 'शिक्षा',
                subtitle: 'EDUCATION',
                tagline: 'Learn the Indian way of learning.',
                cta_label: 'Explore Education',
                children: [
                    node({ title: 'Vedic Maths', description: 'Numbers, the old way' }),
                    node({ title: 'Secret', status: 'HIDDEN' }),
                ],
            }),
        ];
        expect(folderTextsFromNodes(roots).map((t) => t.source)).toEqual([
            'शिक्षा',
            'EDUCATION',
            'Learn the Indian way of learning.',
            'Explore Education',
            'Vedic Maths',
            'Numbers, the old way',
        ]);
    });

    it('keeps free text, drops blanks, links and pure numbers, and dedupes', () => {
        expect(isLiveText('physics')).toBe(true);
        expect(isLiveText('Class 10')).toBe(true);
        expect(isLiveText('  ')).toBe(false);
        expect(isLiveText('https://x.org')).toBe(false);
        expect(isLiveText('1,599')).toBe(false);
        expect(
            dedupeLiveTexts([
                { source: 'A', group: 'Folder' },
                { source: 'A', group: 'Product page' },
            ])
        ).toEqual([{ source: 'A', group: 'Folder' }]);
    });
});

describe('site-settings texts the learner translates', () => {
    it('counts WhatsApp, Course Finder, intro and lead-popup labels — never submitted values', () => {
        const config: any = {
            pages: [],
            globalSettings: {
                whatsapp: { enabled: true, label: 'Chat with us', message: 'Hi, I have a question', phone: '+911234' },
                courseFinder: { enabled: true, stepLabels: { level: 'Your class' } },
                leadCollection: {
                    enabled: true,
                    fields: [{ label: 'Class', placeholder: 'Pick one', options: [{ label: 'Class 10', value: 'class-10' }] }],
                },
            },
            // The intro screen sits at the top of the config, as the learner reads it.
            introPage: { enabled: false, imageSlider: { images: [{ caption: 'Hidden intro' }] } },
        };
        const out = collectSiteStrings(config);
        expect(out).toEqual(expect.arrayContaining(['Chat with us', 'Hi, I have a question', 'Your class', 'Class', 'Pick one', 'Class 10']));
        expect(out).not.toContain('class-10');
        expect(out).not.toContain('+911234');
        expect(out).not.toContain('Hidden intro');
    });

    it("counts an enabled intro screen's slide captions — and only those", () => {
        const intro = {
            enabled: true,
            imageSlider: {
                images: [
                    { source: 'https://cdn.example.org/1.png', caption: 'Welcome to Gurukul' },
                    { source: 'https://cdn.example.org/2.png', caption: ' ' },
                ],
            },
            actions: { buttons: [{ label: 'Sign up', action: 'navigateToSignup' }] },
        };
        const config = {
            pages: [],
            globalSettings: {},
            introPage: intro,
        } as unknown as CatalogueConfig;
        expect(collectSiteStrings(config)).toEqual(['Welcome to Gurukul']);
        // Older hand-edited JSON that put it under globalSettings still counts.
        const legacy = {
            pages: [],
            globalSettings: { introPage: intro },
        } as unknown as CatalogueConfig;
        expect(collectSiteStrings(legacy)).toEqual(['Welcome to Gurukul']);
        const i18n = {
            enabled: true,
            locales: [
                { code: 'en', label: 'EN' },
                { code: 'hi', label: 'हिन्दी' },
            ],
            strings: { hi: {} },
        };
        const [hi] = siteCoverage({
            ...config,
            globalSettings: { ...config.globalSettings, i18n },
        });
        expect(hi).toMatchObject({
            code: 'hi',
            total: 1,
            translated: 0,
            missing: ['Welcome to Gurukul'],
        });
    });
});

describe('texts the site shows through its dictionary outside the walked props', () => {
    const catalogSite = () =>
        ({
            pages: [
                {
                    id: 'courses',
                    route: 'courses',
                    title: 'Courses',
                    components: [
                        {
                            id: 'cat',
                            type: 'courseCatalog',
                            enabled: true,
                            props: {
                                filterSidebar: { order: ['priceRange', 'Levels'] },
                                columnSections: [
                                    {
                                        title: 'Spotlight',
                                        slides: [
                                            {
                                                title: 'Menstrual care',
                                                titleNative: 'रजस्वला परिचर्या',
                                                steps: [{ label: 'Fee', meta: '{price}' }],
                                            },
                                        ],
                                    },
                                ],
                                render: {
                                    cardFields: ['package_name'],
                                    cardStyle: 'editorial',
                                    card: {
                                        formatLabels: { video: 'Video', animation: 'Short film' },
                                        freeCtaByFormat: { video: 'watch' },
                                        ctaLabels: { paid: 'View course' },
                                        freeLabel: 'Free',
                                        descriptions: { 'pkg-1': 'The Vedic science of conception.' },
                                    },
                                    pagination: { mode: 'loadMore', loadMoreLabel: 'Load more' },
                                    gridHeading: { title: 'All courses', sortLabels: { Popular: 'Most popular' } },
                                },
                            },
                        },
                    ],
                },
            ],
            globalSettings: {
                naming: { level: 'Format', coursePlural: ' Programmes ' },
                courseFormats: {
                    video: { label: 'Video' },
                    animation: { label: 'Short film / Animation', levels: ['Short Film'] },
                    broken: 'not a format',
                },
            },
        }) as unknown as CatalogueConfig;

    it("collects a course grid's card texts, the course formats' labels and the catalogue's own words", () => {
        expect(collectSiteStrings(catalogSite())).toEqual([
            'Courses',
            'Spotlight',
            'Menstrual care',
            'Fee',
            'Video',
            'Short film',
            'View course',
            'Free',
            'The Vedic science of conception.',
            'Load more',
            'All courses',
            'Most popular',
            'Short film / Animation',
            'Format',
            'Programmes',
        ]);
    });

    it('leaves out ids, group order, native titles, placeholders, level names and card settings', () => {
        const strings = collectSiteStrings(catalogSite());
        for (const data of ['priceRange', 'Levels', 'रजस्वला परिचर्या', '{price}', 'Short Film', 'watch', 'editorial', 'loadMore', 'not a format']) {
            expect(strings).not.toContain(data);
        }
    });

    it('says where each text is first shown: page › section › field, or the site settings', () => {
        const byText = new Map(collectSiteStringEntries(catalogSite()).map((e) => [e.text, e.location]));
        expect(byText.get('Courses')).toEqual({ area: 'pageTitle', page: 'Courses' });
        expect(byText.get('Menstrual care')).toEqual({
            area: 'page',
            page: 'Courses',
            section: 'Course Catalog',
            field: 'columnSections #1 › slides #1 › title',
        });
        expect(byText.get('View course')).toEqual({
            area: 'page',
            page: 'Courses',
            section: 'Course Catalog',
            cardText: 'buttonLabel',
            field: 'paid',
        });
        // A course description is named as one, without the course id.
        expect(byText.get('The Vedic science of conception.')).toEqual({
            area: 'page',
            page: 'Courses',
            section: 'Course Catalog',
            cardText: 'courseDescription',
        });
        expect(byText.get('Load more')).toMatchObject({ cardText: 'loadMore' });
        expect(byText.get('Load more')).not.toHaveProperty('field');
        expect(byText.get('Short film / Animation')).toEqual({
            area: 'settings',
            field: 'courseFormats › animation',
        });
        expect(byText.get('Format')).toEqual({ area: 'settings', field: 'naming › level' });
        expect(collectSiteStringEntries(site())[0]).toEqual({
            text: 'Smart Academy',
            location: { area: 'header', section: 'Header', field: 'title' },
        });
    });
});

describe('sections a page has more than once, and texts the site does not show right now', () => {
    const page = () =>
        ({
            pages: [
                {
                    id: 'paths',
                    route: 'paths',
                    title: 'Learning Paths',
                    components: [
                        { id: 'a', type: 'ctaBanner', enabled: true, props: { title: 'Start today' } },
                        { id: 'h', type: 'heroSection', enabled: true, props: { title: 'Paths' } },
                        { id: 'b', type: 'ctaBanner', enabled: true, props: { title: 'Talk to us' } },
                        { id: 'c', type: 'ctaBanner', enabled: false, props: { title: 'Hidden offer' } },
                    ],
                },
                { id: 'draft', route: 'draft', title: 'Draft page', published: false, components: [] },
            ],
            globalSettings: {
                whatsapp: { enabled: false, message: 'Hi there' },
                courseFinder: { enabled: false, stepLabels: { goal: 'Your goal' } },
            },
        }) as unknown as CatalogueConfig;

    it('numbers a section type that appears more than once on a page', () => {
        const byText = new Map(collectSiteStringEntries(page()).map((e) => [e.text, e.location]));
        expect(byText.get('Start today')?.section).toBe('CTA Banner #1');
        expect(byText.get('Talk to us')?.section).toBe('CTA Banner #2');
        expect(byText.get('Paths')?.section).toBe('Hero Section');
    });

    it('includeHidden adds hidden sections, unpublished titles and switched-off settings', () => {
        const shown = collectSiteStrings(page());
        const all = collectSiteStrings(page(), { includeHidden: true });
        for (const parked of ['Hidden offer', 'Draft page', 'Hi there', 'Your goal']) {
            expect(shown).not.toContain(parked);
            expect(all).toContain(parked);
        }
    });
});
