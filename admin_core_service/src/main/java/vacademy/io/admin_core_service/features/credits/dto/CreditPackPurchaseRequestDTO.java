package vacademy.io.admin_core_service.features.credits.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CreditPackPurchaseRequestDTO {
    private String instituteId;
    private String packId;
    /**
     * Where Razorpay should send the browser back after the hosted payment
     * completes — the originating admin domain (e.g.
     * {@code https://admin.shikshanation.com/settings?selectedTab=aiSettings}).
     * The service appends {@code topup_pp=<platformPaymentId>} so the page can
     * resume polling. Optional; falls back to a configured default.
     */
    private String returnUrl;

    /**
     * Buyer's 15-char GSTIN. Optional — omit for unregistered (B2C) buyers.
     * When present it is validated, persisted onto the institute and
     * snapshotted onto the invoice so the buyer can claim input tax credit.
     */
    private String buyerGstin;

    /**
     * Buyer's 2-digit GST state code. Drives CGST/SGST vs IGST and the
     * invoice's place of supply. Derived from the GSTIN prefix when omitted.
     */
    private String buyerStateCode;
}
