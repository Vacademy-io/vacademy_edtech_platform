package vacademy.io.admin_core_service.features.ai_usage.job;

import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.credits.client.AiLimitsPolicyIndex;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;

import java.util.List;
import java.util.Map;

/**
 * Nightly drift repair for the AI usage-limit counters.
 *
 * <p>{@code ai_usage_counter} is a cache of {@code ai_usage_event}: ai_service bumps it after
 * each charge, and a lost bump (a failed SAVEPOINT, a crash between commit and counter write)
 * leaves it a little off. This job asks ai_service to recompute the current windows from the
 * events and rewrite any counter that differs
 * ({@code POST /ai-service/internal/metering/v1/counters/rebuild?days=35}); ai_service logs
 * each fix. It never touches credits, the ledger or the events.
 *
 * <p>Skipped when no institute has limits on (nothing reads the counters then) and when the
 * platform setting {@value #SETTING_KEY} in {@code ai_platform_settings} is false (absent =
 * on). A failed call is logged and retried the next night.
 *
 * <p>{@code @SchedulerLock}: admin_core runs several replicas; one run a night is enough.
 * 21:30 UTC (03:00 IST), the quietest hour for Indian institutes: the rebuild's final write
 * touches the counters every charge also updates, so it runs when almost nobody is charging.
 * Events whose role is still unresolved are attributed by ai_service from the user's latest
 * resolved event (the same rule the live counters use), so the order against
 * {@link AiUsageRoleBackfillJob} (02:40 UTC) does not change the result.
 */
@Slf4j
@Component
public class AiUsageCounterRebuildJob {

    public static final String SETTING_KEY = "metering.limits.rebuild.enabled";

    /** The longest window is a month; 35 days covers it from any day of the month. */
    static final int REBUILD_DAYS = 35;

    static final String SELECT_SETTING =
            "SELECT CAST(setting_value AS text) FROM ai_platform_settings WHERE setting_key = ?";

    private final JdbcTemplate jdbcTemplate;
    private final CreditClient creditClient;
    private final AiLimitsPolicyIndex policyIndex;

    public AiUsageCounterRebuildJob(JdbcTemplate jdbcTemplate, CreditClient creditClient,
            AiLimitsPolicyIndex policyIndex) {
        this.jdbcTemplate = jdbcTemplate;
        this.creditClient = creditClient;
        this.policyIndex = policyIndex;
    }

    @Scheduled(cron = "0 30 21 * * *", zone = "UTC")
    @SchedulerLock(name = "AiUsageCounterRebuildJob", lockAtMostFor = "PT20M", lockAtLeastFor = "PT1M")
    public void run() {
        try {
            runOnce();
        } catch (Exception e) {
            log.error("[metering-counter-rebuild] run failed", e);
        }
    }

    /** One pass. Returns ai_service's report, or null when skipped or failed. Exposed for tests. */
    public Map<String, Object> runOnce() {
        if (!isEnabled()) {
            log.info("[metering-counter-rebuild] {} is false; skipping", SETTING_KEY);
            return null;
        }
        if (!policyIndex.anyInstituteHasLimits()) {
            log.debug("[metering-counter-rebuild] no institute has AI usage limits on; nothing to rebuild");
            return null;
        }
        Map<String, Object> report = creditClient.rebuildUsageCounters(REBUILD_DAYS);
        if (report == null) {
            log.warn("[metering-counter-rebuild] ai_service rebuild failed; will retry next run");
            return null;
        }
        if (Boolean.FALSE.equals(report.get("ok"))) {
            // ai_service answers 200 {ok: false, error} when its engine could not run.
            log.warn("[metering-counter-rebuild] ai_service could not rebuild ({}); will retry next run",
                    report.get("error"));
            return report;
        }
        log.info("[metering-counter-rebuild] done: {}", report);
        return report;
    }

    /** The switch. Absent or unreadable = on. */
    boolean isEnabled() {
        try {
            List<String> rows = jdbcTemplate.queryForList(SELECT_SETTING, String.class, SETTING_KEY);
            return rows.isEmpty() || !AiUsageRoleBackfillJob.isFalse(rows.get(0));
        } catch (Exception e) {
            log.debug("[metering-counter-rebuild] could not read {}: {}", SETTING_KEY, e.getMessage());
            return true;
        }
    }
}
