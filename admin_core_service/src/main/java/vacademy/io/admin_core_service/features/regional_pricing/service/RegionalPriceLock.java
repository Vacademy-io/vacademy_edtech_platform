package vacademy.io.admin_core_service.features.regional_pricing.service;

import vacademy.io.admin_core_service.features.regional_pricing.dto.RegionalQuote;
import vacademy.io.admin_core_service.features.user_subscription.entity.AppliedCouponDiscount;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.service.coupon.CouponDiscountUtil;

/**
 * The price a UserPlan is billed at. A plan bought under regional pricing carries a lock
 * (user_plan.regional_*), and every later charge — renewal, invoice line, ledger accrual,
 * mandate ceiling — must use it instead of the plan's base price, or a USD buyer would be
 * renewed in rupees. Plans without a lock behave exactly as before.
 */
public final class RegionalPriceLock {

    private RegionalPriceLock() {}

    public static boolean isLocked(UserPlan userPlan) {
        return userPlan != null && userPlan.getRegionalPrice() != null && userPlan.getRegionalCurrency() != null;
    }

    public static void apply(UserPlan userPlan, RegionalQuote quote) {
        if (userPlan == null || quote == null) {
            return;
        }
        userPlan.setRegionalPrice(quote.actualPrice());
        userPlan.setRegionalCurrency(quote.currency());
        userPlan.setRegionalCountry(quote.countryCode());
    }

    /** Gross list price for one cycle of this UserPlan, before any discount. */
    public static double listPrice(UserPlan userPlan) {
        if (isLocked(userPlan)) {
            return userPlan.getRegionalPrice().doubleValue();
        }
        PaymentPlan plan = userPlan != null ? userPlan.getPaymentPlan() : null;
        return plan != null ? plan.getActualPrice() : 0.0;
    }

    /** Charge currency: the lock's, else {@code fallback}. */
    public static String currency(UserPlan userPlan, String fallback) {
        return isLocked(userPlan) ? userPlan.getRegionalCurrency() : fallback;
    }

    /**
     * Applies a discount to an amount in the UserPlan's charge currency. Coupon amounts
     * (flat discounts, percentage caps) are written in the plan's base currency, so on a
     * locked plan they are scaled by regional ÷ base price first: ₹100 off a ₹999 plan
     * becomes $1.20 off its $11.99 regional price. Unlocked plans are unchanged.
     */
    public static double applyDiscount(UserPlan userPlan, Double amount, AppliedCouponDiscount discount) {
        return applyDiscount(amount, scale(userPlan), discount);
    }

    /** As above with an explicit regional ÷ base scale (checkout, before the UserPlan exists). */
    public static double applyDiscount(Double amount, double scale, AppliedCouponDiscount discount) {
        if (scale == 1.0 || amount == null || discount == null) {
            return CouponDiscountUtil.applyDiscount(amount, discount);
        }
        double baseEquivalent = amount / scale;
        double discountInCharge = CouponDiscountUtil.computeDiscount(discount, baseEquivalent) * scale;
        double net = Math.max(0.0, amount - discountInCharge);
        return Math.round(net * 100.0) / 100.0;
    }

    /** Regional price ÷ base price; 1 when unlocked or the base price is zero. */
    public static double scale(UserPlan userPlan) {
        if (!isLocked(userPlan)) {
            return 1.0;
        }
        return scale(userPlan.getRegionalPrice().doubleValue(), userPlan.getPaymentPlan());
    }

    public static double scale(RegionalQuote quote, PaymentPlan plan) {
        return quote == null ? 1.0 : scale(quote.actualPrice().doubleValue(), plan);
    }

    private static double scale(double regionalPrice, PaymentPlan plan) {
        if (plan == null || plan.getActualPrice() <= 0) {
            return 1.0;
        }
        return regionalPrice / plan.getActualPrice();
    }
}
