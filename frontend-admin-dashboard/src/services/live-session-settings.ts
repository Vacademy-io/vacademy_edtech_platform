import { GET_INSTITUTE_SETTING_DATA, SAVE_INSTITUTE_SETTING } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { WaitingRoomType } from '@/routes/study-library/live-session/-constants/enums';

export const SETTING_KEY_LIVE_SESSION = 'LIVE_SESSION_SETTING';

/**
 * Stable identifiers used in the LiveSessionSettings document. They map to the
 * `value` strings already used by `STREAMING_OPTIONS` so the schedule UI can
 * filter directly without translation.
 */
export const PLATFORM_KEYS = [
    'youtube',
    'google meet',
    'zoom',
    'zoho',
    'bbb',
    'other',
] as const;
export type PlatformKey = (typeof PLATFORM_KEYS)[number];

/** How guest learners are admitted to a Vacademy Meet (BBB) live class. */
export type LiveSessionGuestPolicy = 'ALWAYS_ACCEPT' | 'ASK_MODERATOR' | 'ALWAYS_DENY';

/** Zoom registration approval: 0 = auto-approve, 1 = manual, 2 = no registration. */
export type ZoomApprovalType = '0' | '1' | '2';
/** Zoom audio options. */
export type ZoomAudioOption = 'both' | 'telephony' | 'voip';
/** Zoom automatic-recording options. */
export type ZoomAutoRecordingOption = 'cloud' | 'local' | 'none';

/** How much of the institute's live-session list one role may see. */
export type LiveSessionVisibilityMode = 'ALL' | 'OWN' | 'SPECIFIC_ROLES';

export interface LiveSessionRoleVisibilityRule {
    mode: LiveSessionVisibilityMode;
    /**
     * Role names whose sessions this role may also see. Read only when
     * `mode === 'SPECIFIC_ROLES'`; the user's own sessions are always included
     * on top of these.
     */
    roles: string[];
}

/** A session's instructor as the backend returns it. */
export interface LiveSessionInstructor {
    user_id: string;
    full_name?: string | null;
    email?: string | null;
    profile_pic_file_id?: string | null;
}

