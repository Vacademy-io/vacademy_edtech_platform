package vacademy.io.admin_core_service.features.commerce.report.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.CreditNoteRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.CreditNoteTotals;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.DocFilter;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.DocumentRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.InvoiceLine;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.Keyset;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.NoteLine;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.SalesRegisterRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.SalesRegisterTotals;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.SeriesRow;

import java.math.BigDecimal;
import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/**
 * The native SQL of the reports. Every method runs inside the caller's read-only transaction
 * ({@code ReportRunner}), so it reads the replica under the transaction's statement timeout.
 *
 * <p>Rules every query keeps: {@code institute_id = :instituteId} first; {@code document_type IS
 * NOT NULL} on {@code invoice} (commerce documents only); documents filtered on their stored India
 * {@code document_date}; a timestamp turned into an India date only with
 * {@code AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'} (the read pool sets no session time zone);
 * no {@code now()} or {@code CURRENT_DATE}. Large reads stream through a {@link RowCallbackHandler}
 * with fetch size 1,000 and keep no row list.
 *
 * <p>SQL is assembled from text blocks and fragments that each begin with a newline, so no two
 * keywords are ever glued together.
 */
@Repository
public class ReportReadRepository {

    /** The scale of a line: the order line's, else the invoice snapshot's {@code tax.lines[].qty_scale}. */
    static final String SCALE = """
            COALESCE(ol.qty_scale, (
                SELECT NULLIF((e.elem ->> 'qty_scale')::int, 0)
                FROM jsonb_array_elements(
                    CASE WHEN jsonb_typeof(i.invoice_data_json::jsonb #> '{tax,lines}') = 'array'
                         THEN i.invoice_data_json::jsonb #> '{tax,lines}'
                         ELSE '[]'::jsonb END) AS e(elem)
                WHERE e.elem ->> 'line_ref' = li.source_id
                LIMIT 1))""";

    /** The order line of an invoice line ({@code line_ref} = the invoice line's {@code source_id}). */
    static final String ORDER_LINE = """

            LEFT JOIN LATERAL (
                SELECT l.qty_scale, l.tax_class_id
                FROM commerce_order_line l
                WHERE l.order_id = i.commerce_order_id
                  AND l.line_ref = li.source_id
                ORDER BY l.line_no
                LIMIT 1) ol ON TRUE""";

    /** True for a delivery or COD-charge line (a service: UQC NA, quantity 0 in the HSN summary). */
    static final String SERVICE_FLAG = "COALESCE(li.item_type IN ('COMMERCE_SHIPPING', 'COMMERCE_COD_CHARGE'), FALSE)";

    private final NamedParameterJdbcTemplate jdbc;

    public ReportReadRepository(NamedParameterJdbcTemplate jdbc) {
        JdbcTemplate streaming = new JdbcTemplate(jdbc.getJdbcTemplate().getDataSource());
        streaming.setFetchSize(1000);
        this.jdbc = new NamedParameterJdbcTemplate(streaming);
    }

    // ================================================================== access

    /** The ids of the institute's active locations. */
    public List<String> activeLocationIds(String instituteId) {
        return jdbc.queryForList("""
                SELECT id FROM stock_location
                WHERE institute_id = :instituteId
                  AND status = 'ACTIVE'""", new MapSqlParameterSource("instituteId", instituteId), String.class);
    }

    /** Distinct seller GSTINs of the invoices and credit notes in the range (location filter applied). */
    public List<String> sellerGstins(DocFilter f) {
        MapSqlParameterSource p = base(f);
        String sql = """
                SELECT g FROM (
                    SELECT i.seller_gstin AS g
                    FROM invoice i
                    WHERE i.institute_id = :instituteId
                      AND i.document_type IS NOT NULL
                      AND i.document_date >= :from
                      AND i.document_date <= :to"""
                + location(f, p, "i.location_id")
                + """

                    UNION
                    SELECT n.seller_gstin AS g
                    FROM commerce_credit_note n
                    JOIN invoice i ON i.id = n.invoice_id
                    WHERE n.institute_id = :instituteId
                      AND n.document_date >= :from
                      AND n.document_date <= :to"""
                + location(f, p, "i.location_id")
                + """

                ) x
                WHERE g IS NOT NULL
                ORDER BY g""";
        return jdbc.queryForList(sql, p, String.class);
    }

    // ================================================================== sales register

