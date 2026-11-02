import { queryOptions } from '@tanstack/react-query';
import { BATCH_SUMMARY_REPORT_BASE } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';

/** Section keys of the generated batch report (backend BatchReportSettingConfig). */
export const BATCH_REPORT_SECTIONS = [
    'OVERVIEW',
    'RESULTS',
    'ASSESSMENTS',
    'STRENGTHS',
    'SUBJECT_PROGRESS',
    'TOP_PERFORMERS',
    'NEEDS_ATTENTION',
    'LEARNER_RESULTS',
    'ACTIVITY',
] as const;
export type BatchReportSection = (typeof BATCH_REPORT_SECTIONS)[number];

export const BATCH_REPORT_SECTION_META: Record<
    BatchReportSection,
    { label: string; description: string; namesLearners: boolean }
> = {
    OVERVIEW: {
        label: 'Overview',
        description: 'Learners, participation, assessments held and course completion.',
        namesLearners: false,
    },
    RESULTS: {
        label: 'Score bands',
        description: 'Learners at 60% and above, 40 to 60%, under 40%, and where scores fall.',
        namesLearners: false,
    },
    ASSESSMENTS: {
        label: 'Assessments',
        description: 'Average score in each assessment over time, and by subject.',
        namesLearners: false,
    },
    STRENGTHS: {
        label: 'Strengths and weaknesses',
        description: 'Topics the batch answers well and topics to work on.',
        namesLearners: false,
    },
    SUBJECT_PROGRESS: {
        label: 'Course progress',
        description: 'Average completion and time per subject (one batch only).',
        namesLearners: false,
    },
    TOP_PERFORMERS: {
        label: 'Top performers',
        description: 'The ten learners with the highest average score.',
        namesLearners: true,
    },
    NEEDS_ATTENTION: {
        label: 'Needs attention',
        description: 'Learners under 40% or with no assessment attempt.',
        namesLearners: true,
    },
    LEARNER_RESULTS: {
        label: 'All learners',
        description: 'Every learner with their average score.',
        namesLearners: true,
    },
    ACTIVITY: {
        label: 'Most active learners',
        description: 'Top ten by time spent learning (one batch only).',
        namesLearners: true,
    },
};

export type BatchLearnerBand = 'STRONG' | 'AVERAGE' | 'WEAK' | 'NOT_ASSESSED';

export interface BatchSummaryReport {
    package_session_id: string | null;
    batch_name: string | null;
    institute_name: string | null;
    brand_color: string | null;
    start_date: string;
    end_date: string;
    sections: BatchReportSection[];
    enrolled_learners: number;
    learners_assessed: number;
    assessments_held: number;
    total_attempts: number;
    avg_score: number | null;
    participation_rate: number | null;
    learners_truncated: boolean;
    strong_learners: number;
    average_learners: number;
    weak_learners: number;
    not_assessed_learners: number;
    assessments: {
        assessment_id: string;
        name: string;
        date: string | null;
        subject: string | null;
        attempts: number;
        avg_score: number | null;
    }[];
    subject_scores: { subject: string; avg_score: number | null; assessments: number; attempts: number }[];
    topics: {
        topic: string;
        questions: number;
        correct: number;
        accuracy: number | null;
        mastery_level: string | null;
    }[];
    attempts_analyzed: number | null;
    learners: {
        user_id: string;
        full_name: string;
        avg_score: number | null;
        assessments_taken: number;
        band: BatchLearnerBand;
    }[];
    batches: {
        package_session_id: string;
        learners: number;
        learners_assessed: number;
        avg_score: number | null;
    }[] | null;
    avg_course_completion: number | null;
    avg_time_spent_minutes: number | null;
    avg_concentration: number | null;
    subjects: {
        subject_name: string;
        avg_completion: number | null;
        avg_time_minutes: number | null;
        modules: number;
    }[] | null;
    activity: {
        rank: number | null;
        user_id: string;
        full_name: string;
        total_time_minutes: number | null;
        daily_avg_minutes: number | null;
        avg_concentration: number | null;
    }[] | null;
}

export interface BatchSummaryRequest {
    /** Omitted for the all-batches report. */
    package_session_id?: string;
    batch_name?: string;
    start_date: string;
    end_date: string;
    sections?: BatchReportSection[];
}

export type BatchReportAudience = 'TEACHERS' | 'PARENTS';

export interface BatchReportSendResult {
    audience: BatchReportAudience;
    sent: number;
    skipped: number;
    notes: string[] | null;
}

export interface BatchReportTemplate {
    sections: BatchReportSection[];
    all_sections: BatchReportSection[];
}

export const fetchBatchSummaryReport = async (
    body: BatchSummaryRequest
): Promise<BatchSummaryReport> => {
    const { data } = await authenticatedAxiosInstance.post<BatchSummaryReport>(
        `${BATCH_SUMMARY_REPORT_BASE}/summary`,
        body
    );
    return data;
};

export const getBatchSummaryReportQuery = (body: BatchSummaryRequest) =>
    queryOptions({
        queryKey: ['BATCH_SUMMARY_REPORT', body],
        queryFn: () => fetchBatchSummaryReport(body),
        enabled: !!body.start_date && !!body.end_date,
        staleTime: 60_000,
    });

export const fetchBatchReportPreview = async (body: BatchSummaryRequest): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.post<{ html: string }>(
        `${BATCH_SUMMARY_REPORT_BASE}/preview`,
        body
    );
    return data.html;
};

export const downloadBatchReportPdf = async (body: BatchSummaryRequest): Promise<Blob> => {
    const { data } = await authenticatedAxiosInstance.post(
        `${BATCH_SUMMARY_REPORT_BASE}/pdf`,
        body,
        {
            responseType: 'blob',
        }
    );
    return data as Blob;
};

export const sendBatchReport = async (
    body: BatchSummaryRequest & { audience: BatchReportAudience }
): Promise<BatchReportSendResult> => {
    const { data } = await authenticatedAxiosInstance.post<BatchReportSendResult>(
        `${BATCH_SUMMARY_REPORT_BASE}/send`,
        body
    );
    return data;
};

export const getBatchReportTemplateQuery = () =>
    queryOptions({
        queryKey: ['BATCH_REPORT_TEMPLATE'],
        queryFn: async () => {
            const { data } = await authenticatedAxiosInstance.get<BatchReportTemplate>(
                `${BATCH_SUMMARY_REPORT_BASE}/setting`
            );
            return data;
        },
        staleTime: 5 * 60_000,
    });
