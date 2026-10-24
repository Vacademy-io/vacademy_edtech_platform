import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { ADMIN_DISCOUNT_CAN_APPLY, ADMIN_DISCOUNT_PREVIEW } from '@/constants/urls';

// =============================================================================
// Admin-granted discounts — types mirror the backend DTOs (snake_case JSON).
// The granting admin is always the authenticated caller (JWT), never a field.
// =============================================================================

export type AdminDiscountMode = 'PERCENTAGE' | 'FLAT' | 'COUPON' | 'NONE';

/** Shared discount object sent on enroll, bulk-assign and invoice requests. */
export interface AdminDiscountRequest {
    mode: AdminDiscountMode;
    /** Percentage (0-100] or flat amount. */
    discount_value?: number;
    /** Optional cap for PERCENTAGE. */
    max_discount_value?: number;
    /** COUPON mode: an existing institute coupon code. */
    coupon_code?: string;
    /** Internal note, required for PERCENTAGE/FLAT. Never shown to the learner. */
    reason?: string;
    /**
     * SUBSCRIPTION plans only: null/absent = every billing cycle, 1 = first payment only,
     * N = first N charges.
     */
    apply_for_cycles?: number | null;
}

/** Payment option types an admin discount can be applied to. */
export const DISCOUNTABLE_PLAN_TYPES = ['ONE_TIME', 'SUBSCRIPTION'] as const;

export const isDiscountablePlanType = (type?: string | null): boolean =>
    !!type && (DISCOUNTABLE_PLAN_TYPES as readonly string[]).includes(type.toUpperCase());

export interface AdminDiscountPreviewRequest {
    discount: AdminDiscountRequest;
    payment_plan_id?: string | null;
    gross_amount?: number | null;
    package_session_id?: string | null;
    enroll_invite_id?: string | null;
    learner_email?: string | null;
}

export interface AdminDiscountPreview {
    gross_amount: number;
    discount_amount: number;
    net_amount: number;
    discount_type: string | null;
}

// =============================================================================
// Helpers
// =============================================================================

/** The discount to send, or undefined when "No discount" is chosen / nothing filled in. */
export const toAdminDiscountPayload = (
    value: AdminDiscountRequest | null | undefined,
    opts?: { includeCycles?: boolean }
): AdminDiscountRequest | undefined => {
    if (!value || value.mode === 'NONE') return undefined;
    if (value.mode === 'COUPON') {
        const code = value.coupon_code?.trim();
        return code ? { mode: 'COUPON', coupon_code: code } : undefined;
    }
    return {
        mode: value.mode,
        discount_value: value.discount_value,
        max_discount_value:
            value.mode === 'PERCENTAGE' && value.max_discount_value
                ? value.max_discount_value
                : undefined,
        reason: value.reason?.trim() || undefined,
        apply_for_cycles: opts?.includeCycles === false ? undefined : value.apply_for_cycles ?? null,
    };
};

/**
 * Client-side completeness check, mirroring the server's validation so submit buttons can
 * be gated. Returns an error string, or null when the discount is ready to send (or NONE).
 */
export const getAdminDiscountValidationError = (
    value: AdminDiscountRequest | null | undefined,
    grossAmount?: number | null
): string | null => {
    if (!value || value.mode === 'NONE') return null;
    if (value.mode === 'COUPON') {
        return value.coupon_code?.trim() ? null : 'Enter a coupon code';
    }
    const v = value.discount_value;
    if (v == null || !Number.isFinite(v) || v <= 0) return 'Enter a discount greater than 0';
    if (value.mode === 'PERCENTAGE' && v > 100) return 'A percentage discount must be 100 or less';
    if (value.mode === 'FLAT' && grossAmount != null && grossAmount > 0 && v > grossAmount) {
        return 'A flat discount cannot exceed the price';
    }
    if (value.max_discount_value != null && value.max_discount_value <= 0) {
        return 'The cap must be greater than 0';
    }
    if (value.apply_for_cycles != null && value.apply_for_cycles < 1) {
        return 'Number of payments must be at least 1';
    }
    if (!value.reason?.trim()) return 'A reason is required';
    return null;
};

/** Stable coupon-validator codes → admin-facing copy (mirrors the learner app's mapping). */
export const adminCouponErrorMessage = (code: string | null | undefined): string | null => {
    switch (code) {
        case 'INVALID_COUPON':
            return 'Invalid coupon code.';
        case 'COUPON_INACTIVE':
            return 'This coupon is no longer active.';
        case 'COUPON_NOT_STARTED':
            return 'This coupon isn’t active yet.';
        case 'COUPON_EXPIRED':
            return 'This coupon has expired.';
        case 'COUPON_LIMIT_REACHED':
            return 'This coupon has reached its usage limit.';
        case 'COUPON_EMAIL_RESTRICTED':
            return 'This coupon isn’t available for this learner’s email.';
        case 'COUPON_NOT_APPLICABLE':
            return 'This coupon isn’t valid for this course.';
        case 'COUPON_NOT_FOR_PLAN_TYPE':
            return 'Discounts can only be applied to one-time or subscription plans.';
        case 'COUPON_DISCOUNT_NOT_CONFIGURED':
            return 'This coupon has no discount configured.';
        case 'COUPON_BELOW_MIN_ITEMS':
            return 'This coupon needs more items in the order.';
        default:
            return null;
    }
};

/** Pulls the server's message out of an axios error, mapping coupon codes to copy. */
export const extractAdminDiscountError = (error: unknown, fallback: string): string => {
    const data = (error as { response?: { data?: { ex?: string; message?: string } } })?.response
        ?.data;
    const raw = data?.ex ?? data?.message;
    if (!raw) return fallback;
    return adminCouponErrorMessage(raw.trim()) ?? raw;
};

// =============================================================================
// Raw API calls
// =============================================================================

const resolveInstituteId = (instituteId?: string | null) => instituteId || getCurrentInstituteId();

export const previewAdminDiscount = async (
    payload: AdminDiscountPreviewRequest,
    instituteId?: string | null
): Promise<AdminDiscountPreview> => {
    const { data } = await authenticatedAxiosInstance.post<AdminDiscountPreview>(
        ADMIN_DISCOUNT_PREVIEW,
        payload,
        { params: { instituteId: resolveInstituteId(instituteId) } }
    );
    return data;
};

/**
 * Whether the server will let this user apply admin discounts at the institute — the same
 * check the discount-taking endpoints run. False on any failure (fail closed).
 */
export const fetchCanApplyAdminDiscounts = async (
    instituteId?: string | null
): Promise<boolean> => {
    const id = resolveInstituteId(instituteId);
    if (!id) return false;
    try {
        const { data } = await authenticatedAxiosInstance.get<{ can_apply?: boolean }>(
            ADMIN_DISCOUNT_CAN_APPLY,
            { params: { instituteId: id } }
        );
        return data?.can_apply === true;
    } catch {
        return false;
    }
};
