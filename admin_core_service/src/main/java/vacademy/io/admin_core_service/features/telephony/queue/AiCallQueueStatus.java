package vacademy.io.admin_core_service.features.telephony.queue;

/**
 * Lifecycle of one queued AI call.
 *
 * <p>{@link #QUEUED} and {@link #DISPATCHING} are the two "pending" states — the
 * partial unique index on {@code dedupe_key} covers exactly those, so a lead can hold
 * at most one undialled item at a time while a legitimate later retry (after the
 * first has gone out) still enqueues.
 */
public enum AiCallQueueStatus {

    /** Waiting for a slot. The only state the drain scan considers. */
    QUEUED,

    /** Claimed by the drainer, provider call in flight. Transient (sub-second). */
    DISPATCHING,

    /** The provider accepted the dial; {@code call_log_id} points at the call. */
    DIALED,

    /** The dial was attempted and refused/errored past the retry budget. */
    FAILED,

    /** Sat in the queue past its TTL without ever getting a slot. */
    EXPIRED,

    /**
     * Deliberately dropped without dialling: an admin cancelled it, or a pre-dial
     * guard said this call must not happen (lead deleted, lead already assigned to a
     * counsellor while the item waited).
     */
    CANCELLED;

    public boolean isPending() {
        return this == QUEUED || this == DISPATCHING;
    }

    public boolean isTerminal() {
        return !isPending();
    }

    public static AiCallQueueStatus parseOrDefault(String s) {
        if (s == null) return QUEUED;
        try {
            return valueOf(s);
        } catch (IllegalArgumentException e) {
            return QUEUED;
        }
    }
}
