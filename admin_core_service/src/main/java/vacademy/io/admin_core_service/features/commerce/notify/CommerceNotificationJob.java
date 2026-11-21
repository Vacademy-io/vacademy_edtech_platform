package vacademy.io.admin_core_service.features.commerce.notify;

import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.commerce.notify.repository.CommerceNotificationStore;
import vacademy.io.common.logging.SentryLogger;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.function.LongSupplier;

/**
 * Plans and sends what the listener did not (a full executor, a pod that stopped, a retry that is
 * due). Every minute: due PENDING events (100 at most), then due PENDING deliveries (at most
 * {@value #MAX_SENDS} sends, {@value #MAX_PER_INSTITUTE} per institute, a {@link #BUDGET} budget),
 * then deliveries SENDING for more than ten minutes become UNKNOWN. With no rows each query is a
 * probe of an empty partial index.
 *
 * <p>The run never outlives its lock: a send is started only while the budget lasts and while the
 * lock still covers a send's worst case ({@link #WORST_CASE_SEND}: a template read and the send
 * itself, each up to a 10 s connect and a 30 s read timeout), so the last send ends inside
 * {@link #LOCK_AT_MOST} and no second pod starts the job meanwhile.
 */
@Slf4j
@Component
public class CommerceNotificationJob {

    static final int BATCH = 100;
    static final int MAX_SENDS = 50;
    static final int MAX_PER_INSTITUTE = 20;
    static final Duration BUDGET = Duration.ofSeconds(25);
    /** Two internal calls (template read, send), each at most a 10 s connect plus a 30 s read. */
    static final Duration WORST_CASE_SEND = Duration.ofSeconds(80);
    /** Room left for the lost-claims step and the run's own statements after the last send. */
    static final Duration MARGIN = Duration.ofSeconds(10);
    /** Must equal {@code lockAtMostFor} below. */
    static final Duration LOCK_AT_MOST = Duration.ofMinutes(2);
    static final String LOCK_AT_MOST_TEXT = "PT2M";

    private final CommerceNotificationStore store;
    private final CommerceNotificationDispatcher dispatcher;
    private final LongSupplier clock;

    @Autowired
    public CommerceNotificationJob(CommerceNotificationStore store, CommerceNotificationDispatcher dispatcher) {
        this(store, dispatcher, System::currentTimeMillis);
    }

    CommerceNotificationJob(CommerceNotificationStore store, CommerceNotificationDispatcher dispatcher,
                            LongSupplier clock) {
        this.store = store;
        this.dispatcher = dispatcher;
        this.clock = clock;
    }

    @Scheduled(cron = "${commerce.notify.cron:15 * * * * *}")
    @SchedulerLock(name = "CommerceNotificationJob", lockAtMostFor = LOCK_AT_MOST_TEXT, lockAtLeastFor = "PT10S")
    public void run() {
        try {
            runOnce();
        } catch (Exception e) {
            log.error("COMMERCE_ALERT notification job failed: {}", e.getClass().getSimpleName());
            SentryLogger.logError(e, "Commerce notification job failed");
        }
    }

    /** One run; counts per step. Public for the database proof. */
    public Map<String, Integer> runOnce() {
        long started = clock.getAsLong();
        Map<String, Integer> counts = new HashMap<>();
        for (CommerceNotificationStore.EventRow event : store.dueEvents(BATCH)) {
            if (over(started)) {
                break;
            }
            String outcome = dispatcher.plan(event);
            counts.merge(outcome == null ? "events_waiting" : "events_" + outcome.toLowerCase(), 1, Integer::sum);
        }
        if (dispatcher.enabled()) {
            Map<String, Integer> perInstitute = new HashMap<>();
            int sends = 0;
            for (CommerceNotificationStore.DeliveryRow row : store.dueDeliveries(BATCH)) {
                if (sends >= MAX_SENDS || !canStartSend(started)) {
                    break;
                }
                if (perInstitute.merge(row.instituteId(), 1, Integer::sum) > MAX_PER_INSTITUTE) {
                    continue;
                }
                sends++;
                try {
                    CommerceNotificationDispatcher.Result result = dispatcher.send(row.id());
                    counts.merge("send_" + result.name().toLowerCase(), 1, Integer::sum);
                } catch (RuntimeException e) {
                    counts.merge("errors", 1, Integer::sum);
                    log.error("COMMERCE_NOTIFY delivery {} failed in the job: {}", row.id(),
                            e.getClass().getSimpleName());
                }
            }
        }
        int lost = dispatcher.reapLostClaims(BATCH);
        if (lost > 0) {
            counts.put("claims_lost", lost);
        }
        if (!counts.isEmpty()) {
            log.info("COMMERCE_NOTIFY run {} ms={}", counts, clock.getAsLong() - started);
        }
        return counts;
    }

    private boolean over(long started) {
        return clock.getAsLong() - started >= BUDGET.toMillis();
    }

    /** A send may start: within the budget, and with a send's worst case still inside the lock. */
    boolean canStartSend(long started) {
        long elapsed = clock.getAsLong() - started;
        return elapsed < BUDGET.toMillis()
                && LOCK_AT_MOST.toMillis() - elapsed >= WORST_CASE_SEND.toMillis() + MARGIN.toMillis();
    }
}
