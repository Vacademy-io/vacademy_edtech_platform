package vacademy.io.admin_core_service.features.user_subscription.service.coupon;

/**
 * Stable error codes returned in CouponValidateResponseDTO.message. The
 * learner-facing copy is mapped on the FE — keep these stable so FE
 * translations don't break.
 */
public final class CouponValidationMessages {

    public static final String VALID = "COUPON_APPLIED";
    public static final String INVALID = "INVALID_COUPON";
    public static final String INACTIVE = "COUPON_INACTIVE";
    public static final String NOT_STARTED = "COUPON_NOT_STARTED";
    public static final String EXPIRED = "COUPON_EXPIRED";
    public static final String LIMIT_REACHED = "COUPON_LIMIT_REACHED";
    public static final String EMAIL_RESTRICTED = "COUPON_EMAIL_RESTRICTED";
    public static final String NOT_APPLICABLE = "COUPON_NOT_APPLICABLE";
    public static final String NOT_FOR_PLAN_TYPE = "COUPON_NOT_FOR_PLAN_TYPE";
    public static final String DISCOUNT_MISSING = "COUPON_DISCOUNT_NOT_CONFIGURED";
    /** Basket is smaller than the coupon's minimum — see CouponCode.minItems. */
    public static final String BELOW_MIN_ITEMS = "COUPON_BELOW_MIN_ITEMS";

    private CouponValidationMessages() {}
}
