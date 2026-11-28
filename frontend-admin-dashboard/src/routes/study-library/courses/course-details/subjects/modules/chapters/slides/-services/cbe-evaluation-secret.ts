import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    getQuestionSlideEvaluationSecretUrl,
    getQuizSlideEvaluationSecretsUrl,
} from '@/constants/urls';
import type { CbeSecret } from '@/components/cbe/types';

const parseSecret = (raw: string | null | undefined): CbeSecret | null => {
    if (!raw || !raw.trim()) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Unreadable evaluation secret');
    }
    const secret = parsed as Partial<CbeSecret>;
    return { ...secret, parts: Array.isArray(secret.parts) ? secret.parts : [] } as CbeSecret;
};

/**
 * The stored secret half of one CBE question in a quiz slide (solution, marking scheme,
 * grading notes); `null` when that question has none stored yet. Throws on any request
 * failure — the caller must then keep the stored secret untouched.
 */
export async function fetchQuizQuestionCbeSecret(
    slideId: string,
    questionId: string
): Promise<CbeSecret | null> {
    const response = await authenticatedAxiosInstance.get<{
        evaluation_secrets?: Record<string, string | null>;
    }>(getQuizSlideEvaluationSecretsUrl(slideId));
    return parseSecret(response.data?.evaluation_secrets?.[questionId]);
}

/**
 * The stored secret half of a CBE question slide (solution, marking scheme,
 * grading notes). `null` when the slide has none stored yet. Throws on any
 * request failure — the caller must then keep the stored secret untouched.
 */
export async function fetchQuestionSlideCbeSecret(slideId: string): Promise<CbeSecret | null> {
    const response = await authenticatedAxiosInstance.get<{
        evaluation_secret_json?: string | null;
    }>(getQuestionSlideEvaluationSecretUrl(slideId));
    const raw = response.data?.evaluation_secret_json;
    if (!raw || !raw.trim()) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Unreadable evaluation secret');
    }
    const secret = parsed as Partial<CbeSecret>;
    return { ...secret, parts: Array.isArray(secret.parts) ? secret.parts : [] } as CbeSecret;
}
