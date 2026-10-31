/**
 * Course knowledge — institute status and settings (ai_service /course-knowledge/v1).
 *
 * Lets the student AI answer from an institute's own lessons. Every call carries
 * the admin JWT and the institute `clientId` (added by the axios interceptor);
 * the server pins the caller to that institute and requires a staff role, and
 * the settings writes additionally require an admin role.
 *
 * GET /status is the switch every course-knowledge surface keys off: it always
 * answers 200 for staff and reports `available: false` until the platform turns
 * the feature on for the institute, so nothing renders for anyone else.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { AI_SERVICE_BASE_URL } from '@/constants/urls';

const BASE = `${AI_SERVICE_BASE_URL}/course-knowledge/v1`;

export type CourseKnowledgeRetrievalMode = 'off' | 'shadow' | 'on';

/** GET /status — also the response of PUT /settings. */
export interface CourseKnowledgeStatus {
    /** The platform has made the feature available to this institute. */
    available: boolean;
    /** New and edited lessons are made AI-ready (free text extraction). */
    enabled: boolean;
    /** The learner chatbot and voice tutor may answer from course content. */
    learner_answers_enabled: boolean;
    /** Scans and videos are processed automatically, up to the monthly cap. */
    auto_paid_enabled: boolean;
    monthly_auto_cap_credits: number;
    month_auto_spent_credits: number;
    /** Platform ceiling for `monthly_auto_cap_credits`. */
    max_monthly_auto_cap: number;
    allow_ocr: boolean;
    allow_transcription: boolean;
    /** Paid processing (button and automatic) is allowed on the platform. */
    paid_available: boolean;
    links_enabled: boolean;
    retrieval_mode: CourseKnowledgeRetrievalMode;
    /** The caller is an admin and may change settings or delete data. */
    can_manage: boolean;
}

/** GET /settings — the stored institute setting. */
export interface CourseKnowledgeSettings {
    enabled: boolean;
    learner_answers_enabled: boolean;
    auto_paid_enabled: boolean;
    monthly_auto_cap_credits: number;
    allow_ocr: boolean;
    allow_transcription: boolean;
    enabled_at: string | null;
    updated_by: string | null;
    updated_at: string | null;
}

/** PUT /settings body: only the keys sent are changed. */
export type CourseKnowledgeSettingsPatch = Partial<
    Pick<
        CourseKnowledgeSettings,
        | 'enabled'
        | 'learner_answers_enabled'
        | 'auto_paid_enabled'
        | 'monthly_auto_cap_credits'
        | 'allow_ocr'
        | 'allow_transcription'
    >
>;

/** DELETE /data — drops the course index, clears queued work, turns the feature off. */
export interface CourseKnowledgeDeleteResult {
    deleted: boolean;
    queue_rows_deleted: number;
    runs_cancelled: number;
}

/** Shape of the `detail` object on course-knowledge 4xx responses. */
export interface CourseKnowledgeErrorDetail {
    code?: string;
    message?: string;
    [key: string]: unknown;
}

/** Every course-knowledge query lives under this prefix. */
export const COURSE_KNOWLEDGE_QUERY_KEY = 'course-knowledge';
export const COURSE_KNOWLEDGE_STATUS_QUERY_KEY = [COURSE_KNOWLEDGE_QUERY_KEY, 'status'] as const;

/** What a surface shows while the status is unknown or failed: nothing. */
export const COURSE_KNOWLEDGE_UNAVAILABLE: CourseKnowledgeStatus = {
    available: false,
    enabled: false,
    learner_answers_enabled: false,
    auto_paid_enabled: false,
    monthly_auto_cap_credits: 0,
    month_auto_spent_credits: 0,
    max_monthly_auto_cap: 0,
    allow_ocr: true,
    allow_transcription: true,
    paid_available: false,
    links_enabled: false,
    retrieval_mode: 'off',
    can_manage: false,
};

export const getCourseKnowledgeStatus = async (): Promise<CourseKnowledgeStatus> => {
    const res = await authenticatedAxiosInstance.get<CourseKnowledgeStatus>(`${BASE}/status`);
    return res.data;
};

export const getCourseKnowledgeSettings = async (): Promise<CourseKnowledgeSettings> => {
    const res = await authenticatedAxiosInstance.get<CourseKnowledgeSettings>(`${BASE}/settings`);
    return res.data;
};

export const putCourseKnowledgeSettings = async (
    patch: CourseKnowledgeSettingsPatch
): Promise<CourseKnowledgeStatus> => {
    const res = await authenticatedAxiosInstance.put<CourseKnowledgeStatus>(
        `${BASE}/settings`,
        patch
    );
    return res.data;
};

export const deleteCourseKnowledgeData = async (): Promise<CourseKnowledgeDeleteResult> => {
    const res = await authenticatedAxiosInstance.delete<CourseKnowledgeDeleteResult>(
        `${BASE}/data`
    );
    return res.data;
};

/** The server's `detail` for a failed course-knowledge call, when it sent one. */
export const courseKnowledgeErrorDetail = (error: unknown): CourseKnowledgeErrorDetail | null => {
    if (!isAxiosError(error)) return null;
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
    if (detail && typeof detail === 'object') return detail as CourseKnowledgeErrorDetail;
    if (typeof detail === 'string') return { message: detail };
    return null;
};

/**
 * Status of course knowledge for the current institute. Treat a missing or
 * failed answer as "not available" — the feature then stays invisible.
 * A 4xx (e.g. a caller without a staff role) is final, so it is not retried.
 */
export const useCourseKnowledgeStatus = (options?: { enabled?: boolean }) =>
    useQuery({
        queryKey: COURSE_KNOWLEDGE_STATUS_QUERY_KEY,
        queryFn: getCourseKnowledgeStatus,
        staleTime: 5 * 60 * 1000,
        enabled: options?.enabled ?? true,
        retry: (failureCount, error) => {
            const status = isAxiosError(error) ? error.response?.status : undefined;
            if (status !== undefined && status >= 400 && status < 500) return false;
            return failureCount < 1;
        },
    });

/** PUT /settings; the response is the fresh status, then the status is refetched. */
export const useUpdateCourseKnowledgeSettings = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: putCourseKnowledgeSettings,
        onSuccess: async (status) => {
            queryClient.setQueryData(COURSE_KNOWLEDGE_STATUS_QUERY_KEY, status);
            await queryClient.invalidateQueries({ queryKey: COURSE_KNOWLEDGE_STATUS_QUERY_KEY });
        },
    });
};

/** DELETE /data; every course-knowledge query (status, course coverage) is refetched. */
export const useDeleteCourseKnowledgeData = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: deleteCourseKnowledgeData,
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: [COURSE_KNOWLEDGE_QUERY_KEY] });
        },
    });
};
