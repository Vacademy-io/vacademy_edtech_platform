import { createContext, useContext } from 'react';
import type { AssessmentFolder } from '@/services/assessment-folders';

export interface MoveTarget {
    assessmentId: string;
    name: string;
    /** Known current folder; omitted = the dialog looks it up. */
    folderId?: string | null;
}

export interface AssessmentFolderUi {
    enabled: boolean;
    /** The role may create/edit/delete folders and move assessments (Display Settings). */
    canManage: boolean;
    /** Cards can be dragged onto folder tiles (top-level Folders view, role may manage). */
    dragEnabled: boolean;
    /** Show each card's folder name (flat "All tests" view). */
    showFolderChip: boolean;
    /** 'all', 'unfiled' or the open folder's id. */
    selectedKey: string;
    folders: AssessmentFolder[];
    foldersById: Record<string, AssessmentFolder>;
    /** Opens the "Move to folder" dialog for one assessment. */
    openMove: (target: MoveTarget) => void;
    /** True for ~300 ms after a drag ends, so the drop does not also click the card. */
    isClickSuppressed: () => boolean;
}

const DISABLED: AssessmentFolderUi = {
    enabled: false,
    canManage: false,
    dragEnabled: false,
    showFolderChip: false,
    selectedKey: 'all',
    folders: [],
    foldersById: {},
    openMove: () => undefined,
    isClickSuppressed: () => false,
};

export const AssessmentFolderUiContext = createContext<AssessmentFolderUi>(DISABLED);

/** Folder UI of the assessment list; disabled outside the folder workspace (e.g. course outline). */
export const useAssessmentFolderUi = () => useContext(AssessmentFolderUiContext);

export const DRAG_TYPE_ASSESSMENT = 'assessment';
export const DRAG_TYPE_FOLDER = 'folder';
