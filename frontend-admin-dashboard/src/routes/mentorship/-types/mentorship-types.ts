// Mentorship DTOs — snake_case to mirror the admin-core-service API.

export interface MentorDTO {
    id: string;
    institute_id: string;
    user_id: string;
    display_name?: string | null;
    title?: string | null;
    profile_image_file_id?: string | null;
    bio?: string | null;
    booking_page_id?: string | null;
    booking_page_slug?: string | null;
    google_account_id?: string | null;
    google_connected?: boolean | null;
    google_email?: string | null;
    status: string;
    assigned_student_count?: number | null;
    /** Topics this mentor covers. */
    expertise_tags?: string[] | null;
    /** Capacity cap on active mentees; null = unlimited. */
    max_mentees?: number | null;
    /** Remaining capacity; null when uncapped. */
    available_slots?: number | null;
    at_capacity?: boolean | null;
    /** Whether learners can find and request this mentor. */
    is_discoverable?: boolean | null;
    /** Mean of this mentor's session ratings (1 decimal); null when unrated. */
    average_rating?: number | null;
    /** How many ratings that average is based on. */
    rating_count?: number | null;
    // auth-hydrated identity
    name?: string | null;
    email?: string | null;
    mobile_number?: string | null;
    profile_pic_file_id?: string | null;
}

export interface CreateMentorRequest {
    institute_id: string;
    user_id: string;
    display_name?: string;
    title?: string;
    profile_image_file_id?: string;
    bio?: string;
    expertise_tags?: string[];
    max_mentees?: number;
    is_discoverable?: boolean;
}

export interface UpdateMentorRequest {
    display_name?: string;
    title?: string;
    profile_image_file_id?: string;
    bio?: string;
    status?: string;
    booking_page_id?: string;
    /** Replaces the whole tag set; an empty array clears it. */
    expertise_tags?: string[];
    /** 0 clears the cap (unlimited). */
    max_mentees?: number;
    is_discoverable?: boolean;
}

export interface AssignMentorRequest {
    institute_id: string;
    mentor_id: string;
    student_user_ids: string[];
    package_session_id?: string;
}

export interface BulkRoundRobinRequest {
    institute_id: string;
    student_user_ids: string[];
    mentor_ids: string[];
    package_session_id?: string;
}

export interface AssignmentResult {
    assigned: number;
    skipped: number;
    /** Students left unassigned because every candidate mentor was at capacity. */
    capacity_full?: number | null;
}

/** A learner's request to be mentored, as the admin review queue sees it. */
export interface MentorRequestDTO {
    id: string;
    institute_id: string;
    student_user_id: string;
    /** null = the learner asked for "any available mentor". */
    mentor_id?: string | null;
    message?: string | null;
    status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'CANCELLED' | string;
    decision_note?: string | null;
    assignment_id?: string | null;
    created_at?: number | null;
    decided_at?: number | null;
    student_name?: string | null;
    student_email?: string | null;
    mentor_name?: string | null;
    mentor_title?: string | null;
    mentor_profile_image_file_id?: string | null;
    mentor_expertise_tags?: string[] | null;
    mentor_available_slots?: number | null;
}

/** One learner rating of a mentor session. */
export interface MentorFeedbackDTO {
    id: string;
    booking_instance_id: string;
    mentor_id: string;
    mentor_name?: string | null;
    student_user_id: string;
    student_name?: string | null;
    rating: number;
    comment?: string | null;
    created_at?: number | null;
}

/**
 * One mentorship session: the booking, both parties, the mentor's recorded
 * outcome and the learner's rating. `lifecycle` is the single derived status every
 * surface displays.
 */
export interface MentorSessionDTO {
    booking_instance_id: string;
    title?: string | null;
    scheduled_start_utc?: number | null;
    scheduled_end_utc?: number | null;
    duration_minutes?: number | null;
    /** The appointment's own state: CONFIRMED | CANCELLED | RESCHEDULED. */
    booking_status?: string | null;
    meet_link?: string | null;
    mentor_id?: string | null;
    mentor_name?: string | null;
    mentor_email?: string | null;
    student_user_id?: string | null;
    student_name?: string | null;
    student_email?: string | null;
    /** COMPLETED | NO_SHOW, or null when the mentor hasn't reviewed it. */
    outcome?: string | null;
    topic?: string | null;
    /** Mentor's notes — admin/mentor only. */
    notes?: string | null;
    marked_at?: number | null;
    rating?: number | null;
    feedback_comment?: string | null;
    lifecycle: 'UPCOMING' | 'AWAITING_REVIEW' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED' | 'RESCHEDULED' | string;
}

/** Session counts for the admin dashboard. */
export interface SessionStats {
    today?: number | null;
    upcoming?: number | null;
    completed?: number | null;
    cancelled?: number | null;
    no_show?: number | null;
    awaiting_review?: number | null;
}

