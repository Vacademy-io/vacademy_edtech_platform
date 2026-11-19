package vacademy.io.admin_core_service.features.commerce.report.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.ActiveProduct;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.CodOrderRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.DocumentRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.DueRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.DueTotals;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.Location;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.Membership;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.MoneyRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.PaidNotInvoicedRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.ProductLine;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.RemittanceRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.RtoRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.SalesDocument;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.SessionRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.DocFilter;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.Keyset;

import java.math.BigDecimal;
import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.function.Consumer;

/**
 * The native SQL of the money, counter and sales reports (day book, payment modes, COD
 * outstanding, customer dues, POS sessions, sales, products). Same rules as
 * {@link ReportReadRepository}: every query runs inside the caller's read-only transaction
 * (replica, statement timeout), filters {@code institute_id = :instituteId} first, reads only
 * commerce documents ({@code document_type IS NOT NULL}), turns a timestamp into an India date or
 * time only through {@code AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'}, never calls
 * {@code now()} or {@code CURRENT_DATE}, and streams large reads with fetch size 1,000.
 *
 * <p>Timestamp bounds are the stored (UTC wall) starts of India days, computed in Java
 * ({@code StockClock.storedStartOf}). Fragments begin with a newline, so no keyword is glued to
 * the token before it.
 */
@Repository
public class MoneyReportRepository {

    /*
     * Every expression spliced between text blocks is padded with a space on both sides: a text
     * block drops the indentation of its first line, so "...::date" + "AS x" would otherwise glue.
     */

    /** India date of a stored (UTC wall) timestamp. */
    static String indiaDay(String column) {
        return " (" + column + " AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date ";
    }

    /** India time text {@code yyyy-MM-dd HH:mm} of a stored timestamp. */
    static String indiaTime(String column) {
        return " to_char((" + column + " AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD HH24:MI') ";
    }

    /** True for a delivery or COD-charge invoice line. */
    static final String SERVICE = " " + ReportReadRepository.SERVICE_FLAG + " ";

    /** The scale of an invoice line (order line, else invoice snapshot). */
    static final String SCALE = " " + ReportReadRepository.SCALE + " ";

    private final NamedParameterJdbcTemplate jdbc;

    public MoneyReportRepository(NamedParameterJdbcTemplate jdbc) {
        JdbcTemplate streaming = new JdbcTemplate(jdbc.getJdbcTemplate().getDataSource());
        streaming.setFetchSize(1000);
        this.jdbc = new NamedParameterJdbcTemplate(streaming);
    }

    // ================================================================== shared

    /** Every location of the institute (id, code, name), for labels. */
    public List<Location> locations(String instituteId) {
        return jdbc.query("""
                SELECT id, code, name FROM stock_location
                WHERE institute_id = :instituteId
                ORDER BY code""", new MapSqlParameterSource("instituteId", instituteId),
                (rs, i) -> new Location(rs.getString("id"), rs.getString("code"), rs.getString("name")));
    }

    // ================================================================== day book and payment modes