    /**
     * Sales register groups (invoice × HSN × rate) in register order. With {@code invoiceLimit}
     * the invoices are a page after {@code after}; without, every invoice of the filter (export).
     */
    public void salesRegister(DocFilter f, Keyset after, Integer invoiceLimit, Consumer<SalesRegisterRow> sink) {
        MapSqlParameterSource p = base(f);
        String sql = """
                WITH inv AS (
                    SELECT i.id, i.invoice_number, i.document_date
                    FROM invoice i
                    WHERE i.institute_id = :instituteId
                      AND i.document_type IS NOT NULL
                      AND i.document_date >= :from
                      AND i.document_date <= :to"""
                + invoiceFilters(f, p)
                + keyset(after, p, "i.document_date", "i.invoice_number", "i.id")
                + """

                    ORDER BY i.document_date, i.invoice_number, i.id"""
                + limit(invoiceLimit, p)
                + """

                ),
                g AS (
                    SELECT li.invoice_id,
                           li.hsn_code,
                           COALESCE(li.tax_rate, 0) AS tax_rate,
                           SUM(COALESCE(li.taxable_value, 0)) AS taxable_value,
                           SUM(COALESCE(li.cgst, 0)) AS cgst,
                           SUM(COALESCE(li.sgst, 0)) AS sgst,
                           SUM(COALESCE(li.igst, 0)) AS igst,
                           SUM(COALESCE(li.cess, 0)) AS cess,
                           row_number() OVER (PARTITION BY li.invoice_id
                                              ORDER BY li.hsn_code NULLS FIRST, COALESCE(li.tax_rate, 0)) AS group_no
                    FROM invoice_line_item li
                    JOIN inv ON inv.id = li.invoice_id
                    GROUP BY li.invoice_id, li.hsn_code, COALESCE(li.tax_rate, 0)
                )
                SELECT i.id AS invoice_id,
                       i.invoice_number,
                       i.external_invoice_number,
                       i.document_date,
                       i.document_type,
                       i.channel,
                       sl.code AS location_code,
                       co.order_number,
                       i.buyer_gstin,
                       i.place_of_supply_state,
                       i.seller_gstin,
                       i.total_amount,
                       COALESCE(i.round_off, 0) AS round_off,
                       (i.cancelled_at IS NOT NULL) AS cancelled,
                       (i.cancelled_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS cancelled_on,
                       COALESCE(g.group_no, 1) AS group_no,
                       CASE WHEN COALESCE(g.group_no, 1) = 1 THEN i.invoice_data_json END AS snapshot_json,
                       CASE WHEN COALESCE(g.group_no, 1) = 1 THEN (
                           SELECT string_agg(DISTINCT t.mode, '+' ORDER BY t.mode)
                           FROM commerce_order_tender t
                           WHERE t.order_id = i.commerce_order_id
                             AND t.status IN ('RECEIVED', 'PENDING')) END AS payment_modes,
                       g.hsn_code,
                       COALESCE(g.tax_rate, 0) AS tax_rate,
                       COALESCE(g.taxable_value, 0) AS taxable_value,
                       COALESCE(g.cgst, 0) AS cgst,
                       COALESCE(g.sgst, 0) AS sgst,
                       COALESCE(g.igst, 0) AS igst,
                       COALESCE(g.cess, 0) AS cess
                FROM inv
                JOIN invoice i ON i.id = inv.id
                LEFT JOIN g ON g.invoice_id = inv.id
                LEFT JOIN stock_location sl ON sl.id = i.location_id
                LEFT JOIN commerce_order co ON co.id = i.commerce_order_id
                ORDER BY i.document_date, i.invoice_number, i.id, COALESCE(g.group_no, 1)""";
        jdbc.query(sql, p, (RowCallbackHandler) rs -> sink.accept(new SalesRegisterRow(
                rs.getString("invoice_id"),
                rs.getString("invoice_number"),
                rs.getString("external_invoice_number"),
                date(rs, "document_date"),
                rs.getString("document_type"),
                rs.getString("channel"),
                rs.getString("location_code"),
                rs.getString("order_number"),
                rs.getString("buyer_gstin"),
                rs.getString("place_of_supply_state"),
                rs.getString("seller_gstin"),
                money(rs, "total_amount"),
                money(rs, "round_off"),
                rs.getBoolean("cancelled"),
                date(rs, "cancelled_on"),
                rs.getInt("group_no"),
                rs.getString("snapshot_json"),
                rs.getString("payment_modes"),
                rs.getString("hsn_code"),
                money(rs, "tax_rate"),
                money(rs, "taxable_value"),
                money(rs, "cgst"),
                money(rs, "sgst"),
                money(rs, "igst"),
                money(rs, "cess"))));
    }

