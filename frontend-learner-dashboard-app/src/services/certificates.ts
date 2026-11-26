import { getInstituteIdSync } from "@/components/common/helper";
import {
    CERTIFICATE_CONFIG,
    CERTIFICATE_ELIGIBILITY,
    GENERATE_CERTIFICATE,
} from "@/constants/urls";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import LocalStorageUtils from "@/utils/localstorage";

/**
 * How the course's certificate is earned. PROGRESS is the original rule
 * (completion % at or above the threshold). Anything else involves marks in
 * quizzes/assessments, which only the server can grade - so the client must ask
 * the eligibility endpoint instead of comparing percentages itself.
 */
export type CertificateCriteriaMode = "PROGRESS" | "SCORE" | "PROGRESS_AND_SCORE";

export type CertificateConfig = {
    enabled: boolean;
    thresholdPercent: number;
    criteriaMode: CertificateCriteriaMode;
    /**
     * This learner already holds the batch's certificate. Ask for it whatever the rule
     * says now: an issued certificate is never taken away, and the backend returns an
     * existing one without re-checking the rule.
     */
    certificateIssued: boolean;
};

// Fail closed. If the config can't be fetched we must not attempt issuance:
// treating an error as "enabled" would resurrect the old bug where certificates
// were generated for institutes that had switched them off.
const DISABLED_CONFIG: CertificateConfig = {
    enabled: false,
    thresholdPercent: 80,
    criteriaMode: "PROGRESS",
    certificateIssued: false,
};

const CRITERIA_MODES: CertificateCriteriaMode[] = ["PROGRESS", "SCORE", "PROGRESS_AND_SCORE"];

export type CertificateTestStatus =
    | "PASSED"
    | "FAILED"
    | "COMPLETED"
    | "NOT_ATTEMPTED"
    | "AWAITING_RESULT";

export type CertificateTestResult = {
    slide_id: string;
    title: string | null;
    type: "QUIZ" | "ASSESSMENT";
    module_name: string | null;
    chapter_name: string | null;
    score_percent: number | null;
    pass_percent: number | null;
    status: CertificateTestStatus;
    attempts: number;
};

/** The learner's standing against the course's certificate rule, test by test. */
export type CertificateEligibility = {
    enabled: boolean;
    mode: CertificateCriteriaMode;
    eligible: boolean;
    progress_required: boolean;
    threshold_percent: number;
    completion_percentage: number | null;
    progress_met: boolean;
    score_required: boolean;
    score_met: boolean;
    pass_rule: "ALL" | "AT_LEAST" | "AVERAGE" | null;
    pass_percent: number | null;
    tests_required: number | null;
    tests_total: number;
    tests_passed: number;
    tests_awaiting_result: number;
    tests_not_attempted: number;
    average_score_percent: number | null;
    score_blocker: string | null;
    tests: CertificateTestResult[];
};

/**
 * Graded server-side for the authenticated learner. Null when it could not be
 * fetched - the caller must then not attempt issuance (fail closed).
 */
export async function getCertificateEligibility(
    packageSessionId: string,
): Promise<CertificateEligibility | null> {
    try {
        const instituteId = await getInstituteIdSync();
        if (!instituteId || !packageSessionId) return null;
        const response = await authenticatedAxiosInstance({
            method: "GET",
            url: CERTIFICATE_ELIGIBILITY,
            params: { instituteId, packageSessionId },
        });
        const data = response?.data;
        if (!data || typeof data !== "object") return null;
        return {
            ...data,
            tests: Array.isArray(data.tests) ? data.tests : [],
        } as CertificateEligibility;
    } catch {
        return null;
    }
}

/**
 * Certificate config for one batch, resolved server-side from Certificate
 * Settings (course override falling back to the institute default).
 *
 * Replaces reading `STUDENT_DISPLAY_SETTINGS.certificates`, which held a second
 * copy of these two values on a different settings page and was the only one the
 * learner app honoured — so the client and server could disagree about whether a
 * certificate was due.
 */
export async function getCertificateConfig(
    packageSessionId: string,
): Promise<CertificateConfig> {
    try {
        const instituteId = await getInstituteIdSync();
        if (!instituteId || !packageSessionId) return DISABLED_CONFIG;

        const response = await authenticatedAxiosInstance({
            method: "GET",
            url: CERTIFICATE_CONFIG,
            params: { instituteId, packageSessionId },
        });
        const data = response?.data ?? {};
        return {
            enabled: data.enabled === true,
            thresholdPercent:
                typeof data.threshold_percent === "number"
                    ? data.threshold_percent
                    : DISABLED_CONFIG.thresholdPercent,
            // An older backend sends no mode: that is the progress-only rule.
            criteriaMode: CRITERIA_MODES.includes(data.criteria_mode)
                ? data.criteria_mode
                : "PROGRESS",
            certificateIssued: data.certificate_issued === true,
        };
    } catch {
        return DISABLED_CONFIG;
    }
}

