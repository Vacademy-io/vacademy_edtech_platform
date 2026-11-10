import { z } from 'zod';
import { isQuillContentEmpty } from './helper';
import { cbeConfigFormSchema, cbeSecretStatusFormSchema } from './cbe-question';

export const questionsFormSchema = z.object({
    questionId: z.string().optional(),
    questionName: z.string().refine((val) => !isQuillContentEmpty(val), {
        message: 'Question name is required',
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
    codingConfig: z
        .object({
            problemHtml: z.string().default(''),
            allowedLanguages: z.array(z.string()).default([]),
            starterCode: z.record(z.string(), z.string()).default({}),
            testCases: z
                .array(
                    z.object({
                        id: z.string(),
                        label: z.string().optional(),
                        stdin: z.string().default(''),
                        expectedStdout: z.string().default(''),
                        acceptedOutputs: z.array(z.string()).optional(),
                        visible: z.boolean().default(true),
                    })
                )
                .default([]),
            perRunLimits: z
                .object({
                    cpuSeconds: z.number().default(2),
                    memoryKb: z.number().default(262144),
                })
                .default({ cpuSeconds: 2, memoryKb: 262144 }),
            maxPoints: z.number().default(10),
            sessionTimeMinutes: z.union([z.number(), z.null()]).optional(),
            evaluationMode: z.enum(['AUTO', 'MANUAL']).default('AUTO'),
        })
        .optional(),
    // CBE_RESPONSE (Spreadsheet & Written Response): kept whole, see cbe-question.ts.
    cbeConfig: cbeConfigFormSchema,
    cbeSecretStatus: cbeSecretStatusFormSchema,
});
