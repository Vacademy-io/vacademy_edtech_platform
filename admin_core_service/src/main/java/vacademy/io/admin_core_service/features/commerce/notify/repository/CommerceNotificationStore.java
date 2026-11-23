package vacademy.io.admin_core_service.features.commerce.notify.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The SQL of the buyer-message tables. Every time comparison is made by the database
 * ({@code now()}), so the pods' clocks and zones never decide what is due or expired. Each
 * method is one statement; callers that need several in one transaction open it.
 */
@Repository
public class CommerceNotificationStore {

    /** An outbox row as the planner reads it. */
    public record EventRow(String id, String instituteId, String orderId, String triggerCode, String refId,
                           int attempts, boolean expired) {
    }

    /** A delivery row and its event, as the sender reads it. */
    public record DeliveryRow(String id, String eventId, String instituteId, String orderId, String triggerCode,
                              String refId, String channel, String locale, String status, String templateName,
                              int attempts, boolean expired) {
    }

    /** A delivery for staff: no address, only its masked form. */
    public record DeliveryView(String triggerCode, String channel, String status, String code, String locale,
                               String recipientMasked, Date createdAt, Date sentAt) {
    }

    /** The order as a message needs it. */
    public record OrderFacts(String id, String instituteId, String orderNumber, String customerName,
                             String customerPhone, String customerEmail, boolean phoneVerified, String channel,
                             String userId, String locale, BigDecimal total, String currency, String cancelReason,
                             String paymentMethod, String status, int linkEpoch, String customerId) {
    }

    /** A delivery that was SENDING too long, now UNKNOWN. */
    public record Lost(String id, String instituteId, String orderId, String triggerCode, String channel) {
    }

    private final JdbcTemplate jdbc;

    public CommerceNotificationStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ================================================================== events

    /** One outbox row; the same order, trigger and ref again writes nothing. 1 when new. */
    public int insertEvent(String instituteId, String orderId, String triggerCode, String refId) {
        return jdbc.update("INSERT INTO commerce_notification_event (id, institute_id, order_id, trigger_code, ref_id) "
                        + "VALUES (?, ?, ?, ?, ?) ON CONFLICT (institute_id, order_id, trigger_code, ref_id) DO NOTHING",
                UUID.randomUUID().toString(), instituteId, orderId, triggerCode, refId == null ? "" : refId);
    }

    private static final String EVENT_COLUMNS = "id, institute_id, order_id, trigger_code, ref_id, attempts, "
            + "(created_at < now() - interval '24 hours') AS expired";

    private static EventRow event(ResultSet rs, int i) throws SQLException {
        return new EventRow(rs.getString("id"), rs.getString("institute_id"), rs.getString("order_id"),
                rs.getString("trigger_code"), rs.getString("ref_id"), rs.getInt("attempts"), rs.getBoolean("expired"));
    }

    /** PENDING events that are due, oldest first. */
    public List<EventRow> dueEvents(int limit) {
        return jdbc.query("SELECT " + EVENT_COLUMNS + " FROM commerce_notification_event WHERE status = 'PENDING' "
                + "AND next_attempt_at <= now() ORDER BY created_at, id LIMIT ?", EVENT_ROW, limit);
    }

    /** The due PENDING events of one order, oldest first. */
    public List<EventRow> dueEventsOfOrder(String instituteId, String orderId) {
        return jdbc.query("SELECT " + EVENT_COLUMNS + " FROM commerce_notification_event WHERE status = 'PENDING' "
                + "AND next_attempt_at <= now() AND institute_id = ? AND order_id = ? ORDER BY created_at, id",
                EVENT_ROW, instituteId, orderId);
    }

    public EventRow findEvent(String id) {
        List<EventRow> rows = jdbc.query("SELECT " + EVENT_COLUMNS + " FROM commerce_notification_event WHERE id = ?",
                EVENT_ROW, id);
        return rows.isEmpty() ? null : rows.get(0);
    }

