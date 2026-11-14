import { queryOptions } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { LEARNER_LIVE_SESSIONS, LEARNER_UPCOMING_LIVE_SESSIONS } from '@/constants/urls';

export type LearnerAttendanceStatus = 'PRESENT' | 'ABSENT' | 'UNMARKED';

/** One already-started live class the learner was expected at. */
export interface LearnerLiveClass {
    schedule_id: string;
    session_id: string;
    title: string | null;
    subject: string | null;
    /** yyyy-MM-dd, in the session's own timezone. */
    meeting_date: string;
    /** HH:mm:ss, in the session's own timezone. */
    start_time: string;
    last_entry_time: string | null;
    access_level: string | null;
    timezone: string;
    attendance_status: LearnerAttendanceStatus;
    /** ONLINE / OFFLINE — how the attendance was recorded. */
    status_type: string | null;
    /** Minutes the provider says the learner was in the class. */
    duration_minutes: number | null;
    meeting_duration_minutes: number | null;
    /** 0-100 engagement score; null when the class has nothing to score. */
    concentration_score: number | null;
}

export interface LearnerLiveSessionsResponse {
    user_id: string;
    total_classes: number;
    present_count: number;
    absent_count: number;
    unmarked_count: number;
    attendance_percentage: number;
    avg_concentration_score: number | null;
    scored_classes: number;
    avg_duration_minutes: number | null;
    /** Newest first. */
    classes: LearnerLiveClass[];
}

export interface LearnerUpcomingClass {
    schedule_id: string;
    session_id: string;
    title: string | null;
    subject: string | null;
    meeting_date: string;
    start_time: string;
    last_entry_time: string | null;
    access_level: string | null;
    timezone: string;
    /** Provider room link (Zoom/Meet/BBB) — the portal link is the one that records attendance. */
    meeting_link: string | null;
    /** In progress right now. */
    live: boolean;
}

/**
 * Dates are yyyy-MM-dd. `batchId` (a package_session_id) narrows to that batch's classes; omit it
 * for every batch plus the classes the learner was added to individually.
 */
export const fetchLearnerLiveSessions = async (
    userId: string,
    startDate: string,
    endDate: string,
    batchId?: string
): Promise<LearnerLiveSessionsResponse> => {
    const { data } = await authenticatedAxiosInstance.get<LearnerLiveSessionsResponse>(
        LEARNER_LIVE_SESSIONS,
        { params: { userId, startDate, endDate, batchId: batchId || undefined } }
    );
    return data;
};

export const fetchLearnerUpcomingLiveSessions = async (
    userId: string,
    limit = 5,
    batchId?: string
): Promise<LearnerUpcomingClass[]> => {
    const { data } = await authenticatedAxiosInstance.get<LearnerUpcomingClass[]>(
        LEARNER_UPCOMING_LIVE_SESSIONS,
        { params: { userId, limit, batchId: batchId || undefined } }
    );
    return data ?? [];
};

export function getLearnerLiveSessionsQuery(
    userId: string,
    startDate: string,
    endDate: string,
    batchId?: string
) {
    return queryOptions({
        queryKey: ['LEARNER_LIVE_SESSIONS', userId, startDate, endDate, batchId ?? null],
        queryFn: () => fetchLearnerLiveSessions(userId, startDate, endDate, batchId),
        staleTime: 60_000,
        enabled: !!userId && !!startDate && !!endDate,
    });
}

export function getLearnerUpcomingLiveSessionsQuery(userId: string, limit = 5, batchId?: string) {
    return queryOptions({
        queryKey: ['LEARNER_UPCOMING_LIVE_SESSIONS', userId, limit, batchId ?? null],
        queryFn: () => fetchLearnerUpcomingLiveSessions(userId, limit, batchId),
        staleTime: 60_000,
        enabled: !!userId,
    });
}
