import type { QuestionResponse } from '@/types/assessments/question-paper-template';
import type { MyQuestion } from '@/types/assessments/question-paper-form';
import {
    convertQuestionsDataToResponse,
    transformResponseDataToMyQuestionsSchemaSingleQuestion,
} from '@/routes/assessment/question-papers/-utils/helper';
import type { LibraryTagKind } from '../-services/question-library-services';

/**
 * New questions on their way into the library, from a Word file, AI, the editor or the
 * Excel template. Everything ends up as one payload shape (the paper editor's own
 * serialiser), so the backend saves them all the same way.
 */

export interface DraftTag {
    kind: LibraryTagKind;
    name: string;
}

export interface DraftQuestion {
    /** Stable key for lists. */
    key: string;
    /** Backend question shape (what the parser and AI return). */
    question: QuestionResponse;
    difficulty: string;
    /** Topic names below the import's parent. Empty = the parent itself. */
    path: string[];
    tags: DraftTag[];
    /** Excel row number, for messages. */
    row?: number;
}

export interface LibraryImportItem {
    path: string[];
    question: unknown;
    difficulty: string;
    tags: DraftTag[];
}

const DIFFICULTY_VALUES = ['EASY', 'MEDIUM', 'HARD'];

let draftCounter = 0;
export const draftKey = () => `draft-${Date.now()}-${(draftCounter += 1)}`;

/** EASY/MEDIUM/HARD from the question itself (AI and some uploads carry one), else MEDIUM. */
export const ownDifficulty = (question: Partial<QuestionResponse> & Record<string, unknown>) => {
    const raw = String(question.ai_difficulty_level ?? question.level ?? '').toUpperCase();
    return DIFFICULTY_VALUES.includes(raw) ? raw : 'MEDIUM';
};

const OPTION_LISTS = [
    'singleChoiceOptions',
    'multipleChoiceOptions',
    'csingleChoiceOptions',
    'cmultipleChoiceOptions',
    'trueFalseOptions',
] as const;

/**
 * One draft in the payload the backend saves. It goes through the form shape and back, the
 * same round trip a new question in the paper editor makes, so options and the answer key
 * come out the way the save path expects. Option ids are cleared after the answer key is
 * read, because a new question must get options of its own.
 */
export const toImportItem = (draft: DraftQuestion): LibraryImportItem => {
    const form = transformResponseDataToMyQuestionsSchemaSingleQuestion(draft.question);
    const fresh = { ...form, id: '' } as MyQuestion;
    OPTION_LISTS.forEach((list) => {
        const options = fresh[list];
        if (Array.isArray(options)) {
            (fresh as unknown as Record<string, unknown>)[list] = options.map((option) => ({
                ...option,
                id: '',
            }));
        }
    });
    const [payload] = convertQuestionsDataToResponse([fresh], 'added');
    return {
        path: draft.path,
        question: payload,
        difficulty: draft.difficulty,
        tags: draft.tags,
    };
};

/** Splits "a, b; c" into clean names. */
export const splitList = (value: string) =>
    value
        .split(/[,;]/)
        .map((part) => part.trim().replace(/\s+/g, ' '))
        .filter(Boolean);

/** The shared tags typed once for a whole batch, as DraftTags. */
export const batchTags = (concept: string, pyq: string, source: string): DraftTag[] => [
    ...splitList(concept).map((name) => ({ kind: 'CONCEPT' as const, name })),
    ...splitList(pyq).map((name) => ({ kind: 'PYQ' as const, name })),
    ...splitList(source).map((name) => ({ kind: 'SOURCE' as const, name })),
];

export const chunk = <T>(list: T[], size: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
};

// ------------------------------------------------------------------ Excel template

/** Topic columns, top first. Up to five levels, the library's limit. */
export const PATH_COLUMNS = ['Course', 'Subject', 'Chapter', 'Topic', 'Sub-topic'] as const;
const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

export const TEMPLATE_HEADERS = [
    ...PATH_COLUMNS,
    'Question',
    'Type',
    ...OPTION_LETTERS.map((letter) => `Option ${letter}`),
    'Answer',
    'Explanation',
    'Difficulty',
    'Concept tags',
    'Past paper',
    'Source',
];

