import { AUDIENCE_CAMPAIGN } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getBackendErrorBody } from '@/lib/report-api-error';
import { AxiosError } from 'axios';

export interface AudienceCampaignCustomFieldPayload {
    institute_id: string;
    custom_field: {
        fieldName: string;
        fieldType: string;
        isMandatory: boolean;
        formOrder: number;
        config?: string;
    };
}

export interface AudienceCampaignPayload {
    id?: string;
    institute_id: string;
    campaign_name: string;
    campaign_type: string;
    description: string;
    campaign_objective: string;
    to_notify: string;
    send_respondent_email: boolean;
    json_web_metadata?: string;
    /** Per-campaign settings blob. Carries `postSubmitConfiguration` (thank-you screen / redirect). */
    setting_json?: string;
    created_by_user_id?: string;
    start_date_local: string; // format: YYYY-MM-DDTHH:mm:ss
    end_date_local: string; // format: YYYY-MM-DDTHH:mm:ss
    status: string;
    institute_custom_fields: AudienceCampaignCustomFieldPayload[];
    default_initial_score?: number;
    sub_org_id?: string;
    /**
     * Key -> value tags on the list (e.g. `{ state: 'Goa' }`). On update, leaving it out keeps
     * the saved tags and `{}` clears them.
     */
    tags?: Record<string, string>;
}

export const createAudienceCampaign = async (payload: AudienceCampaignPayload) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: AUDIENCE_CAMPAIGN,
        data: payload,
    });
    return response?.data;
};

export const updateAudienceCampaign = async (
    audienceId: string,
    payload: AudienceCampaignPayload
) => {
    const response = await authenticatedAxiosInstance({
        method: 'PUT',
        url: `${AUDIENCE_CAMPAIGN}/${audienceId}`,
        data: payload,
    });
    return response?.data;
};

/**
 * Toast text for a failed create/update. A 4xx (e.g. 409 duplicate name) or 510
 * (VacademyException validation) carries a sentence written for the admin; any other
 * 5xx carries the raw exception text (SQL included), so the translated fallback is shown.
 */
export const getCampaignSaveErrorMessage = (error: unknown, fallback: string): string => {
    const status = error instanceof AxiosError ? error.response?.status : undefined;
    if (status === undefined || (status >= 500 && status !== 510)) return fallback;
    const body = getBackendErrorBody(error);
    return body?.message || body?.ex || fallback;
};
