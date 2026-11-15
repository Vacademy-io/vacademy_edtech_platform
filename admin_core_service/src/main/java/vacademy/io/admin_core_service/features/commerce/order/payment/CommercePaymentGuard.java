package vacademy.io.admin_core_service.features.commerce.order.payment;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Optional;

/**
 * Does a payment log, a payment group or a webhook belong to a commerce order? The answer is
 * always read from rows ({@code commerce_order}, {@code commerce_gateway_order}), never from
 * the notes a payment carries and never from a package type.
 *
 * <p>Every test is NULL-safe and is one read on a primary or unique key, so the legacy payment
 * code can ask it for every payment: a course payment has no group id, or a group id that is
 * no commerce order, and gets "no".
 *
 * <p>No method is a read-only transaction: read-only work is routed to the replica
 * ({@code ReplicationRoutingDataSource}), and a payment must be compared with rows that were
 * written a moment ago. Inside a caller's transaction the methods join it.
 */
@Component
public class CommercePaymentGuard {

    /** The facts of an order the payment code compares a payment with. */
    public record OrderFacts(String id, String instituteId, String paymentGroupId, String status,
                             BigDecimal total, String currency, String paymentStatus) {
    }

    /**
     * What a webhook names. {@code gatewayRowId}: the gateway order of the payment is one of
     * ours. {@code namedOrderId}: the order reference in the notes is a commerce order (or a
     * payment log of one), whatever the gateway order of the payment is.
     */
    public record WebhookMatch(String gatewayRowId, String namedOrderId) {
        public static final WebhookMatch NONE = new WebhookMatch(null, null);

        public boolean none() {
            return gatewayRowId == null && namedOrderId == null;
        }
    }

    /** An order the reconcile job looks at. */
    public record DueOrder(String id, String instituteId, Date holdExpiresAt, Date createdAt) {
    }

    @PersistenceContext
    private EntityManager entityManager;

    /** True when the log is a line of a commerce order: its payment group is one order's group. */
    @Transactional
    public boolean isCommerceLog(PaymentLog paymentLog) {
        return paymentLog != null && orderIdOfGroup(paymentLog.getPaymentGroupId()) != null;
    }

    /** The commerce order of a payment group, or null. No query for an empty group id. */
    @Transactional
    public String orderIdOfGroup(String paymentGroupId) {
        if (!StringUtils.hasText(paymentGroupId)) {
            return null;
        }
        return firstString(entityManager.createNativeQuery(
                        "SELECT o.id FROM commerce_order o WHERE o.payment_group_id = :groupId")
                .setParameter("groupId", paymentGroupId)
                .getResultList());
    }

    /** The commerce order a payment log belongs to, or null. */
    @Transactional
    public String orderIdOfPaymentLog(String paymentLogId) {
        if (!StringUtils.hasText(paymentLogId)) {
            return null;
        }
        return firstString(entityManager.createNativeQuery("""
                        SELECT o.id FROM payment_log pl
                        JOIN commerce_order o ON o.payment_group_id = pl.payment_group_id
                        WHERE pl.id = :logId
                        """)
                .setParameter("logId", paymentLogId)
                .getResultList());
    }

    @Transactional
    public Optional<OrderFacts> order(String commerceOrderId) {
        if (!StringUtils.hasText(commerceOrderId)) {
            return Optional.empty();
        }
        List<?> rows = entityManager.createNativeQuery("""
                        SELECT o.id, o.institute_id, o.payment_group_id, o.status, o.total, o.currency,
                               o.payment_status
                        FROM commerce_order o WHERE o.id = :orderId
                        """)
                .setParameter("orderId", commerceOrderId)
                .getResultList();
        if (rows.isEmpty()) {
            return Optional.empty();
        }
        Object[] r = (Object[]) rows.get(0);
        return Optional.of(new OrderFacts(text(r[0]), text(r[1]), text(r[2]), text(r[3]),
                r[4] == null ? null : new BigDecimal(r[4].toString()), text(r[5]), text(r[6])));
    }

    /** The order number, for an alert or a staff list; null when the order is gone. */
    @Transactional
    public String orderNumber(String commerceOrderId) {
        if (!StringUtils.hasText(commerceOrderId)) {
            return null;
        }
        return firstString(entityManager.createNativeQuery(
                        "SELECT o.order_number FROM commerce_order o WHERE o.id = :orderId")
                .setParameter("orderId", commerceOrderId)
                .getResultList());
    }

