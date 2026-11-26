import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    COURSE_CERTIFICATE_DASHBOARD,
    COURSE_CERTIFICATE_ISSUE,
    COURSE_CERTIFICATE_LEARNER_ELIGIBILITY,
    COURSE_CERTIFICATE_LEARNERS,
    COURSE_CERTIFICATE_RESEND,
    COURSE_CERTIFICATE_SETTINGS,
    COURSE_CERTIFICATE_TESTS,
} from '@/constants/urls';

export type CertificateCriteriaMode = 'PROGRESS' | 'SCORE' | 'PROGRESS_AND_SCORE';
export type CertificateTestScope = 'ALL' | 'CUSTOM';
export type CertificatePassRule = 'ALL' | 'AT_LEAST' | 'AVERAGE';
export type CertificateTestType = 'QUIZ' | 'ASSESSMENT';

/**
 * How a learner earns this course's certificate. Stored camelCase inside the
 * course override, like the override's other fields. Null (or mode PROGRESS)
 * keeps the original rule: course progress at or above the threshold.
 */
export interface CertificateCriteria {
    mode?: CertificateCriteriaMode | null;
    /** ALL = every quiz/assessment in the course; CUSTOM = the picked modules, chapters and tests. */
    testScope?: CertificateTestScope | null;
    moduleIds?: string[] | null;
    chapterIds?: string[] | null;
    /** Picked tests always count, whatever testTypes says. */
    slideIds?: string[] | null;
    /** What a course/module/chapter selection expands to. Empty means both. */
    testTypes?: CertificateTestType[] | null;
    passRule?: CertificatePassRule | null;
    minTestsToPass?: number | null;
    /** Pass mark per test, or the bar for the average under AVERAGE. Default 60. */
    passPercent?: number | null;
    /** A quiz with its own pass % is judged by it (default true). */
    useOwnPassPercent?: boolean | null;
}

/** One quiz or assessment slide in the course, for the "which tests count" picker. */
export interface CertificateTestOption {
    slide_id: string;
    title: string | null;
    type: CertificateTestType;
    /** PUBLISHED / UNSYNC count for learners; DRAFT does not until published. */
    status: string | null;
    subject_id: string | null;
    subject_name: string | null;
    module_id: string | null;
    module_name: string | null;
    chapter_id: string | null;
    chapter_name: string | null;
    own_pass_percent: number | null;
    assessment_id: string | null;
}

export type CertificateTestStatus =
    | 'PASSED'
    | 'FAILED'
    | 'COMPLETED'
    | 'NOT_ATTEMPTED'
    | 'AWAITING_RESULT';

export interface CertificateTestResult {
    slide_id: string;
    title: string | null;
    type: CertificateTestType;
    module_name: string | null;
    chapter_name: string | null;
    score_percent: number | null;
    pass_percent: number | null;
    status: CertificateTestStatus;
    attempts: number;
}

/** One learner's standing against the course rule, test by test. */
export interface CertificateEligibility {
    enabled: boolean;
    mode: CertificateCriteriaMode;
    eligible: boolean;
    progress_required: boolean;
    threshold_percent: number;
    completion_percentage: number | null;
    progress_met: boolean;
    score_required: boolean;
    score_met: boolean;
    pass_rule: CertificatePassRule | null;
    pass_percent: number | null;
    tests_required: number | null;
    tests_total: number;
    tests_passed: number;
    tests_awaiting_result: number;
    tests_not_attempted: number;
    average_score_percent: number | null;
    score_blocker: 'NO_TESTS_FOUND' | 'ASSESSMENT_SCORES_UNAVAILABLE' | null;
    tests: CertificateTestResult[];
}

/**
 * Per-course override. Every field is nullable — null means inherit the
 * institute default. Certificate numbering is deliberately absent: the format is
 * an institute-wide setting so numbers stay consistent across courses.
 */
export interface CourseCertificateOverride {
    enabled?: boolean | null;
    thresholdPercent?: number | null;
    /**
     * One of the institute's saved designs, by id. Stored as a reference rather
     * than a copy so the course follows edits to that template instead of
     * freezing whatever it looked like the day it was picked.
     */
    templateId?: string | null;
    /** HTML uploaded for this course alone. Mutually exclusive with templateId. */
    templateHtml?: string | null;
    /** How the certificate is earned. Null keeps progress-only. */
    criteria?: CertificateCriteria | null;
}

