import {
    BASE_URL,
    GET_LIVE_SESSIONS,
    GET_PAST_SESSIONS,
    GET_UPCOMING_SESSIONS,
    GET_DRAFT_SESSIONS,
    GET_SESSION_BY_SESSION_ID,
    LIVE_SESSION_REPORT_BY_SESSION_ID,
    STUDENT_ATTENDANCE_REPORT,
    BATCH_SESSION_ATTENDANCE_REPORT,
    SEARCH_SESSIONS,
    ADMIN_MARK_ATTENDANCE,
    GET_SCHEDULE_RECORDINGS,
    SYNC_RECORDINGS_FROM_BBB,
    SYNC_RECORDINGS_TO_S3,
    SYNC_GOOGLE_RECORDINGS,
    ATTACH_GOOGLE_RECORDING_FILE,
    SAVE_GOOGLE_RECORDING_TO_LIBRARY,
    ZOOM_PROVISION_STATUS,
    ZOOM_PROVISION_NOW,
    RECORDING_TRANSCRIBE,
    RECORDING_CREATE_ASSESSMENT,
    RECORDING_STUDY_NOTES,
    RECORDING_PUBLISH_ASSESSMENT,
    RECORDING_LIST_ASSESSMENTS,
} from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import type { RecordingAutoLinkConfig } from './content-link-service';

export interface LiveSession {
    session_id: string;
    schedule_id: string;
    meeting_date: string;
    start_time: string;
    last_entry_time: string;
    recurrence_type: string;
    access_level: string;
    title: string;
    subject: string;
    meeting_link: string;
    registration_form_link_for_public_sessions: string;
    allow_rewind?: boolean | null;
    timezone?: string;
    default_class_link?: string | null;
    default_class_name?: string | null;
    learner_button_config?: {
        text: string;
        url: string;
        background_color: string;
        text_color: string;
        visible: boolean;
    } | null;
}

export interface SessionsByDate {
    date: string;
    sessions: Array<{
        session_id: string;
        schedule_id: string;
        meeting_date: string;
        start_time: string;
        last_entry_time: string;
        recurrence_type: string;
        access_level: string;
        title: string;
        subject: string;
        meeting_link: string;
        registration_form_link_for_public_sessions: string;
        timezone?: string;
    }>;
}

export interface DraftSession {
    instructors?: LiveSessionInstructor[] | null;
    session_id: string;
    waiting_room_time: number | null;
    thumbnail_file_id: string | null;
    background_score_file_id: string | null;
    session_streaming_service_type: string | null;
    schedule_id: string | null;
    meeting_date: string | null;
    start_time: string | null;
    last_entry_time: string | null;
    recurrence_type: string;
    access_level: string | null;
    title: string;
    subject: string | null;
    meeting_link: string;
    registration_form_link_for_public_sessions: string | null;
    timezone?: string;
    /** Same rows the live/past cards get — the list spreads one search row into
     *  every card shape, so drafts have had this on the wire all along. */
    package_session_details?: Array<{
        package_session_id: string;
        package_name: string;
        level_name: string;
        session_name: string;
    }> | null;
}

export type UpcomingSessionDay = SessionsByDate;
export type PastSessionDay = SessionsByDate;
export type DraftSessionDay = DraftSession;

