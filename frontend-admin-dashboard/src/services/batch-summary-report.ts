import { queryOptions } from '@tanstack/react-query';
import { BATCH_SUMMARY_REPORT_BASE } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';

/** Section keys of the generated batch report (backend BatchReportSettingConfig). */
export const BATCH_REPORT_SECTIONS = [
    'OVERVIEW',
    'RESULTS',
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
        description: 'Learners, pass rate, average quiz score, completion, time and concentration.',
        namesLearners: false,
    },
    RESULTS: {
        label: 'Results',
        description: 'How many learners passed, failed or have not attempted a quiz.',
        namesLearners: false,
    },
    SUBJECT_PROGRESS: {
        label: 'Subject progress',
        description: 'Average completion and time per subject.',
        namesLearners: false,
    },
    TOP_PERFORMERS: {
        label: 'Top performers',
        description: 'The ten learners with the highest average quiz score.',
        namesLearners: true,
    },
    NEEDS_ATTENTION: {
        label: 'Needs attention',
        description: 'Learners who failed or have not attempted, lowest first.',
        namesLearners: true,
    },
    LEARNER_RESULTS: {
        label: 'All learners',
        description: 'Every learner with their average quiz score and result.',
        namesLearners: true,
    },
    ACTIVITY: {
        label: 'Most active learners',
        description: 'Top ten by time spent learning in the selected dates.',
        namesLearners: true,
    },
};

export type BatchLearnerStatus = 'PASSED' | 'FAILED' | 'NOT_ATTEMPTED';

export interface BatchSummaryReport {
    package_session_id: string;
    batch_name: string | null;
    institute_name: string | null;
    start_date: string;
    end_date: string;
    pass_percentage: number;
    sections: BatchReportSection[];
    enrolled_learners: number;
    learners_attempted: number;
    passed_learners: number;
    failed_learners: number;
    not_attempted_learners: number;
    pass_rate: number | null;
    avg_quiz_score: number | null;
    quizzes_in_course: number;
    learners_truncated: boolean;
    avg_course_completion: number | null;
    avg_time_spent_minutes: number | null;
    avg_concentration: number | null;
    subjects: {
        subject_name: string;
        avg_completion: number | null;
        avg_time_minutes: number | null;
        modules: number;
    }[];
    learners: {
        user_id: string;
        full_name: string;
        avg_score_percent: number | null;
        quizzes_attempted: number;
        quizzes_in_course: number;
        status: BatchLearnerStatus;
    }[];
    activity: {
        rank: number | null;
        user_id: string;
        full_name: string;
        total_time_minutes: number | null;
        daily_avg_minutes: number | null;
        avg_concentration: number | null;
    }[];
}

export interface BatchSummaryRequest {
    package_session_id: string;
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
    pass_percentage: number;
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
        enabled: !!body.package_session_id && !!body.start_date && !!body.end_date,
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
