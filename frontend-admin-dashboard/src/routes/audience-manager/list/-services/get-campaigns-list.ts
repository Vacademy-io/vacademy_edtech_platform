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

/**
 * A request for this many lists or more means "every list": source pickers, list filters and
 * access settings all ask for 200 on page 0. The endpoint is newest-first, so once an institute
 * has more lists than that the oldest ones (often its main source lists) silently dropped out.
 */
export const ALL_CAMPAIGNS_PAGE_SIZE = 200;
const MAX_CAMPAIGN_PAGES = 50;

/** Every list matching the filters, paged through ALL_CAMPAIGNS_PAGE_SIZE at a time, as one page. */
export const fetchAllCampaignsList = async (
    payload: Omit<CampaignListRequest, 'page' | 'size'>
): Promise<CampaignListResponse> => {
    const first = await fetchCampaignsList({ ...payload, page: 0, size: ALL_CAMPAIGNS_PAGE_SIZE });
    if (!first || first.last !== false) return first;
    const content = [...(first.content ?? [])];
    const pages = Math.min(first.totalPages ?? MAX_CAMPAIGN_PAGES, MAX_CAMPAIGN_PAGES);
    for (let page = 1; page < pages; page++) {
        const next = await fetchCampaignsList({ ...payload, page, size: ALL_CAMPAIGNS_PAGE_SIZE });
        content.push(...(next?.content ?? []));
        if (!next?.content?.length || next.last !== false) break;
    }
    return {
        ...first,
        content,
        numberOfElements: content.length,
        size: content.length,
        totalPages: 1,
        last: true,
    };
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
            if (payload.page === 0 && payload.size >= ALL_CAMPAIGNS_PAGE_SIZE) {
                return fetchAllCampaignsList(payload);
            }
            const data = await fetchCampaignsList(payload);
            return data;
        },
        staleTime: 60 * 1000, // 1 minute
    };
};