export interface Schedule {
    session_id: string;
    institute_id: string;
    title: string;
    subject: string | null;
    description_html: string | null;
    default_meet_link: string;
    start_time: string;
    last_entry_time: string;
    link_type: string;
    join_link: string;
    recurrence_type: string | null;
    session_end_date: string;
    access_type: string;
    waiting_room_time: number | null;
    allow_rewind: boolean | null;
    allow_play_pause: boolean | null;
    show_to_learners?: boolean | null;
    thumbnail_file_id: string | null;
    background_score_file_id: string | null;
    cover_file_id: string | null;
    session_streaming_service_type: string | null;
    bbb_config?: {
        record?: boolean;
        auto_start_recording?: boolean;
        mute_on_start?: boolean;
        webcams_only_for_moderator?: boolean;
        guest_policy?: string;
        disable_mic?: boolean;
        disable_cam?: boolean;
        disable_private_chat?: boolean;
        disable_public_chat?: boolean;
        disable_shared_notes?: boolean;
        hide_user_list?: boolean;
        end_when_no_moderator?: boolean;
        activeness_score?: boolean;
    } | null;
    feedback_config?: {
        enabled?: boolean;
        allow_skip?: boolean;
        questions?: Array<{
            id: string;
            type: string;
            label: string;
            enabled: boolean;
            mandatory: boolean;
            max_stars?: number;
            allow_half?: boolean;
        }>;
    } | null;
    schedule_id: string | null;
    meeting_date: string | null;
    timezone?: string;
    package_session_ids: string[];
    /** Auto-add-recordings-to-course config, echoed back for edit-mode prefill. Null/absent when never configured. */
    recording_auto_link_config?: RecordingAutoLinkConfig | null;
    package_session_details?: Array<{
        package_session_id: string;
        package_name: string;
        level_name: string;
        session_name: string;
    }> | null;
    added_schedules: Array<{
        day: string;
        startTime: string;
        duration: string;
        link: string;
        id: string;
        meetingDate?: string;
        thumbnailFileId: string;
        countAttendanceDaily: boolean;
        dailyAttendance?: boolean;
        default_class_link?: string | null;
        default_class_name?: string | null;
        learner_button_config?: {
            text: string;
            url: string;
            background_color: string;
            text_color: string;
            visible: boolean;
        } | null;
        providerRecordingsJson?: string | null;
    }>;
}

export interface MeetingRecording {
    recordingId: string;
    downloadUrl?: string;
    playbackUrl?: string;
    durationSeconds: number;
    startTime?: string;
    providerMeetingId?: string;
    fileId?: string;
    type?: string;
    /** Zoom cloud-recording passcode shown as a fallback when the embedded ?pwd= is rejected. */
    passcode?: string;
    /**
     * Where the recording lives: 'ZOOM_CLOUD' (provider, expires), 'GOOGLE_DRIVE' (Meet, organiser's
     * Drive — admin must upload a copy) or 'S3' (mirrored/uploaded, permanent).
     */
    recordingStorage?: string;
    /** ISO-8601 provider auto-delete time (Zoom ~30 days). Drives the "expires in N days" badge. */
    expiresAt?: string;
    /** Set by the YouTube upload worker once the recording has been published. */
    youtubeVideoId?: string;
    youtubeVideoUrl?: string;

    // Transcription state (populated server-side from ai_content_extraction).
    // Null/undefined when no transcription has ever been requested.
    transcriptStatus?: TranscriptStatus | null;
    detectedLanguage?: string;
    englishTranscriptUrl?: string;
    transcriptionError?: string;
}

export type TranscriptStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';

/** Server-side TranscriptionStatusDto. status is null when no extraction row exists yet. */
export interface RecordingTranscriptionStatus {
    recordingId: string;
    status: TranscriptStatus | null;
    jobId?: string | null;
    detectedLanguage?: string | null;
    languageProbability?: number | null;
    durationSeconds?: number | null;
    segmentCount?: number | null;
    wordCount?: number | null;
    sourceTextUrl?: string | null;
    englishTextUrl?: string | null;
    errorMessage?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    /** Cached study notes Markdown — non-null when the user has previously
     * clicked "Generate Lecture Notes" on this recording. The dialog uses
     * this to skip the action picker and jump straight to the notes view. */
    savedNotesMarkdown?: string | null;
    /** ISO timestamp of when {@link savedNotesMarkdown} was produced. Used
     * for the "Generated X ago" hint above cached notes. */
    savedNotesGeneratedAt?: string | null;
}

export interface NotificationAction {
    id: string;
    type: string;
    notifyBy: {
        mail: boolean;
        whatsapp: boolean;
        push_notification?: boolean;
        system_notification?: boolean;
    };
    notify: boolean;
    time: string | null;
}

export interface Field {
    id: string;
    type: string;
    label: string;
    required: boolean;
    isDefault: boolean | null;
}

export interface Notifications {
    addedNotificationActions: NotificationAction[];
    addedFields: Field[];
}

