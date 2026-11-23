import { useTranslation } from 'react-i18next';
import { useDndContext } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    ArrowLeft,
    DotsSixVertical,
    DotsThreeVertical,
    FolderMinus,
    HandGrabbing,
    Link as LinkIcon,
    ListBullets,
    PencilSimple,
    Plus,
    SquaresFour,
    Trash,
    WarningCircle,
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
import type { QuestionPaperFolder } from '@/services/question-paper-folders';
import { DRAG_TYPE_PAPER, DRAG_TYPE_PAPER_FOLDER } from './paper-folder-context';

export type PaperFolderViewMode = 'folders' | 'list';

export interface PaperFolderActions {
    onEdit: (folder: QuestionPaperFolder) => void;
    onDelete: (folder: QuestionPaperFolder) => void;
    onCopyLink: (folder: QuestionPaperFolder) => void;
}

const useIsDraggingPaper = () => {
    const { active } = useDndContext();
    return active?.data.current?.type === DRAG_TYPE_PAPER;
};

/** "Folders | All papers": the folder structure, or every paper in one list. */
const PaperFolderViewSwitch = ({
    value,
    onChange,
}: {
    value: PaperFolderViewMode;
    onChange: (mode: PaperFolderViewMode) => void;
}) => {
    const { t } = useTranslation('questionPaperFolders');
    const options: { mode: PaperFolderViewMode; label: string; icon: React.ReactNode }[] = [
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
 * Top level of the folder structure: one card per folder (open it, drop a paper on it,
 * reorder it by its grip), then the heading of the papers that are in no folder.
 */
export const PaperFolderGrid = ({
    folders,
    loading,
    failed,
    onRetry,
    showUnfiledHeading,
    view,
    onViewChange,
    onOpen,
    onCreate,
    ...actions
}: PaperFolderActions & {
    folders: QuestionPaperFolder[];
    loading: boolean;
    failed: boolean;
    onRetry: () => void;
    /** False when every paper is in a folder (no "Not in a folder" section below). */
    showUnfiledHeading: boolean;
    view: PaperFolderViewMode;
    onViewChange: (mode: PaperFolderViewMode) => void;
    onOpen: (folderId: string) => void;
    onCreate: () => void;
}) => {
    const { t } = useTranslation('questionPaperFolders');
    const draggingPaper = useIsDraggingPaper();
    return (
        <section aria-label={t('grid.title')}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-neutral-800">{t('grid.title')}</h2>
                <PaperFolderViewSwitch value={view} onChange={onViewChange} />
            </div>
            {failed ? (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700">
                    <WarningCircle size={18} className="shrink-0" />
                    <span className="flex-1">{t('grid.loadError')}</span>
                    <MyButton type="button" buttonType="secondary" scale="small" onClick={onRetry}>
                        {t('grid.retry')}
                    </MyButton>
                </div>
            ) : (
                <div className="relative">
                    {/* Floats in the gap under the grid: a row added here as a drag starts would
                        push every folder down, under the pointer, and above the grid it would
                        cover the Folders | All papers switch. */}
                    {draggingPaper ? (
                        <p className="absolute -bottom-6 end-0 flex items-center gap-1 text-caption font-medium text-primary-500">
                            <HandGrabbing size={14} />
                            {t('grid.dropHint')}
                        </p>
                    ) : null}
                    <div
                        className={cn(
                            'grid grid-cols-1 gap-3 rounded-xl transition-colors sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4',
                            draggingPaper &&
                                'bg-primary-50/60 outline outline-1 outline-primary-200'
                        )}
                    >
                        <SortableContext
                            items={folders.map((f) => f.id)}
                            strategy={rectSortingStrategy}
                        >
                            {folders.map((folder) => (
                                <PaperFolderTile
                                    key={folder.id}
                                    folder={folder}
                                    onOpen={onOpen}
                                    {...actions}
                                />
                            ))}
                        </SortableContext>
                        <button
                            type="button"
                            onClick={onCreate}
                            className="flex min-h-16 items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-300 p-3 text-sm text-neutral-600 transition-colors hover:border-primary-400 hover:text-primary-500"
                        >
                            <Plus size={16} />
                            {t('grid.newFolder')}
                        </button>
                    </div>
                    {loading ? (
                        <p className="mt-2 text-caption text-neutral-500">{t('grid.loading')}</p>
                    ) : folders.length === 0 ? (
                        <p className="mt-2 text-caption text-neutral-500">{t('grid.empty')}</p>
                    ) : null}
                </div>
            )}
            {showUnfiledHeading ? (
                <div className="mt-6 flex flex-wrap items-baseline gap-x-2">
                    <h2 className="text-base font-semibold text-neutral-800">
                        {t('grid.unfiledTitle')}
                    </h2>
                    <p className="text-caption text-neutral-500">{t('grid.unfiledHint')}</p>
                </div>
            ) : null}
        </section>
    );
};

const PaperFolderTile = ({
    folder,
    onOpen,
    ...actions
}: PaperFolderActions & { folder: QuestionPaperFolder; onOpen: (folderId: string) => void }) => {
    const { t } = useTranslation('questionPaperFolders');
    const draggingPaper = useIsDraggingPaper();
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
        data: { type: DRAG_TYPE_PAPER_FOLDER, folderId: folder.id },
    });
    const dropReady = draggingPaper && isOver;

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
            <button
                ref={setActivatorNodeRef}
                type="button"
                aria-label={t('grid.reorder', { name: folder.name })}
                title={t('grid.reorder', { name: folder.name })}
                className="-ms-1 cursor-grab touch-none text-neutral-400 opacity-0 transition-opacity hover:text-neutral-600 focus-visible:opacity-100 active:cursor-grabbing group-hover:opacity-100"
                {...attributes}
                {...listeners}
            >
                <DotsSixVertical size={16} />
            </button>
            <button
                type="button"
                onClick={() => onOpen(folder.id)}
                className="flex min-w-0 flex-1 items-center gap-3 text-start"
            >
                <FolderThumb
                    imageUrl={folder.image_url}
                    className="size-10 rounded-lg"
                    iconSize={20}
                />
                <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-neutral-800">
                        {folder.name}
                    </span>
                    <span className="block text-caption text-neutral-500">
                        {t('grid.count', { count: folder.paper_count })}
                    </span>
                </span>
            </button>
            <PaperFolderMenu
                folder={folder}
                {...actions}
                className="opacity-0 group-hover:opacity-100"
            />
        </div>
    );
};

