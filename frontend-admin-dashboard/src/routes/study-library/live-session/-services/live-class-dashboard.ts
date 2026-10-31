import { keepPreviousData, useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    LIVE_CLASS_DASHBOARD,
    LIVE_CLASS_DASHBOARD_AT_RISK,
    LIVE_CLASS_DASHBOARD_CLASS_LEARNERS,
    LIVE_CLASS_DASHBOARD_FEEDBACK,
} from '@/constants/urls';

/** LIVE | UPCOMING | COMPLETED — decided server-side in each class's own timezone. */
export type DashboardClassStatus = 'LIVE' | 'UPCOMING' | 'COMPLETED';

export interface DashboardInstructorRef {
    user_id: string;
    name: string | null;
    email: string | null;
}

/** Rates are fractions (0..1), null when there was nothing to divide by. */
export interface DashboardSummary {
    total_classes: number;
    completed_classes: number;
    live_classes: number;
    upcoming_classes: number;
    expected_learners: number;
    joined: number;
    present: number;
    /** Present / joined among the expected learners only (excludes guests and outsiders). */
    present_in_audience: number;
    joined_in_audience: number;
    guests: number;
    attendance_rate: number | null;
    avg_joined_per_class: number | null;
    avg_scheduled_minutes: number | null;
    avg_attended_minutes: number | null;
    avg_stay_rate: number | null;
    engagement_rate: number | null;
    engagement_tracked: number;
    /** Attendees (of those tracked) who did each thing at least once. */
    spoke_count: number;
    chatted_count: number;
    raised_hand_count: number;
    voted_count: number;
    reacted_count: number;
    chats: number;
    talks: number;
    talk_seconds: number;
    raise_hands: number;
    emojis: number;
    poll_votes: number;
    feedback_count: number;
    rated_count: number;
    avg_rating: number | null;
    feedback_rate: number | null;
}

export interface DashboardRatingBucket {
    stars: number;
    count: number;
}

export interface DashboardDailyPoint {
    date: string;
    classes: number;
    completed: number;
    expected: number;
    joined: number;
    present: number;
    /** Present among the expected learners — the numerator of attendance_rate. */
    present_in_audience: number;
    attendance_rate: number | null;
    feedback_count: number;
    avg_rating: number | null;
}

export interface DashboardPlatformSlice {
    platform: string;
    classes: number;
}

export interface DashboardInstructorStats {
    user_id: string;
    name: string | null;
    email: string | null;
    classes: number;
    completed: number;
    expected: number;
    joined: number;
    present: number;
    attendance_rate: number | null;
    avg_attended_minutes: number | null;
    engagement_rate: number | null;
    feedback_count: number;
    avg_rating: number | null;
}

export interface DashboardBatchStats {
    package_session_id: string;
    classes: number;
    expected: number;
    joined: number;
    present: number;
    attendance_rate: number | null;
}

export interface DashboardClassRow {
    schedule_id: string;
    session_id: string;
    title: string | null;
    subject: string | null;
    meeting_date: string;
    start_time: string | null;
    end_time: string | null;
    timezone: string;
    platform: string;
    access_level: string | null;
    status: DashboardClassStatus;
    scheduled_minutes: number | null;
    instructors: DashboardInstructorRef[];
    batch_ids: string[];
    expected: number;
    joined: number;
    present: number;
    guests: number;
    attendance_rate: number | null;
    avg_attended_minutes: number | null;
    engagement_rate: number | null;
    chats: number;
    talks: number;
    raise_hands: number;
    poll_votes: number;
    emojis: number;
    feedback_count: number;
    avg_rating: number | null;
}

export interface LiveClassDashboardData {
    start_date: string;
    end_date: string;
    generated_at: string;
    summary: DashboardSummary;
    /** Same filters over the equally long period before the range; absent past 92 days. */
    previous_summary?: DashboardSummary | null;
    previous_start_date?: string | null;
    previous_end_date?: string | null;
    rating_distribution: DashboardRatingBucket[];
    daily: DashboardDailyPoint[];
    platforms: DashboardPlatformSlice[];
    instructors: DashboardInstructorStats[];
    batches: DashboardBatchStats[];
    classes: DashboardClassRow[];
    classes_limit: number;
    classes_truncated: boolean;
    live_now: DashboardClassRow[];
    instructor_options: DashboardInstructorRef[];
}

export interface LiveClassDashboardParams {
    instituteId: string;
    startDate: string; // yyyy-MM-dd
    endDate: string; // yyyy-MM-dd
    batchIds: string[];
    instructorIds: string[];
}

const LIVE_REFRESH_MS = 60_000;

const fetchLiveClassDashboard = async (
    params: LiveClassDashboardParams
): Promise<LiveClassDashboardData> => {
    const response = await authenticatedAxiosInstance.post<LiveClassDashboardData>(
        LIVE_CLASS_DASHBOARD,
        {
            institute_id: params.instituteId,
            start_date: params.startDate,
            end_date: params.endDate,
            batch_ids: params.batchIds,
            instructor_ids: params.instructorIds,
        }
    );
    return response.data;
};

/**
 * The whole dashboard in one request. Re-polls every minute while the tab is
 * visible so the "Live now" join counts keep moving; the previous result stays
 * on screen while a filter change loads.
 */
