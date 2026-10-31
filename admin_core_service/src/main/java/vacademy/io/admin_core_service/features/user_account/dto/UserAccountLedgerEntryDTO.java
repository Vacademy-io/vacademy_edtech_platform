package vacademy.io.admin_core_service.features.user_account.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Builder;
import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

@Data
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class UserAccountLedgerEntryDTO {
    private String id;
    private String eventType;
    private BigDecimal amount;
    private String currency;
    private LocalDate dueDate;
    private String sourceType;
    private String sourceId;
    private String invoiceId;
    private String referenceId;
    private String remarks;
    private LocalDateTime createdAt;
    /**
     * Discounted accruals only: list price before discount and the discount
     * applied — {@code amount} is the net. Null when no discount; the panel
     * strikes through {@code grossAmount} next to the net amount when present.
     */
    private BigDecimal grossAmount;
    private BigDecimal discountAmount;
    /**
     * CREDIT_PAYMENT rows only: the payment behind the credit (from {@code referenceId}), so the
     * panel can offer "Void" on a manually recorded payment and label one already voided. Null
     * on every other row, and whenever the payment log cannot be found.
     */
    private String paymentStatus;
    private String paymentVendor;
}
