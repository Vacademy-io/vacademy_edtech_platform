import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { LearningPathEditor } from './LearningPathEditor';
import { featuredPathSiblings, syncSharedPathProps } from './learning-path-shared';
import { useEditorStore } from '../../-stores/editor-store';
import { useLocalizedEditing } from '../../-hooks/use-localized-editing';
import type { CatalogueConfig, Component, LearningPathProps } from '../../-types/editor-types';
import brahmVarchasSite from '../brahm-varchas-site.fixture.json';

/**
 * The featured list layout (Brahm Varchas Learning Paths page): goal chips,
 * featured path, badge and "More learning paths" are editable, and the two
 * sections that split the layout ('paths' above the band, 'paths-more'
 * below it) keep the same goals and featured path.
 */

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));

const LIBRARY = '904e2152-f6b8-4c49-bfa0-e8849d13825f';
const folder = (id: string, slug: string, title: string, children: unknown[] = []) => ({
    id,
    node_type: 'FOLDER',
    title,
    slug,
    status: 'ACTIVE',
    display_order: 0,
    children,
});
const path = (id: string, code: string, title: string) => ({
    id,
    node_type: 'PRODUCT_PAGE',
    title,
    product_page_code: code,
    status: 'ACTIVE',
    display_order: 0,
    children: [],
});
const queryData: Record<string, unknown> = {
    PRODUCT_PAGES_FOR_CATALOGUE: [
        { id: 'pp-1', code: 'forbvy', name: "A woman's life stages", status: 'ACTIVE' },
        { id: 'pp-2', code: '92ogt2', name: 'India of temples', status: 'ACTIVE' },
        { id: 'pp-3', code: 'u5rgwb', name: 'First steps in Scriptures', status: 'ACTIVE' },
        { id: 'pp-9', code: 'other', name: 'Not a path', status: 'ACTIVE' },
    ],
    FOLDER_LIBRARIES: [{ id: LIBRARY, name: 'Knowledge Streams', node_count: 8 }],
    FOLDER_LIBRARY_TREE: {
        library: { id: LIBRARY, name: 'Knowledge Streams' },
        roots: [
            folder('s1', 'swasthya', 'Health', [path('p1', 'forbvy', "A woman's life stages")]),
            folder('s2', 'dharma', 'Virtue'),
            folder('s3', 'bharat', 'Bharat', [path('p2', '92ogt2', 'India of temples')]),
            folder('s4', 'shastra', 'Scriptures', [path('p3', 'u5rgwb', 'First steps in Scriptures')]),
            folder('s5', 'shiksha', 'Education'),
        ],
    },
};
/** A query a test holds in another state ('loading' | 'error'), by key. */
const queryState: Record<string, 'loading' | 'error'> = {};
const refetch = vi.fn();
vi.mock('@tanstack/react-query', async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    useQuery: ({ queryKey, enabled }: { queryKey: unknown[]; enabled?: boolean }) => {
        const state = queryState[String(queryKey[0])];
        return {
            data: enabled === false || state ? undefined : queryData[String(queryKey[0])],
            isLoading: state === 'loading',
            isError: state === 'error',
            refetch,
        };
    },
}));

const fixture = () => JSON.parse(JSON.stringify(brahmVarchasSite)) as CatalogueConfig;
const sectionOf = (id: string, config = useEditorStore.getState().config!) =>
    config.pages.find((p) => p.id === 'learning-paths')!.components.find((c) => c.id === id)!;
const propsOf = (id: string) => sectionOf(id).props as LearningPathProps;

/**
 * The editor as PropertyPanel mounts it: on the section of the (localized)
 * view, writing through the localized-editing wrapper.
 */
const Panel = ({ id }: { id: string }) => {
    const store = useEditorStore();
    const localized = useLocalizedEditing({
        config: store.config,
        editingLocale: store.editingLocale,
        commitLocalizedEdit: store.commitLocalizedEdit,
        updateComponent: store.updateComponent,
        updateGlobalSettings: store.updateGlobalSettings,
        updatePageSeo: store.updatePageSeo,
        getLatestConfig: () => useEditorStore.getState().config,
    });
    return (
        <LearningPathEditor
            component={sectionOf(id, localized.config!)}
            pageId="learning-paths"
            updateComponent={localized.updateComponent}
        />
    );
};
const renderSection = (id: string) => render(<Panel id={id} />);

