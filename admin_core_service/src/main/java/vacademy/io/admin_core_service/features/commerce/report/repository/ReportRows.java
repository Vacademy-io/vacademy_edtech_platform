package vacademy.io.admin_core_service.features.commerce.report.repository;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Set;

/** The rows {@link ReportReadRepository} hands to the report services. Money is never null (0 instead). */
public final class ReportRows {

    private ReportRows() {
    }

    /**
     * What every document query filters on, besides the institute.
     *
     * @param sellerGstin null for any
     * @param locationIn  null for no restriction; else the location must be one of these (empty: none)
     * @param channel     null for any
     * @param status      ACTIVE, CANCELLED or null (sales register only)
     */
    public record DocFilter(String instituteId, LocalDate from, LocalDate to, String sellerGstin,
                            Set<String> locationIn, String channel, String status) {
    }

    /** The keyset of a register page: the last document of the previous page. */
    public record Keyset(LocalDate date, String number, String id) {
    }

    /** Sales register: one invoice × HSN × rate group; {@code groupNo} 1 is the invoice's first row. */
    public record SalesRegisterRow(String invoiceId, String invoiceNumber, String paperNumber, LocalDate documentDate,
                                   String documentType, String channel, String locationCode, String orderNumber,
                                   String buyerGstin, String placeOfSupply, String sellerGstin,
                                   BigDecimal invoiceTotal, BigDecimal roundOff, boolean cancelled,
                                   LocalDate cancelledOn, int groupNo, String snapshotJson, String paymentModes,
                                   String hsn, BigDecimal rate, BigDecimal taxable, BigDecimal cgst, BigDecimal sgst,
                                   BigDecimal igst, BigDecimal cess) {
    }

    /** Sales register totals: line sums and header sums over live invoices, and the cancelled ones apart. */
    public record SalesRegisterTotals(BigDecimal taxable, BigDecimal cgst, BigDecimal sgst, BigDecimal igst,
                                      BigDecimal cess, BigDecimal roundOff, BigDecimal invoiceTotal, long invoices,
                                      long cancelledInvoices, BigDecimal cancelledTotal) {
    }

    /**
     * Credit-note register: one note × HSN × rate × unit × scale × unit price group; {@code groupNo}
     * 1 is the note's first row. {@code qtyScale} is null when neither the order line nor the
     * invoice snapshot knows it.
     */
    public record CreditNoteRow(String noteId, String noteNumber, LocalDate noteDate, String invoiceNumber,
                                LocalDate invoiceDate, String returnNumber, String buyerGstin, String placeOfSupply,
                                String reason, String channel, String locationCode, String sellerGstin,
                                BigDecimal noteTotal, BigDecimal roundOff, int groupNo, String hsn, BigDecimal rate,
                                String unit, BigDecimal unitPrice, Integer qtyScale, boolean service, long quantity,
                                BigDecimal taxable, BigDecimal cgst, BigDecimal sgst, BigDecimal igst,
                                BigDecimal cess, BigDecimal amount) {
    }

    /** Credit-note register totals. */
    public record CreditNoteTotals(BigDecimal taxable, BigDecimal cgst, BigDecimal sgst, BigDecimal igst,
                                   BigDecimal cess, BigDecimal amount, BigDecimal roundOff, BigDecimal noteTotal,
                                   long notes) {
    }

    /** One line of a live invoice, with its invoice's fields (tax by rate, HSN, GSTR-1). */
    public record InvoiceLine(String invoiceId, String invoiceNumber, LocalDate documentDate, String documentType,
                              String channel, String locationId, String locationCode, String buyerGstin,
                              String placeOfSupply, String sellerGstin, String sellerState, String taxHead,
                              BigDecimal invoiceTotal, BigDecimal roundOff, String lineId, String itemType,
                              String hsn, String unit, BigDecimal rate, long quantity, Integer qtyScale,
                              String taxClassName, String description, BigDecimal taxable, BigDecimal cgst,
                              BigDecimal sgst, BigDecimal igst, BigDecimal cess, BigDecimal amount) {
    }

    /** One credit-note line, with its note's and its invoice's fields. */
    public record NoteLine(String noteId, String noteNumber, LocalDate noteDate, BigDecimal noteTotal,
                           BigDecimal noteRoundOff, String buyerGstin, String placeOfSupply, String sellerGstin,
                           String invoiceId, String invoiceNumber, LocalDate invoiceDate, String invoiceDocumentType,
                           BigDecimal invoiceTotal, String invoiceBuyerGstin, String invoiceTaxHead,
                           String invoiceSellerState, String invoicePlaceOfSupply, String channel,
                           String locationId, String locationCode, String lineId, String itemType, String hsn,
                           String unit, BigDecimal rate, long quantity, BigDecimal unitPrice, Integer qtyScale,
                           String taxClassName, String description, BigDecimal taxable, BigDecimal cgst,
                           BigDecimal sgst, BigDecimal igst, BigDecimal cess, BigDecimal amount) {
    }

    /** A numbered document: kind INVOICE, CREDIT_NOTE or DELIVERY_CHALLAN; {@code page} is a paper bill's page. */
    public record DocumentRow(String kind, String seriesId, String number, String page, LocalDate date,
                              boolean cancelled) {
    }

    /** A document series row with its location code and register name. */
    public record SeriesRow(String id, String sellerGstin, String locationId, String locationCode,
                            String registerId, String registerName, String channel, String documentType,
                            String kind, String prefix, String financialYear, long nextValue, Long bookFrom,
                            Long bookTo) {
    }
}
