package vacademy.io.admin_core_service.features.commerce.pos.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.math.BigDecimal;
import java.util.Date;
import java.util.List;
import java.util.Map;

/**
 * Requests and answers of the billing counter ({@code /commerce/v1/pos}). Field names are snake
 * case, nulls are left out (except where an explicit null means "none"). Money is
 * {@link BigDecimal}. No answer here carries a cost, a standard cost, a tax class id or the
 * sellable count of the website.
 */
public final class PosDtos {

    private PosDtos() {
    }

    // ================================================================== shared

    /** A manager's PIN given with a request (the admin app's {@code ManagerApproval}). */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Approval(String approverUserId, String pin, String reason) {

        /** Never prints the PIN (the records that carry an approval print it through this). */
        @Override
        public String toString() {
            return "Approval[approverUserId=" + approverUserId + ", pin=" + (pin == null ? "null" : "***")
                    + ", reason=" + reason + "]";
        }
    }

    // ================================================================== registers

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record RegisterCreateRequest(String clientRequestId, String locationId, String code, String name,
                                        String invoicePrefix, Long invoiceNextValue) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record RegisterUpdateRequest(String clientRequestId, String name, String status) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record OpenSessionRef(String id, String cashierUserId, String cashierName, Date openedAt, boolean mine) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record RegisterView(String id, String code, String name, String locationId, String locationName,
                               String status,
                               @JsonInclude(JsonInclude.Include.ALWAYS) OpenSessionRef openSession,
                               List<String> setupWarnings) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record RegistersAnswer(List<RegisterView> registers) {
    }

    // ================================================================== settings, approvers

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SettingsRequest(BigDecimal cashierDiscountPercent, BigDecimal cashRefundLimit,
                                  BigDecimal cashVarianceLimit) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SettingsView(BigDecimal cashierDiscountPercent, BigDecimal cashRefundLimit,
                               BigDecimal cashVarianceLimit, boolean configured) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Approver(String userId, String fullName) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ApproversAnswer(List<Approver> approvers) {
    }

    // ================================================================== catalogue, scan, customer

