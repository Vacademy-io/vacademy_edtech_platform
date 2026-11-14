import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { PropertyPanel } from '../PropertyPanel';
import { useEditorStore } from '../../-stores/editor-store';
import brahmVarchasSite from '../brahm-varchas-site.fixture.json';

/**
 * The courses-page design editors (page header, rows, sidebar, card texts) on
 * the real Brahm Varchas courses page, through the real property panel and
 * store: each edit changes exactly the value it names, every other prop of
 * the section stays as it was, and in हिन्दी a typed text is saved as its
 * translation with the English base untouched.
 */

// t returns the key, plus any interpolated values so repeated controls get distinct names.
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (k: string, o?: Record<string, unknown>) => {
            const values = Object.entries(o ?? {})
                .filter(([name]) => name !== 'defaultValue')
                .map(([, v]) => String(v));
            return values.length ? `${k}:${values.join(',')}` : k;
        },
    }),
    Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
}));
const COURSES = [
    { id: '438fae32-2ae9-4f8f-b19e-c8364b480981', name: 'Martand Sun Temple' },
    { id: '22d87df1-cb76-4101-a228-8aa20028dd07', name: 'Narmada Parikrama' },
    { id: '2dbf6c16-c7ff-4172-8013-69d3ace62d4c', name: 'Gita Essay' },
    { id: 'f7c3b58e-b3bc-4d04-b897-e250ecf60b3a', name: 'Garbha Vigyan' },
    { id: 'new-course-0000', name: 'Vedic Maths' },
];
vi.mock('@/stores/students/students-list/useInstituteDetailsStore', () => ({
    useInstituteDetailsStore: () => ({
        getAllLevels: () => [],
        getCourseFromPackage: () => COURSES,
        instituteDetails: null,
    }),
}));
vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../../-services/ai-page-service', () => ({ generateSectionVariants: vi.fn() }));

const folder = (slug: string, title: string, children: unknown[] = [], extra = {}) => ({
    id: `id-${slug}`,
    node_type: 'FOLDER',
    title,
    slug,
    display_order: 0,
    status: 'ACTIVE',
    children,
    ...extra,
});
const soon = { coming_soon: true, audience_id: 'aud-1' };
const TREE = {
    library: { id: '904e2152-f6b8-4c49-bfa0-e8849d13825f', name: 'Knowledge Streams' },
    roots: [
        folder('dharma', 'Dharma', [folder('vedic-parenting', 'Holistic Parenting')]),
        folder('swasthya', 'Swasthya', [
            folder('garbha-vigyan', 'Garbha Vigyan'),
            folder('ayurveda-shiksha', 'Ayurveda'),
        ]),
        folder('shiksha', 'Shiksha', [
            folder('sanskrit', 'Sanskrit', [], soon),
            folder('chhanda', 'Chhanda', [], soon),
            // Coming soon without a notify form: the site does not list it.
            folder('ganit', 'Ganit', [], { coming_soon: true }),
        ]),
    ],
};
vi.mock('@tanstack/react-query', async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
        data: queryKey[0] === 'FOLDER_LIBRARY_TREE' ? TREE : [],
        isLoading: false,
        isError: false,
    }),
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// Site JSON read deep in assertions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const BV = brahmVarchasSite as unknown as { pages: Json[]; globalSettings: Json };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const PAGE = 'courses';
const ID = 'courses-catalog';
const original = () =>
    clone(
        BV.pages.find((p) => p.id === PAGE)!.components.find((c: Json) => c.id === ID)!.props
    ) as Json;
const liveProps = () =>
    useEditorStore
        .getState()
        .config!.pages.find((p) => p.id === PAGE)!
        .components.find((c) => c.id === ID)!.props as Json;

/** Every prop but `key` is exactly as loaded. */
const expectOnlyChanged = (key: string) => {
    const before = original();
    const after = liveProps();
    expect({ ...after, [key]: undefined }).toEqual({ ...before, [key]: undefined });
};

const load = (
    edit?: (site: { pages: Json[]; globalSettings: Json }) => void,
    locale: string | null = null
) => {
    const site = clone(BV);
    edit?.(site);
    useEditorStore.getState().setConfig(site as never);
    useEditorStore.getState().setEditingLocale(locale);
    useEditorStore.getState().selectComponent(ID);
    return render(<PropertyPanel />);
};

