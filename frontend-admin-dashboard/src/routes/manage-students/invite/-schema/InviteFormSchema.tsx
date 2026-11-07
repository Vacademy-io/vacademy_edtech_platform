import { BatchForSessionSchema } from '@/schemas/student/student-list/institute-schema';
import type { TFunction } from 'i18next';
import { z } from 'zod';

// Define the email entry schema
const emailEntrySchema = z.object({
    id: z.string(),
    value: z.string().email(),
});

// Define the dropdown item type schema
const dropdownItemSchema = z.object({
    id: z.string(),
    name: z.string(),
});

const selectionModeSchema = z.enum(['institute', 'student', 'both']);

const levelSchema = z.object({
    id: z.string(),
    name: z.string(),
    packageSessionId: z.string(),
});

// Builds the batch-selection validation schema. This used to be a module-level `const`
// whose superRefine() issued hardcoded English messages via ctx.addIssue({ message: '...' })
// — zod's addIssue only accepts a static string, so there's no lazy-thunk escape hatch and
// the schema must be rebuilt with the current `t` instead. Converted to a factory (matching
// the buildAddDiscountSchema pattern in GenerateInviteLinkSchema.ts) so the sole real
// consumer (useInviteForm.tsx, via buildInviteFormSchema below) can rebuild it fresh from a
// hook-scoped `t`, recomputed whenever the active locale changes.
export const buildBatchSchema = (t: TFunction) =>
    z
        .object({
            maxCourses: z.number().or(z.nan()),
            courseSelectionMode: selectionModeSchema,
            preSelectedCourses: z.array(BatchForSessionSchema),
            learnerChoiceCourses: z.array(BatchForSessionSchema),
        })
        .superRefine((data, ctx) => {
            if (data.courseSelectionMode === 'student') {
                if (isNaN(data.maxCourses)) {
                    ctx.addIssue({
                        code: 'custom',
                        message: t('validation.maxCoursesRequired'),
                        path: ['maxCourses'],
                    });
                }
                if (data.learnerChoiceCourses.length === 1) {
                    ctx.addIssue({
                        code: 'custom',
                        message: t('validation.inviteLinkAlreadyPresent'),
                        path: ['learnerChoiceCourses'],
                    });
                }
            }
            if (data.courseSelectionMode === 'institute') {
                if (data.preSelectedCourses.length === 1) {
                    ctx.addIssue({
                        code: 'custom',
                        message: t('validation.inviteLinkAlreadyPresent'),
                        path: ['preSelectedCourses'],
                    });
                }
            }
        });

const customFieldSchema = z.object({
    id: z.number(),
    type: z.string(),
    name: z.string(),
    oldKey: z.boolean(),
    isRequired: z.boolean(),
    options: z
        .array(
            z.object({
                id: z.number(),
                value: z.string(),
                disabled: z.boolean(),
            })
        )
        .optional(),
    _id: z.string().optional(),
    status: z.enum(['ACTIVE', 'DELETED']),
});

// Builds the form validation schema. Factory-with-parameter (see buildBatchSchema above)
// since the `inviteLink` min() message and the nested batch schema both need a live `t`.
export const buildInviteFormSchema = (t: TFunction) =>
    z.object({
        inviteLink: z.string().min(1, t('validation.inviteLinkRequired')),
        activeStatus: z.boolean(),
        custom_fields: z.array(customFieldSchema),
        batches: buildBatchSchema(t),
        studentExpiryDays: z.number(),
        inviteeEmail: z.string().optional(), // For the input field
        inviteeEmails: z.array(emailEntrySchema).optional(),
    });

export type InviteForm = z.infer<ReturnType<typeof buildInviteFormSchema>>;
export type SelectionMode = z.infer<typeof selectionModeSchema>;
export type BatchField = z.infer<typeof dropdownItemSchema>;
export type LevelField = z.infer<typeof levelSchema>;
export type BatchDetails = z.infer<ReturnType<typeof buildBatchSchema>>;
export type CustomField = z.infer<typeof customFieldSchema>;

export const defaultFormValues: Partial<InviteForm> = {
    inviteLink: '',
    activeStatus: true,
    custom_fields: [
        {
            id: 0,
            type: 'textfield',
            name: 'Full Name',
            oldKey: true,
            isRequired: true,
            status: 'ACTIVE',
        },
        {
            id: 1,
            type: 'textfield',
            name: 'Email',
            oldKey: true,
            isRequired: true,
            status: 'ACTIVE',
        },
        {
            id: 2,
            type: 'textfield',
            name: 'Phone Number',
            oldKey: true,
            isRequired: true,
            status: 'ACTIVE',
        },
    ],
    batches: {
        maxCourses: 0,
        courseSelectionMode: 'institute',
        preSelectedCourses: [],
        learnerChoiceCourses: [],
    },
    studentExpiryDays: 365,
    inviteeEmail: '',
    inviteeEmails: [],
};

const learnerChoiceSessionSchema = z.object({
    id: z.string(),
    name: z.string(),
    maxLevels: z.number(),
    levelSelectionMode: selectionModeSchema,
    learnerChoiceLevels: z.array(levelSchema),
});

const preSelectedSessionSchema = z.object({
    id: z.string(),
    name: z.string(),
    maxLevels: z.number(),
    levelSelectionMode: selectionModeSchema,
    learnerChoiceLevels: z.array(levelSchema),
    preSelectedLevels: z.array(levelSchema),
});

const learnerChoiceCoursesSchema = z.object({
    id: z.string(),
    name: z.string(),
    maxSessions: z.number(),
    sessionSelectionMode: selectionModeSchema,
    learnerChoiceSessions: z.array(learnerChoiceSessionSchema),
});

const preSelectedCoursesSchema = z.object({
    id: z.string(),
    name: z.string(),
    maxSessions: z.number(),
    sessionSelectionMode: selectionModeSchema,
    learnerChoiceSessions: z.array(learnerChoiceSessionSchema),
    preSelectedSessions: z.array(preSelectedSessionSchema),
});

export type PreSelectedSession = z.infer<typeof preSelectedSessionSchema>;
export type LearnerChoiceSession = z.infer<typeof learnerChoiceSessionSchema>;
export type PreSelectedCourse = z.infer<typeof preSelectedCoursesSchema>;
export type LearnerChoiceCourse = z.infer<typeof learnerChoiceCoursesSchema>;
