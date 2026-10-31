import { keepPreviousData, useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { ASSESSMENT_DASHBOARD_INSIGHTS } from '@/constants/urls';

/** LIVE | UPCOMING | CLOSED, or OPEN for an anytime test (no closing date). */
export type AssessmentStatus = 'LIVE' | 'UPCOMING' | 'CLOSED' | 'OPEN';

/** Rates and scores are fractions (0..1), null when there was nothing to divide by. */
export interface AssessmentDashboardSummary {
    total_assessments: number;
    live_assessments: number;
    upcoming_assessments: number;
    closed_assessments: number;
    open_assessments: number;
    /** Participation counts closed scheduled tests only. */
    expected_learners: number;
    attempted_learners: number;
    not_attempted: number;
    participation_rate: number | null;
    submissions: number;
    unique_learners: number;
    in_progress: number;
    scored: number;
    avg_score: number | null;
    highest_score: number | null;
    evaluated: number;
    awaiting_evaluation: number;
    awaiting_release: number;
    /** How the evaluated submissions were checked; the four add up to `evaluated`. */
    checked_by_teacher: number;
    checked_by_ai: number;
    auto_graded: number;
    /** Evaluated without the checking tool, e.g. marks entered offline. */
    evaluated_other: number;
    avg_time_minutes: number | null;
    avg_time_share: number | null;
}

export interface AssessmentDailyPoint {
    date: string;
    assessments: number;
    submissions: number;
    learners: number;
    avg_score: number | null;
}

export interface ScoreBucket {
    /** Lower bound in percent: 0, 10 … 90. */
    from: number;
    count: number;
}

export interface SubmissionHeatCell {
    /** 0 = Monday. */
    weekday: number;
    hour: number;
    submissions: number;
}

export interface AssessmentTypeSlice {
    play_mode: string;
    assessments: number;
    submissions: number;
    avg_score: number | null;
}

export interface AssessmentBatchStats {
    package_session_id: string;
    assessments: number;
    expected: number;
    attempted: number;
    participation_rate: number | null;
    submissions: number;
    avg_score: number | null;
    /** Submissions by this batch's learners that are checked / still waiting. */
    evaluated: number;
    awaiting_evaluation: number;
}

/** A teacher who checked copies of the range's tests. */
export interface AssessmentEvaluatorStats {
    user_id: string;
    name: string | null;
    email: string | null;
    copies_checked: number;
    tests: number;
    avg_minutes_per_copy: number | null;
    last_checked_at: string | null;
}

export interface AssessmentDashboardRow {
    assessment_id: string;
    name: string;
    play_mode: string;
    visibility: string | null;
    evaluation_type: string | null;
    status: AssessmentStatus;
    /** ISO-8601 UTC. */
    start_time: string | null;
    /** Null for an anytime test. */
    end_time: string | null;
    duration_minutes: number | null;
    subject_id: string | null;
    batch_ids: string[];
    max_marks: number | null;
    expected: number;
    attempted: number;
    in_progress: number;
    not_attempted: number;
    participation_rate: number | null;
    submissions: number;
    scored: number;
    avg_score: number | null;
    highest_score: number | null;
    lowest_score: number | null;
    avg_time_minutes: number | null;
    evaluated: number;
    awaiting_evaluation: number;
    awaiting_release: number;
    checked_by_teacher: number;
    checked_by_ai: number;
    /** Teachers who checked this test's copies; names are in `evaluators`. */
    evaluator_ids: string[];
}

export interface AssessmentLearnerStats {
    user_id: string;
    name: string | null;
    email: string | null;
    mobile: string | null;
    package_session_id: string | null;
    expected_tests: number;
    attempted_tests: number;
    missed_tests: number;
    attempt_rate: number | null;
    scored_tests: number;
    avg_score: number | null;
    best_score: number | null;
    last_submitted_at: string | null;
}

export interface AssessmentDashboardData {
    start_date: string;
    end_date: string;
    timezone: string;
    generated_at: string;
    summary: AssessmentDashboardSummary;
    /** Same filters over the equally long period before the range; absent past 92 days. */
    previous_summary?: AssessmentDashboardSummary | null;
    previous_start_date?: string | null;
    previous_end_date?: string | null;
    daily: AssessmentDailyPoint[];
    score_distribution: ScoreBucket[];
    submission_heatmap: SubmissionHeatCell[];
    types: AssessmentTypeSlice[];
    batches: AssessmentBatchStats[];
    evaluators: AssessmentEvaluatorStats[];
    assessments: AssessmentDashboardRow[];
    assessments_limit: number;
    assessments_truncated: boolean;
    live_now: AssessmentDashboardRow[];
    missed_learners: AssessmentLearnerStats[];
    /** How many learners skipped at least N tests, keyed by N (1, 2, 3, 5). */
    missed_counts: Record<string, number>;
    top_learners: AssessmentLearnerStats[];
    low_scorers: AssessmentLearnerStats[];
    low_scorers_total: number;
    low_score_below: number;
    learners_limit: number;
    mode_options: string[];
    /** False when batch membership could not be loaded; "not attempted" is then understated. */
    enrollment_available: boolean;
}

export interface AssessmentDashboardParams {
    instituteId: string;
    startDate: string; // yyyy-MM-dd
    endDate: string; // yyyy-MM-dd
    batchIds: string[];
    playModes: string[];
}

const LIVE_REFRESH_MS = 60_000;

const browserTimezone = () => {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
    } catch {
        return 'Asia/Kolkata';
    }
};

const fetchAssessmentDashboard = async (
    params: AssessmentDashboardParams
): Promise<AssessmentDashboardData> => {
    const response = await authenticatedAxiosInstance.post<AssessmentDashboardData>(
        ASSESSMENT_DASHBOARD_INSIGHTS,
        {
            institute_id: params.instituteId,
            start_date: params.startDate,
            end_date: params.endDate,
            timezone: browserTimezone(),
            batch_ids: params.batchIds,
            play_modes: params.playModes,
        }
    );
    return response.data;
};

/**
 * The whole dashboard in one request. Re-polls every minute while the tab is
 * visible so "Live now" keeps up with learners starting and submitting; the
 * previous result stays on screen while a filter change loads.
 */
export const useAssessmentDashboard = (params: AssessmentDashboardParams) =>
    useQuery({
        queryKey: ['assessment-dashboard', params],
        queryFn: () => fetchAssessmentDashboard(params),
        enabled: !!params.instituteId && !!params.startDate && !!params.endDate,
        placeholderData: keepPreviousData,
        staleTime: 30_000,
        refetchInterval: LIVE_REFRESH_MS,
        refetchIntervalInBackground: false,
    });
