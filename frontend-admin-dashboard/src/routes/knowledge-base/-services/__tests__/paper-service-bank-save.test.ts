import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
vi.mock('@/lib/auth/axiosInstance', () => ({ default: { post: (...args: unknown[]) => post(...args) } }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('@/constants/urls', () => ({ AI_SERVICE_BASE_URL: 'http://ai', ADD_QUESTION_PAPER: 'http://bank/add' }));

import { savePaperToQuestionBank } from '../paper-service';
import type { PaperQuestion } from '../../-types/paper';

const question = (over: Partial<PaperQuestion>): PaperQuestion =>
    ({
        question_type: 'LONG_ANSWER',
        text: { id: null, type: 'HTML', content: 'Q' },
        auto_evaluation_json: '{"type":"LONG_ANSWER","data":{}}',
        ...over,
    }) as PaperQuestion;

/**
 * The bank keeps explanations in a NOT NULL column and the question builder
 * sends "" for none. On 2026-09-20 a digitised paper (no explanations, content
 * null) had all 64 questions refused with a 500 — this pins the guard.
 */
describe('savePaperToQuestionBank', () => {
    beforeEach(() => {
        post.mockReset();
        post.mockResolvedValue({ data: { saved_question_paper_id: 'qp-1' } });
    });

    it('turns a null explanation into an empty one and leaves real ones alone', async () => {
        await savePaperToQuestionBank({
            title: 'T',
            questions: [
                question({ explanation_text: { id: null, type: 'HTML', content: null } }),
                question({ explanation_text: { id: null, type: 'HTML', content: 'because' } }),
                question({ explanation_text: undefined }),
            ],
        });
        const body = post.mock.calls[0]?.[1] as { questions: PaperQuestion[] };
        expect(body.questions.map((q) => q.explanation_text?.content)).toEqual(['', 'because', undefined]);
    });

    it('still adds the camelCase option key Java binds', async () => {
        await savePaperToQuestionBank({
            title: 'T',
            questions: [
                question({
                    question_type: 'MCQS',
                    auto_evaluation_json: '{"type":"MCQS","data":{"correct_option_ids":["2"]}}',
                    explanation_text: { id: null, type: 'HTML', content: null },
                }),
            ],
        });
        const body = post.mock.calls[0]?.[1] as { questions: PaperQuestion[] };
        expect(JSON.parse(body.questions[0]!.auto_evaluation_json as string).data.correctOptionIds).toEqual(['2']);
        expect(body.questions[0]!.explanation_text?.content).toBe('');
    });

    /**
     * A digitised maths paper (SN Class 9, 2026-09-22) went into the bank with
     * its LaTeX source — "$2 \mathrm{x}-5 \mathrm{y}=7$" — and showed that
     * way in the assessment. The bank's convention is the editor's math node.
     */
    it('typesets delimited LaTeX into the bank\'s math node, on questions, options and explanations', async () => {
        await savePaperToQuestionBank({
            title: 'T',
            questions: [
                question({
                    question_type: 'MCQS',
                    text: {
                        id: null,
                        type: 'HTML',
                        content: '<p>The linear equation $2 \\mathrm{x}-5 \\mathrm{y}=7$ has:</p>',
                    },
                    options: [
                        { text: { id: null, type: 'HTML', content: '<p>$x=1$ only</p>' } },
                        { text: { id: null, type: 'HTML', content: '<p>No solution</p>' } },
                    ],
                    explanation_text: { id: null, type: 'HTML', content: 'Since $x^2 \\ge 0$.' },
                }),
                question({ text: { id: null, type: 'HTML', content: '<p>Costs $5 and $10 each.</p>' } }),
            ],
        });
        const body = post.mock.calls[0]?.[1] as { questions: PaperQuestion[] };
        const [maths, prose] = body.questions;
        const text = maths!.text!.content!;
        expect(text).toContain('class="math-inline"');
        expect(text).toContain('data-latex="2 \\mathrm{x}-5 \\mathrm{y}=7"');
        expect(text).not.toContain('$2');
        expect(text.startsWith('<p>The linear equation ')).toBe(true);
        expect(maths!.options![0]!.text!.content).toContain('data-latex="x=1"');
        expect(maths!.options![1]!.text!.content).toBe('<p>No solution</p>');
        expect(maths!.explanation_text!.content).toContain('data-latex="x^2 \\ge 0"');
        // Prose with dollar amounts is not maths and is left exactly as sent.
        expect(prose!.text!.content).toBe('<p>Costs $5 and $10 each.</p>');
    });
});