const PaperFolderMenu = ({
    folder,
    onEdit,
    onDelete,
    onCopyLink,
    className,
}: PaperFolderActions & { folder: QuestionPaperFolder; className?: string }) => {
    const { t } = useTranslation('questionPaperFolders');
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
                <DropdownMenuItem className="cursor-pointer gap-2" onSelect={() => onEdit(folder)}>
                    <PencilSimple size={16} />
                    {t('menu.edit')}
                </DropdownMenuItem>
                <DropdownMenuItem
                    className="cursor-pointer gap-2"
                    onSelect={() => onCopyLink(folder)}
                >
                    <LinkIcon size={16} />
                    {t('menu.copyLink')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    className="cursor-pointer gap-2 text-danger-600 focus:text-danger-600"
                    onSelect={() => onDelete(folder)}
                >
                    <Trash size={16} />
                    {t('menu.delete')}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
};

/** Inside one folder (or "Not in a folder"): back to all folders, the folder's name and actions. */
export const PaperFolderBreadcrumb = ({
    folder,
    unfiled,
    onBack,
    ...actions
}: PaperFolderActions & {
    folder?: QuestionPaperFolder;
    unfiled?: boolean;
    onBack: () => void;
}) => {
    const { t } = useTranslation('questionPaperFolders');
    return (
        <section className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-3 sm:flex-row sm:items-center">
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
                        {unfiled ? t('grid.unfiledTitle') : folder?.name}
                    </h2>
                    {folder ? (
                        <p className="truncate text-caption text-neutral-500">
                            {[t('grid.count', { count: folder.paper_count }), folder.description]
                                .filter(Boolean)
                                .join(' · ')}
                        </p>
                    ) : unfiled ? (
                        <p className="text-caption text-neutral-500">{t('banner.unfiledHint')}</p>
                    ) : null}
                    {folder && folder.paper_count === 0 ? (
                        <p className="text-caption text-neutral-500">{t('banner.emptyHint')}</p>
                    ) : null}
                </div>
            </div>
            {folder ? (
                <div className="flex shrink-0 flex-wrap items-center gap-2">
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
                    <PaperFolderMenu folder={folder} {...actions} />
                </div>
            ) : null}
        </section>
    );
};

/** Flat "All papers" view: just the switch back to folders. */
export const PaperFolderListHeader = ({
    view,
    onViewChange,
}: {
    view: PaperFolderViewMode;
    onViewChange: (mode: PaperFolderViewMode) => void;
}) => {
    const { t } = useTranslation('questionPaperFolders');
    return (
        <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-caption text-neutral-500">{t('view.listHint')}</p>
            <PaperFolderViewSwitch value={view} onChange={onViewChange} />
        </div>
    );
};
