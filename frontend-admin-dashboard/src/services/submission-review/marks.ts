/**
 * Pure helpers for marks on the Submission page and Quick marks (contract §9.1, §9.8).
 * No React, no i18n: everything here is unit-tested in marks.test.ts.
 */
import type {
    AttemptMarking,
    MarkState,
    QuestionRow,
    QuickMarksItem,
    ReleaseInfo,
} from './types';
import { isKeywordSuggestion } from './labels';

/** Question types scored by the answer key (contract §2.4). */
export const OBJECTIVE_TYPES = new Set([
    'MCQS',
    'MCQM',
    'TRUE_FALSE',
    'NUMERIC',
    'ONE_WORD',
    'CODING',
]);

export const isObjectiveType = (type: string | null | undefined): boolean =>
    OBJECTIVE_TYPES.has((type ?? '').toUpperCase());

/** Two decimals, the precision the server stores. */
export const roundMark = (v: number): number => Math.round(v * 100) / 100;

/** Clamp to [min, max]; a null max means no upper bound. NaN becomes min. */
export const clampMark = (v: number, min: number, max: number | null | undefined): number => {
    if (!Number.isFinite(v)) return roundMark(min);
    let out = Math.max(min, v);
    if (max != null && Number.isFinite(max)) out = Math.min(max, out);
    return roundMark(out);
};

/** "6", "6.5", "6.25"; null/undefined → "—". */
export const formatMark = (n: number | null | undefined): string => {
    if (n == null || !Number.isFinite(n)) return '—';
    const r = roundMark(n);
    return Number.isInteger(r) ? String(r) : String(r).replace(/(\.\d*?)0+$/, '$1');
};

/** "6 / 10", "6 / —" (contract §11). */
export const formatMarkOutOf = (marks: number | null | undefined, max: number | null | undefined) =>
    `${formatMark(marks)} / ${formatMark(max)}`;

/**
 * The mark "Keep" / "Use" sends for a keyword suggestion: the keyword score, never below 0
 * (a long answer's minimum is 0, so a negative keyword score is offered as "Use 0").
 */
export const keywordKeepMarks = (row: Pick<QuestionRow, 'marks' | 'min_marks' | 'max_marks'>): number =>
    clampMark(row.marks, Math.max(0, row.min_marks ?? 0), row.max_marks);

/** The token every write echoes as `expected_release`. */
export const releaseTokenOf = (info: Pick<ReleaseInfo, 'token'> | null | undefined): string =>
    info?.token ?? 'NONE|0';

/**
 * The next attempt (after `current`, then wrapping to the start) whose marking is
 * NEEDS_MARKING. Ids with no known marking are treated as needing marking only when
 * `assumeUnknownNeeds` is set (the strip's list is already "needs marking").
 */
export const nextNeedsMarking = (
    ids: string[],
    current: string | null | undefined,
    markingById: Record<string, Pick<AttemptMarking, 'marking'> | null | undefined>,
    assumeUnknownNeeds = false
): string | null => {
    if (ids.length === 0) return null;
    const start = current ? ids.indexOf(current) : -1;
    const ordered = [...ids.slice(start + 1), ...ids.slice(0, Math.max(start, 0))];
    for (const id of ordered) {
        if (id === current) continue;
        const m = markingById[id];
        if (m ? m.marking === 'NEEDS_MARKING' : assumeUnknownNeeds) return id;
    }
    return null;
};

// ---------------------------------------------------------------- Quick marks

export interface QuickDraft {
    /** The text in the marks box ('' = empty). */
    value: string;
    feedback: string;
    notAnswered: boolean;
}
export type QuickDrafts = Record<string, QuickDraft>;

/** Rows Quick marks lets the teacher type into (objective answers are locked). */
export const isQuickEditable = (row: QuestionRow): boolean => !isObjectiveType(row.question_type);

/** The boxes as the page opens: empty for unmarked answers, else the current mark. */
export const initialQuickDrafts = (rows: QuestionRow[]): QuickDrafts => {
    const out: QuickDrafts = {};
    for (const row of rows) {
        if (!isQuickEditable(row)) continue;
        const empty = row.state === 'NEEDS_MARKING' || row.state === 'NOT_ANSWERED';
        out[row.key] = {
            value: empty ? '' : formatMark(row.marks),
            feedback: '',
            notAnswered: row.state === 'NOT_ANSWERED',
        };
    }
    return out;
};

/**
 * "Mark the rest as not answered" is for an uploaded answer sheet, where an empty box is an
 * answer the learner did not write: a handwritten / scanned copy, or a homework marked by
 * hand (evaluation type MANUAL) or answered with an uploaded file - the same rule as the
 * backend's PDF-tool submit (MarkWriter.marksAnUploadedSheet). On an online test a
 * Needs-marking answer is a real typed / spreadsheet answer (blank ones are already Not
 * answered), so it is not offered.
 */
export const canMarkRestNotAnswered = (
    kind: string | null | undefined,
    sheet?: { evaluationType?: string | null; responseFileId?: string | null }
): boolean => {
    if (kind === 'HANDWRITTEN' || kind === 'SCANNED') return true;
    if (kind !== 'HOMEWORK' || !sheet) return false;
    return sheet.evaluationType?.toUpperCase() === 'MANUAL' || !!sheet.responseFileId?.trim();
};

