import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { RESULT_NOTIFICATION_TEMPLATE } from '@/constants/urls';

export type ResultChannel = 'EMAIL' | 'WHATSAPP';

export interface ResultTemplateConfig {
    template_id?: string | null;
    template_name?: string | null;
    template_subject?: string | null;
}

/**
 * The template sent when an assessment's results are released, per channel. With no
 * assessmentId this is the institute default; with one, that assessment's override.
 */
export const getResultTemplate = async (
    instituteId: string,
    channel: ResultChannel,
    assessmentId?: string
): Promise<ResultTemplateConfig> => {
    const response = await authenticatedAxiosInstance.get(RESULT_NOTIFICATION_TEMPLATE, {
        params: { instituteId, channel, ...(assessmentId ? { assessmentId } : {}) },
    });
    return response.data ?? {};
};

export const setResultTemplate = async (
    instituteId: string,
    channel: ResultChannel,
    templateId: string,
    assessmentId?: string
) => {
    await authenticatedAxiosInstance.post(RESULT_NOTIFICATION_TEMPLATE, null, {
        params: { instituteId, channel, templateId, ...(assessmentId ? { assessmentId } : {}) },
    });
};

export const clearResultTemplate = async (
    instituteId: string,
    channel: ResultChannel,
    assessmentId?: string
) => {
    await authenticatedAxiosInstance.delete(RESULT_NOTIFICATION_TEMPLATE, {
        params: { instituteId, channel, ...(assessmentId ? { assessmentId } : {}) },
    });
};
