import { z } from 'zod';
import {
    sessionFormSchema,
    weeklyClassSchema,
    addParticipantsSchema,
} from '../schedule/-schema/schema';
import { RecurringType } from '../-constants/enums';
import type { RecordingAutoLinkConfig } from '../-services/content-link-service';

export const timeOptions = Array.from({ length: 96 }, (_, i) => {
    const hours = Math.floor(i / 4)
        .toString()
        .padStart(2, '0');
    const minutes = ((i % 4) * 15).toString().padStart(2, '0');
    return `${hours}:${minutes}`;
});

type SessionFormInput = z.infer<typeof sessionFormSchema>;
type WeeklyClass = z.infer<typeof weeklyClassSchema>;

export interface LiveSessionStep1RequestDTO {
    session_id?: string;
    title: string;
    subject: string | null;
    description_html: string | null;
    default_meet_link?: string;
    start_time: string;
    last_entry_time: string;
    session_end_date: string | null;
    recurrence_type: string;
    added_schedules: ScheduleDTO[];
    updated_schedules: ScheduleDTO[];
    deleted_schedule_ids: string[];
    institute_id: string;
    background_score_file_id?: string;
    thumbnail_file_id?: string;
    waiting_room_time?: number;
    // DEFAULT (waiting-room screen) | PRE_JOINING (join live class directly). See WaitingRoomType.
    waiting_room_type?: string;
    link_type?: string;
    allow_rewind?: boolean;
    allow_play_pause?: boolean;
    // Attendance-only institutes: true shows the class to learners.
    show_to_learners?: boolean;
    is_live?: boolean;
    session_streaming_service_type?: string;
    cover_file_id?: string | null;
    time_zone?: string;
    learner_button_config?: LearnerButtonConfig | null;
    update_recurrence_scope?: 'ONLY_THIS' | 'ALL_FUTURE' | 'CURRENT_DAY_ALL_SESSIONS' | 'ALL_FUTURE_ALL_SESSIONS' | null;
    bbb_config?: BbbMeetingConfig | null;
    feedback_config?: FeedbackConfig | null;
}

export interface BbbMeetingConfig {
    record?: boolean;
    auto_start_recording?: boolean;
    mute_on_start?: boolean;
    webcams_only_for_moderator?: boolean;
    guest_policy?: string;
    // Lock settings — restrict students only; the host keeps full access
    disable_mic?: boolean;
    disable_cam?: boolean;
    disable_private_chat?: boolean;
    disable_public_chat?: boolean;
    disable_shared_notes?: boolean;
    hide_user_list?: boolean;
    end_when_no_moderator?: boolean;
    // Opt-in: learners can turn on an on-device camera activeness score
    activeness_score?: boolean;
}

export interface FeedbackQuestionConfig {
    id: string;
    type: string;
    label: string;
    enabled: boolean;
    mandatory: boolean;
    max_stars?: number | null;
    allow_half?: boolean | null;
}

export interface FeedbackConfig {
    enabled: boolean;
    // When false, the learner cannot dismiss the feedback form — skip button
    // is hidden client-side and the backend rejects empty mandatory answers.
    allow_skip?: boolean;
    questions: FeedbackQuestionConfig[];
}

export interface LearnerButtonConfig {
    text: string;
    url: string;
    background_color: string;
    text_color: string;
    visible: boolean;
}

interface ScheduleDTO {
    id?: string;
    day: string;
    start_time: string;
    duration: string;
    link?: string;
    thumbnail_file_id?: string;
    daily_attendance?: boolean;
    default_class_link?: string | null;
    default_class_name?: string | null;
    learner_button_config?: LearnerButtonConfig | null;
}

//step 2 interface
export interface LiveSessionStep2RequestDTO {
    session_id: string;
    access_type: string;

    package_session_ids: string[];
    deleted_package_session_ids: string[];
    individual_user_ids?: string[];

