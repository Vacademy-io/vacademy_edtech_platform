import { z } from 'zod';
import type { TFunction } from 'i18next';

export const buildEditDashboardProfileSchema = (t: TFunction) =>
    z.object({
        instituteProfilePictureUrl: z.string(),
        instituteProfilePictureId: z.union([z.string(), z.undefined()]),
        instituteName: z
            .string()
            .min(1, t('dashboardEditProfileComponent:validation.instituteNameRequired')),
        instituteThemeCode: z.string().optional(),
        instituteType: z
            .string()
            .min(1, t('dashboardEditProfileComponent:validation.instituteTypeRequired')),
        instituteEmail: z
            .string()
            .optional()
            .refine(
                (val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
                t('dashboardEditProfileComponent:validation.invalidEmail')
            ),
        institutePhoneNumber: z.string().optional(),
        instituteWebsite: z
            .string()
            .optional()
            .refine(
                (val) => !val || /^https?:\/\/[^\s$.?#].[^\s]*$/i.test(val),
                t('dashboardEditProfileComponent:validation.invalidWebsite')
            ),
        instituteAddress: z.string().optional(),
        instituteCountry: z.string().optional(),
        instituteState: z.string().optional(),
        instituteCity: z.string().optional(),
        institutePinCode: z.string().optional(),
    });

export type EditDashboardProfileFormValues = z.infer<ReturnType<typeof buildEditDashboardProfileSchema>>;
