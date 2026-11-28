/**
 * The admin test report receives each answer as the stored JSON strings:
 *   student_response_options = question_wise_marks.response_json
 *       {"questionId":…,"responseData":{"type":"MCQS","optionIds":["…"]}}
 *   correct_options          = the question's auto_evaluation_json
 *       {"type":"NUMERIC","data":{"validAnswers":[12.0]}}
 * The dialog used to print those strings as they were. These helpers read them into
 * what the review shows. Older payloads sent Option[] lists; those still read.
 */

export type ReportAnswer =
    | { kind: 'OPTIONS'; optionIds: string[] }
    /** Older payloads: the option texts themselves. */
    | { kind: 'OPTION_TEXTS'; texts: string[] }
    | { kind: 'VALUES'; values: string[] }
    | { kind: 'TEXT'; text: string }
    | { kind: 'NONE' };

const NONE: ReportAnswer = { kind: 'NONE' };

type Json = Record<string, unknown>;

const parseObject = (raw: unknown): Json | null => {
    if (raw == null) return null;
    if (typeof raw === 'string') {
        const s = raw.trim();
        if (!s.startsWith('{')) return null;
        try {
            const v: unknown = JSON.parse(s);
            return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
        } catch {
            return null;
        }
    }
    return typeof raw === 'object' && !Array.isArray(raw) ? (raw as Json) : null;
};

/** HTML with no visible text ("<p></p>") counts as empty. */
const hasText = (s: string): boolean =>
    s
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .trim() !== '';

const nonEmptyStrings = (v: unknown): string[] =>
    Array.isArray(v)
        ? v
              .filter((x) => x != null && (typeof x === 'string' || typeof x === 'number'))
              .map((x) => String(x).trim())
              .filter((x) => x !== '')
        : [];

const valueText = (v: unknown): string | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
    return null;
};

/** "answer" is either the text or {content: text}. */
const answerText = (v: unknown): string | null => {
    const raw =
        typeof v === 'string'
            ? v
            : v && typeof v === 'object'
              ? (v as { content?: unknown }).content
              : null;
    return typeof raw === 'string' && hasText(raw) ? raw : null;
};

const legacy = (raw: unknown): ReportAnswer | null => {
    if (Array.isArray(raw)) {
        const texts = raw
            .map((o) =>
                o && typeof o === 'object' ? (o as { option_name?: unknown }).option_name : o
            )
            .filter((x): x is string => typeof x === 'string' && hasText(x));
        return texts.length ? { kind: 'OPTION_TEXTS', texts } : NONE;
    }
    // A plain (non-JSON) string is an old answer text.
    if (typeof raw === 'string' && !raw.trim().startsWith('{')) {
        return hasText(raw) ? { kind: 'TEXT', text: raw } : NONE;
    }
    return null;
};

/** What the learner answered, from question_wise_marks.response_json. */
export const parseStudentAnswer = (raw: unknown): ReportAnswer => {
    const old = legacy(raw);
    if (old) return old;
    const root = parseObject(raw);
    if (!root) return NONE;
    const data = parseObject(root.responseData) ?? root;
    if ('optionIds' in data) {
        const ids = nonEmptyStrings(data.optionIds);
        return ids.length ? { kind: 'OPTIONS', optionIds: ids } : NONE;
    }
    if ('validAnswer' in data) {
        const v = valueText(data.validAnswer);
        return v ? { kind: 'VALUES', values: [v] } : NONE;
    }
    const text = answerText(data.answer);
    return text ? { kind: 'TEXT', text } : NONE;
};

/** The answer key, from the question's auto_evaluation_json. */
export const parseCorrectAnswer = (raw: unknown): ReportAnswer => {
    const old = legacy(raw);
    if (old) return old;
    const root = parseObject(raw);
    if (!root) return NONE;
    const data = parseObject(root.data) ?? root;
    const ids = data.correctOptionIds ?? data.correct_option_ids;
    if (Array.isArray(ids)) {
        const list = nonEmptyStrings(ids);
        return list.length ? { kind: 'OPTIONS', optionIds: list } : NONE;
    }
    if (Array.isArray(data.validAnswers)) {
        const values = nonEmptyStrings(data.validAnswers);
        return values.length ? { kind: 'VALUES', values } : NONE;
    }
    const text = answerText(data.answer);
    return text ? { kind: 'TEXT', text } : NONE;
};

export type ReviewStatus = 'CORRECT' | 'PARTIAL' | 'WRONG' | 'PENDING' | 'SKIPPED';

/**
 * The report's answer_status as the review shows it. The server keeps an unmarked answer
 * as PENDING, the same as an unanswered one; an answer that is there reads as
 * "not marked yet", not as skipped.
 */
export const reviewStatusOf = (
    answerStatus: string | null | undefined,
    answered: boolean
): ReviewStatus => {
    switch ((answerStatus ?? '').toUpperCase()) {
        case 'CORRECT':
            return 'CORRECT';
        case 'PARTIAL_CORRECT':
        case 'PARTIALLY_CORRECT':
            return 'PARTIAL';
        case 'INCORRECT':
        case 'WRONG':
            return 'WRONG';
        default:
            return answered ? 'PENDING' : 'SKIPPED';
    }
};

/** Whole hours, minutes and seconds of a duration in seconds. */
export const durationParts = (totalSeconds: number | null | undefined) => {
    const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
    return { hours: Math.floor(s / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60 };
};

/**
 * A server timestamp as a Date. The server sends UTC and sometimes leaves out the zone,
 * which the browser would read as local time (same rule as convertToLocalDateTime).
 */
export const parseServerDate = (value: string | null | undefined): Date | null => {
    if (!value) return null;
    const hasZone = /Z$|[+-]\d{2}:?\d{2}$/i.test(value);
    const date = new Date(hasZone ? value : `${value.replace(' ', 'T')}Z`);
    return Number.isNaN(date.getTime()) ? null : date;
};