    /** Totals over the whole filter: live invoices (lines and headers) and the cancelled ones apart. */
    public SalesRegisterTotals salesRegisterTotals(DocFilter f) {
        MapSqlParameterSource p = base(f);
        String where = """

                WHERE i.institute_id = :instituteId
                  AND i.document_type IS NOT NULL
                  AND i.document_date >= :from
                  AND i.document_date <= :to""" + invoiceFilters(f, p);
        Map<String, Object> header = jdbc.queryForMap("""
                SELECT COUNT(*) FILTER (WHERE i.cancelled_at IS NULL) AS invoices,
                       COALESCE(SUM(i.total_amount) FILTER (WHERE i.cancelled_at IS NULL), 0) AS invoice_total,
                       COALESCE(SUM(COALESCE(i.round_off, 0)) FILTER (WHERE i.cancelled_at IS NULL), 0) AS round_off,
                       COUNT(*) FILTER (WHERE i.cancelled_at IS NOT NULL) AS cancelled_invoices,
                       COALESCE(SUM(i.total_amount) FILTER (WHERE i.cancelled_at IS NOT NULL), 0) AS cancelled_total
                FROM invoice i""" + where, p);
        Map<String, Object> lines = jdbc.queryForMap("""
                SELECT COALESCE(SUM(li.taxable_value), 0) AS taxable_value,
                       COALESCE(SUM(li.cgst), 0) AS cgst,
                       COALESCE(SUM(li.sgst), 0) AS sgst,
                       COALESCE(SUM(li.igst), 0) AS igst,
                       COALESCE(SUM(li.cess), 0) AS cess
                FROM invoice i
                JOIN invoice_line_item li ON li.invoice_id = i.id""" + where + """

                  AND i.cancelled_at IS NULL""", p);
        return new SalesRegisterTotals(dec(lines.get("taxable_value")), dec(lines.get("cgst")),
                dec(lines.get("sgst")), dec(lines.get("igst")), dec(lines.get("cess")),
                dec(header.get("round_off")), dec(header.get("invoice_total")), num(header.get("invoices")),
                num(header.get("cancelled_invoices")), dec(header.get("cancelled_total")));
    }

    // ================================================================== credit-note register