    /** One sellable variant as the till shows it: the price the sale charges, never a cost. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record CatalogueItem(String variantId, String productId, String sku, String labelCode, String barcode,
                                Map<String, String> names, Map<String, String> variantLabel, String unit,
                                int qtyScale, int qtyStep, String stockMode, boolean tracked, BigDecimal unitPrice,
                                BigDecimal mrp, String currency, Integer onHand) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record CatalogueAnswer(String registerId, String locationId, Date generatedAt, boolean truncated,
                                  List<CatalogueItem> items) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ScanPiece(String id, String code, String status, boolean here) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ScanAnswer(String kind, CatalogueItem item, ScanPiece piece) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record CustomerLookupAnswer(boolean found, String name) {
    }

    // ================================================================== sessions

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SessionOpenRequest(String clientRequestId, String registerId, BigDecimal openingCash,
                                     String openingNote) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record CashMovementRequest(String clientRequestId, String type, BigDecimal amount, String reason) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SessionCloseRequest(String clientRequestId, BigDecimal countedCash,
                                      Map<String, Integer> denominations, String note, Approval approval) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Ref(String id, String code, String name) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record CashMovementView(String id, String type, BigDecimal amount, String reason, String actorUserId,
                                   Date createdAt) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record CountTotal(int count, BigDecimal total) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ModeTotal(String mode, int count, BigDecimal amount) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record MethodTotal(String method, int count, BigDecimal amount) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record TaxRow(BigDecimal rate, BigDecimal taxable, BigDecimal cgst, BigDecimal sgst, BigDecimal igst,
                         BigDecimal cess) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ReturnsTotal(int count, BigDecimal credit) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record NamedRef(String code, String name) {
    }

    /**
     * The day report of a session: frozen into {@code z_report_json} at close, the same shape
     * computed live ({@code summary}) while the session is open. {@code bills} are the sales
     * keyed at the till that are not voided; voided bills and bill-book entries are counted
     * apart ({@code voided}, {@code bill_book}). {@code refunds} are the refunds paid
     * (PROCESSED); {@code refunds_pending} the ones recorded but not yet paid (PENDING or
     * IN_PROGRESS, e.g. a UPI refund with no reference yet).
     */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ZReport(String sessionId, NamedRef register, NamedRef location, String cashierUserId,
                          Date openedAt, Date closedAt, BigDecimal openingCash, CountTotal bills, CountTotal voided,
                          BigDecimal discounts, List<ModeTotal> byMode, List<TaxRow> taxByRate,
                          List<MethodTotal> refunds, ReturnsTotal returns, BigDecimal cashIn, BigDecimal cashOut,
                          BigDecimal expectedCash, BigDecimal countedCash, BigDecimal variance,
                          Map<String, Integer> denominations, CountTotal billBook, String firstInvoiceNumber,
                          String lastInvoiceNumber, List<MethodTotal> refundsPending) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SessionView(String id, String status, Ref register, Ref location, String cashierUserId,
                              String cashierName, boolean mine, Date openedAt, BigDecimal openingCash,
                              String openingNote, BigDecimal previousCountedCash, Date closedAt, String closedBy,
                              BigDecimal expectedCash, BigDecimal countedCash, BigDecimal variance, String closeNote,
                              Map<String, Integer> denominations, List<CashMovementView> cashMovements,
                              ZReport summary, ZReport zReport, List<String> nextActions) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record CurrentSessionAnswer(SessionView session) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SessionRow(String id, String status, String registerCode, String locationName,
                             String cashierUserId, Date openedAt, Date closedAt, int billsCount,
                             BigDecimal billsTotal, BigDecimal variance, String cashierName) {

        /** The same row with the cashier's name (null when the account service did not answer). */
        public SessionRow withCashierName(String name) {
            return new SessionRow(id, status, registerCode, locationName, cashierUserId, openedAt, closedAt,
                    billsCount, billsTotal, variance, name);
        }
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SessionsPage(List<SessionRow> sessions, int page, int pageSize, long total) {
    }

    /** One bill in a list (the session's bills; the returns lookup). */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SaleRow(String orderId, String orderNumber, String channel, String status, String invoiceNumber,
                          java.time.LocalDate documentDate, String locationName, BigDecimal total,
                          String customerName, String phoneLast4, Date createdAt, List<String> tenderModes) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SalesPage(List<SaleRow> sales, int page, int pageSize, long total) {
    }

    // ================================================================== quote and sale

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SaleLine(String lineRef, String variantId, Integer quantity, List<String> pieceIds,
                           BigDecimal lineDiscount, BigDecimal unitPrice) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record BillDiscount(String kind, BigDecimal value, String reason) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Customer(String phone, String name, String buyerGstin, String buyerLegalName) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Tender(String mode, BigDecimal amount, BigDecimal cashTendered, String reference) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record RemainderRefund(String method, String reference) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Exchange(String returnId, RemainderRefund remainderRefund) {
    }

    /**
     * The body of {@code POST /pos/sales}, {@code POST /pos/quote} (without the key, tenders and
     * approval) and {@code POST /pos/bill-book-entries} (with {@code book_number} and
     * {@code document_date}). {@code discount_reason} is the reason of the bill's discounts when
     * {@code bill_discount} carries none (a bill with line discounts only). {@code paper_bill} is
     * for a quote only: true prices the bill as the bill-book entry will (a paper bill written by
     * hand is keyed in as cut, so the sale step is not applied).
     */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SaleRequest(String clientRequestId, String sessionId, List<SaleLine> lines,
                              BillDiscount billDiscount, Customer customer, List<Tender> tenders, Exchange exchange,
                              Approval approval,
                              @com.fasterxml.jackson.annotation.JsonProperty("notify") Boolean notifyBuyer,
                              String bookNumber, String documentDate, String discountReason, Boolean paperBill) {

        /** A body that is not a paper-bill quote. */
        public SaleRequest(String clientRequestId, String sessionId, List<SaleLine> lines,
                           BillDiscount billDiscount, Customer customer, List<Tender> tenders, Exchange exchange,
                           Approval approval, Boolean notifyBuyer, String bookNumber, String documentDate,
                           String discountReason) {
            this(clientRequestId, sessionId, lines, billDiscount, customer, tenders, exchange, approval, notifyBuyer,
                    bookNumber, documentDate, discountReason, null);
        }

        /** A body without a top-level discount reason. */
        public SaleRequest(String clientRequestId, String sessionId, List<SaleLine> lines,
                           BillDiscount billDiscount, Customer customer, List<Tender> tenders, Exchange exchange,
                           Approval approval, Boolean notifyBuyer, String bookNumber, String documentDate) {
            this(clientRequestId, sessionId, lines, billDiscount, customer, tenders, exchange, approval, notifyBuyer,
                    bookNumber, documentDate, null);
        }

        /** The same body without the PIN: what the request hash is taken over. */
        public SaleRequest withoutApproval() {
            return new SaleRequest(clientRequestId, sessionId, lines, billDiscount, customer, tenders, exchange, null,
                    notifyBuyer, bookNumber, documentDate, discountReason, paperBill);
        }
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record QuoteLine(String lineRef, String variantId, int quantity, BigDecimal unitPrice, BigDecimal gross,
                            BigDecimal discount, BigDecimal net, BigDecimal taxableValue, BigDecimal taxRate,
                            BigDecimal taxAmount) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Unavailable(String lineRef, String reason) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record PriceChange(String lineRef, String variantId, String type, String reason, BigDecimal oldUnitPrice,
                              BigDecimal newUnitPrice) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Totals(BigDecimal subtotal, BigDecimal discount, BigDecimal tax, BigDecimal roundOff,
                         BigDecimal total) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Quote(List<QuoteLine> lines, List<Unavailable> unavailable, List<PriceChange> changes,
                        Totals totals, List<TaxRow> taxRows, BigDecimal discountPercent,
                        BigDecimal cashierDiscountPercent, List<String> needsApproval, BigDecimal exchangeCredit) {
    }

    // ================================================================== sale detail and receipt

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record DocumentRef(String id, String number, String type, java.time.LocalDate date, boolean cancelled) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SaleCustomer(String name, String phoneLast4, String buyerGstin) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SaleDetailLine(String orderLineId, int lineNo, String variantId, String sku, String name,
                                 String variantLabel, String unit, int qtyScale, int quantity, BigDecimal unitPrice,
                                 BigDecimal mrp, BigDecimal discount, BigDecimal taxableValue, BigDecimal taxRate,
                                 BigDecimal taxAmount, BigDecimal lineTotal, List<String> pieceIds,
                                 List<String> pieceCodes, int qtyReturned, int returnable) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SaleTotals(BigDecimal subtotal, BigDecimal discount, BigDecimal tax, BigDecimal roundOff,
                             BigDecimal total, BigDecimal amountPaid, BigDecimal amountRefunded) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SaleTender(String id, String mode, BigDecimal amount, String reference, String status,
                             BigDecimal cashTendered) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SaleReturn(String id, String number, String status, BigDecimal credit) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SaleDetail(String orderId, String orderNumber, String channel, String status, String sessionId,
                             String registerId, String locationId, DocumentRef document, SaleCustomer customer,
                             List<SaleDetailLine> lines, SaleTotals totals, List<SaleTender> tenders,
                             BigDecimal changeDue, List<SaleReturn> returns, List<String> nextActions) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ReceiptShop(String tradeName, String legalName, String gstin, List<String> addressLines,
                              String phone) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ReceiptLocation(String name, String stateCode) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ReceiptDocument(String type, String number, java.time.LocalDate date, Date issuedAt,
                                  boolean cancelled, String cancelReason, boolean paper) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ReceiptCustomer(String name, String phoneLast4, String buyerGstin, String buyerLegalName) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ReceiptLine(String name, String variantLabel, int quantity, int qtyScale, String unit,
                              BigDecimal unitPrice, BigDecimal discount, BigDecimal net, String hsnCode,
                              BigDecimal taxRate) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ReceiptTender(String mode, BigDecimal amount, String reference, String status) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Receipt(ReceiptShop shop, ReceiptLocation location, NamedRef register, ReceiptDocument document,
                          String orderNumber, ReceiptCustomer customer, List<ReceiptLine> lines,
                          List<TaxRow> taxRows, Totals totals, String amountInWords, List<ReceiptTender> tenders,
                          BigDecimal cashTendered, BigDecimal change, String qrText) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SaleAnswer(SaleDetail sale, Receipt receipt, boolean replayed) {
    }

    // ================================================================== corrections (void, tender change)

    /** {@code POST /pos/sales/{orderId}/void}. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record VoidRequest(String clientRequestId, String reason, Approval approval) {

        public VoidRequest withoutApproval() {
            return new VoidRequest(clientRequestId, reason, null);
        }
    }

    /** {@code POST /pos/sales/{orderId}/tenders/{tenderId}/change}. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record TenderChangeRequest(String clientRequestId, String mode, String reference, Approval approval) {

        public TenderChangeRequest withoutApproval() {
            return new TenderChangeRequest(clientRequestId, mode, reference, null);
        }
    }

    // ================================================================== sale lookup

    /** {@code GET /pos/sales/lookup}: at most 10 delivered bills, newest first. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SalesLookup(List<SaleRow> sales) {
    }

    // ================================================================== counter returns

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ReturnLine(String orderLineId, Integer quantity, String condition, List<String> pieceIds) {
    }

    /** {@code POST /pos/returns/preview}; {@code reason} is optional here. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ReturnPreviewRequest(String sessionId, String orderId, List<ReturnLine> lines, String reason,
                                       Settle settle) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Returnable(String orderLineId, int returnable) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ReturnPreview(List<Returnable> returnable, List<String> warnings,
                                vacademy.io.admin_core_service.features.commerce.returns.dto.ReturnDtos.Policy policy,
                                BigDecimal creditEstimate, List<String> needsApproval) {
    }

    /** How a counter return is settled: money back (CASH, UPI, BANK_TRANSFER) or credit for a new bill. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Settle(String kind, String method, String reference) {
    }

    /** {@code POST /pos/returns}. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ReturnRequest(String clientRequestId, String sessionId, String orderId, List<ReturnLine> lines,
                                String reason, String reasonNote, String overrideReason, Settle settle,
                                Approval approval) {

        public ReturnRequest withoutApproval() {
            return new ReturnRequest(clientRequestId, sessionId, orderId, lines, reason, reasonNote, overrideReason,
                    settle, null);
        }
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record RefundRef(String id, String method, BigDecimal amount, String status) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ReturnAnswer(String returnId, String returnNumber, String creditNoteId, String creditNoteNumber,
                               BigDecimal credit, RefundRef refund, BigDecimal exchangeCredit, boolean replayed) {
    }
}
