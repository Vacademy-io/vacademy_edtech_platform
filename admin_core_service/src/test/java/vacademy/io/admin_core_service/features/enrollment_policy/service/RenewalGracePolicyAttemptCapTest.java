package vacademy.io.admin_core_service.features.enrollment_policy.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Date;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Grace keeps access; it must not keep presenting the card. Within a 15-day grace the card
 * is tried at most MAX_CHARGE_ATTEMPTS times (default 3), then the plan waits for grace to
 * end and expires there without another charge.
 */
class RenewalGracePolicyAttemptCapTest {

    private final RenewalGracePolicy policy = new RenewalGracePolicy(new ObjectMapper());

    private static final Instant END = Instant.parse("2026-11-27T00:00:00Z");

    private static UserPlan plan(String autopaySetting) {
        EnrollInvite invite = new EnrollInvite();
        invite.setSettingJson("{\"setting\":{\"AUTOPAY_SETTING\":" + autopaySetting + "}}");
        UserPlan plan = new UserPlan();
        plan.setEnrollInvite(invite);
        plan.setEndDate(Date.from(END));
        return plan;
    }

    private static Date day(int daysAfterEnd) {
        return Date.from(END.plusSeconds(daysAfterEnd * 86400L + 9 * 3600L + 1800L)); // 09:30 UTC sweep
    }

    @Test
    void defaultsToThreeAttemptsAndReadsTheInviteOverride() {
        assertThat(policy.maxChargeAttempts(plan("{\"GRACE_PERIOD_DAYS\":15}").getEnrollInvite())).isEqualTo(3);
        assertThat(policy.maxChargeAttempts(plan("{\"GRACE_PERIOD_DAYS\":15,\"MAX_CHARGE_ATTEMPTS\":2}").getEnrollInvite()))
                .isEqualTo(2);
        assertThat(policy.maxChargeAttempts(null)).isEqualTo(3);
    }

    @Test
    void retriesTomorrowWhileAttemptsRemain() {
        UserPlan p = plan("{\"GRACE_PERIOD_DAYS\":15}");
        Date now = day(0);
        assertThat(policy.nextLookAt(p, now, 1, 3)).isEqualTo(Date.from(now.toInstant().plusSeconds(86400)));
        assertThat(policy.nextLookAt(p, now, 2, 3)).isEqualTo(Date.from(now.toInstant().plusSeconds(86400)));
        assertThat(policy.attemptsUsedUpInGrace(p, now, 2, 3)).isFalse();
    }

    @Test
    void afterTheLastAttemptItWaitsForGraceToEndWithoutCharging() {
        UserPlan p = plan("{\"GRACE_PERIOD_DAYS\":15}");
        Date thirdFailure = day(2);
        Date parked = policy.nextLookAt(p, thirdFailure, 3, 3);
        assertThat(parked).isEqualTo(Date.from(
                policy.lastGraceDay(p).plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant()));
        // Inside grace with every attempt spent: the sweep must not charge.
        assertThat(policy.attemptsUsedUpInGrace(p, day(5), 3, 3)).isTrue();
        assertThat(policy.isExhausted(p, day(5), 3, 3)).isFalse();
        // On the parked day grace is over: the sweep expires it.
        assertThat(policy.isPastGrace(p, Date.from(parked.toInstant().plusSeconds(9 * 3600L + 1800L)))).isTrue();
    }

    @Test
    void withoutGraceTheCeilingStillExpiresAtTheLastAttempt() {
        UserPlan p = plan("{}");
        assertThat(policy.isConfigured(p)).isFalse();
        assertThat(policy.isExhausted(p, day(2), 3, 3)).isTrue();
        assertThat(policy.attemptsUsedUpInGrace(p, day(2), 3, 3)).isFalse();
    }
}