export interface LiveSessionReport {
    fullName: string;
    attendanceDetails: string | null;
    attendanceTimestamp: string | null;
    attendanceStatus: string | null;
    dateOfBirth: string | null;
    mobileNumber: string;
    email: string;
    enrollmentStatus: string;
    gender: string;
    studentId: string;
    instituteEnrollmentNumber: string;
    statusType: string | null;
    engagementData: string | null;
    providerTotalDurationMinutes: number | null;
    /** Exact seconds when the provider reports them (Vacademy Meet); null for Zoom. */
    providerTotalDurationSeconds?: number | null;
    feedbackDetails: string | null;
    /** BATCH / USER = already in the institute; EXTERNAL_USER = signed up via the public form. */
    sourceType?: string | null;
    /** Batch the learner was scheduled through; null for guests and individually added learners. */
    batchName?: string | null;
    /** Form submit time (guests) or when the batch/learner was linked to the session. */
    registeredAt?: string | number | null;
}

/** One instructor of a live session, as the detail endpoint returns them. */
export interface LiveSessionInstructor {
    user_id: string;
    full_name?: string | null;
    email?: string | null;
    profile_pic_file_id?: string | null;
}

export interface SessionBySessionIdResponse {
    schedule: Schedule;
    notifications: Notifications;
    // Paid live class fee config (null/absent for free sessions). Wrapper key is
    // camelCase (backend response class has no snake-case naming), inner keys snake.
    paymentConfig?: {
        enabled?: boolean;
        price?: number;
        currency?: string;
        vendor?: string | null;
    } | null;
    // Public-registration OTP verification toggles (camelCase wrapper keys,
    // same as paymentConfig).
    requireEmailVerification?: boolean | null;
    requirePhoneVerification?: boolean | null;
    whatsappOtpTemplateName?: string | null;
    // "Save registrants to audience list(s)" config (camelCase wrapper key;
    // inner keys snake via the DTO's snake_case naming).
    audiencePushConfig?: {
        enabled?: boolean | null;
        audience_ids?: string[] | null;
    } | null;
    /**
     * Instructors / presenters of the session (camelCase wrapper key, snake
     * inner keys). Never empty for an existing session: the backend falls back
     * to the creator for sessions scheduled before instructors existed.
     */
    instructors?: LiveSessionInstructor[] | null;
}

export const getLiveSessions = async (instituteId: string) => {
    const response = await authenticatedAxiosInstance.get(GET_LIVE_SESSIONS, {
        headers: {
            Accept: '*/*',
            'Content-Type': 'application/json',
        },
        params: {
            instituteId,
        },
    });
    return response.data;
};

export const getUpcomingSessions = async (instituteId: string) => {
    const response = await authenticatedAxiosInstance.get(GET_UPCOMING_SESSIONS, {
        headers: {
            Accept: '*/*',
            'Content-Type': 'application/json',
        },
        params: {
            instituteId,
        },
    });
    return response.data as UpcomingSessionDay[];
};

export const getPastSessions = async (instituteId: string) => {
    const response = await authenticatedAxiosInstance.get(GET_PAST_SESSIONS, {
        headers: {
            Accept: '*/*',
            'Content-Type': 'application/json',
        },
        params: {
            instituteId,
        },
    });
    return response.data as PastSessionDay[];
};

export const getDraftSessions = async (instituteId: string) => {
    const response = await authenticatedAxiosInstance.get(GET_DRAFT_SESSIONS, {
        headers: {
            Accept: '*/*',
            'Content-Type': 'application/json',
        },
        params: {
            instituteId,
        },
    });
    return response.data as DraftSessionDay[];
};

export const getSessionBySessionId = async (sessionId: string) => {
    const response = await authenticatedAxiosInstance.get(GET_SESSION_BY_SESSION_ID, {
        headers: {
            Accept: '*/*',
            'Content-Type': 'application/json',
        },
        params: {
            sessionId,
        },
    });
    return response.data;
};

export const getLiveSessionReport = async (
    sessionId: string,
    scheduleId: string,
    accessType: string
): Promise<LiveSessionReport[]> => {
    const response = await authenticatedAxiosInstance.get(LIVE_SESSION_REPORT_BY_SESSION_ID, {
        params: {
            sessionId,
            scheduleId,
            accessType,
        },
    });
    return response.data;
};

/**
 * Fetch custom field values for all guests/participants in a session.
 * Returns: Map<participantId, CustomFieldDTO[]> where each DTO has
 * fieldName, fieldKey, customFieldValue, etc.
 */
export interface SessionCustomFieldValue {
    guestId: string;
    fieldName: string;
    fieldKey: string;
    fieldType: string;
    customFieldValue: string | null;
    id: string;
}

