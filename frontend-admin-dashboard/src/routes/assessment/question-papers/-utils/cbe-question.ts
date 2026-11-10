/**
 * Admin-side helpers for the Spreadsheet & Written Response question
 * (`CBE_RESPONSE`, contract: docs/CBE_RESPONSE_QUESTION.md).
 *
 * Pure functions only (no React, no network), shared by the question editor,
 * the save/load transforms (question papers, assessments, LMS question slides)
 * and the review screens.
 */
import { z } from 'zod';
import {
    CBE_QUESTION_TYPE,
    cbeTotalMarks,
    newPartId,
    parseCbeConfig,
    splitCbeSecret,
    type CbeAnswer,
    type CbeConfig,
    type CbeMarkingLine,
    type CbePart,
    type CbePartKind,
} from '@/components/cbe/types';
import { splitSheetRef } from '@/components/cbe/a1';
import { formatCbeCell } from '@/components/cbe/format';
import { hasUncomputedFormulas } from '@/components/cbe/fortune-adapter';

export const CBE_RESPONSE_TYPE = 'CBE';

/** Marks of the part a new question starts with. */
export const CBE_DEFAULT_PART_MARKS = 10;

/**
 * Zod entry for `cbeConfig` on a question. The config is validated by
 * `validateCbeQuestion`, not by shape: `z.custom` keeps the whole object
 * (a `z.object` would strip every key it does not list — CODING lost its
 * config that way). Accepts null/undefined so non-CBE questions pass.
 */
export const cbeConfigFormSchema = z
    .custom<CbeConfig | null>(
        (value) => value == null || (typeof value === 'object' && !Array.isArray(value))
    )
    .optional();

/**
 * Where the slide secret stands in the editor form (LMS question slides only):
 *  - `owned`: the editor holds the full secret (new slide, or loaded from the
 *    admin endpoint) — it is saved as `evaluation_secret_json`.
 *  - `loading` / `failed` / undefined: the stored secret is not in the form;
 *    nothing secret is sent, so the stored one is kept.
 */
export const CBE_SECRET_STATUSES = ['owned', 'loading', 'failed'] as const;
export type CbeSecretStatus = (typeof CBE_SECRET_STATUSES)[number];
export const cbeSecretStatusFormSchema = z.enum(CBE_SECRET_STATUSES).optional();

export const isCbeQuestionType = (type: string | null | undefined): boolean =>
    type === CBE_QUESTION_TYPE;

const PART_LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** "(a)", "(b)", … the first letter label not already used. */
export function nextCbePartLabel(parts: Pick<CbePart, 'label'>[] = []): string {
    const used = new Set(parts.map((p) => p.label.trim()));
    for (const letter of PART_LETTERS) {
        const label = `(${letter})`;
        if (!used.has(label)) return label;
    }
    return `(${parts.length + 1})`;
}

export function newCbePart(
    kind: CbePartKind,
    existing: CbePart[] = [],
    marks = CBE_DEFAULT_PART_MARKS
): CbePart {
    return {
        id: newPartId(existing.map((p) => p.id)),
        label: nextCbePartLabel(existing),
        promptHtml: '',
        kind,
        marks,
        template: null,
        solution: null,
        markingScheme: [],
        solutionFileId: null,
    };
}

/** A new CBE question: one Spreadsheet part "(a)" worth 10 marks. */
export function makeDefaultCbeConfig(): CbeConfig {
    return {
        type: CBE_QUESTION_TYPE,
        data: { version: 1, parts: [newCbePart('SPREADSHEET')], gradingNotes: '' },
    };
}

/** The config a form value stands for, or a fresh default when it holds none. */
export function ensureCbeConfig(raw: unknown): CbeConfig {
    return parseCbeConfig(raw) ?? makeDefaultCbeConfig();
}

/** Total marks as the form keeps them (`questionMark` is a string). */
export const cbeQuestionMark = (config: CbeConfig | null | undefined): string => {
    const total = cbeTotalMarks(config);
    return Number.isInteger(total) ? String(total) : String(Number(total.toFixed(2)));
};

