import axios from "axios";
import type { TFunction } from "i18next";
import { BASE_URL } from "@/constants/urls";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

/**
 * Generic discount-coupon validate against the new
 * /admin-core-service/open/v1/coupon/validate endpoint (V308 / V309).
 *
 * Shared by all three learner checkout surfaces:
 *   - product page CartStep (legacy /open/v1/product-page/validate-coupon
 *     still works and now delegates server-side to the generic validator)
 *   - enroll-by-invite review step (new)
 *   - catalogue EnrollmentPaymentDialog (new)
 *
 * The endpoint is open (no auth header needed) so we use a bare axios
 * call rather than authenticatedAxiosInstance.
 */

export const COUPON_VALIDATE_URL = `${BASE_URL}/admin-core-service/open/v1/coupon/validate`;

export type CouponDiscountType = "PERCENTAGE" | "FLAT";

export interface CouponValidateRequest {
    couponCode: string;
    instituteId: string;
    packageSessionId?: string | null;
    enrollInviteId?: string | null;
    productPageCode?: string | null;
    paymentPlanId?: string | null;
    userEmail?: string | null;
    totalAmount: number;
}

export interface CouponValidateResponse {
    coupon_code_id?: string | null;
    applied_coupon_discount_id?: string | null;
    discount_type?: CouponDiscountType | null;
    discount_value?: number | null;
    max_discount_value?: number | null;
    valid: boolean;
    /**
     * Stable error code from CouponValidationMessages (e.g. INVALID_COUPON,
     * COUPON_EXPIRED, COUPON_LIMIT_REACHED, COUPON_NOT_APPLICABLE,
     * COUPON_NOT_FOR_PLAN_TYPE, COUPON_EMAIL_RESTRICTED). UI translates
     * via {@link couponErrorMessage}.
     */
    message: string;
}

/**
 * Camel→snake the keys the backend expects. The validate request DTO uses
 * @JsonNaming(SnakeCaseStrategy) so we MUST send snake_case or fields
 * arrive as null.
 */
const toWirePayload = (req: CouponValidateRequest) => ({
    coupon_code: req.couponCode,
    institute_id: req.instituteId,
    package_session_id: req.packageSessionId ?? null,
    enroll_invite_id: req.enrollInviteId ?? null,
    product_page_code: req.productPageCode ?? null,
    payment_plan_id: req.paymentPlanId ?? null,
    user_email: req.userEmail ?? null,
    total_amount: req.totalAmount,
});

export const validateCouponGeneric = async (
    req: CouponValidateRequest
): Promise<CouponValidateResponse> => {
    const { data } = await axios.post<CouponValidateResponse>(
        COUPON_VALIDATE_URL,
        toWirePayload(req)
    );
    return data;
};

/**
 * Maps stable backend error codes to learner-friendly copy. Falls back to
 * the raw message when an unknown code arrives (forward-compatible).
 *
 * `t` is given only on a public site with languages (useCheckoutCoupon),
 * where the course word is the site language's: the message that names it
 * is then a sentence of that language too. Without it, the copy below.
 */
export const couponErrorMessage = (
    code: string | undefined | null,
    t?: TFunction
): string => {
    switch (code) {
        case "INVALID_COUPON":
            return "Invalid coupon code.";
        case "COUPON_INACTIVE":
            return "This coupon is no longer active.";
        case "COUPON_NOT_STARTED":
            return "This coupon isn’t active yet.";
        case "COUPON_EXPIRED":
            return "This coupon has expired.";
        case "COUPON_LIMIT_REACHED":
            return "This coupon has reached its usage limit.";
        case "COUPON_EMAIL_RESTRICTED":
            return "This coupon isn’t available for your account.";
        case "COUPON_NOT_APPLICABLE": {
            const course = getTerminology(
                ContentTerms.Course,
                SystemTerms.Course
            ).toLowerCase();
            return t
                ? t("couponInput.errors.notApplicable", {
                      course,
                      defaultValue: "This coupon isn’t valid for this {{course}}.",
                  })
                : `This coupon isn’t valid for this ${course}.`;
        }
        case "COUPON_NOT_FOR_PLAN_TYPE":
            return "This coupon can’t be used with this plan type.";
        case "COUPON_DISCOUNT_NOT_CONFIGURED":
            return "This coupon is misconfigured. Please contact support.";
        default:
            return code || "Could not apply this coupon.";
    }
};