    /**
     * Instructors / presenters of the class, as user ids.
     *
     * Tri-state on the backend: omit it and instructors are left alone (which
     * is what every pre-existing caller does), send `[]` to clear them, or send
     * the exact list. Cleared sessions fall back to whoever created them.
     */
    instructor_user_ids?: string[];

    /**
     * Instructors as typed by a human — user id, email or username. Used by the
     * bulk CSV import; resolved server-side against the institute directory,
     * with unmatched entries reported per row rather than failing the row.
     */
    instructor_identifiers?: string[];

    join_link: string;

    // Wall-clock schedule held before this edit, for the {{OLD_TIME}} placeholder in
    // the reschedule mail. Step 1 has already overwritten it server-side by the time
    // step 2 sends, so the backend cannot look it up itself.
    old_meeting_date?: string | null;
    old_start_time?: string | null;

    added_notification_actions: NotificationActionDTO[];
    updated_notification_actions: NotificationActionDTO[];
    deleted_notification_action_ids: string[];

    added_fields: CustomFieldDTO[];
    updated_fields: CustomFieldDTO[];
    deleted_field_ids: string[];

    // Paid live class fee. Always sent so switching a paid session back to free
    // (enabled=false) deactivates the fee server-side.
    payment_config?: LiveSessionPaymentConfigDTO;

    // Public-registration OTP verification toggles (phone = WhatsApp OTP,
    // needs the institute's approved template). Always sent explicitly so
    // unchecking turns verification off server-side.
    require_email_verification?: boolean;
    require_phone_verification?: boolean;
    // WhatsApp template for the phone OTP; empty string clears (institute default).
    whatsapp_otp_template_name?: string;

    /**
     * "Auto-add recordings to course" config. Omitted entirely (not even
     * `undefined`-serialized) when the admin never touched the section in
     * edit mode, so an update request leaves the stored config unchanged —
     * see docs/LIVE_SESSION_RECORDING_AUTO_LINK_PLAN.md.
     */
    recording_auto_link_config?: RecordingAutoLinkConfig;

    /**
     * "Save registrants to audience list(s)": push each public registrant as a
     * lead into the selected Audience Manager lists. Always sent so unchecking
     * the toggle turns the push off server-side.
     */
    audience_push_config?: {
        enabled: boolean;
        audience_ids: string[];
    };
}

export interface LiveSessionPaymentConfigDTO {
    enabled: boolean;
    price: number | null;
    currency: string | null;
    // Gateway charging this fee; null = institute default (latest ACTIVE mapping).
    vendor?: string | null;
}

export interface NotificationActionDTO {
    id: string | null;
    type: 'ON_CREATE' | 'ON_LIVE' | 'BEFORE_LIVE' | 'ATTENDANCE' | 'ON_EDIT';
    notify_by: NotifyBy;
    time: string | null;
    notify: boolean;
}

export interface NotifyBy {
    mail: boolean;
    whatsapp: boolean;
    push_notification: boolean;
    system_notification: boolean;
}

export interface CustomFieldDTO {
    id: string | null;
    label: string;
    required: boolean;
    is_default: boolean;
    type: string;
    options?: FieldOptionDTO[];
    form_order?: number;
}

export interface FieldOptionDTO {
    label: string;
    name: string;
}

/**
 * Transforms session form data into LiveSessionStep1RequestDTO.
 *
 * @param form - The submitted form data.
 * @param originalSchedules - (Optional) Previously saved schedules for update detection.
 */

// Helper to normalize a startTime string to HH:mm:ss format
function normalizeStartTime(time: string | undefined): string {
    if (!time) return '';
    // If already has seconds (HH:mm:ss), return as-is
    const parts = time.split(':');
    if (parts.length >= 3) return time;
    // HH:mm → HH:mm:00
    if (parts.length === 2) return `${time}:00`;
    return time;
}