    /**
     * Credit-note register groups (note × HSN × rate × unit × scale × unit price) in register
     * order; paged like {@link #salesRegister}.
     */
    public void creditNotes(DocFilter f, Keyset after, Integer noteLimit, Consumer<CreditNoteRow> sink) {
        MapSqlParameterSource p = base(f);
        String sql = """
                WITH nt AS (
                    SELECT n.id, n.credit_note_number, n.document_date
                    FROM commerce_credit_note n
                    JOIN invoice i ON i.id = n.invoice_id
                    WHERE n.institute_id = :instituteId
                      AND n.document_date >= :from
                      AND n.document_date <= :to"""
                + noteFilters(f, p)
                + keyset(after, p, "n.document_date", "n.credit_note_number", "n.id")
                + """

                    ORDER BY n.document_date, n.credit_note_number, n.id"""
                + limit(noteLimit, p)
                + """

                ),
                ln AS (
                    SELECT cl.credit_note_id,
                           cl.hsn_code,
                           COALESCE(cl.tax_rate, 0) AS tax_rate,
                           cl.unit,
                           cl.unit_price,"""
                + "\n       " + SCALE + " AS qty_scale,"
                + "\n       " + SERVICE_FLAG + " AS service,"
                + """

                           cl.quantity,
                           cl.taxable_value,
                           cl.cgst,
                           cl.sgst,
                           cl.igst,
                           cl.cess,
                           cl.amount
                    FROM commerce_credit_note_line cl
                    JOIN nt ON nt.id = cl.credit_note_id
                    LEFT JOIN invoice_line_item li ON li.id = cl.invoice_line_item_id
                    LEFT JOIN invoice i ON i.id = li.invoice_id"""
                + ORDER_LINE
                + """

                ),
                g AS (
                    SELECT credit_note_id, hsn_code, tax_rate, unit, unit_price, qty_scale, service,
                           SUM(quantity) AS quantity,
                           SUM(taxable_value) AS taxable_value,
                           SUM(cgst) AS cgst,
                           SUM(sgst) AS sgst,
                           SUM(igst) AS igst,
                           SUM(cess) AS cess,
                           SUM(amount) AS amount,
                           row_number() OVER (PARTITION BY credit_note_id
                                              ORDER BY hsn_code NULLS FIRST, tax_rate, unit NULLS FIRST,
                                                       unit_price NULLS FIRST, qty_scale NULLS FIRST, service) AS group_no
                    FROM ln
                    GROUP BY credit_note_id, hsn_code, tax_rate, unit, unit_price, qty_scale, service
                )
                SELECT n.id AS note_id,
                       n.credit_note_number,
                       n.document_date AS note_date,
                       i.invoice_number,
                       i.document_date AS invoice_date,
                       r.return_number,
                       n.buyer_gstin,
                       n.place_of_supply_state,
                       n.reason,
                       i.channel,
                       sl.code AS location_code,
                       n.seller_gstin,
                       n.total AS note_total,
                       n.round_off,
                       COALESCE(g.group_no, 1) AS group_no,
                       g.hsn_code,
                       COALESCE(g.tax_rate, 0) AS tax_rate,
                       g.unit,
                       g.unit_price,
                       g.qty_scale,
                       COALESCE(g.service, FALSE) AS service,
                       COALESCE(g.quantity, 0) AS quantity,
                       COALESCE(g.taxable_value, 0) AS taxable_value,
                       COALESCE(g.cgst, 0) AS cgst,
                       COALESCE(g.sgst, 0) AS sgst,
                       COALESCE(g.igst, 0) AS igst,
                       COALESCE(g.cess, 0) AS cess,
                       COALESCE(g.amount, 0) AS amount
                FROM nt
                JOIN commerce_credit_note n ON n.id = nt.id
                JOIN invoice i ON i.id = n.invoice_id
                LEFT JOIN commerce_return r ON r.id = n.return_id
                LEFT JOIN stock_location sl ON sl.id = i.location_id
                LEFT JOIN g ON g.credit_note_id = n.id
                ORDER BY n.document_date, n.credit_note_number, n.id, COALESCE(g.group_no, 1)""";
        jdbc.query(sql, p, (RowCallbackHandler) rs -> sink.accept(new CreditNoteRow(
                rs.getString("note_id"),
                rs.getString("credit_note_number"),
                date(rs, "note_date"),
                rs.getString("invoice_number"),
                date(rs, "invoice_date"),
                rs.getString("return_number"),
                rs.getString("buyer_gstin"),
                rs.getString("place_of_supply_state"),
                rs.getString("reason"),
                rs.getString("channel"),
                rs.getString("location_code"),
                rs.getString("seller_gstin"),
                money(rs, "note_total"),
                money(rs, "round_off"),
                rs.getInt("group_no"),
                rs.getString("hsn_code"),
                money(rs, "tax_rate"),
                rs.getString("unit"),
                rs.getBigDecimal("unit_price"),
                intOrNull(rs, "qty_scale"),
                rs.getBoolean("service"),
                rs.getLong("quantity"),
                money(rs, "taxable_value"),
                money(rs, "cgst"),
                money(rs, "sgst"),
                money(rs, "igst"),
                money(rs, "cess"),
                money(rs, "amount"))));
    }

    /** Credit-note register totals over the whole filter. */
    public CreditNoteTotals creditNoteTotals(DocFilter f) {
        MapSqlParameterSource p = base(f);
        String where = """

                WHERE n.institute_id = :instituteId
                  AND n.document_date >= :from
                  AND n.document_date <= :to""" + noteFilters(f, p);
        Map<String, Object> header = jdbc.queryForMap("""
                SELECT COUNT(*) AS notes,
                       COALESCE(SUM(n.total), 0) AS note_total,
                       COALESCE(SUM(n.round_off), 0) AS round_off
                FROM commerce_credit_note n
                JOIN invoice i ON i.id = n.invoice_id""" + where, p);
        Map<String, Object> lines = jdbc.queryForMap("""
                SELECT COALESCE(SUM(cl.taxable_value), 0) AS taxable_value,
                       COALESCE(SUM(cl.cgst), 0) AS cgst,
                       COALESCE(SUM(cl.sgst), 0) AS sgst,
                       COALESCE(SUM(cl.igst), 0) AS igst,
                       COALESCE(SUM(cl.cess), 0) AS cess,
                       COALESCE(SUM(cl.amount), 0) AS amount
                FROM commerce_credit_note n
                JOIN invoice i ON i.id = n.invoice_id
                JOIN commerce_credit_note_line cl ON cl.credit_note_id = n.id""" + where, p);
        return new CreditNoteTotals(dec(lines.get("taxable_value")), dec(lines.get("cgst")), dec(lines.get("sgst")),
                dec(lines.get("igst")), dec(lines.get("cess")), dec(lines.get("amount")),
                dec(header.get("round_off")), dec(header.get("note_total")), num(header.get("notes")));
    }

