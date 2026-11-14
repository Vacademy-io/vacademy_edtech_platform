import { z } from 'zod';
import { toast } from 'sonner';
import type { TFunction } from 'i18next';
import i18n from '@/i18n';
import { AccessType, RecurringType, WaitingRoomType } from '../../-constants/enums';
import {
    FieldRole,
    classifyFieldRole,
    hasRequiredIdentityField,
} from '@/components/common/custom-fields/field-roles';

const NAMESPACE = 'studyLibraryScheduleSchema';

/**
 * These zod schemas (sessionFormSchema, weeklyClassSchema, addParticipantsSchema,
 * addCustomFiledSchema) are module-scope singletons whose exact shape is consumed
 * via `z.infer<typeof X>` across many other files in this route (scheduleStep1.tsx,
 * scheduleStep2.tsx, BulkScheduleGrid.tsx, LiveSessionParticipantsTab.tsx,
 * LiveSessionStudentListTab.tsx, sessionIdstore.ts, -constants/helper.ts, and two
 * test files) — none of which are in this i18n batch. Converting these to
 * `buildXxx(t)` factories (the guide's usual module-scope-constant convention)
 * would require touching every one of those type-inference call sites outside
 * this batch. Instead we use the same "outside a React render tree" fallback the
 * rollout already established for exactly this situation (see globalT in
 * manage-students/.../bulk-upload-table.tsx): call the shared i18next singleton
 * directly with a fixed namespace, so validation copy is still real, translated
 * text — it just doesn't hot-swap without a reload, same tradeoff already
 * accepted there.
 */
const t: TFunction = ((key: string, options?: Record<string, unknown>) =>
    i18n.t(key, { ns: NAMESPACE, ...options })) as TFunction;

const weekDaysEnum = z.enum([
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
]);

