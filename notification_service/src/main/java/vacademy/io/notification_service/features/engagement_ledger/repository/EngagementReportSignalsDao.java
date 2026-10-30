package vacademy.io.notification_service.features.engagement_ledger.repository;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Set-based reads behind the engagement report's per-action signals. Every method takes a whole
 * collection and pages it in IN-lists of {@value #CHUNK}, so a report costs a fixed handful of
 * queries however many actions it covers. Kept apart from NotificationLogRepository, which other
 * features own.
 * <p>
 * notification_log timestamps are naive UTC (see V26), so they are read and bound as LocalDateTime
 * in UTC, independent of the JVM zone.
 */
@Repository
@RequiredArgsConstructor
public class EngagementReportSignalsDao {

    static final int CHUNK = 500;

    private final NamedParameterJdbcTemplate jdbc;

    public record OutgoingRow(String id, String correlationId, String notificationType, String channelId,
                              Instant sentAt, String deliveryStatus, String deliveryErrorCode,
                              boolean sendFailed, String messagePayload, Boolean pricingBillable,
                              String pricingType, String pricingCategory, String pricingModel) {
    }

    public record InboundRow(String channelId, Instant receivedAt) {
    }

    public record TemplateRow(String name, String language, String category) {
    }

    /** Caps every statement of the caller's (read-only) transaction; a no-op outside one. */
    public void applyStatementTimeout() {
        jdbc.getJdbcOperations().execute("SET LOCAL statement_timeout = '8s'");
    }

    /**
     * The latest outgoing WhatsApp/email row per action. The status rows the webhooks write carry
     * the same correlation_id, so the type filter is what keeps them out. sendFailed: a WhatsApp send
     * the provider rejected at send time, which no status webhook will ever report (body format
     * written by WhatsAppService.logWhatsAppMessages).
     */
    public List<OutgoingRow> latestOutgoingByCorrelation(String instituteId, Collection<String> actionIds) {
        String sql = """
                SELECT DISTINCT ON (correlation_id)
                       id, correlation_id, notification_type, channel_id, notification_date,
                       delivery_status, delivery_error_code,
                       (notification_type = 'WHATSAPP_MESSAGE_OUTGOING'
                            AND body LIKE '%| Status: FAILED |%') AS send_failed,
                       message_payload,
                       pricing_billable, pricing_type, pricing_category, pricing_model
                  FROM notification_log
                 WHERE institute_id = :instituteId
                   AND correlation_id IN (:ids)
                   AND notification_type IN ('WHATSAPP_MESSAGE_OUTGOING', 'EMAIL')
                 ORDER BY correlation_id, notification_date DESC NULLS LAST, id
                """;
        List<OutgoingRow> out = new ArrayList<>();
        for (List<String> chunk : chunks(actionIds)) {
            out.addAll(jdbc.query(sql, Map.of("instituteId", instituteId, "ids", chunk), (rs, i) -> new OutgoingRow(
                    rs.getString("id"),
                    rs.getString("correlation_id"),
                    rs.getString("notification_type"),
                    rs.getString("channel_id"),
                    utc(rs, "notification_date"),
                    rs.getString("delivery_status"),
                    rs.getString("delivery_error_code"),
                    rs.getBoolean("send_failed"),
                    rs.getString("message_payload"),
                    rs.getObject("pricing_billable", Boolean.class),
                    rs.getString("pricing_type"),
                    rs.getString("pricing_category"),
                    rs.getString("pricing_model"))));
        }
        return out;
    }

    /**
     * Email row id → the distinct event names recorded against it (DELIVERY, OPEN, CLICK, BOUNCE,
     * COMPLAINT, SEND, ...). EMAIL_EVENT rows point at their email through source (EmailEventService),
     * and their body starts "Email Event: NAME\n"; left(body, 30) is the expression
     * idx_nl_email_event_window carries.
     */
    public Map<String, List<String>> emailEventNamesBySource(Collection<String> emailRowIds) {
        String sql = """
                SELECT DISTINCT source, split_part(left(body, 30), chr(10), 1) AS head
                  FROM notification_log
                 WHERE notification_type = 'EMAIL_EVENT'
                   AND source IN (:ids)
                """;
        Map<String, List<String>> out = new HashMap<>();
        for (List<String> chunk : chunks(emailRowIds)) {
            jdbc.query(sql, Map.of("ids", chunk), rs -> {
                String head = rs.getString("head");
                String name = head != null && head.startsWith("Email Event: ")
                        ? head.substring("Email Event: ".length()).trim() : "";
                out.computeIfAbsent(rs.getString("source"), k -> new ArrayList<>()).add(name);
            });
        }
        return out;
    }

    /** Inbound WhatsApp messages from these phones to the institute in (after, upTo]. */
    public List<InboundRow> inboundWhatsApp(String instituteId, Collection<String> phones,
                                            Instant after, Instant upTo) {
        String sql = """
                SELECT channel_id, notification_date
                  FROM notification_log
                 WHERE institute_id = :instituteId
                   AND notification_type = 'WHATSAPP_MESSAGE_INCOMING'
                   AND channel_id IN (:phones)
                   AND notification_date > :after
                   AND notification_date <= :upTo
                """;
        List<InboundRow> out = new ArrayList<>();
        for (List<String> chunk : chunks(phones)) {
            Map<String, Object> params = Map.of(
                    "instituteId", instituteId,
                    "phones", chunk,
                    "after", LocalDateTime.ofInstant(after, ZoneOffset.UTC),
                    "upTo", LocalDateTime.ofInstant(upTo, ZoneOffset.UTC));
            out.addAll(jdbc.query(sql, params,
                    (rs, i) -> new InboundRow(rs.getString("channel_id"), utc(rs, "notification_date"))));
        }
        return out;
    }

    /** Email row id → when the first inbound reply linked to it arrived (InboundEmailService sets source). */
    public Map<String, Instant> firstInboundEmailBySource(Collection<String> emailRowIds) {
        String sql = """
                SELECT source, MIN(notification_date) AS first_at
                  FROM notification_log
                 WHERE notification_type = 'INBOUND_EMAIL'
                   AND source IN (:ids)
                 GROUP BY source
                """;
        Map<String, Instant> out = new HashMap<>();
        for (List<String> chunk : chunks(emailRowIds)) {
            jdbc.query(sql, Map.of("ids", chunk), rs -> {
                Instant firstAt = utc(rs, "first_at");
                if (firstAt != null) {
                    out.put(rs.getString("source"), firstAt);
                }
            });
        }
        return out;
    }

    /** The institute's WhatsApp templates with these names (any case, any language). */
    public List<TemplateRow> whatsAppTemplates(String instituteId, Collection<String> lowerCaseNames) {
        String sql = """
                SELECT name, language, category
                  FROM notification_template
                 WHERE institute_id = :instituteId
                   AND lower(name) IN (:names)
                   AND COALESCE(channel_type, 'WHATSAPP') = 'WHATSAPP'
                 ORDER BY name, language
                """;
        List<TemplateRow> out = new ArrayList<>();
        for (List<String> chunk : chunks(lowerCaseNames)) {
            out.addAll(jdbc.query(sql, Map.of("instituteId", instituteId, "names", chunk),
                    (rs, i) -> new TemplateRow(rs.getString("name"), rs.getString("language"),
                            rs.getString("category"))));
        }
        return out;
    }

    private static Instant utc(ResultSet rs, String column) throws SQLException {
        LocalDateTime value = rs.getObject(column, LocalDateTime.class);
        return value != null ? value.toInstant(ZoneOffset.UTC) : null;
    }

    private static List<List<String>> chunks(Collection<String> values) {
        List<String> all = new ArrayList<>(values);
        List<List<String>> out = new ArrayList<>();
        for (int i = 0; i < all.size(); i += CHUNK) {
            out.add(all.subList(i, Math.min(i + CHUNK, all.size())));
        }
        return out;
    }
}