export const getSessionCustomFieldValues = async (
    sessionId: string
): Promise<Record<string, SessionCustomFieldValue[]>> => {
    try {
        const response = await authenticatedAxiosInstance.get(
            `${BASE_URL}/admin-core-service/live-session-report/public-registration`,
            { params: { SessionId: sessionId } }
        );
        return response.data ?? {};
    } catch {
        return {};
    }
};

export const adminMarkAttendance = async (data: {
    sessionId: string;
    scheduleId: string;
    entries: Array<{
        userSourceId: string;
        userSourceType: string;
        status: string;
        details?: string;
    }>;
}): Promise<{ updated: number; created: number }> => {
    const response = await authenticatedAxiosInstance.post(ADMIN_MARK_ATTENDANCE, data);
    return response.data;
};

export interface StudentSchedule {
    scheduleId: string;
    meetingDate: string;
    startTime: string;
    lastEntryTime: string;
    sessionId: string;
    sessionTitle: string;
    subject: string | null;
    sessionStatus: string;
    accessLevel: string;
    attendanceStatus: 'PRESENT' | 'ABSENT';
}

export interface StudentAttendanceReport {
    userId: string;
    attendancePercentage: number;
    schedules: StudentSchedule[];
}

export const getStudentAttendanceReport = async (
    userId: string,
    batchId?: string,
    startDate?: string,
    endDate?: string
): Promise<StudentAttendanceReport> => {
    const params: Record<string, string> = { userId };

    if (batchId) params.batchId = batchId;
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;

    const response = await authenticatedAxiosInstance.get<StudentAttendanceReport>(
        STUDENT_ATTENDANCE_REPORT,
        { params }
    );
    return response.data;
};

export interface BatchStudentSession {
    scheduleId: string;
    sessionId: string;
    title: string;
    meetingDate: string;
    startTime: string;
    lastEntryTime: string;
    attendanceStatus: string | null; // 'PRESENT' | 'ABSENT' | null
    attendanceDetails: string | null;
    attendanceTimestamp: string | null;
}

export interface BatchStudentReport {
    studentId: string;
    fullName: string;
    email: string;
    mobileNumber: string;
    gender: string;
    dateOfBirth: string | null;
    instituteEnrollmentNumber: string;
    enrollmentStatus: string;
    sessions: BatchStudentSession[];
}

export const getBatchSessionAttendanceReport = async (
    batchSessionId?: string,
    startDate?: string,
    endDate?: string
): Promise<BatchStudentReport[]> => {
    const params: Record<string, string> = {};

    // Only attach batchSessionId when a specific batch is selected.
    if (batchSessionId) {
        params.batchSessionId = batchSessionId;
    }

    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;

    const response = await authenticatedAxiosInstance.get<BatchStudentReport[]>(
        BATCH_SESSION_ATTENDANCE_REPORT,
        { params }
    );
    return response.data;
};

// New Search API types
export interface SessionSearchRequest {
    institute_id: string;
    page?: number;
    size?: number;
    sort_by?: 'meetingDate' | 'startTime' | 'title' | 'createdAt' | 'updatedAt';
    sort_direction?: 'ASC' | 'DESC';
    statuses?: string[];
    session_ids?: string[];
    start_date?: string;
    end_date?: string;
    start_time_of_day?: string;
    end_time_of_day?: string;
    recurrence_types?: string[];
    access_levels?: string[];
    batch_ids?: string[];
    user_ids?: string[];
    search_query?: string;
    timezones?: string[];
    schedule_ids?: string[];
    streaming_service_types?: string[];
    time_status?: 'UPCOMING' | 'PAST' | 'LIVE' | null;
}

