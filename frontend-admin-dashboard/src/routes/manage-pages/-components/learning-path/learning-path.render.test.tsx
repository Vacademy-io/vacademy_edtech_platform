import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { LearningPathEditor } from './LearningPathEditor';
import { LearningPathPreview } from './LearningPathPreview';
import { getComponentTemplate } from '../../-utils/component-templates';
import type { LearningPathProps } from '../../-types/editor-types';

/**
 * Learning Path section: the editor stores only codes / ids in props (data is
 * read live), the preview shows the product page's courses as ordered steps
 * or the library's product pages as path cards, and a newly added section
 * starts from the spec defaults.
 */

let queryData: Record<string, unknown> = {};

vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));
vi.mock('@tanstack/react-query', async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    useQuery: ({ queryKey, enabled }: { queryKey: unknown[]; enabled?: boolean }) => ({
        data: enabled === false ? undefined : queryData[String(queryKey[0])],
        isLoading: false,
        isError: false,
    }),
}));

const updateComponent = vi.fn();

const renderEditor = (props: LearningPathProps) =>
    render(<LearningPathEditor component={{ id: 'lp-1', props }} pageId="home" updateComponent={updateComponent} />);

beforeEach(() => {
    queryData = {};
    updateComponent.mockClear();
});

describe('learningPath template', () => {
    const t = ((key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key) as unknown as Parameters<
        typeof getComponentTemplate
    >[1];

    it('starts from the spec defaults', () => {
        const c = getComponentTemplate('learningPath', t);
        expect(c.type).toBe('learningPath');
        expect(c.props).toMatchObject({
            mode: 'single',
            productPageCode: '',
            pathParam: 'path',
            showStepNumbers: true,
            showTotal: true,
            addAllLabel: 'Add whole path to cart',
            enrolLabel: 'Enrol in this path',
            viewPathLabel: 'View path',
            emptyText: 'New learning paths will appear here.',
        });
    });

    it('ships no copy the AI page review takes for a placeholder', () => {
        // Mirrors ai_service page_quality._PLACEHOLDER_RE: one match is a "fix"
        // item on every page that keeps the default, which the assistant then
        // rewrites ("Learning paths are coming soon." used to trip it).
        const placeholder =
            /lorem ipsum|\byour (?:institute|company|school) name\b|\bplaceholder\b|\bexample\.com\b|\bcoming soon\b|\bwelcome to our platform\b|\bmy platform\b|\bdescription here\b|\bwrite your content here\b|\bnew program\b/i;
        const copy = Object.values(getComponentTemplate('learningPath', t).props).filter(
            (v): v is string => typeof v === 'string'
        );
        expect(copy.filter((s) => placeholder.test(s))).toEqual([]);
    });
});

describe('LearningPathEditor', () => {
    it('picks the product page by code and keeps its name for the canvas', () => {
        queryData.PRODUCT_PAGES_FOR_CATALOGUE = [
            { id: 'pp-1', code: 'yoga-path', name: 'Yoga path', status: 'ACTIVE' },
            { id: 'pp-2', code: 'vedas', name: 'Vedas', status: 'DRAFT' },
        ];
        renderEditor({ mode: 'single', productPageCode: '', title: 'Paths' });
        // Found by its label: the select is tied to it.
        fireEvent.change(screen.getByRole('combobox', { name: 'Product page (the path)' }), {
            target: { value: 'yoga-path' },
        });
        expect(updateComponent).toHaveBeenCalledWith('home', 'lp-1', {
            props: { mode: 'single', productPageCode: 'yoga-path', productPageName: 'Yoga path', title: 'Paths' },
        });
    });

    it('suggests the template’s empty-state copy, not "coming soon"', () => {
        renderEditor({ mode: 'single', productPageCode: '' });
        expect(screen.getByRole('textbox', { name: 'When there is nothing to show' })).toHaveAttribute(
            'placeholder',
            'New learning paths will appear here.'
        );
    });

    it('lists paths from a library and resets the start folder when the library changes', () => {
        queryData.FOLDER_LIBRARIES = [{ id: 'lib-1', name: 'Streams', node_count: 3 }];
        renderEditor({ mode: 'list', libraryId: '', folderId: 'old' });
        fireEvent.change(screen.getByRole('combobox', { name: 'Folder library' }), { target: { value: 'lib-1' } });
        expect(updateComponent).toHaveBeenCalledWith('home', 'lp-1', {
            props: { mode: 'list', libraryId: 'lib-1', libraryName: 'Streams', folderId: '' },
        });
    });

    it('switches the stream-tab rule and labels', () => {
        renderEditor({ mode: 'list', streamFromUrl: false });
        fireEvent.click(screen.getByRole('switch', { name: 'Follow the stream tab' }));
        expect(updateComponent).toHaveBeenLastCalledWith('home', 'lp-1', {
            props: { mode: 'list', streamFromUrl: true },
        });
        fireEvent.change(screen.getByRole('textbox', { name: 'Path card button' }), { target: { value: 'Open' } });
        expect(updateComponent).toHaveBeenLastCalledWith('home', 'lp-1', {
            props: { mode: 'list', streamFromUrl: false, viewPathLabel: 'Open' },
        });
    });

    it('names the start-folder select', () => {
        queryData.FOLDER_LIBRARIES = [{ id: 'lib-1', name: 'Streams', node_count: 1 }];
        queryData.FOLDER_LIBRARY_TREE = {
            library: { id: 'lib-1', name: 'Streams' },
            roots: [{ id: 's1', node_type: 'FOLDER', title: 'Shiksha', status: 'ACTIVE', display_order: 0, children: [] }],
        };
        renderEditor({ mode: 'list', libraryId: 'lib-1' });
        fireEvent.change(screen.getByRole('combobox', { name: 'Paths from' }), { target: { value: 's1' } });
        expect(updateComponent).toHaveBeenLastCalledWith('home', 'lp-1', {
            props: { mode: 'list', libraryId: 'lib-1', folderId: 's1' },
        });
    });

    it('warns that a coming-soon start folder shows no paths yet', () => {
        queryData.FOLDER_LIBRARIES = [{ id: 'lib-1', name: 'Streams', node_count: 1 }];
        queryData.FOLDER_LIBRARY_TREE = {
            library: { id: 'lib-1', name: 'Streams' },
            roots: [
                { id: 's1', node_type: 'FOLDER', title: 'Ayurveda', status: 'ACTIVE', coming_soon: true, display_order: 0, children: [] },
            ],
        };
        renderEditor({ mode: 'list', libraryId: 'lib-1', folderId: 's1' });
        expect(screen.getByRole('option', { name: /Ayurveda \(coming soon\)/ })).toBeInTheDocument();
        expect(screen.getByText(/marked coming soon, so the site shows no paths from it/)).toBeInTheDocument();
    });
});

describe('LearningPathPreview', () => {
    it('asks for a product page until one is picked', () => {
        render(<LearningPathPreview props={{ mode: 'single', productPageCode: '' }} />);
        expect(screen.getByText(/Pick the product page that holds this path/)).toBeInTheDocument();
    });

    it('shows the steps in display order with numbers, versions and the total', () => {
        queryData.PP_OFFER_PREVIEW = {
            mappings: [
                { id: '3', package_id: 'c2', package_name: 'Vedas', level_name: 'English', display_order: 2, status: 'ACTIVE', payment_plan: { actual_price: 300, currency: 'INR' } },
                { id: '1', package_id: 'c1', package_name: 'Yoga', level_name: 'Hindi', display_order: 0, status: 'ACTIVE', payment_plan: { actual_price: 200, currency: 'INR' } },
                { id: '2', package_id: 'c1', package_name: 'Yoga', level_name: 'English', display_order: 1, status: 'ACTIVE', payment_plan: { actual_price: 250, currency: 'INR' } },
            ],
        };
        render(
            <LearningPathPreview
                props={{ mode: 'single', productPageCode: 'path', title: 'Start here', addAllLabel: 'Take it all' }}
            />
        );
        const steps = screen.getAllByRole('listitem');
        expect(steps).toHaveLength(2);
        expect(within(steps[0]!).getByText('Yoga')).toBeInTheDocument();
        expect(within(steps[0]!).getByText('1')).toBeInTheDocument();
        expect(within(steps[0]!).getByText('Hindi')).toBeInTheDocument();
        expect(within(steps[0]!).getByText('English')).toBeInTheDocument();
        expect(within(steps[1]!).getByText('Vedas')).toBeInTheDocument();
        expect(screen.getByText('INR 500')).toBeInTheDocument();
        expect(screen.getByText('Take it all')).toBeInTheDocument();
        expect(screen.getByText('Start here')).toBeInTheDocument();
    });

    it('hides step numbers and the total when switched off', () => {
        queryData.PP_OFFER_PREVIEW = {
            mappings: [{ id: '1', package_id: 'c1', package_name: 'Yoga', display_order: 0, status: 'ACTIVE', payment_plan: { actual_price: 200, currency: 'INR' } }],
        };
        render(
            <LearningPathPreview
                props={{ mode: 'single', productPageCode: 'path', showStepNumbers: false, showTotal: false }}
            />
        );
        expect(screen.queryByText('1')).not.toBeInTheDocument();
        expect(screen.getByText('1 step')).toBeInTheDocument();
    });

    it('lists the live product pages of a library as path cards', () => {
        queryData.FOLDER_LIBRARY_TREE = {
            library: { id: 'lib-1', name: 'Streams' },
            roots: [
                {
                    id: 's1',
                    node_type: 'FOLDER',
                    title: 'Shiksha',
                    status: 'ACTIVE',
                    display_order: 0,
                    children: [
                        { id: 'p1', node_type: 'PRODUCT_PAGE', title: 'Foundations', product_page_code: 'f', product_page_status: 'ACTIVE', status: 'ACTIVE', display_order: 0, children: [] },
                        { id: 'p2', node_type: 'PRODUCT_PAGE', title: 'Draft path', product_page_code: 'd', product_page_status: 'DRAFT', status: 'ACTIVE', display_order: 1, children: [] },
                    ],
                },
            ],
        };
        render(<LearningPathPreview props={{ mode: 'list', libraryId: 'lib-1', viewPathLabel: 'See path' }} />);
        expect(screen.getByText('Foundations')).toBeInTheDocument();
        expect(screen.queryByText('Draft path')).not.toBeInTheDocument();
        expect(screen.getByText('Shiksha')).toBeInTheDocument();
        expect(screen.getByText('See path')).toBeInTheDocument();
    });

    it('leaves out paths inside a coming-soon folder, as the site does', () => {
        queryData.FOLDER_LIBRARY_TREE = {
            library: { id: 'lib-1', name: 'Streams' },
            roots: [
                {
                    id: 's1',
                    node_type: 'FOLDER',
                    title: 'Ayurveda',
                    status: 'ACTIVE',
                    coming_soon: true,
                    display_order: 0,
                    children: [
                        { id: 'p1', node_type: 'PRODUCT_PAGE', title: 'Herbs 101', product_page_code: 'h', product_page_status: 'ACTIVE', status: 'ACTIVE', display_order: 0, children: [] },
                    ],
                },
            ],
        };
        render(<LearningPathPreview props={{ mode: 'list', libraryId: 'lib-1', emptyText: 'Paths are coming.' }} />);
        expect(screen.queryByText('Herbs 101')).not.toBeInTheDocument();
        expect(screen.getByText('Paths are coming.')).toBeInTheDocument();
    });
});
