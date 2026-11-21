import type { QuestionRow, SubmissionOutline } from '@/services/submission-review/types';

/** Per-question actions the page owns (dialogs live once, at page level). */
export interface RowActions {
    onEdit: (row: QuestionRow) => void;
    onNotAnswered: (row: QuestionRow) => void;
    onRemark: (row: QuestionRow) => void;
    onHistory: (row: QuestionRow) => void;
    onAcceptAi: (row: QuestionRow) => void;
    acceptingKey: string | null;
    /** "Keep X / Y": confirm a keyword-match suggestion as the teacher's mark (before release). */
    onKeepKeyword: (row: QuestionRow) => void;
    keepingKey: string | null;
    onShowSheet: (page: number | null) => void;
}

/**
 * An imported total with no question marks ("Entered as a total"): one question's mark would
 * replace it, so the server refuses (422 TOTAL_ONLY) until "Add question marks" exists.
 */
export const isImportedTotal = (outline: SubmissionOutline): boolean =>
    outline.total_only && Math.abs(outline.stored_total ?? 0) > 0.005;

/** Edit marks is allowed now (before release: can_edit; after: can_edit_after_release). */
export const canEditMarks = (outline: SubmissionOutline): boolean =>
    !isImportedTotal(outline) &&
    (outline.release.status === 'RELEASED'
        ? outline.permissions.can_edit_after_release
        : outline.permissions.can_edit);