export interface SessionSearchResponseItem {
    session_id: string;
    waiting_room_time: number | null;
    thumbnail_file_id: string | null;
    background_score_file_id: string | null;
    session_streaming_service_type: string | null;
    schedule_id: string;
    meeting_date: string;
    start_time: string;
    last_entry_time: string;
    recurrence_type: string;
    access_level: string;
    title: string;
    subject: string | null;
    meeting_link: string;
    registration_form_link_for_public_sessions: string | null;
    timezone: string;
    /** 'bbb' | 'zoom' | 'google meet' | 'zoho' | 'youtube' | 'other'. Drives
     *  which host flow the card's primary button runs. */
    link_type?: string | null;
    default_class_link?: string | null;
    default_class_name?: string | null;
    learner_button_config?: {
        text: string;
        url: string;
        background_color: string;
        text_color: string;
        visible: boolean;
    } | null;
    package_session_details?: Array<{
        package_session_id: string;
        package_name: string;
        level_name: string;
        session_name: string;
    }> | null;
    /**
     * Who is taking the class. Never empty for an existing session — the
     * backend falls back to the creator for sessions scheduled before
     * instructors existed — but an individual entry can carry only a user_id
     * when the directory lookup fails.
     */
    instructors?: LiveSessionInstructor[] | null;
}

export interface PaginationMetadata {
    current_page: number;
    page_size: number;
    total_elements: number;
    total_pages: number;
    has_next: boolean;
    has_previous: boolean;
}

export interface SessionSearchResponse {
    sessions: SessionSearchResponseItem[];
    pagination: PaginationMetadata;
}

export const searchSessions = async (
    request: SessionSearchRequest
): Promise<SessionSearchResponse> => {
    const response = await authenticatedAxiosInstance.post<SessionSearchResponse>(
        SEARCH_SESSIONS,
        request,
        {
            headers: {
                Accept: '*/*',
                'Content-Type': 'application/json',
            },
        }
    );
    return response.data;
};

export const getScheduleRecordings = async (
    scheduleId: string,
    instituteId: string
): Promise<MeetingRecording[]> => {
    const response = await authenticatedAxiosInstance.get(GET_SCHEDULE_RECORDINGS, {
        params: { scheduleId, instituteId },
    });
    return response.data;
};

export interface RecordingSyncResult {
    recordings: MeetingRecording[];
    /** "OK" | "BBB_OFFLINE" | "PARTIAL" */
    status: string;
    message: string;
}

export const syncRecordingsFromBbb = async (
    scheduleId: string,
    instituteId: string
): Promise<RecordingSyncResult> => {
    const response = await authenticatedAxiosInstance.post<RecordingSyncResult>(
        SYNC_RECORDINGS_FROM_BBB,
        null,
        { params: { scheduleId, instituteId } }
    );
    return response.data;
};

/**
 * "Save to library" for Zoom recordings — mirrors not-yet-mirrored cloud recordings
 * of a schedule to Vacademy S3 so they survive Zoom's ~30-day auto-delete.
 * Idempotent; returns the updated recordings (with fileId/S3 set) + count mirrored.
 */
export const syncRecordingsToS3 = async (
    scheduleId: string,
    instituteId: string
): Promise<RecordingSyncResult> => {
    const response = await authenticatedAxiosInstance.post<RecordingSyncResult>(
        SYNC_RECORDINGS_TO_S3,
        null,
        { params: { scheduleId, instituteId } }
    );
    return response.data;
};

export interface GoogleRecordingSyncResult {
    /** Count of newly-added recordings on this call. */
    synced: number;
    recordings: MeetingRecording[];
}

/**
 * On-demand Google Meet recording pull — live-fetches conferenceRecords.recordings for a
 * schedule and persists them, bypassing the hourly poll (and its meeting-ended timing gate).
 * Idempotent; returns the count newly added + the full stored recording list.
 */
export const syncGoogleRecordings = async (
    scheduleId: string,
    instituteId: string
): Promise<GoogleRecordingSyncResult> => {
    const response = await authenticatedAxiosInstance.post<GoogleRecordingSyncResult>(
        SYNC_GOOGLE_RECORDINGS,
        null,
        { params: { scheduleId, instituteId } }
    );
    return response.data;
};

/**
 * Google Meet recordings live in the organiser's Drive and can't be fetched server-side, so the
 * admin downloads the MP4 and uploads it; this attaches that media fileId to the recording
 * (storage flips to S3). Returns the updated stored recording list.
 */
export const attachGoogleRecordingFile = async (
    scheduleId: string,
    recordingId: string,
    fileId: string
): Promise<{ recordings: MeetingRecording[] }> => {
    const response = await authenticatedAxiosInstance.post<{ recordings: MeetingRecording[] }>(
        ATTACH_GOOGLE_RECORDING_FILE,
        null,
        { params: { scheduleId, recordingId, fileId } }
    );
    return response.data;
};

