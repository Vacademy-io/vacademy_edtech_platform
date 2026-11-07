import {
    GET_ADMIN_PARTICIPANTS,
    GET_ASSESSMENT_TOTAL_MARKS_URL,
    GET_ATTEMPT_DATA,
    GET_ATTEMPTS_FILE_STATUS,
    GET_BATCH_DETAILS_URL,
    GET_EXPORT_CSV_URL_LEADERBOARD,
    GET_EXPORT_CSV_URL_RANK_MARK,
    GET_EXPORT_CSV_URL_RESPONDENT_LIST,
    GET_EXPORT_CSV_COLUMNS_SUBMISSIONS_LIST,
    GET_EXPORT_CSV_URL_SUBMISSIONS_LIST,
    GET_EXPORT_PDF_URL_LEADERBOARD,
    GET_EXPORT_PDF_URL_QUESTION_INSIGHTS,
    GET_EXPORT_PDF_URL_RANK_MARK,
    GET_EXPORT_PDF_URL_RESPONDENT_LIST,
    GET_EXPORT_PDF_URL_STUDENT_REPORT,
    GET_EXPORT_PDF_URL_AI_STUDENT_REPORT,
    GET_AI_STUDENT_REPORT_STATUS_URL,
    GET_EXPORT_PDF_URL_SUBMISSIONS_LIST,
    GET_INDIVIDUAL_STUDENT_DETAILS_URL,
    GET_LEADERBOARD_URL,
    GET_OVERVIEW_URL,
    GET_PARTICIPANT_REGISTRATION_DETAILS,
    GET_PARTICIPANTS_QUESTION_WISE,
    GET_QUESTIONS_INSIGHTS_URL,
    GET_RELEASE_STUDENT_RESULT,
    GET_REVALUATE_STUDENT_RESULT,
    PRIVATE_ADD_QUESTIONS,
    PROVIDE_REATTEMPT_URL,
    REPORT_ZIP_EXPORT_ASSEMBLE_URL,
    REPORT_ZIP_EXPORT_CANCEL_URL,
    REPORT_ZIP_EXPORT_CONTINUE_URL,
    REPORT_ZIP_EXPORT_INITIATE_URL,
    REPORT_ZIP_EXPORT_RECENT_URL,
    REPORT_ZIP_EXPORT_STATUS_URL,
    STUDENT_REPORT_DETAIL_URL,
    STUDENT_REPORT_URL,
    UPDATE_ATTEMPT,
} from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { AssessmentStudentLeaderboardInterface } from '../-components/AssessmentStudentLeaderboard';
import { AssessmentDetailQuestions } from '../-utils/assessment-details-interface';
import {
    SelectedReleaseResultFilterInterface,
    SelectedSubmissionsFilterInterface,
} from '../-components/AssessmentSubmissionsTab';
import { StudentReportFilterInterface } from '@/routes/manage-students/students-list/-components/students-list/student-side-view/student-test-records/student-test-record';
import { SelectedFilterQuestionWise } from '@/types/assessments/student-questionwise-status';
import { SelectedFilterRevaluateInterface } from '@/types/assessments/assessment-revaluate-question-wise';
import { AssessmentParticipantsInterface } from '../-components/AssessmentParticipantsList';

export const savePrivateQuestions = async (questions: AssessmentDetailQuestions) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: PRIVATE_ADD_QUESTIONS,
        data: questions,
    });
    return response?.data;
};

export const getOverviewDetials = async (assessmentId: string, instituteId: string | undefined) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_OVERVIEW_URL,
        params: {
            assessmentId,
            instituteId,
        },
    });
    return response?.data;
};

export const getQuestionsInsightsData = async (
    assessmentId: string,
    instituteId: string | undefined,
    sectionId: string | undefined
) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_QUESTIONS_INSIGHTS_URL,
        params: {
            assessmentId,
            instituteId,
            sectionId,
        },
    });
    return response?.data;
};

export const handleGetQuestionInsightsData = ({
    assessmentId,
    instituteId,
    sectionId = '',
}: {
    assessmentId: string;
    instituteId: string | undefined;
    sectionId: string | undefined;
}) => {
    return {
        queryKey: ['GET_QUESTION_INSIGHTS_DETAILS', assessmentId, instituteId, sectionId],
        queryFn: () => getQuestionsInsightsData(assessmentId, instituteId, sectionId),
        staleTime: 60 * 60 * 1000,
        enabled: !!sectionId,
    };
};