export interface LiveSessionSettings {
    /** Per-platform allow-list. Missing key is treated as `true` (allowed). */
    allowedPlatforms: Partial<Record<PlatformKey, boolean>>;
    /**
     * Platform pre-selected in the "Live Stream Platform" dropdown on new live
     * classes (single-class step 1 and the bulk grid's default for new rows).
     * Must be one of the allowed platforms — the settings UI keeps it in sync
     * and the forms fall back to `'other'` if it ever points at a hidden
     * platform. Admins can still change it per class.
     */
    defaultPlatform: PlatformKey;
    /**
     * Whether learners can submit feedback after a session. Acts as the master
     * feature flag: when `false`, the entire "Learner Feedback" card is hidden
     * from both the single-class and bulk scheduling flows (admins can't turn
     * feedback on per session), and new classes never collect feedback.
     */
    feedbackEnabled: boolean;
    /**
     * Default value for the per-session "Learner Feedback" toggle. When `true`,
     * new live sessions start with post-session feedback collection turned ON
     * (admins can still flip it off per session). Applies to single and bulk
     * scheduling. Only takes effect while `feedbackEnabled` is `true`.
     */
    defaultFeedbackEnabled: boolean;
    /**
     * Default value for the per-session "Make feedback compulsory" toggle.
     * When `true`, new live sessions start with feedback marked as compulsory
     * (allow_skip = false). Admins can still flip the toggle per session.
     */
    defaultFeedbackCompulsory: boolean;
    /**
     * Default value for the per-session "Enable Waiting Room or Pre-Joining"
     * toggle on new live-class forms (single-class step 1 and the bulk grid's
     * shared options). Admins can still flip it per class.
     */
    defaultWaitingRoomEnabled: boolean;
    /**
     * Default waiting-room behaviour pre-filled on new live classes:
     * `WAITING_ROOM` shows a waiting-room screen, `PRE_JOINING` lets learners
     * join the live class directly during the pre-start window.
     */
    defaultWaitingRoomType: WaitingRoomType;
    /**
     * Default "open waiting room before" duration in minutes, stored as a
     * string to match the select option values (e.g. `'15'`). Pre-filled on
     * new live classes; admins can still change it per class.
     */
    defaultWaitingRoomTime: string;
    /** Whether the "Bulk Schedule" mode appears in step 1. */
    bulkScheduleEnabled: boolean;
    /** Whether the "Single Class" mode appears in step 1. Cannot be false at the same time as bulk. */
    singleScheduleEnabled: boolean;
    /** Whether the "Recurring Class" radio appears under Single Class mode. */
    recurringEnabled: boolean;
    /** Whether the day-level default class link card renders inside recurring days. */
    defaultDayButtonEnabled: boolean;
    /** Whether the page-level "Custom Action Button" card renders in step 1. */
    customActionButtonEnabled: boolean;
    /**
     * IANA timezone (e.g. `Asia/Kolkata`) used as the default in new live-class
     * forms. Empty string means "use the browser's timezone". Admins can still
     * change it per-class while scheduling.
     */
    defaultTimeZone: string;
    /**
     * Default value for the per-session "Daily attendance" toggle on a recurring
     * class. When `true`, every newly added session inside a recurring schedule
     * starts with daily attendance counting enabled. Admins can still flip the
     * toggle per session while scheduling.
     */
    defaultDailyAttendanceCounting: boolean;
    /**
     * Whether the Description input is shown in live-class scheduling flows
     * (single-class step 1, bulk default description, and per-row description).
     * When `false`, all description UI is hidden and saved descriptions remain
     * empty.
     */
    descriptionEnabled: boolean;
    /**
     * Whether the "Process Recording" entry point appears next to each BBB
     * recording. When `false`, admins/teachers don't see the transcribe
     * button (and so can't kick off Whisper jobs). Existing transcripts on
     * already-processed recordings remain viewable — only the *new*
     * processing entry point is hidden. Default is OFF so transcription
     * stays an opt-in feature an admin has to explicitly enable.
     */
    recordingTranscriptionEnabled: boolean;
    /**
     * "Minimum attendance" — a learner counts as present only if they were
     * actually in the class for at least `minDurationPercent` of its scheduled
     * length, rather than merely having clicked Join. Off means today's
     * behaviour. A learner who never appears in the provider's roster counts as
     * zero minutes, so click-and-never-arrive is caught by the same rule.
     *
     * Works for Vacademy Meet and Zoom, which both report who was in the room.
     * Google Meet cannot be supported — its API returns participants with no
     * email, so they can't be tied back to a learner; a Meet class carries the
     * setting but is never evaluated.
     *
     * This is a scheduling-time default, not a live switch: the backend copies
     * it onto each class as it is created. Turning it on affects classes
     * scheduled from then on, and turning it off returns later classes to
     * today's behaviour without re-deciding any class already held.
     */
    defaultAttendanceCriteria: {
        enabled: boolean;
        minDurationPercent: number;
    };
    /**
     * Who can see which live sessions, keyed by role name (upper-case, custom
     * roles included).
     *
     * A role with no entry — which is every role until an admin configures one
     * — means ALL, i.e. exactly the behaviour that existed before this setting:
     * one institute-wide list. A user holding several roles gets the most
     * permissive of their rules, so restricting one role cannot accidentally
     * restrict an admin who also holds it.
     *
     * Enforced server-side on the lists, search, detail, edit and delete — this
     * is access control, not just a filtered view.
     */
    roleVisibility: Record<string, LiveSessionRoleVisibilityRule>;
    /**
     * "LMS Connection" — bridges live classes into course content (the LMS).
     * `recordingAddToCourseEnabled` shows/hides the per-recording "Add to
     * course" action on the session view page; `classMaterialsEnabled`
     * shows/hides the Class Materials card (PDF/video upload → chapter).
     * Both default OFF (opt-in per institute); turning one off hides only
     * the entry point — content already linked stays in its chapters.
     */
    lmsConnection: {
        recordingAddToCourseEnabled: boolean;
        classMaterialsEnabled: boolean;
        /**
         * Institute-wide auto-upload: when `true`, sessions can pick their own
         * recording→chapter destination during scheduling (see the Step 2
         * "Auto-add recordings to course" card), and any session left without
         * its own config falls back to `autoUploadDefaultDestination` below.
         */
        autoUploadRecordingsEnabled: boolean;
        /**
         * When a recording is auto-uploaded via the institute-default fallback,
         * also email enrolled learners ("New Study Material Available"). The
         * Step 2 per-session config carries its own notify flag; this only
         * governs the fallback path.
         */
        autoUploadNotifyLearners: boolean;
        /**
         * Institute-wide fallback destination used when a recording arrives for
         * a session that has no per-session auto-link config of its own. A
         * chapter is always batch-scoped, so `packageSessionId` travels with it.
         * `subjectId`/`moduleId` may be null when the course's depth collapses
         * that level (see course-depth handling in the picker).
         */
        autoUploadDefaultDestination?: {
            packageSessionId: string;
            subjectId?: string | null;
            moduleId?: string | null;
            chapterId: string;
        } | null;
    };
    /**
     * Defaults for the "Vacademy Meet recording & controls" block. These only
     * affect live classes whose platform is Vacademy Meet (BBB); other
     * platforms ignore them. Pre-filled on new single-class and bulk forms;
     * admins can still change them per class.
     */
    /** Default "record the session" toggle. */
    defaultBbbRecordEnabled: boolean;
    /** Default "auto-start recording" toggle (only meaningful when recording is on). */
    defaultBbbAutoStartRecording: boolean;
    /** Default "mute participants on join" toggle. */
    defaultBbbMuteOnStart: boolean;
    /** Default "only host can share webcam" toggle. */
    defaultBbbWebcamsOnlyForModerator: boolean;
    /** Default guest admission policy. */
    defaultBbbGuestPolicy: LiveSessionGuestPolicy;
    /**
     * Default "participants join in listen-only mode" toggle. Pins viewers to the
     * shared listen-only audio path so no participant can take an individual mic
     * channel — the setting to use for broadcast-style classes.
     */
    defaultBbbDisableMic: boolean;
    /** Default "participants can't turn on their camera" toggle. */
    defaultBbbDisableCam: boolean;
    /** Default "disable private chat for students" toggle (host is unaffected). */
    defaultBbbDisablePrivateChat: boolean;
    /** Default "disable public chat for students" toggle (host is unaffected). */
    defaultBbbDisablePublicChat: boolean;
    /** Default "disable shared notes for students" toggle (host is unaffected). */
    defaultBbbDisableSharedNotes: boolean;
    /** Default "hide participant list from students" toggle (host is unaffected). */
    defaultBbbHideUserList: boolean;
    /** Default "end class when host leaves" toggle. */
    defaultBbbEndWhenNoModerator: boolean;
    /**
     * Defaults for the "Notifications" block (channels + triggers) applied to
     * new live classes in both single-class step 2 and the bulk grid. Admins
     * can still change them per class.
     */
    /** Default "Notify via Email" channel. */
    defaultNotifyByEmail: boolean;
    /** Default "Notify via WhatsApp" channel. */
    defaultNotifyByWhatsapp: boolean;
    /** Default "Notify via Push Notification" channel. */
    defaultNotifyByPush: boolean;
    /** Default "Notify via System Notification" channel. */
    defaultNotifyBySystem: boolean;
    /** Default trigger: notify when the live class is created. */
    defaultNotifyOnCreate: boolean;
    /** Default trigger: notify when the class goes live. */
    defaultNotifyOnLive: boolean;
    /** Default trigger: notify when attendance is marked (present/absent). */
    defaultNotifyOnAttendance: boolean;
    /**
     * Default "notify before class" reminder offset, e.g. `'30m'` or `'1h'`.
     * Empty string means no reminder is pre-seeded. When set, new classes start
     * with one reminder at this offset (admins can add/remove more).
     */
    defaultNotifyBeforeReminder: string;
    /**
     * Zoom meeting defaults, pre-filled in the single-class Zoom settings panel.
     * They only apply to single-class live sessions hosted on Zoom with a
     * connected account — bulk scheduling has no Zoom provisioning. Field names
     * mirror the Zoom REST "settings" object. Admins can still change them per
     * class.
     */
    /** Default "enable waiting room". */
    defaultZoomWaitingRoom: boolean;
    /** Default "allow join before host". */
    defaultZoomJoinBeforeHost: boolean;
    /** Default "require Zoom login to join". */
    defaultZoomMeetingAuthentication: boolean;
    /** Default registration approval type. */
    defaultZoomApprovalType: ZoomApprovalType;
    /** Default "mute participants on entry". */
    defaultZoomMuteUponEntry: boolean;
    /** Default "start host video on". */
    defaultZoomHostVideo: boolean;
    /** Default "start participant video on". */
    defaultZoomParticipantVideo: boolean;
    /** Default audio option. */
    defaultZoomAudio: ZoomAudioOption;
    /** Default automatic-recording option. */
    defaultZoomAutoRecording: ZoomAutoRecordingOption;
    /** Default "enable breakout rooms". */
    defaultZoomBreakoutRoom: boolean;
    /** Default "start in focus mode". */
    defaultZoomFocusMode: boolean;
    /** Default "allow join from multiple devices". */
    defaultZoomAllowMultipleDevices: boolean;
    /** Default "add identity watermark". */
    defaultZoomWatermark: boolean;
    /*
     * Google Meet defaults, pre-filled in the Google Meet panel of a single class hosted on
     * Meet with a connected account (keys read by GoogleMeetManager.buildSpaceConfig).
     * Auto-record and join access are NOT here: they live on each connected Google account.
     * Admins can still change them per class.
     */
    /** Default "auto-generate transcript". */
    defaultGoogleMeetTranscription: boolean;
    /** Default "Gemini notes (Take notes for me)". */
    defaultGoogleMeetSmartNotes: boolean;
    /** Default "Google attendance report". */
    defaultGoogleMeetAttendanceReport: boolean;
    /** Default "turn on host controls" — the four restrictions below apply only with it on. */
    defaultGoogleMeetHostManagement: boolean;
    /** Default "only hosts can chat". */
    defaultGoogleMeetChatHostsOnly: boolean;
    /** Default "only hosts can send reactions". */
    defaultGoogleMeetReactionsHostsOnly: boolean;
    /** Default "only hosts can share screen". */
    defaultGoogleMeetPresentHostsOnly: boolean;
    /** Default "learners join as viewers". */
    defaultGoogleMeetJoinAsViewer: boolean;
    /**
     * Master switch for the disclaimer video. Off for every institute by default,
     * so nothing changes for anyone until an admin turns it on here.
     *
     * This is also the VISIBILITY GATE for the per-class control: the disclaimer
     * option only appears on the live-class form while this is on, so institutes
     * not using the feature never meet it while scheduling.
     */
    disclaimerVideoEnabled: boolean;
    /**
     * Video every learner watches once, before their FIRST live class of this
     * institute — not per session and not per day. Blank means no disclaimer.
     *
     * Who has already seen it is derived from attendance: a learner marked
     * present in any of this institute's classes is not asked again.
     */
    disclaimerVideoUrl: string;
    /**
     * "Attendance only" mode for institutes that teach offline and create live
     * classes purely to record attendance. When on, learners never see the
     * institute's live classes (upcoming, live or past) — only their
     * attendance. Enforced server-side on the learner list endpoints. A live
     * switch, not a scheduling default: it applies to existing classes too.
     * Off by default.
     */
    attendanceOnlyMode: boolean;
}

