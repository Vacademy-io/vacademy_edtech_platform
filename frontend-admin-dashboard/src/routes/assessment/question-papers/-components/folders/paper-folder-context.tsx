import { createContext, useContext } from 'react';
import type { QuestionPaperFolder } from '@/services/question-paper-folders';

export interface PaperMoveTarget {
    questionPaperId: string;
    title: string;
    /** Known current folder; omitted = the dialog looks it up. */
    folderId?: string | null;
}

export interface PaperFolderUi {
    /** True only inside the folder workspace (folders turned on for the institute). */
    enabled: boolean;
    /** Paper cards can be dragged onto folder tiles (top-level Folders view). */
    dragEnabled: boolean;
    /** Show each card's folder name (flat "All papers" view). */
    showFolderChip: boolean;
    /**
     * Folder of every paper in the open list: the open folder's id, null for "not in a
     * folder", undefined in the flat list (each card looks its own up).
     */
    scopeFolderId: string | null | undefined;
    foldersById: Record<string, QuestionPaperFolder>;
    /** Opens the "Move to folder" dialog for one paper. */
    openMove: (target: PaperMoveTarget) => void;
    /** True for ~300 ms after a drag ends, so the drop does not also click the card. */
    isClickSuppressed: () => boolean;
}

const DISABLED: PaperFolderUi = {
    enabled: false,
    dragEnabled: false,
    showFolderChip: false,
    scopeFolderId: undefined,
    foldersById: {},
    openMove: () => undefined,
    isClickSuppressed: () => false,
};

export const PaperFolderUiContext = createContext<PaperFolderUi>(DISABLED);

/** Folder UI of the papers list; disabled outside the folder workspace (pickers, folders off). */
export const usePaperFolderUi = () => useContext(PaperFolderUiContext);

export const DRAG_TYPE_PAPER = 'question-paper';
export const DRAG_TYPE_PAPER_FOLDER = 'question-paper-folder';