    /**
     * The money events of the range, oldest first: RECEIVED tenders (by the India day of
     * {@code received_at}; a COD tender turns RECEIVED at its remittance with {@code received_at}
     * at the India midnight of {@code received_on}), PROCESSED refunds (by {@code paid_on}, else the
     * India day of {@code processed_at}) and counter cash in and out (by {@code document_date},
     * else the India day of {@code created_at}). PENDING and VOID tenders, and CREDIT tenders, are
     * not money and never read. Location: the counter session's, else the order's fulfilment
     * location.
     */
    public void moneyRows(DocFilter f, LocalDateTime storedFrom, LocalDateTime storedTo, Consumer<MoneyRow> sink) {
        MapSqlParameterSource p = range(f, storedFrom, storedTo);
        String sql = """
                SELECT m.* FROM (
                    SELECT 'TENDER' AS source,
                           CASE WHEN t.mode = 'COD' THEN 'COD_COLLECTED'
                                WHEN t.mode = 'CREDIT_NOTE' THEN 'CREDIT_NOTE_USED'
                                WHEN o.channel = 'ADMIN' AND t.created_at > o.created_at THEN 'RECEIPT_ON_CREDIT'
                                ELSE 'SALE_PAYMENT' END AS kind,
                           t.id,
                           COALESCE(r.received_on,\s""" + indiaDay("t.received_at") + """
                ) AS day,
                           """ + indiaTime("t.received_at") + """
                 AS time_text,
                           r.received_on AS typed_day,
                           t.mode,
                           t.amount,
                           o.order_number AS number,
                           o.customer_name AS party,
                           t.recorded_by AS staff_id,
                           COALESCE(ps.location_id, o.fulfilment_location_id) AS location_id,
                           COALESCE(r.reference, t.reference) AS reference
                    FROM commerce_order_tender t
                    JOIN commerce_order o ON o.id = t.order_id
                    LEFT JOIN pos_session ps ON ps.id = t.pos_session_id
                    LEFT JOIN commerce_cod_remittance r ON t.mode = 'COD' AND r.id = o.cod_remittance_id
                    WHERE t.institute_id = :instituteId
                      AND t.status = 'RECEIVED'
                      AND t.mode <> 'CREDIT'
                      AND t.received_at >= :storedFrom
                      AND t.received_at < :storedTo
                    UNION ALL
                    SELECT 'REFUND' AS source,
                           CASE WHEN f.method = 'EXCHANGE_CREDIT' THEN 'EXCHANGE_CREDIT' ELSE 'REFUND_PAID' END,
                           f.id,
                           COALESCE(f.paid_on,\s""" + indiaDay("f.processed_at") + """
                ),
                           """ + indiaTime("f.processed_at") + """
                ,
                           f.paid_on,
                           f.method,
                           f.amount,
                           o.order_number,
                           o.customer_name,
                           COALESCE(f.processed_by, f.created_by),
                           COALESCE(ps.location_id, o.fulfilment_location_id),
                           f.reference
                    FROM commerce_refund f
                    JOIN commerce_order o ON o.id = f.order_id
                    LEFT JOIN pos_session ps ON ps.id = f.pos_session_id
                    WHERE f.institute_id = :instituteId
                      AND f.status = 'PROCESSED'
                      AND ((f.paid_on IS NOT NULL AND f.paid_on >= :from AND f.paid_on <= :to)
                           OR (f.paid_on IS NULL AND f.processed_at >= :storedFrom AND f.processed_at < :storedTo))
                    UNION ALL
                    SELECT 'CASH_MOVEMENT' AS source,
                           c.type,
                           c.id,
                           COALESCE(c.document_date,\s""" + indiaDay("c.created_at") + """
                ),
                           """ + indiaTime("c.created_at") + """
                ,
                           c.document_date,
                           'CASH',
                           c.amount,
                           NULL,
                           c.reason,
                           c.actor_user_id,
                           ps.location_id,
                           NULL
                    FROM pos_cash_movement c
                    JOIN pos_session ps ON ps.id = c.session_id
                    WHERE c.institute_id = :instituteId
                      AND ((c.document_date IS NOT NULL AND c.document_date >= :from AND c.document_date <= :to)
                           OR (c.document_date IS NULL AND c.created_at >= :storedFrom AND c.created_at < :storedTo))
                ) m
                WHERE m.day >= :from
                  AND m.day <= :to"""
                + ReportReadRepository.location(f, p, "m.location_id")
                + """

                ORDER BY m.day, m.time_text, m.source, m.id""";
        jdbc.query(sql, p, (RowCallbackHandler) rs -> sink.accept(new MoneyRow(
                rs.getString("source"),
                rs.getString("kind"),
                rs.getString("id"),
                date(rs, "day"),
                rs.getString("time_text"),
                date(rs, "typed_day"),
                rs.getString("mode"),
                money(rs, "amount"),
                rs.getString("number"),
                rs.getString("party"),
                rs.getString("staff_id"),
                rs.getString("location_id"),
                rs.getString("reference"))));
    }

    /** The day book's documents: invoices (live or cancelled) and credit notes, by their India {@code document_date}. */
    public void documentRows(DocFilter f, Consumer<DocumentRow> sink) {
        MapSqlParameterSource p = base(f);
        String sql = """
                SELECT d.* FROM (
                    SELECT 'INVOICE' AS kind,
                           i.id,
                           i.document_date AS day,
                           """ + indiaTime("i.created_at") + """
                 AS time_text,
                           """ + indiaDay("i.created_at") + """
                 AS entered_on,
                           i.invoice_number AS number,
                           i.external_invoice_number AS paper_number,
                           i.document_type,
                           i.total_amount AS value,
                           (i.cancelled_at IS NOT NULL) AS cancelled,
                           o.customer_name AS party,
                           o.order_number,
                           CASE WHEN o.channel IN ('POS', 'ADMIN') THEN o.created_by END AS staff_id,
                           i.location_id
                    FROM invoice i
                    LEFT JOIN commerce_order o ON o.id = i.commerce_order_id
                    WHERE i.institute_id = :instituteId
                      AND i.document_type IS NOT NULL
                      AND i.document_date >= :from
                      AND i.document_date <= :to"""
                + ReportReadRepository.location(f, p, "i.location_id")
                + """

                    UNION ALL
                    SELECT 'CREDIT_NOTE' AS kind,
                           n.id,
                           n.document_date,
                           """ + indiaTime("n.created_at") + """
                ,
                           """ + indiaDay("n.created_at") + """
                ,
                           n.credit_note_number,
                           NULL,
                           'CREDIT_NOTE',
                           n.total,
                           FALSE,
                           o.customer_name,
                           o.order_number,
                           n.created_by,
                           i.location_id
                    FROM commerce_credit_note n
                    JOIN invoice i ON i.id = n.invoice_id
                    LEFT JOIN commerce_order o ON o.id = i.commerce_order_id
                    WHERE n.institute_id = :instituteId
                      AND n.document_date >= :from
                      AND n.document_date <= :to"""
                + ReportReadRepository.location(f, p, "i.location_id")
                + """

                ) d
                ORDER BY d.day, d.time_text, d.number, d.id""";
        jdbc.query(sql, p, (RowCallbackHandler) rs -> sink.accept(new DocumentRow(
                rs.getString("kind"),
                rs.getString("id"),
                date(rs, "day"),
                rs.getString("time_text"),
                date(rs, "entered_on"),
                rs.getString("number"),
                rs.getString("paper_number"),
                rs.getString("document_type"),
                money(rs, "value"),
                rs.getBoolean("cancelled"),
                rs.getString("party"),
                rs.getString("order_number"),
                rs.getString("staff_id"),
                rs.getString("location_id"))));
    }