/**
 * Server-side "Save to library" for Google Meet: the backend downloads the recording from the
 * organiser's Drive into S3. 412 when the connected Google account hasn't granted Drive access.
 */
export const saveGoogleRecordingToLibrary = async (
    scheduleId: string
): Promise<{ mirrored: number; recordings: MeetingRecording[] }> => {
    const response = await authenticatedAxiosInstance.post<{
        mirrored: number;
        recordings: MeetingRecording[];
    }>(SAVE_GOOGLE_RECORDING_TO_LIBRARY, null, { params: { scheduleId } });
    return response.data;
};

export interface ZoomProvisionStatus {
    sessionId: string;
    total: number;
    pending: number;
    provisioned: number;
    created?: number;
    /** False when no provider account is stored (pasted link) — nothing to provision. */
    managed?: boolean;
}

/** How many of a Zoom / Google Meet session's occurrences have a meeting provisioned yet. */
export const getZoomProvisionStatus = async (
    sessionId: string
): Promise<ZoomProvisionStatus> => {
    const response = await authenticatedAxiosInstance.get<ZoomProvisionStatus>(
        ZOOM_PROVISION_STATUS,
        { params: { sessionId } }
    );
    return response.data;
};

/** Admin "Provision now": synchronously (re)create meetings for any pending occurrence. */
export const provisionZoomNow = async (sessionId: string): Promise<ZoomProvisionStatus> => {
    const response = await authenticatedAxiosInstance.post<ZoomProvisionStatus>(
        ZOOM_PROVISION_NOW,
        null,
        { params: { sessionId } }
    );
    return response.data;
};

// -------------------------------------------------------------------------
// Layer 1 — Process Recording (Whisper transcription)
// -------------------------------------------------------------------------

/**
 * Kick off transcription for a recording ("Process Recording" button).
 * 409 if already in progress; idempotent COMPLETED returns the existing row.
 */
export const processRecording = async (
    scheduleId: string,
    recordingId: string
): Promise<RecordingTranscriptionStatus> => {
    const response = await authenticatedAxiosInstance.post<RecordingTranscriptionStatus>(
        RECORDING_TRANSCRIBE(scheduleId, recordingId)
    );
    return response.data;
};

/** Polled by the UI every 30s while QUEUED/RUNNING. {status: null} = no row. */
export const getTranscriptionStatus = async (
    scheduleId: string,
    recordingId: string
): Promise<RecordingTranscriptionStatus> => {
    const response = await authenticatedAxiosInstance.get<RecordingTranscriptionStatus>(
        RECORDING_TRANSCRIBE(scheduleId, recordingId)
    );
    return response.data;
};

/**
 * Persist LLM-generated study notes alongside the transcript row. Called by
 * the transcript dialog after a successful /transcript/generate-notes call,
 * so the next time the user opens this recording's dialog we can show the
 * cached notes immediately instead of re-running the LLM.
 */
export const saveStudyNotes = async (
    scheduleId: string,
    recordingId: string,
    markdown: string,
): Promise<RecordingTranscriptionStatus> => {
    const response = await authenticatedAxiosInstance.post<RecordingTranscriptionStatus>(
        RECORDING_STUDY_NOTES(scheduleId, recordingId),
        { markdown },
    );
    return response.data;
};

// -------------------------------------------------------------------------
// Layer 3 — Create Assessment from a completed transcript
// -------------------------------------------------------------------------

export type AssessmentArtifactStatus = 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'PUBLISHED';

export interface GeneratedQuestion {
    id: string;
    question: string;
    options: string[];
    correctAnswerIndex: number | null;
    explanation: string;
}

export interface AssessmentArtifact {
    artifactId: string;
    recordingId: string;
    status: AssessmentArtifactStatus;
    errorMessage?: string | null;
    title?: string | null;
    questions?: GeneratedQuestion[] | null;
    targetLanguage?: string | null;
    modelUsed?: string | null;
    numQuestions?: number | null;
    assessmentId?: string | null;
    assessmentViewUrl?: string | null;
    registeredBatchIds?: string[] | null;
    createdAt?: string | null;
    updatedAt?: string | null;
}