/** A mentor recording what happened in one of their sessions. */
export interface RecordSessionRequest {
    booking_instance_id: string;
    outcome: 'COMPLETED' | 'NO_SHOW';
    topic?: string;
    notes?: string;
}

/**
 * Book a 1:1 for a learner without asking the learner to fill anything in. The
 * slot must be one the mentor's own booking page offers — the backend re-checks.
 */
export interface ScheduleSessionRequest {
    /** Required when an admin schedules; ignored when a mentor schedules for themselves. */
    mentor_id?: string;
    student_user_id: string;
    /** ISO-8601 offset datetime of the chosen slot start. */
    start_time: string;
    invitee_timezone?: string;
    /** Null = the mentor's default booking-page duration. */
    duration_minutes?: number;
}

/** Free slots on a mentor's booking page, as the public booking API returns them. */
export interface BookingSlots {
    slots: string[];
    duration_minutes?: number | null;
    timezone?: string | null;
}

/** An admin's decision. `mentor_id` picks/overrides the mentor when approving. */
export interface MentorRequestDecision {
    mentor_id?: string;
    note?: string;
}

export interface MenteeDTO {
    assignment_id: string;
    mentor_id: string;
    student_user_id: string;
    package_session_id?: string | null;
    assignment_method?: string | null;
    name?: string | null;
    email?: string | null;
    mobile_number?: string | null;
    profile_pic_file_id?: string | null;
}

export interface MentorDashboard {
    total_mentors: number;
    total_active_assignments: number;
    distinct_mentees: number;
    today_sessions?: number;
    upcoming_sessions?: number;
    /** Learner requests waiting on an admin decision. */
    pending_requests?: number;
    completed_sessions?: number;
    cancelled_sessions?: number;
    no_show_sessions?: number;
    sessions_awaiting_review?: number;
    /** Mentors listed in the learner-facing directory. */
    discoverable_mentors?: number;
    mentors: MentorDTO[];
}

// Minimal enrolled-student row from the learner-list search (get/v2/all).
export interface StudentRow {
    user_id: string;
    full_name?: string;
    email?: string;
    username?: string;
    /** Batch the learner is enrolled in — captions the row in the picker. */
    package_session_id?: string;
    mobile_number?: string;
}

// A note / activity from the shared timeline system.
export interface TimelineEvent {
    id: string;
    title: string;
    description?: string | null;
    action_type?: string | null;
    actor_name?: string | null;
    category?: string | null;
    is_pinned?: boolean | null;
    created_at?: string | number | null;
}

// A scheduled call from the booking system (by-lead feed).
export interface BookingInstance {
    id: string;
    booking_page_title?: string | null;
    invitee_name?: string | null;
    scheduled_start_utc?: string | number | null;
    scheduled_end_utc?: string | number | null;
    status: string;
    meet_link?: string | null;
}

export interface CreateNoteRequest {
    studentUserId: string;
    title: string;
    description?: string;
}

/** One weekly availability window (times are "HH:mm" in the page timezone). */
export interface WeeklyWindow {
    day_of_week: string; // MONDAY..SUNDAY
    start_time: string;
    end_time: string;
}

/**
 * A specific-date exception. `blocked: true` = the whole day is unavailable;
 * otherwise `windows` replaces that day's weekly hours. Date is "yyyy-MM-dd".
 */
export interface DateOverride {
    date: string;
    blocked?: boolean;
    windows?: WeeklyWindow[];
}

export interface BookingAvailability {
    weekly_windows: WeeklyWindow[];
    date_overrides?: DateOverride[] | null;
}

/** A bookable session option (name + duration) offered on the booking page. */
export interface SessionType {
    id?: string;
    name: string;
    duration_minutes: number;
}

/** Subset of the mentor's booking page used by the availability editor. */
export interface MentorBookingPage {
    id: string;
    duration_minutes?: number | null;
    slot_granularity_minutes?: number | null;
    buffer_before_minutes?: number | null;
    buffer_after_minutes?: number | null;
    min_notice_minutes?: number | null;
    booking_horizon_days?: number | null;
    timezone?: string | null;
    availability?: BookingAvailability | null;
    session_types?: SessionType[] | null;
    location_type?: string | null;
    custom_meeting_link?: string | null;
    allocate_google_meet?: boolean | null;
}

/** Mentor self-service availability update (host/slug are never sent). */
export interface MentorAvailabilityRequest {
    availability?: BookingAvailability;
    duration_minutes?: number;
    min_notice_minutes?: number;
    buffer_before_minutes?: number;
    buffer_after_minutes?: number;
    booking_horizon_days?: number;
    slot_granularity_minutes?: number;
    timezone?: string;
    session_types?: SessionType[];
    location_type?: string;
    custom_meeting_link?: string;
    allocate_google_meet?: boolean;
}

/** Spring Page envelope (snake_case serialization) for paginated endpoints. */
export interface PageResponse<T> {
    content: T[];
    total_pages: number;
    total_elements: number;
    /** Current 0-indexed page. */
    number: number;
    size: number;
    last?: boolean;
    first?: boolean;
}
