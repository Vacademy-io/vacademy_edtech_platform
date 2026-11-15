package vacademy.io.admin_core_service.features.commerce.document.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CreditNoteDTO {

    private String id;
    private String creditNoteNumber;
    private String invoiceId;
    private String invoiceNumber;
    private String commerceOrderId;
    private String returnId;
    private String reason;
    private LocalDate documentDate;
    private String sellerGstin;
    private String buyerGstin;
    private String placeOfSupplyState;
    private String taxHead;
    private BigDecimal taxableValue;
    private BigDecimal cgst;
    private BigDecimal sgst;
    private BigDecimal igst;
    private BigDecimal cess;
    private BigDecimal taxAmount;
    private BigDecimal roundOff;
    private BigDecimal total;
    private String currency;
    /** False until the PDF has been drawn and stored; the pdf endpoint draws it on demand. */
    private Boolean pdfReady;
    private List<CreditNoteLineDTO> lines;
}