    // ================================================================== line streams (summaries)

    /** Every line of the live invoices of the filter (no order). */
    public void invoiceLines(DocFilter f, Consumer<InvoiceLine> sink) {
        MapSqlParameterSource p = base(f);
        String sql = """
                SELECT i.id AS invoice_id,
                       i.invoice_number,
                       i.document_date,
                       i.document_type,
                       i.channel,
                       i.location_id,
                       sl.code AS location_code,
                       i.buyer_gstin,
                       i.place_of_supply_state,
                       i.seller_gstin,
                       i.seller_state_code,
                       i.tax_head,
                       i.total_amount,
                       COALESCE(i.round_off, 0) AS round_off,
                       li.id AS line_id,
                       li.item_type,
                       li.hsn_code,
                       li.unit,
                       COALESCE(li.tax_rate, 0) AS tax_rate,
                       COALESCE(li.quantity, 0) AS quantity,"""
                + "\n       " + SCALE + " AS qty_scale,"
                + """

                       tc.name AS tax_class_name,
                       li.description,
                       COALESCE(li.taxable_value, 0) AS taxable_value,
                       COALESCE(li.cgst, 0) AS cgst,
                       COALESCE(li.sgst, 0) AS sgst,
                       COALESCE(li.igst, 0) AS igst,
                       COALESCE(li.cess, 0) AS cess,
                       li.amount
                FROM invoice i
                JOIN invoice_line_item li ON li.invoice_id = i.id
                LEFT JOIN stock_location sl ON sl.id = i.location_id"""
                + ORDER_LINE
                + """

                LEFT JOIN commerce_tax_class tc ON tc.id = ol.tax_class_id
                WHERE i.institute_id = :instituteId
                  AND i.document_type IS NOT NULL
                  AND i.cancelled_at IS NULL
                  AND i.document_date >= :from
                  AND i.document_date <= :to"""
                + invoiceFilters(f, p);
        jdbc.query(sql, p, (RowCallbackHandler) rs -> sink.accept(new InvoiceLine(
                rs.getString("invoice_id"),
                rs.getString("invoice_number"),
                date(rs, "document_date"),
                rs.getString("document_type"),
                rs.getString("channel"),
                rs.getString("location_id"),
                rs.getString("location_code"),
                rs.getString("buyer_gstin"),
                rs.getString("place_of_supply_state"),
                rs.getString("seller_gstin"),
                rs.getString("seller_state_code"),
                rs.getString("tax_head"),
                money(rs, "total_amount"),
                money(rs, "round_off"),
                rs.getString("line_id"),
                rs.getString("item_type"),
                rs.getString("hsn_code"),
                rs.getString("unit"),
                money(rs, "tax_rate"),
                rs.getLong("quantity"),
                intOrNull(rs, "qty_scale"),
                rs.getString("tax_class_name"),
                rs.getString("description"),
                money(rs, "taxable_value"),
                money(rs, "cgst"),
                money(rs, "sgst"),
                money(rs, "igst"),
                money(rs, "cess"),
                money(rs, "amount"))));
    }

