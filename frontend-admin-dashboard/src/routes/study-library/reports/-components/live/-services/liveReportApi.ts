import { useQueries, useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BATCH_SESSION_ATTENDANCE_REPORT } from '@/constants/urls';

/**
 * One class occurrence (schedule) for one learner. Mirrors the backend
 * AttendanceDetailsDTO returned by /live-session-report/by-batch-session.
 * `attendanceStatus` is one of PRESENT | ABSENT | UNMARKED (or null).
 * `durationMinutes` and `engagementData` are only present for provider-synced
 * (ONLINE) attendance; OFFLINE manual marks leave them null.
 */
export interface LiveSessionRow {
    scheduleId: string;
    sessionId: string;
    title: string;
    meetingDate: string | null;
    startTime: string | null;
    lastEntryTime: string | null;
    attendanceStatus: string | null;
    attendanceDetails: string | null;
    attendanceTimestamp: string | null;
    dailyAttendance: boolean | null;
    durationMinutes: number | null;
    /** JSON string e.g. {"chats":5,"talks":3,"talkTime":120,"raisehand":2,"emojis":1,"pollVotes":4} */
    engagementData: string | null;
}

/** One enrolled learner with their per-class attendance for the batch. */
export interface LiveStudentReport {
    studentId: string;
    fullName: string;
    email: string;
    mobileNumber: string;
    instituteEnrollmentNumber: string | null;
    enrollmentStatus: string | null;
    attendancePercentage: number;
    sessions: LiveSessionRow[];
}

/**
 * Fetch the live-class attendance report for a whole batch across a date range.
 * Returns every ACTIVE enrolled learner crossed with every class held in the
 * window — absentees appear with attendanceStatus = UNMARKED — so the entire
 * batch + learner report is derived client-side from this single response.
 */
export const fetchLiveBatchReport = async (
    packageSessionId: string,
    startDate: string,
    endDate: string
): Promise<LiveStudentReport[]> => {
    const response = await authenticatedAxiosInstance.get<LiveStudentReport[]>(
        BATCH_SESSION_ATTENDANCE_REPORT,
        { params: { batchSessionId: packageSessionId, startDate, endDate } }
    );
    return response.data ?? [];
};

export const useLiveBatchReport = (
    packageSessionId: string,
    startDate: string,
    endDate: string,
    enabled: boolean
) =>
    useQuery({
        queryKey: ['liveBatchReport', packageSessionId, startDate, endDate],
        queryFn: () => fetchLiveBatchReport(packageSessionId, startDate, endDate),
        enabled: enabled && !!packageSessionId && !!startDate && !!endDate,
    });

/**
 * One report query per selected batch (the endpoint is single-batch).
 */
export const useLiveBatchReports = (
    packageSessionIds: string[],
    startDate: string,
    endDate: string,
    enabled: boolean,
    /** Per-"Generate" stamp so re-running the same filters refetches. */
    runId?: number
) =>
    useQueries({
        queries: packageSessionIds.map((packageSessionId) => ({
            queryKey: ['liveBatchReport', packageSessionId, startDate, endDate, runId],
            queryFn: () => fetchLiveBatchReport(packageSessionId, startDate, endDate),
            enabled: enabled && !!packageSessionId && !!startDate && !!endDate,
        })),
    });
