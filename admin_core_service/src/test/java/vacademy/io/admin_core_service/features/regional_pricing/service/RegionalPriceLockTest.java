package vacademy.io.admin_core_service.features.regional_pricing.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.user_subscription.entity.AppliedCouponDiscount;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.service.coupon.CouponDiscountUtil;

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RegionalPriceLockTest {

    private static UserPlan plan(double basePrice) {
        PaymentPlan pp = new PaymentPlan();
        pp.setActualPrice(basePrice);
        pp.setCurrency("INR");
        UserPlan up = new UserPlan();
        up.setPaymentPlan(pp);
        return up;
    }

    private static AppliedCouponDiscount flat(double amount) {
        AppliedCouponDiscount d = new AppliedCouponDiscount();
        d.setDiscountType("amount");
        d.setDiscountPoint(amount);
        return d;
    }

    private static AppliedCouponDiscount percent(double pct, Double cap) {
        AppliedCouponDiscount d = new AppliedCouponDiscount();
        d.setDiscountType("percentage");
        d.setDiscountPoint(pct);
        d.setMaxDiscountPoint(cap);
        return d;
    }

    @Test
    void unlockedPlanBehavesExactlyAsBefore() {
        UserPlan up = plan(999);
        assertFalse(RegionalPriceLock.isLocked(up));
        assertEquals(999.0, RegionalPriceLock.listPrice(up));
        assertEquals("INR", RegionalPriceLock.currency(up, "INR"));
        assertEquals(1.0, RegionalPriceLock.scale(up));
        assertEquals(CouponDiscountUtil.applyDiscount(999.0, flat(100)),
                RegionalPriceLock.applyDiscount(up, 999.0, flat(100)));
        assertEquals(CouponDiscountUtil.applyDiscount(999.0, percent(10, 50.0)),
                RegionalPriceLock.applyDiscount(up, 999.0, percent(10, 50.0)));
    }

    @Test
    void lockedPlanChargesTheLockedPriceAndCurrency() {
        UserPlan up = plan(999);
        up.setRegionalPrice(new BigDecimal("11.99"));
        up.setRegionalCurrency("USD");
        assertTrue(RegionalPriceLock.isLocked(up));
        assertEquals(11.99, RegionalPriceLock.listPrice(up));
        assertEquals("USD", RegionalPriceLock.currency(up, "INR"));
    }

    @Test
    void baseCurrencyCouponAmountsScaleIntoTheLockedCurrency() {
        UserPlan up = plan(1000);
        up.setRegionalPrice(new BigDecimal("12.00"));
        up.setRegionalCurrency("USD");
        // ₹100 off ₹1000 = 10% → $1.20 off $12.00
        assertEquals(10.80, RegionalPriceLock.applyDiscount(up, 12.0, flat(100)), 0.001);
        // 20% capped at ₹100 → cap scales to $1.20
        assertEquals(10.80, RegionalPriceLock.applyDiscount(up, 12.0, percent(20, 100.0)), 0.001);
        // 5% under the cap → plain 5%
        assertEquals(11.40, RegionalPriceLock.applyDiscount(up, 12.0, percent(5, 100.0)), 0.001);
    }
}
