package vacademy.io.admin_core_service.features.ai_usage.job;

import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;

import java.util.List;
import java.util.Map;

/**
 * Hourly renewal / expiry pass for AI plan subscriptions.
 *
 * <p>ai_service owns the subscription rules; this job only asks it to apply them
 * ({@code POST /ai-service/internal/plans/v1/roll}, internal token): open the next period for
 * an ACTIVE subscription past its period end that renews (MANUAL and COMPLIMENTARY roll on
 * their own), apply a pending plan change at renewal, move cancel-at-period-end to CANCELLED
 * and a reached end date to EXPIRED. The call is idempotent, so a repeated or overlapping run
 * changes nothing. It never touches the wallet, the ledger or usage events.
 *
 * <p>Skipped when the platform setting {@value #SETTING_KEY} in {@code ai_platform_settings}
 * is false (absent = on), and when there is no subscription that could need rolling (no
 * SCHEDULED / TRIAL / ACTIVE / GRACE row, or the table does not exist yet), so on the day
 * this ships it makes no HTTP call at all. A failed call is logged and retried next hour.
 *
 * <p>{@code @SchedulerLock}: admin_core runs several replicas; one run an hour is enough.
 * Minute 7 keeps it off the top of the hour, where other jobs start.
 */
@Slf4j
@Component
public class AiPlansRollJob {

    public static final String SETTING_KEY = "billing.plans.roll.enabled";

    static final String SELECT_SETTING =
            "SELECT CAST(setting_value AS text) FROM ai_platform_settings WHERE setting_key = ?";

    /**
     * Any subscription the roll could act on (one row is enough). PENDING is included: the roll
     * expires an unpaid paid-plan checkout, which may be the only open subscription.
     */
    static final String SELECT_ANY_ROLLABLE =
            "SELECT 1 FROM institute_ai_subscription WHERE status IN ('SCHEDULED', 'PENDING', 'TRIAL', 'ACTIVE', 'GRACE') LIMIT 1";

    private final JdbcTemplate jdbcTemplate;
    private final CreditClient creditClient;

    public AiPlansRollJob(JdbcTemplate jdbcTemplate, CreditClient creditClient) {
        this.jdbcTemplate = jdbcTemplate;
        this.creditClient = creditClient;
    }

    @Scheduled(cron = "0 7 * * * *", zone = "UTC")
    @SchedulerLock(name = "AiPlansRollJob", lockAtMostFor = "PT20M", lockAtLeastFor = "PT1M")
    public void run() {
        try {
            runOnce();
        } catch (Exception e) {
            log.error("[ai-plans-roll] run failed", e);
        }
    }

    /** One pass. Returns ai_service's report, or null when skipped or failed. Exposed for tests. */
    public Map<String, Object> runOnce() {
        if (!isEnabled()) {
            log.info("[ai-plans-roll] {} is false; skipping", SETTING_KEY);
            return null;
        }
        if (!anyRollableSubscription()) {
            log.debug("[ai-plans-roll] no AI plan subscription to roll");
            return null;
        }
        Map<String, Object> report = creditClient.rollAiPlans();
        if (report == null) {
            log.warn("[ai-plans-roll] ai_service roll failed; will retry next hour");
            return null;
        }
        if (Boolean.FALSE.equals(report.get("ok"))) {
            log.warn("[ai-plans-roll] ai_service could not roll ({}); will retry next hour", report.get("error"));
            return report;
        }
        log.info("[ai-plans-roll] done: {}", report);
        return report;
    }

    /** The switch. Absent or unreadable = on. */
    boolean isEnabled() {
        try {
            List<String> rows = jdbcTemplate.queryForList(SELECT_SETTING, String.class, SETTING_KEY);
            return rows.isEmpty() || !AiUsageRoleBackfillJob.isFalse(rows.get(0));
        } catch (Exception e) {
            log.debug("[ai-plans-roll] could not read {}: {}", SETTING_KEY, e.getMessage());
            return true;
        }
    }

    /** False when there is nothing to roll or the table is not there yet (before the migration). */
    boolean anyRollableSubscription() {
        try {
            return !jdbcTemplate.queryForList(SELECT_ANY_ROLLABLE, Integer.class).isEmpty();
        } catch (Exception e) {
            log.debug("[ai-plans-roll] could not read institute_ai_subscription: {}", e.getMessage());
            return false;
        }
    }
}
