import { z } from 'zod';
import type { TFunction } from 'i18next';
import i18n from '@/i18n';

/**
 * This zod schema and the ALLOWED_FILE_TYPE_OPTIONS constant are module-scope
 * singletons: the schema's exact shape is consumed via `z.infer` and the
 * options array is imported directly by several files outside this i18n
 * batch (assignment-preview.tsx, helper.ts, and the assessment/question-papers
 * route). Converting to a `buildXxx(t)` factory would require touching every
 * one of those call sites. Instead we use the same "outside a React render
 * tree" fallback the rollout already established (see
 * live-session/schedule/-schema/schema.ts): call the shared i18next singleton
 * directly with a fixed namespace. Validation/label copy is still real,
 * translated text — it just doesn't hot-swap without a reload, same tradeoff
 * already accepted there.
 */
const NAMESPACE = 'studyLibraryAssignmentFormSchema';
const t: TFunction = ((key: string, options?: Record<string, unknown>) =>
    i18n.t(key, { ns: NAMESPACE, ...options })) as TFunction;

export const assignmentFormSchema = z.object({
    id: z.string(),
    task: z.string(),
    taskDescription: z.string().optional(),
    parentRichTextId: z.string().optional(),
    textDataId: z.string().optional(),
    hasDateRange: z.boolean().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    reattemptCount: z.string(),
    uploaded_question_paper: z.string().nullable(),
    adaptive_marking_for_each_question: z.array(
        z.object({
            questionId: z.string().optional(),
            questionName: z.string(),
            questionType: z.string(),
            newQuestion: z.boolean().optional(),
            options: z
                .array(
                    z.object({
                        id: z.string(),
                        text: z.object({
                            content: z.string(),
                        }),
                    })
                )
                .optional(),
        })
    ),
    totalMarks: z.number().optional(),
    passingMarks: z.number().optional(),
    allowedFileTypes: z.array(z.string()).optional(),
    totalParticipants: z.number().optional(),
    submittedParticipants: z.number().optional(),
}).superRefine((v, ctx) => {
    if (
        v.hasDateRange &&
        v.startDate &&
        v.endDate &&
        new Date(v.startDate) >= new Date(v.endDate)
    ) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['endDate'],
            message: t('validation.endMustBeAfterStart'),
        });
    }
});

export type AssignmentFormType = z.infer<typeof assignmentFormSchema>;

// Sentinel value for the "All Files" option — selecting it means no
// restriction at all, including formats outside this fixed category list
// (e.g. .sb3 PictoBlox/Scratch projects). Equivalent to selecting nothing,
// but explicit so admins don't have to know that "check nothing" means
// "allow anything."
export const ALL_FILES_VALUE = 'all';

// File types an admin can allow learners to upload. PDF is always allowed.
export const ALLOWED_FILE_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
    { value: ALL_FILES_VALUE, label: t('fileType.allFiles') },
    { value: 'pdf', label: t('fileType.pdf') },
    { value: 'image', label: t('fileType.image') },
    { value: 'doc', label: t('fileType.document') },
    { value: 'video', label: t('fileType.video') },
    { value: 'audio', label: t('fileType.audio') },
];

// The selection is round-tripped through the existing `comma_separated_media_ids`
// column on assignment_slide (which is otherwise unused). A sentinel prefix lets
// us tell our payload apart from a real media-id list if anyone ever starts
// using that field for its original purpose.
export const ALLOWED_TYPES_FIELD_PREFIX = 'types:';

const KNOWN_TYPE_VALUES = new Set(ALLOWED_FILE_TYPE_OPTIONS.map((o) => o.value));

// Collapse to the canonical "all" encoding: if "all" is present alongside
// other selections (shouldn't happen given the UI enforces exclusivity, but
// don't trust that from stored/legacy data), only "all" is kept.
const normalizeAllowedFileTypes = (types: string[]): string[] =>
    types.includes(ALL_FILES_VALUE) ? [ALL_FILES_VALUE] : types;

export function encodeAllowedFileTypes(types: string[] | undefined | null): string {
    const cleaned = normalizeAllowedFileTypes(
        Array.from(
            new Set(
                (types ?? [])
                    .map((t) => t.trim().toLowerCase())
                    .filter((t) => KNOWN_TYPE_VALUES.has(t))
            )
        )
    );
    return `${ALLOWED_TYPES_FIELD_PREFIX}${cleaned.join(',')}`;
}

export function decodeAllowedFileTypes(raw: string | undefined | null): string[] {
    if (!raw || !raw.startsWith(ALLOWED_TYPES_FIELD_PREFIX)) return [];
    return normalizeAllowedFileTypes(
        Array.from(
            new Set(
                raw
                    .slice(ALLOWED_TYPES_FIELD_PREFIX.length)
                    .split(',')
                    .map((t) => t.trim().toLowerCase())
                    .filter((t) => KNOWN_TYPE_VALUES.has(t))
            )
        )
    );
}