const without = (props: object, ...keys: string[]) =>
    Object.fromEntries(Object.entries(props).filter(([k]) => !keys.includes(k)));
/** The fixture with some props of one learning-paths section changed. */
const withProps = (id: string, change: (props: LearningPathProps) => LearningPathProps) => {
    const config = fixture();
    const section = config.pages.find((p) => p.id === 'learning-paths')!.components.find((c) => c.id === id)!;
    section.props = change(section.props as LearningPathProps);
    useEditorStore.getState().setConfig(config);
};
const hiStrings = () => useEditorStore.getState().config!.globalSettings.i18n?.strings?.hi || {};

beforeEach(() => {
    for (const key of Object.keys(queryState)) delete queryState[key];
    useEditorStore.getState().setConfig(fixture());
    useEditorStore.getState().setEditingLocale(null);
});

describe('LearningPathEditor featured layout (Brahm Varchas)', () => {
    it('changing the featured path updates both sections in one undoable edit, keeping every other prop', () => {
        const before = fixture();
        renderSection('paths');
        const picker = screen.getByRole('combobox', { name: 'featured.path' });
        // Only the library's product pages are offered.
        expect(within(picker).queryByRole('option', { name: 'Not a path' })).not.toBeInTheDocument();
        const historyIndex = useEditorStore.getState().historyIndex;

        fireEvent.change(picker, { target: { value: 'u5rgwb' } });

        for (const id of ['paths', 'paths-more']) {
            const old = sectionOf(id, before).props as LearningPathProps;
            expect(propsOf(id).featured).toEqual({ code: 'u5rgwb', badge: 'Most popular path' });
            expect(without(propsOf(id), 'featured')).toEqual(without(old, 'featured'));
        }
        expect(useEditorStore.getState().historyIndex).toBe(historyIndex + 1);

        useEditorStore.getState().undo();
        expect(propsOf('paths').featured).toEqual({ code: 'forbvy', badge: 'Most popular path' });
        expect(propsOf('paths-more').featured).toEqual({ code: 'forbvy', badge: 'Most popular path' });
    });

    it('edits the badge, goal chips and their streams on both sections', () => {
        renderSection('paths-more');
        fireEvent.change(screen.getByRole('textbox', { name: 'featured.badge' }), { target: { value: 'Start here' } });
        fireEvent.change(screen.getAllByRole('textbox', { name: 'goals.label' })[0]!, {
            target: { value: 'Raise my children' },
        });
        // Goal 1 (dharma) also matches the Bharat stream.
        const firstGoal = screen.getAllByRole('group', { name: 'goals.streams' })[0]!;
        expect(within(firstGoal).getByRole('button', { name: 'Virtue' })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(within(firstGoal).getByRole('button', { name: 'Bharat' }));
        fireEvent.click(screen.getByRole('button', { name: 'goals.add' }));

        for (const id of ['paths', 'paths-more']) {
            const goals = propsOf(id).goals!;
            expect(propsOf(id).featured).toEqual({ code: 'forbvy', badge: 'Start here' });
            expect(goals[0]).toEqual({ key: 'child', label: 'Raise my children', tags: ['dharma', 'bharat'] });
            expect(goals).toHaveLength(6);
            expect(goals[5]).toEqual({ key: 'goal-6', label: '', tags: [] });
            expect(propsOf(id).pathExtras).toEqual(fixture().pages[1]!.components[1]!.props.pathExtras);
        }
        // Each section keeps its own parts.
        expect(propsOf('paths-more')).toMatchObject({ showGoals: false, showFeatured: false });
        expect(propsOf('paths').showGrid).toBe(false);
    });

    it('part toggles and the grid heading stay on the section edited', () => {
        renderSection('paths-more');
        fireEvent.change(screen.getByRole('textbox', { name: 'more.title' }), { target: { value: 'Other paths' } });
        fireEvent.click(screen.getByRole('switch', { name: 'featured.showGoals' }));
        expect(propsOf('paths-more')).toMatchObject({ moreTitle: 'Other paths', showGoals: true });
        expect(propsOf('paths').moreTitle).toBe('More learning paths');
        expect(propsOf('paths').showGoals).toBeUndefined();
    });

    it('hides the goal heading where goals are off, and the subtitle in this layout', () => {
        const more = renderSection('paths-more');
        expect(screen.queryByRole('textbox', { name: 'heading.goalsTitle' })).not.toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: 'Subtitle' })).not.toBeInTheDocument();
        expect(screen.getByText('featured.syncNote')).toBeInTheDocument();
        more.unmount();
        renderSection('paths');
        expect(screen.getByRole('textbox', { name: 'heading.goalsTitle' })).toHaveValue('What do you want to achieve?');
        // Grid off on this section: no grid heading fields.
        expect(screen.queryByRole('textbox', { name: 'more.title' })).not.toBeInTheDocument();
    });

    it('keeps a featured image the editor has no field for, on the other section too', () => {
        withProps('paths', (p) => ({ ...p, featured: { ...p.featured, image: 'hero.jpg' } }));
        renderSection('paths-more');
        fireEvent.change(screen.getByRole('textbox', { name: 'featured.badge' }), { target: { value: 'Start here' } });
        fireEvent.change(screen.getByRole('combobox', { name: 'featured.path' }), { target: { value: '92ogt2' } });
        expect(propsOf('paths').featured).toEqual({ code: '92ogt2', badge: 'Start here', image: 'hero.jpg' });
        // "The first path" drops the code only.
        fireEvent.change(screen.getByRole('combobox', { name: 'featured.path' }), { target: { value: '' } });
        expect(propsOf('paths').featured).toEqual({ badge: 'Start here', image: 'hero.jpg' });
        expect(propsOf('paths-more').featured).toEqual({ badge: 'Start here' });
    });

    it('warns before replacing copies that already differ', () => {
        withProps('paths-more', (p) => ({ ...p, goals: p.goals!.slice(0, 2) }));
        renderSection('paths');
        expect(screen.getByText('featured.differsGoals')).toBeInTheDocument();
        expect(screen.queryByText('featured.differsFeatured')).not.toBeInTheDocument();
        fireEvent.change(screen.getAllByRole('textbox', { name: 'goals.label' })[0]!, { target: { value: 'Raise my children' } });
        expect(propsOf('paths-more').goals).toEqual(propsOf('paths').goals);
        expect(screen.queryByText('featured.differsGoals')).not.toBeInTheDocument();
    });

    it('marks a goal the site leaves out until it has chip text and a link key', () => {
        renderSection('paths');
        expect(screen.queryByText('goals.hiddenUntilFilled')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'goals.add' }));
        expect(screen.getAllByText('goals.hiddenUntilFilled')).toHaveLength(1);
    });

    it('offers only the paths the section lists: not from coming-soon folders, only from the chosen folder', () => {
        const tree = queryData.FOLDER_LIBRARY_TREE as { roots: { id: string; coming_soon?: boolean }[] };
        tree.roots.find((r) => r.id === 's3')!.coming_soon = true;
        try {
            const view = renderSection('paths');
            const options = () =>
                within(screen.getByRole('combobox', { name: 'featured.path' }))
                    .getAllByRole('option')
                    .map((o) => o.textContent);
            expect(options()).not.toContain('India of temples');
            view.unmount();
            withProps('paths', (p) => ({ ...p, folderId: 's4', featured: { code: 'forbvy' } }));
            renderSection('paths');
            expect(options()).toEqual(['featured.pathFirst', 'featured.pathOutside', 'First steps in Scriptures']);
            expect(screen.getByText('featured.pathOutsideWarning')).toBeInTheDocument();
        } finally {
            delete tree.roots.find((r) => r.id === 's3')!.coming_soon;
        }
    });

    it('stream folders without a slug can be picked by the key the site derives', () => {
        const tree = queryData.FOLDER_LIBRARY_TREE as { roots: { id: string; slug?: string; subtitle?: string }[] };
        const virtue = tree.roots.find((r) => r.id === 's2')!;
        const health = tree.roots.find((r) => r.id === 's1')!;
        virtue.slug = '';
        health.slug = '';
        health.subtitle = 'Swasthya';
        try {
            renderSection('paths');
            const firstGoal = screen.getAllByRole('group', { name: 'goals.streams' })[0]!;
            // Title "Virtue" → "virtue"; subtitle "Swasthya" wins over the title.
            fireEvent.click(within(firstGoal).getByRole('button', { name: 'Virtue' }));
            fireEvent.click(within(firstGoal).getByRole('button', { name: 'Health' }));
            expect(propsOf('paths').goals![0]!.tags).toEqual(['dharma', 'virtue', 'swasthya']);
        } finally {
            virtue.slug = 'dharma';
            health.slug = 'swasthya';
            delete health.subtitle;
        }
    });

    describe('in another language (as PropertyPanel edits it)', () => {
        beforeEach(() => useEditorStore.getState().setEditingLocale('hi'));

        it('a translated badge is a dictionary entry: the English text stays in both sections', () => {
            renderSection('paths');
            const historyIndex = useEditorStore.getState().historyIndex;
            fireEvent.change(screen.getByRole('textbox', { name: 'featured.badge' }), {
                target: { value: 'सबसे लोकप्रिय पथ' },
            });
            expect(hiStrings()['Most popular path']).toBe('सबसे लोकप्रिय पथ');
            for (const id of ['paths', 'paths-more']) {
                expect(propsOf(id).featured).toEqual({ code: 'forbvy', badge: 'Most popular path' });
            }
            expect(useEditorStore.getState().historyIndex).toBe(historyIndex + 1);
            expect(screen.getByRole('textbox', { name: 'featured.badge' })).toHaveValue('सबसे लोकप्रिय पथ');
        });

        it('a featured path change reaches the copy, and one Undo reverts both', () => {
            renderSection('paths');
            const historyIndex = useEditorStore.getState().historyIndex;
            fireEvent.change(screen.getByRole('combobox', { name: 'featured.path' }), { target: { value: '92ogt2' } });
            expect(propsOf('paths').featured?.code).toBe('92ogt2');
            expect(propsOf('paths-more').featured?.code).toBe('92ogt2');
            expect(useEditorStore.getState().historyIndex).toBe(historyIndex + 1);

            useEditorStore.getState().undo();
            expect(propsOf('paths').featured?.code).toBe('forbvy');
            expect(propsOf('paths-more').featured?.code).toBe('forbvy');
        });

        it('a refused edit copies nothing to the other section', () => {
            withProps('paths', (p) => ({ ...p, featured: { code: 'forbvy' } }));
            useEditorStore.getState().setEditingLocale('hi');
            renderSection('paths');
            // No English badge to translate: refused.
            fireEvent.change(screen.getByRole('textbox', { name: 'featured.badge' }), { target: { value: 'नया' } });
            expect(propsOf('paths').featured).toEqual({ code: 'forbvy' });
            expect(propsOf('paths-more').featured).toEqual({ code: 'forbvy', badge: 'Most popular path' });
        });
    });

    it('a section reading the other through sharedWith shows a note instead of a copy to edit', () => {
        const config = fixture();
        const more = config.pages[1]!.components.find((c) => c.id === 'paths-more')!;
        more.props = { ...without(more.props, 'goals', 'featured'), sharedWith: 'paths' };
        useEditorStore.getState().setConfig(config);
        renderSection('paths-more');
        expect(screen.getByText('featured.sharedFrom')).toBeInTheDocument();
        expect(screen.queryByRole('combobox', { name: 'featured.path' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'featured.sharedFromOpen' }));
        expect(useEditorStore.getState().selectedComponentId).toBe('paths');
    });
});

