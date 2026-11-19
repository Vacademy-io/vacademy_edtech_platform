package vacademy.io.admin_core_service.features.commerce.report.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Set;
import java.util.function.Consumer;

/**
 * The commerce audit list (contract 6.4): {@code commerce_audit} rows and {@code commerce_approval}
 * rows (PIN approvals), newest first by keyset {@code (created_at, id)}. Runs inside the caller's
 * read-only transaction (replica); same SQL rules as {@link ReportReadRepository}.
 *
 * <p>A reference is labelled with the document number when the row names an order, invoice, credit
 * note, return, transfer, count, refund or shipment. An approval has no location of its own: it is
 * placed through its reference (order, invoice, return, counter session, transfer, count).
 */
@Repository
public class AuditReadRepository {

    /** The filter of the audit list. {@code locationIn}: null = no restriction (rows without a location too). */
    public record AuditFilter(String instituteId, LocalDateTime storedFrom, LocalDateTime storedTo,
                              String actorUserId, String kind, Set<String> locationIn,
                              Collection<String> referenceIds) {
    }

    /** The last row of the previous page: its stored {@code created_at} and id. */
    public record AuditKeyset(LocalDateTime createdAt, String id) {
    }

    /** One audit row. {@code createdAtRaw} is the stored (UTC wall) time with microseconds, for the cursor. */
    public record AuditRow(String id, LocalDateTime createdAt, String createdAtRaw, String actorUserId,
                           String locationId, String locationName, String kind, String referenceType,
                           String referenceId, String referenceLabel, String oldValueJson, String newValueJson,
                           String reason) {
    }

    /** One PIN approval. */
    public record ApprovalRow(String id, LocalDateTime createdAt, String createdAtRaw, String action,
                              String referenceType, String referenceId, String referenceLabel, String requestedBy,
                              String approvedBy, BigDecimal amount, String reason, String locationId,
                              String locationName) {
    }

    /** The document number of a reference (null when the type has no number). */
    static String label(String alias) {
        String ref = alias + ".reference_id";
        return " CASE " + alias + ".reference_type"
                + " WHEN 'ORDER' THEN (SELECT o.order_number FROM commerce_order o WHERE o.id = " + ref + ")"
                + " WHEN 'INVOICE' THEN (SELECT COALESCE(i.invoice_number, i.external_invoice_number)"
                + " FROM invoice i WHERE i.id = " + ref + ")"
                + " WHEN 'CREDIT_NOTE' THEN (SELECT n.credit_note_number FROM commerce_credit_note n"
                + " WHERE n.id = " + ref + ")"
                + " WHEN 'RETURN' THEN (SELECT r.return_number FROM commerce_return r WHERE r.id = " + ref + ")"
                + " WHEN 'STOCK_TRANSFER' THEN (SELECT COALESCE(t.document_number, t.transfer_number)"
                + " FROM stock_transfer t WHERE t.id = " + ref + ")"
                + " WHEN 'STOCK_COUNT' THEN (SELECT c.count_number FROM stock_count c WHERE c.id = " + ref + ")"
                + " WHEN 'REFUND' THEN (SELECT o.order_number FROM commerce_refund f"
                + " JOIN commerce_order o ON o.id = f.order_id WHERE f.id = " + ref + ")"
                + " WHEN 'SHIPMENT' THEN (SELECT o.order_number FROM commerce_shipment s"
                + " JOIN commerce_order o ON o.id = s.order_id WHERE s.id = " + ref + ")"
                + " WHEN 'POS_SESSION' THEN (SELECT r.code FROM pos_session ps"
                + " JOIN pos_register r ON r.id = ps.register_id WHERE ps.id = " + ref + ")"
                + " WHEN 'REPORT' THEN " + ref
                + " END ";
    }

    /** The location an approval happened at, through its reference. */
    static final String APPROVAL_LOCATION = """
            CASE ap.reference_type
                WHEN 'ORDER' THEN (SELECT o.fulfilment_location_id FROM commerce_order o WHERE o.id = ap.reference_id)
                WHEN 'INVOICE' THEN (SELECT i.location_id FROM invoice i WHERE i.id = ap.reference_id)
                WHEN 'RETURN' THEN (SELECT r.location_id FROM commerce_return r WHERE r.id = ap.reference_id)
                WHEN 'POS_SESSION' THEN (SELECT ps.location_id FROM pos_session ps WHERE ps.id = ap.reference_id)
                WHEN 'STOCK_TRANSFER' THEN (SELECT t.to_location_id FROM stock_transfer t WHERE t.id = ap.reference_id)
                WHEN 'STOCK_COUNT' THEN (SELECT c.location_id FROM stock_count c WHERE c.id = ap.reference_id)
            END""";

    private final NamedParameterJdbcTemplate jdbc;

    public AuditReadRepository(NamedParameterJdbcTemplate jdbc) {
        JdbcTemplate streaming = new JdbcTemplate(jdbc.getJdbcTemplate().getDataSource());
        streaming.setFetchSize(1000);
        this.jdbc = new NamedParameterJdbcTemplate(streaming);
    }

