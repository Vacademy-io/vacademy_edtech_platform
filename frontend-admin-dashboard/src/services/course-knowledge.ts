/**
 * Course knowledge — per-course coverage and the "Make course AI-ready" flow
 * (ai_service /course-knowledge/v1). Institute status and settings live in
 * ./course-knowledge-settings.ts; every query here keys under the same
 * ['course-knowledge', …] prefix so a data delete there refetches these too.
 *
 * The server pins the caller to the institute in the `clientId` header (added
 * by the axios interceptor) and checks that the course belongs to it. Scan,
 * retry and preview need a staff role; process and cancel need an admin role.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { AI_SERVICE_BASE_URL } from '@/constants/urls';
import { COURSE_KNOWLEDGE_QUERY_KEY } from '@/services/course-knowledge-settings';
import { formatNumber } from '@/lib/formatters';

const BASE = `${AI_SERVICE_BASE_URL}/course-knowledge/v1`;

export type CourseLessonState =
    | 'READY'
    | 'NEEDS_PROCESSING'
    | 'PROCESSING'
    | 'NOT_SCANNED'
    | 'CANT_READ'
    | 'FAILED'
    | 'EXCLUDED';

export type CourseQuoteKind = 'ocr_pages' | 'transcribe_minutes' | 'deck_images';

export type CourseRunKind = 'SCAN' | 'PROCESS';
export type CourseRunStatus = 'RUNNING' | 'DONE' | 'PARTIAL' | 'CANCELLED';

export interface CourseCoverageTotals {
    lessons: number;
    ready: number;
    needs_processing: number;
    processing: number;
    not_scanned: number;
    cant_read: number;
    failed: number;
    /** Assessments: never shown to the AI. */
    excluded: number;
    credits_required: number;
    credits_charged: number;
}

export interface CourseQuoteItem {
    kind: CourseQuoteKind;
    /** Pages, minutes or slides, depending on `kind`. */
    units: number;
    credits: number;
    lessons: number;
}

export interface CourseQuote {
    credits: number;
    /** Part of the quote assumes a length (an uploaded video not read yet). */
    approx: boolean;
    items: CourseQuoteItem[];
}

/** All null when the institute has no credit wallet (which never blocks). */
export interface CourseCoverageBalance {
    current_balance: number | null;
    balance_after: number | null;
    sufficient: boolean | null;
}

/** The coverage `active_run` shape (GET /runs/{id} adds credits and times). */
export interface CourseActiveRun {
    id: string;
    kind: CourseRunKind;
    status: CourseRunStatus;
    total: number;
    pending: number;
    processing: number;
    done: number;
    failed: number;
}

export interface CourseCoverageLesson {
    slide_id: string;
    title: string | null;
    chapter_id: string | null;
    chapter_name: string | null;
    source_type: string | null;
    doc_type: string | null;
    state: CourseLessonState;
    reason: string | null;
    units: number | null;
    credits: number;
    credits_charged: number;
    chunk_count: number;
    anchor_kind: string | null;
    updated_at: string | null;
    /** "No clear speech" with the transcript kept: what using it anyway costs. */
    kept_transcript?: CourseKeptTranscriptPrice | null;
}

export interface CourseKeptTranscriptPrice {
    minutes: number;
    credits: number;
}

/** GET /packages/{id}/lessons/{slide_id}/kept-transcript */
export interface CourseKeptTranscript {
    slide_id: string;
    minutes: number;
    credits: number;
    words: number;
    preview: string;
}

/** POST /packages/{id}/lessons/{slide_id}/use-kept-transcript (202). */
export interface CourseUseKeptTranscriptResult {
    slide_id: string;
    queued: boolean;
    credits_charged: number;
}

/** GET /packages/{id}/coverage */
export interface CourseCoverage {
    package_id: string;
    totals: CourseCoverageTotals;
    quote: CourseQuote;
    balance: CourseCoverageBalance;
    active_run: CourseActiveRun | null;
    lessons: CourseCoverageLesson[];
}

/** GET /runs/{id} */
export interface CourseRun extends CourseActiveRun {
    skipped: number;
    quoted_credits: number;
    charged_credits: number;
    created_at: string | null;
    finished_at: string | null;
}

/** POST /packages/{id}/scan (202). `run_id` is null when nothing is readable. */
export interface CourseScanResult {
    run_id: string | null;
    lessons_queued: number;
}

/**
 * POST /packages/{id}/process: 202 with a run, or 200 with `run_id: null` and
 * a message when nothing needed paying for (cached lessons are re-read free).
 */
