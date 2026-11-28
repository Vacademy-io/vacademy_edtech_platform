package vacademy.io.admin_core_service.features.ai_plans_billing.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * {@code ai_subscription_mandate} (V590): one autopay mandate (Razorpay customer + recurring
 * token on the platform account). Plain JDBC: the table is shared with ai_service (UUID ids, no
 * admin_core entity), and admin_core is the only writer of the Razorpay-facing columns.
 *
 * <p>Status: PENDING (registration link sent) -> ACTIVE (token.confirmed) | REJECTED, and later
 * PAUSED | CANCELLED | EXPIRED. Only an ACTIVE mandate is debited.
 *
 * <p>SQL is plain string concatenation (no text blocks: a stripped trailing space glued
 * clauses together once) and uses {@code CAST(? AS UUID)}, never a {@code ::} cast.
 */
@Repository
public class AiSubscriptionMandateStore {

    public static final String PENDING = "PENDING";
    public static final String ACTIVE = "ACTIVE";
    public static final String PAUSED = "PAUSED";
    public static final String CANCELLED = "CANCELLED";
    public static final String REJECTED = "REJECTED";
    public static final String EXPIRED = "EXPIRED";

    public record Mandate(
            String id,
            String instituteId,
            String subscriptionId,
            String razorpayCustomerId,
            String tokenId,
            String method,
            Long maxAmountMinor,
            String frequency,
            String status,
            String registrationLinkId,
            String registrationLinkUrl,
            String authOrderId,
            String authPaymentId,
            String failureReason,
            Instant createdAt,
            Instant updatedAt) {

        public boolean isActive() {
            return ACTIVE.equals(status);
        }
    }

    static final String COLS = "CAST(id AS TEXT) AS id, institute_id, CAST(subscription_id AS TEXT) AS subscription_id, "
            + "razorpay_customer_id, token_id, method, max_amount_minor, frequency, status, registration_link_id, "
            + "registration_link_url, auth_order_id, auth_payment_id, failure_reason, created_at, updated_at";

    private static final RowMapper<Mandate> MAPPER = (rs, i) -> new Mandate(
            rs.getString("id"),
            rs.getString("institute_id"),
            rs.getString("subscription_id"),
            rs.getString("razorpay_customer_id"),
            rs.getString("token_id"),
            rs.getString("method"),
            rs.getObject("max_amount_minor") == null ? null : rs.getLong("max_amount_minor"),
            rs.getString("frequency"),
            rs.getString("status"),
            rs.getString("registration_link_id"),
            rs.getString("registration_link_url"),
            rs.getString("auth_order_id"),
            rs.getString("auth_payment_id"),
            rs.getString("failure_reason"),
            ts(rs.getTimestamp("created_at")),
            ts(rs.getTimestamp("updated_at")));

    private final JdbcTemplate jdbc;

    public AiSubscriptionMandateStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static Instant ts(Timestamp t) {
        return t == null ? null : t.toInstant();
    }

    /** Inserts a PENDING mandate and returns its id. */
    public String insertPending(String instituteId, String subscriptionId, String customerId, String method,
            long maxAmountMinor, String frequency, String actor) {
        String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO ai_subscription_mandate (id, institute_id, subscription_id, razorpay_customer_id, "
                + "method, max_amount_minor, frequency, status, created_by) "
                + "VALUES (CAST(? AS UUID), ?, CAST(? AS UUID), ?, ?, ?, ?, 'PENDING', ?)",
                id, instituteId, subscriptionId, customerId, method, maxAmountMinor, frequency, actor);
        return id;
    }

    public void setRegistrationLink(String id, String linkId, String linkUrl, String authOrderId) {
        jdbc.update("UPDATE ai_subscription_mandate SET registration_link_id = ?, registration_link_url = ?, "
                + "auth_order_id = ?, updated_at = now() WHERE id = CAST(? AS UUID)",
                linkId, linkUrl, authOrderId, id);
    }

    public Optional<Mandate> findById(String id) {
        if (id == null) {
            return Optional.empty();
        }
        return jdbc.query("SELECT " + COLS + " FROM ai_subscription_mandate WHERE id = CAST(? AS UUID)", MAPPER, id)
                .stream().findFirst();
    }