    /**
     * Counter sessions that were open at some time in the range (opened before its end, not closed
     * before its start), with the stored close figures and, for a session still open, the cash
     * expected so far (opening + cash received + cash in − cash out − cash refunds paid, the
     * counter's own rule).
     */
    public void footerSessions(DocFilter f, LocalDateTime storedFrom, LocalDateTime storedTo,
                               Consumer<SessionRow> sink) {
        MapSqlParameterSource p = range(f, storedFrom, storedTo);
        String sql = SESSION_SELECT + """

                WHERE s.institute_id = :instituteId
                  AND s.opened_at < :storedTo
                  AND (s.closed_at IS NULL OR s.closed_at >= :storedFrom)"""
                + ReportReadRepository.location(f, p, "s.location_id")
                + """

                ORDER BY s.opened_at, s.id""";
        jdbc.query(sql, p, (RowCallbackHandler) rs -> sink.accept(sessionRow(rs)));
    }

    /** Sessions opened in the range (India days), oldest first; the stored Z-report as JSON text. */
    public void sessionsOpenedIn(DocFilter f, LocalDateTime storedFrom, LocalDateTime storedTo,
                                 Consumer<SessionRow> sink) {
        MapSqlParameterSource p = range(f, storedFrom, storedTo);
        String sql = SESSION_SELECT + """

                WHERE s.institute_id = :instituteId
                  AND s.opened_at >= :storedFrom
                  AND s.opened_at < :storedTo"""
                + ReportReadRepository.location(f, p, "s.location_id")
                + """

                ORDER BY s.opened_at, s.id""";
        jdbc.query(sql, p, (RowCallbackHandler) rs -> sink.accept(sessionRow(rs)));
    }

    private static final String SESSION_SELECT = """
            SELECT s.id,
                   s.status,
                   """ + indiaDay("s.opened_at") + """
             AS opened_day,
                   """ + indiaTime("s.opened_at") + """
             AS opened_text,
                   to_char(s.opened_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') AS opened_raw,
                   """ + indiaTime("s.closed_at") + """
             AS closed_text,
                   r.code AS register_code,
                   r.name AS register_name,
                   s.location_id,
                   s.cashier_user_id,
                   s.opening_cash,
                   s.expected_cash,
                   s.counted_cash,
                   s.variance,
                   CASE WHEN s.status = 'OPEN' THEN s.opening_cash
                        + COALESCE((SELECT SUM(t.amount) FROM commerce_order_tender t
                                    WHERE t.pos_session_id = s.id AND t.status = 'RECEIVED' AND t.mode = 'CASH'), 0)
                        + COALESCE((SELECT SUM(CASE WHEN c.type = 'CASH_IN' THEN c.amount ELSE -c.amount END)
                                    FROM pos_cash_movement c WHERE c.session_id = s.id), 0)
                        - COALESCE((SELECT SUM(rf.amount) FROM commerce_refund rf
                                    WHERE rf.pos_session_id = s.id AND rf.status = 'PROCESSED'
                                      AND rf.method = 'CASH'), 0)
                   END AS expected_so_far,
                   s.close_note,
                   CAST(s.z_report_json AS TEXT) AS z_report
            FROM pos_session s
            JOIN pos_register r ON r.id = s.register_id""";

    /** Σ total of the live invoices of the POS orders of these sessions. */
    public BigDecimal liveInvoicesOfSessions(String instituteId, List<String> sessionIds) {
        if (sessionIds.isEmpty()) {
            return BigDecimal.ZERO;
        }
        MapSqlParameterSource p = new MapSqlParameterSource("instituteId", instituteId)
                .addValue("sessionIds", sessionIds);
        BigDecimal sum = jdbc.queryForObject("""
                SELECT COALESCE(SUM(i.total_amount), 0)
                FROM invoice i
                JOIN commerce_order o ON o.id = i.commerce_order_id
                WHERE i.institute_id = :instituteId
                  AND i.document_type IS NOT NULL
                  AND i.cancelled_at IS NULL
                  AND o.institute_id = :instituteId
                  AND o.pos_session_id IN (:sessionIds)""", p, BigDecimal.class);
        return sum == null ? BigDecimal.ZERO : sum;
    }