export interface CourseProcessResult {
    run_id: string | null;
    quoted_credits?: number;
    lessons_queued: number;
    message?: string;
}

/** POST /packages/{id}/lessons/{slide_id}/retry (202). */
export interface CourseRetryResult {
    slide_id: string;
    queued: boolean;
}

export interface CoursePreviewHit {
    slide_id: string;
    title: string | null;
    chapter_name: string | null;
    excerpt: string;
    /** 1-based page, when the passage came from a paged document. */
    page: number | null;
    /** Start of the passage in a video or audio lesson. */
    t_start_ms: number | null;
    score: number;
    href: string;
}

/** POST /packages/{id}/preview-search */
export interface CoursePreviewResult {
    hits: CoursePreviewHit[];
    note: string;
}

export const coursePreviewMaxChars = 2000;

export const courseCoverageQueryKey = (packageId: string) =>
    [COURSE_KNOWLEDGE_QUERY_KEY, 'coverage', packageId] as const;

export const courseRunQueryKey = (runId: string) =>
    [COURSE_KNOWLEDGE_QUERY_KEY, 'run', runId] as const;

const packagePath = (packageId: string) => `${BASE}/packages/${encodeURIComponent(packageId)}`;

export const getCourseCoverage = async (packageId: string): Promise<CourseCoverage> => {
    const res = await authenticatedAxiosInstance.get<CourseCoverage>(
        `${packagePath(packageId)}/coverage`
    );
    return res.data;
};

export const startCourseScan = async (packageId: string): Promise<CourseScanResult> => {
    const res = await authenticatedAxiosInstance.post<CourseScanResult>(
        `${packagePath(packageId)}/scan`
    );
    return res.data;
};

export const startCourseProcess = async (
    packageId: string,
    expectedCredits: number
): Promise<CourseProcessResult> => {
    const res = await authenticatedAxiosInstance.post<CourseProcessResult>(
        `${packagePath(packageId)}/process`,
        { expected_credits: expectedCredits }
    );
    return res.data;
};

export const getCourseRun = async (runId: string): Promise<CourseRun> => {
    const res = await authenticatedAxiosInstance.get<CourseRun>(
        `${BASE}/runs/${encodeURIComponent(runId)}`
    );
    return res.data;
};

export const cancelCourseRun = async (runId: string): Promise<CourseRun> => {
    const res = await authenticatedAxiosInstance.post<CourseRun>(
        `${BASE}/runs/${encodeURIComponent(runId)}/cancel`
    );
    return res.data;
};

export const retryCourseLesson = async (
    packageId: string,
    slideId: string
): Promise<CourseRetryResult> => {
    const res = await authenticatedAxiosInstance.post<CourseRetryResult>(
        `${packagePath(packageId)}/lessons/${encodeURIComponent(slideId)}/retry`
    );
    return res.data;
};

export const getKeptTranscript = async (
    packageId: string,
    slideId: string
): Promise<CourseKeptTranscript> => {
    const res = await authenticatedAxiosInstance.get<CourseKeptTranscript>(
        `${packagePath(packageId)}/lessons/${encodeURIComponent(slideId)}/kept-transcript`
    );
    return res.data;
};

export const applyKeptTranscript = async (
    packageId: string,
    slideId: string,
    expectedCredits: number
): Promise<CourseUseKeptTranscriptResult> => {
    const res = await authenticatedAxiosInstance.post<CourseUseKeptTranscriptResult>(
        `${packagePath(packageId)}/lessons/${encodeURIComponent(slideId)}/use-kept-transcript`,
        { expected_credits: expectedCredits }
    );
    return res.data;
};

export const previewCourseSearch = async (
    packageId: string,
    query: string
): Promise<CoursePreviewResult> => {
    const res = await authenticatedAxiosInstance.post<CoursePreviewResult>(
        `${packagePath(packageId)}/preview-search`,
        { query }
    );
    return res.data;
};

/** Whole credits print bare; fractional ones keep up to two decimals. */
export const formatCredits = (value: number | null | undefined) =>
    formatNumber(Number(value ?? 0), { maximumFractionDigits: 2 });

/** True when "Make course AI-ready" has nothing left to do for the course. */
export const isAllSet = (coverage: CourseCoverage) =>
    coverage.totals.not_scanned === 0 && Number(coverage.quote.credits) <= 0;

