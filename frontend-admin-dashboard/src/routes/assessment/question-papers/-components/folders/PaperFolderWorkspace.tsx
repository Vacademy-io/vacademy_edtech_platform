import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
    DndContext,
    DragEndEvent,
    DragOverlay,
    DragStartEvent,
    KeyboardSensor,
    PointerSensor,
    TouchSensor,
    pointerWithin,
    rectIntersection,
    useSensor,
    useSensors,
    type CollisionDetection,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { FileText } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { getInstituteId } from '@/constants/helper';
import { reportApiError } from '@/lib/report-api-error';
import {
    PAPER_FOLDERS_QUERY_KEY,
    PaperFolderFilter,
    QuestionPaperFolder,
    UNFILED_PAPER_FOLDER_ID,
    deletePaperFolder,
    paperFolderRoute,
    reorderPaperFolders,
    useInvalidatePaperFolders,
    useMovePapersMutation,
    usePaperFolders,
} from '@/services/question-paper-folders';
import { getQuestionPaperDataWithFilters } from '../../-utils/question-paper-services';
import { statusesForTab } from '../../-utils/question-paper-list';
import { useRefetchStore } from '../../-global-states/refetch-store';
import { usePendingPaperFolderPrompt } from '../../-global-states/pending-paper-folder-prompt';
import {
    PaperFolderBreadcrumb,
    PaperFolderGrid,
    PaperFolderListHeader,
    type PaperFolderViewMode,
} from './PaperFolderBrowser';
import { MovePaperToFolderDialog, PaperFolderFormDialog } from './PaperFolderDialogs';
import {
    DRAG_TYPE_PAPER,
    DRAG_TYPE_PAPER_FOLDER,
    PaperFolderUi,
    PaperFolderUiContext,
    PaperMoveTarget,
} from './paper-folder-context';

const FEATURE = 'question-paper-folders';
const VIEW_STORAGE_KEY = 'questionPaperFolderView';

const readView = (): PaperFolderViewMode => {
    try {
        return localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'folders';
    } catch {
        return 'folders';
    }
};

/** Pointer-first so a card dropped on a folder tile lands where the cursor is. */
const collision: CollisionDetection = (args) => {
    const hits = pointerWithin(args);
    return hits.length > 0 ? hits : rectIntersection(args);
};

/** The list's own refetch (current tab, filters and page). A no-op before the list mounts. */
const refetchPaperList = () => {
    try {
        useRefetchStore.getState().handleRefetchData();
    } catch {
        // No list mounted yet: it fetches fresh when it mounts.
    }
};

/**
 * The Question Papers page in folder structure. `folderKey` comes from `?folderId=`:
 * 'all', 'unfiled' or a folder id, so every folder has its own link.
 *
 * - Top level, Folders view (default): folder cards, then the papers in no folder.
 *   Drag a paper onto a folder (or use ⋯ → Move to folder) to file it.
 * - Top level, All papers view: every paper in one list, each card naming its folder.
 * - Inside a folder: a breadcrumb back to all folders, then that folder's papers.
 *
 * The list remounts per scope so its tabs, counts and pages reload. If the folders fail
 * to load, the top level lists every paper, so an error never hides a paper.
 */
