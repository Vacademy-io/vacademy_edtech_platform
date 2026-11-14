import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PropertyPanel } from './PropertyPanel';
import { useEditorStore } from '../-stores/editor-store';
import brahmVarchasSite from './brahm-varchas-site.fixture.json';

/**
 * The Figma-fidelity opt-ins of one site (courseCatalog hero / filterSidebar /
 * columnSections / render.cardStyle, header + footer variants, theme palette,
 * content width, course formats) are authored as JSON and have no editor
 * controls yet. An admin editing anything else on the same section, the
 * global header/footer or Global Settings must not drop them: every editor
 * path spreads the props it does not manage. Renders the real panel against
 * the real store.
 */

// The courses-page panel now carries every catalogue design group, so a test
// that renders it can pass 5 s on a loaded machine (the full admin suite).
vi.setConfig({ testTimeout: 15_000 });

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
    Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
}));
vi.mock('@/stores/students/students-list/useInstituteDetailsStore', () => ({
    useInstituteDetailsStore: () => ({
        getAllLevels: () => [],
        getCourseFromPackage: () => instituteCourses,
        instituteDetails: null,
    }),
}));
// The course picker as a plain field: what it is offered, and what it picks.
vi.mock('@/components/design-system/searchable-select', () => ({
    SearchableSelect: ({
        options,
        value,
        onChange,
    }: {
        options: Array<{ label: string; value: string }>;
        value: string;
        onChange: (v: string) => void;
    }) => (
        <input
            data-testid="course-picker"
            data-options={JSON.stringify(options)}
            value={value}
            onChange={(e) => onChange(e.target.value)}
        />
    ),
}));
const instituteCourses: Array<{ id: string; name: string }> = [];
vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));
const { toast, generateSectionVariants } = vi.hoisted(() => ({
    toast: vi.fn(),
    generateSectionVariants: vi.fn(),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('../-services/ai-page-service', () => ({ generateSectionVariants }));
vi.mock('@tanstack/react-query', async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    useQuery: () => ({ data: [], isLoading: false, isError: false }),
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const CATALOG_OPT_INS = {
    contentMaxWidth: 1152,
    palette: { sand: '#f5eac9' }, // design-lint-ignore: fixture colour
    hero: {
        enabled: true,
        title: 'Courses',
        breadcrumb: [{ label: 'Home', route: '/' }, { label: 'Courses' }],
    },
    filterSidebar: { variant: 'editorial', width: 280, promo: { enabled: true, title: 'App' } },
    customFilters: [
        {
            id: 'format',
            label: 'Format',
            options: [{ id: 'ebook', label: 'E-books', levels: ['eBook'] }],
        },
    ],
    columnSections: [{ id: 'free', kind: 'free-courses', limit: 3 }],
    streams: {
        enabled: true,
        source: 'folderLibrary',
        libraryId: 'lib-1',
        variant: 'icons',
        showCounts: true,
    },
};
const catalog = {
    id: 'cat-1',
    type: 'courseCatalog',
    enabled: true,
    props: {
        title: 'Courses',
        showFilters: true,
        render: {
            layout: 'grid',
            cardFields: [],
            styles: { imageFit: 'cover' },
            cardStyle: 'editorial',
            card: { formats: { ebook: { label: 'E-books' } } },
            pagination: { mode: 'loadMore', pageSize: 9 },
            gridHeading: { title: 'All courses' },
        },
        ...CATALOG_OPT_INS,
    },
};
const THEME = {
    preset: 'default',
    palette: { text: '#1a1208', canvas: '#fffdf8', applyToTokens: true }, // design-lint-ignore: fixture colours
    contentMaxWidth: 1152,
};
const BRAND = '#883000'; // design-lint-ignore: fixture colour
const NEW_BRAND = '#7a2b00'; // design-lint-ignore: fixture colour
const COURSE_FORMATS = { ebook: { label: 'E-books', levels: ['eBook'] } };
const header = {
    id: 'header-1',
    type: 'header',
    enabled: true,
    props: {
        title: 'Brahm Varchas',
        navigation: [],
        barSize: 'compact',
        contentWidth: 'shell',
        activeStyle: 'text',
        languageSwitcherStyle: 'segmented',
        cartDisplay: 'whenNotEmpty',
    },
};
const footer = {
    id: 'footer-1',
    type: 'footer',
    enabled: true,
    props: {
        layout: 'four-column',
        variant: 'brand',
        leftSection: {
            title: 'Brahm Varchas',
            text: 'x',
            tagline: 'Translate Knowledge',
            socials: [],
        },
        rightSection1: { title: 'Explore', links: [{ label: 'Courses', route: 'courses' }] },
        rightSection4: { title: 'Support', links: [{ label: 'FAQ', route: 'faq' }] },
        newsletter: { heading: 'Stay connected', audienceId: 'aud-1' },
        bottomTagline: 'Made with care',
    },
};

const state = () => useEditorStore.getState().config!;

beforeEach(() => {
    useEditorStore.getState().setConfig({
        pages: [{ id: 'courses', route: 'courses', title: 'Courses', components: [catalog] }],
        globalSettings: {
            theme: THEME,
            courseFormats: COURSE_FORMATS,
            courseFormatOrder: ['ebook'],
            fonts: { enabled: true, family: 'Lato, sans-serif' },
            layout: { header, footer },
        },
    } as never);
});

describe('editing a site keeps its opt-in props', () => {
    it('courseCatalog: changing the image fit keeps hero, sidebar, sections, palette, width and the render extensions', () => {
        useEditorStore.getState().selectComponent('cat-1');
        render(<PropertyPanel />);
        fireEvent.change(screen.getByDisplayValue('bookCatalogue.imageFitCover'), {
            target: { value: 'contain' },
        });
        const props = state().pages[0]!.components[0]!.props as Record<string, any>;
        expect(props.render.styles.imageFit).toBe('contain');
        expect(props).toMatchObject(CATALOG_OPT_INS);
        expect(props.render).toMatchObject({
            cardStyle: 'editorial',
            card: { formats: { ebook: { label: 'E-books' } } },
            pagination: { mode: 'loadMore', pageSize: 9 },
            gridHeading: { title: 'All courses' },
        });
    });

    it('Global Settings: changing the primary colour or the font keeps palette, content width and course formats', () => {
        useEditorStore.getState().selectGlobalSettings();
        const { container } = render(<PropertyPanel />);
        fireEvent.change(container.querySelector('input[type="color"]')!, {
            target: { value: BRAND },
        });
        fireEvent.change(screen.getByDisplayValue('Lato'), {
            target: { value: '"Open Sans", sans-serif' },
        });
        const gs = state().globalSettings as Record<string, any>;
        // The palette's own primary follows the primary colour; its other keys stay.
        expect(gs.theme).toEqual({
            ...THEME,
            primaryColor: BRAND,
            palette: { ...THEME.palette, primary: BRAND },
        });
        expect(gs.fonts.family).toBe('"Open Sans", sans-serif');
        expect(gs.courseFormats).toEqual(COURSE_FORMATS);
        expect(gs.courseFormatOrder).toEqual(['ebook']);
    });

    it('global header: renaming keeps the compact / shell / text / segmented / cart options', () => {
        useEditorStore.getState().selectGlobalLayout('header');
        render(<PropertyPanel />);
        fireEvent.change(screen.getByDisplayValue('Brahm Varchas'), { target: { value: 'BV' } });
        const props = (state().globalSettings as Record<string, any>).layout.header.props;
        expect(props).toEqual({ ...header.props, title: 'BV' });
    });

    it('global footer: renaming a link keeps the brand variant, newsletter, fourth column and tagline', () => {
        useEditorStore.getState().selectGlobalLayout('footer');
        render(<PropertyPanel />);
        fireEvent.click(screen.getByRole('button', { name: /^Courses$/ }));
        fireEvent.change(screen.getByDisplayValue('Courses'), { target: { value: 'All courses' } });
        const props = (state().globalSettings as Record<string, any>).layout.footer.props;
        expect(props.rightSection1.links[0]).toMatchObject({
            label: 'All courses',
            route: 'courses',
        });
        expect(props).toMatchObject({
            variant: 'brand',
            leftSection: { tagline: 'Translate Knowledge' },
            rightSection4: footer.props.rightSection4,
            newsletter: footer.props.newsletter,
            bottomTagline: 'Made with care',
        });
    });
});

/* ── Brahm Varchas: the real site that uses every opt-in ──────────────────── */

type Json = Record<string, any>;
const BV = brahmVarchasSite as unknown as { pages: Json[]; globalSettings: Json };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const bvPage = (id: string) => BV.pages.find((p) => p.id === id)!;
const bvComponent = (pageId: string, id: string) =>
    bvPage(pageId).components.find((c: Json) => c.id === id)!;
const live = (pageId: string, id: string) =>
    state()
        .pages.find((p) => p.id === pageId)!
        .components.find((c) => c.id === id)! as Json;
const gsNow = () => state().globalSettings as Json;

/** A small "Start free" strip like the one on the BV home page. */
const START_FREE = {
    id: 'home-start-free',
    type: 'courseShowcase',
    enabled: true,
    props: {
        title: 'New here? Start free',
        source: 'picked',
        courseIds: bvComponent('courses', 'courses-catalog').props.columnSections[0].courseIds,
    },
};

const loadBrahmVarchas = () => {
    const site = clone(BV);
    site.pages[0]!.components.push(clone(START_FREE));
    useEditorStore.getState().setConfig(site as never);
};

describe('Brahm Varchas: editing keeps every setting the panel does not manage', () => {
    beforeEach(() => {
        toast.mockClear();
        generateSectionVariants.mockReset();
        loadBrahmVarchas();
    });

    it('header Sync pages adds the missing page and keeps the mega menu, outside links and a hidden link', () => {
        const site = clone(BV);
        site.pages.unshift({ id: 'home', route: 'home', title: 'Home', components: [] });
        const nav = site.globalSettings.layout.header.props.navigation;
        nav[2] = { ...nav[2], enabled: false }; // Learning Paths hidden
        useEditorStore.getState().setConfig(site as never);
        useEditorStore.getState().selectGlobalLayout('header');
        render(<PropertyPanel />);

        fireEvent.click(screen.getByRole('button', { name: 'header.syncPages' }));

        const props = gsNow().layout.header.props;
        expect(props.navigation.map((i: Json) => i.label)).toEqual([
            'Knowledge Streams',
            'Home',
            'Courses',
            'Learning Paths',
            'Resources',
            'About Us',
        ]);
        expect(props.navigation[0]).toEqual(nav[0]);
        expect(props.navigation[3]).toEqual(nav[2]);
        expect(props.navigation[3].enabled).toBe(false);
        expect(props.navigation.slice(4)).toEqual(nav.slice(3));
        expect({ ...props, navigation: undefined }).toEqual({
            ...site.globalSettings.layout.header.props,
            navigation: undefined,
        });
    });

    it('Try another version keeps the hero, sidebar, rows and card design the new version leaves out', async () => {
        const before = clone(live('courses', 'courses-catalog'));
        generateSectionVariants.mockResolvedValue({
            variants: [
                {
                    label: 'Calmer',
                    rationale: '',
                    component: {
                        id: 'courses-catalog',
                        type: 'courseCatalog',
                        enabled: true,
                        props: {
                            title: '',
                            showFilters: true,
                            render: { layout: 'grid', cardFields: ['title'] },
                        },
                    },
                },
            ],
            warnings: [],
        });
        useEditorStore.getState().selectComponent('courses-catalog');
        render(<PropertyPanel />);

        fireEvent.click(screen.getByTitle('actions.tryAnotherVersion'));
        fireEvent.click(await screen.findByRole('button', { name: /show me options/i }));
        // Before Apply, the option says it keeps the settings it leaves out.
        expect(await screen.findByText('sectionVersion.keepsNote')).toBeInTheDocument();
        fireEvent.click(await screen.findByRole('button', { name: /use this version/i }));

        const props = live('courses', 'courses-catalog').props;
        expect(props.render.cardFields).toEqual(['title']);
        for (const key of [
            'hero',
            'filterSidebar',
            'customFilters',
            'columnSections',
            'streams',
            'quickFilters',
        ]) {
            expect(props[key]).toEqual(before.props[key]);
        }
        expect(props.render.cardStyle).toEqual(before.props.render.cardStyle);
        expect(props.render.card).toEqual(before.props.render.card);
        expect(toast).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'sectionVersion.keptTitle' })
        );
    });

    it('editorial hero: the eyebrow select shows "rule", and editing the eyebrow keeps it', () => {
        const before = clone(live('learning-paths', 'lp-hero'));
        useEditorStore.getState().selectComponent('lp-hero');
        render(<PropertyPanel />);

        const select = screen.getByDisplayValue('hero.eyebrowStyleRule') as HTMLSelectElement;
        expect(select.value).toBe('rule');
        fireEvent.change(screen.getByDisplayValue('Learning paths'), {
            target: { value: 'Paths' },
        });

        const props = live('learning-paths', 'lp-hero').props;
        expect(props).toEqual({ ...before.props, eyebrow: { text: 'Paths', style: 'rule' } });
    });

    it('hero eyebrow: clearing the text and retyping keeps the "rule" style', () => {
        useEditorStore.getState().selectComponent('lp-hero');
        render(<PropertyPanel />);
        const input = screen.getByDisplayValue('Learning paths');

        fireEvent.change(input, { target: { value: '' } });
        expect(live('learning-paths', 'lp-hero').props.eyebrow).toEqual({
            text: '',
            style: 'rule',
        });
        fireEvent.change(input, { target: { value: 'Paths' } });
        expect(live('learning-paths', 'lp-hero').props.eyebrow).toEqual({
            text: 'Paths',
            style: 'rule',
        });
    });

    it('steps "cards": shown as the active variant, and editing the heading keeps it', () => {
        const before = clone(live('learning-paths', 'lp-how'));
        useEditorStore.getState().selectComponent('lp-how');
        render(<PropertyPanel />);

        expect(screen.getByRole('button', { name: 'steps.variantCards' })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
        expect(screen.queryByText('steps.nodeStyle')).toBeNull();
        expect(screen.queryByText('steps.connectorStyle')).toBeNull();
        fireEvent.change(screen.getByDisplayValue('How a learning path works'), {
            target: { value: 'How paths work' },
        });

        expect(live('learning-paths', 'lp-how').props).toEqual({
            ...before.props,
            headerText: 'How paths work',
        });
    });

    it('course strip: retyping an id unchanged writes nothing, and a real change adds no courseBadges', () => {
        useEditorStore.getState().selectComponent('home-start-free');
        render(<PropertyPanel />);
        const historyBefore = useEditorStore.getState().history.length;
        const firstId = START_FREE.props.courseIds[0];

        fireEvent.change(screen.getByDisplayValue(firstId), { target: { value: `${firstId} ` } });
        expect(useEditorStore.getState().history.length).toBe(historyBefore);
        expect(live('courses', 'home-start-free').props).toEqual(START_FREE.props);

        fireEvent.change(screen.getByDisplayValue(firstId), { target: { value: 'course-new' } });
        const props = live('courses', 'home-start-free').props;
        expect(props.courseIds).toEqual(['course-new', ...START_FREE.props.courseIds.slice(1)]);
        expect(props).not.toHaveProperty('courseBadges');
    });

    it('course strip: courses are picked by name, each offered once, and an unknown id stays listed', () => {
        const [firstId, secondId] = START_FREE.props.courseIds;
        instituteCourses.splice(0, instituteCourses.length,
            { id: secondId, name: 'Second course' },
            { id: 'course-other', name: 'Other course' },
        );
        try {
            useEditorStore.getState().selectComponent('home-start-free');
            render(<PropertyPanel />);
            const pickers = screen.getAllByTestId('course-picker');
            const offered = (i: number) => JSON.parse(pickers[i]!.getAttribute('data-options')!);
            // Row 1 holds an id the institute no longer has: listed under its id,
            // and the course picked on row 2 is not offered again.
            expect(offered(0)).toEqual([
                { label: firstId, value: firstId },
                { label: 'Other course', value: 'course-other' },
            ]);
            expect(offered(1)).toContainEqual({ label: 'Second course', value: secondId });

            fireEvent.change(pickers[0]!, { target: { value: 'course-other' } });
            expect(live('courses', 'home-start-free').props.courseIds[0]).toBe('course-other');
        } finally {
            instituteCourses.splice(0, instituteCourses.length);
        }
    });

    it('course strip: a ribbon follows the id when the field is cleared and retyped', () => {
        const firstId = START_FREE.props.courseIds[0];
        const ribbon = { label: 'Free' };
        useEditorStore.getState().updateComponent('courses', 'home-start-free', {
            props: { ...START_FREE.props, courseBadges: { [firstId]: ribbon } },
        });
        useEditorStore.getState().selectComponent('home-start-free');
        render(<PropertyPanel />);
        const input = screen.getByDisplayValue(firstId);

        fireEvent.change(input, { target: { value: '' } });
        fireEvent.change(input, { target: { value: 'course-new' } });
        expect(live('courses', 'home-start-free').props.courseBadges).toEqual({
            'course-new': ribbon,
        });
    });

    it('JSON dialog: a value with no field is edited, the rest is unchanged, and Undo restores it', async () => {
        const before = clone(live('courses', 'courses-catalog'));
        useEditorStore.getState().selectComponent('courses-catalog');
        render(<PropertyPanel />);

        fireEvent.click(screen.getByRole('button', { name: /sectionJson.button/ }));
        const textarea = (await screen.findByRole('textbox', {
            name: 'sectionJson.title',
        })) as HTMLTextAreaElement;
        expect(JSON.parse(textarea.value)).toEqual(before.props);

        // A typo is reported, nothing is written.
        fireEvent.change(textarea, { target: { value: '{ "title": }' } });
        fireEvent.click(screen.getByRole('button', { name: 'sectionJson.apply' }));
        expect(screen.getByRole('alert')).toHaveTextContent('sectionJson.errorAt');
        expect(live('courses', 'courses-catalog')).toEqual(before);

        const edited = clone(before.props);
        edited.hero.title = 'Every course';
        fireEvent.change(textarea, { target: { value: JSON.stringify(edited, null, 2) } });
        fireEvent.click(screen.getByRole('button', { name: 'sectionJson.apply' }));
        await waitFor(() =>
            expect(screen.queryByRole('textbox', { name: 'sectionJson.title' })).toBeNull()
        );

        expect(live('courses', 'courses-catalog')).toEqual({ ...before, props: edited });
        useEditorStore.getState().undo();
        expect(live('courses', 'courses-catalog')).toEqual(before);
    });

    it('JSON dialog: off while editing another language, so Hindi text cannot overwrite English', () => {
        useEditorStore.getState().setEditingLocale('hi');
        try {
            useEditorStore.getState().selectComponent('courses-catalog');
            const { unmount } = render(<PropertyPanel />);
            expect(screen.getByRole('button', { name: /sectionJson.button/ })).toBeDisabled();
            unmount();

            useEditorStore.getState().selectGlobalLayout('header');
            render(<PropertyPanel />);
            expect(screen.getByRole('button', { name: /sectionJson.button/ })).toBeDisabled();
        } finally {
            useEditorStore.getState().setEditingLocale(null);
        }
    });

    it('header and footer JSON dialog: Apply replaces only that block, and Undo restores it', async () => {
        for (const block of ['header', 'footer'] as const) {
            const before = clone(gsNow());
            useEditorStore.getState().selectGlobalLayout(block);
            const { unmount } = render(<PropertyPanel />);

            fireEvent.click(screen.getByRole('button', { name: /sectionJson.button/ }));
            const textarea = (await screen.findByRole('textbox', {
                name: 'sectionJson.title',
            })) as HTMLTextAreaElement;
            expect(JSON.parse(textarea.value)).toEqual(before.layout[block].props);
            const edited = { ...before.layout[block].props, noFieldYet: { on: true } };
            fireEvent.change(textarea, { target: { value: JSON.stringify(edited) } });
            fireEvent.click(screen.getByRole('button', { name: 'sectionJson.apply' }));
            await waitFor(() =>
                expect(screen.queryByRole('textbox', { name: 'sectionJson.title' })).toBeNull()
            );

            const after = clone(gsNow());
            expect(after.layout[block].props).toEqual(edited);
            expect({ ...after, layout: { ...after.layout, [block]: undefined } }).toEqual({
                ...before,
                layout: { ...before.layout, [block]: undefined },
            });
            useEditorStore.getState().undo();
            expect(gsNow()).toEqual(before);
            unmount();
        }
    });

    it('courses page: Title is relabelled, the legacy filters are tucked away and the coming-soon note is gone', () => {
        useEditorStore.getState().selectComponent('courses-catalog');
        render(<PropertyPanel />);

        expect(screen.getByText('bookCatalogue.titleWithHero')).toBeInTheDocument();
        expect(screen.queryByText('bookCatalogue.title')).toBeNull();
        const legacy = screen.getByText('bookCatalogue.legacyFiltersSummary').closest('details')!;
        expect(legacy).not.toHaveAttribute('open');
        expect(within(legacy).getAllByRole('checkbox')).toHaveLength(4);
        expect(screen.queryByText('bookCatalogue.advancedComingSoon')).toBeNull();
    });

    it('brand footer: no layout or presets, all four columns, and a Support edit keeps the rest', () => {
        const before = clone(gsNow().layout.footer.props);
        useEditorStore.getState().selectGlobalLayout('footer');
        render(<PropertyPanel />);

        expect(screen.queryByText('footer.layout')).toBeNull();
        expect(screen.getByText('footer.brandDesignNote')).toBeInTheDocument();
        fireEvent.change(screen.getByDisplayValue(before.rightSection4.title), {
            target: { value: 'Help' },
        });

        expect(gsNow().layout.footer.props).toEqual({
            ...before,
            rightSection4: { ...before.rightSection4, title: 'Help' },
        });
    });

    it('brand footer: "Use a standard footer" asks first, then drops only the variant', () => {
        const before = clone(gsNow().layout.footer.props);
        useEditorStore.getState().selectGlobalLayout('footer');
        render(<PropertyPanel />);
        const confirm = vi.spyOn(window, 'confirm');

        confirm.mockReturnValueOnce(false);
        fireEvent.click(screen.getByRole('button', { name: 'footer.useStandard' }));
        expect(gsNow().layout.footer.props).toEqual(before);

        confirm.mockReturnValueOnce(true);
        fireEvent.click(screen.getByRole('button', { name: 'footer.useStandard' }));
        expect(clone(gsNow().layout.footer.props)).toEqual({ ...before, variant: undefined });
        expect(screen.getByText('footer.layout')).toBeInTheDocument();
        confirm.mockRestore();
    });

    it('site palette without applyToTokens: presets stay usable', () => {
        const site = clone(BV);
        delete site.globalSettings.theme.palette.applyToTokens;
        useEditorStore.getState().setConfig(site as never);
        useEditorStore.getState().selectGlobalSettings();
        render(<PropertyPanel />);

        expect(screen.queryByText('global.theme.ownPaletteNote')).toBeNull();
        expect(screen.getByTitle('options.ocean')).not.toBeDisabled();
    });

    it('site palette: presets are greyed out and the primary colour also updates palette.primary', () => {
        const before = clone(gsNow().theme);
        useEditorStore.getState().selectGlobalSettings();
        const { container } = render(<PropertyPanel />);

        expect(screen.getByText('global.theme.ownPaletteNote')).toBeInTheDocument();
        expect(screen.getByTitle('options.ocean')).toBeDisabled();
        fireEvent.change(container.querySelector('input[type="color"]')!, {
            target: { value: NEW_BRAND },
        }); // design-lint-ignore: fixture colour

        expect(gsNow().theme).toEqual({
            ...before,
            primaryColor: NEW_BRAND,
            palette: { ...before.palette, primary: NEW_BRAND },
        });
    });
});