/** HTTP status of a failed call, when the server answered. */
export const courseKnowledgeErrorStatus = (error: unknown): number | undefined =>
    isAxiosError(error) ? error.response?.status : undefined;

/**
 * The human message of a failed call: FastAPI `detail.message` (or a string
 * detail), else a top-level `message` (the AI usage-limit 429 body).
 */
export const courseKnowledgeErrorMessage = (error: unknown): string | null => {
    if (!isAxiosError(error)) return null;
    const data = error.response?.data as { detail?: unknown; message?: unknown } | undefined;
    const detail = data?.detail;
    if (typeof detail === 'string' && detail) return detail;
    if (detail && typeof detail === 'object') {
        const message = (detail as { message?: unknown }).message;
        if (typeof message === 'string' && message) return message;
    }
    return typeof data?.message === 'string' && data.message ? data.message : null;
};

const noRetryOn4xx = (failureCount: number, error: unknown) => {
    const status = courseKnowledgeErrorStatus(error);
    if (status !== undefined && status >= 400 && status < 500) return false;
    return failureCount < 1;
};

/** Coverage refreshes every 30 s while a run is active; otherwise on demand. */
export const COVERAGE_ACTIVE_REFRESH_MS = 30_000;
/** A running run's progress is polled every 5 s. */
export const RUN_POLL_MS = 5_000;

export const useCourseCoverage = (packageId: string, options?: { enabled?: boolean }) =>
    useQuery({
        queryKey: courseCoverageQueryKey(packageId),
        queryFn: () => getCourseCoverage(packageId),
        enabled: (options?.enabled ?? true) && !!packageId,
        staleTime: 15_000,
        retry: noRetryOn4xx,
        refetchInterval: (query) =>
            query.state.data?.active_run ? COVERAGE_ACTIVE_REFRESH_MS : false,
    });

/** Polls a run every 5 s until it is no longer RUNNING. */
export const useCourseRun = (runId: string | null | undefined) =>
    useQuery({
        queryKey: courseRunQueryKey(runId ?? ''),
        queryFn: () => getCourseRun(runId as string),
        enabled: !!runId,
        retry: noRetryOn4xx,
        refetchInterval: (query) => {
            const status = query.state.data?.status;
            return status === undefined || status === 'RUNNING' ? RUN_POLL_MS : false;
        },
    });

const useInvalidateCoverage = (packageId: string) => {
    const queryClient = useQueryClient();
    return () => queryClient.invalidateQueries({ queryKey: courseCoverageQueryKey(packageId) });
};

export const useStartCourseScan = (packageId: string) => {
    const invalidate = useInvalidateCoverage(packageId);
    return useMutation({
        mutationFn: () => startCourseScan(packageId),
        onSuccess: async () => {
            await invalidate();
        },
    });
};

export const useStartCourseProcess = (packageId: string) => {
    const invalidate = useInvalidateCoverage(packageId);
    return useMutation({
        mutationFn: (expectedCredits: number) => startCourseProcess(packageId, expectedCredits),
        onSuccess: async () => {
            await invalidate();
        },
    });
};

export const useCancelCourseRun = (packageId: string) => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: cancelCourseRun,
        onSuccess: async (run) => {
            queryClient.setQueryData(courseRunQueryKey(run.id), run);
            await queryClient.invalidateQueries({ queryKey: courseCoverageQueryKey(packageId) });
        },
    });
};

export const useRetryCourseLesson = (packageId: string) => {
    const invalidate = useInvalidateCoverage(packageId);
    return useMutation({
        mutationFn: (slideId: string) => retryCourseLesson(packageId, slideId),
        onSuccess: async () => {
            await invalidate();
        },
    });
};

export const useKeptTranscript = (packageId: string, slideId: string | null) =>
    useQuery({
        queryKey: [...courseCoverageQueryKey(packageId), 'kept-transcript', slideId],
        queryFn: () => getKeptTranscript(packageId, slideId as string),
        enabled: !!packageId && !!slideId,
        retry: noRetryOn4xx,
    });

export const useUseKeptTranscript = (packageId: string) => {
    const invalidate = useInvalidateCoverage(packageId);
    return useMutation({
        mutationFn: ({ slideId, expectedCredits }: { slideId: string; expectedCredits: number }) =>
            applyKeptTranscript(packageId, slideId, expectedCredits),
        onSuccess: async () => {
            await invalidate();
        },
    });
};

export const usePreviewCourseSearch = (packageId: string) =>
    useMutation({
        mutationFn: (query: string) => previewCourseSearch(packageId, query),
    });
