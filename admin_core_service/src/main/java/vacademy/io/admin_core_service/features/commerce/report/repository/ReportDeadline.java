package vacademy.io.admin_core_service.features.commerce.report.repository;

import org.springframework.dao.QueryTimeoutException;

/**
 * The time a report request may still take (contract 3.6: 25 s on screen, 50 s for a file). The
 * runner starts it once per request; every report statement then gets only what is left as its
 * query timeout ({@link ReportJdbcTemplate}), and one that would start after the end is refused
 * before it reaches the database. So a report of twenty statements cannot hold a replica
 * connection twenty times 25 s.
 *
 * <p>Thread-bound: a request runs on one thread, and the runner clears it in {@code finally}.
 */
public final class ReportDeadline {

    private static final ThreadLocal<Long> END_NANOS = new ThreadLocal<>();

    private ReportDeadline() {
    }

    /** Starts the deadline of this thread's request; false (and nothing changed) when one is already running. */
    public static boolean start(long millis) {
        if (END_NANOS.get() != null) {
            return false;
        }
        END_NANOS.set(System.nanoTime() + millis * 1_000_000L);
        return true;
    }

    public static boolean active() {
        return END_NANOS.get() != null;
    }

    public static void clear() {
        END_NANOS.remove();
    }

    /** Milliseconds left (never below 0); -1 when no deadline runs on this thread. */
    public static long millisLeft() {
        Long end = END_NANOS.get();
        if (end == null) {
            return -1;
        }
        return Math.max(0, (end - System.nanoTime()) / 1_000_000L);
    }

    /**
     * The query timeout of the next statement, in whole seconds (rounded up; JDBC counts seconds);
     * 0 when no deadline runs. Refuses with {@link QueryTimeoutException} when the time is up.
     */
    public static int secondsForNextStatement() {
        long left = millisLeft();
        if (left < 0) {
            return 0;
        }
        if (left == 0) {
            throw new QueryTimeoutException("the report's time is up");
        }
        return (int) Math.min(Integer.MAX_VALUE, (left + 999) / 1000);
    }
}
