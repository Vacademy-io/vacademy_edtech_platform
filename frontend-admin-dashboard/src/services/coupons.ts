import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getInstituteId } from '@/constants/helper';
import {
    COUPON_BASE,
    COUPON_DETAIL,
    COUPON_VALIDATE,
    GET_INSTITUTE_SETTING_DATA,
    SAVE_INSTITUTE_SETTING,
} from '@/constants/urls';

// =============================================================================
// API types — mirror the backend DTOs (snake_case JSON via @JsonNaming on BE).
// =============================================================================

export type CouponDiscountType = 'PERCENTAGE' | 'FLAT';
export type CouponStatus = 'ACTIVE' | 'INACTIVE' | 'DELETED';

export interface AppliedDiscountInput {
    discount_type: CouponDiscountType;
    discount_point: number;
    max_discount_point?: number | null;
    currency?: string | null;
}

export interface CouponCreateRequest {
    code: string;
    status?: CouponStatus;
    redeem_start_date?: string | null; // ISO date string
    redeem_end_date?: string | null; // ISO date string; null = never expires
    usage_limit?: number | null; // null = unlimited
    is_email_restricted?: boolean;
    /** JSON array string, e.g. '["alice@x.com"]' */
    allowed_email_ids?: string | null;
    applicable_package_session_ids?: string[];
    applicable_enroll_invite_ids?: string[];
    applied_discount: AppliedDiscountInput;
}

export interface CouponUpdateRequest {
    status?: CouponStatus;
    redeem_start_date?: string | null;
    redeem_end_date?: string | null;
    /** true = remove the end date (null redeem_end_date alone means "unchanged"). */
    clear_redeem_end_date?: boolean;
    usage_limit?: number | null;
    is_email_restricted?: boolean | null;
    allowed_email_ids?: string | null;
    applicable_package_session_ids?: string[];
    applicable_enroll_invite_ids?: string[];
    applied_discount?: AppliedDiscountInput;
}

export interface CouponSummary {
    id: string;
    code: string;
    status: CouponStatus;
    source_type: string;
    redeem_start_date?: string | null;
    redeem_end_date?: string | null;
    usage_limit?: number | null;
    usage_count: number;
    discount_type?: CouponDiscountType | null;
    discount_point?: number | null;
    max_discount_point?: number | null;
    created_at?: string | null;
}

export interface CouponDetail extends CouponSummary {
    source_id: string;
    institute_id: string;
    email_restricted: boolean;
    allowed_email_ids?: string | null;
    applicable_package_session_ids: string[];
    applicable_enroll_invite_ids: string[];
    applied_discount?: AppliedDiscountInput | null;
    updated_at?: string | null;
}

// Spring Data Page shape
export interface PageResponse<T> {
    content: T[];
    total_pages: number;
    total_elements: number;
    number: number; // current page (0-indexed)
    size: number;
    last: boolean;
    first: boolean;
}

export interface CouponListParams {
    status?: CouponStatus[];
    search?: string;
    page?: number;
    size?: number;
}

export interface CouponValidateRequest {
    coupon_code: string;
    institute_id: string;
    package_session_id?: string | null;
    enroll_invite_id?: string | null;
    product_page_code?: string | null;
    payment_plan_id?: string | null;
    user_email?: string | null;
    total_amount: number;
}

export interface CouponValidateResponse {
    coupon_code_id?: string | null;
    applied_coupon_discount_id?: string | null;
    discount_type?: CouponDiscountType | null;
    discount_value?: number | null;
    max_discount_value?: number | null;
    valid: boolean;
    /** Stable error code; UI maps to copy. */
    message: string;
}

// =============================================================================
// Raw API calls. Auth (Bearer + clientId header) is auto-injected by
// authenticatedAxiosInstance — callers don't pass instituteId.
// =============================================================================

export const createCoupon = async (payload: CouponCreateRequest): Promise<CouponDetail> => {
    const { data } = await authenticatedAxiosInstance.post<CouponDetail>(COUPON_BASE, payload);
    return data;
};

export const updateCoupon = async (
    couponId: string,
    payload: CouponUpdateRequest
): Promise<CouponDetail> => {
    const { data } = await authenticatedAxiosInstance.put<CouponDetail>(
        COUPON_DETAIL(couponId),
        payload
    );
    return data;
};

export const getCoupon = async (couponId: string): Promise<CouponDetail> => {
    const { data } = await authenticatedAxiosInstance.get<CouponDetail>(COUPON_DETAIL(couponId));
    return data;
};

