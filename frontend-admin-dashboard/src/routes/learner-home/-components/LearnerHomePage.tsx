import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HouseLine, LockSimple, PuzzlePiece } from '@phosphor-icons/react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MyButton } from '@/components/design-system/button';
import { getInstituteId } from '@/constants/helper';
import { cn } from '@/lib/utils';
import { useLearnerHomeAccess } from '@/lib/learner-home/use-learner-home-access';
import { readCurrentInstituteIdSafely, syncCapabilitiesOnce } from '@/services/capabilities';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import type {
    BuiltinWidget,
    CheckIssue,
    ContentBlockType,
    HomeBlock,
} from '../-types/learner-home-types';
import { learnerHomeApi, toLearnerHomeError } from '../-services/learner-home-service';
import {
    createBuiltinBlock,
    createContentBlock,
    DEFAULT_SETTINGS,
    duplicateBlock,
} from '../-utils/block-factory';
import { buildCreatePayload } from '../-utils/payload';
import { errorsOf, mergeIssues, runPublishChecks } from '../-utils/publish-checks';
import { hasUnsavedEdits, useLearnerHomeDraft } from '../-hooks/useLearnerHomeDraft';
import { useDraftAutosave } from '../-hooks/useDraftAutosave';
import { useMediaQuery, XL_QUERY } from '../-hooks/useMediaQuery';
import { PANES, paneForKey, type Pane } from '../-utils/pane-keys';
import {
    useBatchOptions,
    useCourseOptions,
    useHasStoreSite,
    useLearnerTagOptions,
} from '../-hooks/usePickerOptions';
import { AddBlockMenu } from './AddBlockMenu';
import { BlockEditorPanel } from './BlockEditorPanel';
import { BlockList } from './BlockList';
import { ConflictBanner, EditorTopBar } from './EditorTopBar';
import { HomePreviewFrame } from './HomePreviewFrame';
import { PublishDialog, type PublishOutcome } from './PublishDialog';
import { ResultsTab } from './ResultsTab';
import { StartScreen, type StartChoice, type StartFailure } from './StartScreen';
import { VersionsDrawer } from './VersionsDrawer';

const draftQueryKey = (instituteId: string) => ['learner-home', 'draft', instituteId] as const;

function StateCard({
    icon: Icon,
    title,
    body,
}: {
    icon: typeof LockSimple;
    title: string;
    body: string;
}) {
    return (
        <div
            role="status"
            className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center"
        >
            <div className="flex size-14 items-center justify-center rounded-full bg-neutral-100">
                <Icon className="size-7 text-neutral-500" weight="duotone" aria-hidden />
            </div>
            <h2 className="text-h3-semibold text-neutral-800">{title}</h2>
            <p className="max-w-md text-body text-neutral-600">{body}</p>
        </div>
    );
}

/**
 * Learner home (spec 8): institute ADMINs of institutes with the
 * `learner_home` module. Everything else gets a short explanation.
 */
export function LearnerHomePage() {
    const { t } = useTranslation('learnerHome');
    const { setNavHeading } = useNavHeadingStore();
    const access = useLearnerHomeAccess();
    const instituteId = getInstituteId() ?? '';

    useEffect(() => {
        setNavHeading(<h1 className="font-medium">{t('page.title')}</h1>);
    }, [setNavHeading, t]);
    useEffect(() => {
        void syncCapabilitiesOnce(readCurrentInstituteIdSafely());
    }, []);

    if (!access.isAdmin) {
        return (
            <StateCard
                icon={LockSimple}
                title={t('page.noAccessTitle')}
                body={t('page.noAccessBody')}
            />
        );
    }
    if (!access.isResolved) {
        return (
            <div className="space-y-4 p-4" aria-busy="true">
                <Skeleton className="h-8 w-56" />
                <Skeleton className="h-64 w-full" />
            </div>
        );
    }
    if (!access.moduleOn || !instituteId) {
        return (
            <StateCard
                icon={PuzzlePiece}
                title={t('page.notEnabledTitle')}
                body={t('page.notEnabledBody')}
            />
        );
    }
    return <LearnerHomeWorkspace instituteId={instituteId} />;
}

