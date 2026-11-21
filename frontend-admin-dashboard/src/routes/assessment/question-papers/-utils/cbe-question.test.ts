import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/sessionUtility', () => ({
    getTokenDecodedData: () => null,
    getTokenFromCookie: () => null,
}));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));

import {
    buildCbeEvaluationJson,
    buildCbeSlideFields,
    cbeConfigFromEvaluationJson,
    fillSchemeExpected,
    cbeQuestionMark,
    makeDefaultCbeConfig,
    nextCbePartLabel,
    parseCbeAnswer,
    parseCbeSlideResponse,
    validateCbeConfig,
} from './cbe-question';
import {
    convertQuestionsDataToResponse,
    getEvaluationJSON,
    transformResponseDataToMyQuestionsSchema,
    transformResponseDataToMyQuestionsSchemaSingleQuestion,
} from './helper';
import { uploadQuestionPaperFormSchema } from './upload-question-paper-form-schema';
import { mergeCbeSecret, type CbeConfig } from '@/components/cbe/types';
import type { MyQuestion } from '@/types/assessments/question-paper-form';
import type { QuestionResponse } from '@/types/assessments/question-paper-template';

const fullConfig = (): CbeConfig => ({
    type: 'CBE_RESPONSE',
    data: {
        version: 1,
        gradingNotes: 'Apply the own-figure rule.',
        parts: [
            {
                id: 'p_aaaaaa',
                label: '(a)',
                kind: 'SPREADSHEET',
                marks: 16,
                promptHtml: '<p>Prepare the SFP</p>',
                template: {
                    sheet: { sheets: [{ name: 'Sheet1', cells: { A1: { v: 'Goodwill' } } }] },
                },
                solution: {
                    sheet: {
                        sheets: [
                            {
                                name: 'Consolidated SFP',
                                cells: { B7: { v: 3200, f: '=Workings!B41' } },
                            },
                            { name: 'Workings', cells: { B41: { v: 3200 } } },
                        ],
                    },
                },
                markingScheme: [
                    {
                        id: 'm1',
                        label: 'Goodwill',
                        marks: 2,
                        expected: '3,200',
                        cellRef: 'Consolidated SFP!B7',
                    },
                    { id: 'm2', label: 'Rest', marks: 14 },
                ],
                solutionFileId: 'file-1',
            },
            {
                id: 'p_bbbbbb',
                label: '(b)',
                kind: 'DOCUMENT',
                marks: 4,
                template: null,
                solution: { html: '<p>IAS 38 prohibits…</p>' },
                markingScheme: [],
                solutionFileId: null,
            },
        ],
    },
});

const blank = (n: number) => Array(n).fill({ id: '', name: '', isSelected: false });

const cbeQuestion = (overrides: Partial<MyQuestion> = {}): MyQuestion => ({
    id: 'q-1',
    questionId: 'q-1',
    questionName: '<p>Requirement</p>',
    explanation: '',
    questionType: 'CBE_RESPONSE',
    questionMark: '20',
    questionPenalty: '',
    questionDuration: { hrs: '0', min: '0' },
    singleChoiceOptions: blank(4),
    multipleChoiceOptions: blank(4),
    csingleChoiceOptions: blank(4),
    cmultipleChoiceOptions: blank(4),
    trueFalseOptions: blank(2),
    parentRichTextContent: '<p>Scenario</p>',
    cbeConfig: fullConfig(),
    ...overrides,
});

describe('CBE defaults', () => {
    it('starts with one spreadsheet part (a) worth 10 marks', () => {
        const cfg = makeDefaultCbeConfig();
        expect(cfg.type).toBe('CBE_RESPONSE');
        expect(cfg.data.parts).toHaveLength(1);
        expect(cfg.data.parts[0]).toMatchObject({ label: '(a)', kind: 'SPREADSHEET', marks: 10 });
        expect(cfg.data.parts[0]?.id).toMatch(/^p_[a-z0-9]{6}$/);
        expect(cbeQuestionMark(cfg)).toBe('10');
    });

    it('labels the next part with the first free letter', () => {
        expect(nextCbePartLabel([{ label: '(a)' }, { label: '(c)' }])).toBe('(b)');
    });
});

