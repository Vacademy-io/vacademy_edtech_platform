import { ENGAGEMENT_TEMPLATES_BASE } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';

/** Sibling of the template endpoints (…/engagement/brief). */
const ENGAGEMENT_BRIEF_BASE = ENGAGEMENT_TEMPLATES_BASE.replace(/\/template-proposals$/, '/brief');

/** One Lead Agent's description of what it sells, for the lead list it fills. */
export interface LeadAgentBrief {
    audienceId: string;
    agentName: string;
    text: string;
}

export interface BriefDraftRequest {
    objective?: string;
    websiteUrl?: string;
    productDescription?: string;
    language?: string;
    senderName?: string;
    leadAgentBrief?: string;
    currentBrief?: string;
}

/** The Lead Agents of the picked lead lists that describe an offer. */
export const getLeadAgentBriefs = async (
    instituteId: string,
    audienceIds: string[]
): Promise<LeadAgentBrief[]> => {
    const res = await authenticatedAxiosInstance.get(`${ENGAGEMENT_BRIEF_BASE}/lead-agents`, {
        params: { instituteId, audienceIds: audienceIds.join(',') },
    });
    return res.data;
};

/** A draft brief the AI writes from the objective, product and website. */
export const generateBrief = async (
    instituteId: string,
    body: BriefDraftRequest
): Promise<string> => {
    const res = await authenticatedAxiosInstance.post(`${ENGAGEMENT_BRIEF_BASE}/generate`, body, {
        params: { instituteId },
    });
    return res.data?.brief ?? '';
};