    /** Audit rows of the filter, newest first, after the keyset; at most {@code limit} (null: all). */
    public void audit(AuditFilter f, AuditKeyset after, Integer limit, Consumer<AuditRow> sink) {
        MapSqlParameterSource p = params(f);
        String sql = """
                SELECT a.id,
                       a.created_at,
                       to_char(a.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') AS created_raw,
                       a.actor_user_id,
                       a.location_id,
                       sl.name AS location_name,
                       a.kind,
                       a.reference_type,
                       a.reference_id,
                       """ + label("a") + """
                 AS reference_label,
                       CAST(a.old_value_json AS TEXT) AS old_value,
                       CAST(a.new_value_json AS TEXT) AS new_value,
                       a.reason
                FROM commerce_audit a
                LEFT JOIN stock_location sl ON sl.id = a.location_id
                WHERE a.institute_id = :instituteId
                  AND a.created_at >= :storedFrom
                  AND a.created_at < :storedTo"""
                + filters(f, p, "a")
                + location(f, p, "a.location_id")
                + keyset(after, p, "a")
                + """

                ORDER BY a.created_at DESC, a.id DESC"""
                + limit(limit, p);
        jdbc.query(sql, p, (RowCallbackHandler) rs -> sink.accept(new AuditRow(
                rs.getString("id"),
                time(rs, "created_at"),
                rs.getString("created_raw"),
                rs.getString("actor_user_id"),
                rs.getString("location_id"),
                rs.getString("location_name"),
                rs.getString("kind"),
                rs.getString("reference_type"),
                rs.getString("reference_id"),
                rs.getString("reference_label"),
                rs.getString("old_value"),
                rs.getString("new_value"),
                rs.getString("reason"))));
    }

    /** PIN approvals of the range, newest first, after the keyset; location filter through the reference. */
    public void approvals(AuditFilter f, AuditKeyset after, Integer limit, Consumer<ApprovalRow> sink) {
        MapSqlParameterSource p = params(f);
        String inner = """
                SELECT ap.id,
                       ap.created_at,
                       to_char(ap.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') AS created_raw,
                       ap.action,
                       ap.reference_type,
                       ap.reference_id,
                       """ + label("ap") + """
                 AS reference_label,
                       ap.requested_by,
                       ap.approved_by,
                       ap.amount,
                       ap.reason,
                       """ + " " + APPROVAL_LOCATION + " " + """
                 AS location_id
                FROM commerce_approval ap
                WHERE ap.institute_id = :instituteId
                  AND ap.created_at >= :storedFrom
                  AND ap.created_at < :storedTo"""
                + references(f, p, "ap")
                + keyset(after, p, "ap");
        String sql = "SELECT x.*, sl.name AS location_name FROM (\n" + inner + """

                ) x
                LEFT JOIN stock_location sl ON sl.id = x.location_id
                WHERE TRUE"""
                + location(f, p, "x.location_id")
                + """

                ORDER BY x.created_at DESC, x.id DESC"""
                + limit(limit, p);
        jdbc.query(sql, p, (RowCallbackHandler) rs -> sink.accept(new ApprovalRow(
                rs.getString("id"),
                time(rs, "created_at"),
                rs.getString("created_raw"),
                rs.getString("action"),
                rs.getString("reference_type"),
                rs.getString("reference_id"),
                rs.getString("reference_label"),
                rs.getString("requested_by"),
                rs.getString("approved_by"),
                rs.getBigDecimal("amount"),
                rs.getString("reason"),
                rs.getString("location_id"),
                rs.getString("location_name"))));
    }

    /** The distinct kinds of the institute, for the filter list. */
    public List<String> kinds(String instituteId) {
        return jdbc.queryForList("""
                SELECT k FROM (
                    SELECT DISTINCT a.kind AS k FROM commerce_audit a
                    WHERE a.institute_id = :instituteId
                ) x
                ORDER BY k
                LIMIT 200""", new MapSqlParameterSource("instituteId", instituteId), String.class);
    }

    /** The staff the filtered audit rows name (for names read outside the transaction). */
    public List<String> actors(AuditFilter f) {
        MapSqlParameterSource p = params(f);
        String sql = """
                SELECT DISTINCT a.actor_user_id FROM commerce_audit a
                WHERE a.institute_id = :instituteId
                  AND a.created_at >= :storedFrom
                  AND a.created_at < :storedTo
                  AND a.actor_user_id IS NOT NULL"""
                + filters(f, p, "a")
                + location(f, p, "a.location_id")
                + """

                LIMIT 1000""";
        return jdbc.queryForList(sql, p, String.class);
    }

