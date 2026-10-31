import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    GET_USER_PLANS,
    GET_USER_PLAN_CHANGE_OPTIONS,
    CHANGE_USER_PLAN,
    GET_MANUAL_RENEWAL_PREVIEW,
    RECORD_MANUAL_RENEWAL,
    USER_PLAN_REMARKS,
    CHANGE_USER_PLAN_END_DATE,
} from '@/constants/urls';
import type { OfflinePaymentDetails } from '@/services/offline-payment-modes';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import type { PolicyDetails } from '@/types/membership-expiry';

export interface UserPlanPaymentLog {
    id: string;
    status: string;
    payment_status: string;
    user_id: string;
    vendor: string;
    vendor_id: string;
    date: string;
    currency: string;
    payment_specific_data: string;
    payment_amount: number;
}

export interface ReferralOption {
    id: string;
    name: string;
    status: string;
    source: string;
    source_id: string;
    referrer_discount_json: string;
    referee_discount_json: string;
    referrer_vesting_days: number;
    tag: string;
    description: string;
    created_at: string;
    updated_at: string;
    setting_json: string;
}

export interface PaymentPlanDTO {
    id: string;
    name: string;
    status: string;
    validity_in_days: number;
    actual_price: number;
    elevated_price: number;
    currency: string;
    description: string;
    tag: string;
    feature_json: string;
    referral_option: ReferralOption;
    referral_option_smapping_status: string;
}

export interface PaymentOption {
    id: string;
    name: string;
    status: string;
    source: string;
    source_id: string;
    tag: string;
    type: string;
    require_approval: boolean;
    unit: string;
    payment_plans: PaymentPlanDTO[];
    payment_option_metadata_json: string;
}

export interface PackageSessionToPaymentOption {
    package_session_id: string;
    id: string;
    payment_option: PaymentOption;
    enroll_invite_id: string;
    status: string;
}

export interface EnrollInviteData {
    id: string;
    name: string;
    start_date: string;
    end_date: string;
    invite_code: string;
    status: string;
    institute_id: string;
    vendor: string;
    vendor_id: string;
    currency: string;
    tag: string;
    learner_access_days: number;
    web_page_meta_data_json: string;
    is_bundled: boolean;
    package_session_to_payment_options: PackageSessionToPaymentOption[];
}

export interface UserPlan {
    id: string;
    user_id: string;
    payment_plan_id: string;
    plan_json: string;
    applied_coupon_discount_id: string;
    applied_coupon_discount_json: string;
    /**
     * Structured projection of the coupon snapshot, populated by the BE
     * (see CouponSnapshotDTO). Prefer reading from this over parsing the
     * JSON string yourself. Null when no coupon was applied.
     */
    applied_coupon?: {
        coupon_code?: string | null;
        discount_type?: string | null;
        discount_point?: number | null;
        max_discount_point?: number | null;
        /** 'ADMIN' for an admin-granted discount. */
        discount_source?: string | null;
        granted_by_user_id?: string | null;
        /** Internal note from the granting admin — never shown to the learner. */
        grant_reason?: string | null;
        /** SUBSCRIPTION: null = every cycle, N = first N charges. */
        apply_for_cycles?: number | null;
    } | null;
    /** Set when an admin granted the discount on this plan. */
    discount_granted_by_user_id?: string | null;
    discount_granted_at?: string | null;
    /** How many billing cycles have been charged at the discounted price so far. */
    discount_cycles_applied?: number | null;
    enroll_invite_id: string;
    payment_option_id: string;
    payment_option_json: string;
    status: string;
    start_date?: string;
    end_date?: string;
    created_at: string;
    updated_at: string;
    source?: 'USER' | 'SUB_ORG'; // Payment source type
    sub_org_id?: string | null; // Sub-organization ID if source is SUB_ORG
    sub_org_details?: {
        id: string;
        name: string;
        address: string;
    } | null; // Sub-organization details if source is SUB_ORG
    payment_logs: UserPlanPaymentLog[];
    enroll_invite: EnrollInviteData;
    payment_option: PaymentOption;
    payment_plan_dto: PaymentPlanDTO;
    policy_details?: PolicyDetails[];
}

export interface UserPlansResponse {
    content: UserPlan[];
    totalElements?: number;
    totalPages?: number;
    pageable?: {
        paged?: boolean;
        unpaged?: boolean;
        pageNumber?: number;
        pageSize?: number;
        offset?: number;
        sort?: {
            unsorted?: boolean;
            sorted?: boolean;
            empty?: boolean;
        };
    };
    numberOfElements?: number;
    size?: number;
    number?: number;
    sort?: {
        unsorted?: boolean;
        sorted?: boolean;
        empty?: boolean;
    };
    first?: boolean;
    last?: boolean;
    empty?: boolean;
}

