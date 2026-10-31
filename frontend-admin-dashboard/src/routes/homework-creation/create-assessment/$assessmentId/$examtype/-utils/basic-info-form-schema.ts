import { z } from 'zod';
import type { TFunction } from 'i18next';

export const buildBasicInfoFormSchema = (t: TFunction) =>
    z.object({
        status: z.string(),
        testCreation: z.object({
            assessmentName: z
                .string()
                .min(1, t('homeworkCreationBasicInfoFormSchema:assessmentNameRequired')),
            subject: z.string(),
            assessmentInstructions: z.string(),
            liveDateRange: z
                .object({
                    startDate: z.string().optional(),
                    endDate: z.string().optional(),
                })
                .refine(
                    (data) =>
                        (!data.startDate && !data.endDate) || // Allow empty
                        new Date(data.endDate!) > new Date(data.startDate!), // Date comparison
                    {
                        message: t('homeworkCreationBasicInfoFormSchema:endDateAfterStartDate'),
                        path: ['endDate'],
                    }
                ),
        }),
        assessmentPreview: z.object({
            checked: z.boolean(),
            previewTimeLimit: z.string(),
        }),
        reattemptCount: z
            .string()
            .default('1') // Default to "1" to prevent undefined errors
            .refine(
                (value) => {
                    const num = Number(value);
                    return !isNaN(num) && num > 0;
                },
                {
                    message: t('homeworkCreationBasicInfoFormSchema:reattemptCountPositive'),
                    path: ['reattemptCount'],
                }
            ),
        submissionType: z.string(),
        durationDistribution: z.string(),
        evaluationType: z.string(),
        switchSections: z.boolean(),
        raiseReattemptRequest: z.boolean(),
        raiseTimeIncreaseRequest: z.boolean(),
    });

export type BasicInfoFormSchemaType = z.infer<ReturnType<typeof buildBasicInfoFormSchema>>;