export interface CreateAssessmentFromRecordingRequest {
    startDateTime: string;
    endDateTime: string;
    marksPerQuestion: number;
    negativeMarkingEnabled: boolean;
    negativeMarkPerQuestion?: number;
    numQuestions: number;
    durationMinutes: number;
    assessmentVisibility: 'PRIVATE' | 'PUBLIC';
    overrideTitle?: string;
    packageSessionIdsOverride?: string[];
    /**
     * Optional codes from the question-type picker step. Backend is
     * tolerant of this being unset — when absent the LLM produces its
     * default MCQ-only output. Accepted codes: MCQS, MCQM, TRUE_FALSE,
     * ONE_WORD, LONG_ANSWER.
     */
    questionTypes?: string[];

    /**
     * When true, the backend asks Gemini to generate an illustrative
     * image for every question stem and every option, embedded as inline
     * <img> tags. Adds 30-120s of latency and roughly $0.03 per image
     * (~$3 for a 20-question assessment), so off by default.
     */
    includeImages?: boolean;
}

/**
 * Synchronously waits for the LLM call (10-30s for ~20 MCQs on Gemini Flash).
 * Returns the generated content + artifact id.
 */
export const createAssessmentFromRecording = async (
    scheduleId: string,
    recordingId: string,
    body: CreateAssessmentFromRecordingRequest
): Promise<AssessmentArtifact> => {
    const response = await authenticatedAxiosInstance.post<AssessmentArtifact>(
        RECORDING_CREATE_ASSESSMENT(scheduleId, recordingId),
        body
    );
    return response.data;
};

/**
 * Publishes a generated assessment artifact: creates a real Assessment row +
 * Section + Questions (with Options + correct-answer JSON) + batch
 * registrations in assessment_service. After this returns COMPLETED-or-
 * PUBLISHED status with `assessmentId` set, the assessment shows up in the
 * institute's normal Assessment tab and learners on the registered batches
 * can take it.
 *
 * Idempotent on the artifact — calling it twice for an already-published
 * artifact returns the existing assessment id without re-creating.
 */
/**
 * Body for the publish endpoint. All fields are optional — when omitted,
 * the values captured at generation time (in `generation_params_json`)
 * are used. The post-generation "Configure → Publish" flow populates
 * these; the legacy publish call passed `title` only.
 */
export interface PublishAssessmentOverrides {
    title?: string;
    startDateTime?: string;
    endDateTime?: string;
    assessmentVisibility?: 'PRIVATE' | 'PUBLIC';
    marksPerQuestion?: number;
    durationMinutes?: number;
    negativeMarkingEnabled?: boolean;
    negativeMarkPerQuestion?: number;
    /** Retries allowed after the first submission. 0 = no retries. */
    reattemptCount?: number;
    /** Minutes on the instructions/cover screen before the timer starts. */
    previewTime?: number;
    /**
     * Extra batch (package_session) ids to register the assessment to, beyond
     * the live class's own batches — so it's takeable in every destination
     * course an assessment slide is added to. Only applied on the first publish.
     */
    packageSessionIds?: string[];
    /**
     * When true, publish the assessment WITHOUT registering it to any batch —
     * it lands unassigned in the Assessment Center (admin can attach batches
     * later). Overrides the live class + destination batches.
     */
    skipBatchRegistration?: boolean;
}

export const publishAssessmentFromRecording = async (
    recordingId: string,
    artifactId: string,
    overrides?: PublishAssessmentOverrides | string
): Promise<AssessmentArtifact> => {
    // Back-compat: callers used to pass a bare title string. Accept that
    // shape and convert it to the overrides object before sending.
    const body: PublishAssessmentOverrides =
        typeof overrides === 'string'
            ? overrides.trim()
                ? { title: overrides.trim() }
                : {}
            : (overrides ?? {});
    const response = await authenticatedAxiosInstance.post<AssessmentArtifact>(
        RECORDING_PUBLISH_ASSESSMENT(recordingId, artifactId),
        body
    );
    return response.data;
};

/** Lists all previously-generated assessments for a recording (newest first). */
export const listAssessmentsForRecording = async (
    scheduleId: string,
    recordingId: string
): Promise<AssessmentArtifact[]> => {
    const response = await authenticatedAxiosInstance.get<AssessmentArtifact[]>(
        RECORDING_LIST_ASSESSMENTS(scheduleId, recordingId)
    );
    return response.data;
};