describe('LearningPathEditor without the featured layout', () => {
    it('shows no featured fields on a plain list and keeps Title and Subtitle', () => {
        render(
            <LearningPathEditor
                component={{ id: 'lp', props: { mode: 'list', libraryId: LIBRARY, title: 'Paths' } }}
                pageId="home"
                updateComponent={vi.fn()}
            />
        );
        expect(screen.queryByText('featured.title')).not.toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Paths');
        expect(screen.getByRole('textbox', { name: 'Subtitle' })).toBeInTheDocument();
    });
});

describe('syncSharedPathProps', () => {
    const page = (components: Component[]): CatalogueConfig =>
        ({ ...fixture(), pages: [{ id: 'p', route: 'p', components }] }) as CatalogueConfig;
    const lp = (id: string, props: LearningPathProps): Component => ({ id, type: 'learningPath', enabled: true, props });
    const base: LearningPathProps = { mode: 'list', listLayout: 'featured', libraryId: 'lib' };

    it('pairs the two Brahm Varchas sections', () => {
        const components = fixture().pages[1]!.components;
        const paths = components.find((c) => c.id === 'paths')!;
        expect(featuredPathSiblings(components, paths).map((c) => c.id)).toEqual(['paths-more']);
    });

    it('copies only to featured lists of the same library that keep their own copy', () => {
        const config = page([
            lp('a', { ...base, featured: { code: 'x' } }),
            lp('b', { ...base, featured: { code: 'y' }, moreTitle: 'Keep' }),
            lp('c', { ...base, libraryId: 'other', featured: { code: 'y' } }),
            lp('d', { ...base, sharedWith: 'a' }),
            lp('e', { mode: 'list', libraryId: 'lib', featured: { code: 'y' } }),
        ]);
        const next = syncSharedPathProps(config, 'p', 'a', ['featured', 'moreTitle']);
        const [a, b, c, d, e] = next.pages[0]!.components;
        expect(b!.props).toEqual({ ...base, featured: { code: 'x' }, moreTitle: 'Keep' });
        expect(c).toBe(config.pages[0]!.components[2]);
        expect(d).toBe(config.pages[0]!.components[3]);
        expect(e).toBe(config.pages[0]!.components[4]);
        expect(a).toBe(config.pages[0]!.components[0]);
    });

    it('copies a featured sub-key into the sibling\'s own featured', () => {
        const config = page([
            lp('a', { ...base, featured: { badge: 'New' } }),
            lp('b', { ...base, featured: { code: 'y', badge: 'Old', image: 'b.jpg' } }),
        ]);
        const next = syncSharedPathProps(config, 'p', 'a', ['featured.badge', 'featured.code']);
        expect(next.pages[0]!.components[1]!.props.featured).toEqual({ badge: 'New', image: 'b.jpg' });
    });

    it('returns the same config when the copies already match', () => {
        const config = page([lp('a', { ...base, goals: [] }), lp('b', { ...base, goals: [] })]);
        expect(syncSharedPathProps(config, 'p', 'a', ['goals'])).toBe(config);
    });
});

describe('goal streams while the library is not known', () => {
    it('says the streams are loading, and does not call saved tags "Custom"', () => {
        queryState.FOLDER_LIBRARY_TREE = 'loading';
        renderSection('paths');
        expect(screen.getAllByText('goals.foldersLoading').length).toBeGreaterThan(0);
        expect(screen.queryByText('goals.noStreams')).not.toBeInTheDocument();
        expect(screen.queryByText('goals.customTag')).not.toBeInTheDocument();
    });

    it('says a failed load failed, with a way to try again', () => {
        queryState.FOLDER_LIBRARY_TREE = 'error';
        renderSection('paths');
        expect(screen.queryByText('goals.noStreams')).not.toBeInTheDocument();
        fireEvent.click(screen.getAllByRole('button', { name: 'goals.retry' })[0]!);
        expect(refetch).toHaveBeenCalled();
    });
});
