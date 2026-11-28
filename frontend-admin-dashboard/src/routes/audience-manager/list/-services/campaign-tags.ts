import { AUDIENCE_CAMPAIGN, AUDIENCE_CAMPAIGN_TAGS_SUMMARY } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';

/** A lead list's key -> value tags, e.g. `{ state: 'Maharashtra', course: 'MBA' }`. */
export type CampaignTags = Record<string, string>;

export interface CampaignTagValueCount {
    value: string;
    /** Number of lead lists carrying this value. */
    lists: number;
}

/** One tag key in use across the institute's lead lists, values most-used first. */
export interface CampaignTagSummary {
    key: string;
    values: CampaignTagValueCount[];
}

export interface CampaignTagsResponse {
    audience_id: string;
    tags: CampaignTags;
}

export const campaignTagSummaryKey = (instituteId: string) =>
    ['campaignTagSummary', instituteId] as const;

export const campaignTagsKey = (instituteId: string, audienceId: string) =>
    ['campaignTags', instituteId, audienceId] as const;

/** GET /audience/campaign-tags — keys + distinct values in use, for autocomplete. */
export const fetchCampaignTagSummary = async (instituteId: string): Promise<CampaignTagSummary[]> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: AUDIENCE_CAMPAIGN_TAGS_SUMMARY,
        params: { instituteId },
    });
    return Array.isArray(response?.data) ? response.data : [];
};

/** GET /audience/campaign/{audienceId}/tags — one list's saved tags. */
export const fetchCampaignTags = async (
    instituteId: string,
    audienceId: string
): Promise<CampaignTags> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: `${AUDIENCE_CAMPAIGN}/${audienceId}/tags`,
        params: { instituteId },
    });
    const data = response?.data as CampaignTagsResponse | undefined;
    return data?.tags ?? {};
};
