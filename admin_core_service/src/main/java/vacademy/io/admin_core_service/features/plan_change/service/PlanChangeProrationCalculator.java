package vacademy.io.admin_core_service.features.plan_change.service;

import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.util.PlanValidityResolver;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Calendar;
import java.util.Date;

/**
 * Works out what an upgrade costs today and when the new access window ends.
 *
 * <p>The model is the PLAN DIFFERENCE, in money and in time alike: the learner pays
 * {@code targetPrice - currentPrice} and their access is extended by
 * {@code targetValidity - currentValidity}, added to the end date they already hold.
 * Monthly (Rs 1,200 / 30d) to Half-Yearly (Rs 4,800 / 180d) costs Rs 3,600 and adds 150
 * days to the current cycle end -- so the learner ends up exactly where they would have
 * been had they bought Half-Yearly at the start of this cycle. No refunds are ever
 * produced: the credit is capped at the target price, so the charge floors at zero.
 *
 * <p>The trade-in only applies while the current plan is actually running and was paid
 * for. A trial (nothing paid) and a lapsed plan (nothing left) get no credit and no
 * shortened extension: they pay the target in full and receive its full validity.
 *
 * <p>A trial gets no credit at all: it has paid nothing for the current cycle (only the
 * token-registration auth, which is not the plan price), so it pays the target in full.
 *
 * <p>Pure and stateless so the arithmetic is unit-testable without a database.
 */
@Component
public class PlanChangeProrationCalculator {

    private static final long MILLIS_PER_DAY = 24L * 60 * 60 * 1000;

    /** The priced outcome of moving one UserPlan onto one target plan. */
    public record Proration(
            /** Price of the plan being left behind, allowed against the target. Never > target price. */
            BigDecimal credit,
            /** {@code max(0, targetPrice - credit)} — what to charge right now. */
            BigDecimal amountDueNow,
            /** Days still paid for on the current plan. */
            long remainingDays,
            /** Days added to the access window by this change. */
            int extensionDays,
            /** New access-until date for an IMMEDIATE change. Null when the target is lifetime. */
            Date newEndDate) {
    }

    public Proration compute(UserPlan userPlan, PaymentPlan targetPlan) {
        return compute(userPlan, targetPlan, new Date());
    }

    /** {@code now} is a parameter so tests can pin the clock. */
    public Proration compute(UserPlan userPlan, PaymentPlan targetPlan, Date now) {
        BigDecimal targetPrice = money(targetPlan != null ? targetPlan.getActualPrice() : 0d);
        BigDecimal currentPrice = money(userPlan != null && userPlan.getPaymentPlan() != null
                ? userPlan.getPaymentPlan().getActualPrice()
                : 0d);

        long remainingDays = remainingDays(userPlan, now);
        BigDecimal credit = credit(userPlan, currentPrice, targetPrice);
        BigDecimal amountDueNow = targetPrice.subtract(credit).max(BigDecimal.ZERO)
                .setScale(2, RoundingMode.HALF_UP);

        return new Proration(credit, amountDueNow, remainingDays,
                extensionDays(userPlan, targetPlan, now), newEndDate(userPlan, targetPlan, now));
    }

    /**
     * Days still paid for. Zero once the plan has lapsed — an expired learner has no unused
     * value to credit and pays the new plan in full, which is also what makes "upgrade" the
     * natural reactivation path for a dunning-expired membership.
     */
    public long remainingDays(UserPlan userPlan, Date now) {
        if (userPlan == null || userPlan.getEndDate() == null) {
            return 0L;
        }
        long millis = userPlan.getEndDate().getTime() - now.getTime();
        if (millis <= 0) {
            return 0L;
        }
        // Ceiling: a learner with 12 hours left has one day of value, not zero.
        return (millis + MILLIS_PER_DAY - 1) / MILLIS_PER_DAY;
    }

    /**
     * The current plan's FULL price, allowed against the target -- so the learner pays the
     * difference between the two plans. Not scaled by days elapsed or remaining: an upgrade
     * on day 2 and an upgrade on day 25 of the same cycle cost the same, and the new term
     * starts fresh either way.
     *
     * <p>Capped at the target price so an upgrade never produces a negative charge, and
     * zero for a trial, which has paid nothing to trade in.
     */
    private BigDecimal credit(UserPlan userPlan, BigDecimal currentPrice, BigDecimal targetPrice) {
        if (currentPrice.signum() <= 0 || !tradeInApplies(userPlan, new Date())) {
            return BigDecimal.ZERO.setScale(2, RoundingMode.HALF_UP);
        }
        return currentPrice.min(targetPrice).setScale(2, RoundingMode.HALF_UP);
    }

    /**
     * Whether the learner has a running, paid-for plan to trade in. False for a trial
     * (the plan price was never paid) and for a plan whose term has already ended
     * (nothing is left to trade). Both the money and the days hang off this one test, so
     * they can never disagree: no credit means no shortened extension.
     */
    private boolean tradeInApplies(UserPlan userPlan, Date now) {
        return userPlan != null
                && !Boolean.TRUE.equals(userPlan.getIsTrial())
                && userPlan.getEndDate() != null
                && userPlan.getEndDate().after(now);
    }

    /**
     * {@code targetValidity - currentValidity} when the learner trades a running plan in,
     * otherwise the target's full validity. Never less than zero -- an upgrade always
     * lengthens the window, and upgrades are the only change offered.
     */
    public int extensionDays(UserPlan userPlan, PaymentPlan targetPlan, Date now) {
        Integer targetValidity = PlanValidityResolver.fromPlan(targetPlan);
        if (targetValidity == null || targetValidity <= 0) {
            return 0;
        }
        if (!tradeInApplies(userPlan, now)) {
            return targetValidity;
        }
        Integer currentValidity = firstNonNull(
                PlanValidityResolver.fromPlan(userPlan.getPaymentPlan()),
                PlanValidityResolver.fromPlanJson(userPlan.getPlanJson()));
        if (currentValidity == null || currentValidity <= 0 || currentValidity >= targetValidity) {
            return targetValidity;
        }
        return targetValidity - currentValidity;
    }

    /**
     * The end of the extended window: the date the learner already holds, plus
     * {@link #extensionDays}. A lapsed plan counts from today instead, since there is no
     * live window to add to. Null when the target has no validity -- that is a lifetime
     * plan, and stamping an end date on it would expire access the enrollment path
     * deliberately left open.
     */
    public Date newEndDate(UserPlan userPlan, PaymentPlan targetPlan, Date now) {
        Integer validity = PlanValidityResolver.fromPlan(targetPlan);
        if (validity == null) {
            return null;
        }
        Date base = (userPlan != null && userPlan.getEndDate() != null && userPlan.getEndDate().after(now))
                ? userPlan.getEndDate()
                : now;
        Calendar calendar = Calendar.getInstance();
        calendar.setTime(base);
        calendar.add(Calendar.DAY_OF_MONTH, extensionDays(userPlan, targetPlan, now));
        return calendar.getTime();
    }

    private static BigDecimal money(double value) {
        return BigDecimal.valueOf(value).setScale(2, RoundingMode.HALF_UP);
    }

    private static Integer firstNonNull(Integer a, Integer b) {
        return a != null ? a : b;
    }
}
