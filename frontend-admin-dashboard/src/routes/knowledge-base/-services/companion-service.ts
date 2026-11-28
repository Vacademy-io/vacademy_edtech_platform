/**
 * Knowledge Base companions API client (ai_service `/kb-companion/v1`).
 *
 * Same auth model as the KB client: the institute comes from the verified JWT,
 * so no institute id is sent from here.
 */
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { AI_SERVICE_BASE_URL } from '@/constants/urls';
import type {
    Companion,
    CompanionDetail,
    CompanionInsights,
    CompanionPayload,
    CreateCompanionPayload,
    LessonResponse,
    PrepareResult,
} from '../-types/companion';

const BASE = `${AI_SERVICE_BASE_URL}/kb-companion/v1`;

export const listCompanions = async (kbId: string): Promise<Companion[]> => {
    const { data } = await authenticatedAxiosInstance.get<{ companions: Companion[] }>(
        `${BASE}/companions`,
        { params: { kb_id: kbId } }
    );
    return data.companions ?? [];
};

export const getCompanion = async (companionId: string): Promise<CompanionDetail> => {
    const { data } = await authenticatedAxiosInstance.get<CompanionDetail>(
        `${BASE}/companions/${companionId}`
    );
    return data;
};

export const createCompanion = async (
    payload: CreateCompanionPayload
): Promise<CompanionDetail> => {
    const { data } = await authenticatedAxiosInstance.post<CompanionDetail>(
        `${BASE}/companions`,
        payload
    );
    return data;
};

export const updateCompanion = async (
    companionId: string,
    payload: Partial<CompanionPayload>
): Promise<CompanionDetail> => {
    const { data } = await authenticatedAxiosInstance.put<CompanionDetail>(
        `${BASE}/companions/${companionId}`,
        payload
    );
    return data;
};

/** Archives — learners stop seeing it; the row is kept. */
export const archiveCompanion = async (companionId: string): Promise<void> => {
    await authenticatedAxiosInstance.delete(`${BASE}/companions/${companionId}`);
};

export const prepareLessons = async (
    companionId: string,
    payload: { node_ids?: string[]; dry_run: boolean }
): Promise<PrepareResult> => {
    const { data } = await authenticatedAxiosInstance.post<PrepareResult>(
        `${BASE}/companions/${companionId}/prepare`,
        payload
    );
    return data;
};

export const getCompanionInsights = async (companionId: string): Promise<CompanionInsights> => {
    const { data } = await authenticatedAxiosInstance.get<CompanionInsights>(
        `${BASE}/companions/${companionId}/insights`
    );
    return data;
};

/**
 * The learner lesson endpoints — staff may call them to preview exactly what a
 * student sees. POST starts compiling an unprepared lesson (spends credits);
 * GET only polls.
 */
export const openLesson = async (companionId: string, nodeId: string): Promise<LessonResponse> => {
    const { data } = await authenticatedAxiosInstance.post<LessonResponse>(
        `${BASE}/learner/companions/${companionId}/nodes/${nodeId}/lesson`
    );
    return data;
};

export const pollLesson = async (companionId: string, nodeId: string): Promise<LessonResponse> => {
    const { data } = await authenticatedAxiosInstance.get<LessonResponse>(
        `${BASE}/learner/companions/${companionId}/nodes/${nodeId}/lesson`
    );
    return data;
};

/** FastAPI `detail` is either a string or `{code, message}`. */
export const companionErrorMessage = (error: unknown): string | null => {
    const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data
        ?.detail;
    if (typeof detail === 'string') return detail;
    if (detail && typeof detail === 'object' && 'message' in detail) {
        const message = (detail as { message?: unknown }).message;
        if (typeof message === 'string') return message;
    }
    return null;
};

export const isCreditsExhausted = (error: unknown): boolean => {
    const res = (error as { response?: { status?: number; data?: { detail?: unknown } } })
        ?.response;
    const detail = res?.data?.detail as { code?: string } | undefined;
    return res?.status === 402 || detail?.code === 'CREDITS_EXHAUSTED';
};