export const PaperFolderWorkspace = ({
    folderKey,
    renderList,
}: {
    folderKey: string;
    renderList: (props: { key: string; folderFilter: PaperFolderFilter }) => React.ReactNode;
}) => {
    const { t } = useTranslation('questionPaperFolders');
    const navigate = useNavigate();
    const { data: folders = [], isLoading, isError, refetch } = usePaperFolders();
    const invalidate = useInvalidatePaperFolders();
    const moveMutation = useMovePapersMutation();
    const [orderOverride, setOrderOverride] = useState<string[] | null>(null);
    const [listVersion, setListVersion] = useState(0);
    const [moveTarget, setMoveTarget] = useState<PaperMoveTarget | null>(null);
    const [formFolder, setFormFolder] = useState<QuestionPaperFolder | null | undefined>(undefined);
    const [deleteFolder, setDeleteFolder] = useState<QuestionPaperFolder | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [dragLabel, setDragLabel] = useState<string | null>(null);
    const [view, setViewState] = useState<PaperFolderViewMode>(readView);
    const setView = (mode: PaperFolderViewMode) => {
        setViewState(mode);
        try {
            localStorage.setItem(VIEW_STORAGE_KEY, mode);
        } catch {
            // Private mode: the choice just isn't remembered.
        }
    };
    const suppressClickUntil = useRef(0);
    const pendingPrompt = usePendingPaperFolderPrompt((st) => st.pending);
    const clearPendingPrompt = () => usePendingPaperFolderPrompt.getState().setPending(null);

    const orderedFolders = useMemo(() => {
        if (!orderOverride) return folders;
        const byId = new Map(folders.map((f) => [f.id, f]));
        const ordered = orderOverride
            .map((id) => byId.get(id))
            .filter(Boolean) as QuestionPaperFolder[];
        const rest = folders.filter((f) => !orderOverride.includes(f.id));
        return [...ordered, ...rest];
    }, [folders, orderOverride]);

    const foldersById = useMemo(
        () =>
            Object.fromEntries(folders.map((f) => [f.id, f])) as Record<
                string,
                QuestionPaperFolder
            >,
        [folders]
    );

    // A deleted or foreign folder id in the link falls back to the top level.
    const selectedFolder = foldersById[folderKey];
    const effectiveKey =
        folderKey === UNFILED_PAPER_FOLDER_ID || selectedFolder || isLoading ? folderKey : 'all';

    const selectFolder = useCallback(
        (key: string) => {
            navigate({
                to: '/assessment/question-papers',
                search: (prev: Record<string, unknown>) => ({
                    ...prev,
                    folderId: key === 'all' ? undefined : key,
                }),
            });
        },
        [navigate]
    );

    const atTop = effectiveKey === 'all';
    const foldersView = atTop && view === 'folders';
    const folderFilter: PaperFolderFilter =
        effectiveKey === UNFILED_PAPER_FOLDER_ID || (foldersView && !isError)
            ? { unfiled_only: true }
            : !atTop
              ? { folder_id: effectiveKey }
              : {};
    const scopeFolderId: string | null | undefined = folderFilter.folder_id
        ? folderFilter.folder_id
        : folderFilter.unfiled_only
          ? null
          : undefined;

    // How many papers (All tab) are in no folder. Keyed under the folder queries so every
    // move / create / delete / new paper refreshes it.
    const instituteId = getInstituteId();
    const { data: unfiledCount, isError: unfiledCountFailed } = useQuery({
        queryKey: [...PAPER_FOLDERS_QUERY_KEY, 'unfiled-count', instituteId],
        queryFn: async () => {
            const page = await getQuestionPaperDataWithFilters(
                0,
                1,
                instituteId ?? undefined,
                { statuses: statusesForTab('ACTIVE') },
                undefined,
                { unfiled_only: true }
            );
            return (page?.total_elements as number | undefined) ?? 0;
        },
        enabled: foldersView && !isError,
        staleTime: 0,
    });
    // Folders view with every paper in a folder: show the folders only, no empty
    // "Not in a folder" list. Without folders the list stays (it holds the empty state
    // with the ways to add a paper). Still loading counts as none, so the list never
    // flashes; a failed count shows it (fail open).
    const hideUnfiled =
        foldersView &&
        !isError &&
        folders.length > 0 &&
        !unfiledCountFailed &&
        !(unfiledCount && unfiledCount > 0);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const handleDragStart = (event: DragStartEvent) => {
        const data = event.active.data.current;
        setDragLabel(data?.type === DRAG_TYPE_PAPER ? (data.title as string) : null);
    };

    const handleDragEnd = async (event: DragEndEvent) => {
        setDragLabel(null);
        suppressClickUntil.current = Date.now() + 300;
        const { active, over } = event;
        const data = active.data.current;
        if (!over || !data) return;

        if (data.type === DRAG_TYPE_PAPER_FOLDER) {
            if (active.id === over.id) return;
            const ids = orderedFolders.map((f) => f.id);
            const from = ids.indexOf(String(active.id));
            const to = ids.indexOf(String(over.id));
            if (from < 0 || to < 0) return;
            const next = arrayMove(ids, from, to);
            setOrderOverride(next);
            try {
                await reorderPaperFolders(next);
                await invalidate();
            } catch (error) {
                setOrderOverride(null);
                reportApiError(error, { feature: FEATURE, fallbackMessage: t('toast.error') });
            }
            return;
        }

        if (data.type === DRAG_TYPE_PAPER) {
            const target = foldersById[String(over.id)];
            if (!target) return;
            try {
                await moveMutation.mutateAsync({
                    folderId: target.id,
                    questionPaperIds: [data.questionPaperId as string],
                });
                toast.success(t('toast.moved', { name: target.name }));
                refetchPaperList();
            } catch (error) {
                reportApiError(error, { feature: FEATURE, fallbackMessage: t('toast.error') });
            }
        }
    };

    const copyLink = async (folder: QuestionPaperFolder) => {
        const link = `${window.location.origin}${paperFolderRoute(folder.id)}`;
        try {
            await navigator.clipboard.writeText(link);
            toast.success(t('toast.linkCopied'), { description: link });
        } catch {
            toast.info(link);
        }
    };

    const confirmDelete = async () => {
        if (!deleteFolder) return;
        setDeleting(true);
        try {
            await deletePaperFolder(deleteFolder.id);
            await invalidate();
            toast.success(t('toast.deleted'));
            if (folderKey === deleteFolder.id) selectFolder('all');
            else refetchPaperList();
            setDeleteFolder(null);
        } catch (error) {
            reportApiError(error, { feature: FEATURE, fallbackMessage: t('toast.error') });
        } finally {
            setDeleting(false);
        }
    };

    const ui: PaperFolderUi = useMemo(
        () => ({
            enabled: true,
            // Cards are dragged onto folder tiles, which only the top-level Folders view shows.
            dragEnabled: foldersView && !isError,
            // In the flat list, name each card's folder; elsewhere the scope already says it.
            showFolderChip: atTop && !foldersView,
            scopeFolderId,
            foldersById,
            openMove: setMoveTarget,
            isClickSuppressed: () => Date.now() < suppressClickUntil.current,
        }),
        [foldersView, isError, atTop, scopeFolderId, foldersById]
    );

    const folderActions = {
        onEdit: (folder: QuestionPaperFolder) => setFormFolder(folder),
        onDelete: setDeleteFolder,
        onCopyLink: copyLink,
    };
    const toolbar = !atTop ? (
        <PaperFolderBreadcrumb
            folder={selectedFolder}
            unfiled={effectiveKey === UNFILED_PAPER_FOLDER_ID}
            onBack={() => selectFolder('all')}
            {...folderActions}
        />
    ) : view === 'folders' ? (
        <PaperFolderGrid
            folders={orderedFolders}
            loading={isLoading}
            failed={isError}
            onRetry={() => refetch()}
            showUnfiledHeading={!hideUnfiled && !isError && folders.length > 0}
            view={view}
            onViewChange={setView}
            onOpen={selectFolder}
            onCreate={() => setFormFolder(null)}
            {...folderActions}
        />
    ) : (
        <PaperFolderListHeader view={view} onViewChange={setView} />
    );

    return (
        <PaperFolderUiContext.Provider value={ui}>
            <DndContext
                sensors={sensors}
                collisionDetection={collision}
                onDragStart={handleDragStart}
                onDragCancel={() => setDragLabel(null)}
                onDragEnd={handleDragEnd}
            >
                <div className="flex flex-col gap-4">
                    {toolbar}
                    {hideUnfiled
                        ? null
                        : renderList({
                              key: `${effectiveKey}:${view}:${listVersion}`,
                              folderFilter,
                          })}
                </div>
                <DragOverlay dropAnimation={null}>
                    {dragLabel ? (
                        <div className="flex max-w-xs items-center gap-2 rounded-lg border border-primary-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800 shadow-lg">
                            <FileText size={16} className="shrink-0 text-primary-500" />
                            <span className="truncate">{dragLabel}</span>
                        </div>
                    ) : null}
                </DragOverlay>
            </DndContext>

            <MovePaperToFolderDialog
                open={!!moveTarget}
                onOpenChange={(open) => !open && setMoveTarget(null)}
                questionPaperIds={moveTarget ? [moveTarget.questionPaperId] : []}
                paperTitle={moveTarget?.title}
                currentFolderId={moveTarget?.folderId}
                onDone={() => {
                    // A scoped list (a folder or "not in a folder") loses or gains the paper.
                    if (scopeFolderId !== undefined) refetchPaperList();
                }}
            />
            {/* Step after a paper is added on this page (set by the save hook). */}
            <MovePaperToFolderDialog
                open={!!pendingPrompt}
                onOpenChange={(open) => !open && clearPendingPrompt()}
                questionPaperIds={pendingPrompt ? [pendingPrompt.questionPaperId] : []}
                paperTitle={pendingPrompt?.title || undefined}
                currentFolderId={null}
                preselectedFolderId={selectedFolder?.id ?? null}
                variant="afterAdd"
                onDone={(folderId) => {
                    clearPendingPrompt();
                    if (folderId) {
                        // Open the folder it went into; reload if that folder is already open.
                        if (folderId === effectiveKey) setListVersion((v) => v + 1);
                        else selectFolder(folderId);
                    } else if (!atTop) {
                        // Skipped inside a folder: the new paper is in no folder, shown at the top.
                        selectFolder('all');
                    }
                }}
            />
            <PaperFolderFormDialog
                open={formFolder !== undefined}
                onOpenChange={(open) => !open && setFormFolder(undefined)}
                folder={formFolder ?? null}
                onSaved={(saved) => {
                    if (formFolder === null) selectFolder(saved.id);
                }}
            />
            <MyDialog
                open={!!deleteFolder}
                onOpenChange={(open) => !open && setDeleteFolder(null)}
                heading={t('delete.title')}
                dialogWidth="max-w-md"
                footer={
                    <div className="flex w-full justify-end gap-2">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => setDeleteFolder(null)}
                        >
                            {t('form.cancel')}
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            className="bg-danger-600 hover:bg-danger-500"
                            disable={deleting}
                            onClick={confirmDelete}
                        >
                            {deleting ? t('form.saving') : t('delete.confirm')}
                        </MyButton>
                    </div>
                }
            >
                <p className="text-sm text-neutral-600">
                    {t('delete.body', {
                        name: deleteFolder?.name ?? '',
                        count: deleteFolder ? foldersById[deleteFolder.id]?.paper_count ?? 0 : 0,
                    })}
                </p>
            </MyDialog>
        </PaperFolderUiContext.Provider>
    );
};
