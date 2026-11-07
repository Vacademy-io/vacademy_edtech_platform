import { isQuillContentEmpty } from '@/routes/assessment/question-papers/-utils/helper';
import { z } from 'zod';

export const sectionsEditQuestionFormSchema = z.object({
    sections: z.array(
        z.object({
            sectionId: z.string().optional(),
            sectionName: z.string().optional(),
            questions: z.array(
                z
                    .object({
                        id: z.string(),
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
                        // An answer box left empty is null in the form; drop it before validating.
                        validAnswers: z
                            .preprocess(
                                (value) =>
                                    Array.isArray(value)
                                        ? value.filter((answer) => answer !== null)
                                        : value,
                                z.union([z.array(z.number()), z.null()])
                            )
                            .optional(),
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
                    })
                    .superRefine((question, ctx) => {
                        // Validate based on question type
                        if (question.questionType === 'MCQS') {
                            // Validate singleChoiceOptions when type is MCQS
                            if (
                                !question.singleChoiceOptions ||
                                question.singleChoiceOptions.length === 0
                            ) {
                                ctx.addIssue({
                                    code: z.ZodIssueCode.custom,
                                    message: 'MCQS questions must have singleChoiceOptions',
                                    path: ['singleChoiceOptions'],
                                });
                                return;
                            }

                            if (question.singleChoiceOptions.length !== 4) {
                                ctx.addIssue({
                                    code: z.ZodIssueCode.custom,
                                    message: 'MCQS must have exactly 4 options',
                                    path: ['singleChoiceOptions'],
                                });
                            }

                            const selectedCount = question.singleChoiceOptions.filter(
                                (opt) => opt.isSelected
                            ).length;
                            if (selectedCount !== 1) {
                                ctx.addIssue({
                                    code: z.ZodIssueCode.custom,
                                    message: 'MCQS must have exactly one option selected',
                                    path: ['singleChoiceOptions'],
                                });
                            }

                            question.singleChoiceOptions.forEach((opt, index) => {
                                if (!opt?.name?.trim()) {
                                    ctx.addIssue({
                                        code: z.ZodIssueCode.custom,
                                        message: `Option ${index + 1} is required`,
                                        path: ['singleChoiceOptions', index, 'name'],
                                    });
                                }
                            });
                        } else if (question.questionType === 'MCQM') {
                            // Validate multipleChoiceOptions when type is MCQM
                            if (
                                !question.multipleChoiceOptions ||
                                question.multipleChoiceOptions.length === 0
                            ) {
                                ctx.addIssue({
                                    code: z.ZodIssueCode.custom,
                                    message: 'MCQM questions must have multipleChoiceOptions',
                                    path: ['multipleChoiceOptions'],
                                });
                                return;
                            }

                            if (question.multipleChoiceOptions.length !== 4) {
                                ctx.addIssue({
                                    code: z.ZodIssueCode.custom,
                                    message: 'MCQM must have exactly 4 options',
                                    path: ['multipleChoiceOptions'],
                                });
                            }

                            const selectedCount = question.multipleChoiceOptions.filter(
                                (opt) => opt.isSelected
                            ).length;
                            if (selectedCount < 1) {
                                ctx.addIssue({
                                    code: z.ZodIssueCode.custom,
                                    message: 'MCQM must have at least one option selected',
                                    path: ['multipleChoiceOptions'],
                                });
                            }

                            question.multipleChoiceOptions.forEach((opt, index) => {
                                if (!opt.name?.trim()) {
                                    ctx.addIssue({
                                        code: z.ZodIssueCode.custom,
                                        message: `Option ${index + 1} is required`,
                                        path: ['multipleChoiceOptions', index, 'name'],
                                    });
                                }
                            });
                        } else if (question.questionType === 'CMCQS') {
                            // Validate singleChoiceOptions when type is MCQS
                            if (
                                !question.csingleChoiceOptions ||
                                question.csingleChoiceOptions.length === 0
                            ) {
                                ctx.addIssue({
                                    code: z.ZodIssueCode.custom,
                                    message: 'CMCQS questions must have singleChoiceOptions',
                                    path: ['singleChoiceOptions'],
                                });
                                return;
                            }

                            if (question.csingleChoiceOptions.length !== 4) {
                                ctx.addIssue({
                                    code: z.ZodIssueCode.custom,
                                    message: 'CMCQS must have exactly 4 options',
                                    path: ['csingleChoiceOptions'],
                                });
                            }

                            const selectedCount = question.csingleChoiceOptions.filter(
                                (opt) => opt.isSelected
                            ).length;
                            if (selectedCount !== 1) {
                                ctx.addIssue({
                                    code: z.ZodIssueCode.custom,
                                    message: 'CMCQS must have exactly one option selected',
                                    path: ['csingleChoiceOptions'],
                                });
                            }

                            question.csingleChoiceOptions.forEach((opt, index) => {
                                if (!opt?.name?.trim()) {
                                    ctx.addIssue({
                                        code: z.ZodIssueCode.custom,
                                        message: `Option ${index + 1} is required`,
                                        path: ['csingleChoiceOptions', index, 'name'],
                                    });
                                }
                            });
                        } else if (question.questionType === 'CMCQM') {
                            // Validate multipleChoiceOptions when type is MCQM
                            if (
                                !question.cmultipleChoiceOptions ||
                                question.cmultipleChoiceOptions.length === 0
                            ) {
                                ctx.addIssue({
                                    code: z.ZodIssueCode.custom,
                                    message: 'CMCQM questions must have multipleChoiceOptions',
                                    path: ['cmultipleChoiceOptions'],
                                });
                                return;
                            }

                            if (question.cmultipleChoiceOptions.length !== 4) {
                                ctx.addIssue({
                                    code: z.ZodIssueCode.custom,
                                    message: 'CMCQM must have exactly 4 options',
                                    path: ['cmultipleChoiceOptions'],
                                });
                            }

                            const selectedCount = question.cmultipleChoiceOptions.filter(
                                (opt) => opt.isSelected
                            ).length;
                            if (selectedCount < 1) {
                                ctx.addIssue({
                                    code: z.ZodIssueCode.custom,
                                    message: 'CMCQM must have at least one option selected',
                                    path: ['cmultipleChoiceOptions'],
                                });
                            }

                            question.cmultipleChoiceOptions.forEach((opt, index) => {
                                if (!opt.name?.trim()) {
                                    ctx.addIssue({
                                        code: z.ZodIssueCode.custom,
                                        message: `Option ${index + 1} is required`,
                                        path: ['cmultipleChoiceOptions', index, 'name'],
                                    });
                                }
                            });
                        } else if (question.questionType === 'TRUE_FALSE') {
                            // Validate singleChoiceOptions when type is MCQS
                            if (
                                !question.trueFalseOptions ||
                                question.trueFalseOptions.length === 0
                            ) {
                                ctx.addIssue({
                                    code: z.ZodIssueCode.custom,
                                    message: 'TRUE_FALSE questions must have singleChoiceOptions',
                                    path: ['trueFalseOptions'],
                                });
                                return;
                            }

                            if (question.trueFalseOptions.length !== 2) {
                                ctx.addIssue({
                                    code: z.ZodIssueCode.custom,
                                    message: 'TRUE_FALSE must have exactly 2 options',
                                    path: ['trueFalseOptions'],
                                });
                            }

                            const selectedCount = question.trueFalseOptions.filter(
                                (opt) => opt.isSelected
                            ).length;
                            if (selectedCount !== 1) {
                                ctx.addIssue({
                                    code: z.ZodIssueCode.custom,
                                    message: 'TRUE_FALSE must have exactly one option selected',
                                    path: ['trueFalseOptions'],
                                });
                            }

                            question.trueFalseOptions.forEach((opt, index) => {
                                if (!opt?.name?.trim()) {
                                    ctx.addIssue({
                                        code: z.ZodIssueCode.custom,
                                        message: `Option ${index + 1} is required`,
                                        path: ['trueFalseOptions', index, 'name'],
                                    });
                                }
                            });
                        }

                        const { numericType, validAnswers } = question;

                        if (!validAnswers || !Array.isArray(validAnswers)) return;
                        const typeChecks: Record<string, (n: number) => boolean> = {
                            SINGLE_DIGIT_NON_NEGATIVE_INTEGER: (n) =>
                                Number.isInteger(n) && n >= 0 && n <= 9,
                            INTEGER: (n) => Number.isInteger(n),
                            POSITIVE_INTEGER: (n) => Number.isInteger(n) && n > 0,
                            DECIMAL: (n) => typeof n === 'number',
                        };

                        const check = numericType ? typeChecks[numericType] : undefined;

                        if (check && !validAnswers.every(check)) {
                            ctx.addIssue({
                                path: ['validAnswers'],
                                code: z.ZodIssueCode.custom,
                                message: `Not correct answer type is entered ${numericType}`,
                            });
                        }
                    })
            ),
        })
    ),
});