function LearnerHomeWorkspace({ instituteId }: { instituteId: string }) {
    const { t } = useTranslation('learnerHome');
    const queryClient = useQueryClient();
    const draftQuery = useQuery({
        queryKey: draftQueryKey(instituteId),
        queryFn: () => learnerHomeApi.getDraft(instituteId),
        refetchOnWindowFocus: false,
    });
    const store = useLearnerHomeDraft();
    const { saveNow, reloadFromServer, overwrite, flushPending } = useDraftAutosave(
        instituteId,
        !!store.layoutId
    );
    const hasStoreSite = useHasStoreSite();
    const courses = useCourseOptions();
    const batches = useBatchOptions();
    const learnerTags = useLearnerTagOptions();
    const [tab, setTab] = useState<'editor' | 'results'>('editor');
    const [pane, setPane] = useState<Pane>('list');
    // Below xl the three panes are tabs: only one shows at a time.
    const isXl = useMediaQuery(XL_QUERY);
    const [focusEditorToken, setFocusEditorToken] = useState(0);
    const tabRefs = useRef<Partial<Record<Pane, HTMLButtonElement | null>>>({});
    /** Opens the editor for a block; below xl the list hides, so focus moves to its heading. */
    const openEditor = () => {
        setPane('edit');
        if (!isXl) setFocusEditorToken((n) => n + 1);
    };
    const paneProps = (p: Pane, label: string) =>
        isXl
            ? { 'aria-label': label }
            : {
                  role: 'tabpanel',
                  id: `lh-panel-${p}`,
                  'aria-labelledby': `lh-tab-${p}`,
                  tabIndex: -1,
              };
    const [versionsOpen, setVersionsOpen] = useState(false);
    const [publishOpen, setPublishOpen] = useState(false);
    const [confirmUnpublish, setConfirmUnpublish] = useState(false);
    const [holistic, setHolistic] = useState(false);

    const data = draftQuery.data;
    // The server's draft becomes the editor's draft once; later saves keep the store ahead.
    useEffect(() => {
        if (!data) return;
        const s = useLearnerHomeDraft.getState();
        // A newer saved revision (e.g. the flush from the last visit) replaces an
        // untouched copy in memory.
        if (
            data.draft &&
            (data.draft.id !== s.layoutId ||
                (data.draft.revision > s.revision && !hasUnsavedEdits(s)))
        ) {
            s.load(data.draft);
        }
        if (!data.draft && s.layoutId) s.clear();
    }, [data]);
    // Leaving the page drops the draft from memory (it is saved on the server).
    // Edits younger than the autosave delay are sent first, then the draft is
    // re-read so coming back shows what was saved.
    const flushRef = useRef(flushPending);
    flushRef.current = flushPending;
    useEffect(
        () => () => {
            void flushRef
                .current()
                .then(() =>
                    queryClient.invalidateQueries({ queryKey: draftQueryKey(instituteId) })
                );
            useLearnerHomeDraft.getState().clear();
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        []
    );

    const refetchDraft = () =>
        queryClient.invalidateQueries({ queryKey: draftQueryKey(instituteId) });

    const clientIssues = useMemo<CheckIssue[]>(
        () =>
            runPublishChecks(store.blocks, {
                settings: store.settings,
                // Only once the lists are known; an unloaded list would flag every id.
                courseIds: courses.length ? new Set(courses.map((c) => c.value)) : undefined,
                batchIds: batches.length ? new Set(batches.map((b) => b.id)) : undefined,
                tagIds: learnerTags.data
                    ? new Set(learnerTags.data.map((x) => x.value))
                    : undefined,
            }),
        [store.blocks, store.settings, courses, batches, learnerTags.data]
    );
    const issues = useMemo(
        () => mergeIssues(clientIssues, store.serverIssues),
        [clientIssues, store.serverIssues]
    );
    const errorCount = errorsOf(issues).length;
    const selected = store.blocks.find((b) => b.block_key === store.selectedKey) ?? null;

    const handleApiError = (error: unknown, fallback: string) => {
        const err = toLearnerHomeError(error);
        if (err.code === 'HOLISTIC_LAYOUT') setHolistic(true);
        else toast.error(err.message || fallback);
        return err;
    };

    const start = async (choice: StartChoice): Promise<StartFailure | null> => {
        try {
            const layout = await learnerHomeApi.createDraft(
                instituteId,
                buildCreatePayload(
                    choice.templateKey,
                    store.settings ?? DEFAULT_SETTINGS,
                    choice.blocks
                )
            );
            store.load(layout);
            setPane('list');
            await refetchDraft();
            return null;
        } catch (error) {
            const err = toLearnerHomeError(error);
            if (err.code === 'HOLISTIC_LAYOUT') {
                setHolistic(true);
                return null;
            }
            if (err.code === 'DRAFT_EXISTS') {
                await refetchDraft();
                return null;
            }
            // Shown on the start screen, one line per issue (not only a toast).
            return { message: err.message || t('start.createFailed'), issues: err.issues };
        }
    };

    const editLive = async () => {
        try {
            store.load(await learnerHomeApi.createDraftFromPublished(instituteId));
            await refetchDraft();
        } catch (error) {
            const err = handleApiError(error, t('start.createFailed'));
            if (err.code === 'DRAFT_EXISTS') await refetchDraft();
        }
    };

    const discard = async () => {
        try {
            await learnerHomeApi.deleteDraft(instituteId);
            store.clear();
            await refetchDraft();
        } catch (error) {
            handleApiError(error, t('page.loadError'));
        }
    };

    const unpublish = async () => {
        try {
            await learnerHomeApi.unpublish(instituteId);
            toast.success(t('unpublish.done'));
            await refetchDraft();
        } catch (error) {
            handleApiError(error, t('page.loadError'));
        }
    };

    /** Saves pending edits, then asks the server's dry run (GET /publish-checks). */
    const loadServerChecks = async (): Promise<CheckIssue[] | null> => {
        if (!(await saveNow())) return null;
        try {
            const res = await learnerHomeApi.getPublishChecks(instituteId);
            return [...res.errors, ...res.warnings];
        } catch {
            // The dialog still shows the editor's own checks; publish re-checks anyway.
            return null;
        }
    };

    const publish = async (): Promise<PublishOutcome> => {
        const saved = await saveNow();
        const state = useLearnerHomeDraft.getState();
        if (!saved) {
            return {
                ok: false,
                issues: state.serverIssues,
                message: state.lastError ?? t('publish.failed'),
            };
        }
        try {
            const res = await learnerHomeApi.publish(instituteId, state.revision);
            toast.success(t('publish.success', { version: res.version }));
            state.clear();
            await refetchDraft();
            await queryClient.invalidateQueries({
                queryKey: ['learner-home', 'versions', instituteId],
            });
            return { ok: true, version: res.version, warnings: res.warnings };
        } catch (error) {
            const err = toLearnerHomeError(error);
            if (err.code === 'HOLISTIC_LAYOUT') setHolistic(true);
            if (err.code === 'STALE_DRAFT') {
                state.markConflict({ updatedBy: err.updatedBy, updatedAt: err.updatedAt });
            }
            if (err.issues.length) state.setServerIssues(err.issues);
            return { ok: false, issues: err.issues, message: err.message || t('publish.failed') };
        }
    };

    const insertAt = () => {
        const i = store.blocks.findIndex((b) => b.block_key === store.selectedKey);
        return i >= 0 ? i + 1 : store.blocks.length;
    };
    const addContent = (type: ContentBlockType) => {
        store.addBlock(
            createContentBlock(type, undefined, undefined, store.settings) as HomeBlock,
            insertAt()
        );
        openEditor();
    };
    const addBuiltin = (widget: BuiltinWidget) => {
        store.addBlock(createBuiltinBlock(widget), insertAt());
        openEditor();
    };
    const updateBlock = (key: string, patch: Partial<HomeBlock>) =>
        store.updateBlock(key, (b) => ({ ...b, ...patch }) as HomeBlock);

    if (draftQuery.isLoading) {
        return (
            <div className="space-y-4 p-4" aria-busy="true">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-96 w-full" />
            </div>
        );
    }
    if (draftQuery.isError || !data) {
        return (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
                <p className="text-body text-danger-600">{t('page.loadError')}</p>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    onClick={() => void draftQuery.refetch()}
                >
                    {t('page.retry')}
                </MyButton>
            </div>
        );
    }
    if (!data.module_enabled) {
        return (
            <StateCard
                icon={PuzzlePiece}
                title={t('page.notEnabledTitle')}
                body={t('page.notEnabledBody')}
            />
        );
    }
    if (holistic || data.holistic) {
        return (
            <StateCard
                icon={HouseLine}
                title={t('page.holisticTitle')}
                body={t('page.holisticBody')}
            />
        );
    }

    const hasDraft = !!store.layoutId;
    const editor = !hasDraft ? (
        <StartScreen
            published={data.published}
            hasStoreSite={hasStoreSite}
            onStart={start}
            onEditLive={editLive}
            onUnpublish={() => setConfirmUnpublish(true)}
        />
    ) : (
        <div className="space-y-3">
            {store.status === 'conflict' && store.conflict && (
                <ConflictBanner
                    conflict={store.conflict}
                    onReload={reloadFromServer}
                    onOverwrite={overwrite}
                />
            )}
            <EditorTopBar
                status={store.status}
                lastError={store.lastError}
                published={data.published}
                baseVersion={store.baseVersion}
                settings={store.settings}
                errorCount={errorCount}
                onSettings={store.setSettings}
                onVersions={() => setVersionsOpen(true)}
                onDiscard={discard}
                onPublish={() => setPublishOpen(true)}
                onRetrySave={() => void saveNow()}
                onUnpublish={() => setConfirmUnpublish(true)}
            />
            <div
                className="flex rounded-md border border-neutral-200 p-0.5 xl:hidden"
                role="tablist"
                aria-label={t('page.title')}
                onKeyDown={(e) => {
                    const next = paneForKey(pane, e.key);
                    if (!next) return;
                    e.preventDefault();
                    setPane(next);
                    tabRefs.current[next]?.focus();
                }}
            >
                {PANES.map((p) => (
                    <button
                        key={p}
                        ref={(el) => {
                            tabRefs.current[p] = el;
                        }}
                        id={`lh-tab-${p}`}
                        type="button"
                        role="tab"
                        aria-selected={pane === p}
                        aria-controls={`lh-panel-${p}`}
                        tabIndex={pane === p ? 0 : -1}
                        onClick={() => setPane(p)}
                        className={cn(
                            'flex-1 rounded-sm px-3 py-1.5 text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            pane === p
                                ? 'bg-primary-50 font-semibold text-primary-500'
                                : 'text-neutral-600'
                        )}
                    >
                        {t(`tabs.${p}`)}
                    </button>
                ))}
            </div>
            <div className="grid gap-4 xl:grid-cols-12">
                <section
                    {...paneProps('list', t('list.title'))}
                    className={cn(
                        'space-y-3 xl:col-span-3 xl:block',
                        pane === 'list' ? 'block' : 'hidden'
                    )}
                >
                    <div>
                        <h2 className="text-subtitle font-semibold text-neutral-800">
                            {t('list.title')}
                        </h2>
                        <p className="text-caption text-neutral-500">{t('list.subtitle')}</p>
                    </div>
                    <AddBlockMenu
                        blocks={store.blocks}
                        onAddContent={addContent}
                        onAddBuiltin={addBuiltin}
                    />
                    <BlockList
                        blocks={store.blocks}
                        selectedKey={store.selectedKey}
                        issues={issues}
                        onSelect={(key) => {
                            store.select(key);
                            openEditor();
                        }}
                        onMove={store.moveBlock}
                        onToggle={(key, enabled) => updateBlock(key, { enabled })}
                        onPlacement={(key, desktop_placement) =>
                            updateBlock(key, { desktop_placement })
                        }
                        onDuplicate={(key) => {
                            const i = store.blocks.findIndex((b) => b.block_key === key);
                            const b = store.blocks[i];
                            if (b) store.addBlock(duplicateBlock(b), i + 1);
                        }}
                        onDelete={store.removeBlock}
                    />
                </section>
                <section
                    {...paneProps('edit', t('tabs.edit'))}
                    className={cn(
                        'rounded-md border border-neutral-200 bg-card p-4 xl:col-span-5 xl:block',
                        pane === 'edit' ? 'block' : 'hidden'
                    )}
                >
                    <BlockEditorPanel
                        key={selected?.block_key ?? 'none'}
                        block={selected}
                        issues={
                            selected ? issues.filter((i) => i.block_key === selected.block_key) : []
                        }
                        onChange={(update) =>
                            selected && store.updateBlock(selected.block_key, update)
                        }
                        focusHeadingToken={isXl ? 0 : focusEditorToken}
                    />
                </section>
                <section
                    {...paneProps('preview', t('preview.title'))}
                    className={cn(
                        'xl:col-span-4 xl:block',
                        pane === 'preview' ? 'block' : 'hidden'
                    )}
                >
                    <div className="xl:sticky xl:top-4">
                        <HomePreviewFrame
                            instituteId={instituteId}
                            blocks={store.blocks}
                            settings={store.settings}
                            // No preview requests while the pane is hidden behind a tab.
                            active={isXl || pane === 'preview'}
                        />
                    </div>
                </section>
            </div>
            <PublishDialog
                open={publishOpen}
                onOpenChange={setPublishOpen}
                blocks={store.blocks}
                clientIssues={clientIssues}
                publishedBlocks={data.published?.blocks ?? null}
                onPublish={publish}
                loadServerChecks={loadServerChecks}
                onGoTo={(key) => {
                    store.select(key);
                    openEditor();
                }}
            />
        </div>
    );

    return (
        <div className="space-y-4 p-4 sm:p-6">
            <p className="text-body text-neutral-600">{t('page.description')}</p>
            <Tabs value={tab} onValueChange={(v) => setTab(v as 'editor' | 'results')}>
                <TabsList>
                    <TabsTrigger value="editor">{t('tabs.editor')}</TabsTrigger>
                    <TabsTrigger value="results" disabled={!data.published}>
                        {t('tabs.results')}
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="editor" className="mt-4">
                    {editor}
                </TabsContent>
                <TabsContent value="results" className="mt-4">
                    {data.published ? (
                        <ResultsTab
                            instituteId={instituteId}
                            blocks={data.published.blocks ?? store.blocks}
                        />
                    ) : (
                        <p className="text-body text-neutral-500">{t('results.noPublished')}</p>
                    )}
                </TabsContent>
            </Tabs>
            <VersionsDrawer
                open={versionsOpen}
                onOpenChange={setVersionsOpen}
                instituteId={instituteId}
                hasDraft={hasDraft}
                onRestored={(layout) => {
                    store.load(layout);
                    void refetchDraft();
                }}
            />
            <AlertDialog open={confirmUnpublish} onOpenChange={setConfirmUnpublish}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('unpublish.title')}</AlertDialogTitle>
                        <AlertDialogDescription>{t('unpublish.body')}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('topbar.cancel')}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void unpublish()}>
                            {t('unpublish.confirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