    /** Every line of the credit notes dated in the filter's range (no order). */
    public void noteLines(DocFilter f, Consumer<NoteLine> sink) {
        MapSqlParameterSource p = base(f);
        String sql = """
                SELECT n.id AS note_id,
                       n.credit_note_number,
                       n.document_date AS note_date,
                       n.total AS note_total,
                       n.round_off AS note_round_off,
                       n.buyer_gstin,
                       n.place_of_supply_state,
                       n.seller_gstin,
                       i.id AS invoice_id,
                       i.invoice_number,
                       i.document_date AS invoice_date,
                       i.document_type AS invoice_document_type,
                       i.total_amount AS invoice_total,
                       i.buyer_gstin AS invoice_buyer_gstin,
                       i.tax_head AS invoice_tax_head,
                       i.seller_state_code AS invoice_seller_state,
                       i.place_of_supply_state AS invoice_place_of_supply,
                       i.channel,
                       i.location_id,
                       sl.code AS location_code,
                       cl.id AS line_id,
                       li.item_type,
                       cl.hsn_code,
                       cl.unit,
                       COALESCE(cl.tax_rate, 0) AS tax_rate,
                       cl.quantity,
                       cl.unit_price,"""
                + "\n       " + SCALE + " AS qty_scale,"
                + """

                       tc.name AS tax_class_name,
                       cl.description,
                       cl.taxable_value,
                       cl.cgst,
                       cl.sgst,
                       cl.igst,
                       cl.cess,
                       cl.amount
                FROM commerce_credit_note n
                JOIN invoice i ON i.id = n.invoice_id
                JOIN commerce_credit_note_line cl ON cl.credit_note_id = n.id
                LEFT JOIN invoice_line_item li ON li.id = cl.invoice_line_item_id
                LEFT JOIN stock_location sl ON sl.id = i.location_id"""
                + ORDER_LINE
                + """

                LEFT JOIN commerce_tax_class tc ON tc.id = ol.tax_class_id
                WHERE n.institute_id = :instituteId
                  AND n.document_date >= :from
                  AND n.document_date <= :to"""
                + noteFilters(f, p);
        jdbc.query(sql, p, (RowCallbackHandler) rs -> sink.accept(new NoteLine(
                rs.getString("note_id"),
                rs.getString("credit_note_number"),
                date(rs, "note_date"),
                money(rs, "note_total"),
                money(rs, "note_round_off"),
                rs.getString("buyer_gstin"),
                rs.getString("place_of_supply_state"),
                rs.getString("seller_gstin"),
                rs.getString("invoice_id"),
                rs.getString("invoice_number"),
                date(rs, "invoice_date"),
                rs.getString("invoice_document_type"),
                money(rs, "invoice_total"),
                rs.getString("invoice_buyer_gstin"),
                rs.getString("invoice_tax_head"),
                rs.getString("invoice_seller_state"),
                rs.getString("invoice_place_of_supply"),
                rs.getString("channel"),
                rs.getString("location_id"),
                rs.getString("location_code"),
                rs.getString("line_id"),
                rs.getString("item_type"),
                rs.getString("hsn_code"),
                rs.getString("unit"),
                money(rs, "tax_rate"),
                rs.getLong("quantity"),
                rs.getBigDecimal("unit_price"),
                intOrNull(rs, "qty_scale"),
                rs.getString("tax_class_name"),
                rs.getString("description"),
                money(rs, "taxable_value"),
                money(rs, "cgst"),
                money(rs, "sgst"),
                money(rs, "igst"),
                money(rs, "cess"),
                money(rs, "amount"))));
    }

    /** The stored snapshot JSON of invoices, by id (the buyer name of GSTR-1 rows). */
    public Map<String, String> snapshots(String instituteId, Collection<String> invoiceIds) {
        Map<String, String> out = new HashMap<>();
        List<String> ids = new ArrayList<>(invoiceIds);
        for (int start = 0; start < ids.size(); start += 500) {
            List<String> chunk = ids.subList(start, Math.min(ids.size(), start + 500));
            MapSqlParameterSource p = new MapSqlParameterSource("instituteId", instituteId).addValue("ids", chunk);
            jdbc.query("""
                    SELECT id, invoice_data_json
                    FROM invoice
                    WHERE institute_id = :instituteId
                      AND id IN (:ids)""", p, (RowCallbackHandler) rs -> out.put(rs.getString("id"),
                    rs.getString("invoice_data_json")));
        }
        return out;
    }

    // ================================================================== documents issued

