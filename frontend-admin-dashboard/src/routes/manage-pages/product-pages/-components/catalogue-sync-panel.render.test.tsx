import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CatalogueSyncPanel } from './CatalogueSyncPanel';

/**
 * "Sync all catalogue courses" saves on the server at once, so it must wait
 * for unsaved edits, ask first, refresh the cached page wherever it runs from,
 * hand the fresh page back for the rows to be re-seeded, and say what it did
 * in plain words. Switching courses off is opt-in except on a store page —
 * looked up when a sync starts, never on mount (it loads every site's JSON).
 * store-page-lookup.render.test.tsx runs the lookup against a real cache.
 */

const sync = vi.fn();
const getPage = vi.fn();
const invalidateQueries = vi.fn();
const setQueryData = vi.fn();
const removeQueries = vi.fn();
/** What the sites list left in the ['catalogueTags', instituteId] cache (undefined = nothing). */
let cachedTags: unknown[] | undefined;
/** What the lookup at sync time loads. */
let catalogueTags: unknown[] = [];
const fetchQuery = vi.fn();

vi.mock('../-services/product-pages-service', () => ({
    syncProductPageCatalogue: (...args: unknown[]) => sync(...args),
    getProductPage: (...args: unknown[]) => getPage(...args),
}));
vi.mock('../../-services/catalogue-service', () => ({ getCatalogueTags: vi.fn() }));
vi.mock('@tanstack/react-query', async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    useQueryClient: () => ({ invalidateQueries, setQueryData, removeQueries, fetchQuery }),
    // Only the store-page lookup queries here (['catalogueTags', instituteId]); a
    // disabled query only reads the cache, an enabled one would load the sites.
    useQuery: ({ enabled }: { enabled?: boolean }) => ({ data: enabled === false ? cachedTags : catalogueTags }),
}));

const freshPage = { id: 'pp-1', name: 'Store', code: 'store', mappings: [{ id: 'm1' }, { id: 'm2' }] };
const storeSite = {
    tagName: 'main',
    catalogueJson: JSON.stringify({ globalSettings: { siteCart: { enabled: true, storeProductPageCode: 'store' } } }),
};

/** A summary line item by its whole text (the reason label sits in its own span). */
const listItem = (re: RegExp) =>
    screen.getByText((_, el) => el?.tagName === 'LI' && re.test(el.textContent ?? ''));

