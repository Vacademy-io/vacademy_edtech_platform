import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getQuestionSlideEvaluationSecretUrl } from '@/constants/urls';
import type { CbeSecret } from '@/components/cbe/types';

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
