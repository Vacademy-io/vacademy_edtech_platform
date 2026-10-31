import { AUDIENCE_CAMPAIGNS_LIST } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';

export interface CampaignListRequest {
    institute_id: string;
    campaign_name?: string;
    status?: string;
    campaign_type?: string;
    sub_org_id?: string;
    to_notify?: string,
    send_respondent_email?: boolean,
    start_date_from_local?: string;
    start_date_to_local?: string;
    page: number;
    size: number;
    sort_by?: string;
    sort_direction?: string;
}

export interface CampaignListResponse {
    totalElements: number;
    totalPages: number;
    pageable: {
        paged: boolean;
        unpaged: boolean;
        pageNumber: number;
        pageSize: number;
        offset: number;
        sort: {
            unsorted: boolean;
            sorted: boolean;
            empty: boolean;
        };
    };
    numberOfElements: number;
    size: number;
    content: CampaignItem[];
    number: number;
    sort: {
        unsorted: boolean;
        sorted: boolean;
        empty: boolean;
    };
    first: boolean;
    last: boolean;
    empty: boolean;
}

export interface CampaignItem {
    id?: string;
    campaign_id?: string;
    audience_id?: string;
    institute_id?: string;
    campaign_name: string;
    campaign_type: string;
    description?: string;
    campaign_objective: string;
    start_date_local: string;
    end_date_local: string;
    status: string;
    json_web_metadata?: string;
    /** Per-campaign settings blob. Holds `postSubmitConfiguration`. */
    setting_json?: string;
    created_by_user_id?: string;
    to_notify?: string;
    send_respondent_email?: boolean;
    institute_custom_fields?: any[];
    default_initial_score?: number;
    sub_org_id?: string;
    /** Key -> value tags on the list, e.g. `{ state: 'Maharashtra', course: 'MBA' }`. */
    tags?: Record<string, string>;
}

const fetchCampaignsList = async (payload: CampaignListRequest): Promise<CampaignListResponse> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: AUDIENCE_CAMPAIGNS_LIST,
        data: payload,
    });
    return response?.data;
};

export const handleFetchCampaignsList = (payload: CampaignListRequest) => {
    return {
        queryKey: [
            'campaignsList',
            payload.institute_id,
            payload.page,
            payload.size,
            payload.campaign_name,
            payload.status,
            payload.campaign_type,
            payload.sub_org_id,
        ],
        queryFn: async () => {
            const data = await fetchCampaignsList(payload);
            return data;
        },
        staleTime: 60 * 1000, // 1 minute
    };
};






