export interface LiveSession {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  status: string;
  sessionLink?: string;
  instructorName?: string;
  description?: string;
}

export interface LiveSessionsResponse {
  live_sessions: SessionDetails[];
  upcoming_sessions: SessionDetails[];
  totalReturned: number;
}

// Raw API response types
export interface RawSession {
  id?: string;
  _id?: string;
  title?: string;
  name?: string;
  session_name?: string;
  startTime?: string;
  start_time?: string;
  endTime?: string;
  end_time?: string;
  status: string;
  sessionLink?: string;
  session_link?: string;
  instructorName?: string;
  instructor_name?: string;
  description?: string;
}

export interface RawApiResponse {
  live_sessions?: RawSession[];
  upcoming_sessions?: RawSession[];
}

/**
 * One learner-facing action button under the player. Authored by admins in the
 * workflow config tab, so only text and url are guaranteed; colours and `visible`
 * may be absent. Missing `visible` means visible.
 */
export interface LearnerButtonConfig {
  text: string;
  url: string;
  background_color?: string;
  text_color?: string;
  visible?: boolean;
}

/**
 * An instructor / presenter of a live class, as the backend returns them.
 * Only `user_id` is guaranteed — the display fields come from the user
 * directory and are absent when that lookup didn't resolve.
 */
export interface SessionInstructor {
  user_id: string;
  full_name?: string | null;
  email?: string | null;
  profile_pic_file_id?: string | null;
}

export interface SessionDetails {
  session_id: string;
  waiting_room_time: number;
  // 'DEFAULT' = waiting-room screen during the waiting-room window.
  // 'PRE_JOINING' = join the live class directly during that window.
  waiting_room_type?: string;
  schedule_id: string;
  meeting_date: string;
  start_time: string;
  last_entry_time: string;
  recurrence_type: string;
  access_level: string;
  title: string;
  subject: string;
  meeting_link: string;
  session_streaming_service_type: string;
  timezone: string;
  link_type?: string;
  // Single object (legacy) or a list — see the embed screen's LearnerButtonsSchema.
  learner_button_config?: LearnerButtonConfig | LearnerButtonConfig[] | null;
  default_class_link?: string | null;
  custom_meeting_link?: string | null;
  provider_meeting_id?: string | null;
  /** Who is taking the class. Absent on older responses. */
  instructors?: SessionInstructor[] | null;
}

export interface DaySession {
  date: string;
  sessions: SessionDetails[];
  learnerButtonConfig?: LearnerButtonConfig | null;
  defaultClassLink?: string | null;
  defaultClassName?: string | null;
}

export interface SessionDetailsResponse {
  sessionId: string;
  scheduleId: string;
  instituteId: string;
  sessionStartTime: string;
  timezone: string;
  lastEntryTime: string;
  accessLevel: string;
  meetingType: string | null;
  linkType: string;
  sessionStreamingServiceType: string | null;
  defaultMeetLink: string;
  waitingRoomLink: string | null;
  waitingRoomTime: number;
  registrationFormLinkForPublicSessions: string | null;
  createdByUserId: string;
  title: string;
  allowPlayPause: boolean;
  allowRewind: string;
  descriptionHtml: string;
  notificationEmailMessage: string | null;
  attendanceEmailMessage: string | null;
  coverFileId: string | null;
  subject: string;
  thumbnailFileId: string;
  backgroundScoreFileId: string;
  status: string;
  recurrenceType: string;
  recurrenceKey: string;
  meetingDate: string;
  scheduleStartTime: string;
  scheduleLastEntryTime: string;
  customMeetingLink: string;
  customWaitingRoomMediaId: string | null;
  providerMeetingId: string | null;
  providerEmbedToken: string | null;
  providerHostUrl: string | null;
}

// Feedback types
export interface FeedbackQuestion {
    id: string;
    type: 'star_rating' | 'free_text';
    label: string;
    enabled: boolean;
    mandatory: boolean;
    max_stars?: number;
    allow_half?: boolean;
}

export interface FeedbackConfig {
    enabled: boolean;
    // When false, the learner cannot dismiss the form — the Skip button is
    // hidden and the backend rejects empty mandatory answers.
    allow_skip?: boolean;
    questions: FeedbackQuestion[];
}

export interface FeedbackConfigResponse {
    feedback_config: FeedbackConfig | null;
    already_submitted: boolean;
    session_title: string;
    institute_name?: string;
    institute_logo?: string;
}

export interface FeedbackSubmitRequest {
    schedule_id: string;
    responses: Record<string, string | number>;
}

// Past sessions (Track A) — learner past-sessions view types

/** Attendance status for a past session; UNMARKED covers sessions before attendance tracking existed. */
export type PastAttendanceStatus = "PRESENT" | "ABSENT" | "UNMARKED";

/** Sanitized recording exposure — never carries provider host/download URLs. */
export interface LearnerRecording {
    recording_id: string;
    playback_type: "S3" | "YOUTUBE" | "ZOOM_CLOUD" | "BBB";
    url?: string;
    file_id?: string;
    passcode?: string;
    expires_at?: string;
    expired?: boolean;
    duration_seconds?: number;
    part_label?: string;
}

/** Raw engagement metrics for a past session; fields are nullable — never fabricate a composite score. */
export interface PastSessionActivity {
    duration_minutes?: number | null;
    chats?: number | null;
    talks?: number | null;
    talk_time?: number | null;
    raise_hand?: number | null;
    emojis?: number | null;
    poll_votes?: number | null;
}

/** The admin-governed learner-display flags, echoed on every /learner/past response. */
export interface PastDisplayFlags {
    show_past_sessions: boolean;
    show_recordings: boolean;
    show_attendance: boolean;
    show_activity_stats: boolean;
    show_class_materials: boolean;
}

/** A class material (PDF / uploaded video / YouTube) the teacher linked from this session. */
export interface PastSessionMaterial {
    slide_id: string;
    title: string;
    kind: "PDF" | "VIDEO" | "YOUTUBE";
    file_id?: string;
    url?: string;
}

export interface PastSessionDetails {
    session_id: string;
    schedule_id: string;
    title: string;
    subject: string;
    meeting_date: string;
    start_time: string;
    last_entry_time: string;
    timezone: string;
    link_type?: string;
    thumbnail_file_id?: string | null;
    /** Omitted entirely by the backend when show_recordings=false. */
    recordings?: LearnerRecording[];
    /** Omitted entirely by the backend when show_attendance=false. */
    attendance_status?: PastAttendanceStatus;
    /** Omitted entirely by the backend when show_activity_stats=false. */
    activity?: PastSessionActivity;
    /** Omitted entirely by the backend when show_class_materials=false. */
    materials?: PastSessionMaterial[];
    /** Who took the class. Absent on older responses. */
    instructors?: SessionInstructor[] | null;
}

export interface PastSessionsPageResponse {
    display_flags: PastDisplayFlags;
    content: PastSessionDetails[];
    page: number;
    size: number;
    total_pages: number;
    total_elements: number;
    last: boolean;
}