// Helper to ensure endDate is in YYYY-MM-DD format
function normalizeEndDate(endDate: string | undefined): string | null {
    if (!endDate) return null;
    // Already in YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return endDate;
    // Has time component (ISO format) - extract date part
    if (endDate.includes('T')) return endDate.split('T')[0] || endDate;
    // Try parsing as date
    try {
        const parsed = new Date(endDate);
        if (!isNaN(parsed.getTime())) {
            const year = parsed.getFullYear();
            const month = String(parsed.getMonth() + 1).padStart(2, '0');
            const day = String(parsed.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }
    } catch {
        // ignore
    }
    return endDate;
}

type SessionInput = {
    id?: string;
    startTime?: string;
    durationHours?: string;
    durationMinutes?: string;
    link?: string;
    countAttendanceDaily?: boolean;
    thumbnailFileId?: string;
};

function buildScheduleBase(
    session: SessionInput,
    dayBlock: WeeklyClass,
    buttonConfig?: LearnerButtonConfig | null
): Omit<ScheduleDTO, 'id'> {
    const duration = Number(session.durationHours) * 60 + Number(session.durationMinutes);
    return {
        day: dayBlock.day,
        start_time: normalizeStartTime(session.startTime),
        duration: String(duration),
        link: session.link || '',
        thumbnail_file_id: session.thumbnailFileId || '',
        daily_attendance: session.countAttendanceDaily || false,
        default_class_link: dayBlock.default_class_link || null,
        default_class_name: dayBlock.default_class_name || null,
        learner_button_config: dayBlock.learner_button_config || buttonConfig || null,
    };
}

function processSession(
    session: SessionInput,
    dayBlock: WeeklyClass,
    topLevelButtonConfig: LearnerButtonConfig | null | undefined,
    originalScheduleMap: Map<string, WeeklyClass>,
    added_schedules: ScheduleDTO[],
    updated_schedules: ScheduleDTO[]
): void {
    const normalizedTime = normalizeStartTime(session.startTime);
    const duration = Number(session.durationHours) * 60 + Number(session.durationMinutes);

    // Skip incomplete sessions: must have a valid start time and non-zero duration
    if (!normalizedTime || isNaN(duration) || duration <= 0) {
        console.warn(
            `[processSession] Skipping session on ${dayBlock.day}: ` +
                `startTime="${session.startTime}", ` +
                `durationHours="${session.durationHours}", ` +
                `durationMinutes="${session.durationMinutes}", ` +
                `duration=${duration}, id=${session.id || '(new)'}. ` +
                `Reason: ${!normalizedTime ? 'empty startTime' : `invalid duration (${duration})`}`
        );
        return;
    }

    if (session.id) {
        // Session ID may be comma-separated (one per weekly occurrence)
        // Pass topLevelButtonConfig so day-level falls back to top-level (same as original)
        const base = buildScheduleBase(session, dayBlock, topLevelButtonConfig);
        const sessionIds = session.id.split(',').filter((id) => id.trim());
        sessionIds.forEach((sessionId) => {
            updated_schedules.push({ id: sessionId.trim(), ...base });
            originalScheduleMap.delete(sessionId.trim());
        });
        // Template entry without ID so backend generates new sessions for extended date ranges
        added_schedules.push({ id: undefined, ...base });
    } else {
        // New session – fall back to top-level button config when day level is absent
        added_schedules.push({
            id: undefined,
            ...buildScheduleBase(session, dayBlock, topLevelButtonConfig),
        });
    }
}

export function transformFormToDTOStep1(
    form: SessionFormInput,
    instituteId: string,
    originalSchedules: WeeklyClass[] = [],
    musicFileId: string | undefined,
    thumbnailFileId: string | undefined,
    coverFileId: string | undefined | null,
    updateRecurrenceScope?: 'ONLY_THIS' | 'ALL_FUTURE' | 'CURRENT_DAY_ALL_SESSIONS' | 'ALL_FUTURE_ALL_SESSIONS' | null
): LiveSessionStep1RequestDTO {
    const {
        id: sessionId,
        title,
        startTime,
        endDate,
        subject,
        description,
        durationHours,
        durationMinutes,
        defaultLink,
        meetingType,
        recurringSchedule = [],
        enableWaitingRoom,
        openWaitingRoomBefore,
        waitingRoomType,
        streamingType,
        sessionPlatform,
        allowRewind,
        allowPause,
        showToLearners,
        timeZone,
        learner_button_config,
        bbbRecord,
        bbbAutoStartRecording,
        bbbMuteOnStart,
        bbbWebcamsOnlyForModerator,
        bbbGuestPolicy,
        bbbDisableMic,
        bbbDisableCam,
        bbbDisablePrivateChat,
        bbbDisablePublicChat,
        bbbDisableSharedNotes,
        bbbHideUserList,
        bbbEndWhenNoModerator,
        bbbActivenessScore,
        feedbackEnabled,
        feedbackCompulsory,
        feedbackQuestions,
    } = form;

    // Convert hours and minutes to total duration in hours
    const totalDuration = Number(durationHours) + Number(durationMinutes) / 60;

    // Fix timezone handling by creating an ISO string that preserves the local time
    const [datePart, timePart] = startTime.split('T');
    const startTimeDate = new Date(`${datePart}T${timePart}`);
    const startTimeISO = new Date(
        startTimeDate.getTime() - startTimeDate.getTimezoneOffset() * 60000
    ).toISOString();
    const lastEntryTime = new Date(startTimeDate.getTime() + totalDuration * 60 * 60 * 1000);
    const lastEntryTimeISO = new Date(
        lastEntryTime.getTime() - lastEntryTime.getTimezoneOffset() * 60000
    ).toISOString();

    const added_schedules: ScheduleDTO[] = [];
    const updated_schedules: ScheduleDTO[] = [];
    const deleted_schedule_ids: string[] = [];

    // Map old schedule IDs for deletion tracking
    const originalScheduleMap = new Map<string, WeeklyClass>();
    originalSchedules.forEach((s) => {
        if (s.id) originalScheduleMap.set(s.id, s);
    });

    if (meetingType === RecurringType.WEEKLY) {
        recurringSchedule.forEach((dayBlock: WeeklyClass) => {
            if (!dayBlock.isSelect) return;
            dayBlock.sessions.forEach((session) =>
                processSession(
                    session,
                    dayBlock,
                    learner_button_config,
                    originalScheduleMap,
                    added_schedules,
                    updated_schedules
                )
            );
        });
    }

    // Anything left in originalScheduleMap is considered deleted
    for (const id of originalScheduleMap.keys()) {
        deleted_schedule_ids.push(id);
    }

    return {
        session_id: sessionId,
        title,
        subject: subject === undefined || subject === '' ? null : subject,
        description_html: description || null,
        default_meet_link: defaultLink || '',
        start_time: startTimeISO,
        last_entry_time: lastEntryTimeISO,
        session_end_date: normalizeEndDate(endDate),
        recurrence_type: meetingType,
        added_schedules,
        updated_schedules,
        deleted_schedule_ids,
        institute_id: instituteId,
        background_score_file_id: musicFileId,
        thumbnail_file_id: thumbnailFileId,
        waiting_room_time: enableWaitingRoom ? Number(openWaitingRoomBefore) : 0,
        // Type only matters while a waiting-room window exists; default otherwise.
        waiting_room_type: enableWaitingRoom ? (waitingRoomType ?? 'WAITING_ROOM') : 'WAITING_ROOM',
        link_type: sessionPlatform,
        allow_rewind: allowRewind,
        allow_play_pause: allowPause,
        show_to_learners: showToLearners,
        session_streaming_service_type: streamingType,
        cover_file_id: coverFileId,
        time_zone: timeZone,
        learner_button_config: learner_button_config || null,
        update_recurrence_scope: updateRecurrenceScope || null,
        bbb_config: sessionPlatform === 'bbb' ? {
            record: bbbRecord ?? true,
            auto_start_recording: bbbAutoStartRecording ?? false,
            mute_on_start: bbbMuteOnStart ?? true,
            webcams_only_for_moderator: bbbWebcamsOnlyForModerator ?? false,
            guest_policy: bbbGuestPolicy ?? 'ALWAYS_ACCEPT',
            disable_mic: bbbDisableMic ?? false,
            disable_cam: bbbDisableCam ?? false,
            disable_private_chat: bbbDisablePrivateChat ?? false,
            disable_public_chat: bbbDisablePublicChat ?? false,
            disable_shared_notes: bbbDisableSharedNotes ?? false,
            hide_user_list: bbbHideUserList ?? false,
            end_when_no_moderator: bbbEndWhenNoModerator ?? false,
            activeness_score: bbbActivenessScore ?? false,
        } : null,
        feedback_config: feedbackEnabled ? {
            enabled: true,
            allow_skip: !feedbackCompulsory,
            questions: feedbackQuestions ?? [],
        } : { enabled: false, allow_skip: true, questions: [] },
    };
}

type FormData = z.infer<typeof addParticipantsSchema>;

/** The two fields of a saved schedule the reschedule mail needs. */
export interface PreviousScheduleInput {
    start_time?: string | null;
    meeting_date?: string | null;
}

/**
 * Splits a saved schedule into the wall-clock date/time that fills {{OLD_TIME}}.
 *
 * Reads `start_time` exactly as step 1 does — slice the leading YYYY-MM-DDTHH:mm
 * rather than parsing to a Date — so the value is never shifted by the admin's
 * browser timezone on its way back to the backend.
 */
function toOldScheduleFields(previous?: PreviousScheduleInput | null): {
    old_meeting_date: string | null;
    old_start_time: string | null;
} {
    const empty = { old_meeting_date: null, old_start_time: null };
    const startTime = previous?.start_time;
    if (!startTime) return empty;

    if (startTime.includes('T')) {
        const [datePart, timePart] = startTime.substring(0, 16).split('T');
        if (!datePart || !timePart) return empty;
        return { old_meeting_date: datePart, old_start_time: normalizeStartTime(timePart) };
    }
    if (previous?.meeting_date) {
        return {
            old_meeting_date: previous.meeting_date.substring(0, 10),
            old_start_time: normalizeStartTime(startTime),
        };
    }
    return empty;
}

export function transformFormToDTOStep2(
    formData: FormData,
    sessionId: string,
    packageSessionIds: string[],
    previousSchedule?: PreviousScheduleInput | null,
    /**
     * Batches the admin unlinked during this edit. `linkParticipants` on the
     * backend is purely additive apart from this list — it deletes ONLY the ids
     * named here — so leaving it empty (as this used to) meant a deselected
     * batch stayed linked and kept showing up under the class.
     */
    deletedPackageSessionIds: string[] = []
): LiveSessionStep2RequestDTO {
    const {
        accessType,
        joinLink,
        notifyBy,
        notifySettings,
        fields,
        selectedLearners,
        batchSelectionType,
        paymentEnabled,
        paymentPrice,
        paymentCurrency,
        paymentVendor,
        requireEmailVerification,
        requirePhoneVerification,
        whatsappOtpTemplateName,
        recordingAutoLink,
        audiencePushEnabled,
        audiencePushAudienceIds,
        instructorUserIds,
    } = formData;

    const addedNotificationActions: NotificationActionDTO[] = [];

    const notifyByPayload: NotifyBy = {
        mail: notifyBy.mail,
        whatsapp: notifyBy.whatsapp,
        push_notification: notifyBy.push_notification,
        system_notification: notifyBy.system_notification,
    };

    if (notifySettings.onCreate) {
        addedNotificationActions.push({
            id: null,
            type: 'ON_CREATE',
            notify_by: notifyByPayload,
            notify: true,
            time: null,
        });
    }

    if (notifySettings.onEdit) {
        addedNotificationActions.push({
            id: null,
            type: 'ON_EDIT',
            notify_by: notifyByPayload,
            notify: true,
            time: null,
        });
    }

    if (notifySettings.onLive) {
        addedNotificationActions.push({
            id: null,
            type: 'ON_LIVE',
            notify_by: notifyByPayload,
            notify: true,
            time: null,
        });
    }

    if (notifySettings.beforeLive && notifySettings.beforeLiveTime) {
        notifySettings.beforeLiveTime.forEach(({ time }) => {
            addedNotificationActions.push({
                id: null,
                type: 'BEFORE_LIVE',
                notify_by: notifyByPayload,
                notify: true,
                time,
            });
        });
    }

    if (notifySettings.onAttendance) {
        addedNotificationActions.push({
            id: null,
            type: 'ATTENDANCE',
            notify_by: notifyByPayload,
            notify: true,
            time: null,
        });
    }
    const { added_fields, update_fields } = fields.reduce(
        (acc, field, index) => {
            const fieldData: CustomFieldDTO = {
                id: field.id ?? null,
                label: field.label,
                required: field.required,
                is_default: field.isDefault,
                type: field.type,
                options: field.options,
                form_order: index,
            };

            if (field.id) {
                acc.update_fields.push(fieldData);
            } else {
                acc.added_fields.push(fieldData);
            }

            return acc;
        },
        {
            added_fields: [] as CustomFieldDTO[],
            update_fields: [] as CustomFieldDTO[],
        }
    );

    const { old_meeting_date, old_start_time } = toOldScheduleFields(previousSchedule);

    const result: LiveSessionStep2RequestDTO = {
        session_id: sessionId,
        access_type: accessType,
        package_session_ids: batchSelectionType === 'batch' ? packageSessionIds : [],
        deleted_package_session_ids: batchSelectionType === 'batch' ? deletedPackageSessionIds : [],
        join_link: joinLink,
        old_meeting_date,
        old_start_time,
        added_notification_actions: addedNotificationActions,
        updated_notification_actions: [],
        deleted_notification_action_ids: [],
        added_fields: added_fields,
        updated_fields: update_fields,
        deleted_field_ids: [],
        payment_config: {
            enabled: !!paymentEnabled,
            price: paymentEnabled ? parseFloat(paymentPrice ?? '') || null : null,
            currency: paymentEnabled ? (paymentCurrency ?? null) : null,
            vendor: paymentEnabled ? paymentVendor || null : null,
        },
        require_email_verification: !!requireEmailVerification,
        require_phone_verification: !!requirePhoneVerification,
        whatsapp_otp_template_name: requirePhoneVerification
            ? (whatsappOtpTemplateName ?? '')
            : '',
        audience_push_config: {
            enabled: !!audiencePushEnabled,
            audience_ids: audiencePushEnabled ? (audiencePushAudienceIds ?? []) : [],
        },
    };

    // Only sent when the form actually carries a list. Omitting it leaves the
    // stored instructors untouched, which is what keeps callers that don't know
    // about instructors (and the edit flows that don't render the picker)
    // from silently wiping them.
    if (instructorUserIds) {
        result.instructor_user_ids = instructorUserIds;
    }

    // Add individual user IDs if individual selection is used
    if (batchSelectionType === 'individual' && selectedLearners) {
        result.individual_user_ids = selectedLearners;
    }

    // "Auto-add recordings to course": only meaningful for batch mode, and
    // only sent when the admin actually opened/edited the section — omitting
    // it on update leaves the stored config untouched (per the contract).
    if (recordingAutoLink?.touched && batchSelectionType === 'batch') {
        const selectedPackageSessionIds = new Set(packageSessionIds);
        result.recording_auto_link_config = {
            enabled: recordingAutoLink.enabled,
            slide_status: recordingAutoLink.slideStatus,
            notify: recordingAutoLink.notify,
            // Drop destinations for batches the admin has since deselected.
            destinations: recordingAutoLink.destinations
                .filter((d) => selectedPackageSessionIds.has(d.package_session_id))
                .map((d) => ({
                    package_session_id: d.package_session_id,
                    subject_id: d.subject_id ?? '',
                    module_id: d.module_id ?? '',
                    chapter_id: d.chapter_id,
                })),
        };
    }

    return result;
}
