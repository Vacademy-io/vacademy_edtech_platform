package vacademy.io.admin_core_service.features.credits.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;

import java.util.Map;

/**
 * The self sign-up trial rule for AI calls (docs/PRODUCT_SELF_SIGNUP.md, step 7): once a
 * self sign-up's trial has ended, AI work is refused until it buys or is granted credits or takes
 * a plan. ai_service's {@code check_credits} already applies it; the calling credit gate reads the
 * balance only, so the dial path asks here.
 *
 * <p>Cheap for everyone else: one primary-key read finds the few institutes whose self sign-up
 * trial date has passed, and only those ask ai_service, which alone knows about purchases, grants
 * and live plans. Never in the way of AI on a fault (same as ai_service): any error reads as
 * "not ended".
 */
@Slf4j
@Service
public class SelfSignupTrialGate {

    public static final String CODE_TRIAL_ENDED = "trial_ended";
    public static final String MSG_TRIAL_ENDED = "Your free trial has ended. Recharge credits to continue.";

    static final String SELECT_PAST_TRIAL_DATE = """
            SELECT COUNT(*) FROM institutes i
             WHERE i.id = :id
               AND i.lead_tag = 'FREE_TRIAL'
               AND i.demo_expires_at IS NOT NULL
               AND i.demo_expires_at <= now()
               AND i.product IN (SELECT substr(s.setting_key, 9) FROM ai_platform_settings s
                                  WHERE s.setting_key LIKE 'product.%')
            """;

    private final NamedParameterJdbcTemplate jdbc;
    private final CreditClient creditClient;

    public SelfSignupTrialGate(NamedParameterJdbcTemplate jdbc, CreditClient creditClient) {
        this.jdbc = jdbc;
        this.creditClient = creditClient;
    }

    public boolean trialEnded(String instituteId) {
        if (instituteId == null || instituteId.isBlank()) return false;
        try {
            Integer past = jdbc.queryForObject(SELECT_PAST_TRIAL_DATE,
                    new MapSqlParameterSource("id", instituteId), Integer.class);
            if (past == null || past == 0) return false;
            Map<String, Object> status = creditClient.getTrialStatus(instituteId);
            return status != null && Boolean.TRUE.equals(status.get("expired"));
        } catch (Exception e) {
            log.warn("Trial check failed for institute {}, allowing: {}", instituteId, e.getMessage());
            return false;
        }
    }
}
