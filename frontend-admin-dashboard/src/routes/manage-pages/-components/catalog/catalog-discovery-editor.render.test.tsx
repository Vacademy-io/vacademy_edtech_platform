import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CatalogDiscoveryEditor } from './CatalogDiscoveryEditor';

/**
 * The editor writes nested objects (streams, badges, priceFilter…) through the
 * section's single updateComponent, always as a full props object. These
 * check the shapes it writes, which the learner renderer then validates.
 */

vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));
vi.mock('../../-services/folder-library-service', () => ({
    folderLibrariesQueryKey: (id: string) => ['FOLDER_LIBRARIES', id],
    listFolderLibraries: vi.fn(async () => [
        { id: 'lib-1', institute_id: 'inst-1', name: 'Knowledge streams', node_count: 12 },
    ]),
}));
const storeState = { config: { globalSettings: {} as Record<string, unknown> } };
vi.mock('../../-stores/editor-store', () => ({ useEditorStore: () => storeState }));

const setup = (props: Record<string, unknown> = {}) => {
    const updateComponent = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <CatalogDiscoveryEditor
                component={{
                    id: 'cc-1',
                    type: 'courseCatalog',
                    props: { title: 'Courses', ...props },
                }}
                pageId="page-1"
                updateComponent={updateComponent}
            />
        </QueryClientProvider>
    );
    const lastProps = () =>
        (updateComponent.mock.calls.at(-1)?.[2] as { props: Record<string, unknown> }).props;
    return { updateComponent, lastProps };
};