    public Optional<Mandate> findByIdForUpdate(String id) {
        return jdbc.query("SELECT " + COLS + " FROM ai_subscription_mandate WHERE id = CAST(? AS UUID) FOR UPDATE",
                MAPPER, id).stream().findFirst();
    }

    public Optional<Mandate> findByTokenId(String tokenId) {
        if (tokenId == null || tokenId.isBlank()) {
            return Optional.empty();
        }
        return jdbc.query("SELECT " + COLS + " FROM ai_subscription_mandate WHERE token_id = ?", MAPPER, tokenId)
                .stream().findFirst();
    }

    /** The mandate a debit may use: ACTIVE, for this subscription, newest first. */
    public Optional<Mandate> findActiveForSubscription(String subscriptionId) {
        if (subscriptionId == null) {
            return Optional.empty();
        }
        return jdbc.query("SELECT " + COLS + " FROM ai_subscription_mandate WHERE subscription_id = CAST(? AS UUID) "
                + "AND status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1", MAPPER, subscriptionId)
                .stream().findFirst();
    }

    /** The newest mandate of the institute in any state (storefront status). */
    public Optional<Mandate> findLatestForInstitute(String instituteId) {
        return jdbc.query("SELECT " + COLS + " FROM ai_subscription_mandate WHERE institute_id = ? "
                + "ORDER BY created_at DESC LIMIT 1", MAPPER, instituteId).stream().findFirst();
    }

    public List<Mandate> findForInstitute(String instituteId) {
        return jdbc.query("SELECT " + COLS + " FROM ai_subscription_mandate WHERE institute_id = ? "
                + "ORDER BY created_at DESC LIMIT 50", MAPPER, instituteId);
    }

    /** A Razorpay customer this institute already has (customers are reused across mandates). */
    public Optional<String> findCustomerIdForInstitute(String instituteId) {
        return jdbc.queryForList("SELECT razorpay_customer_id FROM ai_subscription_mandate WHERE institute_id = ? "
                + "AND razorpay_customer_id IS NOT NULL ORDER BY created_at DESC LIMIT 1", String.class, instituteId)
                .stream().findFirst();
    }

    /** PENDING mandates with a token (waiting for token.confirmed): the reconcile job polls these. */
    public List<Mandate> findPendingWithToken(int limit) {
        return jdbc.query("SELECT " + COLS + " FROM ai_subscription_mandate WHERE status = 'PENDING' "
                + "AND token_id IS NOT NULL ORDER BY updated_at ASC LIMIT ?", MAPPER, limit);
    }

    /**
     * Records the token from the authorisation payment (payment.captured carries {@code token_id}).
     * Never overwrites a different token already on the row.
     */
    public int recordToken(String id, String tokenId, String customerId, String authPaymentId) {
        return jdbc.update("UPDATE ai_subscription_mandate SET token_id = COALESCE(token_id, ?), "
                + "razorpay_customer_id = COALESCE(razorpay_customer_id, ?), auth_payment_id = COALESCE(auth_payment_id, ?), "
                + "updated_at = now() WHERE id = CAST(? AS UUID) AND (token_id IS NULL OR token_id = ?)",
                tokenId, customerId, authPaymentId, id, tokenId);
    }

    /**
     * The statuses a mandate may move to {@code target} from. Only forward moves:
     * PENDING -> ACTIVE | REJECTED, ACTIVE <-> PAUSED, any usable or pending one -> CANCELLED | EXPIRED.
     * CANCELLED, REJECTED and EXPIRED are terminal: a late or replayed token webhook never revives
     * a mandate the institute (or staff, or Razorpay) ended.
     */
    public static List<String> allowedFrom(String target) {
        if (target == null) {
            return List.of();
        }
        return switch (target) {
            case ACTIVE -> List.of(PENDING, PAUSED);
            case PAUSED -> List.of(ACTIVE);
            case REJECTED -> List.of(PENDING);
            case CANCELLED, EXPIRED -> List.of(PENDING, ACTIVE, PAUSED);
            default -> List.of();
        };
    }

    public static boolean isTerminal(String status) {
        return CANCELLED.equals(status) || REJECTED.equals(status) || EXPIRED.equals(status);
    }

