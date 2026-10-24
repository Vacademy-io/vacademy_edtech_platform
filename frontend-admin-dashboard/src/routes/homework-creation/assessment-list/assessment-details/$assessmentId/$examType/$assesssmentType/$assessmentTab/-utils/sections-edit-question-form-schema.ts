import { isQuillContentEmpty } from '@/routes/assessment/question-papers/-utils/helper';
import { z } from 'zod';
import type { TFunction } from 'i18next';

export const buildSectionsEditQuestionFormSchema = (t: TFunction) =>
    z.object({
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
                                message: t(
                                    'homeworkCreationSectionsEditQuestionFormSchema:questionNameRequired'
                                ),
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
                                        message: t(
                                            'homeworkCreationSectionsEditQuestionFormSchema:mcqs.optionsRequired'
                                        ),
                                        path: ['singleChoiceOptions'],
                                    });
                                    return;
                                }

                                if (question.singleChoiceOptions.length !== 4) {
                                    ctx.addIssue({
                                        code: z.ZodIssueCode.custom,
                                        message: t(
                                            'homeworkCreationSectionsEditQuestionFormSchema:mcqs.exactlyFourOptions'
                                        ),
                                        path: ['singleChoiceOptions'],
                                    });
                                }

                                const selectedCount = question.singleChoiceOptions.filter(
                                    (opt) => opt.isSelected
                                ).length;
                                if (selectedCount !== 1) {
                                    ctx.addIssue({
                                        code: z.ZodIssueCode.custom,
                                        message: t(
                                            'homeworkCreationSectionsEditQuestionFormSchema:mcqs.exactlyOneSelected'
                                        ),
                                        path: ['singleChoiceOptions'],
                                    });
                                }

                                question.singleChoiceOptions.forEach((opt, index) => {
                                    if (!opt?.name?.trim()) {
                                        ctx.addIssue({
                                            code: z.ZodIssueCode.custom,
                                            message: t(
                                                'homeworkCreationSectionsEditQuestionFormSchema:optionRequired',
                                                { number: index + 1 }
                                            ),
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
                                        message: t(
                                            'homeworkCreationSectionsEditQuestionFormSchema:mcqm.optionsRequired'
                                        ),
                                        path: ['multipleChoiceOptions'],
                                    });
                                    return;
                                }

                                if (question.multipleChoiceOptions.length !== 4) {
                                    ctx.addIssue({
                                        code: z.ZodIssueCode.custom,
                                        message: t(
                                            'homeworkCreationSectionsEditQuestionFormSchema:mcqm.exactlyFourOptions'
                                        ),
                                        path: ['multipleChoiceOptions'],
                                    });
                                }

                                const selectedCount = question.multipleChoiceOptions.filter(
                                    (opt) => opt.isSelected
                                ).length;
                                if (selectedCount < 1) {
                                    ctx.addIssue({
                                        code: z.ZodIssueCode.custom,
                                        message: t(
                                            'homeworkCreationSectionsEditQuestionFormSchema:mcqm.atLeastOneSelected'
                                        ),
                                        path: ['multipleChoiceOptions'],
                                    });
                                }

                                question.multipleChoiceOptions.forEach((opt, index) => {
                                    if (!opt.name?.trim()) {
                                        ctx.addIssue({
                                            code: z.ZodIssueCode.custom,
                                            message: t(
                                                'homeworkCreationSectionsEditQuestionFormSchema:optionRequired',
                                                { number: index + 1 }
                                            ),
                                            path: ['multipleChoiceOptions', index, 'name'],
                                        });
                                    }
                                });
                            }
                        })
                ),
            })
        ),
    });

export type SectionsEditQuestionFormSchema = ReturnType<
    typeof buildSectionsEditQuestionFormSchema
>;