/** The group's <details> body, found by its summary. */
const group = (title: string) => within(screen.getByText(title).closest('details')! as HTMLElement);

/** SearchableSelect is a popover (its trigger is found by its placeholder): open it, then click the option. */
const pick = (trigger: HTMLElement, option: string) => {
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: option }));
};

beforeEach(() => {
    if (!document.getElementById('portal-root')) {
        const root = document.createElement('div');
        root.id = 'portal-root';
        document.body.appendChild(root);
    }
});

describe('Courses page design: page header', () => {
    it('edits the heading and intro, and nothing else', () => {
        load();
        fireEvent.change(screen.getByLabelText('catalogDesign.hero.title'), {
            target: { value: 'Every course' },
        });
        fireEvent.change(screen.getByLabelText('catalogDesign.hero.lead'), {
            target: { value: 'Learn in English and Hindi.' },
        });
        expect(liveProps().hero).toEqual({
            ...original().hero,
            title: 'Every course',
            lead: 'Learn in English and Hindi.',
        });
        expectOnlyChanged('hero');
    });

    it('adds a Popular chip that opens a stream category picked from the folder library', () => {
        load();
        const hero = group('catalogDesign.hero.group');
        fireEvent.click(hero.getByRole('button', { name: /catalogDesign.hero.addChip/ }));
        const chip = within(
            screen.getByText('catalogDesign.hero.chipN:6').closest('div.space-y-2') as HTMLElement
        );
        fireEvent.change(chip.getByLabelText('catalogDesign.common.text'), {
            target: { value: 'Ayurveda' },
        });
        fireEvent.change(chip.getByLabelText('catalogDesign.common.stream'), {
            target: { value: 'swasthya' },
        });
        const category = chip.getByLabelText('catalogDesign.common.category');
        expect(
            within(category)
                .getAllByRole('option')
                .map((o) => o.textContent)
        ).toEqual(['catalogDesign.hero.wholeStream', 'Garbha Vigyan', 'Ayurveda']);
        fireEvent.change(category, { target: { value: 'ayurveda-shiksha' } });

        const popular = liveProps().hero.popular;
        expect(popular).toHaveLength(6);
        expect(popular.slice(0, 5)).toEqual(original().hero.popular);
        expect(popular[5]).toEqual({
            label: 'Ayurveda',
            streamSlug: 'swasthya',
            categorySlug: 'ayurveda-shiksha',
        });
        expectOnlyChanged('hero');
    });

    it('a new stream on a chip clears its category; a quick-filter chip shows its filter', () => {
        load();
        const first = within(
            screen
                .getByText('Holistic Parenting', { selector: 'p' })
                .closest('div.space-y-2') as HTMLElement
        );
        fireEvent.change(first.getByLabelText('catalogDesign.common.stream'), {
            target: { value: 'shiksha' },
        });
        expect(liveProps().hero.popular[0]).toEqual({
            label: 'Holistic Parenting',
            streamSlug: 'shiksha',
        });

        const free = within(
            screen.getByText('Free', { selector: 'p' }).closest('div.space-y-2') as HTMLElement
        );
        expect(free.getByLabelText('catalogDesign.hero.quickFilter')).toHaveValue('qf-free');
    });

    it('edits the search placeholder, the quick-filter label and a sort name', () => {
        load();
        fireEvent.change(screen.getByLabelText('catalogDesign.hero.searchPlaceholder'), {
            target: { value: 'Search' },
        });
        fireEvent.change(screen.getByLabelText('catalogDesign.hero.quickFilterLabel'), {
            target: { value: 'Filters:' },
        });
        fireEvent.change(screen.getByLabelText('catalogDesign.hero.sort.popular'), {
            target: { value: '' },
        });
        const hero = liveProps().hero;
        const before = original().hero;
        expect(hero.search).toEqual({ ...before.search, placeholder: 'Search' });
        expect(hero.quickFilterBar).toEqual({ ...before.quickFilterBar, label: 'Filters:' });
        // An emptied sort name goes, so the site's own wording returns.
        expect(hero.resultsHeader).toEqual({ ...before.resultsHeader, sortLabels: {} });
        expect(hero.breadcrumb).toEqual(before.breadcrumb);
        expectOnlyChanged('hero');
    });

    it('a new breadcrumb item goes before this page, which stays last', () => {
        load();
        const hero = group('catalogDesign.hero.group');
        fireEvent.click(hero.getByRole('button', { name: /catalogDesign.hero.addCrumb/ }));
        const [home, courses] = original().hero.breadcrumb;
        expect(liveProps().hero.breadcrumb).toEqual([home, { label: '' }, courses]);
    });

    it('without the band the group is named for what it edits', () => {
        load((site) => {
            const catalog = site.pages
                .find((p) => p.id === PAGE)!
                .components.find((c: Json) => c.id === ID)!;
            catalog.props.hero.enabled = false;
        });
        expect(screen.getByText('catalogDesign.hero.groupResults')).toBeInTheDocument();
        expect(screen.queryByText('catalogDesign.hero.group')).not.toBeInTheDocument();
        expect(screen.getByLabelText('catalogDesign.hero.quickFilterLabel')).toBeInTheDocument();
    });
});

