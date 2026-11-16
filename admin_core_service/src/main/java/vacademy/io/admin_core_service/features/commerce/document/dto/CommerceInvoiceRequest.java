package vacademy.io.admin_core_service.features.commerce.document.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxResult;

import java.time.LocalDate;
import java.util.List;

/**
 * What an order hands to {@code CommerceInvoiceService.issue}. The tax figures are the snapshot
 * the order stored at placement; the issuer does not recompute them.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CommerceInvoiceRequest {

    private String commerceOrderId;
    private String orderNumber;
    /** ONLINE, POS or ADMIN. */
    private String channel;
    private String locationId;
    private String registerId;
    /** The auth user of the buyer; a walk-in sale passes its placeholder user. */
    private String userId;
    private String buyerName;
    private String buyerPhone;
    private String buyerEmail;
    private String buyerGstin;
    private String billingAddress;
    private String shippingAddress;
    /** The institute date of the document; for a bill-book entry, the date on the paper. */
    private LocalDate documentDate;
    private String currency;
    private TaxResult tax;
    private List<CommerceInvoiceLineExtra> lineExtras;
    /** Every payment log of the order. Each gets an invoice_payment_log_mapping row. */
    private List<String> paymentLogIds;
    /** Only for a bill-book entry: the number on the paper bill. No system number is issued. */
    private String externalInvoiceNumber;
    private String actorUserId;
    /**
     * The order desk only: an order whose invoice was credited in full when it was unpacked is
     * invoiced again when it is packed again. Everyone else leaves it false, and an order with a
     * fully credited invoice is refused (INVOICE_FULLY_CREDITED).
     */
    private boolean allowAfterFullCredit;
}
