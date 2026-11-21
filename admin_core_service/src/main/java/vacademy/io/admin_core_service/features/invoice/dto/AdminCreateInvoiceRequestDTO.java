package vacademy.io.admin_core_service.features.invoice.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AdminCreateInvoiceRequestDTO {

    // Supports bulk (multiple users) or single user
    @NotEmpty(message = "At least one user ID is required")
    private List<String> userIds;

    @NotBlank(message = "Institute ID is required")
    private String instituteId;

    @NotEmpty(message = "At least one line item is required")
    @Valid
    private List<AdminInvoiceLineItemRequestDTO> lineItems;

    @NotBlank(message = "Currency is required")
    private String currency;

    @NotNull(message = "Due date is required")
    private LocalDateTime dueDate;

    // Optional: admin-chosen invoice date. Defaults to now when omitted. Drives both
    // the persisted invoice_date column and the {{invoice_date}} placeholder.
    private LocalDateTime invoiceDate;

    // Optional: admin notes shown in the invoice
    private String notes;

    /**
     * Optional per-invoice overrides for editable text placeholders (invoice_number,
     * user_name, user_address, institute_name, tax_label, place_of_supply, notes, …),
     * keyed by placeholder name. Applied on top of the auto-derived values before the
     * invoice template is rendered. Amount placeholders (subtotal/tax_amount/total_amount)
     * and HTML placeholders (line_items/institute_logo) are never overridable.
     *
     * <p>User-scoped keys (user_*) and invoice_number are only honoured for single-user
     * requests — they are ignored for bulk (multi-user) creation.
     */
    private Map<String, String> overrides;

    /**
     * Per-invoice override for whether tax applies at all. Null (the common case) means
     * "use the institute's INVOICE_SETTING default" (tax applies whenever taxRate &gt; 0).
     * {@code false} removes tax entirely for this invoice regardless of settings —
     * total_amount == subtotal, no tax line item, no {{tax_amount}}.
     */
    private Boolean taxEnabled;

    /**
     * Per-invoice override for the tax rate, as a percentage (e.g. 18 for 18%). Null means
     * "use the institute's INVOICE_SETTING taxRate". Ignored when {@link #taxEnabled} is
     * {@code false}.
     */
    private BigDecimal taxRatePercent;

    /**
     * PREVIEW-ONLY: the id of the invoice currently being EDITED, if any. Lets
     * {@code previewAdminInvoice} treat that invoice's own {@code invoice_number} as
     * available rather than as a collision — without it, previewing an edit would see the
     * number already in the DB, assume a clash, and render a freshly-generated number that
     * doesn't match the invoice actually being edited. Ignored by the create path.
     */
    private String editingInvoiceId;

    /**
     * Optional admin discount on the invoice (ad-hoc % / flat with a reason, or an
     * existing coupon). Applied as a DISCOUNT line on the pre-tax subtotal; the admin
     * who created the invoice is recorded as the one who granted it.
     */
    private vacademy.io.common.payment.dto.AdminDiscountRequestDTO adminDiscount;
}