describe('Courses page design: rows above and below the grid', () => {
    it('adds a course to the free strip from the course list', () => {
        load();
        const rows = group('catalogDesign.rows.group');
        pick(rows.getByText('catalogDesign.rows.addCourse').closest('button')!, 'Vedic Maths');
        const [free, ...rest] = liveProps().columnSections;
        expect(free).toEqual({
            ...original().columnSections[0],
            courseIds: [...original().columnSections[0].courseIds, 'new-course-0000'],
        });
        expect(rest).toEqual(original().columnSections.slice(1));
        expectOnlyChanged('columnSections');
    });

    it("edits a spotlight step and the free strip's Watch free label, keeping the ids", () => {
        load();
        fireEvent.change(screen.getByDisplayValue('Included'), {
            target: { value: 'Free with the course' },
        });
        fireEvent.change(screen.getByDisplayValue('Watch free'), {
            target: { value: 'Watch now' },
        });
        const [free, spotlight, soon] = liveProps().columnSections;
        const before = original().columnSections;
        expect(free.ctaRules).toEqual([
            { ...before[0].ctaRules[0], label: 'Watch now' },
            before[0].ctaRules[1],
        ]);
        expect(spotlight.slides[0].steps[2]).toEqual({
            title: 'Live session',
            meta: 'Free with the course',
        });
        expect(spotlight.slides[0].cta).toEqual(before[1].slides[0].cta);
        expect({ ...spotlight, slides: undefined }).toEqual({ ...before[1], slides: undefined });
        expect(soon).toEqual(before[2]);
    });

    it('offers only coming-soon categories, unticks one and lists unknown ones as custom', () => {
        load();
        const rows = group('catalogDesign.rows.group');
        expect(
            rows.getByRole('checkbox', { name: 'options.customValue:khagol' })
        ).toBeInTheDocument();
        // Ordinary categories, and coming-soon ones without a notify form, are not offered.
        expect(rows.queryByRole('checkbox', { name: 'Garbha Vigyan' })).not.toBeInTheDocument();
        expect(rows.queryByRole('checkbox', { name: 'Ganit' })).not.toBeInTheDocument();
        fireEvent.click(rows.getByRole('checkbox', { name: 'Sanskrit' }));
        const soon = liveProps().columnSections[2];
        expect(soon.categorySlugs).toEqual(
            original().columnSections[2].categorySlugs.filter((s: string) => s !== 'sanskrit')
        );
        expectOnlyChanged('columnSections');
    });

    it('reorders the ticked categories and matches stored slugs in any case', () => {
        load((site) => {
            const catalog = site.pages
                .find((p) => p.id === PAGE)!
                .components.find((c: Json) => c.id === ID)!;
            catalog.props.columnSections[2].categorySlugs = ['Chhanda', 'sanskrit'];
        });
        const rows = group('catalogDesign.rows.group');
        expect(rows.getByRole('checkbox', { name: 'Chhanda' })).toBeChecked();
        fireEvent.click(rows.getByRole('button', { name: 'catalogDesign.common.moveUp:Sanskrit' }));
        expect(liveProps().columnSections[2].categorySlugs).toEqual(['sanskrit', 'Chhanda']);
    });

    it('free strip: an emptied "See all" text goes, the switch hides the link, the count is picked', () => {
        load();
        const rows = group('catalogDesign.rows.group');
        const seeAll = rows.getByLabelText('catalogDesign.rows.seeAllLabel');
        fireEvent.change(seeAll, { target: { value: 'All free courses' } });
        expect(liveProps().columnSections[0].seeAllLabel).toBe('All free courses');
        fireEvent.change(seeAll, { target: { value: '' } });
        // No key: the site's own "See all {count} free" (an empty text would hide the link).
        expect(liveProps().columnSections[0]).toEqual(original().columnSections[0]);

        fireEvent.click(rows.getByRole('switch', { name: 'catalogDesign.rows.seeAllOn' }));
        expect(liveProps().columnSections[0].seeAllLabel).toBe('');
        expect(rows.queryByLabelText('catalogDesign.rows.seeAllLabel')).not.toBeInTheDocument();
        fireEvent.click(rows.getByRole('switch', { name: 'catalogDesign.rows.seeAllOn' }));
        expect(liveProps().columnSections[0]).toEqual(original().columnSections[0]);

        fireEvent.change(rows.getByLabelText('catalogDesign.rows.freeLimit'), {
            target: { value: '4' },
        });
        expect(liveProps().columnSections[0]).toEqual({
            ...original().columnSections[0],
            limit: 4,
        });
        expectOnlyChanged('columnSections');
    });

    it('asks before removing a slide whose button has ids; a new slide says where its button is set', () => {
        load();
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const remove = screen.getByRole('button', {
            name: 'catalogDesign.common.remove:catalogDesign.rows.slideN:1',
        });
        fireEvent.click(remove);
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(liveProps()).toEqual(original());

        fireEvent.click(screen.getByRole('button', { name: /catalogDesign.rows.addSlide/ }));
        expect(screen.getByText('catalogDesign.rows.noButton')).toBeInTheDocument();
        confirm.mockRestore();
    });

    it('keeps an entry that is not a row where it was', () => {
        load((site) => {
            const catalog = site.pages
                .find((p) => p.id === PAGE)!
                .components.find((c: Json) => c.id === ID)!;
            catalog.props.columnSections.splice(1, 0, 'note');
        });
        fireEvent.change(screen.getByDisplayValue('Included'), {
            target: { value: 'Free with the course' },
        });
        const list = liveProps().columnSections;
        expect(list).toHaveLength(4);
        expect(list[1]).toBe('note');
        expect(list[2].slides[0].steps[2].meta).toBe('Free with the course');
    });
});

