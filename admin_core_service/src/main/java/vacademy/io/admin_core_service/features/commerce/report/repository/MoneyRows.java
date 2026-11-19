package vacademy.io.admin_core_service.features.commerce.report.repository;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * The rows {@link MoneyReportRepository} hands to the money, counter and sales reports. Money is
 * never null (0 instead). Times are India wall times as text {@code yyyy-MM-dd HH:mm}.
 */
public final class MoneyRows {

    private MoneyRows() {
    }

    /** A location: id, code, name. */
    public record Location(String id, String code, String name) {
    }

    /**
     * One money event of the day book and payment modes.
     *
     * @param source   TENDER, REFUND or CASH_MOVEMENT
     * @param kind     SALE_PAYMENT, RECEIPT_ON_CREDIT, COD_COLLECTED, CREDIT_NOTE_USED (no money),
     *                 REFUND_PAID, EXCHANGE_CREDIT (no money), CASH_IN, CASH_OUT
     * @param day      the India day it counts on
     * @param time     India time of the entry ({@code yyyy-MM-dd HH:mm})
     * @param typedDay a day typed by the staff (remittance date, refund paid-on date, cash movement
     *                 date), when there is one: the event has no time of its own
     * @param mode     tender mode, refund method, or CASH for a cash movement
     */
    public record MoneyRow(String source, String kind, String id, LocalDate day, String time, LocalDate typedDay,
                           String mode, BigDecimal amount, String number, String party, String staffId,
                           String locationId, String reference) {
    }

    /** One document of the day book: an invoice (live or cancelled) or a credit note. */
    public record DocumentRow(String kind, String id, LocalDate day, String time, LocalDate enteredOn,
                              String number, String paperNumber, String documentType, BigDecimal value,
                              boolean cancelled, String party, String orderNumber, String staffId,
                              String locationId) {
    }

    /** A counter session as the day book footer and the sessions report read it. */
    public record SessionRow(String id, String status, LocalDate openedDay, String openedAt, String openedAtRaw,
                             String closedAt, String registerCode, String registerName, String locationId,
                             String cashierId, BigDecimal openingCash, BigDecimal expectedCash,
                             BigDecimal countedCash, BigDecimal variance, BigDecimal expectedSoFar,
                             String closeNote, String zReportJson) {
    }

    /** An order with money received in the range and no live invoice at the range end. */
    public record PaidNotInvoicedRow(String orderId, String orderNumber, LocalDate orderDate, String channel,
                                     String status, String customer, String locationId, BigDecimal received) {
    }

    /** A cash-on-delivery order (outstanding or in transit). */
    public record CodOrderRow(String orderId, String orderNumber, LocalDate orderDate, String customer, String phone,
                              String courier, String trackingNumber, LocalDate shippedOn, LocalDate deliveredOn,
                              BigDecimal codAmount, String locationId) {
    }

    /** A courier remittance. */
    public record RemittanceRow(String id, LocalDate receivedOn, String reference, String courier, int orders,
                                BigDecimal ordersTotal, BigDecimal gross, BigDecimal deductions, BigDecimal net,
                                String differenceReason) {
    }

    /** Orders shipped in the range by payment method, and how many of them came back (RTO). */
    public record RtoRow(String paymentMethod, long shipped, long rto) {
    }

    /** A staff order with money still due. */
    public record DueRow(String orderId, String orderNumber, LocalDate orderDate, String customer, String phone,
                         BigDecimal total, BigDecimal received, BigDecimal creditedByReturns, String locationId) {
    }

    /** Dues totals over the whole filter. */
    public record DueTotals(long orders, long customers, BigDecimal total, BigDecimal received,
                            BigDecimal creditedByReturns, BigDecimal due, long reducedByReturns) {
    }

    /**
     * One document of the sales report: a live invoice (kind INVOICE, with its line sums) or a
     * credit note (kind NOTE, total only), with the facts the grouping needs.
     */
    public record SalesDocument(String kind, String id, LocalDate day, String channel, String locationId,
                                String orderChannel, String staffId, String paymentMethod, BigDecimal total,
                                BigDecimal roundOff, BigDecimal taxable, BigDecimal tax, BigDecimal lineAmount,
                                BigDecimal discount, long items) {
    }

    /**
     * One item line of a live invoice (kind INVOICE) or of a credit note (kind NOTE), with the
     * product it sold. {@code quantity} is in base units; {@code qtyScale} null when unknown.
     */
    public record ProductLine(String kind, String documentId, String packageSessionId, String packageId,
                              String productName, String variantName, String sku, long quantity, Integer qtyScale,
                              String unit, BigDecimal amount, BigDecimal taxable) {
    }

    /** An ACTIVE product (for the "never sold" block). */
    public record ActiveProduct(String packageId, String productName, String unit, String sku) {
    }

    /** A product's current membership of a collection or category. */
    public record Membership(String packageId, String collectionId, String collectionName) {
    }
}
