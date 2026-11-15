package vacademy.io.admin_core_service.features.commerce.document.pdf;

import lombok.Builder;
import lombok.Value;
import vacademy.io.admin_core_service.features.commerce.document.enums.DocumentType;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxRateRow;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxHead;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/** Everything a printed commerce document shows, already read from the stored snapshot. */
@Value
@Builder
public class DocumentView {

    DocumentType documentType;
    String number;
    LocalDate date;
    String orderNumber;
    /** Credit note only: the invoice it is against. */
    String againstInvoiceNumber;
    LocalDate againstInvoiceDate;
    /** Invoice only: the invoice this one replaces (reissue with a buyer GSTIN). */
    String replacesInvoiceNumber;
    String reason;
    boolean cancelled;

    String sellerName;
    String sellerAddress;
    String sellerGstin;
    String sellerStateCode;

    String buyerName;
    String buyerPhone;
    String buyerEmail;
    String buyerGstin;
    String billingAddress;
    String shippingAddress;
    String placeOfSupplyState;

    TaxHead taxHead;
    String currency;
    List<Line> lines;
    /** One row per rate. Empty when the document carries no tax. */
    List<TaxRateRow> rateRows;
    /** One row per HSN code and rate. Empty when the document carries no tax. */
    List<TaxRateRow> hsnRows;

    BigDecimal taxableValue;
    BigDecimal cgst;
    BigDecimal sgst;
    BigDecimal igst;
    BigDecimal cess;
    BigDecimal roundOff;
    BigDecimal total;

    @Value
    @Builder
    public static class Line {
        String description;
        String sku;
        String hsnCode;
        /** Base units. */
        int quantity;
        int qtyScale;
        String unit;
        /** Price of one base unit, tax included. */
        BigDecimal unitPrice;
        BigDecimal discount;
        BigDecimal taxableValue;
        BigDecimal ratePercent;
        /** Tax-inclusive value of the line. */
        BigDecimal amount;
    }
}
