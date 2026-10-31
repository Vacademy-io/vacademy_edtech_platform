// courseSchema.ts

import { z } from "zod";
import i18n from "@/i18n";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

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

/**
 * Built per-render (not a module constant) so validation messages follow the
 * active language instead of freezing at import time. See
 * makeInstituteSelectionSchema in select-institute.tsx for the same pattern.
 */
export const makeCourseDetailsSchema = () => {
    const course = getTerminology(ContentTerms.Course, SystemTerms.Course);

    // Define the schema for a single instructor
    const instructorSchema = z.object({
        id: z.string().uuid(), // Assuming IDs are UUIDs
        email: z.string().email({ message: i18n.t("courseDetailsA:schema.invalidEmail") }),
        name: z.string().min(1, { message: i18n.t("courseDetailsA:schema.instructorNameRequired") }),
    });

    // Define the schema for level details within a session
    const levelDetailsSchema = z.object({
        id: z.string().uuid(), // Assuming IDs are UUIDs
        name: z.string().min(1, { message: i18n.t("courseDetailsA:schema.levelNameRequired") }),
        duration_in_days: z
            .number()
            .int()
            .min(0, { message: i18n.t("courseDetailsA:schema.durationNonNegative") }),
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
    });

    // Define the schema for session details
    const sessionDetailsSchema = z.object({
        id: z.string().uuid(), // Assuming IDs are UUIDs
        session_name: z.string().min(1, { message: i18n.t("courseDetailsA:schema.sessionNameRequired") }),
        status: z.string().min(1, { message: i18n.t("courseDetailsA:schema.statusNameRequired") }),
        start_date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/, {
                message: i18n.t("courseDetailsA:schema.startDateFormat"),
            }), // Simple date string validation
    });

    // Define the schema for a single session
    const sessionSchema = z.object({
        levelDetails: z
            .array(levelDetailsSchema)
            .min(1, {
                message: i18n.t("courseDetailsA:schema.levelDetailRequired"),
            }),
        sessionDetails: sessionDetailsSchema,
    });

    // New: Course Structure Schema using Discriminated Union
    const CourseStructureSchema = z.discriminatedUnion("level", [
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

    return z.object({
        courseData: z.object({
            id: z.string(),
            title: z.string().min(1, { message: i18n.t("courseDetailsA:schema.titleRequired") }),
            description: z
                .string()
                .min(10, {
                    message: i18n.t("courseDetailsA:schema.descriptionMinLength"),
                }),
            tags: z
                .array(z.string())
                .min(1, { message: i18n.t("courseDetailsA:schema.tagRequired") }),
            imageUrl: z
                .string()
                .url({ message: i18n.t("courseDetailsA:schema.invalidImageUrl") }),
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
            courseMediaId: z.string(),
            courseHtmlDescription: z.string(),
            instructors: z
                .array(instructorSchema)
                .min(1, { message: i18n.t("courseDetailsA:schema.instructorRequired") }),
            sessions: z
                .array(sessionSchema)
                .min(1, { message: i18n.t("courseDetailsA:schema.sessionRequired") }),
        }),
        mockCourses: z
            .array(
                z
                    .object({
                        id: z.string().uuid(),
                        title: z
                            .string()
                            .min(1, {
                                message: i18n.t("courseDetailsA:schema.mockCourseTitleRequired", {
                                    course,
                                }),
                            }),
                    })
                    .and(CourseStructureSchema)
            )
            .min(0),
    });
};

export type CourseDetailsFormValues = z.infer<ReturnType<typeof makeCourseDetailsSchema>>;
// Define types for the nested items for clarity in the form
export type Slide = z.infer<typeof SlideSchema>;
export type Chapter = z.infer<typeof ChapterSchema>;
export type Module = z.infer<typeof ModuleSchema>;
export type Subject = z.infer<typeof SubjectSchema>;