    /**
     * The branch test of the webhook, one statement of three key reads: is the gateway order of
     * the payment ours, and does the order reference of the notes name a commerce order (by its
     * id) or a payment log of one. Empty for every course payment.
     */
    @Transactional
    public WebhookMatch webhookMatch(String vendor, String gatewayOrderId, String reference) {
        if (!StringUtils.hasText(gatewayOrderId) && !StringUtils.hasText(reference)) {
            return WebhookMatch.NONE;
        }
        // An empty string matches no row; it keeps the parameters typed.
        List<?> rows = entityManager.createNativeQuery("""
                        SELECT 'G' AS kind, g.id AS ref FROM commerce_gateway_order g
                        WHERE g.vendor = :vendor AND g.gateway_order_id = :gatewayOrderId
                        UNION ALL
                        SELECT 'O' AS kind, o.id AS ref FROM commerce_order o WHERE o.id = :reference
                        UNION ALL
                        SELECT 'O' AS kind, o.id AS ref FROM payment_log pl
                        JOIN commerce_order o ON o.payment_group_id = pl.payment_group_id
                        WHERE pl.id = :reference
                        """)
                .setParameter("vendor", vendor == null ? "" : vendor)
                .setParameter("gatewayOrderId", StringUtils.hasText(gatewayOrderId) ? gatewayOrderId : "")
                .setParameter("reference", StringUtils.hasText(reference) ? reference : "")
                .getResultList();
        String gatewayRowId = null;
        String namedOrderId = null;
        for (Object row : rows) {
            Object[] r = (Object[]) row;
            if ("G".equals(text(r[0]))) {
                gatewayRowId = text(r[1]);
            } else if (namedOrderId == null) {
                namedOrderId = text(r[1]);
            }
        }
        return new WebhookMatch(gatewayRowId, namedOrderId);
    }

    /** The payment logs of an order, sorted by id so every caller updates them in one order. */
    @Transactional
    public List<String> logIdsOfGroup(String paymentGroupId) {
        List<String> ids = new ArrayList<>();
        if (!StringUtils.hasText(paymentGroupId)) {
            return ids;
        }
        for (Object row : entityManager.createNativeQuery(
                        "SELECT pl.id FROM payment_log pl WHERE pl.payment_group_id = :groupId ORDER BY pl.id")
                .setParameter("groupId", paymentGroupId)
                .getResultList()) {
            ids.add(text(row));
        }
        return ids;
    }

    /**
     * Orders with a PAID payment log that are still waiting for payment or were cancelled, and
     * whose gateway rows the order code has not dealt with (settled_at empty) and whose payment
     * was seen before {@code paymentSeenBefore}. Oldest first.
     */
    @Transactional
    public List<String> paidOrdersNotConfirmed(Date since, Date paymentSeenBefore, int limit) {
        List<String> ids = new ArrayList<>();
        for (Object row : entityManager.createNativeQuery("""
                        SELECT o.id FROM commerce_order o
                        WHERE o.status IN ('PENDING_PAYMENT', 'CANCELLED')
                          AND o.created_at >= :since
                          AND EXISTS (SELECT 1 FROM commerce_gateway_order g
                                      WHERE g.commerce_order_id = o.id AND g.settled_at IS NULL
                                        AND (g.status_at IS NULL OR g.status_at < :paymentSeenBefore))
                          AND EXISTS (SELECT 1 FROM payment_log pl
                                      WHERE pl.payment_group_id = o.payment_group_id
                                        AND pl.payment_status = 'PAID')
                        ORDER BY o.created_at
                        """)
                .setParameter("since", since)
                .setParameter("paymentSeenBefore", paymentSeenBefore)
                .setMaxResults(limit)
                .getResultList()) {
            ids.add(text(row));
        }
        return ids;
    }

    /**
     * Orders still waiting for payment whose hold time is over (or that carry none and are older
     * than {@code createdBefore}), with no PAID log and no stock still held. Oldest first.
     */
    @Transactional
    public List<DueOrder> unpaidOrdersPastHold(Date now, Date createdBefore, Date since, int limit) {
        List<DueOrder> due = new ArrayList<>();
        for (Object row : entityManager.createNativeQuery("""
                        SELECT o.id, o.institute_id, o.hold_expires_at, o.created_at FROM commerce_order o
                        WHERE o.status = 'PENDING_PAYMENT'
                          AND o.created_at >= :since
                          AND ((o.hold_expires_at IS NOT NULL AND o.hold_expires_at < :now)
                               OR (o.hold_expires_at IS NULL AND o.created_at < :createdBefore))
                          AND NOT EXISTS (SELECT 1 FROM payment_log pl
                                          WHERE pl.payment_group_id = o.payment_group_id
                                            AND pl.payment_status = 'PAID')
                          AND NOT EXISTS (SELECT 1 FROM stock_hold h
                                          JOIN payment_log hl ON hl.id = h.payment_log_id
                                          WHERE hl.payment_group_id = o.payment_group_id
                                            AND h.status = 'HELD')
                        ORDER BY o.created_at
                        """)
                .setParameter("since", since)
                .setParameter("now", now)
                .setParameter("createdBefore", createdBefore)
                .setMaxResults(limit)
                .getResultList()) {
            Object[] r = (Object[]) row;
            due.add(new DueOrder(text(r[0]), text(r[1]), date(r[2]), date(r[3])));
        }
        return due;
    }

    private static String firstString(List<?> rows) {
        return rows.isEmpty() ? null : text(rows.get(0));
    }

    private static String text(Object value) {
        return value == null ? null : value.toString();
    }

    private static Date date(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Date d) {
            return new Date(d.getTime());
        }
        if (value instanceof java.time.LocalDateTime ldt) {
            return Date.from(ldt.toInstant(java.time.ZoneOffset.UTC));
        }
        if (value instanceof java.time.Instant instant) {
            return Date.from(instant);
        }
        return null;
    }
}
