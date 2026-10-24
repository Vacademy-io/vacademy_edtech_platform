import { z } from 'zod';
import type { TFunction } from 'i18next';
import i18n from '@/i18n';
import { AccessType, WaitingRoomType } from '../../-constants/enums';
import { hasRequiredIdentityField } from '@/components/common/custom-fields/field-roles';

const NAMESPACE = 'studyLibraryBulkSchema';

/**
 * These zod schemas are module-scope singletons whose exact shape is consumed
 * via `z.infer<typeof X>` across other files in the bulk-schedule flow, so
 * converting them to `buildXxx(t)` factories would require touching every
 * type-inference call site outside this batch. Instead we use the same
 * "outside a React render tree" fallback already established for the sibling
 * schema.ts in this directory: call the shared i18next singleton directly
 * with a fixed namespace.
 */
const t: TFunction = ((key: string, options?: Record<string, unknown>) =>
    i18n.t(key, { ns: NAMESPACE, ...options })) as TFunction;

/**
 * Single row in the Bulk Schedule grid. Each row produces one independent
 * live session via the `/create/bulk` endpoint. Kept intentionally narrow:
 * advanced toggles (BBB config, feedback, learner-button, recurring days,
 * waiting room) intentionally don't apply to bulk rows — only the fields
 * commonly varied across many sessions.
 */
export const bulkSessionRowSchema = z
    .object({
        title: z.string().min(1, t('validation.titleRequired')),
        subject: z.string().optional(),
        startDate: z.string().min(1, t('validation.startDateRequired')),
        startTime: z.string().min(1, t('validation.startTimeRequired')),
        durationHours: z.string().default('0'),
        durationMinutes: z.string().default('30'),
        platform: z.string().default('other'),
        link: z.string().optional().or(z.literal('')),
        description: z.string().optional(),
        /**
         * Batches assigned to THIS row only. Each entry is a (course, session,
         * level) tuple — same shape step 2 uses for the existing single-class
         * flow so we can reuse the participants picker.
         */
        selectedLevels: z
            .array(
                z.object({
                    courseId: z.string(),
                    sessionId: z.string(),
                    levelId: z.string(),
                })
            )
            .default([]),

        /**
         * Teachers (instructors) for THIS row. Each entry is a user id when
         * picked in the grid's Teacher column, or the raw text of the CSV's
         * teacher column: email (recommended), username or user id. The grid
         * resolves entries against the staff directory (see
         * `-utils/teacherDirectory.ts`); entries that match nobody are flagged
         * on the row and skipped with a warning, never failing the row.
         * Empty = whoever schedules the classes.
         */
        instructorIdentifiers: z.array(z.string()).default([]),

        // === Waiting-room per-row overrides ===
        // Each is OPTIONAL on purpose: an undefined value means "use the
        // shared default from sharedOptions". The submit logic (resolveWaiting
        // helpers below) merges row-level overrides with the shared values so
        // admins can leave most rows alone and only customise outliers.
        /** Override: whether the waiting room is enabled for this row only. */
        waitingRoomEnabled: z.boolean().optional(),
        /** Override: minutes before start the waiting room opens for this row. */
        waitingRoomMinutes: z.string().optional(),
        /**
         * Override: waiting-room behaviour for this row. DEFAULT = waiting-room
         * screen; PRE_JOINING = learner joins the live class directly. Undefined
         * is treated as DEFAULT at submit time.
         */
        waitingRoomType: z.nativeEnum(WaitingRoomType).optional(),
        /** Override: S3 file id of a row-specific waiting-room thumbnail. */
        waitingRoomThumbnailFileId: z.string().optional(),
        /** Override: S3 file id of a row-specific waiting-room background score. */
        waitingRoomMusicFileId: z.string().optional(),
    })
    .superRefine((row, ctx) => {
        const h = parseInt(row.durationHours || '0', 10);
        const m = parseInt(row.durationMinutes || '0', 10);
        if ((isNaN(h) ? 0 : h) === 0 && (isNaN(m) ? 0 : m) === 0) {
            ctx.addIssue({
                code: 'custom',
                message: t('validation.durationGreaterThanZero'),
                path: ['durationMinutes'],
            });
        }
        if (row.platform !== 'zoho' && row.platform !== 'bbb') {
            if (!row.link) {
                ctx.addIssue({
                    code: 'custom',
                    message: t('validation.linkRequired'),
                    path: ['link'],
                });
            } else {
                try {
                    new URL(row.link);
                } catch {
                    ctx.addIssue({
                        code: 'custom',
                        message: t('validation.invalidUrl'),
                        path: ['link'],
                    });
                }
            }
        }
    });