    /**
     * Orders with money received in the range (RECEIVED tenders other than a credit note) and no
     * live invoice dated on or before the range end: paid, not yet invoiced.
     */
    public void paidNotInvoiced(DocFilter f, LocalDateTime storedFrom, LocalDateTime storedTo,
                                Consumer<PaidNotInvoicedRow> sink) {
        MapSqlParameterSource p = range(f, storedFrom, storedTo);
        String sql = """
                SELECT x.order_id, x.order_number, x.order_date, x.channel, x.status, x.customer_name,
                       x.location_id, SUM(x.amount) AS received
                FROM (
                    SELECT o.id AS order_id,
                           o.order_number,
                           """ + indiaDay("o.created_at") + """
                 AS order_date,
                           o.channel,
                           o.status,
                           o.customer_name,
                           COALESCE(ps.location_id, o.fulfilment_location_id) AS location_id,
                           t.amount
                    FROM commerce_order_tender t
                    JOIN commerce_order o ON o.id = t.order_id
                    LEFT JOIN pos_session ps ON ps.id = t.pos_session_id
                    WHERE t.institute_id = :instituteId
                      AND t.status = 'RECEIVED'
                      AND t.mode NOT IN ('CREDIT', 'CREDIT_NOTE')
                      AND t.received_at >= :storedFrom
                      AND t.received_at < :storedTo
                      AND NOT EXISTS (
                          SELECT 1 FROM invoice i
                          WHERE i.institute_id = :instituteId
                            AND i.commerce_order_id = o.id
                            AND i.document_type IS NOT NULL
                            AND i.cancelled_at IS NULL
                            AND i.document_date <= :to)
                ) x
                WHERE TRUE"""
                + ReportReadRepository.location(f, p, "x.location_id")
                + """

                GROUP BY x.order_id, x.order_number, x.order_date, x.channel, x.status, x.customer_name, x.location_id
                ORDER BY x.order_date, x.order_number, x.order_id""";
        jdbc.query(sql, p, (RowCallbackHandler) rs -> sink.accept(new PaidNotInvoicedRow(
                rs.getString("order_id"),
                rs.getString("order_number"),
                date(rs, "order_date"),
                rs.getString("channel"),
                rs.getString("status"),
                rs.getString("customer_name"),
                rs.getString("location_id"),
                money(rs, "received"))));
    }

    // ================================================================== COD

    private static final String COD_SELECT = """
            SELECT o.id AS order_id,
                   o.order_number,
                   """ + indiaDay("o.created_at") + """
             AS order_date,
                   o.customer_name,
                   o.customer_phone,
                   s.carrier_name,
                   s.tracking_number,
                   """ + indiaDay("o.shipped_at") + """
             AS shipped_on,
                   """ + indiaDay("o.delivered_at") + """
             AS delivered_on,
                   COALESCE(o.cod_amount, o.total) AS cod_amount,
                   o.fulfilment_location_id AS location_id
            FROM commerce_order o
            LEFT JOIN commerce_shipment s ON s.order_id = o.id AND s.status <> 'CANCELLED'""";

    /**
     * Cash-on-delivery orders outstanding as of a day: delivered before the end of that India day
     * and with no remittance received on or before it. Oldest delivery first.
     */
    public void codOutstanding(DocFilter f, LocalDate asOf, LocalDateTime asOfEnd, Consumer<CodOrderRow> sink) {
        MapSqlParameterSource p = new MapSqlParameterSource("instituteId", f.instituteId())
                .addValue("asOf", Date.valueOf(asOf))
                .addValue("asOfEnd", Timestamp.valueOf(asOfEnd));
        String sql = COD_SELECT + """

                WHERE o.institute_id = :instituteId
                  AND o.payment_method = 'COD'
                  AND o.status NOT IN ('CANCELLED', 'RTO')
                  AND o.delivered_at IS NOT NULL
                  AND o.delivered_at < :asOfEnd
                  AND NOT EXISTS (
                      SELECT 1 FROM commerce_cod_remittance r
                      WHERE r.id = o.cod_remittance_id
                        AND r.received_on <= :asOf)"""
                + ReportReadRepository.location(f, p, "o.fulfilment_location_id")
                + """

                ORDER BY o.delivered_at, o.order_number, o.id""";
        jdbc.query(sql, p, (RowCallbackHandler) rs -> sink.accept(codRow(rs)));
    }

    /** Cash-on-delivery orders in transit as of a day: shipped before its end, not delivered nor returned by then. */
    public void codInTransit(DocFilter f, LocalDateTime asOfEnd, Consumer<CodOrderRow> sink) {
        MapSqlParameterSource p = new MapSqlParameterSource("instituteId", f.instituteId())
                .addValue("asOfEnd", Timestamp.valueOf(asOfEnd));
        String sql = COD_SELECT + """

                WHERE o.institute_id = :instituteId
                  AND o.payment_method = 'COD'
                  AND o.status <> 'CANCELLED'
                  AND o.shipped_at IS NOT NULL
                  AND o.shipped_at < :asOfEnd
                  AND (o.delivered_at IS NULL OR o.delivered_at >= :asOfEnd)
                  AND (s.rto_at IS NULL OR s.rto_at >= :asOfEnd)"""
                + ReportReadRepository.location(f, p, "o.fulfilment_location_id")
                + """

                ORDER BY o.shipped_at, o.order_number, o.id""";
        jdbc.query(sql, p, (RowCallbackHandler) rs -> sink.accept(codRow(rs)));
    }

