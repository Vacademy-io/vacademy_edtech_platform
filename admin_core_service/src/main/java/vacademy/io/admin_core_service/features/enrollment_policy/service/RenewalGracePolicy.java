package vacademy.io.admin_core_service.features.enrollment_policy.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.util.TrialStartResolver;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Date;

/**
 * One answer to "has this plan's dunning window closed?" for BOTH failure paths —
 * the synchronous sweep ({@code RenewalChargeService.applyDunning}) and the
 * asynchronous gateway webhook ({@code RenewalPaymentService.handleFailedRenewal}).
 *
 * <p>With {@code AUTOPAY_SETTING.GRACE_PERIOD_DAYS} on the invite, access is kept
 * (plan ACTIVE, mappings ACTIVE, class workflows still reach the learner) and the
 * charge is retried daily until the grace has fully elapsed: the plan expires at
 * the first sweep on the day AFTER {@code end_date + graceDays}, in the invite's
 * billing timezone. A 2-day grace on a plan ending 21 Sep therefore keeps the
 * learner active through the whole of 22 and 23 Sep and expires them on the 24th.
 *
 * <p>Anchoring on {@code end_date} is the point: it only moves on a successful
 * renewal, so the deadline is fixed for the whole dunning sequence. The previous
 * rule anchored on {@code next_charge_at}, which every failed attempt re-armed to
 * "tomorrow" — the deadline slid forward with it and a plan under grace retried
 * forever without ever expiring.
 *
 * <p>Without a grace period the attempt ceiling governs, exactly as before.
 *
 * <p>Grace is about ACCESS, not about how often a card is presented. Within the grace
 * window the card is charged at most {@link #maxChargeAttempts} times (default 3, one a
 * day from the renewal date). After that no further charge is presented: the plan is
 * parked until the day after grace ends, and that sweep expires it without charging.
 * The member can still pay by hand at any point while access lasts.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class RenewalGracePolicy {

    private final ObjectMapper objectMapper;

    /** Charge attempts per renewal when the invite does not set AUTOPAY_SETTING.MAX_CHARGE_ATTEMPTS. */
    public static final int DEFAULT_MAX_CHARGE_ATTEMPTS = 3;

    /**
     * {@code AUTOPAY_SETTING.MAX_CHARGE_ATTEMPTS} on the invite when positive, else
     * {@link #DEFAULT_MAX_CHARGE_ATTEMPTS}: how many times one renewal may be presented to
     * the card before charging stops.
     */
    public int maxChargeAttempts(EnrollInvite invite) {
        if (invite != null && StringUtils.hasText(invite.getSettingJson())) {
            try {
                JsonNode n = objectMapper.readTree(invite.getSettingJson())
                        .path("setting").path("AUTOPAY_SETTING").path("MAX_CHARGE_ATTEMPTS");
                if (n.isNumber() && n.asInt() > 0) {
                    return n.asInt();
                }
            } catch (Exception e) {
                log.warn("[RenewalGrace] Could not read MAX_CHARGE_ATTEMPTS for invite {}: {}",
                        invite.getId(), e.getMessage());
            }
        }
        return DEFAULT_MAX_CHARGE_ATTEMPTS;
    }

    /**
     * True when a grace period still holds the plan open but every charge attempt has been
     * used: the sweep must not present the card again, only wait for grace to end.
     */
    public boolean attemptsUsedUpInGrace(UserPlan plan, Date now, int attempts, int maxAttempts) {
        return isConfigured(plan) && attempts >= maxAttempts && !isPastGrace(plan, now);
    }

    /**
     * When the sweep should next look at a plan whose charge failed: tomorrow while
     * attempts remain (or when no grace applies); once they are used up under a grace
     * period, the first day after grace ends, when the sweep expires it without charging.
     * Stored at UTC midnight, the zone next_charge_at is read back in.
     */
    public Date nextLookAt(UserPlan plan, Date now, int attempts, int maxAttempts) {
        Date tomorrow = Date.from(now.toInstant().plus(java.time.Duration.ofDays(1)));
        if (attempts < maxAttempts || !isConfigured(plan)) {
            return tomorrow;
        }
        Date afterGrace = Date.from(lastGraceDay(plan).plusDays(1)
                .atStartOfDay(java.time.ZoneOffset.UTC).toInstant());
        return afterGrace.after(tomorrow) ? afterGrace : tomorrow;
    }

    /** {@code AUTOPAY_SETTING.GRACE_PERIOD_DAYS} on the invite; null when unset or not positive. */
    public Integer graceDays(EnrollInvite invite) {
        if (invite == null || !StringUtils.hasText(invite.getSettingJson())) {
            return null;
        }
        try {
            JsonNode ap = objectMapper.readTree(invite.getSettingJson()).path("setting").path("AUTOPAY_SETTING");
            if (ap.has("GRACE_PERIOD_DAYS") && !ap.get("GRACE_PERIOD_DAYS").isNull()) {
                int days = ap.get("GRACE_PERIOD_DAYS").asInt();
                return days > 0 ? days : null;
            }
        } catch (Exception e) {
            log.warn("[RenewalGrace] Could not read GRACE_PERIOD_DAYS for invite {}: {}",
                    invite.getId(), e.getMessage());
        }
        return null;
    }

    /** True when the invite configures a grace period and the plan has an end_date to anchor it on. */
    public boolean isConfigured(UserPlan plan) {
        return plan != null && plan.getEndDate() != null && graceDays(plan.getEnrollInvite()) != null;
    }

    /**
     * Last calendar day of the grace window ({@link #lastAccessDay} + graceDays, in the
     * invite's billing timezone), or null when no grace applies.
     */
    public LocalDate lastGraceDay(UserPlan plan) {
        if (!isConfigured(plan)) {
            return null;
        }
        return lastAccessDay(plan).plusDays(graceDays(plan.getEnrollInvite()));
    }

    /**
     * The last day the plan's own term covers.
     *
     * <p>{@code end_date} is the instant at which access ENDS, so it is an exclusive bound
     * and one second is taken off before asking which day it falls on. That is not a
     * nicety: a 14-day trial ending "27 Sep" is stored as 27 Sep 18:30 UTC, which IS
     * 28 Sep 00:00 in Asia/Kolkata, so reading the date of the instant itself returned the
     * 28th -- the day after access ended. Every window anchored on it was then a day long,
     * which is why lapsed learners kept receiving class links for one more morning than the
     * configured grace allowed. 26 SuchBliss plans sit exactly on this boundary; the rest
     * end mid-day and are unaffected either way, which is what made the drift look random.
     */
    public LocalDate lastAccessDay(UserPlan plan) {
        ZoneId zone = billingZone(plan.getEnrollInvite());
        return plan.getEndDate().toInstant().minusSeconds(1).atZone(zone).toLocalDate();
    }

    /**
     * True once today (billing timezone) is strictly after the last grace day. Always false
     * when no grace is configured — callers then fall back to the attempt ceiling.
     */
    public boolean isPastGrace(UserPlan plan, Date now) {
        LocalDate last = lastGraceDay(plan);
        if (last == null) {
            return false;
        }
        LocalDate today = now.toInstant().atZone(billingZone(plan.getEnrollInvite())).toLocalDate();
        return today.isAfter(last);
    }

    /**
     * Whether a failed charge should end the plan: grace governs when configured
     * (attempt count ignored), otherwise {@code attempts >= maxAttempts}.
     */
    public boolean isExhausted(UserPlan plan, Date now, int attempts, int maxAttempts) {
        if (isConfigured(plan)) {
            return isPastGrace(plan, now);
        }
        return attempts >= maxAttempts;
    }

    private static ZoneId billingZone(EnrollInvite invite) {
        return TrialStartResolver.zoneFromInvite(invite != null ? invite.getSettingJson() : null);
    }
}
