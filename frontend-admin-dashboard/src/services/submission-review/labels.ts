/**
 * Which label and colour each marking state gets (contract §11, spec §3.1). Pure: returns
 * i18n keys + params so the Submissions list (namespace assessmentSubmissionReviewList)
 * and the Submission page (assessmentSubmissionReview) word them the same way.
 */
import type { AttemptMarking, MarkCounts, MarkedByKind, MarkingStatus, QuestionRow, ResultView } from './types';

export type LabelTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export interface LabelSpec {
    key: string;
    params?: Record<string, string | number>;
    tone: LabelTone;
}

/** W1 Marking column. Keys live under `marking.*`. */
export const markingLabel = (marking: MarkingStatus, counts: MarkCounts | null | undefined): LabelSpec => {
    switch (marking) {
        case 'NEEDS_MARKING':
            return { key: 'marking.needsMarking', params: { count: counts?.needs_marking ?? 0 }, tone: 'warning' };
        case 'AI_CHECKING':
            return { key: 'marking.aiChecking', tone: 'info' };
        case 'CHECK_AI':
            return { key: 'marking.checkAi', params: { count: counts?.ai_draft ?? 0 }, tone: 'primary' };
        case 'DONE':
            return { key: 'marking.done', tone: 'success' };
        case 'TOTAL_ONLY':
            return { key: 'marking.totalOnly', tone: 'neutral' };
        case 'NOT_SUBMITTED':
        default:
            return { key: 'marking.notSubmitted', tone: 'neutral' };
    }
};

/** W1 Result column. Keys live under `result.*`. */
export const resultLabel = (result: ResultView): LabelSpec => {
    switch (result) {
        case 'RELEASED':
            return { key: 'result.released', tone: 'success' };
        case 'RELEASED_CHANGED':
            return { key: 'result.releasedChanged', tone: 'warning' };
        case 'NOT_RELEASED':
        default:
            return { key: 'result.notReleased', tone: 'neutral' };
    }
};

/** ⚠ next to Result: released while answers were still unmarked. */
export const releasedWithUnmarked = (m: Pick<AttemptMarking, 'result' | 'released_with_unmarked'> | null | undefined): number =>
    m && m.result !== 'NOT_RELEASED' ? Math.max(0, m.released_with_unmarked ?? 0) : 0;

/**
 * A typed long answer the keyword scorer marked when AI marking is off: it shows as Needs
 * marking until a teacher (or the AI) confirms it, and `marks` holds the keyword score
 * (it may be 0 or negative). The backend sends marked_by_kind KEYWORD on such rows.
 */
export const isKeywordSuggestion = (row: Pick<QuestionRow, 'state' | 'marked_by_kind'>): boolean =>
    row.state === 'NEEDS_MARKING' && row.marked_by_kind === 'KEYWORD';

/**
 * One question's state as shown on a row. The derived states (AI checking, AI couldn't
 * mark) win over the stored one. Keys live under `state.*`.
 */
export const questionStateLabel = (
    row: Pick<QuestionRow, 'state' | 'ai_checking' | 'ai_failed_reason'>
): LabelSpec => {
    if (row.ai_checking) return { key: 'state.aiChecking', tone: 'info' };
    if (row.state === 'NEEDS_MARKING' && row.ai_failed_reason) {
        return { key: 'state.aiFailed', params: { reason: row.ai_failed_reason }, tone: 'danger' };
    }
    switch (row.state) {
        case 'NEEDS_MARKING':
            return { key: 'state.needsMarking', tone: 'warning' };
        case 'AI_DRAFT':
            return { key: 'state.aiDraft', tone: 'primary' };
        case 'MARKED':
            return { key: 'state.marked', tone: 'success' };
        case 'NOT_ANSWERED':
        default:
            return { key: 'state.notAnswered', tone: 'neutral' };
    }
};

/** "Marked by" label. `name` falls back to the caller's "A teacher" string. Keys under `markedBy.*`. */
export const markedByLabel = (
    kind: MarkedByKind,
    name: string | null | undefined,
    fallbackName: string
): { key: string; params?: Record<string, string> } | null => {
    const who = name && name.trim() ? name : fallbackName;
    switch (kind) {
        case 'ANSWER_KEY':
            return { key: 'markedBy.answerKey' };
        case 'KEYWORD':
            return { key: 'markedBy.keyword' };
        case 'AI':
            return { key: 'markedBy.ai' };
        case 'AI_REVIEWED':
            return { key: 'markedBy.aiReviewed', params: { name: who } };
        case 'TEACHER':
            return { key: 'markedBy.teacher', params: { name: who } };
        case 'TEACHER_LEGACY':
            return { key: 'markedBy.teacherLegacy' };
        case 'OMR':
            return { key: 'markedBy.omr' };
        case 'OFFLINE':
            return { key: 'markedBy.offline' };
        case 'NONE':
        default:
            return null;
    }
};

/** Badge tone → token classes (kept here so cells and the page match). */
export const TONE_CHIP_CLASSES: Record<LabelTone, string> = {
    neutral: 'border-neutral-200 bg-neutral-50 text-neutral-600',
    primary: 'border-primary-200 bg-primary-50 text-primary-600',
    success: 'border-success-200 bg-success-50 text-success-700',
    warning: 'border-warning-200 bg-warning-50 text-warning-700',
    danger: 'border-danger-200 bg-danger-50 text-danger-700',
    info: 'border-info-200 bg-info-50 text-info-700',
};
