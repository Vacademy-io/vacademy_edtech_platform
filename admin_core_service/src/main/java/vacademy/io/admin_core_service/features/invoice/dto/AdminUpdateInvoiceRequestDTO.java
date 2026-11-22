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

/**
 * Body for {@code PUT /v1/invoices/{id}} — edits an admin invoice that has NOT been paid
 * yet (wrong amount, wrong line item, …) in place, keeping the same invoice number and
 * regenerating the PDF.
 *
 * <p>Mirrors {@link AdminCreateInvoiceRequestDTO} minus the fields that are fixed for the
 * life of an invoice: the billed user and the institute both come from the persisted row
 * and cannot be reassigned by an edit (re-billing a different learner is a new invoice,
 * not an edit of this one).
 */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AdminUpdateInvoiceRequestDTO {

    @NotEmpty(message = "At least one line item is required")
    @Valid
    private List<AdminInvoiceLineItemRequestDTO> lineItems;

    @NotBlank(message = "Currency is required")
    private String currency;

    @NotNull(message = "Due date is required")
    private LocalDateTime dueDate;

    /** Optional: re-date the invoice. Omitted leaves the original invoice_date untouched. */
    private LocalDateTime invoiceDate;

    private String notes;

    /** Per-invoice edits to the editable template placeholders — see the create DTO. */
    private Map<String, String> overrides;

    /** Per-invoice tax override: null = institute default, false = no tax on this invoice. */
    private Boolean taxEnabled;

    /** Per-invoice tax rate as a percentage (e.g. 18). Null = institute default. */
    private BigDecimal taxRatePercent;

    /**
     * Change the product this unpaid invoice pays for. Null (every caller before this field) =
     * leave it as it is; an object without a type = remove it. Refused once the product has
     * started being applied.
     */
    private InvoiceProductLinkDTO productLink;
}