export const TEMPLATE_EXAMPLES: string[][] = [
    [
        'UPSC',
        'Polity',
        'Fundamental Rights',
        'Right to Life',
        '',
        'Which Article of the Constitution protects the right to life and personal liberty?',
        'MCQ single',
        'Article 14',
        'Article 19',
        'Article 21',
        'Article 32',
        '',
        '',
        'C',
        'Article 21 says no person shall be deprived of life or personal liberty except by procedure established by law.',
        'Easy',
        'Article 21',
        'UPSC 2019',
        'Laxmikanth',
    ],
    [
        'Class 10',
        'Science',
        'Electricity',
        '',
        '',
        'A 6 V battery drives a current through a 3 ohm resistor. What is the current in amperes?',
        'Numeric',
        '',
        '',
        '',
        '',
        '',
        '',
        '2',
        'I = V / R = 6 / 3 = 2 A.',
        'Medium',
        "Ohm's law",
        '',
        'NCERT',
    ],
];

const TYPE_ALIASES: Record<string, string> = {
    mcq: 'MCQS',
    mcqs: 'MCQS',
    mcqsingle: 'MCQS',
    single: 'MCQS',
    singlechoice: 'MCQS',
    mcqm: 'MCQM',
    mcqmultiple: 'MCQM',
    multiple: 'MCQM',
    multiplechoice: 'MCQM',
    truefalse: 'TRUE_FALSE',
    tf: 'TRUE_FALSE',
    numeric: 'NUMERIC',
    number: 'NUMERIC',
    oneword: 'ONE_WORD',
    shortanswer: 'ONE_WORD',
    longanswer: 'LONG_ANSWER',
    long: 'LONG_ANSWER',
    subjective: 'LONG_ANSWER',
};

const typeOf = (raw: string): string | null => {
    const key = raw.toLowerCase().replace(/[^a-z]/g, '');
    if (!key) return 'MCQS';
    return TYPE_ALIASES[key] ?? null;
};

const escapeHtml = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const rich = (text: string) => ({ id: null, type: 'HTML', content: escapeHtml(text) });

/** Why a row was rejected, as an i18n key with its values. */
export type SheetProblem =
    | 'noCourse'
    | 'noQuestion'
    | 'badType'
    | 'fewOptions'
    | 'noAnswer'
    | 'badAnswer'
    | 'badNumber'
    | 'badDifficulty';

export interface SheetResult {
    drafts: DraftQuestion[];
    errors: { row: number; problem: SheetProblem }[];
    /** Rows that were completely empty and skipped. */
    blankRows: number;
}

/**
 * Rows of the template (first row = headers, matched by name in any order and any case)
 * to drafts. Every bad row is reported with its sheet row number and skipped.
 */
