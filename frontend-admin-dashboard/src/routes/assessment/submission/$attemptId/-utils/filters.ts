/**
 * Submission page filters and per-question card choice (W2, W3). Pure, tested.
 */
import type { QuestionRow, SubmissionKind } from '@/services/submission-review/types';
import { isObjectiveType } from '@/services/submission-review/marks';

export type RowFilter = 'all' | 'needs_marking' | 'ai' | 'changed';
export const ROW_FILTERS: RowFilter[] = ['all', 'needs_marking', 'ai', 'changed'];

export const parseRowFilter = (v: unknown): RowFilter | undefined =>
    typeof v === 'string' && (ROW_FILTERS as string[]).includes(v) ? (v as RowFilter) : undefined;

export const rowMatches = (row: QuestionRow, filter: RowFilter): boolean => {
    switch (filter) {
        case 'needs_marking':
            // An answer the AI is checking right now is "AI checking", not "Needs marking"
            // (same split as the server's counts.needs_marking / counts.ai_checking).
            return row.state === 'NEEDS_MARKING' && !row.ai_checking;
        case 'ai':
            return row.state === 'AI_DRAFT' || row.ai_checking;
        case 'changed':
            return row.changed_after_release;
        case 'all':
        default:
            return true;
    }
};

export const filterCounts = (rows: QuestionRow[]): Record<RowFilter, number> => ({
    all: rows.length,
    needs_marking: rows.filter((r) => rowMatches(r, 'needs_marking')).length,
    ai: rows.filter((r) => rowMatches(r, 'ai')).length,
    changed: rows.filter((r) => rowMatches(r, 'changed')).length,
});

export interface SectionLike {
    section_id: string;
    questions: QuestionRow[];
}

/** Sections with only the rows the filter keeps; empty sections dropped unless 'all'. */
export const filterSections = <S extends SectionLike>(
    sections: S[],
    filter: RowFilter,
    sectionId: string | null
): S[] =>
    sections
        .filter((s) => !sectionId || s.section_id === sectionId)
        .map((s) => ({ ...s, questions: s.questions.filter((r) => rowMatches(r, filter)) }))
        .filter((s) => filter === 'all' || s.questions.length > 0);

export type CardKind = 'objective' | 'coding' | 'cbe' | 'long' | 'handwritten' | 'omr';

/** Which W3 card renders a row. */
export const cardKindFor = (row: Pick<QuestionRow, 'question_type'>, kind: SubmissionKind): CardKind => {
    const type = (row.question_type ?? '').toUpperCase();
    if (kind === 'OMR') return 'omr';
    if (kind === 'HANDWRITTEN' || kind === 'SCANNED') return 'handwritten';
    if (type === 'CODING') return 'coding';
    if (type === 'CBE_RESPONSE') return 'cbe';
    if (isObjectiveType(type)) return 'objective';
    return 'long';
};

/** Objective rows stay one line (W3a collapsed); everything else opens into a card. */
export const isOneLineRow = (row: Pick<QuestionRow, 'question_type'>, kind: SubmissionKind): boolean =>
    cardKindFor(row, kind) === 'objective';

/** "sid:qid" from the `q` search param. */
export const parseKey = (q: string | undefined | null): { sectionId: string; questionId: string } | null => {
    if (!q) return null;
    const i = q.indexOf(':');
    if (i <= 0 || i === q.length - 1) return null;
    return { sectionId: q.slice(0, i), questionId: q.slice(i + 1) };
};

/**
 * First page (1-based) a question sits on: the AI's page ids first (through the layout
 * map's 0-based page_index when known, else the digits in the id, "p3" → 3), else the
 * teacher's answer_pages ("3,4").
 */
export const firstAnswerPage = (
    pageIds: string[] | null | undefined,
    answerPages: string | null | undefined,
    pageIndexById?: Record<string, number>
): number | null => {
    for (const id of pageIds ?? []) {
        const index = pageIndexById?.[id];
        if (index != null && Number.isFinite(index)) return index + 1;
    }
    for (const id of pageIds ?? []) {
        const m = /(\d+)/.exec(id);
        if (m) return Number(m[1]);
    }
    const m = /(\d+)/.exec(answerPages ?? '');
    return m ? Number(m[1]) : null;
};

/** "3, 4" typed by a teacher → "3,4"; null when it holds anything but page numbers. */
export const normaliseAnswerPages = (input: string): string | null => {
    const parts = input
        .split(/[\s,]+/)
        .map((p) => p.trim())
        .filter(Boolean);
    if (parts.length === 0) return '';
    if (!parts.every((p) => /^\d{1,4}$/.test(p) && Number(p) > 0)) return null;
    const out = Array.from(new Set(parts.map(Number))).join(',');
    return out.length <= 64 ? out : null;
};
