import { z } from 'zod';
import { isQuillContentEmpty } from './helper';

// Helper function to validate single choice questions (MCQS, CMCQS)
const validateSingleChoiceQuestion = (question: any, ctx: z.RefinementCtx, examType: string, optionsPath: string, optionsName: string) => {
    if (!question[optionsPath] || question[optionsPath].length === 0) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${optionsName} questions must have ${optionsPath}`,
            path: [optionsPath],
        });
        return;
    }

    if (question[optionsPath].length < 2) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${optionsName} must have at least 2 options`,
            path: [optionsPath],
        });
    }

    // Skip correct answer validation for survey questions
    if (examType !== 'SURVEY') {
        const selectedCount = question[optionsPath].filter((opt: any) => opt.isSelected).length;
        if (selectedCount !== 1) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `${optionsName} must have exactly one option selected`,
                path: [optionsPath],
            });
        }
    }

    question[optionsPath].forEach((opt: any, index: number) => {
        if (!opt?.name?.trim()) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Option ${index + 1} is required`,
                path: [optionsPath, index, 'name'],
            });
        }
    });
};

// Helper function to validate multiple choice questions (MCQM, CMCQM)
const validateMultipleChoiceQuestion = (question: any, ctx: z.RefinementCtx, examType: string, optionsPath: string, optionsName: string) => {
    if (!question[optionsPath] || question[optionsPath].length === 0) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${optionsName} questions must have ${optionsPath}`,
            path: [optionsPath],
        });
        return;
    }

    if (question[optionsPath].length < 2) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${optionsName} must have at least 2 options`,
            path: [optionsPath],
        });
    }

    // Skip correct answer validation for survey questions
    if (examType !== 'SURVEY') {
        const selectedCount = question[optionsPath].filter((opt: any) => opt.isSelected).length;
        if (selectedCount < 1) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `${optionsName} must have at least one option selected`,
                path: [optionsPath],
            });
        }
    }

    question[optionsPath].forEach((opt: any, index: number) => {
        if (!opt.name?.trim()) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Option ${index + 1} is required`,
                path: [optionsPath, index, 'name'],
            });
        }
    });
};

// Helper function to validate true/false questions
const validateTrueFalseQuestion = (question: any, ctx: z.RefinementCtx, examType: string) => {
    if (!question.trueFalseOptions || question.trueFalseOptions.length === 0) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'TRUE_FALSE questions must have trueFalseOptions',
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

    // Skip correct answer validation for survey questions
    if (examType !== 'SURVEY') {
        const selectedCount = question.trueFalseOptions.filter((opt: any) => opt.isSelected).length;
        if (selectedCount !== 1) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'TRUE_FALSE must have exactly one option selected',
                path: ['trueFalseOptions'],
            });
        }
    }

    question.trueFalseOptions.forEach((opt: any, index: number) => {
        if (!opt?.name?.trim()) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Option ${index + 1} is required`,
                path: ['trueFalseOptions', index, 'name'],
            });
        }
    });
};

// Helper function to validate numeric questions
const validateNumericQuestion = (question: any, ctx: z.RefinementCtx, examType: string, questionType: string) => {
    if (!question.validAnswers || !Array.isArray(question.validAnswers)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${questionType} questions must have validAnswers`,
            path: ['validAnswers'],
        });
        return;
    }

    // Skip correct answer validation for survey questions
    if (examType !== 'SURVEY') {
        if (question.validAnswers.length === 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `${questionType} questions must have at least one valid answer`,
                path: ['validAnswers'],
            });
        }
    }
};

// Helper function to validate subjective questions
const validateSubjectiveQuestion = (question: any, ctx: z.RefinementCtx, examType: string, questionType: string) => {
    // Skip correct answer validation for survey questions
    if (examType !== 'SURVEY') {
        if (!question.subjectiveAnswerText || !question.subjectiveAnswerText.trim()) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `${questionType} questions must have a correct answer`,
                path: ['subjectiveAnswerText'],
            });
        }
    }
};

