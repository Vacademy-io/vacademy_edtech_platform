import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/sessionUtility', () => ({
    getTokenDecodedData: () => null,
    getTokenFromCookie: () => null,
}));

import { transformSectionQuestions, transformSectionsAndQuestionsData } from './helper';
import { sectionsEditQuestionFormSchema } from './sections-edit-question-form-schema';
import type { CbeConfig } from '@/components/cbe/types';
import type { Section } from '@/types/assessments/assessment-steps';
import type { transformSectionsAndQuestionsDataQuestionsData } from './assessment-details-interface';

const config: CbeConfig = {
    type: 'CBE_RESPONSE',
    data: {
        version: 1,
        gradingNotes: 'Own figure rule',
        parts: [
            {
                id: 'p_aaaaaa',
                label: '(a)',
                kind: 'SPREADSHEET',
                marks: 12,
                solution: { sheet: { sheets: [{ name: 'Sheet1', cells: { B2: { v: 5 } } }] } },
                markingScheme: [{ id: 'm1', label: 'Total', marks: 12 }],
            },
        ],
    },
};

describe('assessment sections: CBE_RESPONSE', () => {
    it('loads the config and the scenario of a CBE question', () => {
        const [section] = transformSectionsAndQuestionsData(
            [{ id: 's1', name: 'Section A' } as unknown as Section],
            {
                s1: [
                    {
                        question_id: 'q-1',
                        question: { content: '<p>Requirement</p>' },
                        parent_rich_text: { content: '<p>Scenario</p>' },
                        question_type: 'CBE_RESPONSE',
                        marking_json: JSON.stringify({
                            type: 'CBE_RESPONSE',
                            data: { totalMark: '12', negativeMark: '0' },
                        }),
                        evaluation_json: JSON.stringify(config),
                        question_duration: 0,
                        options: [],
                        options_with_explanation: [],
                    },
                ],
            } as unknown as transformSectionsAndQuestionsDataQuestionsData
        );
        const question = section?.questions[0] as Record<string, unknown>;
        expect(question.questionType).toBe('CBE_RESPONSE');
        expect(question.cbeConfig).toEqual(config);
        expect(question.parentRichTextContent).toBe('<p>Scenario</p>');
    });

    it('saves an added CBE question with its full config, scenario and response type', () => {
        const {
            questions: [row],
        } = transformSectionQuestions([
            {
                id: '',
                questionId: 'tmp-1',
                questionName: '<p>Requirement</p>',
                questionType: 'CBE_RESPONSE',
                questionPenalty: '0',
                questionMark: '12',
                questionDuration: { hrs: '0', min: '30' },
                parentRichTextContent: '<p>Scenario</p>',
                cbeConfig: config,
            },
        ]);
        expect(JSON.parse(row?.auto_evaluation_json ?? '')).toEqual(config);
        expect(row?.question_response_type).toBe('CBE');
        expect(row?.options).toEqual([]);
        expect(row).toMatchObject({
            parent_rich_text: { type: 'HTML', content: '<p>Scenario</p>' },
        });
    });

    it('does not change how an MCQ is saved', () => {
        const {
            questions: [row],
        } = transformSectionQuestions([
            {
                id: '',
                questionName: '<p>Q</p>',
                questionType: 'MCQS',
                questionPenalty: '0',
                questionMark: '1',
                questionDuration: { hrs: '0', min: '1' },
                singleChoiceOptions: [
                    { name: 'A', isSelected: true },
                    { name: 'B', isSelected: false },
                ],
            },
        ]);
        expect(JSON.parse(row?.auto_evaluation_json ?? '')).toEqual({
            type: 'MCQS',
            data: { correctOptionIds: ['0'] },
        });
        expect(row?.question_response_type).toBeNull();
        expect(row).not.toHaveProperty('parent_rich_text');
    });

    it('keeps cbeConfig through the section form schema', () => {
        const parsed = sectionsEditQuestionFormSchema.parse({
            sections: [
                {
                    questions: [
                        {
                            id: 'q-1',
                            questionName: '<p>Requirement</p>',
                            questionType: 'CBE_RESPONSE',
                            questionPenalty: '0',
                            questionMark: '12',
                            questionDuration: { hrs: '0', min: '0' },
                            cbeConfig: config,
                        },
                    ],
                },
            ],
        });
        expect(parsed.sections[0]?.questions[0]?.cbeConfig).toEqual(config);
    });
});
