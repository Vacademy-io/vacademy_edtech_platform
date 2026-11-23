import { useTranslation } from 'react-i18next';
import { useDraggable } from '@dnd-kit/core';
import { FolderSimplePlus } from '@phosphor-icons/react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { DRAG_TYPE_PAPER, usePaperFolderUi } from './paper-folder-context';

/** "Move to folder" in a paper card's ⋯ menu; renders nothing when folders are off. */
export const MovePaperToFolderMenuItem = ({
    questionPaperId,
    title,
    folderId,
}: {
    questionPaperId: string;
    title: string;
    /** Known current folder (null = none); undefined = the dialog looks it up. */
    folderId?: string | null;
}) => {
    const { t } = useTranslation('questionPaperFolders');
    const { enabled, openMove } = usePaperFolderUi();
    if (!enabled) return null;
    return (
        <DropdownMenuItem
            className="cursor-pointer gap-2"
            onSelect={() => openMove({ questionPaperId, title, folderId })}
        >
            <FolderSimplePlus size={16} />
            {t('menu.moveToFolder')}
        </DropdownMenuItem>
    );
};

/** The card as is, or draggable when `enabled` (top-level Folders view only). */
export const PaperDragWrapper = ({
    enabled,
    questionPaperId,
    title,
    children,
}: {
    enabled: boolean;
    questionPaperId: string;
    title: string;
    children: React.ReactNode;
}) =>
    enabled ? (
        <DraggablePaper questionPaperId={questionPaperId} title={title}>
            {children}
        </DraggablePaper>
    ) : (
        <>{children}</>
    );

/**
 * Makes a paper card draggable onto a folder tile. The card stays in place (a small
 * overlay follows the pointer), and a click that ends a drag is swallowed so dropping
 * does not also press a button on the card. Only pointer and touch start a drag: the
 * card's own buttons keep Enter and Space, and keyboard users move papers from ⋯.
 */
export const DraggablePaper = ({
    questionPaperId,
    title,
    children,
}: {
    questionPaperId: string;
    title: string;
    children: React.ReactNode;
}) => {
    const { isClickSuppressed } = usePaperFolderUi();
    const { setNodeRef, listeners, isDragging } = useDraggable({
        id: `question-paper:${questionPaperId}`,
        data: { type: DRAG_TYPE_PAPER, questionPaperId, title },
    });
    const pointerListeners = { ...listeners };
    delete pointerListeners.onKeyDown;
    return (
        <div
            ref={setNodeRef}
            {...pointerListeners}
            onClickCapture={(e) => {
                if (isClickSuppressed()) {
                    e.stopPropagation();
                    e.preventDefault();
                }
            }}
            className={cn('touch-pan-y', isDragging && 'opacity-50')}
        >
            {children}
        </div>
    );
};