// Schema for learner button configuration
const learnerButtonConfigSchema = z.object({
    text: z.string().min(1, t('validation.buttonTextRequired')).max(50, t('validation.buttonTextMaxLength')),
    url: z.string().url(t('validation.invalidUrl')),
    background_color: z.string().regex(/^#[0-9A-F]{6}$/i, t('validation.invalidHexColor')),
    text_color: z.string().regex(/^#[0-9A-F]{6}$/i, t('validation.invalidHexColor')),
    visible: z.boolean(),
}).optional().nullable();

const sessionDetailsSchema = z.object({
    id: z.string().optional(),
    startTime: z.string().optional(),
    durationHours: z
        .string()
        .refine(
            (val) => {
                const num = parseInt(val);
                return !val || (num >= 0 && num <= 24);
            },
            { message: t('validation.hoursRange') }
        )
        .optional(),
    durationMinutes: z
        .string()
        .refine(
            (val) => {
                const num = parseInt(val);
                return !val || (num >= 0 && num <= 59);
            },
            { message: t('validation.minutesRange') }
        )
        .optional(),
    link: z.string().url(t('validation.invalidUrl')).optional().or(z.literal('')),
    countAttendanceDaily: z.boolean().optional(),
    thumbnailFileId: z.string().optional(),
});

export const weeklyClassSchema = z.object({
    id: z.string().optional(),
    day: weekDaysEnum,
    isSelect: z.boolean(),
    // Day-level configurations (shared across all sessions on this day)
    default_class_link: z.string().url(t('validation.invalidUrl')).optional().or(z.literal('')).nullable(),
    default_class_name: z.string().max(100, t('validation.classNameMaxLength')).optional().nullable(),
    learner_button_config: learnerButtonConfigSchema,
    sessions: z.array(sessionDetailsSchema),
});

export const sessionFormSchema = z
    .object({
        id: z.string().optional(),
        title: z.string().min(1, t('validation.titleMinLength')),
        subject: z.string().optional(),
        openWaitingRoomBefore: z.string().optional(),
        // DEFAULT (waiting-room screen) | PRE_JOINING (join live class directly).
        waitingRoomType: z.nativeEnum(WaitingRoomType).default(WaitingRoomType.WAITING_ROOM),
        sessionType: z.string(),
        sessionPlatform: z.string(),
        enableWaitingRoom: z.boolean(),
        streamingType: z.string(),
        allowRewind: z.boolean(),
        allowPause: z.boolean(),
        // Attendance-only institutes: show this class to learners.
        showToLearners: z.boolean().optional(),
        startTime: z.string({
            required_error: t('validation.startTimeRequired'),
            invalid_type_error: t('validation.invalidDate'),
        }),
        endDate: z
            .string({
                required_error: t('validation.endDateRequired'),
                invalid_type_error: t('validation.invalidDate'),
            })
            .optional(),
        timeZone: z.string().min(1, t('validation.timeZoneRequired')),
        events: z.string().regex(/^\d+$/, t('validation.mustBeNumber')),
        description: z.string().optional(),
        durationMinutes: z.string({
            required_error: t('validation.durationRequired'),
        }),
        durationHours: z.string({
            required_error: t('validation.durationRequired'),
        }),
        defaultLink: z.string().optional().or(z.literal('')),
        meetingType: z.nativeEnum(RecurringType),
        recurringSchedule: z.array(weeklyClassSchema).optional(),
        learner_button_config: learnerButtonConfigSchema,
        // BBB meeting configuration (only used when sessionPlatform = 'bbb')
        bbbRecord: z.boolean().optional(),
        bbbAutoStartRecording: z.boolean().optional(),
        bbbMuteOnStart: z.boolean().optional(),
        bbbWebcamsOnlyForModerator: z.boolean().optional(),
        bbbGuestPolicy: z.enum(['ALWAYS_ACCEPT', 'ASK_MODERATOR', 'ALWAYS_DENY']).optional(),
        // Lock settings — restrict students only; the host keeps full access
        bbbDisableMic: z.boolean().optional(),
        bbbDisableCam: z.boolean().optional(),
        bbbDisablePrivateChat: z.boolean().optional(),
        bbbDisablePublicChat: z.boolean().optional(),
        bbbDisableSharedNotes: z.boolean().optional(),
        bbbHideUserList: z.boolean().optional(),
        bbbEndWhenNoModerator: z.boolean().optional(),
        // Opt-in on-device camera activeness score (per session; no institute default yet)
        bbbActivenessScore: z.boolean().optional(),
        // Zoom meeting configuration (only used when sessionPlatform = 'zoom' and an
        // account is selected). When no account is chosen, Zoom falls back to the
        // manual defaultLink paste just like YouTube/Meet/Other.
        // Field names mirror the Zoom create-meeting API "settings" object
        // (camelCase here, ZoomMeetingManager re-keys to snake_case).
        zoomAccountId: z.string().optional(),
        // Google Meet account integration (only used when sessionPlatform = 'google meet' and a
        // connected account is selected; otherwise Meet falls back to the manual defaultLink paste).
        googleMeetAccountId: z.string().optional(),
        // Per-class Meet space settings (GoogleMeetManager.buildSpaceConfig). Recording and
        // access start from the account defaults; restrictions apply only with host management on.
        googleAccessType: z.enum(['OPEN', 'TRUSTED', 'RESTRICTED']).optional(),
        googleRecord: z.boolean().optional(),
        googleTranscription: z.boolean().optional(),
        googleSmartNotes: z.boolean().optional(),
        googleAttendanceReport: z.boolean().optional(),
        googleHostManagement: z.boolean().optional(),
        googleChatHostsOnly: z.boolean().optional(),
        googleReactionsHostsOnly: z.boolean().optional(),
        googlePresentHostsOnly: z.boolean().optional(),
        googleJoinAsViewer: z.boolean().optional(),
        // Entry / security
        zoomWaitingRoom: z.boolean().optional(),
        zoomJoinBeforeHost: z.boolean().optional(),
        zoomMeetingAuthentication: z.boolean().optional(),
        zoomApprovalType: z.enum(['0', '1', '2']).optional(), // 0=auto, 1=manual, 2=no registration
        zoomAlternativeHosts: z.string().optional(),
        // Audio / video defaults
        zoomMuteUponEntry: z.boolean().optional(),
        zoomHostVideo: z.boolean().optional(),
        zoomParticipantVideo: z.boolean().optional(),
        zoomAudio: z.enum(['both', 'telephony', 'voip']).optional(),
        // In-meeting features
        zoomAutoRecording: z.enum(['cloud', 'local', 'none']).optional(),
        zoomBreakoutRoom: z.boolean().optional(),
        zoomFocusMode: z.boolean().optional(),
        zoomAllowMultipleDevices: z.boolean().optional(),
        zoomWatermark: z.boolean().optional(),
        // Learner feedback configuration
        feedbackEnabled: z.boolean().optional(),
        // When true, learner cannot skip the feedback form. Serialized to the
        // backend as feedback_config.allow_skip = !feedbackCompulsory.
        feedbackCompulsory: z.boolean().optional(),
        feedbackQuestions: z.array(z.object({
            id: z.string(),
            type: z.string(),
            label: z.string(),
            enabled: z.boolean(),
            mandatory: z.boolean(),
            max_stars: z.number().nullish(),
            allow_half: z.boolean().nullish(),
        })).optional(),
    })
    .superRefine((data, ctx) => {
        // Platforms whose meeting is auto-generated by the backend and therefore
        // don't need a pasted link: Zoho, BBB, and Zoom WHEN an account is chosen.
        // Zoom without an account (integration off) falls back to manual paste.
        const autoGeneratesMeeting =
            data.sessionPlatform === 'zoho' ||
            data.sessionPlatform === 'bbb' ||
            (data.sessionPlatform === 'zoom' && !!data.zoomAccountId) ||
            (data.sessionPlatform === 'google meet' && !!data.googleMeetAccountId);

        if (!autoGeneratesMeeting && !data.defaultLink) {
            ctx.addIssue({
                code: 'custom',
                message: t('validation.liveClassLinkRequired'),
                path: ['defaultLink'],
            });
        }
        if (!autoGeneratesMeeting && data.defaultLink) {
            try {
                new URL(data.defaultLink);
            } catch {
                ctx.addIssue({
                    code: 'custom',
                    message: t('validation.invalidUrl'),
                    path: ['defaultLink'],
                });
            }
        }
        // Validate total duration is greater than zero
        const hours = parseInt(data.durationHours || '0', 10);
        const minutes = parseInt(data.durationMinutes || '0', 10);
        if (hours === 0 && minutes === 0) {
            ctx.addIssue({
                code: 'custom',
                message: t('validation.durationGreaterThanZero'),
                path: ['durationMinutes'],
            });
        }
        // Validate end date for recurring meetings
        if (data.meetingType === RecurringType.WEEKLY && !data.endDate) {
            ctx.addIssue({
                code: 'custom',
                message: t('validation.endDateRequiredRecurring'),
                path: ['endDate'],
            });
        }
        // Validate end date is greater than start date
        if (data.meetingType === RecurringType.WEEKLY && data.endDate && data.startTime) {
            const startDateStr = data.startTime.split('T')[0];
            if (startDateStr && data.endDate <= startDateStr) {
                toast.error(t('validation.endDateAfterStartDate'));
                ctx.addIssue({
                    code: 'custom',
                    message: t('validation.endDateAfterStartDate'),
                    path: ['endDate'],
                });
            }
        }
    });

export const addParticipantsSchema = z.object({
    accessType: z.nativeEnum(AccessType),
    batchSelectionType: z.enum(['batch', 'individual']),
    selectedLevels: z.array(
        z.object({
            courseId: z.string(),
            sessionId: z.string(),
            levelId: z.string(),
        })
    ),
    selectedLearners: z.array(z.string()).optional(),
    /**
     * Instructors / presenters of the class, as user ids. Optional so the
     * transform can tell "the admin didn't touch instructors" (undefined, leave
     * them alone) from "the admin removed them all" (empty array).
     */
    instructorUserIds: z.array(z.string()).optional(),
    joinLink: z.string().url(t('validation.enterValidUrl')),
    notifyBy: z.object({
        mail: z.boolean(),
        whatsapp: z.boolean(),
        push_notification: z.boolean(),
        system_notification: z.boolean(),
    }),
    notifySettings: z.object({
        onCreate: z.boolean(),
        onEdit: z.boolean().optional(),
        beforeLive: z.boolean(),
        beforeLiveTime: z
            .array(
                z.object({
                    time: z.string().min(1, t('validation.selectTime')), // e.g., "10 min"
                })
            )
            .optional(),
        onLive: z.boolean(),
        onAttendance: z.boolean(),
    }),
    fields: z.array(
        z.object({
            id: z.string().optional(),
            label: z.string().min(1, t('validation.fieldLabelRequired')).max(100, t('validation.fieldLabelTooLong')),
            required: z.boolean(),
            isDefault: z.boolean(),
            type: z.string(),
            options: z.array(z.object({ label: z.string(), name: z.string() })).optional(),
        })
    ),
    // Paid live class: one price for the whole session/series, charged before joining.
    paymentEnabled: z.boolean().optional(),
    paymentPrice: z.string().optional(),
    paymentCurrency: z.string().optional(),
    // Gateway charging this session's fee; '' = institute default.
    paymentVendor: z.string().optional(),
    // Public registration: make the learner verify their contact info via OTP
    // before registering (phone OTP goes over WhatsApp and needs the
    // institute's approved template).
    requireEmailVerification: z.boolean().optional(),
    requirePhoneVerification: z.boolean().optional(),
    // WhatsApp template for the phone OTP; '' = institute default template.
    whatsappOtpTemplateName: z.string().optional(),
    // Public registration: also push each registrant as a lead into these
    // Audience Manager lists (on top of the always-on default webinar list).
    audiencePushEnabled: z.boolean().optional(),
    audiencePushAudienceIds: z.array(z.string()).optional(),
    // "Auto-add recordings to course" (see docs/LIVE_SESSION_RECORDING_AUTO_LINK_PLAN.md).
    // Kept optional/untouched-tracking so the DTO transform can omit the field
    // entirely in edit mode when the admin never opened this section.
    recordingAutoLink: z
        .object({
            enabled: z.boolean(),
            slideStatus: z.enum(['PUBLISHED', 'DRAFT']),
            notify: z.boolean(),
            destinations: z.array(
                z.object({
                    package_session_id: z.string(),
                    subject_id: z.string().optional(),
                    module_id: z.string().optional(),
                    chapter_id: z.string(),
                })
            ),
            /** True once the admin has interacted with this section (toggled it, or it was hydrated from an existing config in edit mode) — distinguishes "never touched" from "explicitly off". */
            touched: z.boolean(),
        })
        .optional(),
}).superRefine((data, ctx) => {
    if (data.paymentEnabled) {
        const price = parseFloat(data.paymentPrice ?? '');
        if (!data.paymentPrice || isNaN(price) || price <= 0) {
            ctx.addIssue({
                code: 'custom',
                message: t('validation.paidClassPriceRequired'),
                path: ['paymentPrice'],
            });
        }
        if (!data.paymentCurrency) {
            ctx.addIssue({
                code: 'custom',
                message: t('validation.paidClassCurrencyRequired'),
                path: ['paymentCurrency'],
            });
        }
    }
    // Every registration field is the admin's to make optional, phone number included — but a
    // registrant is looked up by their email or their mobile number, and the backend rejects a
    // submission that carries neither. So one of the two has to stay required.
    if (data.accessType === AccessType.PUBLIC && data.fields.length > 0) {
        if (!hasRequiredIdentityField(data.fields)) {
            ctx.addIssue({
                code: 'custom',
                message: t('validation.emailOrPhoneRequired'),
                path: ['fields'],
            });
        }

        // Whether the form collects this channel at all, and collects it from everyone. Fields
        // can be deleted as well as made optional, so "no phone field on the form" fails the
        // same rules as "phone field, not required".
        const collectedFrom = (role: FieldRole) => {
            const match = data.fields.find(
                (field) => field.required && classifyFieldRole(field) === role
            );
            if (match) return { ok: true as const, label: match.label };
            const optional = data.fields.find((field) => classifyFieldRole(field) === role);
            return { ok: false as const, label: optional?.label };
        };

        const demand = (role: FieldRole, why: string) => {
            const { ok, label } = collectedFrom(role);
            if (ok) return;
            ctx.addIssue({
                code: 'custom',
                message: label
                    ? t('validation.fieldStaysRequired', { label, why })
                    : t('validation.fieldRequiredGeneric', {
                          role:
                              role === FieldRole.PHONE
                                  ? t('validation.roleName.phone')
                                  : t('validation.roleName.email'),
                          why,
                      }),
                path: ['fields'],
            });
        };

        // A channel the form verifies by OTP must be collected, or every learner is stopped at
        // submit over a field the form never asked for.
        if (data.requirePhoneVerification) {
            demand(FieldRole.PHONE, t('validation.whyReason.whatsappOtp'));
        }
        if (data.requireEmailVerification) {
            demand(FieldRole.EMAIL, t('validation.whyReason.emailOtp'));
        }
        // A paid class bills and mails its invoice to the learner's email.
        if (data.paymentEnabled) {
            demand(FieldRole.EMAIL, t('validation.whyReason.paidClass'));
        }
    }
    if (
        data.accessType === AccessType.PUBLIC &&
        data.audiencePushEnabled &&
        (data.audiencePushAudienceIds?.length ?? 0) === 0
    ) {
        ctx.addIssue({
            code: 'custom',
            message: t('validation.selectAudienceList'),
            path: ['audiencePushAudienceIds'],
        });
    }
});

export const addCustomFiledSchema = z.object({
    fieldType: z.string(),
    fieldName: z.string(),
    options: z.array(z.object({ optionField: z.string() })),
});