describe('CBE assessment / question-paper round trip', () => {
    it('saves the FULL config and reads it back unchanged', () => {
        const question = cbeQuestion();
        const json = getEvaluationJSON(question);
        expect(JSON.parse(json)).toEqual(fullConfig());

        const loaded = transformResponseDataToMyQuestionsSchema([
            {
                id: 'q-1',
                question_type: 'CBE_RESPONSE',
                auto_evaluation_json: json,
                text: { content: '<p>Requirement</p>' },
                parent_rich_text: { content: '<p>Scenario</p>' },
                options: [],
            } as unknown as QuestionResponse,
        ])[0];
        expect(loaded?.cbeConfig).toEqual(fullConfig());
        expect(loaded?.questionMark).toBe('20');
        expect(loaded?.parentRichTextContent).toBe('<p>Scenario</p>');
    });

    it('sends response type CBE and no options when editing a paper', () => {
        const [row] = convertQuestionsDataToResponse([cbeQuestion()], 'updated');
        expect(row?.question_response_type).toBe('CBE');
        expect(row?.options).toEqual([]);
        expect(JSON.parse(row?.auto_evaluation_json ?? '')).toEqual(fullConfig());
    });

    it('still saves MCQs as before', () => {
        const json = getEvaluationJSON(
            cbeQuestion({ questionType: 'MCQS', cbeConfig: undefined }),
            ['0']
        );
        expect(JSON.parse(json)).toEqual({ type: 'MCQS', data: { correctOptionIds: ['0'] } });
    });

    it('keeps cbeConfig through the form schema (zod would strip an unknown key)', () => {
        const parsed = uploadQuestionPaperFormSchema('EXAM').parse({
            title: 'Paper',
            questionsType: '',
            optionsType: '',
            answersType: '',
            explanationsType: '',
            questions: [cbeQuestion()],
        });
        expect(parsed.questions[0]?.cbeConfig).toEqual(fullConfig());
    });

    it('blocks a part without marks, only warns about a missing solution', () => {
        const cfg = fullConfig();
        cfg.data.parts[1] = { ...cfg.data.parts[1]!, marks: 0, solution: null };
        const result = uploadQuestionPaperFormSchema('EXAM').safeParse({
            title: 'Paper',
            questionsType: '',
            optionsType: '',
            answersType: '',
            explanationsType: '',
            questions: [cbeQuestion({ cbeConfig: cfg })],
        });
        expect(result.success).toBe(false);

        const { errors, warnings } = validateCbeConfig(cfg);
        expect(errors.map((e) => e.code)).toEqual(['partMarks']);
        expect(warnings.map((w) => w.code)).toContain('noSolution');
    });

    it('flags a marking scheme that does not add up to the part marks', () => {
        const cfg = fullConfig();
        cfg.data.parts[0]!.marks = 18;
        expect(validateCbeConfig(cfg).warnings).toContainEqual(
            expect.objectContaining({ code: 'schemeMismatch', scheme: 16, marks: 18 })
        );
    });
});

describe('CBE question slide payload', () => {
    it('sends the redacted config, the secret only when the editor owns it, and total points', () => {
        const owned = buildCbeSlideFields(fullConfig(), 'owned');
        const redacted = JSON.parse(owned.auto_evaluation_json);
        expect(redacted.data.gradingNotes).toBeUndefined();
        expect(redacted.data.parts[0].solution).toBeUndefined();
        expect(redacted.data.parts[0].markingScheme).toBeUndefined();
        expect(redacted.data.parts[0].template).toEqual(fullConfig().data.parts[0]!.template);
        expect(owned.points).toBe('20');
        const secret = JSON.parse(owned.evaluation_secret_json ?? '');
        expect(mergeCbeSecret(redacted, secret)).toEqual(fullConfig());

        for (const status of [undefined, 'loading', 'failed'] as const) {
            const fields = buildCbeSlideFields(fullConfig(), status);
            expect(fields.evaluation_secret_json).toBeUndefined();
            expect(JSON.parse(fields.auto_evaluation_json).data.parts[0].solution).toBeUndefined();
        }
    });

    it('sends whole-number points when the part marks have halves', () => {
        const cfg = fullConfig();
        cfg.data.parts[0]!.marks = 8.5;
        cfg.data.parts[1]!.marks = 4;
        expect(cbeQuestionMark(cfg)).toBe('12.5');
        const fields = buildCbeSlideFields(cfg, 'owned');
        expect(fields.points).toBe('13');
        expect(Number.isInteger(Number(fields.points))).toBe(true);
        // The real marks still travel in the config / secret.
        expect(JSON.parse(fields.auto_evaluation_json).data.parts[0].marks).toBe(8.5);
    });

    it('loads a slide (redacted config) for editing', () => {
        const redacted = buildCbeSlideFields(fullConfig(), 'owned').auto_evaluation_json;
        const loaded = transformResponseDataToMyQuestionsSchemaSingleQuestion({
            id: 'qs-1',
            question_type: 'CBE_RESPONSE',
            auto_evaluation_json: redacted,
            text_data: { content: '<p>Requirement</p>' },
            options: [],
        } as unknown as QuestionResponse);
        expect(loaded.cbeConfig?.data.parts.map((p) => p.id)).toEqual(['p_aaaaaa', 'p_bbbbbb']);
        expect(loaded.cbeSecretStatus).toBeUndefined();
        expect(cbeConfigFromEvaluationJson('{"type":"MCQS","data":{}}')).toBeUndefined();
    });
});

