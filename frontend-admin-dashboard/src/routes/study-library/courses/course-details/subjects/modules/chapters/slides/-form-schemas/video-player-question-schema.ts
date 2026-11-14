import { isQuillContentEmpty } from '@/routes/assessment/question-papers/-utils/helper';
import { z } from 'zod';
import type { TFunction } from 'i18next';
import i18n from '@/i18n';

const NAMESPACE = 'studyLibraryVideoPlayerQuestionSchema';

/**
 * Module-scope zod schema whose shape is consumed via `z.infer` at several
 * call sites, so it can't be converted to a `buildXxx(t)` factory without
 * touching every type-inference consumer. Uses the shared i18next singleton
 * directly, same fallback as sibling schema.ts / bulkSchema.ts.
 */
const t: TFunction = ((key: string, options?: Record<string, unknown>) =>
    i18n.t(key, { ns: NAMESPACE, ...options })) as TFunction;

export const videoPlayerQuestionSchema = z.object({
    id: z.string().optional(),
    questionId: z.string().optional(),
    questionName: z.string().refine((val) => !isQuillContentEmpty(val), {
        message: t('validation.questionNameRequired'),
    }),
    explanation: z.string().optional(),
    questionType: z.string().default('MCQS'),
    questionPenalty: z.string(),
    questionDuration: z.object({
        hrs: z.string(),
        min: z.string(),
    }),
    questionMark: z.string(),
    singleChoiceOptions: z
        .array(
            z.object({
                id: z.string().optional(),
                name: z.string().optional(),
                isSelected: z.boolean().optional(),
            })
        )
        .optional(),
    multipleChoiceOptions: z
        .array(
            z.object({
                id: z.string().optional(),
                name: z.string().optional(),
                isSelected: z.boolean().optional(),
            })
        )
        .optional(),
    csingleChoiceOptions: z
        .array(
            z.object({
                id: z.string().optional(),
                name: z.string().optional(),
                isSelected: z.boolean().optional(),
            })
        )
        .optional(),
    cmultipleChoiceOptions: z
        .array(
            z.object({
                id: z.string().optional(),
                name: z.string().optional(),
                isSelected: z.boolean().optional(),
            })
        )
        .optional(),
    trueFalseOptions: z
        .array(
            z.object({
                id: z.string().optional(),
                name: z.string().optional(),
                isSelected: z.boolean().optional(),
            })
        )
        .optional(),
    parentRichTextContent: z.union([z.string(), z.null()]).optional(),
    decimals: z.number().optional(),
    numericType: z.string().optional(),
    validAnswers: z.union([z.array(z.number()), z.null()]).optional(),
    questionResponseType: z.union([z.string(), z.null()]).optional(),
    subjectiveAnswerText: z.string().optional(),
    questionPoints: z.string().optional(),
    reattemptCount: z.string().optional(),
});

export type VideoPlayerQuestionFormType = z.infer<typeof videoPlayerQuestionSchema>;