export const useLiveClassDashboard = (params: LiveClassDashboardParams) =>
    useQuery({
        queryKey: ['live-class-dashboard', params],
        queryFn: () => fetchLiveClassDashboard(params),
        enabled: !!params.instituteId && !!params.startDate && !!params.endDate,
        placeholderData: keepPreviousData,
        staleTime: 30_000,
        refetchInterval: LIVE_REFRESH_MS,
        refetchIntervalInBackground: false,
    });

// ─── On-demand panels ───────────────────────────────────────────────────────

export interface DashboardFeedbackAnswer {
    question_id: string;
    label: string;
    text: string;
}

/** PRESENT | BELOW_RULE (joined, short of the attendance rule) | NOT_JOINED */
export type LearnerAttendanceStatus = 'PRESENT' | 'BELOW_RULE' | 'NOT_JOINED';

export interface DashboardClassLearner {
    id: string;
    /** USER | EXTERNAL_USER | GUEST */
    source_type: string;
    name: string | null;
    email: string | null;
    mobile: string | null;
    package_session_id: string | null;
    expected: boolean;
    status: LearnerAttendanceStatus;
    joined_at: string | null;
    seconds_in_class: number | null;
    talks: number | null;
    chats: number | null;
    raise_hands: number | null;
    poll_votes: number | null;
    emojis: number | null;
    rating: number | null;
    answers: DashboardFeedbackAnswer[];
    /**
     * Opt-in on-device camera activeness (BBB only). All null when the class
     * did not have the score turned on or the learner never enabled a camera.
     * Percentages are 0-100 session averages.
     */
    activeness?: number | null;
    activeness_on_screen?: number | null;
    activeness_attention?: number | null;
    /** Seconds the camera was tracked. */
    activeness_seconds?: number | null;
    activeness_away_count?: number | null;
    /** Why there is no (current) score: 2 turned off, 3 phone/tablet, 4 camera blocked, … (1 = measured). */
    activeness_state?: number | null;
}

export interface DashboardAtRiskLearner {
    user_id: string;
    name: string | null;
    email: string | null;
    mobile: string | null;
    package_session_id: string | null;
    expected: number;
    attended: number;
    missed: number;
    attendance_rate: number | null;
    miss_streak: number;
    last_attended: string | null;
}

/** DROPPED = came at least once, then stopped; NEVER = came to none; ALL = both. */
export type AtRiskView = 'DROPPED' | 'NEVER' | 'ALL';

export interface DashboardAtRiskResponse {
    min_missed: number;
    view: AtRiskView;
    completed_classes: number;
    total: number;
    limit: number;
    learners: DashboardAtRiskLearner[];
}

export interface DashboardFeedbackComment {
    user_id: string;
    learner_name: string | null;
    session_id: string;
    schedule_id: string;
    title: string | null;
    subject: string | null;
    meeting_date: string;
    start_time: string | null;
    instructors: DashboardInstructorRef[];
    rating: number | null;
    answers: DashboardFeedbackAnswer[];
    submitted_at: string | null;
}

const filterBody = (params: LiveClassDashboardParams) => ({
    institute_id: params.instituteId,
    start_date: params.startDate,
    end_date: params.endDate,
    batch_ids: params.batchIds,
    instructor_ids: params.instructorIds,
});

/** Everyone in one class, with status, time stayed, engagement and feedback. */
export const useClassLearners = (params: {
    instituteId: string;
    scheduleId: string | null;
    batchIds: string[];
}) =>
    useQuery({
        queryKey: ['live-class-dashboard', 'class-learners', params],
        queryFn: async () => {
            const response = await authenticatedAxiosInstance.post<{
                learners: DashboardClassLearner[];
            }>(LIVE_CLASS_DASHBOARD_CLASS_LEARNERS, {
                institute_id: params.instituteId,
                schedule_id: params.scheduleId,
                batch_ids: params.batchIds,
            });
            return response.data.learners ?? [];
        },
        enabled: !!params.instituteId && !!params.scheduleId,
        staleTime: 30_000,
    });

/** Learners who missed at least `minMissed` finished classes in the range. */
export const useAtRiskLearners = (
    params: LiveClassDashboardParams,
    minMissed: number,
    view: AtRiskView
) =>
    useQuery({
        queryKey: ['live-class-dashboard', 'at-risk', params, minMissed, view],
        queryFn: async () =>
            (
                await authenticatedAxiosInstance.post<DashboardAtRiskResponse>(
                    LIVE_CLASS_DASHBOARD_AT_RISK,
                    {
                        ...filterBody(params),
                        min_missed: minMissed,
                        at_risk_view: view,
                    }
                )
            ).data,
        enabled: !!params.instituteId && !!params.startDate && !!params.endDate,
        placeholderData: keepPreviousData,
        staleTime: 60_000,
    });

/** Latest written feedback in the range. */
export const useFeedbackWall = (params: LiveClassDashboardParams) =>
    useQuery({
        queryKey: ['live-class-dashboard', 'feedback-comments', params],
        queryFn: async () =>
            (
                await authenticatedAxiosInstance.post<{ comments: DashboardFeedbackComment[] }>(
                    LIVE_CLASS_DASHBOARD_FEEDBACK,
                    filterBody(params)
                )
            ).data.comments ?? [],
        enabled: !!params.instituteId && !!params.startDate && !!params.endDate,
        placeholderData: keepPreviousData,
        staleTime: 60_000,
    });