describe('CBE answers on review screens', () => {
    const answer = {
        parts: {
            p_aaaaaa: {
                kind: 'SPREADSHEET',
                sheet: { sheets: [{ name: 'Sheet1', cells: { B7: { v: 1 } } }] },
            },
            p_bbbbbb: { kind: 'DOCUMENT', html: '<p>Because…</p>' },
        },
    };

    it('reads the answer from every wrapper the backends use', () => {
        expect(parseCbeAnswer(answer)).toEqual(answer);
        expect(parseCbeAnswer({ type: 'CBE_RESPONSE', answer })).toEqual(answer);
        expect(
            parseCbeAnswer(
                JSON.stringify({ questionId: 'q', responseData: { type: 'CBE_RESPONSE', answer } })
            )
        ).toEqual(answer);
        expect(parseCbeAnswer('Row 7: A7 "Goodwill"')).toBeNull();
        expect(parseCbeAnswer('{not json')).toBeNull();
        expect(parseCbeAnswer(null)).toBeNull();
    });

    it('reads a question-slide attempt with its evaluation', () => {
        const attempt = parseCbeSlideResponse(
            JSON.stringify({
                type: 'CBE_RESPONSE',
                answer,
                evaluation: { marks_awarded: 13.5, max_marks: 20, criteria_breakdown: [] },
            })
        );
        expect(attempt?.answer).toEqual(answer);
        expect(attempt?.evaluation?.marks_awarded).toBe(13.5);
        expect(parseCbeSlideResponse('{"selectedOptions":[]}')).toBeNull();
    });
});

describe('CBE solution imported without cached formula values', () => {
    const part = () => ({
        id: 'p1',
        label: '(a)',
        kind: 'SPREADSHEET' as const,
        marks: 2,
        template: null,
        solution: {
            sheet: {
                sheets: [
                    {
                        name: 'SFP',
                        cells: { B7: { f: '=W4!B41' }, B8: { f: '=B7*2', v: 6400, s: { nf: '#,##0' } } },
                    },
                ],
            },
        },
        markingScheme: [
            { id: 'm1', label: 'Goodwill', marks: 1, expected: '', cellRef: 'SFP!B7' },
            { id: 'm2', label: 'Double', marks: 1, expected: '', cellRef: 'SFP!B8' },
        ],
        solutionFileId: null,
    });
    const cfg = (): CbeConfig => ({ type: 'CBE_RESPONSE', data: { version: 1, parts: [part()] } });

    it('warns while a solution formula has no value', () => {
        expect(validateCbeConfig(cfg()).warnings).toContainEqual(
            expect.objectContaining({ code: 'uncomputedSolution', partIndex: 0 })
        );
    });

    it('fills a blank expected figure from the recalculated solution cell on save', () => {
        const filled = fillSchemeExpected(part());
        expect(filled.markingScheme?.[0]?.expected).toBe('');
        expect(filled.markingScheme?.[1]?.expected).toBe('6,400');
        const saved = JSON.parse(buildCbeEvaluationJson(cfg())) as CbeConfig;
        expect(saved.data.parts[0]?.markingScheme?.[1]?.expected).toBe('6,400');
        const slide = buildCbeSlideFields(cfg(), 'owned');
        expect(slide.evaluation_secret_json).toContain('6,400');
        // a figure that is already there is never replaced
        const kept = part();
        kept.markingScheme[1] = { ...kept.markingScheme[1]!, expected: '6,000' };
        expect(fillSchemeExpected(kept)).toBe(kept);
    });
});