export interface GetUserPlansRequest {
    statuses: string[];
    sources?: ('USER' | 'SUB_ORG')[]; // Payment source filter
    sort_columns: Record<string, unknown>;
    user_id: string;
    institute_id: string;
    pageNo?: number;
    pageSize?: number;
}

/**
 * Get user plans with pagination
 * @param pageNo - Page number (1-indexed)
 * @param pageSize - Number of items per page
 * @param statuses - Array of statuses to filter by (e.g., ['ACTIVE'], ['ACTIVE', 'EXPIRED'])
 * @param userId - The user ID to fetch plans for
 * @param instituteId - The institute ID
 * @param sources - Optional array of payment sources to filter by (e.g., ['USER'], ['SUB_ORG'])
 * @returns Promise<UserPlansResponse>
 */
export const getUserPlans = async (
    pageNo: number = 1,
    pageSize: number = 10,
    statuses: string[] = ['ACTIVE'],
    userId?: string,
    instituteId?: string,
    sources?: ('USER' | 'SUB_ORG')[]
): Promise<UserPlansResponse> => {
    try {
        const accessToken = getTokenFromCookie(TokenKey.accessToken);
        const tokenData = getTokenDecodedData(accessToken);

        const finalUserId = userId || (tokenData?.user as string | undefined);
        const finalInstituteId =
            instituteId ||
            (() => {
                const instituteIds = Object.keys(tokenData?.authorities || {});
                return instituteIds[0];
            })();

        if (!finalUserId || !finalInstituteId) {
            throw new Error('Missing user_id or institute_id');
        }

        const request: GetUserPlansRequest = {
            statuses,
            sort_columns: {},
            user_id: finalUserId,
            institute_id: finalInstituteId,
            pageNo: pageNo - 1, // Convert to 0-indexed
            pageSize,
        };

        // Add sources filter if provided
        if (sources && sources.length > 0) {
            request.sources = sources;
        }

        const response = await authenticatedAxiosInstance.post(GET_USER_PLANS, request, {
            params: {
                pageNo: pageNo - 1,
                pageSize,
            },
        });

        return response.data;
    } catch (error) {
        console.error('Error fetching user plans:', error);
        throw error;
    }
};

/**
 * Get active user plans
 * @param userId - The user ID to fetch plans for
 * @returns Promise<UserPlansResponse>
 */
export const getActivePlans = async (userId: string): Promise<UserPlansResponse> => {
    return getUserPlans(1, 100, ['ACTIVE'], userId);
};

/**
 * Get active and expired user plans
 * @param userId - The user ID to fetch plans for
 * @returns Promise<UserPlansResponse>
 */
export const getActiveAndExpiredPlans = async (userId: string): Promise<UserPlansResponse> => {
    return getUserPlans(1, 100, ['ACTIVE', 'EXPIRED'], userId);
};

// ── Plan change (admin) ─────────────────────────────────────────────────────

/** One plan an admin could move this learner onto, priced for information. */
export interface PlanChangeTarget {
    plan_id: string;
    plan_name?: string | null;
    payment_option_id: string;
    option_name?: string | null;
    option_type?: string | null;
    enroll_invite_id?: string | null;
    price?: number | null;
    currency?: string | null;
    validity_in_days?: number | null;
    feature_json?: string | null;
    description?: string | null;
    /** UPGRADE | DOWNGRADE | LATERAL */
    direction: string;
    /** IMMEDIATE | END_OF_CYCLE */
    effective_type: string;
    proration_credit?: number | null;
    amount_due_now?: number | null;
    effective_from?: string | null;
    requires_mandate_reauth?: boolean;
    /** Also moves the learner to a different payment option + enroll invite. */
    cross_option?: boolean;
}

export interface PlanChangeOptions {
    user_plan_id: string;
    current_plan_id?: string | null;
    current_plan_name?: string | null;
    current_plan_price?: number | null;
    current_option_name?: string | null;
    currency?: string | null;
    current_end_date?: string | null;
    targets: PlanChangeTarget[];
    can_change_plan: boolean;
    blocked_reason?: string | null;
}

export const PLAN_CHANGE_OPTIONS_QUERY_KEY = 'ADMIN_PLAN_CHANGE_OPTIONS';

/**
 * Plans this learner could be moved onto. Same eligibility rules as the learner-facing
 * list — an admin cannot move someone onto a plan the institute has not flagged as
 * switchable.
 */
