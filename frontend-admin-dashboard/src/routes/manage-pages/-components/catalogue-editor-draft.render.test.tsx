import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, AxiosHeaders } from 'axios';
import { CatalogueEditorPage } from './CatalogueEditorPage';
import { useEditorStore } from '../-stores/editor-store';
import * as service from '../-services/catalogue-service';

/**
 * The editor's draft guard. The 2026-10-09 incident: Python-written live JSON
 * made the editor look edited on open, autosave turned that into a draft, and
 * a later Publish would have rolled the live site back to it.
 */

vi.mock('react-i18next', async () => {
    const en = (await import('../../../../public/locales/en/managePagesCatalogueEditor.json'))
        .default;
    const t = (key: string, opts?: Record<string, unknown>) => {
        const value = key
            .split('.')
            .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], en);
        return typeof value === 'string'
            ? value.replace(/{{(\w+)}}/g, (_, name: string) => String(opts?.[name] ?? ''))
            : key;
    };
    return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});
vi.mock('../editor/$tagName', () => ({
    Route: { useParams: () => ({ tagName: 'brahm-varchas' }), useSearch: () => ({}) },
}));
vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));
vi.mock('../-hooks/use-catalogue-permissions', () => ({
    useCataloguePermissions: () => ({ canWrite: true }),
}));
const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('../-services/catalogue-service', () => ({
    getCatalogueMeta: vi.fn(),
    getDraftRevision: vi.fn(),
    saveDraftRevision: vi.fn(),
    publishDraftRevision: vi.fn(),
    discardDraftRevision: vi.fn(),
    getRevisionHistory: vi.fn(),
}));
vi.mock('../-utils/publish-checks', () => ({ runPublishChecks: () => [] }));
// The panels around the canvas are not under test here.
vi.mock('./ComponentLibrary', () => ({ ComponentLibrary: () => null }));
vi.mock('./TemplateLibrary', () => ({ TemplateLibrary: () => null }));
vi.mock('./LayersPanel', () => ({ LayersPanel: () => null }));
vi.mock('./PropertyPanel', () => ({ PropertyPanel: () => null }));
vi.mock('./PageTabs', () => ({ PageTabs: () => null }));
vi.mock('./CanvasRenderer', () => ({ CanvasRenderer: () => null }));
vi.mock('./AiCopilotPanel', () => ({ AiCopilotPanel: () => null }));
vi.mock('./AiChromePanel', () => ({ AiChromePanel: () => null }));
vi.mock('./SiteAnalyticsPanel', () => ({ SiteAnalyticsPanel: () => null }));
vi.mock('./RevisionHistoryDialog', () => ({ RevisionHistoryDialog: () => null }));
vi.mock('./PublishCheckDialog', () => ({ PublishCheckDialog: () => null }));
vi.mock('./blog/BlogManagerDialog', () => ({ BlogManagerDialog: () => null }));
vi.mock('./folders/FolderLibraryDialog', () => ({ FolderLibraryDialog: () => null }));
vi.mock('./i18n/EditingLanguageToggle', () => ({ EditingLanguageToggle: () => null }));
vi.mock('./i18n/LocalizedEditingBar', () => ({ LocalizedEditingBar: () => null }));
vi.mock('@/components/shared/freebies/FreebieDownloadsPanel', () => ({
    FreebieDownloadsPanel: () => null,
}));

const api = vi.mocked(service);

const LIVE = {
    globalSettings: { mode: 'light', i18n: { locales: ['hi'] } },
    pages: [
        {
            id: 'home',
            route: 'home',
            title: 'Home',
            components: [{ id: 'hero', type: 'hero', props: { title: 'नमस्ते, ब्रह्म वर्चस' } }],
        },
        { id: 'courses', route: 'courses', title: 'Courses', components: [] },
    ],
};
// The draft from before the live site's Figma rework: one stray prop differs.
const OLD = {
    ...LIVE,
    pages: [
        {
            ...LIVE.pages[0]!,
            components: [{ id: 'hero', type: 'hero', props: { title: 'Old title' } }],
        },
    ],
};

/** What Python's json.dumps(..., ensure_ascii=False) writes: ", " and ": ". */
const pyDumps = (v: unknown): string =>
    Array.isArray(v)
        ? `[${v.map(pyDumps).join(', ')}]`
        : v && typeof v === 'object'
          ? `{${Object.entries(v)
                .map(([k, x]) => `${JSON.stringify(k)}: ${pyDumps(x)}`)
                .join(', ')}}`
          : JSON.stringify(v);

