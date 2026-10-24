package vacademy.io.admin_core_service.features.invoice.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class InvoiceDTO {
    private String id;
    private String invoiceNumber;
    private String userPlanId;
    private String paymentLogId; // Primary payment log ID (for backward compatibility)
    private List<String> paymentLogIds; // All payment log IDs
    private String userId;
    private String instituteId;
    private LocalDateTime invoiceDate;
    private LocalDateTime dueDate;
    private BigDecimal subtotal;
    private BigDecimal discountAmount;
    /**
     * Admin who gave the discount on this invoice — the admin who created an admin invoice
     * with a discount, or the admin who discounted the enrollment the invoice bills.
     * Admin API only: {@link #withoutInternalDiscountNotes()} strips it for learners/parents.
     */
    private String discountGrantedByUserId;
    /** The granting admin's internal reason. Admin API only — never shown to learners. */
    private String discountReason;
    private BigDecimal taxAmount;
    private BigDecimal totalAmount;
    private String currency;
    private String status;
    private String pdfFileId; // File ID reference to media service
    private String pdfUrl; // Computed URL (for convenience, retrieved from file ID)
    /**
     * Learner-facing payment link for PENDING_PAYMENT admin invoices (the page on
     * the learner portal where they can pay via gateway). Null for non-pending
     * statuses + synthetic SFP-derived rows. Same value the create response
     * exposes — surfaced on the list so the Copy Link button on the Invoices
     * section can copy without a separate fetch.
     */
    private String paymentLink;
    private Boolean taxIncluded;
    private String source;
    private String sourceId;
    // Admin-entered notes (from invoice_data_json), if any — used by the frontend
    // "Duplicate" action to prefill a new Create-Invoice dialog from this invoice.
    private String notes;
    /**
     * True while this document is still an unpaid PROFORMA — it carries a number from the
     * institute's separate proforma series, not from its real invoice series, and only
     * becomes a numbered invoice when it is paid.
     */
    private Boolean proforma;
    /**
     * Per-installment rows only: what has been paid on the installment so far. Set on an
     * installment still owing money, whose row shows the balance as its amount.
     */
    private BigDecimal amountPaid;
    /**
     * Per-installment rows only: the latest receipt for money paid on an installment that
     * still owes some. The row keeps its own (DUE/PARTIAL) label — under the receipt's number
     * its balance read as if it were the receipt's amount.
     */
    private String receiptNumber;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private List<InvoiceLineItemDTO> lineItems;

    /** Copy for learner/parent-facing responses: drops the admin-only discount notes. */
    public InvoiceDTO withoutInternalDiscountNotes() {
        this.discountGrantedByUserId = null;
        this.discountReason = null;
        return this;
    }
}


