package vacademy.io.admin_core_service.features.credits.client;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.sql.PreparedStatement;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.LongSupplier;

/**
 * Which institutes have a LIVE AI plan subscription right now (an
 * {@code institute_ai_subscription} row in TRIAL / ACTIVE / GRACE with enforcement LIVE),
 * and only while the platform switch {@code billing.plans.enabled} is on.
 *
 * <p>{@link CreditClient#planCovers} asks this first. For every other institute (all of them
 * on the day this ships: the switch is off and there are no subscriptions) the plan check is
 * an in-memory set lookup: no HTTP call to ai_service, no database work, nothing changes. A
 * SHADOW subscription is not in the set either: in shadow a plan charges exactly as today,
 * so its pre-checks must too.
 *
 * <p>Same design as {@link AiLimitsPolicyIndex}: ONE small query at most every
 * {@value #TTL_SECONDS} s per replica, always on a background thread of its own
 * ({@code ai-plans-index}); a caller that finds the set stale schedules the reload and goes
 * on with the last good set. A failed reload keeps the last good set. Before the migration
 * creates the table the set is empty (logged once), so no institute is ever treated as
 * covered by it.
 *
 * <p>A subscription that was just switched to LIVE is seen within about {@value #TTL_SECONDS} s;
 * until then the institute's pre-checks behave as today (wallet only), which is the safe
 * direction.
 */
@Slf4j
@Component
public class AiPlanSubscriptionIndex {

    static final long TTL_SECONDS = 30;
    /** Seconds the reload query may run before the driver cancels it. */
    static final int QUERY_TIMEOUT_SECONDS = 2;

    /** The platform switch ai_service also reads (absent or anything but true = off). */
    public static final String PLANS_ENABLED_KEY = "billing.plans.enabled";

    /**
     * Institutes with a live, LIVE-enforced subscription, empty unless billing.plans.enabled is
     * true (JSONB true or the string "true"). No ':' anywhere (no casts with ::), no trailing
     * spaces that a text block would strip: each clause sits on its own line.
     */
    static final String SELECT_LIVE_PLAN_INSTITUTES = """
            SELECT DISTINCT s.institute_id
            FROM institute_ai_subscription s
            WHERE s.status IN ('TRIAL', 'ACTIVE', 'GRACE')
            AND s.enforcement = 'LIVE'
            AND EXISTS (
            SELECT 1 FROM ai_platform_settings p
            WHERE p.setting_key = 'billing.plans.enabled'
            AND lower(btrim(CAST(p.setting_value AS text), '" ')) = 'true'
            )""";

    private final JdbcTemplate jdbcTemplate;
    private final LongSupplier nanoClock;
    private final Executor reloadExecutor;
    private final ReentrantLock reloadLock = new ReentrantLock();
    /** A reload is scheduled or running: callers never queue a second one. */
    private final AtomicBoolean reloadPending = new AtomicBoolean(false);

    private volatile Set<String> institutes = Set.of();
    /** System.nanoTime() of the last reload attempt (or of its scheduling); 0 = never. */
    private volatile long loadedAt = 0L;
    private volatile boolean everAttempted = false;
    private volatile boolean loggedUnavailable = false;

    @Autowired
    public AiPlanSubscriptionIndex(JdbcTemplate jdbcTemplate) {
        this(jdbcTemplate, System::nanoTime, backgroundExecutor());
    }

    /** Tests: a fake clock and an executor that runs the reload where the test wants it. */
    AiPlanSubscriptionIndex(JdbcTemplate jdbcTemplate, LongSupplier nanoClock, Executor reloadExecutor) {
        this.jdbcTemplate = jdbcTemplate;
        this.nanoClock = nanoClock;
        this.reloadExecutor = reloadExecutor;
    }

    private static Executor backgroundExecutor() {
        return Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "ai-plans-index");
            t.setDaemon(true);
            return t;
        });
    }

    /**
     * True when the institute may have a LIVE plan subscription; false = skip the plan check
     * entirely (today's behaviour). Never throws, never touches the database on the calling
     * thread.
     */
    public boolean mayHaveLivePlan(String instituteId) {
        if (instituteId == null || instituteId.isBlank()) {
            return false;
        }
        scheduleReloadIfStale();
        return institutes.contains(instituteId.trim());
    }

    private boolean stale() {
        return !everAttempted || nanoClock.getAsLong() - loadedAt >= TTL_SECONDS * 1_000_000_000L;
    }

    private void scheduleReloadIfStale() {
        if (!stale() || !reloadPending.compareAndSet(false, true)) {
            return;
        }
        try {
            reloadExecutor.execute(() -> {
                try {
                    reloadNow();
                } finally {
                    reloadPending.set(false);
                }
            });
        } catch (Exception e) {
            // Executor refused (shutting down): keep the last good set, try again later.
            reloadPending.set(false);
            loadedAt = nanoClock.getAsLong();
            everAttempted = true;
        }
    }

    /** One reload, now, on this thread (one at a time; keeps the last good set on failure). */
    private void reloadNow() {
        if (!reloadLock.tryLock()) {
            return;
        }
        try {
            if (!stale()) {
                return;
            }
            try {
                institutes = load();
                if (loggedUnavailable) {
                    log.info("[ai-plans] subscription table readable again; {} institute(s) on a LIVE plan",
                            institutes.size());
                    loggedUnavailable = false;
                }
            } catch (Exception e) {
                if (!loggedUnavailable) {
                    loggedUnavailable = true;
                    log.warn("[ai-plans] could not read institute_ai_subscription (migration not applied?); "
                            + "admin_core pre-checks stay wallet-only: {}", e.getMessage());
                }
            } finally {
                loadedAt = nanoClock.getAsLong();
                everAttempted = true;
            }
        } finally {
            reloadLock.unlock();
        }
    }

    private Set<String> load() {
        Set<String> out = new HashSet<>();
        jdbcTemplate.query(con -> {
            PreparedStatement ps = con.prepareStatement(SELECT_LIVE_PLAN_INSTITUTES);
            ps.setQueryTimeout(QUERY_TIMEOUT_SECONDS);
            return ps;
        }, rs -> {
            String id = rs.getString(1);
            if (id != null && !id.isBlank()) {
                out.add(id.trim());
            }
        });
        return Set.copyOf(out);
    }
}
