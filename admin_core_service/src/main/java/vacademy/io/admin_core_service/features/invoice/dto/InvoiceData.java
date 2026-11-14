package vacademy.io.admin_core_service.features.invoice.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLogLineItem;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.institute.entity.Institute;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * Internal data structure for building invoice information
 * Used during invoice generation process
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class InvoiceData {
    // User information
    private UserDTO user;
    
    // Institute information
    private Institute institute;
    
    // Plan information
    private UserPlan userPlan;
    private PaymentPlan paymentPlan;
    
    // Payment information
    private PaymentLog paymentLog;
    /**
     * Every payment this invoice covers. More than one course (an admission package) makes the
     * receipt figures (fees, paid, due, next installment) cover all of them, not just the first.
     */
    private List<PaymentLog> receiptPaymentLogs;
    private List<PaymentLogLineItem> paymentLogLineItems;
    
    // Invoice details
    private String invoiceNumber;
    /**
     * Sequence position behind {@link #invoiceNumber}, and the reset window it belongs to.
     * These ARE the institute's counter (it lives on the invoice rows, not in a side table),
     * so they must reach the saved {@code Invoice} — an invoice persisted without them is
     * invisible to the next allocation and its number would eventually be handed out again.
     * Null for an admin-supplied override or the uniqueness fallback, which deliberately
     * do not move the counter.
     */
    private Long seqNo;
    private String seqScopeKey;
    /**
     * Heading the PDF prints, via {@code {{document_title}}} — "INVOICE" for a real invoice,
     * "PROFORMA INVOICE" while the document is still an unpaid proforma. Null renders as
     * "INVOICE", which is what every existing caller wants.
     */
    private String documentTitle;
    /**
     * Label printed beside {@link #invoiceNumber}, via {@code {{document_number_label}}}.
     * "Proforma Number" while the document is a proforma, "Invoice Number" once it is a real
     * invoice — so a number that is going to change is never presented as an invoice number.
     * Null renders as "Invoice Number".
     */
    private String documentNumberLabel;
    /**
     * The proforma number this invoice was issued as, once it has been paid and finalized.
     * Rendered by {@code {{proforma_reference}}} so the final invoice visibly points back at
     * the proforma the customer is holding. Null on everything else.
     */
    private String proformaNumber;
    private LocalDateTime invoiceDate;
    private LocalDateTime dueDate;
    
    // Financial details
    private BigDecimal planPrice;
    private BigDecimal discountAmount;
    private BigDecimal taxAmount;
    private BigDecimal subtotal;
    private BigDecimal totalAmount;
    private String currency;
    
    // Tax configuration
    private Boolean taxIncluded;
    private BigDecimal taxRate;
    private String taxLabel;
    
    // Payment details
    private String paymentMethod;
    private String transactionId;
    private LocalDateTime paymentDate;
    
    // Line items for template
    private List<InvoiceLineItemData> lineItems;

    // Free-text notes shown in the invoice (maps to {{notes}}).
    private String notes;

    /**
     * Admin-supplied per-invoice overrides for editable text placeholders, keyed by
     * placeholder name (e.g. {@code user_name}, {@code institute_address},
     * {@code invoice_number}, {@code tax_label}). When present for a key,
     * {@link vacademy.io.admin_core_service.features.invoice.service.InvoiceService#replaceTemplatePlaceholders}
     * uses the override (HTML-escaped) instead of the value derived from the user /
     * institute / settings. Derived amounts ({@code subtotal}/{@code tax_amount}/
     * {@code total_amount}) and HTML placeholders ({@code line_items}, {@code institute_logo})
     * are never overridable. Null / empty means "no overrides — derive everything".
     */
    private Map<String, String> overrides;

    /**
     * Aggregated tax-component breakdown for the {{tax_components}} placeholder,
     * computed per line item by package type and summed across the invoice. Each
     * entry holds: label, rate (percent), amount. Null/empty when no tax components
     * are configured (the legacy single-rate tax path is used instead).
     */
    private List<Map<String, Object>> aggregatedTaxComponents;

    /**
     * Remembered per-user billing details (from invoice_billing_profile), keyed by
     * placeholder name (user_name, user_email, user_address, user_tax_info,
     * place_of_supply). When present, these seed the editable DEFAULTS for the billed
     * user in the preview — taking precedence over the raw auth-service user record —
     * so the admin doesn't re-type them. Null when the user has no saved profile.
     */
    private Map<String, String> billingProfile;
}