    /** Status change along {@link #allowedFrom}; returns rows changed (0 = not allowed / already there). */
    public int updateStatus(String id, String status, String failureReason) {
        return transition(id, status, failureReason, null);
    }

    /**
     * Conditional status change: only from a status in {@link #allowedFrom}{@code (status)}, and,
     * when {@code eventAt} is given (the Razorpay webhook's {@code created_at}), only when no newer
     * event was applied already ({@code last_event_at}). Returns rows changed.
     */
    public int transition(String id, String status, String failureReason, Instant eventAt) {
        List<String> from = allowedFrom(status);
        if (from.isEmpty()) {
            return 0;
        }
        Timestamp at = eventAt == null ? null : Timestamp.from(eventAt);
        List<Object> args = new java.util.ArrayList<>(List.of(status));
        args.add(failureReason);
        args.add(status);
        args.add(at);
        args.add(at);
        args.add(at);
        args.add(id);
        StringBuilder in = new StringBuilder();
        for (String f : from) {
            in.append(in.length() == 0 ? "?" : ", ?");
            args.add(f);
        }
        String sql = "UPDATE ai_subscription_mandate SET status = ?, failure_reason = COALESCE(?, failure_reason), "
                + "cancelled_at = CASE WHEN ? = 'CANCELLED' THEN COALESCE(cancelled_at, now()) ELSE cancelled_at END, "
                + "last_event_at = CASE WHEN CAST(? AS TIMESTAMPTZ) IS NULL THEN last_event_at "
                + "ELSE GREATEST(COALESCE(last_event_at, CAST(? AS TIMESTAMPTZ)), CAST(? AS TIMESTAMPTZ)) END, "
                + "updated_at = now() WHERE id = CAST(? AS UUID) AND status IN (" + in + ")";
        if (at != null) {
            sql += " AND (last_event_at IS NULL OR last_event_at <= ?)";
            args.add(at);
        }
        return jdbc.update(sql, args.toArray());
    }

    /** True when a token event created at {@code eventAt} is older than one already applied. */
    public boolean isStaleEvent(String id, Instant eventAt) {
        if (id == null || eventAt == null) {
            return false;
        }
        List<Timestamp> last = jdbc.queryForList("SELECT last_event_at FROM ai_subscription_mandate "
                + "WHERE id = CAST(? AS UUID)", Timestamp.class, id);
        return !last.isEmpty() && last.get(0) != null && last.get(0).toInstant().isAfter(eventAt);
    }

    /** PENDING mandates that never got a token and are older than {@code days}: their registration lapsed. */
    public List<Mandate> findLapsedPending(int days, int limit) {
        return jdbc.query("SELECT " + COLS + " FROM ai_subscription_mandate WHERE status = 'PENDING' "
                + "AND token_id IS NULL AND created_at < now() - make_interval(days => ?) ORDER BY created_at LIMIT ?",
                MAPPER, days, limit);
    }

    /** ACTIVE / PAUSED mandates of a subscription other than {@code keepId} (ux_asm_usable allows one). */
    public List<Mandate> findOtherUsable(String subscriptionId, String keepId) {
        if (subscriptionId == null) {
            return List.of();
        }
        return jdbc.query("SELECT " + COLS + " FROM ai_subscription_mandate WHERE subscription_id = CAST(? AS UUID) "
                + "AND status IN ('ACTIVE', 'PAUSED') AND id <> CAST(? AS UUID)", MAPPER, subscriptionId, keepId);
    }

    /** Usable (ACTIVE / PAUSED) mandates of an institute: the tenant's cancel acts on these. */
    public List<Mandate> findUsableForInstitute(String instituteId) {
        return jdbc.query("SELECT " + COLS + " FROM ai_subscription_mandate WHERE institute_id = ? "
                + "AND status IN ('ACTIVE', 'PAUSED', 'PENDING') ORDER BY created_at DESC", MAPPER, instituteId);
    }

    /** Links a mandate to the subscription once known (checkout creates the subscription first). */
    public void attachSubscription(String id, String subscriptionId) {
        jdbc.update("UPDATE ai_subscription_mandate SET subscription_id = CAST(? AS UUID), updated_at = now() "
                + "WHERE id = CAST(? AS UUID) AND subscription_id IS NULL", subscriptionId, id);
    }
}
