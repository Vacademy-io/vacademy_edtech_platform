package vacademy.io.admin_core_service.features.commerce.order.desk.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutRequest;

import java.math.BigDecimal;
import java.util.List;

/**
 * {@code POST /commerce/v1/orders}: an order staff take by phone, WhatsApp or from a reseller.
 * Lines are priced by the server; a manager may type a unit price. Money received now is listed
 * in {@code tenders}; the rest may stay on credit.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class StaffOrderRequest {

    private String clientRequestId;
    private Customer customer;
    private CheckoutRequest.Address shippingAddress;
    private CheckoutRequest.Address billingAddress;
    private String buyerGstin;
    private List<Line> lines;
    private String couponCode;
    /** Default: true when a shipping address is given. */
    private Boolean chargeShipping;
    private List<Tender> tenders;
    private Boolean restOnCredit;
    /** Packed, handed over and delivered in the same request (a buyer at the shop). */
    private Boolean handOverNow;
    private String customerNote;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Customer {
        private String phone;
        private String name;
        private String email;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Line {
        private String variantId;
        private String sku;
        private Integer quantity;
        private BigDecimal unitPriceOverride;
        /**
         * Hand-over only ({@code hand_over_now}): the pieces of a one-of-a-kind line, by id or by
         * scan code, one per unit, reserved and sold in the same request.
         */
        private List<String> pieceIds;
        private List<String> pieceCodes;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Tender {
        /** CASH, UPI, CARD, BANK_TRANSFER or CHEQUE. */
        private String mode;
        private BigDecimal amount;
        private String reference;
    }
}