    /**
     * Courier remittances received in the range. A location-limited reader sees the remittances
     * that paid at least one order of their locations (the remittance itself has no location).
     */
    public void remittances(DocFilter f, Consumer<RemittanceRow> sink) {
        MapSqlParameterSource p = base(f);
        String scope = "";
        if (f.locationIn() != null) {
            scope = """

                      AND EXISTS (
                          SELECT 1 FROM commerce_order o
                          WHERE o.cod_remittance_id = r.id"""
                    + ReportReadRepository.location(f, p, "o.fulfilment_location_id")
                    + ")";
        }
        String sql = """
                SELECT r.id, r.received_on, r.reference, r.courier_name, r.order_count, r.orders_total,
                       r.gross_amount, r.deductions, r.net_amount, r.difference_reason
                FROM commerce_cod_remittance r
                WHERE r.institute_id = :instituteId
                  AND r.received_on >= :from
                  AND r.received_on <= :to"""
                + scope
                + """

                ORDER BY r.received_on, r.reference, r.id""";
        jdbc.query(sql, p, (RowCallbackHandler) rs -> sink.accept(new RemittanceRow(
                rs.getString("id"),
                date(rs, "received_on"),
                rs.getString("reference"),
                rs.getString("courier_name"),
                rs.getInt("order_count"),
                money(rs, "orders_total"),
                money(rs, "gross_amount"),
                money(rs, "deductions"),
                money(rs, "net_amount"),
                rs.getString("difference_reason"))));
    }

    /** Orders shipped in the range (India day of {@code shipped_at}) by payment method, and how many went RTO. */
    public List<RtoRow> rto(DocFilter f, LocalDateTime storedFrom, LocalDateTime storedTo) {
        MapSqlParameterSource p = range(f, storedFrom, storedTo);
        String sql = """
                SELECT o.payment_method,
                       COUNT(*) AS shipped,
                       COUNT(*) FILTER (WHERE o.status = 'RTO'
                                           OR s.status IN ('RTO', 'RTO_RECEIVED')) AS rto
                FROM commerce_order o
                LEFT JOIN commerce_shipment s ON s.order_id = o.id AND s.status <> 'CANCELLED'
                WHERE o.institute_id = :instituteId
                  AND o.shipped_at >= :storedFrom
                  AND o.shipped_at < :storedTo"""
                + ReportReadRepository.location(f, p, "o.fulfilment_location_id")
                + """

                GROUP BY o.payment_method
                ORDER BY o.payment_method""";
        return jdbc.query(sql, p, (rs, i) -> new RtoRow(rs.getString("payment_method"), rs.getLong("shipped"),
                rs.getLong("rto")));
    }

    private static CodOrderRow codRow(ResultSet rs) throws SQLException {
        return new CodOrderRow(
                rs.getString("order_id"),
                rs.getString("order_number"),
                date(rs, "order_date"),
                rs.getString("customer_name"),
                rs.getString("customer_phone"),
                rs.getString("carrier_name"),
                rs.getString("tracking_number"),
                date(rs, "shipped_on"),
                date(rs, "delivered_on"),
                money(rs, "cod_amount"),
                rs.getString("location_id"));
    }

    // ================================================================== customer dues

    private static final String DUES_FROM = """

            FROM commerce_order o
            WHERE o.institute_id = :instituteId
              AND o.channel = 'ADMIN'
              AND o.payment_status IN ('UNPAID', 'PARTIALLY_PAID')
              AND o.status NOT IN ('CANCELLED', 'RTO')""";

    /** Credit of received returns that was not owed back as money (it lowers the due). */
    private static final String RETURN_CREDIT = " COALESCE((SELECT SUM(r.credit_total - r.due_raised)"
            + " FROM commerce_return r WHERE r.order_id = o.id AND r.status IN ('RECEIVED', 'CLOSED')), 0) ";

    /**
     * Staff orders with money due (the order desk's DUES queue), by order date, number and id,
     * after the keyset; at most {@code limit} rows (null: all).
     */
    public void dues(DocFilter f, Keyset after, Integer limit, Consumer<DueRow> sink) {
        MapSqlParameterSource p = new MapSqlParameterSource("instituteId", f.instituteId());
        String sql = """
                SELECT o.id,
                       o.order_number,
                       """ + indiaDay("o.created_at") + """
                 AS order_date,
                       o.customer_name,
                       o.customer_phone,
                       o.total,
                       o.amount_paid,
                       """ + RETURN_CREDIT + """
                 AS credited,
                       o.fulfilment_location_id"""
                + DUES_FROM
                + ReportReadRepository.location(f, p, "o.fulfilment_location_id")
                + ReportReadRepository.keyset(after, p, indiaDay("o.created_at"), "o.order_number", "o.id")
                + """

                ORDER BY 3, o.order_number, o.id"""
                + limit(limit, p);
        jdbc.query(sql, p, (RowCallbackHandler) rs -> sink.accept(new DueRow(
                rs.getString("id"),
                rs.getString("order_number"),
                date(rs, "order_date"),
                rs.getString("customer_name"),
                rs.getString("customer_phone"),
                money(rs, "total"),
                money(rs, "amount_paid"),
                money(rs, "credited"),
                rs.getString("fulfilment_location_id"))));
    }

