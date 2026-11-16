package vacademy.io.admin_core_service.features.commerce.document.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxResult;

import java.util.List;

/**
 * What is stored in {@code invoice.invoice_data_json} for a commerce document: the seller, the
 * buyer, the addresses and the tax snapshot as they were when it was issued. The PDF is drawn
 * from this, so a later change of settings, tax rates or the customer never changes a document.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CommerceInvoiceSnapshot {

    public static final int CURRENT_VERSION = 1;

    private int version;
    private boolean commerce;
    private String orderNumber;
    private String sellerLegalName;
    private String sellerAddress;
    private String sellerGstin;
    private String sellerStateCode;
    private String buyerName;
    private String buyerPhone;
    private String buyerEmail;
    private String buyerGstin;
    private String billingAddress;
    private String shippingAddress;
    private TaxResult tax;
    private List<CommerceInvoiceLineExtra> lineExtras;
    /** Set on a document that replaces another (reissue as B2B). */
    private String replacesInvoiceNumber;
}