export const feedbackQuestionSchema = z.object({
    id: z.string(),
    type: z.string(),
    label: z.string(),
    enabled: z.boolean(),
    mandatory: z.boolean(),
    max_stars: z.number().nullish(),
    allow_half: z.boolean().nullish(),
});

/**
 * One field on the public registration form. Mirrors the single-class step-2
 * `addParticipantsSchema.fields` shape so the bulk flow can reuse the exact
 * same builder UI and feed `transformFormToDTOStep2` without translation.
 */
export const bulkRegistrationFieldSchema = z.object({
    id: z.string().optional(),
    label: z
        .string()
        .min(1, t('validation.fieldLabelRequired'))
        .max(100, t('validation.fieldLabelTooLong')),
    required: z.boolean(),
    isDefault: z.boolean(),
    type: z.string(),
    options: z.array(z.object({ label: z.string(), name: z.string() })).optional(),
});

export const bulkSharedOptionsSchema = z.object({
    enableWaitingRoom: z.boolean().default(false),
    /** Minutes before start time to open the waiting room. Used only when enableWaitingRoom is true. */
    waitingRoomMinutes: z.string().default('5'),
    /**
     * Shared waiting-room behaviour for every row. DEFAULT = waiting-room screen;
     * PRE_JOINING = learner joins the live class directly during the window
     * (thumbnail / background score don't apply). A row can override this.
     */
    waitingRoomType: z.nativeEnum(WaitingRoomType).default(WaitingRoomType.WAITING_ROOM),
    /** S3 file id of the waiting-room thumbnail uploaded once and applied to every bulk row. */
    waitingRoomThumbnailFileId: z.string().optional(),
    /** S3 file id of the waiting-room background music. */
    waitingRoomMusicFileId: z.string().optional(),
    allowRewind: z.boolean().default(true),
    allowPause: z.boolean().default(true),
    /** Attendance-only institutes: show every class created from this grid to learners. */
    showToLearners: z.boolean().default(false),
    enableFeedback: z.boolean().default(false),
    /** When true, learner cannot skip the feedback form — serialized as feedback_config.allow_skip = false. */
    feedbackCompulsory: z.boolean().default(false),
    /** Per-question feedback config sent to the backend when enableFeedback is true. */
    feedbackQuestions: z.array(feedbackQuestionSchema).default([]),
    /** Maps to bbb_record on the backend; only takes effect for rows whose platform is BBB. */
    recordSession: z.boolean().default(false),
    /** Auto-start recording when the BBB meeting begins. */
    autoStartRecording: z.boolean().default(false),
    /** Mute participants when they join. */
    muteOnStart: z.boolean().default(true),
    /** Only the moderator can share their webcam. */
    webcamsOnlyForModerator: z.boolean().default(false),
    /** How guest learners are admitted. */
    guestPolicy: z
        .enum(['ALWAYS_ACCEPT', 'ASK_MODERATOR', 'ALWAYS_DENY'])
        .default('ALWAYS_ACCEPT'),
    /**
     * Students join listen-only and cannot unmute, so no participant can take an
     * individual mic channel. Use for broadcast-style classes.
     */
    disableMic: z.boolean().default(false),
    /** Students cannot share their camera at all. */
    disableCam: z.boolean().default(false),
    /** Students cannot start private chats (the host still can message them). */
    disablePrivateChat: z.boolean().default(false),
    /** Students cannot type in the public chat. */
    disablePublicChat: z.boolean().default(false),
    /** Students cannot edit the shared notes. */
    disableSharedNotes: z.boolean().default(false),
    /** Students cannot see the participant list. */
    hideUserList: z.boolean().default(false),
    /** Auto-end the meeting shortly after the last moderator leaves. */
    endWhenNoModerator: z.boolean().default(false),
    /**
     * Default streaming platform for new rows. The "Add row" button stamps
     * each new row's platform with this value so admins don't have to set it
     * per row when they're creating many of the same kind of class.
     */
    defaultPlatform: z.string().default('other'),
    /**
     * Default description (HTML) applied to rows whose description is blank
     * when the admin clicks "Apply to empty rows". Each row keeps an editable
     * description override (`bulkSessionRowSchema.description`).
     */
    defaultDescription: z.string().optional(),
});