export const DEFAULT_LIVE_SESSION_SETTINGS: LiveSessionSettings = {
    allowedPlatforms: {
        youtube: true,
        'google meet': true,
        zoom: true,
        zoho: true,
        bbb: true,
        other: true,
    },
    defaultPlatform: 'other',
    feedbackEnabled: true,
    defaultFeedbackEnabled: true,
    defaultFeedbackCompulsory: false,
    defaultWaitingRoomEnabled: false,
    defaultWaitingRoomType: WaitingRoomType.WAITING_ROOM,
    defaultWaitingRoomTime: '15',
    bulkScheduleEnabled: true,
    singleScheduleEnabled: true,
    recurringEnabled: true,
    defaultDayButtonEnabled: true,
    customActionButtonEnabled: true,
    defaultTimeZone: '',
    defaultDailyAttendanceCounting: false,
    descriptionEnabled: true,
    recordingTranscriptionEnabled: false,
    defaultAttendanceCriteria: {
        enabled: false,
        minDurationPercent: 60,
    },
    // Empty = every role sees every session, which is the pre-existing behaviour.
    roleVisibility: {},
    lmsConnection: {
        recordingAddToCourseEnabled: false,
        classMaterialsEnabled: false,
        autoUploadRecordingsEnabled: false,
        autoUploadNotifyLearners: false,
        autoUploadDefaultDestination: null,
    },
    defaultBbbRecordEnabled: true,
    defaultBbbAutoStartRecording: false,
    defaultBbbMuteOnStart: true,
    defaultBbbWebcamsOnlyForModerator: false,
    defaultBbbGuestPolicy: 'ALWAYS_ACCEPT',
    defaultBbbDisableMic: false,
    defaultBbbDisableCam: false,
    defaultBbbDisablePrivateChat: false,
    defaultBbbDisablePublicChat: false,
    defaultBbbDisableSharedNotes: false,
    defaultBbbHideUserList: false,
    defaultBbbEndWhenNoModerator: false,
    defaultNotifyByEmail: false,
    defaultNotifyByWhatsapp: false,
    defaultNotifyByPush: false,
    defaultNotifyBySystem: false,
    defaultNotifyOnCreate: false,
    defaultNotifyOnLive: true,
    defaultNotifyOnAttendance: false,
    defaultNotifyBeforeReminder: '',
    defaultZoomWaitingRoom: true,
    defaultZoomJoinBeforeHost: false,
    defaultZoomMeetingAuthentication: false,
    defaultZoomApprovalType: '2',
    defaultZoomMuteUponEntry: true,
    defaultZoomHostVideo: false,
    defaultZoomParticipantVideo: false,
    defaultZoomAudio: 'both',
    defaultZoomAutoRecording: 'cloud',
    defaultZoomBreakoutRoom: false,
    defaultZoomFocusMode: false,
    defaultZoomAllowMultipleDevices: false,
    defaultZoomWatermark: false,
    defaultGoogleMeetTranscription: false,
    defaultGoogleMeetSmartNotes: false,
    defaultGoogleMeetAttendanceReport: false,
    defaultGoogleMeetHostManagement: false,
    defaultGoogleMeetChatHostsOnly: false,
    defaultGoogleMeetReactionsHostsOnly: false,
    defaultGoogleMeetPresentHostsOnly: false,
    defaultGoogleMeetJoinAsViewer: false,
    // Off by default: no institute gets a disclaimer in front of its learners,
    // and the per-class control stays hidden, until an admin turns this on.
    disclaimerVideoEnabled: false,
    disclaimerVideoUrl: '',
    attendanceOnlyMode: false,
};

