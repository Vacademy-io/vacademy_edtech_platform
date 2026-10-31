import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { AUDIENCE_CAMPAIGN } from '@/constants/urls';

export interface AudienceFilterConfig {
    source_type?: string;
    submitted_from?: string;
    submitted_to?: string;
    custom_field_filters?: Record<string, string>;
}

export interface SendAudienceMessageRequest {
    institute_id: string;
    channel: 'WHATSAPP' | 'EMAIL' | 'PUSH' | 'SYSTEM_ALERT';
    template_name?: string;
    language_code?: string;
    // WhatsApp media header — required by Meta on every send of a template whose
    // header is IMAGE/VIDEO/DOCUMENT, else the entire blast is rejected.
    header_url?: string;
    header_type?: 'image' | 'video' | 'document';
    subject?: string;
    body?: string;
    email_type?: string;
    variable_mapping?: Record<string, string>;
    filters?: AudienceFilterConfig;
    // Explicit recipient subset — audience_response ids ticked in the lead table.
    // Omitted/empty means every active lead in the audience.
    response_ids?: string[];
    created_by?: string;
}

export interface SendAudienceMessageResponse {
    communication_id: string;
    recipient_count: number;
    accepted: number;
    failed: number;
    batch_id?: string;
    status: string;
}

export interface AudienceCommunicationItem {
    id: string;
    channel: string;
    template_name?: string;
    subject?: string;
    recipient_count: number;
    successful: number;
    failed: number;
    skipped: number;
    batch_id?: string;
    status: string;
    created_by?: string;
    created_at: string;
}

export interface AudienceCommunicationPage {
    content: AudienceCommunicationItem[];
    totalElements: number;
    totalPages: number;
    number: number;
    size: number;
}

export const sendAudienceMessage = async (
    audienceId: string,
    payload: SendAudienceMessageRequest
): Promise<SendAudienceMessageResponse> => {
    const { data } = await authenticatedAxiosInstance.post(
        `${AUDIENCE_CAMPAIGN}/${audienceId}/send`,
        payload
    );
    return data;
};

export const getAudienceCommunications = async (
    audienceId: string,
    page = 0,
    size = 20
): Promise<AudienceCommunicationPage> => {
    const { data } = await authenticatedAxiosInstance.get(
        `${AUDIENCE_CAMPAIGN}/${audienceId}/communications`,
        { params: { page, size } }
    );
    return data;
};
