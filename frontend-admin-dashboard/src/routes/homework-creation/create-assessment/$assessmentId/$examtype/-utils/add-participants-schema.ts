import { z } from 'zod';
import type { TFunction } from 'i18next';

// Define TestInputField schema
const testInputFieldSchema = z.object({
    id: z.string(),
    type: z.string(),
    name: z.string(),
    oldKey: z.boolean(),
    isRequired: z.boolean(),
    key: z.string(),
    options: z
        .array(
            z.object({
                id: z.string(),
                value: z.string(),
            })
        )
        .optional(),
    order: z.number(),
});

// Define the schema for each student
const studentSchema = z.object({
    username: z.string(),
    user_id: z.string(),
    email: z.string(),
    full_name: z.string(),
    mobile_number: z.string(),
    guardian_email: z.string(),
    guardian_mobile_number: z.string(),
    file_id: z.string(),
    reattempt_count: z.number(),
});

// Define a dynamic object to handle custom fields as a record of TestInputField
const customFieldsSchema = z.array(testInputFieldSchema); // Maps field names to TestInputField definitions

const notifyBeforeAssessmentGoLiveSchema = z.object({
    checked: z.boolean(),
    value: z.string(),
});

export const buildTestAccessSchema = (t: TFunction) =>
    z.object({
        status: z.string(),
        closed_test: z.boolean(),
        open_test: z
            .object({
                checked: z.boolean(),
                start_date: z.string(),
                end_date: z.string(),
                instructions: z.string(),
                custom_fields: customFieldsSchema, // Dynamic custom fields
            })
            .superRefine((data, ctx) => {
                if (!data.checked) return;

                /**
                 * Blank bounds are legitimate: the backend reads a missing registration
                 * date as "no limit on that side", and `convertDateFormat` deliberately
                 * returns '' for the 9999-12-31 sentinel that mock and practice tests are
                 * stored with. Requiring them here would silently block every Update of a
                 * mock or practice test — and for PRACTICE/SURVEY/MANUAL_UPLOAD_EXAM the
                 * date inputs are not rendered at all (their step_keys omit
                 * registration_open_date), so the error would point at an invisible field.
                 *
                 * The ordering rule is guarded instead: `new Date('')` is an Invalid Date
                 * and every comparison against NaN is false, so the old bare
                 * `endDate <= startDate` silently passed for blanks and read as "checked".
                 */
                const startDate = new Date(data.start_date);
                const endDate = new Date(data.end_date);
                const hasStart = data.start_date !== '' && !Number.isNaN(startDate.getTime());
                const hasEnd = data.end_date !== '' && !Number.isNaN(endDate.getTime());

                if (hasStart && hasEnd && endDate <= startDate) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: t(
                            'homeworkCreationAddParticipantsSchema:validation.endDateAfterStartDate'
                        ),
                        path: ['end_date'], // Associate the error with `end_date`
                    });
                }
            }),
        select_batch: z.object({
            checked: z.boolean(),
            batch_details: z.record(z.array(z.string())),
        }),
        select_individually: z.object({
            checked: z.boolean(),
            student_details: z.array(studentSchema),
        }),
        join_link: z.string(),
        show_leaderboard: z.boolean(),
        notify_student: z.object({
            when_assessment_created: z.boolean(),
            before_assessment_goes_live: notifyBeforeAssessmentGoLiveSchema,
            when_assessment_live: z.boolean(),
            when_assessment_report_generated: z.boolean(),
        }),
        notify_parent: z.object({
            when_assessment_created: z.boolean(),
            before_assessment_goes_live: notifyBeforeAssessmentGoLiveSchema,
            when_assessment_live: z.boolean(),
            when_student_appears: z.boolean(),
            when_student_finishes_test: z.boolean(),
            when_assessment_report_generated: z.boolean(),
        }),
    });

export type TestAccessSchemaType = ReturnType<typeof buildTestAccessSchema>;
export type TestAccessFormValues = z.infer<TestAccessSchemaType>;
