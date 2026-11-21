package vacademy.io.admin_core_service.features.commerce.tax.service;

import lombok.Builder;
import lombok.Value;
import vacademy.io.admin_core_service.features.commerce.tax.enums.InvoiceAt;
import vacademy.io.admin_core_service.features.commerce.tax.enums.RoundTotalTo;
import vacademy.io.admin_core_service.features.commerce.tax.enums.SlabBasis;
import vacademy.io.admin_core_service.features.commerce.tax.enums.SlabCompare;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxMode;

/** The tax settings of an institute as code reads them. Defaults apply when nothing was saved. */
@Value
@Builder(toBuilder = true)
public class CommerceTaxContext {

    /** False when the institute has never saved its tax settings. */
    boolean configured;
    TaxMode mode;
    SlabBasis slabBasis;
    SlabCompare slabCompare;
    RoundTotalTo roundTotalTo;
    InvoiceAt invoiceAt;
    String sellerGstin;
    String sellerStateCode;
    String sellerLegalName;
    String sellerAddress;
    int fyStartMonth;
}
