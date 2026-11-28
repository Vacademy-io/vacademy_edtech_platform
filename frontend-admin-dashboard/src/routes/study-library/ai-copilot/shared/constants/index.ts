import type { TFunction } from 'i18next';
import { QuizQuestion } from '../types';

/**
 * Sample quiz shown as placeholder content in the AI course-outline preview
 * (generating/index.tsx) before real quiz content is generated/loaded, and as
 * the fallback quiz payload in mockSlideContent.ts. This is a module-scope
 * constant consumed from more than one file, so it's a `buildXxx(t)` factory
 * rather than a component-bound `useTranslation()` call — each caller passes
 * its own bound `t`; the namespace is pinned explicitly per-key (same pattern
 * as `studyLibraryOptions` in live-session/schedule/-constants/options.ts) so
 * it resolves correctly regardless of the caller's own default namespace.
 */
const NAMESPACE = 'studyLibraryDefaultQuizQuestions';

/** Correct-answer index for each sample question, in order. Kept separate from
 * the (translated) question/option text so `buildDefaultSelectedAnswers` never
 * needs a `t`. */
const CORRECT_ANSWER_INDICES = [1, 1, 0] as const;

export const buildDefaultQuizQuestions = (t: TFunction): QuizQuestion[] => [
    {
        question: t('q1.question', { ns: NAMESPACE }),
        options: [
            t('q1.options.0', { ns: NAMESPACE }),
            t('q1.options.1', { ns: NAMESPACE }),
            t('q1.options.2', { ns: NAMESPACE }),
            t('q1.options.3', { ns: NAMESPACE }),
        ],
        correctAnswerIndex: CORRECT_ANSWER_INDICES[0],
    },
    {
        question: t('q2.question', { ns: NAMESPACE }),
        options: [
            t('q2.options.0', { ns: NAMESPACE }),
            t('q2.options.1', { ns: NAMESPACE }),
            t('q2.options.2', { ns: NAMESPACE }),
            t('q2.options.3', { ns: NAMESPACE }),
        ],
        correctAnswerIndex: CORRECT_ANSWER_INDICES[1],
    },
    {
        question: t('q3.question', { ns: NAMESPACE }),
        options: [
            t('q3.options.0', { ns: NAMESPACE }),
            t('q3.options.1', { ns: NAMESPACE }),
            t('q3.options.2', { ns: NAMESPACE }),
            t('q3.options.3', { ns: NAMESPACE }),
        ],
        correctAnswerIndex: CORRECT_ANSWER_INDICES[2],
    },
];

export const buildDefaultSelectedAnswers = (
    questions: QuizQuestion[] = []
): Record<number, string> =>
    questions.reduce(
        (acc, question, index) => {
            if (question.correctAnswerIndex !== undefined) {
                acc[index] = question.correctAnswerIndex.toString();
            }
            return acc;
        },
        {} as Record<number, string>
    );

export const DEFAULT_SOLUTION_CODE = `// Sample solution implementation
function solveHomeworkProblem(input) {
    // Replace this with the real solution logic
    const processed = input.map((value) => value * 2);
    return processed;
}

const sampleInput = [1, 2, 3, 4];
const output = solveHomeworkProblem(sampleInput);

console.log('Input:', sampleInput);
console.log('Output:', output);`;
