import { queryOptions } from '@tanstack/react-query';
import { BASE_URL, STUDENT_ANALYSIS_BASE } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';

/**
 * The learner profile Reports tab's basic report: the deterministic part of the comprehensive
 * report (no AI) for one window — marks by subject, topic mastery from analysed assessment
 * attempts, attendance and course progress. Only the fields the tab reads are typed.
 */
export interface TopicMastery {
    topic: string;
    questions: number;
    correct: number;
    accuracy: number | null;
    mastery_level: string | null;
}

export interface SnapshotMisconception {
    topic?: string | null;
    context?: string | null;
    misconception: string;
    remediation?: string | null;
}

export interface SubjectMarks {
    subject: string;
    marks_obtained: number | null;
    total_marks: number | null;
    percentage: number | null;
    item_count: number | null;
}

export interface SubjectPerformance {
    subject: string;
    score_percentage: number | null;
    class_average: number | null;
}

export interface SnapshotAssessment {
    assessment_id: string;
    name?: string | null;
    date?: string | null;
    subject?: string | null;
    marks?: number | null;
    total_marks?: number | null;
    percentage?: number | null;
    grade?: string | null;
    rank?: number | null;
    percentile?: number | null;
    /** Class average in marks, not percent. */
    class_average?: number | null;
}

export interface SnapshotBloomLevel {
    level: string;
    total?: number | null;
    correct?: number | null;
    accuracy?: number | null;
}

export interface StudentReportSnapshot {
    student?: {
        name?: string | null;
        enrollment_no?: string | null;
        batch?: string | null;
        avatar_url?: string | null;
    } | null;
    institute?: {
        name?: string | null;
        logo_url?: string | null;
        theme_color?: string | null;
    } | null;
    academics?: {
        available: boolean;
        average_percentage?: number | null;
        class_average_percentage?: number | null;
        best_subject?: string | null;
        weakest_subject?: string | null;
        assessments?: SnapshotAssessment[] | null;
        subject_performance?: SubjectPerformance[] | null;
    } | null;
    subject_marks?: { available: boolean; subjects?: SubjectMarks[] | null } | null;
    learning_insights?: {
        available: boolean;
        attempts_analyzed?: number | null;
        topic_mastery?: TopicMastery[] | null;
        blooms?: SnapshotBloomLevel[] | null;
        confidence?: {
            overall?: number | null;
            knows?: number | null;
            guesses?: number | null;
            high_confidence_wrong?: number | null;
        } | null;
        /** Mistakes the AI found in analysed attempts, with how to fix them. */
        misconceptions?: SnapshotMisconception[] | null;
    } | null;
    attendance?: {
        available: boolean;
        overall_percentage?: number | null;
        present?: number | null;
        absent?: number | null;
        late?: number | null;
        total_sessions?: number | null;
        weekly?: { week: string; percentage: number | null }[] | null;
    } | null;
    course_progress?: {
        available: boolean;
        overall_completion_percentage?: number | null;
        subjects?:
            | {
                  subject_id?: string | null;
                  subject: string;
                  completion_percentage?: number | null;
                  time_hours?: number | null;
              }[]
            | null;
    } | null;
}

/** Strength / weakness cut-off on topic accuracy — the same 60% line the AI learner report uses. */
export const STRENGTH_THRESHOLD = 60;

export const fetchStudentReportSnapshot = async (params: {
    userId: string;
    instituteId: string;
    batchId?: string;
    startDate: string;
    endDate: string;
}): Promise<StudentReportSnapshot> => {
    const { data } = await authenticatedAxiosInstance.get<StudentReportSnapshot>(
        `${STUDENT_ANALYSIS_BASE}/snapshot`,
        {
            params: {
                userId: params.userId,
                instituteId: params.instituteId,
                batchId: params.batchId || undefined,
                startDate: params.startDate,
                endDate: params.endDate,
            },
        }
    );
    return data;
};

export const getStudentReportSnapshotQuery = (params: {
    userId: string;
    instituteId: string;
    batchId?: string;
    startDate: string;
    endDate: string;
}) =>
    queryOptions({
        queryKey: ['STUDENT_REPORT_SNAPSHOT', params],
        queryFn: () => fetchStudentReportSnapshot(params),
        enabled: !!params.userId && !!params.instituteId && !!params.startDate && !!params.endDate,
        staleTime: 60_000,
    });

export interface LearnerDailyTime {
    activity_date: string;
    time_spent_by_user_millis: number | null;
    avg_time_spent_by_batch_millis: number | null;
}

const nextDay = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
};

/** The learner minutes per day and the batch average, over their batches. */
export const fetchLearnerDailyTime = async (params: {
    userId: string;
    packageSessionIds: string[];
    startDate: string;
    endDate: string;
}): Promise<LearnerDailyTime[]> => {
    const { data } = await authenticatedAxiosInstance.post<LearnerDailyTime[]>(
        `${BASE_URL}/admin-core-service/learner-tracking/activity-log/learner/v1/daily-time-spent`,
        {
            user_id: params.userId,
            package_session_ids: params.packageSessionIds,
            start_date: params.startDate,
            // The end is exclusive at midnight, so ask up to the next day and drop it below.
            end_date: nextDay(params.endDate),
        }
    );
    return (data ?? []).filter((d) => String(d.activity_date).slice(0, 10) <= params.endDate);
};

export const getLearnerDailyTimeQuery = (params: {
    userId: string;
    packageSessionIds: string[];
    startDate: string;
    endDate: string;
}) =>
    queryOptions({
        queryKey: ['LEARNER_DAILY_TIME', params],
        queryFn: () => fetchLearnerDailyTime(params),
        enabled: !!params.userId && params.packageSessionIds.length > 0 && !!params.startDate,
        staleTime: 60_000,
    });
