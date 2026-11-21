package vacademy.io.common.tracing;

import java.util.function.Supplier;

/**
 * Accumulates, per request, the time spent waiting on third parties.
 *
 * WHY THIS EXISTS. `Server-Timing: app;dur=...` originally reported the whole
 * request duration, so an endpoint whose time is spent waiting on someone else's
 * API looked exactly like an endpoint we are slow at. That produced a real false
 * alarm: /v1/telephony/calls/connect takes ~2.1s because it dials a live phone
 * through the telephony provider, which pushed a counsellor's rolling median past
 * the client-side "server slow" threshold and told them "Vacademy is slow — this
 * is on our side" while the platform was serving p50 16ms. A client reported the
 * LMS as slow on the strength of that badge.
 *
 * So the filter now emits two numbers, and the browser judges on `app` alone:
 *
 *   Server-Timing: app;dur=95, ext;dur=2035
 *                  ^ our compute   ^ waiting on someone else
 *
 * Wrap any synchronous call to a third party in {@link #time} and it stops
 * counting against us. Good candidates: telephony dial-out, BBB/Zoom meeting
 * creation, LLM calls, payment gateways, media/S3 round trips.
 *
 * SCOPE AND SAFETY
 * - The counter only exists between {@link #begin} and {@link #clear}, which
 *   RequestTracingFilter calls around each request. Outside a traced request
 *   (scheduled jobs, @Async work) {@link #time} still runs the call but records
 *   nothing, so nothing leaks onto a pooled thread.
 * - It is per thread. Work handed to another thread is not attributed, which is
 *   correct: it is not on the request's critical path.
 * - Nested wrapping double counts, so wrap at ONE level — the outermost call into
 *   the third party, not both the adapter and its HTTP client.
 */
public final class ExternalCallTimer {

    /** Single-element holder so adding time does not re-set the ThreadLocal. */
    private static final ThreadLocal<long[]> ELAPSED_NANOS = new ThreadLocal<>();

    private ExternalCallTimer() {
    }

    /** Start counting for this thread. Called by RequestTracingFilter. */
    public static void begin() {
        ELAPSED_NANOS.set(new long[] { 0L });
    }

    /** Stop counting and release the ThreadLocal. MUST run in a finally. */
    public static void clear() {
        ELAPSED_NANOS.remove();
    }

    /** Nanoseconds spent in third-party calls so far, or 0 outside a traced request. */
    public static long elapsedNanos() {
        long[] holder = ELAPSED_NANOS.get();
        return holder == null ? 0L : holder[0];
    }

    /** Milliseconds spent in third-party calls so far. */
    public static long elapsedMillis() {
        return elapsedNanos() / 1_000_000L;
    }

    /** Record time measured elsewhere. No-op outside a traced request. */
    public static void addNanos(long nanos) {
        if (nanos <= 0) {
            return;
        }
        long[] holder = ELAPSED_NANOS.get();
        if (holder != null) {
            holder[0] += nanos;
        }
    }

    /**
     * Run a third-party call and attribute its duration to `ext` rather than to us.
     * The call's own exceptions propagate untouched, and its time is still recorded
     * — a provider that fails slowly was still not our latency.
     */
    public static <T> T time(Supplier<T> call) {
        long start = System.nanoTime();
        try {
            return call.get();
        } finally {
            addNanos(System.nanoTime() - start);
        }
    }

    /** Void form of {@link #time(Supplier)}. */
    public static void time(Runnable call) {
        long start = System.nanoTime();
        try {
            call.run();
        } finally {
            addNanos(System.nanoTime() - start);
        }
    }

    /**
     * Form for calls that throw checked exceptions, which {@link Supplier} cannot
     * express. The checked exception propagates as-is.
     */
    public static <T> T timeChecked(ThrowingSupplier<T> call) throws Exception {
        long start = System.nanoTime();
        try {
            return call.get();
        } finally {
            addNanos(System.nanoTime() - start);
        }
    }

    /** A {@link Supplier} that may throw a checked exception. */
    @FunctionalInterface
    public interface ThrowingSupplier<T> {
        T get() throws Exception;
    }
}
