// Types for the admin "Live Class Feedback" page. Field names match the backend
// interface projection (camelCase) returned by
// POST /admin-core-service/live-session-report/feedback/search.

/** One learner's feedback submission for a single live-class occurrence. */
export interface LiveClassFeedbackRow {
    feedbackId: string;
    userId: string;
    learnerName: string | null;
    learnerEmail: string | null;
    learnerMobile: string | null;
    sessionId: string;
    scheduleId: string;
    sessionTitle: string | null;
    subject: string | null;
    meetingDate: string | null; // yyyy-MM-dd
    startTime: string | null; // HH:mm:ss
    /** Raw JSON of the session's feedback form config ({ enabled, questions: [...] }). */
    feedbackConfigJson: string | null;
    /** Comma-joined package_session ids the session is assigned to. */
    packageSessionIds: string | null;
    /** Raw JSON of the learner's answers, keyed by question id. */
    feedbackDetails: string | null;
    submittedAt: string | null; // ISO datetime
}

/** A single question in a session's feedback config. */
export interface FeedbackQuestion {
    id: string;
    type: string; // 'star_rating' | 'text' | 'free_text'
    label: string;
    maxStars?: number;
    max_stars?: number;
}

export interface LiveClassFeedbackSearchParams {
    instituteId: string;
    batchIds: string[]; // empty = all
    subjects: string[]; // empty = all
    startDate: string; // yyyy-MM-dd
    endDate: string; // yyyy-MM-dd
    searchQuery: string;
    /** Only feedback whose primary star rating is strictly below this; null = no rating filter. */
    ratingBelow: number | null;
    page: number;
    size: number;
}
