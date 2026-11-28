import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import type {
    AssessmentReportPagesResponse,
    ReportPagesConfig,
} from '@/types/assessments/report-pages';

const REPORT_PROFILE_URL = `${BASE_URL}/assessment-service/assessment/report-profile/v1`;

/** This test's report pages (no assessmentId = a test not saved yet: institute default only). */
export const getAssessmentReportPages = async (
    instituteId: string,
    assessmentId?: string | null
): Promise<AssessmentReportPagesResponse> => {
    const response = await authenticatedAxiosInstance.get<AssessmentReportPagesResponse>(
        `${REPORT_PROFILE_URL}/for-assessment`,
        { params: { instituteId, ...(assessmentId ? { assessmentId } : {}) } }
    );
    return response.data;
};

export interface ReportProfileSummary {
    id: string;
    name: string;
    is_institute_default: boolean;
}

/** The institute's saved page sets, for "Copy pages from". */
export const listReportProfiles = async (instituteId: string): Promise<ReportProfileSummary[]> => {
    const response = await authenticatedAxiosInstance.get<ReportProfileSummary[]>(
        `${REPORT_PROFILE_URL}/list`,
        { params: { instituteId } }
    );
    return Array.isArray(response.data) ? response.data : [];
};

export const getReportProfile = async (
    instituteId: string,
    profileId: string
): Promise<{ id: string; name: string; institute_default: boolean; config: ReportPagesConfig }> => {
    const response = await authenticatedAxiosInstance.get(`${REPORT_PROFILE_URL}/get`, {
        params: { instituteId, profileId },
    });
    return response.data;
};

/** The PDF this attempt's student would get with the pages as they are on screen (not saved). */
export const previewReportPages = async (
    instituteId: string,
    assessmentId: string,
    attemptId: string,
    body: unknown
): Promise<Blob> => {
    const response = await authenticatedAxiosInstance.post(`${REPORT_PROFILE_URL}/preview-pages`, body, {
        params: { instituteId, assessmentId, attemptId },
        responseType: 'blob',
    });
    return response.data as Blob;
};