export const parseTemplateRows = (rows: unknown[][]): SheetResult => {
    const result: SheetResult = { drafts: [], errors: [], blankRows: 0 };
    if (rows.length === 0) return result;
    const header = (rows[0] ?? []).map((cell) =>
        String(cell ?? '')
            .trim()
            .toLowerCase()
    );
    const col = (name: string) => header.indexOf(name.toLowerCase());
    const cellOf = (row: unknown[], name: string) => {
        const index = col(name);
        return index < 0 ? '' : String(row[index] ?? '').trim();
    };

    rows.slice(1).forEach((row, i) => {
        const rowNumber = i + 2;
        if (!row || row.every((cell) => String(cell ?? '').trim() === '')) {
            result.blankRows += 1;
            return;
        }
        const fail = (problem: SheetProblem): void => {
            result.errors.push({ row: rowNumber, problem });
        };

        // Course is the top level: without it the row's subject would become a course.
        if (!cellOf(row, PATH_COLUMNS[0])) return fail('noCourse');
        const path = PATH_COLUMNS.map((name) => cellOf(row, name)).filter(Boolean);
        const text = cellOf(row, 'Question');
        if (!text) return fail('noQuestion');
        const type = typeOf(cellOf(row, 'Type'));
        if (!type) return fail('badType');
        const difficultyRaw = cellOf(row, 'Difficulty').toUpperCase();
        if (difficultyRaw && !DIFFICULTY_VALUES.includes(difficultyRaw))
            return fail('badDifficulty');
        const answer = cellOf(row, 'Answer');

        let options: { preview_id: string; text: ReturnType<typeof rich> }[] = [];
        let evaluation: unknown = null;
        if (type === 'MCQS' || type === 'MCQM') {
            options = OPTION_LETTERS.map((letter, index) => ({
                letter,
                index,
                value: cellOf(row, `Option ${letter}`),
            }))
                .filter((option) => option.value)
                .map((option) => ({ preview_id: String(option.index), text: rich(option.value) }));
            if (options.length < 2) return fail('fewOptions');
            if (!answer) return fail('noAnswer');
            const letters = splitList(answer.toUpperCase().replace(/\s+/g, ','));
            const ids = letters.map((letter) => String(OPTION_LETTERS.indexOf(letter as never)));
            const known = new Set(options.map((option) => option.preview_id));
            if (ids.length === 0 || ids.some((id) => !known.has(id))) return fail('badAnswer');
            if (type === 'MCQS' && ids.length > 1) return fail('badAnswer');
            evaluation = { type, data: { correctOptionIds: ids } };
        } else if (type === 'TRUE_FALSE') {
            const value = answer.toLowerCase();
            if (!['true', 'false', 't', 'f'].includes(value)) return fail('badAnswer');
            options = [
                { preview_id: '0', text: rich('True') },
                { preview_id: '1', text: rich('False') },
            ];
            evaluation = {
                type,
                data: { correctOptionIds: [value.startsWith('t') ? '0' : '1'] },
            };
        } else if (type === 'NUMERIC') {
            const values = splitList(answer).map(Number);
            if (values.length === 0 || values.some((value) => Number.isNaN(value))) {
                return fail('badNumber');
            }
            evaluation = { type, data: { validAnswers: values } };
        } else if (type === 'ONE_WORD') {
            if (!answer) return fail('noAnswer');
            evaluation = { type, data: { answer } };
        } else {
            evaluation = answer
                ? { type, data: { answer: { content: escapeHtml(answer) } } }
                : null;
        }

        const explanation = cellOf(row, 'Explanation');
        const question = {
            id: null,
            preview_id: null,
            question_type: type,
            text: rich(text),
            explanation_text: rich(explanation),
            options,
            auto_evaluation_json: evaluation ? JSON.stringify(evaluation) : '',
            options_json: null,
            parent_rich_text: null,
            default_question_time_mins: null,
        } as unknown as QuestionResponse;

        result.drafts.push({
            key: draftKey(),
            question,
            difficulty: difficultyRaw || 'MEDIUM',
            path,
            tags: batchTags(
                cellOf(row, 'Concept tags'),
                cellOf(row, 'Past paper'),
                cellOf(row, 'Source')
            ),
            row: rowNumber,
        });
    });
    return result;
};

/** "UPSC › Polity" → how many questions go there, in sheet order. */
export const countByPath = (drafts: DraftQuestion[]) => {
    const counts = new Map<string, number>();
    drafts.forEach((draft) => {
        const key = draft.path.join(' › ');
        counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return Array.from(counts.entries()).map(([path, count]) => ({ path, count }));
};

/** A blank question of one type, for writing one by hand in the editor. */
export const blankQuestion = (type: string): QuestionResponse => {
    const optionCount = type === 'TRUE_FALSE' ? 2 : type === 'MCQS' || type === 'MCQM' ? 4 : 0;
    const labels = type === 'TRUE_FALSE' ? ['True', 'False'] : [];
    return {
        id: null,
        preview_id: null,
        question_type: type,
        text: { id: null, type: 'HTML', content: '' },
        explanation_text: { id: null, type: 'HTML', content: '' },
        options: Array.from({ length: optionCount }, (_, index) => ({
            id: null,
            preview_id: String(index),
            text: { id: null, type: 'HTML', content: labels[index] ?? '' },
        })),
        auto_evaluation_json: '',
        options_json: null,
        parent_rich_text: null,
        default_question_time_mins: null,
    } as unknown as QuestionResponse;
};