export const getStudentLeaderboardDetails = async (
    assessmentId: string,
    instituteId: string | undefined,
    pageNo: number,
    pageSize: number,
    selectedFilter: AssessmentStudentLeaderboardInterface
) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: GET_LEADERBOARD_URL,
        params: {
            assessmentId,
            instituteId,
            pageNo,
            pageSize,
        },
        data: selectedFilter,
    });
    return response?.data;
};

export const handleGetStudentLeaderboardExportPDF = async (
    assessmentId: string,
    instituteId: string | undefined
) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        responseType: 'blob',
        headers: {
            Accept: 'application/pdf',
        },
        url: GET_EXPORT_PDF_URL_LEADERBOARD,
        params: {
            assessmentId,
            instituteId,
        },
    });
    return response?.data;
};

export const handleGetStudentLeaderboardExportCSV = async (
    assessmentId: string,
    instituteId: string | undefined
) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_EXPORT_CSV_URL_LEADERBOARD,
        params: {
            assessmentId,
            instituteId,
        },
    });
    return response?.data;
};

export const handleGetStudentRankMarkExportCSV = async (
    assessmentId: string,
    instituteId: string | undefined
) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_EXPORT_CSV_URL_RANK_MARK,
        params: {
            assessmentId,
            instituteId,
        },
    });
    return response?.data;
};

export const handleGetStudentRankMarkExportPDF = async (
    assessmentId: string,
    instituteId: string | undefined
) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        responseType: 'blob',
        headers: {
            Accept: 'application/pdf',
        },
        url: GET_EXPORT_PDF_URL_RANK_MARK,
        params: {
            assessmentId,
            instituteId,
        },
    });
    return response?.data;
};

export const handleGetStudentQuestionInsightsExportPDF = async (
    assessmentId: string,
    instituteId: string | undefined,
    sectionIds: string
) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        responseType: 'blob',
        headers: {
            Accept: 'application/pdf',
        },
        url: GET_EXPORT_PDF_URL_QUESTION_INSIGHTS,
        params: {
            assessmentId,
            instituteId,
            sectionIds,
        },
    });
    return response?.data;
};

export const handleGetStudentReportExportPDF = async (
    assessmentId: string,
    instituteId: string | undefined,
    attemptId: string
) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        responseType: 'blob',
        headers: {
            Accept: 'application/pdf',
        },
        url: GET_EXPORT_PDF_URL_STUDENT_REPORT,
        params: {
            assessmentId,
            attemptId,
            instituteId,
        },
    });
    return response?.data;
};

export type AiStudentReportStatus = 'AVAILABLE' | 'NOT_GENERATED' | 'UNSUPPORTED';

export interface AiStudentReportStatusResponse {
    status: AiStudentReportStatus;
    available: boolean;
    requires_generation: boolean;
    message?: string;
}

/**
 * Whether the AI diagnostic report for this attempt already exists. Free and
 * read-only — asked before offering the download so the teacher is told
 * up-front whether it will cost AI credits.
 */
export const getAiStudentReportStatus = async (
    assessmentId: string,
    instituteId: string | undefined,
    attemptId: string
): Promise<AiStudentReportStatusResponse> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_AI_STUDENT_REPORT_STATUS_URL,
        params: {
            assessmentId,
            attemptId,
            instituteId,
        },
    });
    return response?.data;
};

/**
 * The teacher's AI diagnostic PDF. Generates the analysis on the first download
 * for an attempt, which is the call that spends AI credits; later downloads of
 * the same attempt reuse the stored analysis and cost nothing.
 */
export const handleGetAiStudentReportExportPDF = async (
    assessmentId: string,
    instituteId: string | undefined,
    attemptId: string,
    generate = true
) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        responseType: 'blob',
        headers: {
            Accept: 'application/pdf',
        },
        url: GET_EXPORT_PDF_URL_AI_STUDENT_REPORT,
        params: {
            assessmentId,
            attemptId,
            instituteId,
            generate,
        },
    });
    return response?.data;
};

export const handleGetRespondentExportPDF = async (
    instituteId: string | undefined,
    sectionId: string,
    questionId: string,
    assessmentId: string,
    selectedFilter: SelectedFilterQuestionWise
) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        responseType: 'blob',
        headers: {
            Accept: 'application/pdf',
        },
        url: GET_EXPORT_PDF_URL_RESPONDENT_LIST,
        params: {
            instituteId,
            sectionId,
            questionId,
            assessmentId,
        },
        data: selectedFilter,
    });
    return response?.data;
};

