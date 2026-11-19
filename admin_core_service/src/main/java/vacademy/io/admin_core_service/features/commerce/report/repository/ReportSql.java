package vacademy.io.admin_core_service.features.commerce.report.repository;

/**
 * SQL predicates every report repository shares, so one rule decides what a report counts.
 *
 * <p><b>A bill reissued with the buyer's GSTIN</b> ({@code CommerceInvoiceService.reissueAsB2b})
 * leaves three documents: the first invoice (still live), a full credit note against it whose
 * {@code client_request_id} is {@code REISSUE:<first invoice id>}, and a new invoice on the same
 * order whose snapshot names the first one ({@code replaces_invoice_number}). The GST reports
 * (registers, GSTR-1, HSN, tax by rate, documents issued) list all three: that is how they were
 * issued and filed. Every other report counts the sale once: it keeps the first invoice (so a
 * later reissue never moves a sale between periods) and leaves out the reissue note and the
 * invoice that replaces the bill.
 *
 * <p>Every fragment starts and ends with a space, so it never glues to the text around it.
 */
public final class ReportSql {

    /** The credit-note key a reissue writes, before the first invoice's id. */
    public static final String REISSUE_KEY = "REISSUE:";

    private ReportSql() {
    }

    /**
     * True for an invoice {@code i} that does NOT replace a reissued bill: no other invoice of its
     * order carries a reissue credit note and is the number this invoice's snapshot replaces.
     *
     * <p>Driven by the reissue notes of the institute (few; the request-key prefix), joined to their
     * invoice by id and to {@code i} by order. The snapshot is read only for an invoice whose order
     * has such a note: {@code IS NOT DISTINCT FROM} is not a hash key, so the planner never parses
     * every snapshot.
     */
    public static String notReissueReplacement(String i) {
        return " NOT EXISTS (SELECT 1 FROM commerce_credit_note rn"
                + " JOIN invoice ro ON ro.id = rn.invoice_id"
                + " WHERE rn.institute_id = " + i + ".institute_id"
                + " AND rn.client_request_id LIKE '" + REISSUE_KEY + "%'"
                + " AND rn.client_request_id = '" + REISSUE_KEY + "' || rn.invoice_id"
                + " AND ro.commerce_order_id = " + i + ".commerce_order_id"
                + " AND ro.id <> " + i + ".id"
                + " AND ro.invoice_number IS NOT DISTINCT FROM ("
                + i + ".invoice_data_json::jsonb ->> 'replaces_invoice_number')) ";
    }

    /** True for a credit note {@code n} that is not the full note a reissue wrote against the first invoice. */
    public static String notReissueNote(String n) {
        return " COALESCE(" + n + ".client_request_id, '') <> '" + REISSUE_KEY + "' || " + n + ".invoice_id ";
    }

    /**
     * A live sale for the management reports: invoice {@code i} not cancelled and not the
     * replacement of a reissued bill.
     */
    public static String liveSale(String i) {
        return " " + i + ".cancelled_at IS NULL AND" + notReissueReplacement(i);
    }
}
