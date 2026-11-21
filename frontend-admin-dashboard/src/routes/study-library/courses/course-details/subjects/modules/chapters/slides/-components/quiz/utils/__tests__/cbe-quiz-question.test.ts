import { describe, expect, it } from 'vitest';
import { createQuizSlidePayload, cbeQuizQuestionFields } from '../api-helpers';
import { transformQuestion } from '../question-transformer';
import type { Slide } from '../../types';

const FULL_CONFIG = {
    type: 'CBE_RESPONSE',
    data: {
        version: 1,
        gradingNotes: 'own figure rule',
        parts: [
            {
                id: 'p_a',
                label: '(a)',
                promptHtml: '',
                kind: 'SPREADSHEET',
                marks: 6,
                template: null,
                solution: { html: '<p>model answer</p>' },
                markingScheme: [{ id: 'm1', label: 'Goodwill', marks: 6 }],
                solutionFileId: null,
            },
            {
                id: 'p_b',
                label: '(b)',
                promptHtml: '',
                kind: 'DOCUMENT',
                marks: 4,
                template: null,
                solution: null,
                markingScheme: [],
                solutionFileId: null,
            },
        ],
    },
};

const REDACTED_JSON = JSON.stringify({
    type: 'CBE_RESPONSE',
    data: {
        version: 1,
        parts: [
            { id: 'p_a', label: '(a)', promptHtml: '', kind: 'SPREADSHEET', marks: 6, template: null },
            { id: 'p_b', label: '(b)', promptHtml: '', kind: 'DOCUMENT', marks: 4, template: null },
        ],
    },
});

const slide = {
    id: 'slide-1',
    source_id: 'quiz-src',
    source_type: 'QUIZ',
    title: 'Quiz 1',
    image_file_id: '',
    description: '',
    status: 'DRAFT',
    slide_order: 1,
    quiz_slide: {
        id: 'quiz-1',
        title: 'Quiz 1',
        description: { id: '', content: '', type: 'TEXT' },
        questions: [],
    },
    is_loaded: true,
    new_slide: false,
} as Slide;

const formQuestion = (secretStatus?: 'owned' | 'loading' | 'failed') =>
    ({
        id: 'q-cbe',
        questionName: '<p>Prepare the SFP.</p>',
        questionType: 'CBE_RESPONSE',
        questionPenalty: '0',
        questionDuration: { hrs: '0', min: '0' },
        questionMark: '10',
        parentRichTextContent: '<p>P acquired S.</p>',
        cbeConfig: FULL_CONFIG,
        cbeSecretStatus: secretStatus,
    }) as never;

describe('quiz CBE question payload', () => {
    it('sends the redacted config and, when the editor owns it, the solution half', () => {
        const payload = createQuizSlidePayload([formQuestion('owned')], slide);
        const question = payload.quiz_slide?.questions?.[0] as unknown as
            | Record<string, unknown>
            | undefined;

        expect(question?.question_type).toBe('CBE_RESPONSE');
        expect(question?.question_response_type).toBe('CBE');
        expect(question?.options).toEqual([]);
        expect(question?.marks).toBe(10);
        expect((question?.parent_rich_text as { content?: string } | undefined)?.content).toBe(
            '<p>P acquired S.</p>'
        );
        const config = String(question?.auto_evaluation_json);
        expect(config).not.toContain('model answer');
        expect(config).not.toContain('markingScheme');
        expect(config).not.toContain('own figure rule');
        const secret = JSON.parse(String(question?.evaluation_secret_json));
        expect(secret.gradingNotes).toBe('own figure rule');
        expect(secret.parts?.[0]?.solution?.html).toBe('<p>model answer</p>');
    });

    it('sends no solution half when the editor never loaded it, so the stored one is kept', () => {
        for (const status of [undefined, 'loading', 'failed'] as const) {
            const fields = cbeQuizQuestionFields(formQuestion(status));
            expect(fields?.evaluation_secret_json).toBeUndefined();
            expect(fields?.auto_evaluation_json).not.toContain('model answer');
        }
    });

    it('rebuilds a question read straight from the slide JSON without losing its parts', () => {
        const fields = cbeQuizQuestionFields({
            question_type: 'CBE_RESPONSE',
            auto_evaluation_json: REDACTED_JSON,
            marks: 10,
        });
        expect(fields?.evaluation_secret_json).toBeUndefined();
        expect(JSON.parse(String(fields?.auto_evaluation_json)).data.parts).toHaveLength(2);
        expect(fields?.marks).toBe(10);
    });

    it('leaves every other question type alone', () => {
        expect(cbeQuizQuestionFields({ questionType: 'MCQS' })).toBeNull();
    });
});

describe('quiz CBE question load', () => {
    it('reads the config, scenario and marks from the slide JSON, solution not yet loaded', () => {
        const transformed = transformQuestion({
            id: 'q-cbe',
            question_type: 'CBE_RESPONSE',
            text: { content: '<p>Prepare the SFP.</p>' },
            parent_rich_text: { content: '<p>P acquired S.</p>' },
            auto_evaluation_json: REDACTED_JSON,
            marks: 10,
            options: [],
        });

        expect(transformed.cbeConfig?.data.parts).toHaveLength(2);
        expect(transformed.cbeSecretStatus).toBeUndefined();
        expect(transformed.parentRichTextContent).toBe('<p>P acquired S.</p>');
        expect(transformed.questionName).toBe('<p>Prepare the SFP.</p>');
        expect(transformed.questionMark).toBe('10');
        expect(transformed.marks).toBe(10);
        expect(transformed.validAnswers).toBeUndefined();
    });

    it('keeps a form question as it is, solution and secret status included', () => {
        const transformed = transformQuestion(formQuestion('owned'));

        expect(transformed.cbeSecretStatus).toBe('owned');
        expect(JSON.stringify(transformed.cbeConfig)).toContain('model answer');
    });
});
