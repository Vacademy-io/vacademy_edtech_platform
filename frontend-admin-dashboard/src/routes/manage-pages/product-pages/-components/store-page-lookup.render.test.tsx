import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CatalogueSyncPanel } from './CatalogueSyncPanel';
import { StorePageNotice } from './StorePageNotice';

/**
 * "Is this product page a site's store page?" means loading every site's whole
 * catalogue JSON (GET /course-catalogue/institute/get-all). The product-page
 * editor's Courses tab must not pay for that on mount — it reads the sites
 * list's cache and looks the page up only when the admin starts a sync — while
 * the Custom Fields tab warning still loads it in a cold browser tab. Real
 * React Query cache; only the network calls are mocked.
 */

const getCatalogueTags = vi.fn();
const sync = vi.fn();

vi.mock('../../-services/catalogue-service', () => ({
    getCatalogueTags: (...args: unknown[]) => getCatalogueTags(...args),
}));
vi.mock('../-services/product-pages-service', () => ({
    syncProductPageCatalogue: (...args: unknown[]) => sync(...args),
    getProductPage: vi.fn(),
}));

const site = (tagName: string, storeProductPageCode?: string) => ({
    tagName,
    catalogueJson: JSON.stringify({
        globalSettings: storeProductPageCode ? { siteCart: { enabled: true, storeProductPageCode } } : {},
        pages: [],
    }),
});
const SITES_KEY = ['catalogueTags', 'inst-1'];

const renderWithClient = (ui: ReactElement) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
};

const coursesTab = (code = 'store') => (
    <CatalogueSyncPanel productPageId="pp-1" instituteId="inst-1" productPageCode={code} onSynced={vi.fn()} />
);

/** Lets mount effects and any query they would start run. */
const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));

beforeEach(() => {
    getCatalogueTags.mockReset();
    sync.mockReset();
    sync.mockResolvedValue({ id: 'pp-1', name: 'Store', code: 'store', mappings: [], added: 0 });
});