describe('Courses page design: sidebar', () => {
    it('moves a filter group and hides another through its own filter', () => {
        load();
        const sidebar = group('catalogDesign.sidebar.group');
        fireEvent.click(
            sidebar.getByRole('button', { name: 'catalogDesign.common.moveUp:Format' })
        );
        expect(liveProps().filterSidebar).toEqual({
            ...original().filterSidebar,
            order: ['price', 'format', 'language', 'category', 'for'],
        });
        fireEvent.click(
            sidebar.getByRole('switch', { name: 'catalogDesign.sidebar.show:Language' })
        );
        expect(liveProps().languageFilter).toEqual({
            ...original().languageFilter,
            enabled: false,
        });
    });

    it('edits a FOR option and its tags, and gives a new option a URL key from its text', () => {
        load();
        fireEvent.change(screen.getByDisplayValue('Teachers'), {
            target: { value: 'Teachers & tutors' },
        });
        const tags = screen.getByDisplayValue('for-teachers');
        fireEvent.change(tags, { target: { value: 'for-teachers, Tutors' } });
        fireEvent.blur(tags);
        const forFilter = within(
            screen
                .getByText('catalogDesign.sidebar.filterTitle:For')
                .closest('div.space-y-2') as HTMLElement
        );
        fireEvent.click(forFilter.getByRole('button', { name: /catalogDesign.sidebar.addOption/ }));
        const label = forFilter.getAllByLabelText('catalogDesign.common.text').at(-1)!;
        fireEvent.change(label, { target: { value: 'Grand parents' } });
        fireEvent.blur(label);

        const [format, forGroup] = liveProps().customFilters;
        const before = original().customFilters;
        expect(format).toEqual(before[0]);
        expect(forGroup.options).toEqual([
            ...before[1].options.slice(0, 3),
            { id: 'teachers', label: 'Teachers & tutors', tags: ['for-teachers', 'tutors'] },
            { id: 'grand-parents', label: 'Grand parents', tags: [] },
        ]);
        expectOnlyChanged('customFilters');
    });

    it('a new filter group never gets a URL key the site drops, and says so', () => {
        load();
        const sidebar = group('catalogDesign.sidebar.group');
        const add = () =>
            fireEvent.click(
                sidebar.getByRole('button', { name: /catalogDesign.sidebar.addFilter/ })
            );
        const newGroup = () =>
            within(
                screen
                    .getByText('catalogDesign.sidebar.filterTitle:…')
                    .closest('div.space-y-2') as HTMLElement
            );
        const name = (box: ReturnType<typeof newGroup>, value: string) => {
            const heading = box.getByLabelText('catalogDesign.common.heading');
            fireEvent.change(heading, { target: { value } });
            fireEvent.blur(heading);
        };
        add();
        name(newGroup(), 'Price');
        add();
        name(newGroup(), 'किसके लिए');
        const [, , price, hindi] = liveProps().customFilters;
        expect(price).toEqual({ id: 'price-2', label: 'Price', options: [] });
        expect(hindi).toEqual({ id: 'filter-4', label: 'किसके लिए', options: [] });
        expect(screen.getByText('catalogDesign.sidebar.urlKey:price-2')).toBeInTheDocument();
        expect(screen.getByText('catalogDesign.sidebar.urlKey:filter-4')).toBeInTheDocument();
        expect(screen.queryByText('catalogDesign.sidebar.urlKeyReserved')).not.toBeInTheDocument();
        expect(screen.queryByText('catalogDesign.sidebar.needsTag')).not.toBeInTheDocument();
    });

    it('a reserved key written in JSON is flagged; an option without tags says it is hidden', () => {
        load((site) => {
            const catalog = site.pages
                .find((p) => p.id === PAGE)!
                .components.find((c: Json) => c.id === ID)!;
            catalog.props.customFilters[1].id = 'goal';
        });
        expect(screen.getByText('catalogDesign.sidebar.urlKeyReserved')).toBeInTheDocument();
        const forFilter = within(
            screen
                .getByText('catalogDesign.sidebar.filterTitle:For')
                .closest('div.space-y-2') as HTMLElement
        );
        fireEvent.click(forFilter.getByRole('button', { name: /catalogDesign.sidebar.addOption/ }));
        expect(screen.getByText('catalogDesign.sidebar.needsTag')).toBeInTheDocument();
        const label = forFilter.getAllByLabelText('catalogDesign.common.text').at(-1)!;
        fireEvent.change(label, { target: { value: 'दादा-दादी' } });
        fireEvent.blur(label);
        expect(liveProps().customFilters[1].options.at(-1)).toEqual({
            id: 'option-5',
            label: 'दादा-दादी',
            tags: [],
        });
    });

    it('edits the app card texts and keeps its image and colours', () => {
        load();
        fireEvent.change(screen.getByDisplayValue('Your learning, in your pocket'), {
            target: { value: 'Learn anywhere' },
        });
        fireEvent.change(screen.getByDisplayValue('Get the app'), {
            target: { value: 'Download' },
        });
        const before = original().filterSidebar;
        expect(liveProps().filterSidebar).toEqual({
            ...before,
            promo: {
                ...before.promo,
                title: 'Learn anywhere',
                button: { text: 'Download', target: '/login' },
            },
        });
        expectOnlyChanged('filterSidebar');
    });
});