export interface CourseCertificateSettings {
    effective_enabled: boolean;
    effective_threshold_percent: number;
    institute_enabled: boolean;
    institute_threshold_percent: number;
    course_override: CourseCertificateOverride | null;
    enabled_overridden_by_course: boolean;
    threshold_overridden_by_course: boolean;
    has_course_template: boolean;
    /**
     * The saved design in force after resolution — null when the course
     * inherits, or when the id it held no longer exists.
     */
    course_template_id: string | null;
}

export interface CourseCertificateDashboard {
    total_enrolled: number;
    certificates_generated: number;
    certificates_pending: number;
    completed_awaiting_certificate: number;
    near_threshold: number;
    threshold_percent: number;
    /**
     * The earning rule in force. Under a score rule, completed_awaiting_certificate
     * means "meets the whole rule" and near_threshold means one test short (or,
     * for an average rule, within 10 points of the bar).
     */
    criteria_mode?: CertificateCriteriaMode | null;
    pass_rule?: CertificatePassRule | null;
    /** Live tests in this batch that the rule counts. */
    tests_in_rule?: number | null;
    /** Learners with at least one test whose marks are not final yet. */
    learners_awaiting_results?: number | null;
}

export interface CourseCertificateLearner {
    user_id: string;
    full_name: string | null;
    email: string | null;
    completion_percentage: number | null;
    status: 'GENERATED' | 'AWAITING' | 'PENDING';
    certificate_number: string | null;
    /** Already resolved to a public URL by the backend. */
    file_id: string | null;
    issued_at: string | null;
    // Present only under a test-score rule.
    tests_passed?: number | null;
    tests_total?: number | null;
    tests_required?: number | null;
    tests_awaiting_result?: number | null;
    average_score_percent?: number | null;
    score_met?: boolean | null;
}

export interface CourseCertificateLearnerPage {
    content: CourseCertificateLearner[];
    pageNo: number;
    pageSize: number;
    totalElements: number;
    totalPages: number;
    last: boolean;
}

export const getCourseCertificateSettings = async (
    instituteId: string,
    packageId: string
): Promise<CourseCertificateSettings> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: COURSE_CERTIFICATE_SETTINGS,
        params: { instituteId, packageId },
    });
    return response.data;
};

export const saveCourseCertificateSettings = async (
    instituteId: string,
    packageId: string,
    payload: CourseCertificateOverride
): Promise<void> => {
    await authenticatedAxiosInstance({
        method: 'POST',
        url: COURSE_CERTIFICATE_SETTINGS,
        params: { instituteId, packageId },
        data: payload,
    });
};

export const getCourseCertificateDashboard = async (
    instituteId: string,
    packageSessionId: string,
    packageId?: string
): Promise<CourseCertificateDashboard> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: COURSE_CERTIFICATE_DASHBOARD,
        params: { instituteId, packageSessionId, packageId },
    });
    return response.data;
};

export const getCourseCertificateLearners = async (params: {
    instituteId: string;
    packageSessionId: string;
    packageId?: string;
    search?: string;
    status?: string;
    page: number;
    size: number;
}): Promise<CourseCertificateLearnerPage> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: COURSE_CERTIFICATE_LEARNERS,
        params,
    });
    return response.data;
};

/**
 * Issue for a learner who has none, or re-render an existing certificate.
 * A re-render keeps the learner's existing certificate number.
 */
export const issueCourseCertificate = async (params: {
    instituteId: string;
    packageSessionId: string;
    userId: string;
    regenerate?: boolean;
    courseName?: string;
    /** "Issue anyway": skip the course rule. Certificates must still be switched on. */
    force?: boolean;
}): Promise<string> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: COURSE_CERTIFICATE_ISSUE,
        params,
    });
    return response.data;
};

/** Every quiz and assessment across the course's batches, in course order. */
export const getCourseCertificateTests = async (
    instituteId: string,
    packageId: string
): Promise<CertificateTestOption[]> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: COURSE_CERTIFICATE_TESTS,
        params: { instituteId, packageId },
    });
    return Array.isArray(response.data) ? response.data : [];
};

/** One learner's standing against the course rule, for the table's detail view. */
export const getLearnerCertificateEligibility = async (params: {
    instituteId: string;
    packageSessionId: string;
    userId: string;
}): Promise<CertificateEligibility> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: COURSE_CERTIFICATE_LEARNER_ELIGIBILITY,
        params,
    });
    return response.data;
};

export const resendCourseCertificate = async (
    instituteId: string,
    certificateId: string
): Promise<void> => {
    await authenticatedAxiosInstance({
        method: 'POST',
        url: COURSE_CERTIFICATE_RESEND,
        params: { instituteId, certificateId },
    });
};