// Helper function to validate numeric type constraints
const validateNumericTypeConstraints = (question: any, ctx: z.RefinementCtx) => {
    const { numericType, validAnswers } = question;

    if (!validAnswers || !Array.isArray(validAnswers)) return;

    const typeChecks: Record<string, (n: number) => boolean> = {
        SINGLE_DIGIT_NON_NEGATIVE_INTEGER: (n) => Number.isInteger(n) && n >= 0 && n <= 9,
        INTEGER: (n) => Number.isInteger(n),
        POSITIVE_INTEGER: (n) => Number.isInteger(n) && n > 0,
        DECIMAL: (n) => typeof n === 'number',
    };

    const check = numericType ? typeChecks[numericType] : undefined;

    // Empty answer boxes are null and are dropped on save; check only what is typed.
    const typedAnswers = validAnswers.filter(
        (answer: unknown) => answer !== null && answer !== ''
    );

    if (check && !typedAnswers.every(check)) {
        ctx.addIssue({
            path: ['validAnswers'],
            code: z.ZodIssueCode.custom,
            message: `Not correct answer type is entered ${numericType}`,
        });
    }
};

// Main validation function that routes to specific validators
const validateQuestionByType = (question: any, ctx: z.RefinementCtx, examType: string) => {
    switch (question.questionType) {
        case 'MCQS':
            validateSingleChoiceQuestion(question, ctx, examType, 'singleChoiceOptions', 'MCQS');
            break;
        case 'MCQM':
            validateMultipleChoiceQuestion(question, ctx, examType, 'multipleChoiceOptions', 'MCQM');
            break;
        case 'CMCQS':
            validateSingleChoiceQuestion(question, ctx, examType, 'csingleChoiceOptions', 'CMCQS');
            break;
        case 'CMCQM':
            validateMultipleChoiceQuestion(question, ctx, examType, 'cmultipleChoiceOptions', 'CMCQM');
            break;
        case 'TRUE_FALSE':
            validateTrueFalseQuestion(question, ctx, examType);
            break;
        case 'NUMERIC':
            validateNumericQuestion(question, ctx, examType, 'NUMERIC');
            break;
        case 'CNUMERIC':
            validateNumericQuestion(question, ctx, examType, 'CNUMERIC');
            break;
        case 'ONE_WORD':
            validateSubjectiveQuestion(question, ctx, examType, 'ONE_WORD');
            break;
        case 'LONG_ANSWER':
            validateSubjectiveQuestion(question, ctx, examType, 'LONG_ANSWER');
            break;
    }

    // Validate numeric type constraints for all question types
    validateNumericTypeConstraints(question, ctx);
};

export const uploadQuestionPaperFormSchema = (examType?: string) => {
    return z.object({
    questionPaperId: z
        .string({
            required_error: 'Question Paper ID is required',
            invalid_type_error: 'Question Paper ID must be a number',
        })
        .optional(),
    isFavourite: z.boolean().default(false),
    title: z.string({
        required_error: 'Title is required',
        invalid_type_error: 'Title must be a string',
    }),
    createdOn: z.date().default(() => new Date()),
    yearClass: z.string({
        required_error: 'Year/Class is required',
        invalid_type_error: 'Year/Class must be a string',
    }).optional(),
    subject: z.string({
        required_error: 'Subject is required',
        invalid_type_error: 'Subject must be a string',
    }).optional(),
    questionsType: z.string({
        required_error: 'Question field is required',
        invalid_type_error: 'Question field must be a string',
    }),
    optionsType: z.string({
        required_error: 'Option field is required',
        invalid_type_error: 'Option field must be a string',
    }),
    answersType: z.string({
        required_error: 'Answer field is required',
        invalid_type_error: 'Answer field must be a string',
    }),
    explanationsType: z.string({
        required_error: 'Explanation field is required',
        invalid_type_error: 'Explanation field must be a string',
    }),
    fileUpload: z
        .instanceof(File, {
            message: 'File upload is required and must be a valid file',
        })
        .optional(),
    questions: z.array(
        z
            .object({
                id: z.string().optional(),
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
                tags: z.array(z.string()).optional(),
                level: z.string().optional(),
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
                        (value) => (Array.isArray(value) ? value.filter((a) => a !== null) : value),
                        z.union([z.array(z.union([z.number(), z.string()])), z.null()])
                    )
                    .optional(),
                questionResponseType: z.union([z.string(), z.null()]).optional(),
                subjectiveAnswerText: z.string().optional(),
                questionPoints: z.string().optional(),
                reattemptCount: z.string().optional(),
                timestamp: z.string().optional(),
                newQuestion: z.boolean().optional(),
                status: z.string().optional(),
                canSkip: z.boolean().optional(),
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
                validateQuestionByType(question, ctx, examType || 'EXAM');
            })
    ),
});
};