export const handleGetRespondentExportCSV = async (
    instituteId: string | undefined,
    sectionId: string,
    questionId: string,
    assessmentId: string,
    selectedFilter: SelectedFilterQuestionWise
) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: GET_EXPORT_CSV_URL_RESPONDENT_LIST,
        params: {
            instituteId,
            sectionId,
            questionId,
            assessmentId,
        },
        data: selectedFilter,
    });
    return response?.data;
};

export const handleGetSubmissionsExportPDF = async (
    instituteId: string | undefined,
    assessmentId: string,
    selectedFilter: SelectedSubmissionsFilterInterface
) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        responseType: 'blob',
        headers: {
            Accept: 'application/pdf',
        },
        url: GET_EXPORT_PDF_URL_SUBMISSIONS_LIST,
        params: {
            instituteId,
            assessmentId,
        },
        data: selectedFilter,
    });
    return response?.data;
};

export const handleGetSubmissionsExportCSV = async (
    instituteId: string | undefined,
    assessmentId: string,
    selectedFilter: SelectedSubmissionsFilterInterface
) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: GET_EXPORT_CSV_URL_SUBMISSIONS_LIST,
        params: {
            instituteId,
            assessmentId,
        },
        data: selectedFilter,
    });
    return response?.data;
};

// Export ALL participants (batch + open registration) as a result CSV.
// Sends registration_source: '' so the backend returns every submission
// regardless of how the learner enrolled. Backend returns columns: Name, Email,
// Marks Obtained, Total Marks, Percentage, Rank, Duration, Attempt Date, plus
// one column per registration-form custom field in `customFieldIds` (what
// external participants answered when registering for a public assessment).
// Omitting customFieldIds keeps every field; passing [] drops them all.
export const handleExportResultCSV = async (
    instituteId: string | undefined,
    assessmentId: string,
    assessmentType: string,
    customFieldIds?: string[],
    // Present only for the not-attempted sheet, which is not a slice of the attempt
    // tables at all and so needs the tab's own scope (batch source + PENDING, plus
    // whatever batch chips and name search are on screen) rather than the
    // all-sources result scope below.
    notAttemptedScope?: { batches: string[]; name: string }
) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: GET_EXPORT_CSV_URL_SUBMISSIONS_LIST,
        params: {
            instituteId,
            assessmentId,
        },
        data: notAttemptedScope
            ? {
                  name: notAttemptedScope.name,
                  assessment_type: assessmentType,
                  attempt_type: ['PENDING'],
                  registration_source: 'BATCH_PREVIEW_REGISTRATION',
                  batches: notAttemptedScope.batches,
                  status: ['ACTIVE'],
                  custom_field_ids: null,
                  sort_columns: {},
              }
            : {
                  name: '',
                  assessment_type: assessmentType,
                  attempt_type: ['ENDED'],
                  registration_source: '', // empty = all sources (batch + open)
                  batches: [],
                  status: ['ACTIVE'],
                  custom_field_ids: customFieldIds ?? null,
                  sort_columns: {},
              },
    });
    return response?.data;
};

export interface ResultExportCustomFieldColumn {
    id: string;
    field_name: string | null;
    field_key: string | null;
    field_type: string | null;
    field_order: number | null;
    is_mandatory: boolean | null;
    // Exact CSV header this field produces — the backend de-duplicates names that
    // clash with a result column (an "Email" form field becomes "Email (Form)").
    column_label: string;
}

export interface ResultExportColumns {
    base_columns: string[];
    custom_fields: ResultExportCustomFieldColumn[];
}

export const getResultExportColumns = async (
    instituteId: string | undefined,
    assessmentId: string,
    // Which sheet the dialog is about to export. The not-attempted sheet carries
    // contact columns instead of marks, and no registration fields at all.
    notAttempted = false
): Promise<ResultExportColumns> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_EXPORT_CSV_COLUMNS_SUBMISSIONS_LIST,
        params: { instituteId, assessmentId, notAttempted },
    });
    return response?.data;
};

// ==================================================================
// Bulk Assessment Report Export (ZIP)
// API JSON fields are snake_case (backend @JsonNaming SnakeCaseStrategy).
// ==================================================================

export interface ReportZipFailure {
    attempt_id: string;
    student_name: string;
    reason: string;
    retry_count: number;
}