const confirmSync = () => {
    fireEvent.click(screen.getByRole('button', { name: /Sync all catalogue courses/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
};

beforeEach(() => {
    sync.mockReset();
    getPage.mockReset();
    invalidateQueries.mockReset();
    setQueryData.mockReset();
    removeQueries.mockReset();
    cachedTags = undefined;
    catalogueTags = [];
    fetchQuery.mockReset();
    fetchQuery.mockImplementation(async () => catalogueTags);
});

describe('CatalogueSyncPanel', () => {
    it('waits while the editor has unsaved changes', () => {
        render(<CatalogueSyncPanel productPageId="pp-1" instituteId="inst-1" isDirty onSynced={vi.fn()} />);
        expect(screen.getByRole('button', { name: /Sync all catalogue courses/ })).toBeDisabled();
        expect(screen.getByText(/Save your changes first/)).toBeInTheDocument();
    });

    it('asks first, syncs, caches and hands back the fresh page, and explains in plain words', async () => {
        sync.mockResolvedValue({
            ...freshPage,
            added: 2,
            deactivated: 1,
            skipped: [
                { package_session_id: 'ps-9', reason: 'cpo_not_supported', package_name: 'Yoga', level_name: 'Hindi' },
                { package_session_id: 'ps-8', reason: 'cpo_not_supported', package_name: 'Vedas', level_name: 'DEFAULT' },
                { package_session_id: 'ps-6', reason: 'invite_not_started', package_name: 'Gita' },
            ],
            deactivated_mappings: [
                { mapping_id: 'm9', package_session_id: 'ps-7', reason: 'left_catalogue', package_name: 'Summer batch' },
            ],
            warnings: ['Courses use two payment gateways; checkout charges through the first.'],
        });
        const onSynced = vi.fn();
        const onRunningChange = vi.fn();
        render(
            <CatalogueSyncPanel
                productPageId="pp-1"
                instituteId="inst-1"
                isStorePage
                onSynced={onSynced}
                onRunningChange={onRunningChange}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /Sync all catalogue courses/ }));
        // Nothing is sent until confirmed.
        expect(sync).not.toHaveBeenCalled();
        expect(screen.getByText(/never were — or that can no longer be sold/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));

        await waitFor(() => expect(onSynced).toHaveBeenCalledTimes(1));
        expect(sync).toHaveBeenCalledWith('pp-1', 'inst-1', { deactivateMissing: true });
        expect(onSynced).toHaveBeenCalledWith(freshPage);
        expect(setQueryData).toHaveBeenCalledWith(['productPage', 'pp-1'], freshPage);
        expect(getPage).not.toHaveBeenCalled();
        expect(onRunningChange.mock.calls).toEqual([[true], [false]]);

        expect(await screen.findByText('Added 2 course versions · switched off 1 · 3 not added')).toBeInTheDocument();
        expect(
            listItem(/^Instalment \(CPO\) plans cannot be sold through the cart — 2: Yoga \(Hindi\), VedasSell these/)
        ).toBeInTheDocument();
        expect(listItem(/^Its invite link has not opened yet — 1: Gita/)).toBeInTheDocument();
        expect(listItem(/^Not published to your catalogue \(including courses that never were\) — 1: Summer batch/)).toBeInTheDocument();
        // No raw machine code reaches the screen.
        expect(screen.queryByText(/cpo_not_supported|invite_not_started|left_catalogue/)).not.toBeInTheDocument();
        expect(screen.getByText(/two payment gateways/)).toBeInTheDocument();
        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['PP_OFFER_PREVIEW'] });
    });

    it('leaves courses alone by default on an ordinary page', async () => {
        sync.mockResolvedValue({ ...freshPage, added: 0 });
        render(<CatalogueSyncPanel productPageId="pp-1" instituteId="inst-1" productPageCode="summer" onSynced={vi.fn()} />);
        expect(screen.getByRole('checkbox')).not.toBeChecked();
        fireEvent.click(screen.getByRole('button', { name: /Sync all catalogue courses/ }));
        expect(await screen.findByText(/Courses already on this page stay as they are/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
        await waitFor(() => expect(sync).toHaveBeenCalledWith('pp-1', 'inst-1', { deactivateMissing: false }));
        expect(await screen.findByText('Nothing new to add')).toBeInTheDocument();
    });

    it('looks the page up only when a sync starts, and ticks "switch off" on a site’s store page', async () => {
        catalogueTags = [storeSite];
        sync.mockResolvedValue({ ...freshPage });
        render(<CatalogueSyncPanel productPageId="pp-1" instituteId="inst-1" productPageCode="store" onSynced={vi.fn()} />);
        // Nothing cached and nothing loaded yet: the default is not known.
        expect(fetchQuery).not.toHaveBeenCalled();
        expect(screen.getByRole('checkbox')).not.toBeChecked();
        expect(screen.getByText(/Ticked by default if this is a site’s store page \(checked when you sync\)/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Sync all catalogue courses/ }));
        expect(await screen.findByText(/never were — or that can no longer be sold/)).toBeInTheDocument();
        expect(fetchQuery).toHaveBeenCalledTimes(1);
        expect(fetchQuery.mock.calls[0]![0]).toMatchObject({ queryKey: ['catalogueTags', 'inst-1'], staleTime: 60_000 });
        expect(screen.getByRole('checkbox', { hidden: true })).toBeChecked();
        fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
        await waitFor(() => expect(sync).toHaveBeenCalledWith('pp-1', 'inst-1', { deactivateMissing: true }));
    });

    it('starts ticked when the sites list already cached that this is a store page', () => {
        cachedTags = [storeSite];
        render(<CatalogueSyncPanel productPageId="pp-1" instituteId="inst-1" productPageCode="store" onSynced={vi.fn()} />);
        expect(screen.getByRole('checkbox')).toBeChecked();
        expect(screen.getByText(/Ticked by default on a store page/)).toBeInTheDocument();
        expect(fetchQuery).not.toHaveBeenCalled();
    });

    it('settles the default when the dialog opens, so its wording and the sync agree', async () => {
        sync.mockResolvedValue({ ...freshPage });
        // A fresh element each time, so the rerender really re-reads the cache.
        const panel = () => (
            <CatalogueSyncPanel productPageId="pp-1" instituteId="inst-1" productPageCode="store" onSynced={vi.fn()} />
        );
        const { rerender } = render(panel());
        fireEvent.click(screen.getByRole('button', { name: /Sync all catalogue courses/ }));
        expect(await screen.findByText(/Courses already on this page stay as they are/)).toBeInTheDocument();
        // The sites' settings change while the dialog is open: it is a store page after all.
        cachedTags = [storeSite];
        rerender(panel());
        expect(screen.getByText(/Ticked by default on a store page/)).toBeInTheDocument();
        expect(screen.getByText(/Courses already on this page stay as they are/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
        await waitFor(() => expect(sync).toHaveBeenCalledWith('pp-1', 'inst-1', { deactivateMissing: false }));
    });

    it('will not sync from an open dialog once the editor has unsaved changes', () => {
        const panel = (isDirty: boolean) => (
            <CatalogueSyncPanel productPageId="pp-1" instituteId="inst-1" isStorePage isDirty={isDirty} onSynced={vi.fn()} />
        );
        const { rerender } = render(panel(false));
        fireEvent.click(screen.getByRole('button', { name: /Sync all catalogue courses/ }));
        rerender(panel(true));
        const syncNow = screen.getByRole('button', { name: 'Sync now' });
        expect(syncNow).toBeDisabled();
        fireEvent.click(syncNow);
        expect(sync).not.toHaveBeenCalled();
    });

    it('needs no lookup once the admin has ticked or unticked the box', async () => {
        sync.mockResolvedValue({ ...freshPage });
        render(<CatalogueSyncPanel productPageId="pp-1" instituteId="inst-1" productPageCode="store" onSynced={vi.fn()} />);
        fireEvent.click(screen.getByRole('checkbox'));
        confirmSync();
        await waitFor(() => expect(sync).toHaveBeenCalledWith('pp-1', 'inst-1', { deactivateMissing: true }));
        expect(fetchQuery).not.toHaveBeenCalled();
    });

    it('still asks, with "switch off" unticked, when the sites cannot be loaded', async () => {
        fetchQuery.mockRejectedValue(new Error('offline'));
        sync.mockResolvedValue({ ...freshPage });
        render(<CatalogueSyncPanel productPageId="pp-1" instituteId="inst-1" productPageCode="store" onSynced={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /Sync all catalogue courses/ }));
        expect(await screen.findByText(/Courses already on this page stay as they are/)).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { hidden: true })).not.toBeChecked();
        fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
        await waitFor(() => expect(sync).toHaveBeenCalledWith('pp-1', 'inst-1', { deactivateMissing: false }));
    });

    it('lets the admin untick it on a store page', async () => {
        sync.mockResolvedValue({ ...freshPage });
        render(<CatalogueSyncPanel productPageId="pp-1" instituteId="inst-1" isStorePage onSynced={vi.fn()} />);
        fireEvent.click(screen.getByRole('checkbox'));
        confirmSync();
        await waitFor(() => expect(sync).toHaveBeenCalledWith('pp-1', 'inst-1', { deactivateMissing: false }));
    });

    it('refreshes the cached page even with no editor to re-seed (Site cart settings)', async () => {
        sync.mockResolvedValue({ ...freshPage, added: 4, skipped: [], warnings: [] });
        render(<CatalogueSyncPanel productPageId="pp-1" instituteId="inst-1" isStorePage compact />);
        confirmSync();
        await waitFor(() => expect(setQueryData).toHaveBeenCalledWith(['productPage', 'pp-1'], freshPage));
        expect(await screen.findByText('Added 4 course versions')).toBeInTheDocument();
        // The card already knows it is the store page: no sites lookup.
        expect(fetchQuery).not.toHaveBeenCalled();
    });

    it('refetches the page when the response carries none', async () => {
        sync.mockResolvedValue({ added: 1 });
        getPage.mockResolvedValue(freshPage);
        const onSynced = vi.fn();
        render(<CatalogueSyncPanel productPageId="pp-1" instituteId="inst-1" onSynced={onSynced} />);
        confirmSync();
        await waitFor(() => expect(onSynced).toHaveBeenCalledWith(freshPage));
        expect(getPage).toHaveBeenCalledWith('pp-1');
        expect(setQueryData).toHaveBeenCalledWith(['productPage', 'pp-1'], freshPage);
    });

    it('warns before a save could undo a sync whose page could not be reloaded', async () => {
        sync.mockResolvedValue({ added: 1 });
        getPage.mockRejectedValue(new Error('offline'));
        const onSynced = vi.fn();
        const onRunningChange = vi.fn();
        render(
            <CatalogueSyncPanel
                productPageId="pp-1"
                instituteId="inst-1"
                onSynced={onSynced}
                onRunningChange={onRunningChange}
            />
        );
        confirmSync();
        expect(await screen.findByText(/The sync finished, but the updated course list could not be loaded/)).toBeInTheDocument();
        // A copy no screen shows is dropped; an open editor's copy is refetched rather than blanked.
        expect(removeQueries).toHaveBeenCalledWith({ queryKey: ['productPage', 'pp-1'], exact: true, type: 'inactive' });
        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['productPage', 'pp-1'], exact: true });
        expect(setQueryData).not.toHaveBeenCalled();
        expect(onSynced).not.toHaveBeenCalled();
        expect(onRunningChange).toHaveBeenLastCalledWith(false);
    });

    it('treats an empty reload like a failed one, never re-seeding from nothing', async () => {
        sync.mockResolvedValue({ added: 1 });
        getPage.mockResolvedValue(undefined);
        const onSynced = vi.fn();
        render(<CatalogueSyncPanel productPageId="pp-1" instituteId="inst-1" onSynced={onSynced} />);
        confirmSync();
        expect(await screen.findByText(/Reload this page before you save/)).toBeInTheDocument();
        expect(onSynced).not.toHaveBeenCalled();
        expect(setQueryData).not.toHaveBeenCalled();
    });

    it('shows the server’s reason when the sync fails and re-seeds nothing', async () => {
        sync.mockRejectedValue({ response: { data: { ex: 'Only institute admins can sync' } } });
        const onSynced = vi.fn();
        render(<CatalogueSyncPanel productPageId="pp-1" instituteId="inst-1" onSynced={onSynced} />);
        confirmSync();
        expect(await screen.findByText('Only institute admins can sync')).toBeInTheDocument();
        expect(onSynced).not.toHaveBeenCalled();
        expect(setQueryData).not.toHaveBeenCalled();
        expect(removeQueries).not.toHaveBeenCalled();
    });
});
