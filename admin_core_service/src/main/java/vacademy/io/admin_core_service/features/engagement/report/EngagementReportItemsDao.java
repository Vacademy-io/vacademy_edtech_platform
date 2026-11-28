package vacademy.io.admin_core_service.features.engagement.report;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * Reads for the daily report's item lists ({@link EngagementReportItemsSql}). Plain reads, no
 * transaction of their own: the service runs them in its read-only transaction with a statement
 * timeout, as the report does.
 */
@Repository
public class EngagementReportItemsDao {

    private final NamedParameterJdbcTemplate jdbc;

    public EngagementReportItemsDao(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * One item as read: the person's contact from both sources (st* = student row, lead* = lead
     * row, inv* = a booking's invitee), and the kind's own columns (null for the other kinds).
     */
    record ItemRow(String itemKey, String engineId, String engineName, String userId, String audienceResponseId,
                   String stName, String stPhone, String stEmail,
                   String leadName, String leadPhone, String leadEmail,
                   String invName, String invPhone, String invEmail,
                   String listKind, String listId, String listName, Boolean isNew,
                   LocalDateTime leadCreatedAt, LocalDateTime joinedAt,
                   String bookingId, LocalDateTime bookedAt, LocalDateTime scheduledStart, String bookingStatus,
                   String outcome, String hostUserId,
                   String fromStatus, String toStatus, String source, String changedByUserId,
                   LocalDateTime changedAt, String actor) {
    }

    /**
     * @param items  the kind's CTE with its filter filled in
     * @param search the search condition, "TRUE" for none
     */
    long count(String items, String search, MapSqlParameterSource p) {
        Long n = jdbc.queryForObject(items + EngagementReportItemsSql.COUNT.formatted(search), p, Long.class);
        return n == null ? 0 : n;
    }

    /** {@code p} carries :limit and :offset. */
    List<ItemRow> page(String items, String search, String orderBy, MapSqlParameterSource p) {
        return jdbc.queryForList(items + EngagementReportItemsSql.PAGE.formatted(search, orderBy), p).stream()
                .map(EngagementReportItemsDao::row)
                .toList();
    }

    /** TEMPLATES_CREATED rows matching {@code where} (the filter AND the search). */
    long templateCount(String where, MapSqlParameterSource p) {
        Long n = jdbc.queryForObject(EngagementReportItemsSql.TEMPLATES_COUNT.formatted(where), p, Long.class);
        return n == null ? 0 : n;
    }

    /** One page of TEMPLATES_CREATED rows, newest first; {@code p} carries :limit and :offset. */
    List<Map<String, Object>> templatePage(String where, MapSqlParameterSource p) {
        return jdbc.queryForList(EngagementReportItemsSql.TEMPLATES_PAGE.formatted(where), p);
    }

    /** The institute's CONVERTED status label; null when it has none. */
    String convertedLabel(String instituteId) {
        List<String> labels = jdbc.queryForList(EngagementReportItemsSql.CONVERTED_LABEL,
                new MapSqlParameterSource("instituteId", instituteId), String.class);
        return labels.isEmpty() ? null : labels.get(0);
    }

    private static ItemRow row(Map<String, Object> r) {
        Object isNew = r.get("is_new");
        return new ItemRow(str(r, "item_key"), str(r, "engine_id"), str(r, "engine_name"), str(r, "user_id"),
                str(r, "audience_response_id"),
                str(r, "st_name"), str(r, "st_phone"), str(r, "st_email"),
                str(r, "lead_name"), str(r, "lead_phone"), str(r, "lead_email"),
                str(r, "inv_name"), str(r, "inv_phone"), str(r, "inv_email"),
                str(r, "list_kind"), str(r, "list_id"), str(r, "list_name"),
                isNew instanceof Boolean b ? b : null,
                ts(r, "lead_created_at"), ts(r, "joined_at"),
                str(r, "booking_id"), ts(r, "booked_at"), ts(r, "scheduled_start"), str(r, "booking_status"),
                str(r, "outcome"), str(r, "host_user_id"),
                str(r, "from_status"), str(r, "to_status"), str(r, "source"), str(r, "changed_by_user_id"),
                ts(r, "changed_at"), str(r, "actor"));
    }

    private static String str(Map<String, Object> r, String col) {
        Object v = r.get(col);
        return v == null ? null : v.toString();
    }

    private static LocalDateTime ts(Map<String, Object> r, String col) {
        Object v = r.get(col);
        if (v instanceof Timestamp t) return t.toLocalDateTime();
        if (v instanceof LocalDateTime l) return l;
        return null;
    }
}