export const cbeSchemeTotal = (scheme: CbeMarkingLine[] | null | undefined): number =>
    (scheme ?? []).reduce((sum, line) => sum + (Number.isFinite(line.marks) ? line.marks : 0), 0);

const hasSolution = (part: CbePart): boolean => {
    const sol = part.solution;
    if (!sol) return false;
    if ('sheet' in sol) {
        return (sol.sheet?.sheets ?? []).some((tab) => Object.keys(tab.cells ?? {}).length > 0);
    }
    return typeof sol.html === 'string' && sol.html.replace(/<[^>]*>/g, '').trim() !== '';
};

export type CbeIssue =
    | { code: 'noParts' }
    | { code: 'partMarks'; partIndex: number; label: string }
    | { code: 'noSolution'; partIndex: number; label: string }
    | { code: 'schemeMismatch'; partIndex: number; label: string; scheme: number; marks: number }
    | { code: 'uncomputedSolution'; partIndex: number; label: string };

/**
 * Errors block saving (no parts, a part without positive marks); warnings
 * only inform (no solution and no marking scheme, scheme total ≠ part marks).
 */
export function validateCbeConfig(config: CbeConfig | null | undefined): {
    errors: CbeIssue[];
    warnings: CbeIssue[];
} {
    const errors: CbeIssue[] = [];
    const warnings: CbeIssue[] = [];
    const parts = config?.data?.parts ?? [];
    if (parts.length === 0) errors.push({ code: 'noParts' });
    parts.forEach((part, partIndex) => {
        const label = part.label || `#${partIndex + 1}`;
        if (!(Number.isFinite(part.marks) && part.marks > 0)) {
            errors.push({ code: 'partMarks', partIndex, label });
        }
        const scheme = part.markingScheme ?? [];
        if (!hasSolution(part) && scheme.length === 0) {
            warnings.push({ code: 'noSolution', partIndex, label });
        }
        // A workbook saved without cached formula values (openpyxl and similar): the grader
        // would see "(no value)" for those solution cells and no expected figure.
        if (part.solution && 'sheet' in part.solution && hasUncomputedFormulas(part.solution.sheet)) {
            warnings.push({ code: 'uncomputedSolution', partIndex, label });
        }
        if (scheme.length > 0) {
            const total = cbeSchemeTotal(scheme);
            if (Math.abs(total - part.marks) > 1e-9) {
                warnings.push({
                    code: 'schemeMismatch',
                    partIndex,
                    label,
                    scheme: total,
                    marks: part.marks,
                });
            }
        }
    });
    return { errors, warnings };
}

/**
 * `auto_evaluation_json` of a CBE question in an assessment / question paper:
 * the FULL config (assessment_service redacts it for learners).
 */
export function buildCbeEvaluationJson(config: unknown): string {
    return JSON.stringify(withSchemeExpectedFilled(ensureCbeConfig(config)));
}

/**
 * A marking line imported with a blank `expected` (its figure was a formula with no
 * cached value in the workbook) takes the value of the solution cell it points at, once
 * the grid has recalculated that tab. Lines that already have a figure are left alone.
 */
export function fillSchemeExpected(part: CbePart): CbePart {
    const scheme = part.markingScheme ?? [];
    const sheet = part.solution && 'sheet' in part.solution ? part.solution.sheet : null;
    if (!sheet || scheme.length === 0) return part;
    let changed = false;
    const next = scheme.map((line) => {
        if ((line.expected ?? '').trim() !== '' || !line.cellRef) return line;
        const { sheet: tabName, ref } = splitSheetRef(line.cellRef);
        const tab =
            tabName === null ? sheet.sheets[0] : sheet.sheets.find((x) => x.name === tabName);
        const expected = formatCbeCell(tab?.cells?.[ref.toUpperCase()]).trim();
        if (!expected) return line;
        changed = true;
        return { ...line, expected };
    });
    return changed ? { ...part, markingScheme: next } : part;
}