describe('Courses page design: course cards', () => {
    it('sets and clears a button text, renames a format pill and edits a description', () => {
        load();
        const cards = group('catalogDesign.cards.group');
        fireEvent.change(cards.getByLabelText('catalogDesign.cards.cta.paid'), {
            target: { value: 'Enrol' },
        });
        fireEvent.change(cards.getByDisplayValue('E-book'), { target: { value: 'Book' } });
        fireEvent.change(cards.getByDisplayValue('A travelogue of the Narmada parikrama.'), {
            target: { value: 'A walk along the Narmada.' },
        });
        let card = liveProps().render.card;
        const before = original().render;
        expect(card.ctaLabels).toEqual({ paid: 'Enrol' });
        fireEvent.change(cards.getByLabelText('catalogDesign.cards.cta.paid'), {
            target: { value: '' },
        });
        card = liveProps().render.card;
        expect(card).toEqual({
            ...before.card,
            ctaLabels: {},
            formatLabels: { ...before.card.formatLabels, ebook: 'Book' },
            descriptions: {
                ...before.card.descriptions,
                '22d87df1-cb76-4101-a228-8aa20028dd07': 'A walk along the Narmada.',
            },
        });
        expect({ ...liveProps().render, card: undefined }).toEqual({ ...before, card: undefined });
        expectOnlyChanged('render');
    });

    it('adds a description for a course picked from the list, and edits the Load more text', () => {
        load();
        const cards = group('catalogDesign.cards.group');
        pick(
            cards.getByText('catalogDesign.cards.addDescription').closest('button')!,
            'Vedic Maths'
        );
        fireEvent.change(cards.getByLabelText('catalogDesign.cards.loadMoreLabel'), {
            target: { value: 'Show more courses' },
        });
        const render = liveProps().render;
        expect(render.card.descriptions['new-course-0000']).toBe('');
        expect(render.pagination).toEqual({
            ...original().render.pagination,
            loadMoreLabel: 'Show more courses',
        });
        expectOnlyChanged('render');
    });
});