export const getPlanChangeOptions = async (
    userPlanId: string,
    instituteId: string
): Promise<PlanChangeOptions> => {
    const response = await authenticatedAxiosInstance.get(
        GET_USER_PLAN_CHANGE_OPTIONS(userPlanId),
        { params: { instituteId } }
    );
    return response.data;
};

/**
 * Admin override: move the learner onto another plan immediately, with no payment.
 * The access window is left as-is — nothing was paid, so the new price bills at the next
 * renewal rather than resetting what the learner already has.
 */
export const changeUserPlan = async (
    userPlanId: string,
    instituteId: string,
    body: { target_plan_id: string; reason?: string; notify_learner?: boolean }
): Promise<UserPlan> => {
    const response = await authenticatedAxiosInstance.post(
        CHANGE_USER_PLAN(userPlanId),
        body,
        { params: { instituteId } }
    );
    return response.data;
};

export interface ManualRenewalPreview {
    user_plan_id: string;
    status: string;
    current_end_date?: string | null;
    suggested_end_date: string;
    validity_days?: number | null;
    suggested_amount?: number | null;
    currency?: string | null;
    auto_renewal_enabled: boolean;
    renewable: boolean;
    not_renewable_reason?: string | null;
}

export interface ManualRenewalRequest {
    amount: number;
    currency?: string;
    /** yyyy-MM-dd */
    payment_date?: string;
    /** yyyy-MM-dd; omitted = the plan's normal renewal */
    new_end_date?: string;
    remarks?: string;
    payment_details?: OfflinePaymentDetails | null;
    generate_invoice?: boolean;
    send_email?: boolean;
}

export interface ManualRenewalResult {
    user_plan_id: string;
    payment_log_id?: string | null;
    previous_status: string;
    status: string;
    previous_end_date?: string | null;
    new_end_date: string;
    mappings_updated: number;
    invoice_queued: boolean;
}

export interface PlanRemark {
    id: string;
    action_type: string;
    actor_name?: string | null;
    title: string;
    description?: string | null;
    metadata?: Record<string, unknown> | null;
    created_at: string;
}

export const MANUAL_RENEWAL_PREVIEW_QUERY_KEY = 'ADMIN_MANUAL_RENEWAL_PREVIEW';
export const PLAN_REMARKS_QUERY_KEY = 'ADMIN_USER_PLAN_REMARKS';

/** Defaults for the manual-renewal dialog (suggested end date and amount). Saves nothing. */
export const getManualRenewalPreview = async (
    userPlanId: string,
    instituteId: string
): Promise<ManualRenewalPreview> => {
    const response = await authenticatedAxiosInstance.get(GET_MANUAL_RENEWAL_PREVIEW(userPlanId), {
        params: { instituteId },
    });
    return response.data;
};

/**
 * Admin records a renewal the member paid offline. Reactivates the membership and its
 * course access; never turns autopay on, and emails the member only when asked.
 */
export const recordManualRenewal = async (
    userPlanId: string,
    instituteId: string,
    body: ManualRenewalRequest
): Promise<ManualRenewalResult> => {
    const response = await authenticatedAxiosInstance.post(RECORD_MANUAL_RENEWAL(userPlanId), body, {
        params: { instituteId },
    });
    return response.data;
};

/**
 * Admin moves an active membership's end date (and its course access) without a payment.
 * The remark, the admin's name and the time are kept in the plan's remarks history.
 */
export const changePlanEndDate = async (
    userPlanId: string,
    instituteId: string,
    body: { new_end_date: string; remarks: string }
): Promise<ManualRenewalResult> => {
    const response = await authenticatedAxiosInstance.post(
        CHANGE_USER_PLAN_END_DATE(userPlanId),
        body,
        { params: { instituteId } }
    );
    return response.data;
};

/** Renewal records and admin remarks on a membership, newest first. */
export const getPlanRemarks = async (
    userPlanId: string,
    instituteId: string,
    page = 0,
    size = 50
): Promise<{ content: PlanRemark[]; totalElements: number }> => {
    const response = await authenticatedAxiosInstance.get(USER_PLAN_REMARKS(userPlanId), {
        params: { instituteId, page, size },
    });
    return response.data;
};

export const addPlanRemark = async (
    userPlanId: string,
    instituteId: string,
    remark: string
): Promise<PlanRemark> => {
    const response = await authenticatedAxiosInstance.post(
        USER_PLAN_REMARKS(userPlanId),
        { remark },
        { params: { instituteId } }
    );
    return response.data;
};