export interface ReportZipStatus {
    job_id: string;
    status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED';
    total_count: number;
    completed_count: number;
    failed_count: number;
    skipped_count: number;
    download_url: string | null;
    output_file_name: string | null;
    output_size_bytes: number | null;
    error_message: string | null;
    resume_count: number;
    resumable: boolean;
    remaining_count: number;
    assemblable: boolean;
    stale_item_count: number;
    context_drift: boolean;
    started_at: string | null;
    completed_at: string | null;
    updated_at: string | null;
    failures: ReportZipFailure[];
}

export interface ReportZipJobSummary {
    job_id: string;
    status: string;
    total_count: number;
    completed_count: number;
    failed_count: number;
    output_file_name: string | null;
    download_url: string | null;
    resumable: boolean;
    assemblable: boolean;
    created_at: string;
    completed_at: string | null;
    created_by_user_id: string;
}

export const initiateReportZipExport = async ({
    assessmentId,
    instituteId,
    attemptIds,
    filter,
    regenerate,
}: {
    assessmentId: string;
    instituteId: string | undefined;
    attemptIds?: string[];
    filter?: SelectedSubmissionsFilterInterface;
    regenerate?: boolean;
}) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: REPORT_ZIP_EXPORT_INITIATE_URL,
        data: {
            assessment_id: assessmentId,
            institute_id: instituteId,
            attempt_ids: attemptIds,
            filter,
            regenerate: !!regenerate,
        },
    });
    return response?.data as { job_id: string; total_count: number; already_running: boolean; status: string };
};

export const getReportZipExportStatus = async (jobId: string, instituteId: string | undefined) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: REPORT_ZIP_EXPORT_STATUS_URL,
        params: { jobId, instituteId },
    });
    return response?.data as ReportZipStatus;
};

export const continueReportZipExport = async (jobId: string, instituteId: string | undefined) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: REPORT_ZIP_EXPORT_CONTINUE_URL,
        params: { jobId, instituteId },
    });
    return response?.data;
};

export const assembleReportZipExport = async (jobId: string, instituteId: string | undefined) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: REPORT_ZIP_EXPORT_ASSEMBLE_URL,
        params: { jobId, instituteId },
    });
    return response?.data;
};

export const getRecentReportZipExports = async (
    assessmentId: string,
    instituteId: string | undefined,
    limit = 5
) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: REPORT_ZIP_EXPORT_RECENT_URL,
        params: { assessmentId, instituteId, limit },
    });
    return response?.data as { jobs: ReportZipJobSummary[] };
};

export const cancelReportZipExport = async (jobId: string, instituteId: string | undefined) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: REPORT_ZIP_EXPORT_CANCEL_URL,
        params: { jobId, instituteId },
    });
    return response?.data;
};

export const handleGetOverviewData = ({
    assessmentId,
    instituteId,
}: {
    assessmentId: string;
    instituteId: string | undefined;
}) => {
    return {
        queryKey: ['GET_ASSESSMENT_DETAILS', assessmentId, instituteId],
        queryFn: () => getOverviewDetials(assessmentId, instituteId),
        staleTime: 60 * 60 * 1000,
    };
};

export const getAssessmentTotalMarks = async (assessmentId: string) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_ASSESSMENT_TOTAL_MARKS_URL,
        params: {
            assessmentId,
        },
    });
    return response?.data;
};

export const handleGetAssessmentTotalMarksData = ({ assessmentId }: { assessmentId: string }) => {
    return {
        queryKey: ['GET_ASSESSMENT_TOTAL_MARKS', assessmentId],
        queryFn: () => getAssessmentTotalMarks(assessmentId),
        staleTime: 60 * 60 * 1000,
    };
};

export const handleGetLeaderboardData = ({
    assessmentId,
    instituteId,
    pageNo,
    pageSize,
    selectedFilter,
}: {
    assessmentId: string;
    instituteId: string | undefined;
    pageNo: number;
    pageSize: number;
    selectedFilter: AssessmentStudentLeaderboardInterface;
}) => {
    return {
        queryKey: [
            'GET_STUDENT_LEADERBOARD_DETAILS',
            assessmentId,
            instituteId,
            pageNo,
            pageSize,
            selectedFilter,
        ],
        queryFn: () =>
            getStudentLeaderboardDetails(
                assessmentId,
                instituteId,
                pageNo,
                pageSize,
                selectedFilter
            ),
        staleTime: 60 * 60 * 1000,
    };
};