    /** Invoices, credit notes and delivery challans dated in the range (GSTIN and location filters). */
    public void documentsInRange(DocFilter f, Consumer<DocumentRow> sink) {
        MapSqlParameterSource p = base(f);
        String sql = """
                SELECT 'INVOICE' AS doc_kind,
                       i.series_id,
                       i.invoice_number AS number,
                       i.external_invoice_number AS page,
                       i.document_date,
                       (i.cancelled_at IS NOT NULL) AS cancelled
                FROM invoice i
                WHERE i.institute_id = :instituteId
                  AND i.document_type IS NOT NULL
                  AND i.document_date >= :from
                  AND i.document_date <= :to"""
                + gstin(f, p, "i.seller_gstin")
                + location(f, p, "i.location_id")
                + """

                UNION ALL
                SELECT 'CREDIT_NOTE' AS doc_kind,
                       n.series_id,
                       n.credit_note_number AS number,
                       CAST(NULL AS VARCHAR) AS page,
                       n.document_date,
                       FALSE AS cancelled
                FROM commerce_credit_note n
                JOIN invoice i ON i.id = n.invoice_id
                WHERE n.institute_id = :instituteId
                  AND n.document_date >= :from
                  AND n.document_date <= :to"""
                + gstin(f, p, "n.seller_gstin")
                + location(f, p, "i.location_id")
                + """

                UNION ALL
                SELECT 'DELIVERY_CHALLAN' AS doc_kind,
                       t.document_series_id AS series_id,
                       t.document_number AS number,
                       CAST(NULL AS VARCHAR) AS page,
                       t.document_date,
                       FALSE AS cancelled
                FROM stock_transfer t
                WHERE t.institute_id = :instituteId
                  AND t.document_type = 'DELIVERY_CHALLAN'
                  AND t.document_number IS NOT NULL
                  AND t.document_date >= :from
                  AND t.document_date <= :to"""
                + gstin(f, p, "t.from_gstin")
                + location(f, p, "t.from_location_id");
        jdbc.query(sql, p, (RowCallbackHandler) rs -> sink.accept(documentRow(rs, rs.getString("doc_kind"))));
    }

    /** Series rows by id, with the location code and the register name. */
    public List<SeriesRow> series(String instituteId, Collection<String> seriesIds) {
        if (seriesIds.isEmpty()) {
            return List.of();
        }
        MapSqlParameterSource p = new MapSqlParameterSource("instituteId", instituteId)
                .addValue("ids", new ArrayList<>(seriesIds));
        return jdbc.query("""
                SELECT s.id, s.seller_gstin, s.location_id, sl.code AS location_code, s.register_id,
                       r.name AS register_name, s.channel, s.document_type, s.kind, s.prefix, s.financial_year,
                       s.next_value, s.book_from, s.book_to
                FROM commerce_document_series s
                LEFT JOIN stock_location sl ON sl.id = s.location_id
                LEFT JOIN pos_register r ON r.id = s.register_id
                WHERE s.institute_id = :instituteId
                  AND s.id IN (:ids)
                ORDER BY s.document_type, s.prefix, s.financial_year""", p, (rs, n) -> new SeriesRow(
                rs.getString("id"),
                rs.getString("seller_gstin"),
                rs.getString("location_id"),
                rs.getString("location_code"),
                rs.getString("register_id"),
                rs.getString("register_name"),
                rs.getString("channel"),
                rs.getString("document_type"),
                rs.getString("kind"),
                rs.getString("prefix"),
                rs.getString("financial_year"),
                rs.getLong("next_value"),
                longOrNull(rs, "book_from"),
                longOrNull(rs, "book_to")));
    }

    /** Every document ever numbered in these series (all dates): the gap and "not entered" checks. */
    public void seriesDocuments(String instituteId, Collection<String> seriesIds, Consumer<DocumentRow> sink) {
        if (seriesIds.isEmpty()) {
            return;
        }
        MapSqlParameterSource p = new MapSqlParameterSource("instituteId", instituteId)
                .addValue("ids", new ArrayList<>(seriesIds));
        jdbc.query("""
                SELECT 'INVOICE' AS doc_kind, i.series_id, i.invoice_number AS number,
                       i.external_invoice_number AS page, i.document_date, (i.cancelled_at IS NOT NULL) AS cancelled
                FROM invoice i
                WHERE i.institute_id = :instituteId
                  AND i.document_type IS NOT NULL
                  AND i.series_id IN (:ids)
                UNION ALL
                SELECT 'CREDIT_NOTE' AS doc_kind, n.series_id, n.credit_note_number AS number,
                       CAST(NULL AS VARCHAR) AS page, n.document_date, FALSE AS cancelled
                FROM commerce_credit_note n
                WHERE n.institute_id = :instituteId
                  AND n.series_id IN (:ids)
                UNION ALL
                SELECT 'DELIVERY_CHALLAN' AS doc_kind, t.document_series_id AS series_id,
                       t.document_number AS number, CAST(NULL AS VARCHAR) AS page, t.document_date,
                       FALSE AS cancelled
                FROM stock_transfer t
                WHERE t.institute_id = :instituteId
                  AND t.document_type = 'DELIVERY_CHALLAN'
                  AND t.document_number IS NOT NULL
                  AND t.document_series_id IN (:ids)""", p,
                (RowCallbackHandler) rs -> sink.accept(documentRow(rs, rs.getString("doc_kind"))));
    }

