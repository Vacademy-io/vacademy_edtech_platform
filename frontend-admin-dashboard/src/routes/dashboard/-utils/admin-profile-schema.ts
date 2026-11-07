import { z } from 'zod';
import type { TFunction } from 'i18next';

export const userRoleSchema = z.object({
    id: z.string(),
    name: z.string(),
});

export const buildAdminProfileSchema = (t: TFunction) =>
    z.object({
        profilePictureUrl: z.string(),
        profilePictureId: z.union([z.string(), z.undefined(), z.null()]),
        name: z.string().min(1, t('dashboardAdminProfileSchema:validation.nameRequired')),
        roleType: z.array(z.string()),
        email: z
            .string()
            .optional()
            .refine(
                (val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
                t('dashboardAdminProfileSchema:validation.invalidEmail')
            ),
        phone: z.string(),
    });

export type AdminProfileFormValues = z.infer<ReturnType<typeof buildAdminProfileSchema>>;
