import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import {
    getCatalogueMeta,
    getDraftRevision,
    saveDraftRevision,
    publishDraftRevision,
    discardDraftRevision,
    getRevisionHistory,
    type CatalogueMeta,
    type CatalogueRevision,
} from '../-services/catalogue-service';
import {
    findLiveRevision,
    getDraftStaleness,
    liveChangedSinceOpened,
    needsHistoryForStaleness,
} from '../-utils/draft-staleness';
import { StaleDraftBanner, DiscardDraftDialog, StalePublishDialog } from './DraftGuard';
import { useEditorStore } from '../-stores/editor-store';
import React, { useEffect, useRef, useState } from 'react';
import { ComponentLibrary } from './ComponentLibrary';
import { TemplateLibrary } from './TemplateLibrary';
import { LayersPanel } from './LayersPanel';
import { PropertyPanel } from './PropertyPanel';
import { PageTabs } from './PageTabs';
import { CanvasRenderer } from './CanvasRenderer';
import { AiCopilotPanel } from './AiCopilotPanel';
import { SiteAnalyticsPanel } from './SiteAnalyticsPanel';
import { FreebieDownloadsPanel } from '@/components/shared/freebies/FreebieDownloadsPanel';
import { AiChromePanel } from './AiChromePanel';
import { RevisionHistoryDialog } from './RevisionHistoryDialog';
import { PublishCheckDialog } from './PublishCheckDialog';
import { BlogManagerDialog } from './blog/BlogManagerDialog';
import { FolderLibraryDialog } from './folders/FolderLibraryDialog';
import { useFolderLibraryStore } from '../-stores/folder-library-store';
import { useBlogManagerStore } from '../-stores/blog-manager-store';
import { runPublishChecks, type PublishIssue } from '../-utils/publish-checks';
import { Button } from '@/components/ui/button';
import {
    CircleNotch as Loader2, FloppyDisk as Save, Code, Layout as LayoutTemplate,
    ArrowUUpLeft as Undo2, ArrowUUpRight as Redo2, Stack as Layers,
    PuzzlePiece as PuzzleIcon, List, RocketLaunch, ClockCounterClockwise, Sparkle, ChartLine, Newspaper, Folders, Trash } from '@phosphor-icons/react';
import { useToast } from '@/hooks/use-toast';
import { isAxiosError } from 'axios';
import { Route } from '../editor/$tagName';
import { CatalogueConfig } from '../-types/editor-types';
import { useCataloguePermissions } from '../-hooks/use-catalogue-permissions';
import { useCallback } from 'react';
import {
    DndContext, DragEndEvent, DragStartEvent, DragOverlay,
    useSensor, useSensors, PointerSensor,
} from '@dnd-kit/core';
import { getComponentTemplate } from '../-utils/component-templates';
import { Textarea } from '@/components/ui/textarea';
import { activeEditingLocale, useLocalizedPanelKey } from '../-hooks/use-localized-editing';
import { EditingLanguageToggle } from './i18n/EditingLanguageToggle';
import { LocalizedEditingBar } from './i18n/LocalizedEditingBar';

