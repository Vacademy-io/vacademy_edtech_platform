import { z } from 'zod';

const sectionDetailsSchema = z.object({
    status: z.string(),
    testDuration: z.object({
        entireTestDuration: z.object({
            checked: z.boolean(),
            testDuration: z
                .object({
                    hrs: z.string(),
                    min: z.string(),
                })
                .optional(),
        }),
        sectionWiseDuration: z.boolean(),
        questionWiseDuration: z.boolean(),
    }),
    section: z.array(
        z.object({
            sectionId: z.string(),
            sectionName: z.string(),
            questionPaperTitle: z.string().optional(),
            uploaded_question_paper: z.string().nullable(),
            subject: z.string().optional(),
            yearClass: z.string().optional(),
            question_duration: z.object({
                hrs: z.string(),
                min: z.string(),
            }),
            section_description: z.string(),
            section_duration: z.object({
                hrs: z.string(),
                min: z.string(),
            }),
            marks_per_question: z.string(),
            total_marks: z.string(),
            negative_marking: z.object({
                checked: z.boolean(),
                value: z.string(),
            }),
            partial_marking: z.boolean(),
            cutoff_marks: z.object({
                checked: z.boolean(),
                value: z.string(),
            }),
            problem_randomization: z.boolean(),
            adaptive_marking_for_each_question: z.array(
                z.object({
                    questionId: z.string().optional(),
                    questionName: z.string(),
                    questionType: z.string(),
                    questionMark: z.string(),
                    questionPenalty: z.string(),
                    correctOptionIdsCnt: z.number().optional(),
                    // Read-only view of the choices under the question row, the
                    // key marked, so a teacher can check an MCQ without opening it.
                    options: z
                        .array(
                            z.object({
                                id: z.string().optional(),
                                name: z.string(),
                                isCorrect: z.boolean().optional(),
                            })
                        )
                        .optional(),
                    questionDuration: z.object({
                        hrs: z.string(),
                        min: z.string(),
                    }),
                    // Evaluation criteria fields
                    evaluation_criteria_json: z.string().optional(),
                    criteria_source: z.enum(['ai', 'manual', 'template']).optional(),
                    criteria_template_id: z.string().optional(),
                })
            ),
        })
    ),
});

export default sectionDetailsSchema;
