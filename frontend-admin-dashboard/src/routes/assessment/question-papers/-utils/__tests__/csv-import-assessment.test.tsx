/**
 * The assessment "Upload CSV / Excel" card reuses the quiz's sheet reader and
 * then saves through the assessment's question-paper path. This drives the real
 * dialog and feeds what it produces through that path — the checks a document
 * upload goes through, the paper form schema, and the payload sent to the
 * backend — so a sheet that works for a quiz also saves as an assessment paper.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import QuizAddViaCSVDialog from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-components/quiz/components/QuizAddViaCSVDialog';
import { validateUploadedQuestions } from '../validate-uploaded-questions';
import { uploadQuestionPaperFormSchema } from '../upload-question-paper-form-schema';
import { transformQuestionPaperData } from '../helper';
import type {
    MyQuestion,
    MyQuestionPaperFormInterface,
} from '@/types/assessments/question-paper-form';

const HEADER =
    'question_text,question_type,option_a,option_b,option_c,option_d,correct_answer,explanation';

const ROWS = [
    'What is 2 + 2?,MCQS,1,2,4,8,C,2 + 2 equals 4.',
    'Which of these are prime numbers?,MCQM,2,3,4,6,"A,B",Both 2 and 3 are prime.',
    'Is the Earth flat?,TRUE_FALSE,True,False,,,B,The Earth is an oblate spheroid.',
];

afterEach(cleanup);

/** What the Step 2 card hands to the review dialog: the parsed rows, numbered. */
const readSheet = async (rows: string[]): Promise<MyQuestion[]> => {
    const onQuestionsReady = vi.fn();
    render(
        <QuizAddViaCSVDialog open onOpenChange={() => {}} onQuestionsReady={onQuestionsReady} />
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([[HEADER, ...rows].join('\n')], 'paper.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });
    // The button label is translated; the test environment shows its key.
    fireEvent.click(screen.getByRole('button', { name: /parseAndPreview|Parse & Preview/i }));
    await waitFor(() => expect(onQuestionsReady).toHaveBeenCalled());
    const parsed = onQuestionsReady.mock.calls[0]![0] as MyQuestion[];
    return parsed.map((q, i) => ({ ...q, questionId: q.questionId || String(i + 1) }));
};

describe('Assessment CSV import — saves through the question-paper path', () => {
    it('passes the same checks a document upload goes through', async () => {
        const questions = await readSheet(ROWS);
        expect(questions.map((q) => q.questionType)).toEqual(['MCQS', 'MCQM', 'TRUE_FALSE']);
        expect(validateUploadedQuestions(questions, 'EXAM')).toEqual([]);
    });

    it('is a valid question-paper form once titled', async () => {
        const questions = await readSheet(ROWS);
        const result = uploadQuestionPaperFormSchema('EXAM').safeParse({
            questionPaperId: '1',
            isFavourite: false,
            title: 'Unit test paper',
            createdOn: new Date(),
            yearClass: '',
            subject: '',
            questionsType: '(1.)',
            optionsType: '(a.)',
            answersType: 'Ans:',
            explanationsType: 'Exp:',
            fileUpload: undefined,
            questions,
        });
        expect(result.success ? [] : result.error.issues).toEqual([]);
    });

    it('builds the backend payload with the right types and correct options', async () => {
        const questions = await readSheet(ROWS);
        const payload = transformQuestionPaperData({
            title: 'Unit test paper',
            questions,
        } as unknown as MyQuestionPaperFormInterface) as unknown as {
            questions: Array<{
                preview_id: string;
                question_type: string;
                options: Array<{ text: { content: string } }>;
                auto_evaluation_json: string;
            }>;
        };
        const [mcqs, mcqm, tf] = payload.questions;
        expect(payload.questions.map((q) => q.preview_id)).toEqual(['1', '2', '3']);
        expect(mcqs!.options.map((o) => o.text.content)).toEqual(['1', '2', '4', '8']);
        expect(JSON.parse(mcqs!.auto_evaluation_json).data.correctOptionIds).toEqual(['2']);
        expect(JSON.parse(mcqm!.auto_evaluation_json).data.correctOptionIds).toEqual(['0', '1']);
        expect(JSON.parse(tf!.auto_evaluation_json).data.correctOptionIds).toEqual(['1']);
    });
});