/**
 * Whether "Mark the rest as not answered" may touch this row: not one the AI is on, or
 * failed, and never a typed answer the keyword match scored (it was written, not left blank).
 */
const restCandidate = (row: QuestionRow): boolean =>
    row.state === 'NEEDS_MARKING' && !row.ai_checking && !row.ai_failed_reason && !isKeywordSuggestion(row);

/** How many empty boxes "Mark the rest as not answered" would change. */
export const emptyRestCount = (items: QuickDrafts, rows: QuestionRow[]): number =>
    rows.filter((r) => {
        const d = items[r.key];
        return restCandidate(r) && !!d && !d.notAnswered && d.value.trim() === '';
    }).length;

/** "Mark the rest as not answered": every EMPTY Needs-marking box becomes Not answered. */
export const markRestNotAnswered = (items: QuickDrafts, rows: QuestionRow[]): QuickDrafts => {
    const out: QuickDrafts = { ...items };
    for (const row of rows) {
        const d = out[row.key];
        if (!d || !restCandidate(row)) continue;
        if (d.value.trim() === '' && !d.notAnswered) out[row.key] = { ...d, notAnswered: true };
    }
    return out;
};

const parseMark = (value: string): number | null => {
    const v = value.trim().replace(',', '.');
    if (v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

/**
 * The A3b items for every box the teacher changed. Values are clamped to the row's range;
 * every item carries the row's revision so a concurrent edit comes back as 409.
 */
export const buildQuickMarksItems = (
    drafts: QuickDrafts,
    initial: QuickDrafts,
    rows: QuestionRow[]
): QuickMarksItem[] => {
    const items: QuickMarksItem[] = [];
    for (const row of rows) {
        const d = drafts[row.key];
        const i = initial[row.key];
        if (!d || !i) continue;
        const feedbackChanged = d.feedback.trim() !== i.feedback.trim();
        const base = {
            section_id: row.section_id,
            question_id: row.question_id,
            expected_revision: row.revision,
            ...(feedbackChanged ? { feedback: d.feedback.trim() } : {}),
        };
        if (d.notAnswered) {
            if (!i.notAnswered || feedbackChanged) items.push({ ...base, not_answered: true });
            continue;
        }
        const parsed = parseMark(d.value);
        const valueChanged = d.value.trim() !== i.value.trim() || i.notAnswered;
        if (parsed == null) {
            // An emptied box is "no change" (the server has no "unmark").
            if (feedbackChanged && row.state !== 'NEEDS_MARKING' && row.state !== 'NOT_ANSWERED') {
                items.push({ ...base, marks: row.marks });
            }
            continue;
        }
        if (!valueChanged && !feedbackChanged) continue;
        items.push({ ...base, marks: clampMark(parsed, row.min_marks, row.max_marks) });
    }
    return items;
};

/**
 * Running total while typing: each counted row's draft (or its saved mark). An approximation
 * of the server's R6 total, which counts the stored mark of an unmarked answer (a keyword
 * suggestion's score, else 0); the server's number replaces it after Save.
 */
export const quickTotal = (drafts: QuickDrafts, rows: QuestionRow[]): number => {
    let total = 0;
    for (const row of rows) {
        if (!row.counted) continue;
        const d = drafts[row.key];
        if (!d) {
            total += row.state === 'NOT_ANSWERED' ? 0 : row.marks;
            continue;
        }
        if (d.notAnswered) continue;
        const parsed = parseMark(d.value);
        total += parsed == null ? row.marks : clampMark(parsed, row.min_marks, row.max_marks);
    }
    return roundMark(total);
};

/** Keys from a 409 STALE_REVISION body (`stale_keys`, or the single `current` row). */
export const staleKeysOf = (details: Record<string, unknown> | undefined): string[] => {
    if (!details) return [];
    const keys = details.stale_keys;
    if (Array.isArray(keys)) return keys.filter((k): k is string => typeof k === 'string');
    const current = details.current as { key?: unknown } | undefined;
    return typeof current?.key === 'string' ? [current.key] : [];
};

/** Accept-AI revisions: each AI draft's key → the revision shown (A4 `expected_revisions`). */
export const draftRevisions = (rows: QuestionRow[]): Record<string, number> =>
    Object.fromEntries(rows.filter((r) => r.state === 'AI_DRAFT').map((r) => [r.key, r.revision]));

/**
 * Default of "Send <learner> the updated result" on an edit after release: on only when this
 * save leaves nothing else to mark, so one correction round sends one message (owner
 * decision 4). While answers still need marking, the teacher sends once at the end.
 */
export const notifyByDefault = (rows: QuestionRow[], savingKeys: string[]): boolean => {
    const saving = new Set(savingKeys);
    return !rows.some((r) => r.state === 'NEEDS_MARKING' && !saving.has(r.key));
};

/** Rows of every section in paper order. */
export const allRows = (sections: { questions: QuestionRow[] }[] | undefined): QuestionRow[] =>
    (sections ?? []).flatMap((s) => s.questions);

export const STATE_ORDER: MarkState[] = ['NEEDS_MARKING', 'AI_DRAFT', 'MARKED', 'NOT_ANSWERED'];
