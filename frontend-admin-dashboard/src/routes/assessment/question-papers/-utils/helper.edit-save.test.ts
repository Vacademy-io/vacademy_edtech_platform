import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/sessionUtility', () => ({
    getTokenDecodedData: () => null,
    getTokenFromCookie: () => null,
}));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));

import {
    convertQuestionsDataToResponse,
    findNumericQuestionWithoutAnswer,
    usableNumericAnswers,
} from './helper';
import type { MyQuestion } from '@/types/assessments/question-paper-form';

const blank = (n: number) => Array(n).fill({ id: '', name: '', isSelected: false });

const question = (overrides: Partial<MyQuestion>): MyQuestion => ({
    id: 'q-1',
    questionId: 'q-1',
    questionName: '<p>Question</p>',
    explanation: '',
    questionType: 'MCQS',
    questionMark: '',
    questionPenalty: '',
    questionDuration: { hrs: '0', min: '0' },
    singleChoiceOptions: blank(4),
    multipleChoiceOptions: blank(4),
    csingleChoiceOptions: blank(4),
    cmultipleChoiceOptions: blank(4),
    trueFalseOptions: blank(2),
    validAnswers: [],
    tags: [],
    ...overrides,
});

const evaluation = (payload: { auto_evaluation_json: string }) =>
    JSON.parse(payload.auto_evaluation_json);

// Editing a saved paper goes through convertQuestionsDataToResponse. It used to
// serialise every question as an MCQ, so a numeric answer was dropped on save.
describe('convertQuestionsDataToResponse (question-paper edit save)', () => {
    it('keeps the numeric answer and settings of an edited NUMERIC question', () => {
        const [payload] = convertQuestionsDataToResponse(
            [
                question({
                    questionType: 'NUMERIC',
                    validAnswers: [274],
                    decimals: 2,
                    numericType: 'DECIMAL',
                }),
            ],
            'updated'
        );
        expect(payload!.question_type).toBe('NUMERIC');
        expect(evaluation(payload!)).toEqual({ type: 'NUMERIC', data: { validAnswers: [274] } });
        expect(JSON.parse(payload!.options_json!)).toEqual({ decimals: 2, numericType: 'DECIMAL' });
        expect(payload!.options).toEqual([]);
    });

    it('maps a comprehension numeric to NUMERIC and keeps its passage', () => {
        const [payload] = convertQuestionsDataToResponse(
            [
                question({
                    questionType: 'CNUMERIC',
                    validAnswers: [1.5],
                    parentRichTextContent: '<p>Passage</p>',
                }),
            ],
            'updated'
        );
        expect(payload!.question_type).toBe('NUMERIC');
        expect(evaluation(payload!).data.validAnswers).toEqual([1.5]);
        expect(payload!.parent_rich_text?.content).toBe('<p>Passage</p>');
    });

    it('sends the true/false options, not four blank MCQ options', () => {
        const [payload] = convertQuestionsDataToResponse(
            [
                question({
                    questionType: 'TRUE_FALSE',
                    trueFalseOptions: [
                        { id: 'o-true', name: 'True', isSelected: false },
                        { id: 'o-false', name: 'False', isSelected: true },
                    ],
                }),
            ],
            'updated'
        );
        expect(payload!.options.map((o) => o.id)).toEqual(['o-true', 'o-false']);
        expect(evaluation(payload!)).toEqual({
            type: 'TRUE_FALSE',
            data: { correctOptionIds: ['o-false'] },
        });
    });

    it('keeps the MCQ answer key exactly as before', () => {
        const [payload] = convertQuestionsDataToResponse(
            [
                question({
                    questionType: 'MCQM',
                    multipleChoiceOptions: [
                        { id: 'a', name: 'A', isSelected: true },
                        { id: 'b', name: 'B', isSelected: false },
                        { id: 'c', name: 'C', isSelected: true },
                    ],
                }),
            ],
            'updated'
        );
        expect(evaluation(payload!)).toEqual({
            type: 'MCQM',
            data: { correctOptionIds: ['a', 'c'] },
        });
        expect(payload!.options.map((o) => o.preview_id)).toEqual(['a', 'b', 'c']);
    });

    it('marks a question added during the edit by option index', () => {
        const [payload] = convertQuestionsDataToResponse(
            [
                question({
                    questionType: 'MCQS',
                    singleChoiceOptions: [
                        { id: '', name: 'A', isSelected: false },
                        { id: '', name: 'B', isSelected: true },
                    ],
                }),
            ],
            'added'
        );
        expect(payload!.id).toBeNull();
        expect(payload!.options.map((o) => o.preview_id)).toEqual([0, 1]);
        expect(evaluation(payload!).data.correctOptionIds).toEqual(['1']);
    });
});

describe('numeric answers left empty in the editor', () => {
    it('drops empty boxes from the saved answer key instead of saving null or 0', () => {
        const [payload] = convertQuestionsDataToResponse(
            [
                question({
                    questionType: 'NUMERIC',
                    validAnswers: [275, null, 274.99] as unknown as number[],
                }),
            ],
            'updated'
        );
        expect(JSON.parse(payload!.auto_evaluation_json).data.validAnswers).toEqual([275, 274.99]);
    });

    it('keeps 0 when 0 is the typed answer, and passes other values through untouched', () => {
        expect(usableNumericAnswers([0])).toEqual([0]);
        expect(usableNumericAnswers(['2.5', '', null, undefined])).toEqual(['2.5']);
    });

    it('finds the first numeric question with no usable answer', () => {
        const questions = [
            question({ questionType: 'MCQS' }),
            question({ questionType: 'NUMERIC', validAnswers: [275] }),
            question({ questionType: 'CNUMERIC', validAnswers: [null] as unknown as number[] }),
            question({ questionType: 'NUMERIC', validAnswers: undefined }),
        ];
        expect(findNumericQuestionWithoutAnswer(questions)).toBe(2);
        expect(findNumericQuestionWithoutAnswer(questions.slice(0, 2))).toBe(-1);
        expect(findNumericQuestionWithoutAnswer(undefined)).toBe(-1);
    });

    it('on an edit, leaves alone a question already saved without an answer', () => {
        const saved = [
            question({ questionId: 'old', questionType: 'NUMERIC', validAnswers: undefined }),
        ];
        // Untouched: it saves exactly as before.
        expect(findNumericQuestionWithoutAnswer(structuredClone(saved), saved)).toBe(-1);
        // A question added in this edit still needs an answer.
        expect(
            findNumericQuestionWithoutAnswer(
                [
                    ...structuredClone(saved),
                    question({ questionId: 'new', questionType: 'NUMERIC' }),
                ],
                saved
            )
        ).toBe(1);
    });

    it('on an edit, catches an answer the teacher cleared', () => {
        const saved = [question({ questionId: 'q', questionType: 'NUMERIC', validAnswers: [275] })];
        const edited = [
            question({
                questionId: 'q',
                questionType: 'NUMERIC',
                validAnswers: [null] as unknown as number[],
            }),
        ];
        expect(findNumericQuestionWithoutAnswer(edited, saved)).toBe(0);
    });
});
