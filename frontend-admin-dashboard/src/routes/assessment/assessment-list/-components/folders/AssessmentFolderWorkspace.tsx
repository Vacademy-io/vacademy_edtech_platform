import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import {
    DndContext,
    DragEndEvent,
    DragOverlay,
    DragStartEvent,
    PointerSensor,
    TouchSensor,
    KeyboardSensor,
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
import { reportApiError } from '@/lib/report-api-error';
import { AssessmentFolderFormDialog } from '@/components/common/assessment-folders/AssessmentFolderFormDialog';
import { MoveToFolderDialog } from '@/components/common/assessment-folders/MoveToFolderDialog';
import { usePendingFolderPrompt } from '@/components/common/assessment-folders/pending-folder-prompt';
import {
    AssessmentFolder,
    UNFILED_FOLDER_ID,
    assessmentFolderRoute,
    deleteAssessmentFolder,
    reorderAssessmentFolders,
    useAssessmentFolders,
    useInvalidateAssessmentFolders,
    useMoveAssessmentsMutation,
} from '@/services/assessment-folders';
import {
    FolderBreadcrumb,
    FolderGrid,
    FolderListHeader,
    type FolderViewMode,
} from './AssessmentFolderBrowser';
import { useAssessmentActionVisibility } from '@/lib/display-settings/assessment-actions';
import { useQuery } from '@tanstack/react-query';
import { getInstituteId } from '@/constants/helper';
import { ASSESSMENT_FOLDERS_QUERY_KEY } from '@/services/assessment-folders';
import { getAssessmentListWithFilters } from '../../-services/assessment-services';
import {
    AssessmentFolderUi,
    AssessmentFolderUiContext,
    DRAG_TYPE_ASSESSMENT,
    DRAG_TYPE_FOLDER,
    MoveTarget,
} from './assessment-folder-context';

export interface FolderListFilter {
    folder_id?: string;
    unfiled_only?: boolean;
}

const VIEW_STORAGE_KEY = 'assessmentFolderView';

const readView = (): FolderViewMode => {
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

/**
 * The assessment list in folder structure. `folderKey` comes from the route
 * (`?folderId=`): 'all', 'unfiled' or a folder id, so every folder has its own URL
 * that a sidebar sub-tab can point at.
 *
 * - Top level, "Folders" view (default): folder cards, then the tests that are in
 *   no folder in the usual tabs and cards. Drag a card onto a folder to move it.
 * - Top level, "All tests" view: every assessment in one list, folder named on each card.
 * - Inside a folder: a breadcrumb back to all folders, then that folder's tests.
 *
 * The list remounts per scope (and after a move that changes the open scope) so its
 * tabs, counts and pages all reload.
 */
export const AssessmentFolderWorkspace = ({
    folderKey,
    renderList,
}: {
    folderKey: string;
    /** `toolbar` (folder cards / breadcrumb) goes between the list's page header and its tabs. */
    renderList: (props: {
        key: string;
        folderFilter: FolderListFilter;
        toolbar: React.ReactNode;
        /** No tabs / filters / list: the Folders view when every test is in a folder. */
        hideList: boolean;
    }) => React.ReactNode;
}) => {
    const { t } = useTranslation('assessmentFolders');
    const navigate = useNavigate();
    const { data: folders = [], isLoading } = useAssessmentFolders();
    const invalidate = useInvalidateAssessmentFolders();
    const moveMutation = useMoveAssessmentsMutation();
    const [orderOverride, setOrderOverride] = useState<string[] | null>(null);
    const [listVersion, setListVersion] = useState(0);
    const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
    const [formFolder, setFormFolder] = useState<AssessmentFolder | null | undefined>(undefined);
    const [deleteFolder, setDeleteFolder] = useState<AssessmentFolder | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [dragLabel, setDragLabel] = useState<string | null>(null);
    const [view, setViewState] = useState<FolderViewMode>(readView);
    const setView = (mode: FolderViewMode) => {
        setViewState(mode);
        try {
            localStorage.setItem(VIEW_STORAGE_KEY, mode);
        } catch {
            // Private mode: the choice just isn't remembered.
        }
    };
    const suppressClickUntil = useRef(0);
    // Display Settings → Assessment Actions → Manage assessment folders (per role).
    const { canManageFolders } = useAssessmentActionVisibility();
    const pendingPrompt = usePendingFolderPrompt((st) => st.pending);
    const clearPendingPrompt = () => usePendingFolderPrompt.getState().setPending(null);

    // A role without folder access gets no "Add to a folder" step; drop the request.
    useEffect(() => {
        if (pendingPrompt && !canManageFolders) clearPendingPrompt();
    }, [pendingPrompt, canManageFolders]);

    const orderedFolders = useMemo(() => {
        if (!orderOverride) return folders;
        const byId = new Map(folders.map((f) => [f.id, f]));
        const ordered = orderOverride
            .map((id) => byId.get(id))
            .filter(Boolean) as AssessmentFolder[];
        const rest = folders.filter((f) => !orderOverride.includes(f.id));
        return [...ordered, ...rest];
    }, [folders, orderOverride]);

    const foldersById = useMemo(
        () => Object.fromEntries(folders.map((f) => [f.id, f])) as Record<string, AssessmentFolder>,
        [folders]
    );

    // A deleted or foreign folder id in the URL falls back to "All".
    const selectedFolder = foldersById[folderKey];
    const effectiveKey =
        folderKey === UNFILED_FOLDER_ID || selectedFolder || isLoading ? folderKey : 'all';

    const selectFolder = useCallback(
        (key: string) => {
            navigate({
                to: '/assessment/assessment-list',
                search: (prev: Record<string, unknown>) => ({
                    ...prev,
                    folderId: key === 'all' ? undefined : key,
                }),
            });
        },
        [navigate]
    );

    const atTop = effectiveKey === 'all';
    const folderFilter: FolderListFilter =
        effectiveKey === UNFILED_FOLDER_ID || (atTop && view === 'folders')
            ? { unfiled_only: true }
            : !atTop
              ? { folder_id: effectiveKey }
              : {};
    const scoped = Boolean(folderFilter.folder_id || folderFilter.unfiled_only);

    // How many tests (published or draft) are in no folder. Keyed under the folder
    // queries so every move / create / delete refreshes it.
    const instituteId = getInstituteId();
    const { data: unfiledCount, isError: unfiledCountFailed } = useQuery({
        queryKey: [...ASSESSMENT_FOLDERS_QUERY_KEY, 'unfiled-count', instituteId],
        queryFn: async () => {
            const page = await getAssessmentListWithFilters(0, 1, instituteId, {
                name: '',
                batch_ids: [],
                subjects_ids: [],
                tag_ids: [],
                get_live_assessments: false,
                get_passed_assessments: false,
                get_upcoming_assessments: false,
                institute_ids: instituteId ? [instituteId] : [],
                assessment_statuses: [
                    { id: '0', name: 'PUBLISHED' },
                    { id: '1', name: 'DRAFT' },
                ],
                assessment_modes: [],
                access_statuses: [],
                evaluation_types: [],
                unfiled_only: true,
            });
            return (page?.total_elements as number | undefined) ?? 0;
        },
        enabled: atTop && view === 'folders',
        staleTime: 0,
    });
    // Folders view with every test in a folder: show the folders only — no empty
    // "Not in a folder" tabs. Still loading counts as none, so the tabs never flash;
    // a failed count shows them (fail open), so no test can be hidden by an error.
    const hideUnfiled =
        atTop && view === 'folders' && !unfiledCountFailed && !(unfiledCount && unfiledCount > 0);

    // A move only changes the open list when the list is scoped (to a folder or to
    // "not in a folder"); the flat list just updates the card's folder name.
    const afterMove = useCallback(() => {
        if (scoped) setListVersion((v) => v + 1);
    }, [scoped]);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const handleDragStart = (event: DragStartEvent) => {
        const data = event.active.data.current;
        setDragLabel(data?.type === DRAG_TYPE_ASSESSMENT ? (data.name as string) : null);
    };

    const handleDragEnd = async (event: DragEndEvent) => {
        setDragLabel(null);
        suppressClickUntil.current = Date.now() + 300;
        const { active, over } = event;
        const data = active.data.current;
        if (!over || !data || !canManageFolders) return;

        if (data.type === DRAG_TYPE_FOLDER) {
            if (active.id === over.id) return;
            const ids = orderedFolders.map((f) => f.id);
            const from = ids.indexOf(String(active.id));
            const to = ids.indexOf(String(over.id));
            if (from < 0 || to < 0) return;
            const next = arrayMove(ids, from, to);
            setOrderOverride(next);
            try {
                await reorderAssessmentFolders(next);
                await invalidate();
            } catch (error) {
                setOrderOverride(null);
                reportApiError(error, {
                    feature: 'assessment-folders',
                    fallbackMessage: t('toast.error'),
                });
            }
            return;
        }

        if (data.type === DRAG_TYPE_ASSESSMENT) {
            const assessmentId = data.assessmentId as string;
            const targetId = foldersById[String(over.id)] ? String(over.id) : undefined;
            if (targetId === undefined) return;
            try {
                await moveMutation.mutateAsync({
                    folderId: targetId,
                    assessmentIds: [assessmentId],
                });
                toast.success(
                    targetId
                        ? t('toast.moved', { name: foldersById[targetId]?.name ?? '' })
                        : t('toast.removed')
                );
                afterMove();
            } catch (error) {
                reportApiError(error, {
                    feature: 'assessment-folders',
                    fallbackMessage: t('toast.error'),
                });
            }
        }
    };

    const copyLink = async (folder: AssessmentFolder) => {
        const route = assessmentFolderRoute(folder.id);
        try {
            await navigator.clipboard.writeText(route);
            toast.success(t('toast.linkCopied'), { description: route });
        } catch {
            toast.info(route);
        }
    };

    const confirmDelete = async () => {
        if (!deleteFolder) return;
        setDeleting(true);
        try {
            await deleteAssessmentFolder(deleteFolder.id);
            await invalidate();
            toast.success(t('toast.deleted'));
            if (folderKey === deleteFolder.id) selectFolder('all');
            setDeleteFolder(null);
        } catch (error) {
            reportApiError(error, {
                feature: 'assessment-folders',
                fallbackMessage: t('toast.error'),
            });
        } finally {
            setDeleting(false);
        }
    };

    const ui: AssessmentFolderUi = useMemo(
        () => ({
            enabled: true,
            canManage: canManageFolders,
            // Cards are dragged onto folder tiles, which only the top-level Folders view shows.
            dragEnabled: canManageFolders && atTop && view === 'folders',
            // In the flat list, name each card's folder; elsewhere the scope already says it.
            showFolderChip: atTop && view === 'list',
            selectedKey: effectiveKey,
            folders,
            foldersById,
            openMove: setMoveTarget,
            isClickSuppressed: () => Date.now() < suppressClickUntil.current,
        }),
        [folders, foldersById, effectiveKey, canManageFolders, atTop, view]
    );

    const folderActions = {
        onEdit: (folder: AssessmentFolder) => setFormFolder(folder),
        onDelete: setDeleteFolder,
        onCopyLink: copyLink,
        canManage: canManageFolders,
    };
    const toolbar = !atTop ? (
        <FolderBreadcrumb
            folder={selectedFolder}
            unfiled={effectiveKey === UNFILED_FOLDER_ID}
            onBack={() => selectFolder('all')}
            {...folderActions}
        />
    ) : view === 'folders' ? (
        <FolderGrid
            folders={orderedFolders}
            loading={isLoading}
            showUnfiledHeading={!hideUnfiled}
            view={view}
            onViewChange={setView}
            onOpen={selectFolder}
            onCreate={() => setFormFolder(null)}
            {...folderActions}
        />
    ) : (
        <FolderListHeader view={view} onViewChange={setView} />
    );

    return (
        <AssessmentFolderUiContext.Provider value={ui}>
            <DndContext
                sensors={sensors}
                collisionDetection={collision}
                onDragStart={handleDragStart}
                onDragCancel={() => setDragLabel(null)}
                onDragEnd={handleDragEnd}
            >
                {renderList({
                    key: `${effectiveKey}:${view}:${listVersion}`,
                    folderFilter,
                    toolbar,
                    hideList: hideUnfiled,
                })}
                <DragOverlay dropAnimation={null}>
                    {dragLabel ? (
                        <div className="flex max-w-xs items-center gap-2 rounded-lg border border-primary-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800 shadow-lg">
                            <FileText size={16} className="shrink-0 text-primary-500" />
                            <span className="truncate">{dragLabel}</span>
                        </div>
                    ) : null}
                </DragOverlay>
            </DndContext>

            <MoveToFolderDialog
                open={!!moveTarget}
                onOpenChange={(open) => !open && setMoveTarget(null)}
                assessmentIds={moveTarget ? [moveTarget.assessmentId] : []}
                assessmentName={moveTarget?.name}
                currentFolderId={moveTarget?.folderId}
                onDone={afterMove}
            />
            {/* Step after publishing a new assessment (set by the create wizard). */}
            <MoveToFolderDialog
                open={!!pendingPrompt && canManageFolders}
                onOpenChange={(open) => !open && clearPendingPrompt()}
                assessmentIds={pendingPrompt ? [pendingPrompt.assessmentId] : []}
                assessmentName={pendingPrompt?.name || undefined}
                currentFolderId={null}
                variant="afterPublish"
                onDone={(folderId) => {
                    clearPendingPrompt();
                    if (folderId) selectFolder(folderId);
                }}
            />
            <AssessmentFolderFormDialog
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
                        count: deleteFolder?.assessment_count ?? 0,
                    })}
                </p>
            </MyDialog>
        </AssessmentFolderUiContext.Provider>
    );
};