    // ================================================================== fragments

    private static MapSqlParameterSource base(DocFilter f) {
        return new MapSqlParameterSource()
                .addValue("instituteId", f.instituteId())
                .addValue("from", Date.valueOf(f.from()))
                .addValue("to", Date.valueOf(f.to()));
    }

    /** Seller GSTIN, location, channel and status on {@code invoice i}. */
    private static String invoiceFilters(DocFilter f, MapSqlParameterSource p) {
        StringBuilder sql = new StringBuilder();
        sql.append(gstin(f, p, "i.seller_gstin"));
        sql.append(location(f, p, "i.location_id"));
        sql.append(channel(f, p, "i.channel"));
        if ("ACTIVE".equals(f.status())) {
            sql.append("\n  AND i.cancelled_at IS NULL");
        } else if ("CANCELLED".equals(f.status())) {
            sql.append("\n  AND i.cancelled_at IS NOT NULL");
        }
        return sql.toString();
    }

    /** Seller GSTIN on the note; location and channel of its invoice {@code i}. */
    private static String noteFilters(DocFilter f, MapSqlParameterSource p) {
        return gstin(f, p, "n.seller_gstin") + location(f, p, "i.location_id") + channel(f, p, "i.channel");
    }

    static String gstin(DocFilter f, MapSqlParameterSource p, String column) {
        if (f.sellerGstin() == null) {
            return "";
        }
        p.addValue("sellerGstin", f.sellerGstin());
        return "\n  AND " + column + " = :sellerGstin";
    }

    static String location(DocFilter f, MapSqlParameterSource p, String column) {
        if (f.locationIn() == null) {
            return "";
        }
        if (f.locationIn().isEmpty()) {
            return "\n  AND FALSE";
        }
        p.addValue("locationIds", new ArrayList<>(f.locationIn()));
        return "\n  AND " + column + " IN (:locationIds)";
    }

    static String channel(DocFilter f, MapSqlParameterSource p, String column) {
        if (f.channel() == null) {
            return "";
        }
        p.addValue("channel", f.channel());
        return "\n  AND " + column + " = :channel";
    }

    static String keyset(Keyset after, MapSqlParameterSource p, String dateColumn, String numberColumn,
                         String idColumn) {
        if (after == null) {
            return "";
        }
        p.addValue("cursorDate", Date.valueOf(after.date()));
        p.addValue("cursorNumber", after.number());
        p.addValue("cursorId", after.id());
        return "\n  AND (" + dateColumn + ", " + numberColumn + ", " + idColumn
                + ") > (:cursorDate, :cursorNumber, :cursorId)";
    }

    private static String limit(Integer limit, MapSqlParameterSource p) {
        if (limit == null) {
            return "";
        }
        p.addValue("pageLimit", limit);
        return "\n    LIMIT :pageLimit";
    }

    private static DocumentRow documentRow(ResultSet rs, String kind) throws SQLException {
        return new DocumentRow(kind, rs.getString("series_id"), rs.getString("number"), rs.getString("page"),
                date(rs, "document_date"), rs.getBoolean("cancelled"));
    }

    private static LocalDate date(ResultSet rs, String column) throws SQLException {
        Date value = rs.getDate(column);
        return value == null ? null : value.toLocalDate();
    }

    private static BigDecimal money(ResultSet rs, String column) throws SQLException {
        BigDecimal value = rs.getBigDecimal(column);
        return value == null ? BigDecimal.ZERO : value;
    }

    private static Integer intOrNull(ResultSet rs, String column) throws SQLException {
        int value = rs.getInt(column);
        return rs.wasNull() ? null : value;
    }

    private static Long longOrNull(ResultSet rs, String column) throws SQLException {
        long value = rs.getLong(column);
        return rs.wasNull() ? null : value;
    }

    private static BigDecimal dec(Object value) {
        if (value == null) {
            return BigDecimal.ZERO;
        }
        return value instanceof BigDecimal decimal ? decimal : new BigDecimal(value.toString());
    }

    private static long num(Object value) {
        return value == null ? 0L : ((Number) value).longValue();
    }
}
