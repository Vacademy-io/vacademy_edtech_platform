// courseSchema.ts

import { z } from "zod";

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

// Define the schema for a single instructor
const instructorSchema = z.object({
    id: z.string().uuid(), // Assuming IDs are UUIDs
    email: z.string().email({ message: "Invalid email address." }),
    name: z.string().min(1, { message: "Instructor name is required." }),
    profilePicUrl: z.string().optional(),
    authorSubtitle: z.string().optional(),
    authorDescription: z.string().optional(),
    roleLabel: z.string().optional(),
});

// Define the schema for level details within a session
const levelDetailsSchema = z.object({
    id: z.string().uuid(), // Assuming IDs are UUIDs
    name: z.string().min(1, { message: "Level name is required." }),
    duration_in_days: z
        .number()
        .int()
        .min(0, { message: "Duration must be a non-negative integer." }),
    package_session_id: z.string().optional(),
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
    session_name: z.string().min(1, { message: "Session name is required." }),
    status: z.string().min(1, { message: "Status name is required." }),
    start_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, {
            message: "Start date must be in YYYY-MM-DD format.",
        }), // Simple date string validation
});

// Define the schema for a single session
const sessionSchema = z.object({
    levelDetails: z
        .array(levelDetailsSchema)
        .min(1, {
            message: "At least one level detail is required per session.",
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

export const courseDetailsSchema = z.object({
    courseData: z.object({
        id: z.string(),
        title: z.string().min(1, { message: "Title is required." }),
        description: z
            .string()
            .min(10, {
                message: "Description must be at least 10 characters.",
            }),
        tags: z
            .array(z.string())
            .min(1, { message: "At least one tag is required." }),
        imageUrl: z
            .string()
            .url({ message: "Must be a valid URL for the image." }),
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
            .min(1, { message: "At least one instructor is required." }),
        sessions: z
            .array(sessionSchema)
            .min(1, { message: "At least one session is required." }),
    }),
    mockCourses: z
        .array(
            z
                .object({
                    id: z.string().uuid(),
                    title: z
                        .string()
                        .min(1, { message: "Mock course title is required." }),
                })
                .and(CourseStructureSchema)
        )
        .min(0),
});

export type CourseDetailsFormValues = z.infer<typeof courseDetailsSchema>;
// Define types for the nested items for clarity in the form
export type Slide = z.infer<typeof SlideSchema>;
export type Chapter = z.infer<typeof ChapterSchema>;
export type Module = z.infer<typeof ModuleSchema>;
export type Subject = z.infer<typeof SubjectSchema>;