export const CatalogueEditorPage = () => {
    const { t: tTemplates } = useTranslation('managePagesComponentTemplates');
    const { t: tEditor } = useTranslation('managePagesCatalogueEditor');
    const { tagName } = Route.useParams();
    const { page: linkedPageRoute, section: linkedSectionId } = Route.useSearch();
    const instituteId = getCurrentInstituteId();
    const {
        setConfig,
        config,
        activeTab,
        setActiveTab,
        updateConfig,
        undo,
        redo,
        canUndo,
        canRedo,
        selectedPageId,
        selectPage,
        selectComponent,
        selectedGlobalSettings,
        selectedGlobalLayout,
        addComponent,
        addToSlot,
        editingLocale,
        setEditingLocale,
    } = useEditorStore();
    // The site language being edited (null = base). UI state only: never saved,
    // never in undo history, and a stale choice falls back to the base language.
    const activeLocale = activeEditingLocale(config?.globalSettings?.i18n, editingLocale);
    // Rebuilds the property panel on a language flip and after a refused edit
    // (editors with a local draft must not keep showing unsaved text).
    const propertyPanelKey = useLocalizedPanelKey(activeLocale);
    const { toast } = useToast();
    const openBlog = useBlogManagerStore((s) => s.open);
    const openFolders = useFolderLibraryStore((s) => s.open);
    const { canWrite } = useCataloguePermissions();

    // Drag-from-library: pointer sensor with a small activation distance to allow clicks
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
    );

    const [activeDragLabel, setActiveDragLabel] = useState<string | null>(null);

    const handleDragStart = useCallback((event: DragStartEvent) => {
        const type = event.active.data.current?.type as string | undefined;
        setActiveDragLabel(type ? type.replace(/([A-Z])/g, ' $1').trim() : 'Component');
    }, []);

    const handleDragEnd = useCallback(
        (event: DragEndEvent) => {
            const { active, over } = event;
            if (!active.data.current?.type || !selectedPageId || !over) return;

            const templateKey = active.data.current.type as string;
            const component = getComponentTemplate(templateKey, tTemplates);
            const overId = over.id.toString();

            if (overId.startsWith('slot::')) {
                const parts = overId.split('::');
                const layoutId = parts[1];
                const slotIndex = parseInt(parts[2] ?? '', 10);
                if (layoutId && !isNaN(slotIndex)) {
                    addToSlot(selectedPageId, layoutId, slotIndex, component);
                }
            } else if (overId === 'canvas-drop-zone') {
                addComponent(selectedPageId, component);
            }

            setActiveDragLabel(null);
        },
        [selectedPageId, addComponent, addToSlot, tTemplates]
    );

    const [jsonText, setJsonText] = useState('');
    const [jsonError, setJsonError] = useState<string | null>(null);
    const [sidebarTab, setSidebarTab] = useState<'components' | 'layers' | 'templates'>('components');
    const [rightTab, setRightTab] = useState<'properties' | 'ai' | 'analytics'>('properties');
    const [savedConfigJSON, setSavedConfigJSON] = useState('');
    // Autosave bookkeeping — a layman doesn't press Save.
    const [autosaving, setAutosaving] = useState(false);
    const [lastAutosaveAt, setLastAutosaveAt] = useState<Date | null>(null);
    const configJSON = config ? JSON.stringify(config) : '';
    const isDirty = config ? configJSON !== savedConfigJSON : false;

    const queryClient = useQueryClient();
    const [hasDraft, setHasDraft] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    // Pre-publish checks: surfaced once per Publish click, never blocking.
    const [publishIssues, setPublishIssues] = useState<PublishIssue[] | null>(null);
    // A draft older than the live site: the banner can be dismissed ("Keep my
    // draft") for that live version, but publishing it still asks first and
    // then overrides. A newer live change brings the banner back.
    const [dismissedStaleKey, setDismissedStaleKey] = useState<string | null>(null);
    // The live site as the editor loaded it (reset after Publish / discard).
    // Publish sends its version so the server can refuse when the live site
    // moved on meanwhile; its JSON is compared with later refetches.
    // revisionNo: undefined = not known yet, null = unknown / none.
    const [liveAtOpen, setLiveAtOpen] = useState<{
        json: string;
        revisionNo?: number | null;
    } | null>(null);
    const openedAtRef = useRef(Date.now());
    // Bumped by a discard: a save that resolves after it must not bring the
    // draft back into the editor's state.
    const draftGenerationRef = useRef(0);
    // Every draft save still on its way to the server (autosave, Save draft).
    // A discard waits for them, or a save landing after it would bring the
    // discarded draft back on the server.
    const pendingSavesRef = useRef(new Set<Promise<unknown>>());
    const trackSave = <T,>(save: Promise<T>): Promise<T> => {
        const pending = pendingSavesRef.current;
        pending.add(save);
        const done = () => void pending.delete(save);
        save.then(done, done);
        return save;
    };
    const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
    const [showStalePublishConfirm, setShowStalePublishConfirm] = useState(false);
    const [publishOverridesStale, setPublishOverridesStale] = useState(false);

    // Draft/publish model: the editor works on a DRAFT revision; learners keep
    // seeing the last PUBLISHED config until the admin hits Publish.
    // Opening the editor always reads the server afresh: a cached draft or
    // live site from an earlier visit (up to 5 min old) could be older than
    // what the AI tools or a colleague saved since, and autosave would then
    // overwrite their draft.
    const metaQuery = useQuery({
        queryKey: ['catalogueMeta', instituteId, tagName],
        queryFn: () => getCatalogueMeta(instituteId!, tagName),
        enabled: !!instituteId && !!tagName,
        refetchOnMount: 'always',
    });
    const { data: meta, isLoading: metaLoading } = metaQuery;
    const catalogueId = meta?.id;
    const metaKey = ['catalogueMeta', instituteId, tagName];

    const draftQuery = useQuery({
        queryKey: ['catalogueDraft', catalogueId],
        queryFn: () => getDraftRevision(catalogueId!),
        enabled: !!catalogueId,
        refetchOnMount: 'always',
    });
    // Both answered since this editor opened (not just from the cache).
    const freshForHydration = metaQuery.isFetchedAfterMount && draftQuery.isFetchedAfterMount;

    const isLoading = metaLoading || (!!catalogueId && !freshForHydration);

    // The history tells which version is live when the draft does not (no
    // draft, older servers), and older servers' stale check needs to know when
    // the live site was last published.
    const revisionsQuery = useQuery({
        queryKey: ['catalogueRevisions', catalogueId],
        queryFn: () => getRevisionHistory(catalogueId!),
        enabled:
            !!catalogueId &&
            draftQuery.isFetched &&
            (typeof draftQuery.data?.live_revision_no !== 'number' ||
                needsHistoryForStaleness(draftQuery.data, meta)),
    });
    const draftStaleness = getDraftStaleness(draftQuery.data, meta, revisionsQuery.data);
    const staleness = draftStaleness.stale
        ? draftStaleness
        : liveChangedSinceOpened(liveAtOpen?.json, meta, configJSON, revisionsQuery.data);
    const staleKey = staleness.stale
        ? `${staleness.liveRevisionNo ?? ''}|${meta?.catalogue_json ?? ''}`
        : null;
    const showStaleBanner =
        staleness.stale && (hasDraft || !!staleness.sinceOpened) && staleKey !== dismissedStaleKey;

    // Which version was live at open: from the draft (newer servers) or the
    // history. Only answers fetched since this editor opened count — a cached
    // one from an earlier visit may be older.
    useEffect(() => {
        setLiveAtOpen((prev) => {
            if (!prev || prev.revisionNo !== undefined) return prev;
            const fresh = (at: number) => at >= openedAtRef.current;
            const draftLiveNo = draftQuery.data?.live_revision_no;
            if (fresh(draftQuery.dataUpdatedAt) && typeof draftLiveNo === 'number') {
                return { ...prev, revisionNo: draftLiveNo };
            }
            if (revisionsQuery.data && fresh(revisionsQuery.dataUpdatedAt)) {
                return {
                    ...prev,
                    revisionNo: findLiveRevision(revisionsQuery.data)?.revision_no ?? null,
                };
            }
            return prev;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [liveAtOpen?.json, draftQuery.dataUpdatedAt, revisionsQuery.dataUpdatedAt]);

    // Keep the draft cache honest (the save response omits the JSON) so a later
    // focus refetch doesn't look like fresh server state.
    const cacheSavedDraft = (savedRevision: CatalogueRevision, savedConfig: CatalogueConfig) =>
        queryClient.setQueryData<CatalogueRevision | null>(
            ['catalogueDraft', catalogueId],
            (prev) => ({
                ...prev,
                ...savedRevision,
                catalogue_json: JSON.stringify(savedConfig),
            })
        );

    const saveMutation = useMutation({
        mutationFn: (newConfig: CatalogueConfig) =>
            trackSave(saveDraftRevision(catalogueId!, newConfig)),
        onMutate: () => draftGenerationRef.current,
        onSuccess: (savedRevision, savedConfig, generation) => {
            if (generation !== draftGenerationRef.current) return;
            setSavedConfigJSON(JSON.stringify(savedConfig));
            setHasDraft(true);
            cacheSavedDraft(savedRevision, savedConfig);
            toast({ title: 'Draft saved', description: 'Publish when you want learners to see it' });
        },
        onError: (err) => {
            toast({
                title: 'Error',
                description: 'Failed to save changes',
                variant: 'destructive',
            });
            console.error(err);
        },
    });

    const publishMutation = useMutation({
        mutationFn: async (overrideStale: boolean) => {
            // Publish always ships what's on screen: persist the draft first
            const publishedJSON = config ? JSON.stringify(config) : null;
            if (config) await saveDraftRevision(catalogueId!, config);
            const revision = await publishDraftRevision(catalogueId!, {
                overrideStale,
                expectedLiveRevisionNo: liveAtOpen?.revisionNo,
            });
            return { revision, publishedJSON };
        },
        onSuccess: ({ revision, publishedJSON }) => {
            if (publishedJSON) {
                setSavedConfigJSON(publishedJSON);
                // What is live now, before the refetch lands.
                queryClient.setQueryData<CatalogueMeta>(metaKey, (prev) =>
                    prev ? { ...prev, catalogue_json: publishedJSON } : prev
                );
                setLiveAtOpen({ json: publishedJSON, revisionNo: revision.revision_no ?? null });
            }
            setHasDraft(false);
            setDismissedStaleKey(null);
            // The draft was promoted — clear its cache or the stale entry flips
            // the badge back to "Draft" on the next refetch.
            queryClient.setQueryData(['catalogueDraft', catalogueId], null);
            queryClient.invalidateQueries({ queryKey: ['catalogueMeta', instituteId, tagName] });
            queryClient.invalidateQueries({ queryKey: ['catalogueRevisions', catalogueId] });
            toast({ title: 'Published', description: 'The site is now live with this version' });
        },
        onError: (err) => {
            // The server knows the live site changed after this draft began.
            if (isAxiosError(err) && err.response?.status === 409) {
                queryClient.invalidateQueries({ queryKey: metaKey });
                setShowStalePublishConfirm(true);
                return;
            }
            toast({ title: 'Publish failed', description: 'Please try again', variant: 'destructive' });
            console.error(err);
        },
    });

    // Drop the draft and show the live site, freshly fetched: it may have
    // changed again since the editor opened.
    const discardMutation = useMutation({
        onMutate: () => {
            draftGenerationRef.current += 1;
        },
        mutationFn: async () => {
            // A save already sent must reach the server first, so the
            // discard removes it rather than it bringing the draft back.
            await Promise.allSettled([...pendingSavesRef.current]);
            await discardDraftRevision(catalogueId!);
            // Gone on the server, whatever happens next.
            setHasDraft(false);
            queryClient.setQueryData(['catalogueDraft', catalogueId], null);
            const [fresh, history] = await Promise.allSettled([
                queryClient.fetchQuery({
                    queryKey: metaKey,
                    queryFn: () => getCatalogueMeta(instituteId!, tagName),
                    staleTime: 0,
                }),
                queryClient.fetchQuery({
                    queryKey: ['catalogueRevisions', catalogueId],
                    queryFn: () => getRevisionHistory(catalogueId!),
                    staleTime: 0,
                }),
            ]);
            return {
                // Could not reload: fall back to the live JSON already loaded.
                liveMeta:
                    fresh.status === 'fulfilled'
                        ? fresh.value
                        : queryClient.getQueryData<CatalogueMeta>(metaKey) ?? meta,
                reloaded: fresh.status === 'fulfilled',
                liveRevisionNo:
                    history.status === 'fulfilled'
                        ? findLiveRevision(history.value)?.revision_no ?? null
                        : null,
            };
        },
        onSuccess: ({ liveMeta, reloaded, liveRevisionNo }) => {
            setLastAutosaveAt(null);
            setDismissedStaleKey(null);
            if (liveMeta) {
                setLiveAtOpen({ json: liveMeta.catalogue_json, revisionNo: liveRevisionNo });
                try {
                    const parsed = JSON.parse(liveMeta.catalogue_json) as CatalogueConfig;
                    setConfig(parsed);
                    setSavedConfigJSON(JSON.stringify(parsed));
                } catch (e) {
                    console.error('Failed to parse live catalogue JSON', e);
                }
            }
            toast({
                title: tEditor('draft.discardedTitle'),
                description: tEditor(
                    reloaded ? 'draft.discardedBody' : 'draft.discardedReloadBody'
                ),
            });
        },
        onError: (err) => {
            toast({
                title: tEditor('draft.discardFailedTitle'),
                description: tEditor('draft.tryAgain'),
                variant: 'destructive',
            });
            console.error(err);
        },
    });

    const startPublish = (overrideStale: boolean) => {
        const issues = config ? runPublishChecks(config) : [];
        if (issues.length > 0) {
            setPublishOverridesStale(overrideStale);
            setPublishIssues(issues);
            return;
        }
        publishMutation.mutate(overrideStale);
    };

    // Hydrate ONCE per catalogue. Background refetches (window focus,
    // post-publish invalidation) must never re-run setConfig — it resets undo
    // history/selection and would clobber unsaved edits.
    const loadedForRef = useRef<string | null>(null);
    useEffect(() => {
        if (!meta || !freshForHydration) return;
        if (loadedForRef.current === meta.id) return;
        const json = draftQuery.data?.catalogue_json || meta.catalogue_json;
        if (!json) return;
        try {
            const parsed = JSON.parse(json);
            setConfig(parsed);
            // Compare like with like: isDirty uses JSON.stringify(config), and
            // JSON written elsewhere (Python's ", " separators) differs as text.
            setSavedConfigJSON(JSON.stringify(parsed));
            setHasDraft(!!draftQuery.data);
            setLiveAtOpen({ json: meta.catalogue_json, revisionNo: undefined });
            loadedForRef.current = meta.id;
            // Deep link (?page=&section=): land on the page/section that was
            // just changed instead of the first page.
            if (linkedPageRoute) {
                const wanted = linkedPageRoute.replace(/^\//, '').toLowerCase();
                const target = (parsed.pages || []).find(
                    (p: { route?: string; id?: string }) =>
                        String(p.route || '')
                            .replace(/^\//, '')
                            .toLowerCase() === wanted || p.id === linkedPageRoute
                );
                if (target?.id) {
                    selectPage(target.id);
                    if (linkedSectionId) selectComponent(linkedSectionId);
                }
            }
        } catch (e) {
            console.error('Failed to parse catalogue JSON', e);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [meta, freshForHydration, draftQuery.data, setConfig]);

    // Warn before leaving with unsaved changes
    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => {
            if (isDirty) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [isDirty]);

    // Autosave: debounce 45s after the last edit, then persist the draft
    // silently (no toast — the status chip tells the story). The server draft
    // doubles as crash recovery; before this, closing the tab past the browser
    // prompt ate everything since the last manual save.
    useEffect(() => {
        if (!isDirty || !catalogueId || !canWrite || jsonError) return;
        if (saveMutation.isPending || publishMutation.isPending || discardMutation.isPending)
            return;
        // Not while the admin is deciding whether to discard this draft.
        if (showDiscardConfirm) return;
        const t = window.setTimeout(async () => {
            try {
                setAutosaving(true);
                const snapshot = config!;
                const generation = draftGenerationRef.current;
                // null source: an AI-made draft stays an AI draft when autosaved.
                const savedRevision = await trackSave(saveDraftRevision(catalogueId, snapshot, null));
                if (generation !== draftGenerationRef.current) return;
                setSavedConfigJSON(JSON.stringify(snapshot));
                setHasDraft(true);
                setLastAutosaveAt(new Date());
                cacheSavedDraft(savedRevision, snapshot);
            } catch (e) {
                // Non-fatal by design: the next edit re-arms the timer, and the
                // manual Save button still surfaces real errors loudly.
                console.error('[autosave] failed', e);
            } finally {
                setAutosaving(false);
            }
        }, 45_000);
        return () => window.clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        config,
        isDirty,
        catalogueId,
        canWrite,
        jsonError,
        saveMutation.isPending,
        publishMutation.isPending,
        discardMutation.isPending,
        showDiscardConfirm,
    ]);

    // Sync JSON text when switching to JSON mode
    useEffect(() => {
        if (activeTab === 'json' && config) {
            setJsonText(JSON.stringify(config, null, 2));
            setJsonError(null);
        }
    }, [activeTab, config]);

    const handleJsonChange = (value: string) => {
        setJsonText(value);
        try {
            const parsed = JSON.parse(value);
            // Validate required top-level structure
            if (!parsed.globalSettings || !Array.isArray(parsed.pages)) {
                setJsonError('JSON must have "globalSettings" and "pages" array');
                return;
            }
            setJsonError(null);
            updateConfig(parsed);
        } catch {
            setJsonError('Invalid JSON');
        }
    };

    // Keyboard shortcuts: Undo/Redo + Ctrl+S to save
    const { mutate: saveNow, isPending: savePending } = saveMutation;
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Inside a dialog (e.g. "Edit as JSON") Undo/Redo belong to what is
            // being typed there, not to the site behind it.
            const inDialog = e.target instanceof Element && !!e.target.closest('[role="dialog"]');
            if (inDialog && (e.ctrlKey || e.metaKey) && /^[zy]$/i.test(e.key)) return;
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                if (canUndo()) undo();
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
                e.preventDefault();
                if (canRedo()) redo();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                if (
                    config &&
                    canWrite &&
                    !savePending &&
                    !publishMutation.isPending &&
                    !discardMutation.isPending &&
                    !jsonError &&
                    catalogueId
                ) {
                    saveNow(config);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [
        undo,
        redo,
        canUndo,
        canRedo,
        config,
        canWrite,
        savePending,
        saveNow,
        publishMutation.isPending,
        discardMutation.isPending,
        jsonError,
        catalogueId,
    ]);

    // Another language: the language was removed (undo, settings) → back to base;
    // the AI panels edit the base language, so they are not offered meanwhile.
    useEffect(() => {
        if (editingLocale && !activeLocale) setEditingLocale(null);
    }, [editingLocale, activeLocale, setEditingLocale]);
    useEffect(() => {
        if (activeLocale && rightTab === 'ai') setRightTab('properties');
    }, [activeLocale, rightTab]);

    // When a component is added, switch layers tab so user can see it
    // (handled by selectComponent in store — no extra work needed)

    if (isLoading)
        return (
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="animate-spin" />
            </div>
        );
    if (!config) return <div className="p-10">Failed to load configuration.</div>;

    return (
        <div className="flex h-screen w-full flex-col overflow-hidden bg-gray-50">
            {/* Top Bar */}
            <div className="flex h-14 shrink-0 items-center justify-between border-b bg-white px-4">
                <div className="flex items-center gap-4">
                    <h2 className="font-semibold">Page Editor: {tagName}</h2>
                    {/* Mode Toggle */}
                    <div className="flex rounded-lg border bg-gray-100 p-0.5">
                        <Button
                            variant={activeTab === 'visual' ? 'secondary' : 'ghost'}
                            size="sm"
                            onClick={() => setActiveTab('visual')}
                            className="gap-1"
                        >
                            <LayoutTemplate className="size-4" />
                            Visual
                        </Button>
                        <Button
                            variant={activeTab === 'json' ? 'secondary' : 'ghost'}
                            size="sm"
                            onClick={() => setActiveTab('json')}
                            className="gap-1"
                        >
                            <Code className="size-4" />
                            JSON
                        </Button>
                    </div>
                    {activeTab === 'visual' && (
                        <EditingLanguageToggle
                            i18n={config.globalSettings?.i18n}
                            editingLocale={editingLocale}
                            onChange={setEditingLocale}
                        />
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {/* Draft / live status */}
                    {hasDraft || isDirty || autosaving ? (
                        <span className="flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-600">
                            <span className="size-2 rounded-full bg-amber-500" />
                            {autosaving
                                ? 'Saving…'
                                : isDirty
                                  ? 'Unsaved changes'
                                  : lastAutosaveAt
                                    ? `Draft · autosaved ${lastAutosaveAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                                    : 'Draft — not published'}
                        </span>
                    ) : (
                        <span className="flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-600">
                            <span className="size-2 rounded-full bg-green-500" />
                            Live
                        </span>
                    )}
                    {/* Undo/Redo */}
                    <div className="flex rounded-lg border bg-gray-100 p-0.5">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={undo}
                            disabled={!canUndo()}
                            title="Undo (Ctrl+Z)"
                        >
                            <Undo2 className="size-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={redo}
                            disabled={!canRedo()}
                            title="Redo (Ctrl+Y)"
                        >
                            <Redo2 className="size-4" />
                        </Button>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openBlog()}
                        title="Blog posts — write and publish articles for the Blog section"
                    >
                        <Newspaper className="size-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openFolders()}
                        title="Folders — organise product pages into folders for the Folder Browser section"
                    >
                        <Folders className="size-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowHistory(true)}
                        title="Version history"
                        disabled={!catalogueId}
                    >
                        <ClockCounterClockwise className="size-4" />
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => saveMutation.mutate(config)}
                        disabled={
                            saveMutation.isPending ||
                            publishMutation.isPending ||
                            discardMutation.isPending ||
                            !canWrite ||
                            !!jsonError ||
                            !catalogueId
                        }
                    >
                        <Save className="mr-2 size-4" />
                        Save draft
                    </Button>
                    {(hasDraft || isDirty) && (
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setShowDiscardConfirm(true)}
                            disabled={
                                discardMutation.isPending ||
                                saveMutation.isPending ||
                                publishMutation.isPending ||
                                autosaving ||
                                !canWrite ||
                                !catalogueId
                            }
                            title={tEditor('draft.discardHint')}
                            className="text-red-600 hover:text-red-700"
                        >
                            <Trash className="size-4" />
                            {tEditor('draft.discard')}
                        </Button>
                    )}
                    <Button
                        size="sm"
                        onClick={() => {
                            // A draft kept over a newer live site ("Keep my
                            // draft") still asks before it replaces that site.
                            if (staleness.stale || dismissedStaleKey) {
                                setShowStalePublishConfirm(true);
                                return;
                            }
                            startPublish(false);
                        }}
                        disabled={
                            publishMutation.isPending ||
                            saveMutation.isPending ||
                            discardMutation.isPending ||
                            !canWrite ||
                            !!jsonError ||
                            !catalogueId ||
                            (!hasDraft && !isDirty)
                        }
                        title="Make this version live for learners"
                    >
                        {publishMutation.isPending ? (
                            <Loader2 className="mr-2 size-4 animate-spin" />
                        ) : (
                            <RocketLaunch className="mr-2 size-4" />
                        )}
                        Publish
                    </Button>
                </div>
            </div>

            {/* The open draft is older than the live site */}
            {showStaleBanner && (
                <StaleDraftBanner
                    staleness={staleness}
                    busy={
                        discardMutation.isPending ||
                        publishMutation.isPending ||
                        saveMutation.isPending ||
                        autosaving
                    }
                    // A saved draft or unsaved edits are lost for good: ask first,
                    // exactly as the toolbar's Discard does.
                    onUseLive={() =>
                        hasDraft || isDirty ? setShowDiscardConfirm(true) : discardMutation.mutate()
                    }
                    onKeepDraft={() => {
                        setDismissedStaleKey(staleKey);
                        // Tell the server too, so the draft stops being reported
                        // stale (the AI tools would otherwise keep refusing it and
                        // reading the live site instead) until live moves again.
                        if (hasDraft && config && catalogueId && canWrite && !jsonError) {
                            const generation = draftGenerationRef.current;
                            const snapshot = config;
                            trackSave(
                                saveDraftRevision(catalogueId, snapshot, null, undefined, {
                                    acknowledgeLive: true,
                                })
                            )
                                .then((saved) => {
                                    if (generation !== draftGenerationRef.current) return;
                                    setSavedConfigJSON(JSON.stringify(snapshot));
                                    cacheSavedDraft({ ...saved, live_changed_since_draft: false }, snapshot);
                                })
                                .catch((e) => console.error('[keep draft] failed', e));
                        }
                    }}
                />
            )}
            <DiscardDraftDialog
                open={showDiscardConfirm}
                onOpenChange={setShowDiscardConfirm}
                onConfirm={() => {
                    setShowDiscardConfirm(false);
                    discardMutation.mutate();
                }}
            />
            <StalePublishDialog
                open={showStalePublishConfirm}
                onOpenChange={setShowStalePublishConfirm}
                onConfirm={() => {
                    setShowStalePublishConfirm(false);
                    startPublish(true);
                }}
            />

            {/* Pre-publish checks — warn, never block */}
            <PublishCheckDialog
                open={!!publishIssues}
                onOpenChange={(o) => !o && setPublishIssues(null)}
                issues={publishIssues || []}
                onConfirm={() => {
                    setPublishIssues(null);
                    publishMutation.mutate(publishOverridesStale);
                }}
                onJumpTo={(issue) => {
                    if (issue.pageId) selectPage(issue.pageId);
                    if (issue.componentId) selectComponent(issue.componentId);
                }}
            />

            {/* Blog posts, managed without leaving the builder */}
            <BlogManagerDialog />
            <FolderLibraryDialog />

            {/* Version history */}
            <RevisionHistoryDialog
                open={showHistory}
                onOpenChange={setShowHistory}
                catalogueId={catalogueId}
                onRestore={(json) => {
                    try {
                        const parsed = JSON.parse(json) as CatalogueConfig;
                        updateConfig(parsed);
                        // Restored config may not contain the selected page —
                        // reselect so the canvas doesn't go blank.
                        if (!parsed.pages.some((p) => p.id === selectedPageId) && parsed.pages[0]) {
                            selectPage(parsed.pages[0].id);
                        }
                    } catch (e) {
                        console.error('Failed to parse revision JSON', e);
                    }
                }}
            />

            {/* Main Content */}
            {activeTab === 'json' ? (
                /* JSON Editor Mode */
                <div className="flex flex-1 flex-col overflow-hidden bg-gray-900 p-4">
                    <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm text-gray-400">Edit JSON Configuration</span>
                        {jsonError && (
                            <span className="rounded bg-red-500 px-2 py-1 text-xs text-white">
                                {jsonError}
                            </span>
                        )}
                    </div>
                    <Textarea
                        value={jsonText}
                        onChange={(e) => handleJsonChange(e.target.value)}
                        className="flex-1 resize-none bg-gray-800 font-mono text-sm text-green-400"
                        spellCheck={false}
                    />
                </div>
            ) : (
                /* Visual Editor Mode — direct-DOM canvas */
                <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                    <div className="flex flex-1 overflow-hidden">
                        {/* Left Sidebar */}
                        <div className="flex w-64 flex-col border-r bg-white">
                            {/* Three-tab strip */}
                            <div className="flex shrink-0 border-b">
                                <button
                                    onClick={() => setSidebarTab('components')}
                                    className={`flex flex-1 items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors ${
                                        sidebarTab === 'components'
                                            ? 'border-b-2 border-blue-500 text-blue-600'
                                            : 'text-gray-500 hover:text-gray-700'
                                    }`}
                                    title="Components"
                                >
                                    <PuzzleIcon className="size-3.5" />
                                    Add
                                </button>
                                <button
                                    onClick={() => setSidebarTab('layers')}
                                    className={`flex flex-1 items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors ${
                                        sidebarTab === 'layers'
                                            ? 'border-b-2 border-blue-500 text-blue-600'
                                            : 'text-gray-500 hover:text-gray-700'
                                    }`}
                                    title="Layers — current page structure"
                                >
                                    <List className="size-3.5" />
                                    Layers
                                </button>
                                <button
                                    onClick={() => setSidebarTab('templates')}
                                    className={`flex flex-1 items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors ${
                                        sidebarTab === 'templates'
                                            ? 'border-b-2 border-blue-500 text-blue-600'
                                            : 'text-gray-500 hover:text-gray-700'
                                    }`}
                                    title="Page templates"
                                >
                                    <Layers className="size-3.5" />
                                    Templates
                                </button>
                            </div>

                            {/* Sidebar content */}
                            <div className="flex flex-1 flex-col overflow-hidden">
                                {sidebarTab === 'components' && <ComponentLibrary />}
                                {sidebarTab === 'layers' && <LayersPanel />}
                                {sidebarTab === 'templates' && <TemplateLibrary />}
                            </div>
                        </div>

                        {/* Center — Direct-DOM canvas + page tabs */}
                        <div className="flex flex-1 flex-col overflow-hidden">
                            <div className="flex-1 overflow-hidden">
                                <CanvasRenderer tagName={tagName} liveConfigJson={meta?.catalogue_json} />
                            </div>
                            {/* Bottom — Page Tabs */}
                            <div className="h-12 shrink-0 border-t bg-white">
                                <PageTabs />
                            </div>
                        </div>

                        {/* Right Sidebar — Properties / AI copilot */}
                        <div className="flex w-80 flex-col overflow-hidden border-l bg-white">
                            <div className="flex shrink-0 border-b">
                                <button
                                    onClick={() => setRightTab('properties')}
                                    className={`flex flex-1 items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors ${
                                        rightTab === 'properties'
                                            ? 'border-b-2 border-blue-500 text-blue-600'
                                            : 'text-gray-500 hover:text-gray-700'
                                    }`}
                                >
                                    Properties
                                </button>
                                <button
                                    onClick={() => setRightTab('ai')}
                                    disabled={!!activeLocale}
                                    title={
                                        activeLocale
                                            ? 'AI edits the base language — switch Editing back to use it'
                                            : undefined
                                    }
                                    className={`flex flex-1 items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors ${
                                        rightTab === 'ai'
                                            ? 'border-b-2 border-primary-500 text-primary-500'
                                            : 'text-gray-500 hover:text-gray-700'
                                    }${activeLocale ? ' cursor-not-allowed opacity-40' : ''}`}
                                >
                                    <Sparkle className="size-3.5" weight="duotone" />
                                    AI
                                </button>
                                <button
                                    onClick={() => setRightTab('analytics')}
                                    className={`flex flex-1 items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors ${
                                        rightTab === 'analytics'
                                            ? 'border-b-2 border-primary-500 text-primary-500'
                                            : 'text-gray-500 hover:text-gray-700'
                                    }`}
                                >
                                    <ChartLine className="size-3.5" weight="duotone" />
                                    Traffic
                                </button>
                            </div>
                            {rightTab === 'analytics' ? (
                                <div className="flex-1 overflow-auto">
                                    <SiteAnalyticsPanel />
                                    <div className="border-t border-neutral-200">
                                        <FreebieDownloadsPanel narrow />
                                    </div>
                                </div>
                            ) : rightTab === 'properties' ? (
                                <div className="flex-1 overflow-auto">
                                    {activeLocale && (
                                        <LocalizedEditingBar
                                            i18n={config.globalSettings?.i18n}
                                            locale={activeLocale}
                                            globalSettingsSelected={selectedGlobalSettings}
                                        />
                                    )}
                                    {/* Remount on a language flip and after a refused edit:
                                        editors keep local state (rich-text, list drafts)
                                        that must match the stored text. */}
                                    <PropertyPanel key={propertyPanelKey} />
                                </div>
                            ) : selectedGlobalSettings || selectedGlobalLayout ? (
                                // Global Settings selected → AI edits the shared site
                                // chrome (header/footer/theme) instead of a page.
                                <AiChromePanel />
                            ) : (
                                <AiCopilotPanel />
                            )}
                        </div>
                    </div>

                    {/* Floating drag ghost */}
                    <DragOverlay dropAnimation={null}>
                        {activeDragLabel && (
                            <div className="pointer-events-none z-50 rounded-lg border-2 border-blue-400 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 shadow-xl">
                                + {activeDragLabel}
                            </div>
                        )}
                    </DragOverlay>
                </DndContext>
            )}
        </div>
    );
};