    /**
     * The ids a document number stands for: invoices (system or paper number), credit notes,
     * orders, returns and transfers with that number; then everything of the orders they belong to
     * (the order, its invoices, credit notes, returns, shipments and refunds), so a search for a
     * bill number finds its void and its cancel rows. At most 1,000 ids.
     */
    public List<String> referenceIds(String instituteId, String number) {
        MapSqlParameterSource p = new MapSqlParameterSource("instituteId", instituteId).addValue("number", number);
        return jdbc.queryForList("""
                WITH hit AS (
                    SELECT i.id, i.commerce_order_id AS order_id FROM invoice i
                    WHERE i.institute_id = :instituteId
                      AND i.document_type IS NOT NULL
                      AND (i.invoice_number = :number OR i.external_invoice_number = :number)
                    UNION ALL
                    SELECT n.id, COALESCE(n.commerce_order_id, (SELECT i2.commerce_order_id FROM invoice i2
                                                                 WHERE i2.id = n.invoice_id))
                    FROM commerce_credit_note n
                    WHERE n.institute_id = :instituteId
                      AND n.credit_note_number = :number
                    UNION ALL
                    SELECT o.id, o.id FROM commerce_order o
                    WHERE o.institute_id = :instituteId
                      AND o.order_number = :number
                    UNION ALL
                    SELECT r.id, r.order_id FROM commerce_return r
                    WHERE r.institute_id = :instituteId
                      AND r.return_number = :number
                    UNION ALL
                    SELECT t.id, NULL FROM stock_transfer t
                    WHERE t.institute_id = :instituteId
                      AND (t.transfer_number = :number OR t.document_number = :number)
                ),
                orders AS (
                    SELECT DISTINCT order_id FROM hit WHERE order_id IS NOT NULL
                )
                SELECT id FROM hit
                UNION
                SELECT order_id FROM orders
                UNION
                SELECT i.id FROM invoice i
                WHERE i.institute_id = :instituteId AND i.commerce_order_id IN (SELECT order_id FROM orders)
                UNION
                SELECT n.id FROM commerce_credit_note n
                WHERE n.institute_id = :instituteId AND n.commerce_order_id IN (SELECT order_id FROM orders)
                UNION
                SELECT r.id FROM commerce_return r
                WHERE r.institute_id = :instituteId AND r.order_id IN (SELECT order_id FROM orders)
                UNION
                SELECT s.id FROM commerce_shipment s
                WHERE s.institute_id = :instituteId AND s.order_id IN (SELECT order_id FROM orders)
                UNION
                SELECT f.id FROM commerce_refund f
                WHERE f.institute_id = :instituteId AND f.order_id IN (SELECT order_id FROM orders)
                LIMIT 1000""", p, String.class);
    }

    // ------------------------------------------------------------------ fragments

    private static MapSqlParameterSource params(AuditFilter f) {
        return new MapSqlParameterSource()
                .addValue("instituteId", f.instituteId())
                .addValue("storedFrom", Timestamp.valueOf(f.storedFrom()))
                .addValue("storedTo", Timestamp.valueOf(f.storedTo()));
    }

    private static String filters(AuditFilter f, MapSqlParameterSource p, String alias) {
        StringBuilder sql = new StringBuilder();
        if (f.actorUserId() != null) {
            p.addValue("actorUserId", f.actorUserId());
            sql.append("\n  AND ").append(alias).append(".actor_user_id = :actorUserId");
        }
        if (f.kind() != null) {
            p.addValue("kind", f.kind());
            sql.append("\n  AND ").append(alias).append(".kind = :kind");
        }
        sql.append(references(f, p, alias));
        return sql.toString();
    }

    private static String references(AuditFilter f, MapSqlParameterSource p, String alias) {
        if (f.referenceIds() == null) {
            return "";
        }
        if (f.referenceIds().isEmpty()) {
            return "\n  AND FALSE";
        }
        p.addValue("referenceIds", new ArrayList<>(f.referenceIds()));
        return "\n  AND " + alias + ".reference_id IN (:referenceIds)";
    }

    private static String location(AuditFilter f, MapSqlParameterSource p, String column) {
        if (f.locationIn() == null) {
            return "";
        }
        if (f.locationIn().isEmpty()) {
            return "\n  AND FALSE";
        }
        p.addValue("locationIds", new ArrayList<>(f.locationIn()));
        return "\n  AND " + column + " IN (:locationIds)";
    }

    private static String keyset(AuditKeyset after, MapSqlParameterSource p, String alias) {
        if (after == null) {
            return "";
        }
        p.addValue("cursorAt", Timestamp.valueOf(after.createdAt()));
        p.addValue("cursorId", after.id());
        return "\n  AND (" + alias + ".created_at, " + alias + ".id) < (:cursorAt, :cursorId)";
    }

    private static String limit(Integer limit, MapSqlParameterSource p) {
        if (limit == null) {
            return "";
        }
        p.addValue("pageLimit", limit);
        return "\nLIMIT :pageLimit";
    }

    private static LocalDateTime time(ResultSet rs, String column) throws SQLException {
        Timestamp value = rs.getTimestamp(column);
        return value == null ? null : value.toLocalDateTime();
    }
}