    private static final org.springframework.jdbc.core.RowMapper<EventRow> EVENT_ROW = CommerceNotificationStore::event;

    /** PENDING to SKIPPED with a reason; nothing is sent for it, ever. */
    public int skipEvent(String id, String reason) {
        return jdbc.update("UPDATE commerce_notification_event SET status = 'SKIPPED', skip_reason = ? "
                + "WHERE id = ? AND status = 'PENDING'", reason, id);
    }

    /** Asked again in {@code minutes}. */
    public int retryEvent(String id, int minutes) {
        return jdbc.update("UPDATE commerce_notification_event SET attempts = LEAST(attempts + 1, 32000), "
                + "next_attempt_at = now() + make_interval(mins => ?) WHERE id = ? AND status = 'PENDING'",
                minutes, id);
    }

    /** PENDING to PLANNED. */
    public int markPlanned(String id) {
        return jdbc.update("UPDATE commerce_notification_event SET status = 'PLANNED', planned_at = now() "
                + "WHERE id = ? AND status = 'PENDING'", id);
    }

    // ================================================================== deliveries

    /** One delivery row of an event; the same channel again writes nothing. */
    public int insertDelivery(String eventId, String instituteId, String orderId, String triggerCode, String channel,
                              String locale, String templateName) {
        return jdbc.update("INSERT INTO commerce_notification_delivery (id, event_id, institute_id, order_id, "
                        + "trigger_code, channel, locale, template_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
                        + "ON CONFLICT (event_id, channel) DO NOTHING",
                UUID.randomUUID().toString(), eventId, instituteId, orderId, triggerCode, channel, locale, templateName);
    }

    private static final String DELIVERY_COLUMNS = "d.id, d.event_id, d.institute_id, d.order_id, d.trigger_code, "
            + "e.ref_id, d.channel, d.locale, d.status, d.template_name, d.attempts, "
            + "(e.created_at < now() - interval '24 hours') AS expired";

    private static final org.springframework.jdbc.core.RowMapper<DeliveryRow> DELIVERY_ROW = (rs, i) ->
            new DeliveryRow(rs.getString("id"), rs.getString("event_id"), rs.getString("institute_id"),
                    rs.getString("order_id"), rs.getString("trigger_code"), rs.getString("ref_id"),
                    rs.getString("channel"), rs.getString("locale"), rs.getString("status"),
                    rs.getString("template_name"), rs.getInt("attempts"), rs.getBoolean("expired"));

    /** PENDING deliveries that are due, oldest first. */
    public List<DeliveryRow> dueDeliveries(int limit) {
        return jdbc.query("SELECT " + DELIVERY_COLUMNS + " FROM commerce_notification_delivery d "
                + "JOIN commerce_notification_event e ON e.id = d.event_id WHERE d.status = 'PENDING' "
                + "AND d.next_attempt_at <= now() ORDER BY d.created_at, d.id LIMIT ?", DELIVERY_ROW, limit);
    }

    /** The due PENDING deliveries of one order, oldest first. */
    public List<DeliveryRow> dueDeliveriesOfOrder(String instituteId, String orderId) {
        return jdbc.query("SELECT " + DELIVERY_COLUMNS + " FROM commerce_notification_delivery d "
                + "JOIN commerce_notification_event e ON e.id = d.event_id WHERE d.status = 'PENDING' "
                + "AND d.next_attempt_at <= now() AND d.institute_id = ? AND d.order_id = ? "
                + "ORDER BY d.created_at, d.id", DELIVERY_ROW, instituteId, orderId);
    }

