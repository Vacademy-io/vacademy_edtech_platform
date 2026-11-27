import { GET_ENQUIRY_DETAILS } from '@/constants/urls';
import { getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';

export interface EnquiryDetailParent {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    address_line: string | null;
    city: string | null;
    pin_code: string | null;
}

export interface EnquiryDetailChild {
    id: string;
    name: string;
    dob: string | null;
    gender: string | null;
    applying_for_class: string | null;
    academic_year: string | null;
    previous_school_name: string | null;
}

export interface EnquiryDetailCampaign {
    audience_id: string;
    campaign_name: string;
    source_type: string;
    source_id: string | null;
    destination_package_session_id: string;
    package_session_name: string;
    level_name: string;
    group_name: string;
}

// The backend sends the assigned counsellor as an object, not a name string.
export interface EnquiryDetailCounselor {
    counselor_id: string;
    counselor_name: string | null;
    counselor_email: string | null;
}

export interface EnquiryDetails {
    enquiry_id: string;
    tracking_id: string | null;
    enquiry_status: string;
    conversion_status: string | null;
    reference_source: string | null;
    fee_range_expectation: string | null;
    transport_requirement: string | null;
    mode: string;
    interest_score: number | null;
    notes: string | null;
    checklist: unknown | null;
    enquiry_created_at: string;
    enquiry_updated_at: string;
    parent: EnquiryDetailParent;
    child: EnquiryDetailChild;
    already_applied: boolean;
    applicant_id: string | null;
    overall_status: string;
    current_stage_name: string | null;
    current_stage_type: string | null;
    current_stage_status: string | null;
    campaign: EnquiryDetailCampaign;
    assigned_counselor: EnquiryDetailCounselor | null;
    custom_fields: Record<string, string>;
    // Phase 1 — lead score + dedup (populated when backend returns them)
    lead_score?: number | null;
    lead_tier?: string | null;
    percentile_rank?: number | null;
    is_duplicate?: boolean | null;
    primary_response_id?: string | null;
}

export const fetchEnquiryDetails = async (enquiryId: string): Promise<EnquiryDetails> => {
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const response = await fetch(`${GET_ENQUIRY_DETAILS}?enquiryId=${enquiryId}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch enquiry details: ${response.status}`);
    }

    return response.json();
};

export const handleFetchEnquiryDetails = (enquiryId: string | null) => ({
    queryKey: ['enquiry-details', enquiryId],
    queryFn: () => {
        if (!enquiryId) throw new Error('No enquiry ID provided');
        return fetchEnquiryDetails(enquiryId);
    },
    enabled: !!enquiryId,
    staleTime: 60 * 1000, // 1 minute
});