    /** Dues totals over the whole filter (one aggregate query). */
    public DueTotals dueTotals(DocFilter f) {
        MapSqlParameterSource p = new MapSqlParameterSource("instituteId", f.instituteId());
        String sql = """
                SELECT COUNT(*) AS orders,
                       COUNT(DISTINCT COALESCE(x.customer_id, x.customer_phone, x.id)) AS customers,
                       COALESCE(SUM(x.total), 0) AS total,
                       COALESCE(SUM(x.amount_paid), 0) AS received,
                       COALESCE(SUM(x.credited), 0) AS credited,
                       COALESCE(SUM(GREATEST(x.total - x.amount_paid - x.credited, 0)), 0) AS due,
                       COUNT(*) FILTER (WHERE x.credited > 0) AS reduced
                FROM (
                    SELECT o.id, o.customer_id, o.customer_phone, o.total, o.amount_paid,
                           """ + RETURN_CREDIT + """
                 AS credited"""
                + DUES_FROM
                + ReportReadRepository.location(f, p, "o.fulfilment_location_id")
                + """

                ) x""";
        return jdbc.queryForObject(sql, p, (rs, i) -> new DueTotals(rs.getLong("orders"), rs.getLong("customers"),
                money(rs, "total"), money(rs, "received"), money(rs, "credited"), money(rs, "due"),
                rs.getLong("reduced")));
    }

    // ================================================================== sales and products

    /**
     * Sales documents of the range: every live invoice with its line sums (taxable, tax, line
     * amount, discount, items: a counted line adds its quantity, a measured line adds 1, delivery
     * and COD-charge lines nothing), then every credit note by its own date, with the order facts
     * the grouping needs (channel, location and payment method of the invoice).
     */
    public void salesDocuments(DocFilter f, Consumer<SalesDocument> sink) {
        MapSqlParameterSource p = base(f);
        String invoices = """
                SELECT 'INVOICE' AS kind,
                       i.id,
                       i.document_date AS day,
                       i.channel,
                       i.location_id,
                       o.channel AS order_channel,
                       o.created_by AS staff_id,
                       o.payment_method,
                       i.total_amount AS total,
                       COALESCE(i.round_off, 0) AS round_off,
                       COALESCE(x.taxable, 0) AS taxable,
                       COALESCE(x.tax, 0) AS tax,
                       COALESCE(x.amount, 0) AS line_amount,
                       COALESCE(x.discount, 0) AS discount,
                       COALESCE(x.items, 0) AS items
                FROM invoice i
                LEFT JOIN commerce_order o ON o.id = i.commerce_order_id
                LEFT JOIN LATERAL (
                    SELECT SUM(COALESCE(li.taxable_value, 0)) AS taxable,
                           SUM(COALESCE(li.cgst, 0) + COALESCE(li.sgst, 0) + COALESCE(li.igst, 0)
                               + COALESCE(li.cess, 0)) AS tax,
                           SUM(COALESCE(li.amount, 0)) AS amount,
                           SUM(COALESCE(li.discount, 0)) AS discount,
                           SUM(CASE WHEN\s""" + SERVICE + """
                 THEN 0
                                    WHEN COALESCE(""" + SCALE + """
                , 1) > 1 THEN 1
                                    ELSE COALESCE(li.quantity, 0) END) AS items
                    FROM invoice_line_item li"""
                + ReportReadRepository.ORDER_LINE
                + """

                    WHERE li.invoice_id = i.id) x ON TRUE
                WHERE i.institute_id = :instituteId
                  AND i.document_type IS NOT NULL
                  AND i.cancelled_at IS NULL
                  AND i.document_date >= :from
                  AND i.document_date <= :to"""
                + ReportReadRepository.location(f, p, "i.location_id")
                + ReportReadRepository.channel(f, p, "i.channel");
        String notes = """

                UNION ALL
                SELECT 'NOTE' AS kind,
                       n.id,
                       n.document_date,
                       i.channel,
                       i.location_id,
                       o.channel,
                       o.created_by,
                       o.payment_method,
                       n.total,
                       COALESCE(n.round_off, 0),
                       0, 0, 0, 0, 0
                FROM commerce_credit_note n
                JOIN invoice i ON i.id = n.invoice_id
                LEFT JOIN commerce_order o ON o.id = i.commerce_order_id
                WHERE n.institute_id = :instituteId
                  AND n.document_date >= :from
                  AND n.document_date <= :to"""
                + ReportReadRepository.location(f, p, "i.location_id")
                + ReportReadRepository.channel(f, p, "i.channel");
        jdbc.query(invoices + notes, p, (RowCallbackHandler) rs -> sink.accept(new SalesDocument(
                rs.getString("kind"),
                rs.getString("id"),
                date(rs, "day"),
                rs.getString("channel"),
                rs.getString("location_id"),
                rs.getString("order_channel"),
                rs.getString("staff_id"),
                rs.getString("payment_method"),
                money(rs, "total"),
                money(rs, "round_off"),
                money(rs, "taxable"),
                money(rs, "tax"),
                money(rs, "line_amount"),
                money(rs, "discount"),
                rs.getLong("items"))));
    }