type GenerateCertificateRequest = {
    user_id: string;
    package_session_id: string;
    // Learner's current completion percentage. REQUIRED for a fresh render:
    // the backend re-validates it against the institute's auto-issue threshold
    // and returns no certificate when it's missing or below the threshold.
    completion_percentage?: number;
    // Human-readable course name used for the {{COURSE_NAME}} token, the audit
    // row, and the issued-certificate email. Falls back to the package name on
    // the backend when omitted.
    course_name?: string;
};

type GenerateCertificateResponse = {
    status: 200 | 202;
    url: string;
    generated_at: string; // ISO time when certificate was generated
};

const CACHE_KEY_PREFIX = "CERTIFICATE_GENERATION_STATUS_";
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

function buildCacheKey(userId: string, packageSessionId: string): string {
    return `${CACHE_KEY_PREFIX}${userId}_${packageSessionId}`;
}

export function getCachedCertificateStatus(
    userId: string,
    packageSessionId: string
): GenerateCertificateResponse | null {
    const cacheKey = buildCacheKey(userId, packageSessionId);
    const cached = LocalStorageUtils.get<{
        savedAt: number;
        data: GenerateCertificateResponse;
    }>(cacheKey);
    if (!cached) {
        return null;
    }
    const isStale = Date.now() - cached.savedAt > THREE_HOURS_MS;
    if (isStale) {
        LocalStorageUtils.remove(cacheKey);
        return null;
    }
    return cached.data;
}

export function setCachedCertificateStatus(
    userId: string,
    packageSessionId: string,
    data: GenerateCertificateResponse
): void {
    const cacheKey = buildCacheKey(userId, packageSessionId);
    LocalStorageUtils.set(cacheKey, { savedAt: Date.now(), data });
}

export const generateCertificateUrl = async ({
    learnerId,
    packageSessionId,
    generatedAt,
    completionPercentage,
    courseName,
    regenerate,
}: {
    learnerId: string;
    packageSessionId: string;
    generatedAt: string;
    completionPercentage?: number;
    courseName?: string;
    // When true the backend bypasses the cached file id on the learner mapping
    // and re-renders against the *current* template. Used by the Refresh flow.
    regenerate?: boolean;
}) => {
    const instituteId = await getInstituteIdSync();
    // Field names are snake_case to match CertificationGenerationRequest
    // (@JsonNaming(SnakeCaseStrategy)) on the backend.
    const response = await authenticatedAxiosInstance({
        method: "POST",
        url: GENERATE_CERTIFICATE,
        params: {
            learnerId,
            packageSessionId,
            instituteId,
        },
        data: {
            completion_date: generatedAt,
            completion_percentage: completionPercentage,
            course_name: courseName,
            regenerate: regenerate ?? false,
        },
    });
    return response;
};

export async function generateCertificateWithCache(
    payload: GenerateCertificateRequest,
    opts?: { bypassCache?: boolean; regenerate?: boolean }
): Promise<GenerateCertificateResponse> {
    const { user_id, package_session_id, completion_percentage, course_name } =
        payload;

    // A regenerate request must always reach the backend so the freshly-saved
    // template is rendered; it also skips (and overwrites) the local cache that
    // would otherwise keep returning the stale PDF URL for up to 3 hours.
    const bypass = opts?.bypassCache || opts?.regenerate;
    if (!bypass) {
        const cached = getCachedCertificateStatus(user_id, package_session_id);
        if (cached) return cached;
    }

    const generatedAt = new Date().toISOString();
    const response = await generateCertificateUrl({
        learnerId: user_id,
        packageSessionId: package_session_id,
        generatedAt,
        completionPercentage: completion_percentage,
        courseName: course_name,
        regenerate: opts?.regenerate,
    });

    // The controller returns the certificate URL as the response body, with
    // HTTP 200 for a freshly-rendered certificate and 202 for a cached one.
    const url =
        typeof response?.data === "string"
            ? response.data
            : (response?.data?.url ?? "");
    const result: GenerateCertificateResponse = {
        status: response?.status === 200 ? 200 : 202,
        url,
        generated_at: generatedAt,
    };
    setCachedCertificateStatus(user_id, package_session_id, result);
    return result;
}

export type { GenerateCertificateRequest, GenerateCertificateResponse };