/** {@link fillSchemeExpected} on every part (used on save). */
export function withSchemeExpectedFilled(config: CbeConfig): CbeConfig {
    const parts = config.data.parts ?? [];
    const filled = parts.map(fillSchemeExpected);
    return filled.every((p, i) => p === parts[i])
        ? config
        : { ...config, data: { ...config.data, parts: filled } };
}

/** Reads the config back from a question's `auto_evaluation_json` (string or object). */
export function cbeConfigFromEvaluationJson(raw: unknown): CbeConfig | undefined {
    return parseCbeConfig(raw) ?? undefined;
}

/**
 * The CBE fields of an LMS question-slide payload (contract §3, slide row).
 * `auto_evaluation_json` is always the redacted config. The secret is sent only
 * when the editor owns it, so a slide whose secret failed to load never has its
 * stored solution replaced by an empty one.
 */
export function buildCbeSlideFields(
    rawConfig: unknown,
    secretStatus: CbeSecretStatus | undefined
): { auto_evaluation_json: string; evaluation_secret_json?: string; points: string } {
    const config = withSchemeExpectedFilled(ensureCbeConfig(rawConfig));
    const { config: redacted, secret } = splitCbeSecret(config);
    return {
        auto_evaluation_json: JSON.stringify(redacted),
        ...(secretStatus === 'owned' ? { evaluation_secret_json: JSON.stringify(secret) } : {}),
        // QuestionSlideDTO.points is an Integer (a decimal string is a 400). Grading
        // takes its maximum from the parts' marks, so this is display-only.
        points: String(Math.round(cbeTotalMarks(config))),
    };
}

// ---------------------------------------------------------------------------
// Review screens: learner answers
// ---------------------------------------------------------------------------

const isRecord = (x: unknown): x is Record<string, unknown> =>
    typeof x === 'object' && x !== null && !Array.isArray(x);

const asAnswer = (x: unknown): CbeAnswer | null =>
    isRecord(x) && isRecord(x.parts) ? (x as unknown as CbeAnswer) : null;

/**
 * A learner's CBE answer from whatever wraps it: the answer itself
 * (`{parts}`), a responseData / slide response (`{type, answer}`), an attempt
 * question node (`{responseData: {type, answer}}`), or a JSON string of any
 * of these. Null when it is none of them (e.g. plain text).
 */
export function parseCbeAnswer(raw: unknown): CbeAnswer | null {
    let value: unknown = raw;
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed.startsWith('{')) return null;
        try {
            value = JSON.parse(trimmed);
        } catch {
            return null;
        }
    }
    if (!isRecord(value)) return null;
    return (
        asAnswer(value) ??
        asAnswer(value.answer) ??
        (isRecord(value.responseData)
            ? asAnswer(value.responseData) ?? asAnswer(value.responseData.answer)
            : null)
    );
}

export type CbeEvaluation = {
    marks_awarded?: number | null;
    max_marks?: number | null;
    verdict?: string | null;
    feedback?: string | null;
    criteria_breakdown?: Array<{
        criteria_name?: string;
        marks?: number;
        max_marks?: number;
        reason?: string;
    }>;
};

/** `{type: 'CBE_RESPONSE', answer, evaluation, error?}` of a question-slide attempt. */
export function parseCbeSlideResponse(raw: unknown): {
    answer: CbeAnswer | null;
    evaluation: CbeEvaluation | null;
    error: string | null;
} | null {
    let value: unknown = raw;
    if (typeof raw === 'string') {
        try {
            value = JSON.parse(raw);
        } catch {
            return null;
        }
    }
    if (!isRecord(value) || value.type !== CBE_QUESTION_TYPE) return null;
    return {
        answer: parseCbeAnswer(value),
        evaluation: isRecord(value.evaluation) ? (value.evaluation as CbeEvaluation) : null,
        error: typeof value.error === 'string' ? value.error : null,
    };
}
