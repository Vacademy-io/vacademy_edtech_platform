package vacademy.io.admin_core_service.features.credits.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Builder;
import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * One row of GET /credits/packs/invoices — an institute's AI credit purchase
 * invoice. The PDF is rendered on demand via /invoices/{invoiceId}/pdf.
 */
@Data
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class PlatformInvoiceSummaryDTO {
    private String invoiceId;
    private String invoiceNumber;
    private String platformPaymentId;
    private LocalDateTime issuedAt;
    private String currency;
    private Long baseAmountMinor;
    private Long taxAmountMinor;
    private Long totalAmountMinor;
    private String displayTotalMajor;
    private BigDecimal credits;
    private String packName;
    private String paymentStatus;    // PAID | PARTIALLY_REFUNDED | REFUNDED
    private Boolean isExport;
    private String buyerGstin;
}
