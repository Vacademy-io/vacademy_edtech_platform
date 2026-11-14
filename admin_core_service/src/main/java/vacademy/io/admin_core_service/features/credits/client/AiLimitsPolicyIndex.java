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
 * Which institutes have AI usage limits switched on (an {@code institute_ai_limits_policy}
 * row in mode SHADOW or ENFORCE). {@link CreditClient#authorize} asks this first, so for every
 * other institute — all of them on the day this ships — the limit gate is an in-memory set
 * lookup: no HTTP call to ai_service, no database work, no added latency, nothing sent.
 *
 * <p>The set is reloaded with ONE small query at most every {@value #TTL_SECONDS} s per
 * replica, ALWAYS on a background thread of its own ({@code ai-limits-index}): a caller that
 * finds the set stale only schedules the reload and goes on with the last good set at once,
 * so it never waits for a pooled connection or the query (the same design as ai_service's
 * index). One reload at a time; a failed reload keeps the last good set. Before the migration
 * creates the table the set is empty (logged once), so no institute is ever gated by it.
 *
 * <p>An institute whose policy was just switched on is seen within about {@value #TTL_SECONDS} s;
 * until then its calls run as today (fail open), which is the safe direction.
 */
@Slf4j
@Component
public class AiLimitsPolicyIndex {

    static final long TTL_SECONDS = 30;
    /** Seconds the reload query may run before the driver cancels it. */
    static final int QUERY_TIMEOUT_SECONDS = 2;

    static final String SELECT_POLICY_INSTITUTES = """
            SELECT DISTINCT institute_id
            FROM institute_ai_limits_policy
            WHERE mode IN ('SHADOW', 'ENFORCE')""";

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
    public AiLimitsPolicyIndex(JdbcTemplate jdbcTemplate) {
        this(jdbcTemplate, System::nanoTime, backgroundExecutor());
    }

    /** Tests: a fake clock and an executor that runs the reload where the test wants it. */
    AiLimitsPolicyIndex(JdbcTemplate jdbcTemplate, LongSupplier nanoClock, Executor reloadExecutor) {
        this.jdbcTemplate = jdbcTemplate;
        this.nanoClock = nanoClock;
        this.reloadExecutor = reloadExecutor;
    }

    private static Executor backgroundExecutor() {
        return Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "ai-limits-index");
            t.setDaemon(true);
            return t;
        });
    }

    /**
     * True when the institute may have limits on; false = skip the gate entirely. Never throws,
     * never touches the database on the calling thread.
     */
    public boolean mayHaveLimits(String instituteId) {
        if (instituteId == null || instituteId.isBlank()) {
            return false;
        }
        scheduleReloadIfStale();
        return institutes.contains(instituteId.trim());
    }

    /**
     * True when any institute has limits on (the nightly counter rebuild skips otherwise). Runs
     * the reload on the calling thread when the set is stale: only for the scheduled job's own
     * thread, never for a request path.
     */
    public boolean anyInstituteHasLimits() {
        if (stale()) {
            reloadNow();
        }
        return !institutes.isEmpty();
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
            return; // another thread is reloading; use the last good set
        }
        try {
            if (!stale()) {
                return;
            }
            try {
                institutes = load();
                if (loggedUnavailable) {
                    log.info("[ai-limits] limits policy table readable again; {} institute(s) with limits on",
                            institutes.size());
                    loggedUnavailable = false;
                }
            } catch (Exception e) {
                if (!loggedUnavailable) {
                    loggedUnavailable = true;
                    log.warn("[ai-limits] could not read institute_ai_limits_policy (migration not applied?); "
                            + "usage limits are not checked from admin_core: {}", e.getMessage());
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
            PreparedStatement ps = con.prepareStatement(SELECT_POLICY_INSTITUTES);
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
