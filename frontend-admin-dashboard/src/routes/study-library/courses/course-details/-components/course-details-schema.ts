// courseSchema.ts

import { z } from 'zod';
import type { TFunction } from 'i18next';

const SlideSchema = z.object({
    id: z.string().uuid(),
    title: z.string().min(1),
});

const ChapterSchema = z.object({
    id: z.string().uuid(),
    title: z.string().min(1),
});

const ModuleSchema = z.object({
    id: z.string().uuid(),
    title: z.string().min(1),
});

const SubjectSchema = z.object({
    id: z.string().uuid(),
    title: z.string().min(1),
});

// New: Course Structure Schema using Discriminated Union
const CourseStructureSchema = z.discriminatedUnion('level', [
    z.object({
        level: z.literal(2),
        structure: z.object({
            courseName: z.string().min(1),
            items: z.array(SlideSchema),
        }),
    }),
    z.object({
        level: z.literal(3),
        structure: z.object({
            courseName: z.string().min(1),
            items: z.array(ChapterSchema),
        }),
    }),
    z.object({
        level: z.literal(4),
        structure: z.object({
            courseName: z.string().min(1),
            items: z.array(ModuleSchema),
        }),
    }),
    z.object({
        level: z.literal(5),
        structure: z.object({
            courseName: z.string().min(1),
            items: z.array(SubjectSchema),
        }),
    }),
    z.object({
        level: z.literal(1),
        structure: z.object({
            courseName: z.string().min(1),
            items: z.array(z.any()).optional(),
        }),
    }),
]);

/**
 * A plain function (not a component/hook), so validation-message keys are
 * threaded in via `t` from the caller — see the guide's convention for
 * module-scope zod schemas (e.g. basic-info-form-schema.ts). Keys live under
 * the `studyLibraryCourseDetailsSchema` namespace; the caller must include
 * that namespace in its own useTranslation() call.
 */
export const buildCourseDetailsSchema = (t: TFunction) => {
    // Define the schema for a single instructor
    const instructorSchema = z.object({
        id: z.string().uuid(), // Assuming IDs are UUIDs
        email: z
            .string()
            .email({ message: t('studyLibraryCourseDetailsSchema:instructorEmailInvalid') }),
        name: z
            .string()
            .min(1, { message: t('studyLibraryCourseDetailsSchema:instructorNameRequired') }),
        profilePicId: z.string().optional(),
        roles: z.array(z.string()).optional(),
        authorSubtitle: z.string().optional(),
        authorDescription: z.string().optional(),
        roleLabel: z.string().optional(),
    });

    // Define the schema for level details within a session
    const levelDetailsSchema = z.object({
        id: z.string().uuid(), // Assuming IDs are UUIDs
        newLevel: z.boolean(),
        name: z
            .string()
            .min(1, { message: t('studyLibraryCourseDetailsSchema:levelNameRequired') }),
        duration_in_days: z
            .number()
            .int()
            .min(0, { message: t('studyLibraryCourseDetailsSchema:durationNonNegative') }),
        instructors: z.array(instructorSchema),
        subjects: z
            .array(
                z.object({
                    id: z.string(),
                    subject_name: z.string(),
                    subject_code: z.string(),
                    credit: z.number(),
                    thumbnail_id: z.string().nullable(),
                    created_at: z.string().nullable(),
                    updated_at: z.string().nullable(),
                    modules: z.array(z.any()).optional(),
                })
            )
            .optional(), // Changed to support SubjectType structure
        // Edit course: subgroups under this (session, level) from GET /batches; id = batch id when editing existing
        subgroups: z.array(z.object({ id: z.string().optional(), name: z.string() })).optional(),
        parentPackageSessionId: z.string().optional(),
    });

    // Define the schema for session details
    const sessionDetailsSchema = z.object({
        id: z.string().uuid(), // Assuming IDs are UUIDs
        session_name: z
            .string()
            .min(1, { message: t('studyLibraryCourseDetailsSchema:sessionNameRequired') }),
        status: z.string().min(1, { message: t('studyLibraryCourseDetailsSchema:statusNameRequired') }),
        newSession: z.boolean(),
        start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
            message: t('studyLibraryCourseDetailsSchema:startDateFormat'),
        }), // Simple date string validation
    });

    // Define the schema for a single session
    const sessionSchema = z.object({
        levelDetails: z
            .array(levelDetailsSchema)
            .min(1, { message: t('studyLibraryCourseDetailsSchema:levelDetailsRequired') }),
        sessionDetails: sessionDetailsSchema,
    });

    return z.object({
        courseData: z.object({
            id: z.string(),
            title: z.string().min(1, { message: t('studyLibraryCourseDetailsSchema:titleRequired') }),
            description: z
                .string()
                .min(10, { message: t('studyLibraryCourseDetailsSchema:descriptionMinLength') }),
            tags: z
                .array(z.string())
                .min(1, { message: t('studyLibraryCourseDetailsSchema:tagsRequired') }),
            imageUrl: z
                .string()
                .url({ message: t('studyLibraryCourseDetailsSchema:imageUrlInvalid') }),
            courseStructure: z.number(),
            whatYoullLearn: z.string(),
            whyLearn: z.string(),
            whoShouldLearn: z.string(),
            aboutTheCourse: z.string(),
            packageName: z.string(),
            status: z.string(),
            isCoursePublishedToCatalaouge: z.boolean(),
            coursePreviewImageMediaId: z.string(),
            courseBannerMediaId: z.string(),
            courseMediaId: z.object({
                type: z.string(),
                id: z.string(),
            }),
            coursePreviewImageMediaPreview: z.string(),
            courseBannerMediaPreview: z.string(),
            courseMediaPreview: z.string(),
            courseHtmlDescription: z.string(),
            /** Public course-page extras (mode + FAQs) as stored: a JSON string or null. */
            coursePageJson: z.string().nullable().optional(),
            created_by_user_id: z.string().optional(),
            instructors: z
                .array(instructorSchema)
                .min(1, { message: t('studyLibraryCourseDetailsSchema:instructorsRequired') }),
            sessions: z
                .array(sessionSchema)
                .min(1, { message: t('studyLibraryCourseDetailsSchema:sessionsRequired') }),
        }),
        mockCourses: z
            .array(
                z
                    .object({
                        id: z.string().uuid(),
                        title: z
                            .string()
                            .min(1, {
                                message: t('studyLibraryCourseDetailsSchema:mockCourseTitleRequired'),
                            }),
                    })
                    .and(CourseStructureSchema)
            )
            .min(0),
    });
};

export type CourseDetailsFormValues = z.infer<ReturnType<typeof buildCourseDetailsSchema>>;
// Define types for the nested items for clarity in the form
export type Slide = z.infer<typeof SlideSchema>;
export type Chapter = z.infer<typeof ChapterSchema>;
export type Module = z.infer<typeof ModuleSchema>;
export type Subject = z.infer<typeof SubjectSchema>;