const meta = (json = pyDumps(LIVE)) => ({ id: 'cat-1', catalogue_json: json, status: 'ACTIVE' });
const draft = (over: Partial<service.CatalogueRevision> = {}): service.CatalogueRevision => ({
    id: 'rev-1',
    revision_no: 1,
    status: 'DRAFT',
    source: 'MANUAL',
    created_at: '2026-10-09T15:00:28Z',
    updated_at: '2026-10-09T15:00:28Z',
    catalogue_json: JSON.stringify(OLD),
    ...over,
});
const HISTORY: service.CatalogueRevision[] = [
    {
        id: 'rev-5',
        revision_no: 5,
        status: 'PUBLISHED',
        source: 'LEGACY_UPDATE',
        updated_at: '2026-10-09T18:30:00Z',
    },
    {
        id: 'rev-1',
        revision_no: 1,
        status: 'DRAFT',
        source: 'MANUAL',
        created_at: '2026-10-09T15:00:28Z',
    },
];

let client: QueryClient;
/** keepClient: open the editor again in the same app session (same cache). */
const renderEditor = (keepClient = false) => {
    if (!keepClient || !client) client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <CatalogueEditorPage />
        </QueryClientProvider>
    );
};
/** The live site changes elsewhere (MCP tool, publish_site.py) and the editor refetches it. */
const liveChangesTo = async (json: string) => {
    api.getCatalogueMeta.mockResolvedValue(meta(json));
    await act(() => client.invalidateQueries({ queryKey: ['catalogueMeta'] }));
};
const edit = (title: string) =>
    act(() =>
        useEditorStore.getState().updateConfig({
            ...LIVE,
            pages: [{ ...LIVE.pages[0]!, title }, LIVE.pages[1]!],
        } as never)
    );
const NEWER_LIVE = JSON.stringify({
    ...LIVE,
    globalSettings: { ...LIVE.globalSettings, mode: 'dark' },
});
const loaded = () => screen.findByText('Save draft');
const banner = () => screen.queryByRole('alert');
/** The history says which version is live (v5) when the draft does not. */
const historyLoaded = async () => {
    await waitFor(() => expect(api.getRevisionHistory).toHaveBeenCalled());
    await act(async () => {});
};

beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.setState({ config: null, history: [], historyIndex: -1, activeTab: 'visual' });
    api.getCatalogueMeta.mockResolvedValue(meta());
    api.getDraftRevision.mockResolvedValue(null);
    api.getRevisionHistory.mockResolvedValue(HISTORY);
    api.saveDraftRevision.mockImplementation(async () => draft());
    api.publishDraftRevision.mockResolvedValue(draft({ status: 'PUBLISHED' }));
    api.discardDraftRevision.mockResolvedValue(undefined);
});
afterEach(() => {
    vi.useRealTimers();
});

describe('opening the editor', () => {
    it('Python-formatted live JSON opens clean, and autosave never fires', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        renderEditor();
        await loaded();
        // The store's config can render a moment before the saved snapshot does:
        // wait until the editor has opened the site and settled.
        await waitFor(() => expect(useEditorStore.getState().config).toEqual(LIVE));
        await act(async () => {});
        expect(await screen.findByText('Live')).toBeInTheDocument();
        expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
        await act(async () => {
            vi.advanceTimersByTime(60_000);
        });
        expect(api.saveDraftRevision).not.toHaveBeenCalled();
    });

    it('a real edit autosaves, keeping the draft source instead of forcing MANUAL', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        renderEditor();
        await loaded();
        const edited = {
            ...LIVE,
            pages: [...LIVE.pages, { id: 'about', route: 'about', components: [] }],
        };
        act(() => useEditorStore.getState().updateConfig(edited as never));
        expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
        await act(async () => {
            vi.advanceTimersByTime(46_000);
        });
        await waitFor(() => expect(api.saveDraftRevision).toHaveBeenCalledTimes(1));
        expect(api.saveDraftRevision).toHaveBeenCalledWith('cat-1', edited, null);
    });
});