    public DeliveryRow findDelivery(String id) {
        List<DeliveryRow> rows = jdbc.query("SELECT " + DELIVERY_COLUMNS + " FROM commerce_notification_delivery d "
                + "JOIN commerce_notification_event e ON e.id = d.event_id WHERE d.id = ?", DELIVERY_ROW, id);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /** PENDING and due to SENDING; only the caller that moved it sends. 1 when claimed. */
    public int claim(String id) {
        return jdbc.update("UPDATE commerce_notification_delivery SET status = 'SENDING', claimed_at = now(), "
                + "attempts = attempts + 1, updated_at = now() WHERE id = ? AND status = 'PENDING' "
                + "AND next_attempt_at <= now()", id);
    }

    /** SENDING to a final status. 1 when recorded. */
    public int finish(String id, String status, String code, String detail, String providerMessageId,
                      String recipientHash, String recipientMasked, boolean sent) {
        return jdbc.update("UPDATE commerce_notification_delivery SET status = ?, error_code = ?, error_detail = ?, "
                        + "provider_message_id = ?, recipient_hash = COALESCE(?, recipient_hash), "
                        + "recipient_masked = COALESCE(?, recipient_masked), "
                        + "sent_at = CASE WHEN ? THEN now() ELSE sent_at END, updated_at = now() "
                        + "WHERE id = ? AND status = 'SENDING'",
                status, code, detail, providerMessageId, recipientHash, recipientMasked, sent, id);
    }

    /** SENDING back to PENDING, tried again in {@code minutes} (the platform could not be reached). */
    public int retryDelivery(String id, int minutes, String code, String recipientHash, String recipientMasked) {
        return jdbc.update("UPDATE commerce_notification_delivery SET status = 'PENDING', error_code = ?, "
                        + "next_attempt_at = now() + make_interval(mins => ?), "
                        + "recipient_hash = COALESCE(?, recipient_hash), recipient_masked = COALESCE(?, recipient_masked), "
                        + "updated_at = now() WHERE id = ? AND status = 'SENDING'",
                code, minutes, recipientHash, recipientMasked, id);
    }

    /**
     * SENDING back to PENDING before any call was made (the institute's feature could not be read): asked
     * again in {@code minutes}; the claim does not count as an attempt. 1 when released.
     */
    public int releaseClaim(String id, int minutes, String code) {
        return jdbc.update("UPDATE commerce_notification_delivery SET status = 'PENDING', error_code = ?, "
                        + "attempts = GREATEST(attempts - 1, 0), next_attempt_at = now() + make_interval(mins => ?), "
                        + "updated_at = now() WHERE id = ? AND status = 'SENDING'",
                code, minutes, id);
    }

    /** PENDING deliveries of an expired event: EXPIRED without a claim (nothing is sent a day late). */
    public int expirePending(String id) {
        return jdbc.update("UPDATE commerce_notification_delivery SET status = 'EXPIRED', error_code = 'EXPIRED', "
                + "updated_at = now() WHERE id = ? AND status = 'PENDING'", id);
    }

    /** SENDING for more than {@code minutes}: the pod died during the call. UNKNOWN, never sent again. */
    public List<Lost> reapLostClaims(int minutes, int limit) {
        return jdbc.query("UPDATE commerce_notification_delivery SET status = 'UNKNOWN', error_code = 'CLAIM_LOST', "
                        + "updated_at = now() WHERE id IN (SELECT id FROM commerce_notification_delivery "
                        + "WHERE status = 'SENDING' AND claimed_at < now() - make_interval(mins => ?) "
                        + "ORDER BY claimed_at LIMIT ?) AND status = 'SENDING' "
                        + "RETURNING id, institute_id, order_id, trigger_code, channel",
                (rs, i) -> new Lost(rs.getString("id"), rs.getString("institute_id"), rs.getString("order_id"),
                        rs.getString("trigger_code"), rs.getString("channel")), minutes, limit);
    }

    /** The messages of one order for staff, newest first. */
    public List<DeliveryView> ofOrder(String instituteId, String orderId, int limit) {
        return jdbc.query("SELECT trigger_code, channel, status, error_code, locale, recipient_masked, created_at, "
                        + "sent_at FROM commerce_notification_delivery WHERE institute_id = ? AND order_id = ? "
                        + "ORDER BY created_at DESC, id DESC LIMIT ?",
                (rs, i) -> new DeliveryView(rs.getString("trigger_code"), rs.getString("channel"),
                        rs.getString("status"), rs.getString("error_code"), rs.getString("locale"),
                        rs.getString("recipient_masked"), date(rs.getTimestamp("created_at")),
                        date(rs.getTimestamp("sent_at"))), instituteId, orderId, limit);
    }

    private static Date date(Timestamp t) {
        return t == null ? null : new Date(t.getTime());
    }

    // ================================================================== what a message needs

    public OrderFacts order(String instituteId, String orderId) {
        List<OrderFacts> rows = jdbc.query("SELECT id, institute_id, order_number, customer_name, customer_phone, "
                        + "customer_email, phone_verified, channel, user_id, locale, total, currency, cancel_reason, "
                        + "payment_method, status, link_epoch, customer_id FROM commerce_order "
                        + "WHERE id = ? AND institute_id = ?",
                (rs, i) -> new OrderFacts(rs.getString("id"), rs.getString("institute_id"),
                        rs.getString("order_number"), rs.getString("customer_name"), rs.getString("customer_phone"),
                        rs.getString("customer_email"), rs.getBoolean("phone_verified"), rs.getString("channel"),
                        rs.getString("user_id"), rs.getString("locale"), rs.getBigDecimal("total"),
                        rs.getString("currency"), rs.getString("cancel_reason"), rs.getString("payment_method"),
                        rs.getString("status"), rs.getInt("link_epoch"), rs.getString("customer_id")),
                orderId, instituteId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /** carrier_name, tracking_number, cod_amount of a shipment of the order (empty map when none). */
    public Map<String, Object> shipment(String orderId, String shipmentId) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT carrier_name, tracking_number, cod_amount "
                + "FROM commerce_shipment WHERE id = ? AND order_id = ?", shipmentId, orderId);
        return rows.isEmpty() ? Map.of() : rows.get(0);
    }

    /** return_number of a return of the order (empty map when none). */
    public Map<String, Object> orderReturn(String orderId, String returnId) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT return_number FROM commerce_return "
                + "WHERE id = ? AND order_id = ?", returnId, orderId);
        return rows.isEmpty() ? Map.of() : rows.get(0);
    }

    /** amount, currency, method, gateway_refund_id, reference of a refund of the order (empty map when none). */
    public Map<String, Object> refund(String orderId, String refundId) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT amount, currency, method, gateway_refund_id, "
                + "reference FROM commerce_refund WHERE id = ? AND order_id = ?", refundId, orderId);
        return rows.isEmpty() ? Map.of() : rows.get(0);
    }

    /**
     * The item lines: name, variant, quantity (base units), qty_scale, unit and line total, in line
     * order.
     */
    public List<Map<String, Object>> itemLines(String orderId) {
        return jdbc.queryForList("SELECT name_snapshot, variant_label, quantity, qty_scale, unit, line_total "
                + "FROM commerce_order_line WHERE order_id = ? AND line_type = 'ITEM' ORDER BY line_no", orderId);
    }

    /** The institute's name, or null. */
    public String instituteName(String instituteId) {
        List<String> rows = jdbc.queryForList("SELECT name FROM institutes WHERE id = ?", String.class, instituteId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /** Whether the order's buyer row was anonymised. */
    public boolean customerAnonymised(String customerId) {
        if (customerId == null) {
            return false;
        }
        List<Boolean> rows = jdbc.queryForList("SELECT anonymised_at IS NOT NULL FROM commerce_customer WHERE id = ?",
                Boolean.class, customerId);
        return !rows.isEmpty() && Boolean.TRUE.equals(rows.get(0));
    }

    /** Raises the order's link epoch (every link not yet opened stops working); the new epoch, or null. */
    public Integer revokeLinks(String instituteId, String orderId) {
        List<Integer> rows = jdbc.queryForList("UPDATE commerce_order SET link_epoch = link_epoch + 1 "
                + "WHERE id = ? AND institute_id = ? RETURNING link_epoch", Integer.class, orderId, instituteId);
        return rows.isEmpty() ? null : rows.get(0);
    }
}