export const getAdminParticipants = async (
    assessmentId: string,
    instituteId: string | undefined,
    pageNo: number,
    pageSize: number,
    selectedFilter: SelectedSubmissionsFilterInterface
) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: GET_ADMIN_PARTICIPANTS,
        params: {
            instituteId,
            assessmentId,
            pageNo,
            pageSize,
        },
        data: {
            ...selectedFilter,
            batches: selectedFilter.batches.map((batch: { id: string }) => batch.id),
            // Send raw result_status values; empty array => backend treats as no filter.
            evaluation_status: (selectedFilter.evaluation_status ?? []).map(
                (option: { id: string }) => option.id
            ),
            // SUBMITTED / NOT_SUBMITTED; empty array => backend treats as no filter.
            submission_status: (selectedFilter.submission_status ?? []).map(
                (option: { id: string }) => option.id
            ),
        },
    });
    return response?.data;
};

export const handleAdminParticipantsData = ({
    assessmentId,
    instituteId,
    pageNo,
    pageSize,
    selectedFilter,
}: {
    assessmentId: string;
    instituteId: string | undefined;
    pageNo: number;
    pageSize: number;
    selectedFilter: SelectedSubmissionsFilterInterface;
}) => {
    return {
        queryKey: [
            'GET_ADMIN_PARTICIPANTS_DETAILS',
            assessmentId,
            instituteId,
            pageNo,
            pageSize,
            selectedFilter,
        ],
        queryFn: () =>
            getAdminParticipants(assessmentId, instituteId, pageNo, pageSize, selectedFilter),
        staleTime: 60 * 60 * 1000,
    };
};

export interface ParticipantRegistrationDetail {
    registration_id: string;
    user_id: string;
    participant_name: string;
    email: string | null;
    phone_number: string | null;
    source: string | null;
    status: string | null;
    registration_time: string | null;
    custom_fields: Array<{
        field_id: string | null;
        field_name: string | null;
        field_key: string | null;
        field_type: string | null;
        field_order: number | null;
        is_mandatory: boolean | null;
        answer: string | null;
    }>;
}

export const getParticipantRegistrationDetails = async (
    registrationId: string
): Promise<ParticipantRegistrationDetail> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_PARTICIPANT_REGISTRATION_DETAILS,
        params: { registrationId },
    });
    return response?.data;
};

export const handleGetParticipantRegistrationDetails = (registrationId: string | undefined) => {
    return {
        queryKey: ['GET_PARTICIPANT_REGISTRATION_DETAILS', registrationId],
        queryFn: () => getParticipantRegistrationDetails(registrationId as string),
        enabled: !!registrationId,
        staleTime: 60 * 1000,
    };
};

export const getStudentReport = async (
    studentId: string | undefined,
    instituteId: string | undefined,
    pageNo: number,
    pageSize: number,
    selectedFilter: StudentReportFilterInterface
) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: STUDENT_REPORT_URL,
        params: {
            studentId,
            instituteId,
            pageNo,
            pageSize,
        },
        data: selectedFilter,
    });
    return response?.data;
};

export const viewStudentReport = async (
    assessmentId: string,
    attemptId: string,
    instituteId: string | undefined
) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: STUDENT_REPORT_DETAIL_URL,
        params: {
            assessmentId,
            attemptId,
            instituteId,
        },
    });
    return response?.data;
};

export const handleStudentReportData = ({
    studentId,
    instituteId,
    pageNo,
    pageSize,
    selectedFilter,
}: {
    studentId: string | undefined;
    instituteId: string | undefined;
    pageNo: number;
    pageSize: number;
    selectedFilter: StudentReportFilterInterface;
}) => {
    return {
        queryKey: [
            'GET_STUDENT_REPORT_DETAILS',
            studentId,
            instituteId,
            pageNo,
            pageSize,
            selectedFilter,
        ],
        queryFn: () => getStudentReport(studentId, instituteId, pageNo, pageSize, selectedFilter),
        staleTime: 60 * 60 * 1000,
    };
};

export const getParticipantsListQuestionwise = async (
    assessmentId: string,
    sectionId: string | undefined,
    questionId: string | undefined,
    pageNo: number,
    pageSize: number,
    selectedFilter: SelectedFilterQuestionWise
) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: GET_PARTICIPANTS_QUESTION_WISE,
        params: {
            assessmentId,
            sectionId,
            questionId,
            pageNo,
            pageSize,
        },
        data: {
            ...selectedFilter,
            registration_source_id: selectedFilter.registration_source_id.map(
                (batch: { id: string; name: string }) => batch.id
            ),
        },
    });
    return response?.data;
};