    /**
     * Item lines (with a variant) of the live invoices of the range and of the credit notes of the
     * range, with the product they sold (current names, a label only) and the line's scale (the
     * order line's, else the invoice snapshot's).
     */
    public void productLines(DocFilter f, Consumer<ProductLine> sink) {
        MapSqlParameterSource p = base(f);
        String invoices = """
                SELECT 'INVOICE' AS kind,
                       i.id AS document_id,
                       li.package_session_id,
                       v.package_id,
                       pk.package_name AS product_name,
                       ps.name AS variant_name,
                       v.sku,
                       COALESCE(li.quantity, 0) AS quantity,
                       """ + SCALE + """
                 AS qty_scale,
                       li.unit,
                       COALESCE(li.amount, 0) AS amount,
                       COALESCE(li.taxable_value, 0) AS taxable
                FROM invoice i
                JOIN invoice_line_item li ON li.invoice_id = i.id"""
                + ReportReadRepository.ORDER_LINE
                + """

                LEFT JOIN commerce_variant v ON v.package_session_id = li.package_session_id
                                            AND v.institute_id = i.institute_id
                LEFT JOIN package_session ps ON ps.id = li.package_session_id
                LEFT JOIN package pk ON pk.id = v.package_id
                WHERE i.institute_id = :instituteId
                  AND i.document_type IS NOT NULL
                  AND i.cancelled_at IS NULL
                  AND i.document_date >= :from
                  AND i.document_date <= :to
                  AND li.package_session_id IS NOT NULL
                  AND NOT\s""" + SERVICE
                + ReportReadRepository.location(f, p, "i.location_id")
                + ReportReadRepository.channel(f, p, "i.channel");
        String notes = """

                UNION ALL
                SELECT 'NOTE' AS kind,
                       n.id,
                       COALESCE(cl.package_session_id, li.package_session_id),
                       v.package_id,
                       pk.package_name,
                       ps.name,
                       v.sku,
                       cl.quantity,
                       """ + SCALE + """
                ,
                       cl.unit,
                       cl.amount,
                       cl.taxable_value
                FROM commerce_credit_note n
                JOIN invoice i ON i.id = n.invoice_id
                JOIN commerce_credit_note_line cl ON cl.credit_note_id = n.id
                LEFT JOIN invoice_line_item li ON li.id = cl.invoice_line_item_id"""
                + ReportReadRepository.ORDER_LINE
                + """

                LEFT JOIN commerce_variant v ON v.package_session_id = COALESCE(cl.package_session_id, li.package_session_id)
                                            AND v.institute_id = n.institute_id
                LEFT JOIN package_session ps ON ps.id = COALESCE(cl.package_session_id, li.package_session_id)
                LEFT JOIN package pk ON pk.id = v.package_id
                WHERE n.institute_id = :instituteId
                  AND n.document_date >= :from
                  AND n.document_date <= :to
                  AND COALESCE(cl.package_session_id, li.package_session_id) IS NOT NULL
                  AND NOT\s""" + SERVICE
                + ReportReadRepository.location(f, p, "i.location_id")
                + ReportReadRepository.channel(f, p, "i.channel");
        jdbc.query(invoices + notes, p, (RowCallbackHandler) rs -> sink.accept(new ProductLine(
                rs.getString("kind"),
                rs.getString("document_id"),
                rs.getString("package_session_id"),
                rs.getString("package_id"),
                rs.getString("product_name"),
                rs.getString("variant_name"),
                rs.getString("sku"),
                rs.getLong("quantity"),
                intOrNull(rs, "qty_scale"),
                rs.getString("unit"),
                money(rs, "amount"),
                money(rs, "taxable"))));
    }

    /** ACTIVE products of the institute, by name (the "never sold" block subtracts the sold ones). */
    public List<ActiveProduct> activeProducts(String instituteId) {
        return jdbc.query("""
                SELECT cp.package_id,
                       pk.package_name,
                       cp.unit,
                       (SELECT MIN(v.sku) FROM commerce_variant v
                        WHERE v.institute_id = cp.institute_id
                          AND v.package_id = cp.package_id
                          AND v.status = 'ACTIVE') AS sku
                FROM commerce_product cp
                LEFT JOIN package pk ON pk.id = cp.package_id
                WHERE cp.institute_id = :instituteId
                  AND cp.status = 'ACTIVE'
                ORDER BY pk.package_name, cp.package_id""", new MapSqlParameterSource("instituteId", instituteId),
                (rs, i) -> new ActiveProduct(rs.getString("package_id"), rs.getString("package_name"),
                        rs.getString("unit"), rs.getString("sku")));
    }

    /** Current memberships of products in collections of one kind (COLLECTION or CATEGORY). */
    public List<Membership> memberships(String instituteId, String kind) {
        return jdbc.query("""
                SELECT pc.package_id,
                       c.id AS collection_id,
                       COALESCE(c.name_i18n ->> 'en', c.slug) AS collection_name
                FROM commerce_product_collection pc
                JOIN commerce_collection c ON c.id = pc.collection_id
                WHERE pc.institute_id = :instituteId
                  AND c.institute_id = :instituteId
                  AND c.kind = :kind
                ORDER BY c.position, collection_name""",
                new MapSqlParameterSource("instituteId", instituteId).addValue("kind", kind),
                (rs, i) -> new Membership(rs.getString("package_id"), rs.getString("collection_id"),
                        rs.getString("collection_name")));
    }

    // ================================================================== staff ids (names are read outside the transaction)

