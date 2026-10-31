import { useTranslation } from 'react-i18next';
import { useDndContext } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    ArrowLeft,
    DotsSixVertical,
    DotsThreeVertical,
    EyeSlash,
    FolderMinus,
    HandGrabbing,
    Link as LinkIcon,
    ListBullets,
    PencilSimple,
    Plus,
    SquaresFour,
    Trash,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { FolderThumb } from '@/components/common/assessment-folders/FolderThumb';
import type { AssessmentFolder } from '@/services/assessment-folders';
import { DRAG_TYPE_ASSESSMENT, DRAG_TYPE_FOLDER } from './assessment-folder-context';

export type FolderViewMode = 'folders' | 'list';

export interface FolderActions {
    onOpen: (folderId: string) => void;
    onCreate: () => void;
    onEdit: (folder: AssessmentFolder) => void;
    onDelete: (folder: AssessmentFolder) => void;
    onCopyLink: (folder: AssessmentFolder) => void;
    /** Display Settings → Assessment Actions → Manage assessment folders, for the current role. */
    canManage: boolean;
}

const useIsDraggingAssessment = () => {
    const { active } = useDndContext();
    return active?.data.current?.type === DRAG_TYPE_ASSESSMENT;
};

/** "Folders | All tests" — folder structure, or every assessment in one list. */
export const FolderViewSwitch = ({
    value,
    onChange,
}: {
    value: FolderViewMode;
    onChange: (mode: FolderViewMode) => void;
}) => {
    const { t } = useTranslation('assessmentFolders');
    const options: { mode: FolderViewMode; label: string; icon: React.ReactNode }[] = [
        { mode: 'folders', label: t('view.folders'), icon: <SquaresFour size={14} /> },
        { mode: 'list', label: t('view.list'), icon: <ListBullets size={14} /> },
    ];
    return (
        <div
            role="radiogroup"
            aria-label={t('view.label')}
            className="inline-flex shrink-0 rounded-lg border border-neutral-200 bg-neutral-50 p-0.5"
        >
            {options.map((option) => (
                <button
                    key={option.mode}
                    type="button"
                    role="radio"
                    aria-checked={value === option.mode}
                    onClick={() => onChange(option.mode)}
                    className={cn(
                        'flex items-center gap-1.5 rounded-md px-3 py-1 text-sm transition-colors',
                        value === option.mode
                            ? 'bg-white font-medium text-primary-500 shadow-sm'
                            : 'text-neutral-600 hover:text-neutral-800'
                    )}
                >
                    {option.icon}
                    {option.label}
                </button>
            ))}
        </div>
    );
};

/**
 * Top level of the folder structure: one card per folder (open, drop a test on it,
 * reorder by its grip), then a heading for the tests that are in no folder — the
 * usual tabs and cards follow below it.
 */
export const FolderGrid = ({
    folders,
    loading,
    showUnfiledHeading,
    view,
    onViewChange,
    ...actions
}: FolderActions & {
    folders: AssessmentFolder[];
    loading: boolean;
    /** False when every test is in a folder (no "Not in a folder" section below). */
    showUnfiledHeading: boolean;
    view: FolderViewMode;
    onViewChange: (mode: FolderViewMode) => void;
}) => {
    const { t } = useTranslation('assessmentFolders');
    const draggingAssessment = useIsDraggingAssessment();
    return (
        <section aria-label={t('rail.title')} className="mb-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-neutral-800">{t('rail.title')}</h2>
                <FolderViewSwitch value={view} onChange={onViewChange} />
            </div>
            <div className="relative">
                {/* Floats over the grid's top edge: a row added here as a drag starts would
                    push every folder down, under the pointer. */}
                {draggingAssessment ? (
                    <p className="absolute -top-6 right-0 flex items-center gap-1 text-caption font-medium text-primary-500">
                        <HandGrabbing size={14} />
                        {t('rail.dropHint')}
                    </p>
                ) : null}
                <div
                    className={cn(
                        'grid grid-cols-1 gap-3 rounded-xl transition-colors sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4',
                        draggingAssessment &&
                            'bg-primary-50/60 outline outline-1 outline-primary-200'
                    )}
                >
                    <SortableContext
                        items={folders.map((f) => f.id)}
                        strategy={rectSortingStrategy}
                    >
                        {folders.map((folder) => (
                            <FolderTile key={folder.id} folder={folder} {...actions} />
                        ))}
                    </SortableContext>
                    {actions.canManage ? (
                        <button
                            type="button"
                            onClick={actions.onCreate}
                            className="flex min-h-16 items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-300 p-3 text-sm text-neutral-600 transition-colors hover:border-primary-400 hover:text-primary-500"
                        >
                            <Plus size={16} />
                            {t('rail.newFolder')}
                        </button>
                    ) : null}
                </div>
                {!loading && folders.length === 0 ? (
                    <p className="mt-2 text-caption text-neutral-500">
                        {actions.canManage ? t('rail.empty') : t('rail.emptyReadOnly')}
                    </p>
                ) : null}
            </div>
            {showUnfiledHeading ? (
                <div className="mt-6 flex flex-wrap items-baseline gap-x-2">
                    <h2 className="text-base font-semibold text-neutral-800">
                        {t('grid.unfiledTitle')}
                    </h2>
                    <p className="text-caption text-neutral-500">
                        {actions.canManage ? t('grid.unfiledHint') : t('grid.unfiledHintReadOnly')}
                    </p>
                </div>
            ) : null}
        </section>
    );
};