export const bulkSessionFormSchema = z.object({
    timeZone: z.string().min(1, t('validation.timeZoneRequired')),
    rows: z.array(bulkSessionRowSchema).min(1, t('validation.addAtLeastOneSession')),
    sharedOptions: bulkSharedOptionsSchema,

    /**
     * "Auto-add recordings to course" — ONE shared per-batch destination map
     * for the whole grid (keyed by package_session_id, i.e. batch). At submit
     * time each row only receives the destinations matching its own assigned
     * batches; rows with none fall back to the institute default destination.
     * Only meaningful when the institute has auto-upload enabled and access
     * is PRIVATE (public rows have no batches).
     */
    recordingAutoLink: z
        .object({
            enabled: z.boolean().default(false),
            destinations: z
                .array(
                    z.object({
                        package_session_id: z.string(),
                        subject_id: z.string().optional(),
                        module_id: z.string().optional(),
                        chapter_id: z.string(),
                    })
                )
                .default([]),
        })
        .default({ enabled: false, destinations: [] }),

    // === Step-2 settings (applied to every created session) ===
    /** Private = batches assigned per row; Public = anyone with the link. */
    accessType: z.nativeEnum(AccessType).default(AccessType.PRIVATE),
    /**
     * Public registration-form fields, shared across every session created from
     * the grid. Only meaningful when accessType === PUBLIC — seeded from the
     * institute's default fields and editable like single-class step 2.
     */
    fields: z.array(bulkRegistrationFieldSchema).default([]),
    notifyBy: z
        .object({
            mail: z.boolean(),
            whatsapp: z.boolean(),
            push_notification: z.boolean(),
            system_notification: z.boolean(),
        })
        .default({
            mail: false,
            whatsapp: false,
            push_notification: false,
            system_notification: false,
        }),
    notifySettings: z
        .object({
            onCreate: z.boolean(),
            beforeLive: z.boolean(),
            beforeLiveTime: z
                .array(z.object({ time: z.string().min(1, t('validation.selectTime')) }))
                .optional(),
            onLive: z.boolean(),
            onAttendance: z.boolean(),
        })
        .default({
            onCreate: false,
            beforeLive: false,
            beforeLiveTime: [],
            onLive: true,
            onAttendance: false,
        }),
})
    .superRefine((data, ctx) => {
        // Private bulk sessions are restricted to assigned batches (there's no
        // individual-learner picker in the grid), so every row must have at
        // least one batch — otherwise that class would be created with nobody
        // able to join. Public rows join via the shared link and need none.
        if (data.accessType === AccessType.PRIVATE) {
            data.rows.forEach((row, index) => {
                if ((row.selectedLevels?.length ?? 0) === 0) {
                    ctx.addIssue({
                        code: 'custom',
                        message: t('validation.assignAtLeastOneBatch'),
                        path: ['rows', index, 'selectedLevels'],
                    });
                }
            });
        }

        // Any registration field can be made optional, phone number included — but a registrant
        // is identified by their email or their mobile number, and a submission carrying
        // neither is rejected server-side. One of the two has to stay required.
        if (
            data.accessType === AccessType.PUBLIC &&
            data.fields.length > 0 &&
            !hasRequiredIdentityField(data.fields)
        ) {
            ctx.addIssue({
                code: 'custom',
                message: t('validation.emailOrPhoneRequired'),
                path: ['fields'],
            });
        }
    });

export type BulkSessionRow = z.infer<typeof bulkSessionRowSchema>;
export type BulkSharedOptions = z.infer<typeof bulkSharedOptionsSchema>;
export type BulkSessionForm = z.infer<typeof bulkSessionFormSchema>;