// The institute being worked in (selected institute, falling back to the token's first only
// when none is selected) — NOT always the token's first institute. A multi-institute user
// otherwise read and saved this setting on the wrong institute, and the backend now rejects
// a setting save whose clientId isn't the target instituteId.
const getInstituteId = (): string => {
    const instituteId = getCurrentInstituteId();
    if (!instituteId) throw new Error('No institute ID found in token');
    return instituteId;
};

export const getLiveSessionSettings = async (): Promise<LiveSessionSettings> => {
    try {
        const instituteId = getInstituteId();
        const response = await authenticatedAxiosInstance.get(GET_INSTITUTE_SETTING_DATA, {
            params: { instituteId, settingKey: SETTING_KEY_LIVE_SESSION },
        });
        // The /data endpoint returns SettingDto.data directly — i.e. the
        // exact object we previously persisted, or null if the institute
        // hasn't saved this setting yet. We merge with defaults so any flag
        // that's been added since the last save is treated as enabled.
        const raw = response.data;
        if (!raw || typeof raw !== 'object') return DEFAULT_LIVE_SESSION_SETTINGS;
        const partial = raw as Partial<LiveSessionSettings>;
        return {
            ...DEFAULT_LIVE_SESSION_SETTINGS,
            ...partial,
            allowedPlatforms: {
                ...DEFAULT_LIVE_SESSION_SETTINGS.allowedPlatforms,
                ...(partial.allowedPlatforms ?? {}),
            },
            lmsConnection: {
                ...DEFAULT_LIVE_SESSION_SETTINGS.lmsConnection,
                ...(partial.lmsConnection ?? {}),
            },
            defaultAttendanceCriteria: {
                ...DEFAULT_LIVE_SESSION_SETTINGS.defaultAttendanceCriteria,
                ...(partial.defaultAttendanceCriteria ?? {}),
            },
            // Replaced wholesale, not merged: a removed rule must actually be
            // removed. Merging would make a role impossible to reset to ALL.
            roleVisibility: partial.roleVisibility ?? {},
        };
    } catch (err) {
        console.error('Failed to load live-session settings, using defaults', err);
        return DEFAULT_LIVE_SESSION_SETTINGS;
    }
};

export const saveLiveSessionSettings = async (settings: LiveSessionSettings): Promise<void> => {
    const instituteId = getInstituteId();
    // Backend GenericSettingRequest uses @JsonNaming(SnakeCaseStrategy) so the
    // wire format must be snake_case — sending camelCase here means
    // setting_data arrives as null and the save silently no-ops.
    await authenticatedAxiosInstance.post(
        SAVE_INSTITUTE_SETTING,
        {
            setting_name: 'Live Session Settings',
            setting_data: settings,
        },
        {
            params: { instituteId, settingKey: SETTING_KEY_LIVE_SESSION },
        }
    );
};