const FolderTile = ({
    folder,
    onOpen,
    onEdit,
    onDelete,
    onCopyLink,
    canManage,
}: FolderActions & { folder: AssessmentFolder }) => {
    const { t } = useTranslation('assessmentFolders');
    const draggingAssessment = useIsDraggingAssessment();
    const {
        setNodeRef,
        setActivatorNodeRef,
        attributes,
        listeners,
        transform,
        transition,
        isDragging,
        isOver,
    } = useSortable({
        id: folder.id,
        data: { type: DRAG_TYPE_FOLDER, folderId: folder.id },
        disabled: !canManage,
    });
    const dropReady = draggingAssessment && isOver;

    return (
        <div
            ref={setNodeRef}
            style={{ transform: CSS.Transform.toString(transform), transition }} // design-lint-ignore: dnd-kit drag transform is per-frame dynamic
            className={cn(
                'group relative flex min-h-16 items-center gap-2 rounded-xl border bg-white p-3 transition-colors',
                dropReady
                    ? 'border-primary-500 bg-primary-50 ring-2 ring-primary-200'
                    : 'border-neutral-200 hover:border-primary-300',
                isDragging && 'z-10 opacity-70 shadow-md'
            )}
        >
            {canManage ? (
                <button
                    ref={setActivatorNodeRef}
                    type="button"
                    aria-label={t('rail.reorder', { name: folder.name })}
                    title={t('rail.reorder', { name: folder.name })}
                    className="-ml-1 cursor-grab touch-none text-neutral-400 opacity-0 transition-opacity hover:text-neutral-600 focus-visible:opacity-100 active:cursor-grabbing group-hover:opacity-100"
                    {...attributes}
                    {...listeners}
                >
                    <DotsSixVertical size={16} />
                </button>
            ) : null}
            <button
                type="button"
                onClick={() => onOpen(folder.id)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
                <FolderThumb
                    imageUrl={folder.image_url}
                    className="size-10 rounded-lg"
                    iconSize={20}
                />
                <span className="min-w-0">
                    <span className="flex items-center gap-1">
                        <span className="truncate text-sm font-semibold text-neutral-800">
                            {folder.name}
                        </span>
                        {folder.status === 'HIDDEN' ? (
                            <EyeSlash
                                size={14}
                                className="shrink-0 text-neutral-400"
                                aria-label={t('rail.hidden')}
                            />
                        ) : null}
                    </span>
                    <span className="block text-caption text-neutral-500">
                        {t('rail.count', { count: folder.assessment_count })}
                    </span>
                </span>
            </button>
            <FolderMenu
                folder={folder}
                canManage={canManage}
                onEdit={onEdit}
                onDelete={onDelete}
                onCopyLink={onCopyLink}
                className="opacity-0 group-hover:opacity-100"
            />
        </div>
    );
};

const FolderMenu = ({
    folder,
    canManage,
    onEdit,
    onDelete,
    onCopyLink,
    className,
}: Pick<FolderActions, 'canManage' | 'onEdit' | 'onDelete' | 'onCopyLink'> & {
    folder: AssessmentFolder;
    className?: string;
}) => {
    const { t } = useTranslation('assessmentFolders');
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label={t('menu.folderActions', { name: folder.name })}
                    className={cn(
                        // Fades instead of hiding, so a tile never changes size under a drag.
                        'rounded-full p-1 text-neutral-500 transition-opacity hover:bg-neutral-100 hover:text-neutral-800 focus-visible:opacity-100 data-[state=open]:opacity-100',
                        className
                    )}
                >
                    <DotsThreeVertical size={18} />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                {canManage ? (
                    <DropdownMenuItem
                        className="cursor-pointer gap-2"
                        onSelect={() => onEdit(folder)}
                    >
                        <PencilSimple size={16} />
                        {t('menu.edit')}
                    </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                    className="cursor-pointer gap-2"
                    onSelect={() => onCopyLink(folder)}
                >
                    <LinkIcon size={16} />
                    {t('menu.copyLink')}
                </DropdownMenuItem>
                {canManage ? (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            className="cursor-pointer gap-2 text-danger-600 focus:text-danger-600"
                            onSelect={() => onDelete(folder)}
                        >
                            <Trash size={16} />
                            {t('menu.delete')}
                        </DropdownMenuItem>
                    </>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
    );
};

/** Inside one folder (or "Not in a folder"): back to all folders, the folder's name and actions. */
export const FolderBreadcrumb = ({
    folder,
    unfiled,
    onBack,
    ...actions
}: Omit<FolderActions, 'onOpen' | 'onCreate'> & {
    folder?: AssessmentFolder;
    unfiled?: boolean;
    onBack: () => void;
}) => {
    const { t } = useTranslation('assessmentFolders');
    return (
        <section className="mb-4 flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-3 sm:flex-row sm:items-center">
            <MyButton
                type="button"
                buttonType="secondary"
                scale="small"
                className="shrink-0 gap-1 self-start sm:self-center"
                onClick={onBack}
            >
                <ArrowLeft size={14} />
                {t('grid.allFolders')}
            </MyButton>
            <div className="flex min-w-0 flex-1 items-center gap-3">
                {unfiled ? (
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500">
                        <FolderMinus size={20} />
                    </span>
                ) : (
                    <FolderThumb
                        imageUrl={folder?.image_url}
                        className="size-10 rounded-lg"
                        iconSize={20}
                    />
                )}
                <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-neutral-900">
                        {unfiled ? t('rail.unfiled') : folder?.name}
                    </h2>
                    {folder ? (
                        <p className="truncate text-caption text-neutral-500">
                            {[
                                t('rail.count', { count: folder.assessment_count }),
                                folder.status === 'HIDDEN' ? t('banner.hiddenFromStudents') : null,
                                folder.description,
                            ]
                                .filter(Boolean)
                                .join(' · ')}
                        </p>
                    ) : null}
                    {folder && folder.assessment_count === 0 ? (
                        <p className="text-caption text-neutral-500">
                            {actions.canManage ? t('banner.emptyHint') : t('banner.emptyReadOnly')}
                        </p>
                    ) : null}
                </div>
            </div>
            {folder ? (
                <div className="flex shrink-0 items-center gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        className="gap-1"
                        onClick={() => actions.onCopyLink(folder)}
                    >
                        <LinkIcon size={14} />
                        {t('menu.copyLink')}
                    </MyButton>
                    {actions.canManage ? <FolderMenu folder={folder} {...actions} /> : null}
                </div>
            ) : null}
        </section>
    );
};

/** Flat "All tests" view: just the switch back to folders. */
export const FolderListHeader = ({
    view,
    onViewChange,
}: {
    view: FolderViewMode;
    onViewChange: (mode: FolderViewMode) => void;
}) => {
    const { t } = useTranslation('assessmentFolders');
    return (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-caption text-neutral-500">{t('view.listHint')}</p>
            <FolderViewSwitch value={view} onChange={onViewChange} />
        </div>
    );
};
