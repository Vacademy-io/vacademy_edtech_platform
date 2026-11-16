package vacademy.io.admin_core_service.features.commerce.document.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/** A commerce invoice as the admin app reads it. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CommerceInvoiceDTO {

    private String id;
    private String invoiceNumber;
    private String externalInvoiceNumber;
    private String documentType;
    private LocalDate documentDate;
    private String commerceOrderId;
    private String channel;
    private String locationId;
    private String sellerGstin;
    private String buyerGstin;
    private String placeOfSupplyState;
    private String taxHead;
    private BigDecimal taxableValue;
    private BigDecimal taxAmount;
    private BigDecimal roundOff;
    private BigDecimal total;
    private String currency;
    private String status;
    private LocalDateTime cancelledAt;
    private String cancelReason;
    /** Total of the credit notes against this invoice. */
    private BigDecimal credited;
    /** False until the PDF has been drawn and stored; the pdf endpoint draws it on demand. */
    private Boolean pdfReady;
}