describe('Courses page design: opt-in', () => {
    it('shows nothing for a course grid without the courses-page design, and writes nothing on open', () => {
        load((site) => {
            const catalog = site.pages[0]!.components.find((c: Json) => c.id === ID)!;
            catalog.props = { title: 'Courses', showFilters: true, render: { layout: 'grid' } };
        });
        expect(screen.queryByText('catalogDesign.title')).not.toBeInTheDocument();
        expect(liveProps()).toEqual({
            title: 'Courses',
            showFilters: true,
            render: { layout: 'grid' },
        });
    });

    it('opening the Brahm Varchas courses page writes nothing', () => {
        load();
        expect(screen.getByText('catalogDesign.title')).toBeInTheDocument();
        expect(liveProps()).toEqual(original());
    });
});

describe('Courses page design in हिन्दी', () => {
    const loadHindi = () => {
        load((site) => {
            site.globalSettings.i18n.strings = {
                hi: { 'All courses': 'सभी कोर्स', 'E-book': 'ई-बुक' },
            };
        }, 'hi');
    };
    const hiStrings = () =>
        (useEditorStore.getState().config!.globalSettings as Json).i18n.strings.hi;

    it('a page-header text typed in हिन्दी is saved as its translation; the English stays', () => {
        loadHindi();
        const title = screen.getByLabelText('catalogDesign.hero.title');
        expect(title).toHaveValue('सभी कोर्स');
        fireEvent.change(title, { target: { value: 'सारे कोर्स' } });
        expect(hiStrings()['All courses']).toBe('सारे कोर्स');
        expect(liveProps()).toEqual(original());
    });

    it('a card text typed in हिन्दी (under render) is saved as its translation; the English stays', () => {
        loadHindi();
        const pill = screen.getByDisplayValue('ई-बुक');
        fireEvent.change(pill, { target: { value: 'ई-पुस्तक' } });
        expect(hiStrings()['E-book']).toBe('ई-पुस्तक');
        fireEvent.change(screen.getByDisplayValue('Rajaswala survey'), {
            target: { value: 'रजस्वला सर्वे' },
        });
        expect(hiStrings()['Rajaswala survey']).toBe('रजस्वला सर्वे');
        expect(liveProps()).toEqual(original());
    });
});