describe('CatalogDiscoveryEditor', () => {
    it('switches stream tabs on with folder-library defaults, keeping other props', () => {
        const { updateComponent, lastProps } = setup();
        fireEvent.click(screen.getByRole('switch', { name: 'Stream tabs' }));
        expect(updateComponent).toHaveBeenCalledWith('page-1', 'cc-1', expect.any(Object));
        expect(lastProps()).toEqual({
            title: 'Courses',
            streams: { source: 'folderLibrary', sticky: true, labelMode: 'title', enabled: true },
        });
    });

    it('picks the folder library for the tabs', async () => {
        const { lastProps } = setup({ streams: { enabled: true, source: 'folderLibrary' } });
        const select = screen.getByLabelText('Folder library');
        await screen.findByRole('option', { name: 'Knowledge streams' });
        fireEvent.change(select, { target: { value: 'lib-1' } });
        expect(lastProps().streams).toEqual({
            enabled: true,
            source: 'folderLibrary',
            libraryId: 'lib-1',
        });
    });

    it('adds tag tabs and keeps the URL key in step with the tag', () => {
        const { lastProps } = setup({ streams: { enabled: true, source: 'tags', items: [] } });
        fireEvent.click(screen.getByRole('button', { name: /Add tab/ }));
        expect(lastProps().streams).toEqual({
            enabled: true,
            source: 'tags',
            items: [{ label: '', slug: '', tag: '' }],
        });
    });

    it('derives a tab URL key from its tag until the key is edited', () => {
        const { lastProps } = setup({
            streams: {
                enabled: true,
                source: 'tags',
                items: [{ label: 'Shiksha', slug: '', tag: '' }],
            },
        });
        fireEvent.change(screen.getByLabelText('Tab 1 course tag'), {
            target: { value: 'Shiksha Courses' },
        });
        expect(lastProps().streams).toMatchObject({
            items: [{ label: 'Shiksha', slug: 'shiksha-courses', tag: 'Shiksha Courses' }],
        });
    });

    it('keeps a typed dash in a tab URL key', () => {
        const { lastProps } = setup({
            streams: {
                enabled: true,
                source: 'tags',
                items: [{ label: 'Vedic', slug: 'vedic', tag: 'vedic' }],
            },
        });
        fireEvent.change(screen.getByLabelText('Tab 1 URL key'), {
            target: { value: 'vedic-' },
        });
        expect(lastProps().streams).toMatchObject({ items: [{ slug: 'vedic-' }] });
    });

    it('tidies a tab URL key when the field loses focus', () => {
        const { updateComponent, lastProps } = setup({
            streams: {
                enabled: true,
                source: 'tags',
                items: [
                    { label: 'Vedic', slug: 'vedic-maths-', tag: 'x' },
                    { label: 'Kala', slug: 'kala', tag: 'kala' },
                ],
            },
        });
        fireEvent.blur(screen.getByLabelText('Tab 1 URL key'));
        expect(lastProps().streams).toMatchObject({
            items: [{ slug: 'vedic-maths' }, { slug: 'kala' }],
        });
        updateComponent.mockClear();
        fireEvent.blur(screen.getByLabelText('Tab 2 URL key'));
        expect(updateComponent).not.toHaveBeenCalled();
    });

    it('warns about tabs the site would drop', () => {
        setup({
            streams: {
                enabled: true,
                source: 'tags',
                items: [
                    { label: 'शिक्षा', slug: '', tag: 'शिक्षा' },
                    { label: 'Kala', slug: 'kala', tag: 'kala' },
                    { label: 'Kala 2', slug: '', tag: 'Kala' },
                ],
            },
        });
        expect(screen.getByText(/This tab needs a URL key/)).toBeInTheDocument();
        expect(screen.getByText(/Same URL key as tab 2/)).toBeInTheDocument();
    });

    it('adds a quick filter with a unique id and the next unused kind', () => {
        const { lastProps } = setup({ quickFilters: [{ id: 'qf-1', label: '', kind: 'popular' }] });
        fireEvent.click(screen.getByRole('button', { name: /Add quick filter/ }));
        expect(lastProps().quickFilters).toEqual([
            { id: 'qf-1', label: '', kind: 'popular' },
            { id: 'qf-2', label: '', kind: 'new' },
        ]);
    });

    it('stores price amounts as numbers', () => {
        const { lastProps } = setup({ priceFilter: { enabled: true } });
        const input = screen.getByLabelText('“Under” amounts');
        fireEvent.change(input, { target: { value: '1000, 500, nope' } });
        fireEvent.blur(input);
        expect(lastProps().priceFilter).toEqual({ enabled: true, maxOptions: [500, 1000] });
    });

    it('turns badges on with the learner defaults', () => {
        const { lastProps } = setup();
        fireEvent.click(screen.getByRole('switch', { name: 'Badges on cards' }));
        expect(lastProps().badges).toEqual({
            types: ['bestseller', 'popular', 'new', 'free'],
            newDays: 60,
            bestsellerTop: 3,
            max: 2,
            enabled: true,
        });
    });

    it('keeps the last badge type ticked', () => {
        const { updateComponent, lastProps } = setup({ badges: { enabled: true, types: ['new'] } });
        const onlyType = screen.getByRole('checkbox', { name: /^New/ });
        expect(onlyType).toBeDisabled();
        fireEvent.click(onlyType);
        expect(updateComponent).not.toHaveBeenCalled();
        expect(screen.getByText(/Keep at least one type/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('checkbox', { name: /^Free/ }));
        expect(lastProps().badges).toEqual({ enabled: true, types: ['new', 'free'] });
    });

    it('warns when a stored badge list ticks no type', () => {
        setup({ badges: { enabled: true, types: [] } });
        expect(screen.getByText(/No badge type is ticked/)).toBeInTheDocument();
    });

    it('lets a badge number be cleared and retyped without snapping back', () => {
        const { updateComponent, lastProps } = setup({ badges: { enabled: true, newDays: 30 } });
        const days = screen.getByLabelText('New for (days)');
        fireEvent.change(days, { target: { value: '' } });
        expect(days).toHaveValue(null);
        expect(updateComponent).not.toHaveBeenCalled();
        fireEvent.change(days, { target: { value: '45' } });
        expect(lastProps().badges).toEqual({ enabled: true, newDays: 45 });
        // Leaving the field empty restores the saved value instead of a default.
        updateComponent.mockClear();
        fireEvent.change(days, { target: { value: '' } });
        fireEvent.blur(days);
        expect(days).toHaveValue(30);
        expect(updateComponent).not.toHaveBeenCalled();
    });

    it('lets a quick-filter amount be cleared and retyped', () => {
        const { updateComponent, lastProps } = setup({
            quickFilters: [{ id: 'qf-1', label: '', kind: 'priceMax', value: 1000 }],
        });
        const amount = screen.getByLabelText('Quick filter 1 amount');
        fireEvent.change(amount, { target: { value: '' } });
        expect(amount).toHaveValue(null);
        expect(updateComponent).not.toHaveBeenCalled();
        fireEvent.change(amount, { target: { value: '500' } });
        expect(lastProps().quickFilters).toEqual([
            { id: 'qf-1', label: '', kind: 'priceMax', value: 500 },
        ]);
    });

    it('warns that language features wait for Course languages in Site settings', () => {
        storeState.config.globalSettings = {};
        setup({ languageFilter: { enabled: true } });
        expect(screen.getByText(/Turn on Course languages in Site settings/)).toBeInTheDocument();
    });

    it('does not warn once Course languages are on', () => {
        storeState.config.globalSettings = { courseLanguages: { enabled: true } };
        setup({ languageFilter: { enabled: true } });
        expect(
            screen.queryByText(/Turn on Course languages in Site settings/)
        ).not.toBeInTheDocument();
        storeState.config.globalSettings = {};
    });
});