describe('Courses tab: store-page lookup', () => {
    it('loads no sites when the tab opens', async () => {
        getCatalogueTags.mockResolvedValue([site('main', 'store')]);
        renderWithClient(coursesTab());
        await flush();
        expect(getCatalogueTags).not.toHaveBeenCalled();
        expect(screen.getByRole('checkbox')).not.toBeChecked();
    });

    it('looks the page up once a sync starts and ticks "switch off" on a store page', async () => {
        getCatalogueTags.mockResolvedValue([site('main', 'store')]);
        renderWithClient(coursesTab());
        fireEvent.click(screen.getByRole('button', { name: /Sync all catalogue courses/ }));
        expect(await screen.findByText(/never were — or that can no longer be sold/)).toBeInTheDocument();
        expect(getCatalogueTags).toHaveBeenCalledTimes(1);
        expect(getCatalogueTags).toHaveBeenCalledWith('inst-1');
        expect(screen.getByRole('checkbox', { hidden: true })).toBeChecked();
        // The lookup filled the shared cache, so the hint knows too.
        expect(screen.getByText(/Ticked by default on a store page/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
        await waitFor(() => expect(sync).toHaveBeenCalledWith('pp-1', 'inst-1', { deactivateMissing: true }));
    });

    it('leaves "switch off" unticked when no site checks out through this page', async () => {
        getCatalogueTags.mockResolvedValue([site('main', 'other-store'), site('plain')]);
        renderWithClient(coursesTab('summer'));
        fireEvent.click(screen.getByRole('button', { name: /Sync all catalogue courses/ }));
        expect(await screen.findByText(/Courses already on this page stay as they are/)).toBeInTheDocument();
        expect(screen.getByText(/Unticked by default here/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
        await waitFor(() => expect(sync).toHaveBeenCalledWith('pp-1', 'inst-1', { deactivateMissing: false }));
    });

    it('uses the sites list’s fresh cache without any request', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        client.setQueryData(SITES_KEY, [site('main', 'store')]);
        render(<QueryClientProvider client={client}>{coursesTab()}</QueryClientProvider>);
        expect(screen.getByRole('checkbox')).toBeChecked();
        fireEvent.click(screen.getByRole('button', { name: /Sync all catalogue courses/ }));
        expect(await screen.findByText(/never were — or that can no longer be sold/)).toBeInTheDocument();
        expect(getCatalogueTags).not.toHaveBeenCalled();
    });

    it('shows an older cache on mount but checks again when the sync starts', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        // Cached two minutes ago as the store page; the admin has since moved the store elsewhere.
        client.setQueryData(SITES_KEY, [site('main', 'store')], { updatedAt: Date.now() - 120_000 });
        getCatalogueTags.mockResolvedValue([site('main', 'new-store')]);
        render(<QueryClientProvider client={client}>{coursesTab()}</QueryClientProvider>);
        await flush();
        expect(getCatalogueTags).not.toHaveBeenCalled();
        expect(screen.getByRole('checkbox')).toBeChecked();
        fireEvent.click(screen.getByRole('button', { name: /Sync all catalogue courses/ }));
        expect(await screen.findByText(/Courses already on this page stay as they are/)).toBeInTheDocument();
        expect(getCatalogueTags).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('checkbox', { hidden: true })).not.toBeChecked();
    });
});

describe('Courses tab: edits during the store-page lookup', () => {
    /** The sites request, held open until the test answers it. */
    const holdSites = () => {
        let answer: (sites: unknown[]) => void = () => undefined;
        getCatalogueTags.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
        return (sites: unknown[]) => act(async () => answer(sites));
    };
    const withClient = (client: QueryClient, ui: ReactElement) => (
        <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    );
    const panel = (props: { isDirty?: boolean; productPageId?: string } = {}) => (
        <CatalogueSyncPanel
            productPageId={props.productPageId ?? 'pp-1'}
            instituteId="inst-1"
            productPageCode="store"
            isDirty={props.isDirty}
            onSynced={vi.fn()}
        />
    );

    it('does not ask when a course row was edited meanwhile, and asks at the next click once saved', async () => {
        const answerSites = holdSites();
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const { rerender } = render(withClient(client, panel()));
        fireEvent.click(screen.getByRole('button', { name: /Sync all catalogue courses/ }));
        await waitFor(() => expect(getCatalogueTags).toHaveBeenCalledTimes(1));
        // The rows are not locked during the lookup: the admin edits one.
        rerender(withClient(client, panel({ isDirty: true })));
        await answerSites([site('main', 'store')]);
        await flush();
        // A sync now would replace the edited row with the server's.
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        expect(screen.getByText(/Save your changes first/)).toBeInTheDocument();
        expect(sync).not.toHaveBeenCalled();

        // Saved: the next click asks, from the sites the lookup cached.
        rerender(withClient(client, panel()));
        fireEvent.click(screen.getByRole('button', { name: /Sync all catalogue courses/ }));
        expect(await screen.findByText(/never were — or that can no longer be sold/)).toBeInTheDocument();
        expect(getCatalogueTags).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
        await waitFor(() => expect(sync).toHaveBeenCalledWith('pp-1', 'inst-1', { deactivateMissing: true }));
    });

    it('does not ask about another page the editor moved to meanwhile', async () => {
        const answerSites = holdSites();
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const { rerender } = render(withClient(client, panel()));
        fireEvent.click(screen.getByRole('button', { name: /Sync all catalogue courses/ }));
        await waitFor(() => expect(getCatalogueTags).toHaveBeenCalledTimes(1));
        rerender(withClient(client, panel({ productPageId: 'pp-2' })));
        await answerSites([site('main', 'store')]);
        await flush();
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        expect(sync).not.toHaveBeenCalled();
    });
});

describe('Custom Fields tab: StorePageNotice', () => {
    it('loads the sites itself in a cold tab and warns on a store page', async () => {
        getCatalogueTags.mockResolvedValue([site('main', 'store')]);
        renderWithClient(<StorePageNotice productPageCode="store" instituteId="inst-1" inviteCount={12} />);
        const note = await screen.findByRole('note');
        expect(getCatalogueTags).toHaveBeenCalledTimes(1);
        expect(note).toHaveTextContent('This is the store page of the site “main”');
        expect(note).toHaveTextContent(
            'Custom fields are saved on every enroll invite this page sells (12 invites). On a store page those are your courses’ own invite links, so adding'
        );
        // It no longer claims the page sells the whole catalogue (the sync skips some courses).
        expect(note).not.toHaveTextContent(/whole catalogue/);
    });

    it('shows nothing for an ordinary product page', async () => {
        getCatalogueTags.mockResolvedValue([site('main', 'store')]);
        renderWithClient(<StorePageNotice productPageCode="summer" instituteId="inst-1" inviteCount={2} />);
        await waitFor(() => expect(getCatalogueTags).toHaveBeenCalledTimes(1));
        await flush();
        expect(screen.queryByRole('note')).not.toBeInTheDocument();
    });
});