    /** The staff user ids the day book of this filter names (tenders, refunds, cash movements, documents). */
    public List<String> dayBookStaff(DocFilter f, LocalDateTime storedFrom, LocalDateTime storedTo) {
        MapSqlParameterSource p = range(f, storedFrom, storedTo);
        String sql = """
                SELECT DISTINCT u FROM (
                    SELECT t.recorded_by AS u FROM commerce_order_tender t
                    WHERE t.institute_id = :instituteId AND t.status = 'RECEIVED'
                      AND t.received_at >= :storedFrom AND t.received_at < :storedTo
                    UNION
                    SELECT COALESCE(f.processed_by, f.created_by) FROM commerce_refund f
                    WHERE f.institute_id = :instituteId AND f.status = 'PROCESSED'
                      AND ((f.paid_on >= :from AND f.paid_on <= :to)
                           OR (f.processed_at >= :storedFrom AND f.processed_at < :storedTo))
                    UNION
                    SELECT c.actor_user_id FROM pos_cash_movement c
                    WHERE c.institute_id = :instituteId
                      AND ((c.document_date >= :from AND c.document_date <= :to)
                           OR (c.created_at >= :storedFrom AND c.created_at < :storedTo))
                    UNION
                    SELECT o.created_by FROM invoice i
                    JOIN commerce_order o ON o.id = i.commerce_order_id
                    WHERE i.institute_id = :instituteId AND i.document_type IS NOT NULL
                      AND i.document_date >= :from AND i.document_date <= :to
                      AND o.channel IN ('POS', 'ADMIN')
                    UNION
                    SELECT n.created_by FROM commerce_credit_note n
                    WHERE n.institute_id = :instituteId
                      AND n.document_date >= :from AND n.document_date <= :to
                    UNION
                    SELECT s.cashier_user_id FROM pos_session s
                    WHERE s.institute_id = :instituteId
                      AND s.opened_at < :storedTo
                      AND (s.closed_at IS NULL OR s.closed_at >= :storedFrom)
                ) x
                WHERE u IS NOT NULL
                LIMIT 1000""";
        return jdbc.queryForList(sql, p, String.class);
    }

    /** The cashiers of the sessions opened in the range. */
    public List<String> sessionCashiers(DocFilter f, LocalDateTime storedFrom, LocalDateTime storedTo) {
        MapSqlParameterSource p = range(f, storedFrom, storedTo);
        String sql = """
                SELECT DISTINCT s.cashier_user_id FROM pos_session s
                WHERE s.institute_id = :instituteId
                  AND s.opened_at >= :storedFrom
                  AND s.opened_at < :storedTo"""
                + ReportReadRepository.location(f, p, "s.location_id")
                + """

                LIMIT 1000""";
        return jdbc.queryForList(sql, p, String.class);
    }

    /** The staff who placed the POS and staff orders invoiced or credited in the range. */
    public List<String> salesStaff(DocFilter f) {
        MapSqlParameterSource p = base(f);
        String sql = """
                SELECT DISTINCT o.created_by FROM invoice i
                JOIN commerce_order o ON o.id = i.commerce_order_id
                WHERE i.institute_id = :instituteId
                  AND i.document_type IS NOT NULL
                  AND o.channel IN ('POS', 'ADMIN')
                  AND o.created_by IS NOT NULL
                  AND (i.document_date >= :from AND i.document_date <= :to
                       OR EXISTS (SELECT 1 FROM commerce_credit_note n
                                  WHERE n.invoice_id = i.id
                                    AND n.institute_id = :instituteId
                                    AND n.document_date >= :from
                                    AND n.document_date <= :to))"""
                + ReportReadRepository.location(f, p, "i.location_id")
                + """

                LIMIT 1000""";
        return jdbc.queryForList(sql, p, String.class);
    }

    // ================================================================== helpers

    private static MapSqlParameterSource base(DocFilter f) {
        return new MapSqlParameterSource()
                .addValue("instituteId", f.instituteId())
                .addValue("from", Date.valueOf(f.from()))
                .addValue("to", Date.valueOf(f.to()));
    }

    private static MapSqlParameterSource range(DocFilter f, LocalDateTime storedFrom, LocalDateTime storedTo) {
        return base(f)
                .addValue("storedFrom", Timestamp.valueOf(storedFrom))
                .addValue("storedTo", Timestamp.valueOf(storedTo));
    }

    private static String limit(Integer limit, MapSqlParameterSource p) {
        if (limit == null) {
            return "";
        }
        p.addValue("pageLimit", limit);
        return "\nLIMIT :pageLimit";
    }

    private static SessionRow sessionRow(ResultSet rs) throws SQLException {
        return new SessionRow(
                rs.getString("id"),
                rs.getString("status"),
                date(rs, "opened_day"),
                rs.getString("opened_text"),
                rs.getString("opened_raw"),
                rs.getString("closed_text"),
                rs.getString("register_code"),
                rs.getString("register_name"),
                rs.getString("location_id"),
                rs.getString("cashier_user_id"),
                money(rs, "opening_cash"),
                rs.getBigDecimal("expected_cash"),
                rs.getBigDecimal("counted_cash"),
                rs.getBigDecimal("variance"),
                rs.getBigDecimal("expected_so_far"),
                rs.getString("close_note"),
                rs.getString("z_report"));
    }

    static LocalDate date(ResultSet rs, String column) throws SQLException {
        Date value = rs.getDate(column);
        return value == null ? null : value.toLocalDate();
    }

    static BigDecimal money(ResultSet rs, String column) throws SQLException {
        BigDecimal value = rs.getBigDecimal(column);
        return value == null ? BigDecimal.ZERO : value;
    }

    private static Integer intOrNull(ResultSet rs, String column) throws SQLException {
        int value = rs.getInt(column);
        return rs.wasNull() ? null : value;
    }

}