export const listCoupons = async (
    params: CouponListParams
): Promise<PageResponse<CouponSummary>> => {
    const { data } = await authenticatedAxiosInstance.get<PageResponse<CouponSummary>>(
        COUPON_BASE,
        {
            params: {
                status: params.status,
                search: params.search,
                page: params.page ?? 0,
                size: params.size ?? 20,
            },
        }
    );
    return data;
};

export const deleteCoupon = async (couponId: string): Promise<void> => {
    await authenticatedAxiosInstance.delete(COUPON_DETAIL(couponId));
};

export const validateCoupon = async (
    payload: CouponValidateRequest
): Promise<CouponValidateResponse> => {
    const { data } = await authenticatedAxiosInstance.post<CouponValidateResponse>(
        COUPON_VALIDATE,
        payload
    );
    return data;
};

// =============================================================================
// TanStack Query hooks. Query key convention: ['coupons', ...filters].
// Mutations invalidate ['coupons'] so all list/detail queries refresh.
// =============================================================================

const COUPONS_KEY = 'coupons';

export const useCouponList = (params: CouponListParams) =>
    useQuery({
        queryKey: [COUPONS_KEY, 'list', params],
        queryFn: () => listCoupons(params),
        // Coupon usage_count changes when a learner redeems — keep snappy.
        staleTime: 30_000,
    });

export const useCouponDetail = (couponId: string | null | undefined) =>
    useQuery({
        queryKey: [COUPONS_KEY, 'detail', couponId],
        queryFn: () => getCoupon(couponId!),
        enabled: !!couponId,
    });

export const useCreateCoupon = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: createCoupon,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [COUPONS_KEY] });
        },
    });
};

export const useUpdateCoupon = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ couponId, payload }: { couponId: string; payload: CouponUpdateRequest }) =>
            updateCoupon(couponId, payload),
        onSuccess: (_data, vars) => {
            queryClient.invalidateQueries({ queryKey: [COUPONS_KEY] });
            queryClient.invalidateQueries({ queryKey: [COUPONS_KEY, 'detail', vars.couponId] });
        },
    });
};

export const useDeleteCoupon = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: deleteCoupon,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [COUPONS_KEY] });
        },
    });
};

// =============================================================================
// Institute-level "coupons enabled" toggle
//
// Stored in the existing Institute.setting JSON map under the key
// COUPON_ENABLED_SETTING. We re-use the generic /institute/setting/v1 endpoints
// so no new backend code is required.
//
// Default when missing: false (conservative — institutes opt in deliberately).
// When false, learner-facing coupon UI must hide itself on all three checkout
// surfaces (see frontend-learner-dashboard-app/src/components/common/coupon/
// use-coupons-enabled.ts).
// =============================================================================

export const COUPON_SETTING_KEY = 'COUPON_ENABLED_SETTING';

interface CouponEnabledSettingPayload {
    enabled: boolean;
}

export const getCouponsEnabledSetting = async (): Promise<boolean> => {
    const instituteId = getInstituteId();
    if (!instituteId) return false;
    try {
        const response = await authenticatedAxiosInstance.get(GET_INSTITUTE_SETTING_DATA, {
            params: { instituteId, settingKey: COUPON_SETTING_KEY },
        });
        const raw = response.data as CouponEnabledSettingPayload | null;
        return raw?.enabled === true;
    } catch {
        // Missing-key returns 404 in some backends; treat as "off" rather than throwing.
        return false;
    }
};

export const saveCouponsEnabledSetting = async (enabled: boolean): Promise<void> => {
    const instituteId = getInstituteId();
    if (!instituteId) throw new Error('Institute context missing — cannot save setting');
    // GenericSettingRequest uses @JsonNaming(SnakeCaseStrategy) on the BE, so the wire
    // payload must be snake_case or setting_data arrives as null and the save no-ops.
    await authenticatedAxiosInstance.post(
        SAVE_INSTITUTE_SETTING,
        {
            setting_name: 'Coupon Redemption',
            setting_data: { enabled },
        },
        { params: { instituteId, settingKey: COUPON_SETTING_KEY } }
    );
};

const COUPON_SETTING_QUERY_KEY = [COUPONS_KEY, 'setting', 'enabled'] as const;

export const useCouponsEnabledSetting = () =>
    useQuery({
        queryKey: COUPON_SETTING_QUERY_KEY,
        queryFn: getCouponsEnabledSetting,
        staleTime: 60_000,
    });

export const useUpdateCouponsEnabledSetting = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: saveCouponsEnabledSetting,
        onSuccess: (_data, enabled) => {
            // Optimistic update so the toggle reflects immediately.
            queryClient.setQueryData(COUPON_SETTING_QUERY_KEY, enabled);
            queryClient.invalidateQueries({ queryKey: COUPON_SETTING_QUERY_KEY });
        },
    });
};