describe('a draft older than the live site', () => {
    it('shows the red banner, and "Use the live site" discards the draft and shows the live JSON', async () => {
        api.getDraftRevision.mockResolvedValue(draft());
        renderEditor();
        await loaded();
        await waitFor(() => expect(banner()).toBeInTheDocument());
        expect(banner()).toHaveTextContent('The live site changed after that (v5,');
        expect(banner()).toHaveTextContent('Publishing it would undo those changes.');
        // The editor opened the draft, as before.
        expect(useEditorStore.getState().config).toEqual(OLD);

        fireEvent.click(
            screen.getByRole('button', { name: 'Use the live site (discard this draft)' })
        );
        // A saved draft is lost for good: the banner asks first, like the toolbar.
        const dialog = await screen.findByRole('alertdialog');
        expect(dialog).toHaveTextContent('Discard this draft?');
        expect(api.discardDraftRevision).not.toHaveBeenCalled();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Discard draft' }));
        await waitFor(() => expect(api.discardDraftRevision).toHaveBeenCalledWith('cat-1'));
        await waitFor(() => expect(useEditorStore.getState().config).toEqual(LIVE));
        expect(banner()).not.toBeInTheDocument();
        expect(await screen.findByText('Live')).toBeInTheDocument();
        expect(api.publishDraftRevision).not.toHaveBeenCalled();
    });

    it('trusts the server flag when the server sends one', async () => {
        api.getDraftRevision.mockResolvedValue(
            draft({
                live_changed_since_draft: true,
                live_revision_no: 7,
                live_updated_at: '2026-10-10T01:00:00Z',
            })
        );
        renderEditor();
        await loaded();
        await waitFor(() => expect(banner()).toHaveTextContent('(v7,'));
        expect(api.getRevisionHistory).not.toHaveBeenCalled();
    });

    it('shows no banner when the server says the draft is current', async () => {
        api.getDraftRevision.mockResolvedValue(draft({ live_changed_since_draft: false }));
        renderEditor();
        await loaded();
        expect(screen.getByText('Draft — not published')).toBeInTheDocument();
        expect(banner()).not.toBeInTheDocument();
    });

    it('Publish asks first, then publishes with overrideStale', async () => {
        api.getDraftRevision.mockResolvedValue(draft());
        renderEditor();
        await loaded();
        await waitFor(() => expect(banner()).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Keep my draft' }));
        expect(banner()).not.toBeInTheDocument();
        // The server is told, so the draft stops being stale for the AI tools.
        await waitFor(() =>
            expect(api.saveDraftRevision).toHaveBeenCalledWith('cat-1', OLD, null, undefined, {
                acknowledgeLive: true,
            })
        );

        fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
        const dialog = await screen.findByRole('alertdialog');
        expect(dialog).toHaveTextContent('Publish an older draft?');
        expect(api.publishDraftRevision).not.toHaveBeenCalled();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Publish anyway' }));
        await waitFor(() =>
            expect(api.publishDraftRevision).toHaveBeenCalledWith('cat-1', {
                overrideStale: true,
                expectedLiveRevisionNo: 5,
            })
        );
    });

    it('a 409 from the server opens the same confirmation', async () => {
        api.getDraftRevision.mockResolvedValue(draft({ created_at: '2026-10-10T00:00:00Z' }));
        api.publishDraftRevision.mockRejectedValueOnce(
            new AxiosError('stale', '409', undefined, undefined, {
                status: 409,
                statusText: 'Conflict',
                data: { code: 'DRAFT_OLDER_THAN_LIVE' },
                headers: {},
                config: { headers: new AxiosHeaders() },
            })
        );
        renderEditor();
        await loaded();
        await historyLoaded();
        expect(banner()).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
        await waitFor(() =>
            expect(api.publishDraftRevision).toHaveBeenCalledWith('cat-1', {
                overrideStale: false,
                expectedLiveRevisionNo: 5,
            })
        );
        expect(await screen.findByRole('alertdialog')).toHaveTextContent('Publish an older draft?');
    });
});

describe('Discard draft', () => {
    it('works for a current draft, after a confirmation', async () => {
        // Started after the live site last changed: not stale.
        api.getDraftRevision.mockResolvedValue(draft({ created_at: '2026-10-10T00:00:00Z' }));
        renderEditor();
        await loaded();
        expect(banner()).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
        const dialog = await screen.findByRole('alertdialog');
        expect(dialog).toHaveTextContent('Discard this draft?');
        expect(api.discardDraftRevision).not.toHaveBeenCalled();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Discard draft' }));
        await waitFor(() => expect(api.discardDraftRevision).toHaveBeenCalledWith('cat-1'));
        await waitFor(() => expect(useEditorStore.getState().config).toEqual(LIVE));
        expect(await screen.findByText('Live')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Discard draft' })).not.toBeInTheDocument();
    });

    it('is not offered when there is nothing to discard', async () => {
        renderEditor();
        await loaded();
        expect(screen.queryByRole('button', { name: 'Discard draft' })).not.toBeInTheDocument();
    });
});

describe('the live site changes while the editor is open', () => {
    it('Publish sends the live version the editor loaded, and the next one after publishing', async () => {
        api.publishDraftRevision.mockImplementation(async () => {
            // The server now serves what was published.
            const [, published] = api.saveDraftRevision.mock.lastCall!;
            api.getCatalogueMeta.mockResolvedValue(meta(JSON.stringify(published)));
            return draft({ status: 'PUBLISHED', revision_no: 6 });
        });
        renderEditor();
        await loaded();
        await historyLoaded();
        edit('Home 2');
        fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
        await waitFor(() =>
            expect(api.publishDraftRevision).toHaveBeenCalledWith('cat-1', {
                overrideStale: false,
                expectedLiveRevisionNo: 5,
            })
        );
        await waitFor(() => expect(screen.getByText('Live')).toBeInTheDocument());

        edit('Home 3');
        fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
        await waitFor(() =>
            expect(api.publishDraftRevision).toHaveBeenLastCalledWith('cat-1', {
                overrideStale: false,
                expectedLiveRevisionNo: 6,
            })
        );
        expect(banner()).not.toBeInTheDocument();
    });

    it('a draft autosaved after the live change still warns, and Publish asks first', async () => {
        renderEditor();
        await loaded();
        edit('Home 2');
        await liveChangesTo(NEWER_LIVE);
        await waitFor(() =>
            expect(banner()).toHaveTextContent('The live site changed after you opened the editor')
        );

        fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
        expect(await screen.findByRole('alertdialog')).toHaveTextContent('Publish an older draft?');
        expect(api.publishDraftRevision).not.toHaveBeenCalled();
    });

    it('re-publishing the same content (only formatting differs) does not warn', async () => {
        renderEditor();
        await loaded();
        edit('Home 2');
        await liveChangesTo(JSON.stringify(LIVE));
        expect(banner()).not.toBeInTheDocument();
    });

    it('"Use the live site" asks first when there are unsaved edits', async () => {
        renderEditor();
        await loaded();
        edit('Home 2');
        await liveChangesTo(NEWER_LIVE);
        await waitFor(() => expect(banner()).toBeInTheDocument());

        fireEvent.click(
            screen.getByRole('button', { name: 'Use the live site (discard this draft)' })
        );
        const dialog = await screen.findByRole('alertdialog');
        expect(dialog).toHaveTextContent('Discard this draft?');
        expect(api.discardDraftRevision).not.toHaveBeenCalled();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Discard draft' }));
        await waitFor(() =>
            expect(useEditorStore.getState().config).toEqual(JSON.parse(NEWER_LIVE))
        );
        expect(banner()).not.toBeInTheDocument();
    });

    it('"Keep my draft" hides the banner only until the live site changes again', async () => {
        api.getDraftRevision.mockResolvedValue(draft());
        renderEditor();
        await loaded();
        await waitFor(() => expect(banner()).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Keep my draft' }));
        expect(banner()).not.toBeInTheDocument();

        await liveChangesTo(NEWER_LIVE);
        await waitFor(() => expect(banner()).toBeInTheDocument());
    });
});

describe('discard and saves do not overlap', () => {
    it('the banner is busy while a save is in flight, and Ctrl+S waits for a discard', async () => {
        api.getDraftRevision.mockResolvedValue(draft());
        let finishSave: (r: service.CatalogueRevision) => void = () => {};
        api.saveDraftRevision.mockImplementationOnce(
            () => new Promise((resolve) => (finishSave = resolve))
        );
        renderEditor();
        await loaded();
        await waitFor(() => expect(banner()).toBeInTheDocument());
        const useLive = () =>
            screen.getByRole('button', { name: 'Use the live site (discard this draft)' });

        fireEvent.keyDown(window, { key: 's', ctrlKey: true });
        await waitFor(() => expect(useLive()).toBeDisabled());
        await act(async () => finishSave(draft()));
        await waitFor(() => expect(useLive()).toBeEnabled());

        let finishDiscard: () => void = () => {};
        api.discardDraftRevision.mockImplementationOnce(
            () => new Promise<void>((resolve) => (finishDiscard = resolve))
        );
        fireEvent.click(useLive());
        fireEvent.click(
            within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard draft' })
        );
        await waitFor(() => expect(api.discardDraftRevision).toHaveBeenCalled());
        fireEvent.keyDown(window, { key: 's', ctrlKey: true });
        expect(api.saveDraftRevision).toHaveBeenCalledTimes(1);
        await act(async () => finishDiscard());
        await waitFor(() => expect(screen.getByText('Live')).toBeInTheDocument());
    });

    it('a discard whose reload fails still leaves the draft gone, and says so', async () => {
        api.getDraftRevision.mockResolvedValue(draft({ created_at: '2026-10-10T00:00:00Z' }));
        renderEditor();
        await loaded();
        api.getCatalogueMeta.mockRejectedValue(new Error('offline'));

        fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
        const dialog = await screen.findByRole('alertdialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Discard draft' }));
        await waitFor(() => expect(useEditorStore.getState().config).toEqual(LIVE));
        expect(await screen.findByText('Live')).toBeInTheDocument();
        expect(toast).toHaveBeenCalledWith(
            expect.objectContaining({
                description: expect.stringContaining('could not be loaded'),
            })
        );
        expect(toast).not.toHaveBeenCalledWith(
            expect.objectContaining({ title: 'Could not discard the draft' })
        );
    });

    it('a Discard confirmed while a save is on its way waits for it, so the draft stays gone', async () => {
        api.getDraftRevision.mockResolvedValue(draft({ created_at: '2026-10-10T00:00:00Z' }));
        const order: string[] = [];
        let finishSave: (r: service.CatalogueRevision) => void = () => {};
        api.saveDraftRevision.mockImplementationOnce(() => {
            order.push('save sent');
            return new Promise((resolve) => (finishSave = resolve));
        });
        api.discardDraftRevision.mockImplementation(async () => void order.push('discard sent'));
        renderEditor();
        await loaded();
        edit('Home 2');

        // The confirmation is open, and Ctrl+S still saves underneath it.
        fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
        const dialog = await screen.findByRole('alertdialog');
        fireEvent.keyDown(window, { key: 's', ctrlKey: true });
        await waitFor(() => expect(order).toEqual(['save sent']));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Discard draft' }));
        await act(async () => {});
        // Sent after the save would have let the save re-create the draft.
        expect(order).toEqual(['save sent']);

        await act(async () => finishSave(draft()));
        await waitFor(() => expect(order).toEqual(['save sent', 'discard sent']));
        await waitFor(() => expect(useEditorStore.getState().config).toEqual(LIVE));
        // The late save's answer did not bring the draft back into the editor.
        expect(await screen.findByText('Live')).toBeInTheDocument();
    });

    it('no autosave goes out while the Discard confirmation is open', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        api.getDraftRevision.mockResolvedValue(draft({ created_at: '2026-10-10T00:00:00Z' }));
        renderEditor();
        await loaded();
        edit('Home 2');
        await act(async () => {
            vi.advanceTimersByTime(30_000);
        });
        fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
        await screen.findByRole('alertdialog');
        await act(async () => {
            vi.advanceTimersByTime(60_000);
        });
        expect(api.saveDraftRevision).not.toHaveBeenCalled();
    });
});

describe('opening the editor again in the same session', () => {
    it('loads the server draft as it is now, not the one cached from the last visit', async () => {
        api.getDraftRevision.mockResolvedValue(null);
        const first = renderEditor();
        await loaded();
        expect(useEditorStore.getState().config).toEqual(LIVE);
        first.unmount();

        // Meanwhile the AI tools saved a draft.
        const AI_DRAFT = { ...LIVE, pages: [{ ...LIVE.pages[0]!, title: 'AI home' }, LIVE.pages[1]!] };
        api.getDraftRevision.mockResolvedValue(
            draft({ created_at: '2026-10-10T00:00:00Z', catalogue_json: JSON.stringify(AI_DRAFT) })
        );
        useEditorStore.setState({ config: null, history: [], historyIndex: -1 });
        renderEditor(true);
        await loaded();
        await waitFor(() => expect(useEditorStore.getState().config).toEqual(AI_DRAFT));
        expect(screen.getByText('Draft — not published')).toBeInTheDocument();
    });
});