export const handleParticipantsListQuestionwise = ({
    assessmentId,
    sectionId,
    questionId,
    pageNo,
    pageSize,
    selectedFilter,
}: {
    assessmentId: string;
    sectionId: string | undefined;
    questionId: string | undefined;
    pageNo: number;
    pageSize: number;
    selectedFilter: SelectedFilterQuestionWise;
}) => {
    return {
        queryKey: [
            'GET_PARTICIPANTS_LIST_QUESTION_WISE',
            assessmentId,
            sectionId,
            questionId,
            pageNo,
            pageSize,
            selectedFilter,
        ],
        queryFn: () =>
            getParticipantsListQuestionwise(
                assessmentId,
                sectionId,
                questionId,
                pageNo,
                pageSize,
                selectedFilter
            ),
        staleTime: 60 * 60 * 1000,
    };
};

export const getRevaluateStudentResult = async (
    assessmentId: string,
    instituteId: string | undefined,
    methodType: string,
    selectedFilter: SelectedFilterRevaluateInterface
) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: GET_REVALUATE_STUDENT_RESULT,
        params: {
            assessmentId,
            instituteId,
            methodType,
        },
        data: selectedFilter,
    });
    return response?.data;
};

export const getReleaseStudentResult = async (
    assessmentId: string,
    instituteId: string | undefined,
    methodType: string,
    selectedFilter: SelectedReleaseResultFilterInterface
) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: GET_RELEASE_STUDENT_RESULT,
        params: {
            assessmentId,
            instituteId,
            methodType,
        },
        data: selectedFilter,
    });
    return response?.data;
};

export const provideReattemptToParticipants = async (
    assessmentId: string,
    instituteId: string | undefined,
    registrationIds: string[],
    reattemptCount = 1
) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: PROVIDE_REATTEMPT_URL,
        params: {
            assessmentId,
            instituteId,
        },
        data: {
            registration_ids: registrationIds,
            reattempt_count: reattemptCount,
        },
    });
    return response?.data;
};

export const getBatchDetailsListOfStudents = async (
    pageNo: number,
    pageSize: number,
    selectedFilter: AssessmentParticipantsInterface
) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: GET_BATCH_DETAILS_URL,
        params: {
            pageNo,
            pageSize,
        },
        data: {
            ...selectedFilter,
            gender: selectedFilter.gender.map((type: { id: string; name: string }) => type.name),
        },
    });
    return response?.data;
};

export const getBatchDetailsListOfIndividualStudents = async (
    instituteId: string | undefined,
    assessmentId: string
) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_INDIVIDUAL_STUDENT_DETAILS_URL,
        params: {
            instituteId,
            assessmentId,
        },
    });
    return response?.data;
};

export const handleGetIndividualStudentList = ({
    instituteId,
    assessmentId,
}: {
    instituteId: string | undefined;
    assessmentId: string;
}) => {
    return {
        queryKey: ['GET_INDIVIDUAL_STUDENT_DETAILS', instituteId, assessmentId],
        queryFn: () => getBatchDetailsListOfIndividualStudents(instituteId, assessmentId),
        staleTime: 60 * 60 * 1000,
        enabled: assessmentId !== 'defaultId' ? true : false,
    };
};

// Pure read by default. Pass markEvaluating=true ONLY from the manual
// evaluator flow — it transitions the attempt's result_status to EVALUATING
// (the backend never downgrades an already-COMPLETED attempt).
export const getAttemptData = async (attemptId: string, markEvaluating = false) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: `${GET_ATTEMPT_DATA}`,
        params: {
            attemptId,
            markEvaluating,
        },
    });
    return response?.data;
};

// Batch: which of these attempts have a submitted answer-sheet file. Returns a
// map of attemptId -> fileId; attempts without a file are absent from the map.
export const getAttemptsFileStatus = async (
    attemptIds: string[]
): Promise<Record<string, string>> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: GET_ATTEMPTS_FILE_STATUS,
        data: attemptIds,
    });
    return response?.data ?? {};
};

export const getAttemptDetails = (attemptId: string, markEvaluating = false) => {
    return {
        queryKey: ['GET_ASSESSMENT_DETAILS', attemptId, markEvaluating],
        queryFn: () => getAttemptData(attemptId, markEvaluating),
        staleTime: 60 * 60 * 1000,
        enabled: !!attemptId,
    };
};

export const handleUpdateAttempt = async (attemptId: string, fileId: string) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: UPDATE_ATTEMPT,
        params: {
            attemptId,
            fileId,
        },
    });
    return response?.data;
};
