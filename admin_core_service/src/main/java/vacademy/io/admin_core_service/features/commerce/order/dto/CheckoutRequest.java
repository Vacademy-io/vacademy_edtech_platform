package vacademy.io.admin_core_service.features.commerce.order.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;

/**
 * What the storefront posts to place an order. The server prices the cart again; of the money
 * fields only {@code expectedTotal} is read, and only to tell the shopper when the total they
 * saw is no longer the total.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CheckoutRequest {

    /** The idempotency key of this checkout, made by the storefront; 8 to 64 safe characters. */
    private String clientRequestId;
    private List<CartPriceRequest.Line> lines;
    private String couponCode;
    /** PREPAID (default). COD is not sold yet. */
    private String paymentMethod;
    /** The total the cart page showed. */
    private BigDecimal expectedTotal;
    private String locale;
    private Customer customer;
    private Address shippingAddress;
    /** Optional; the shipping address when absent. */
    private Address billingAddress;
    private String buyerGstin;
    private String customerNote;
    private String giftNote;
    private Boolean marketingConsent;
    /** Keep the shipping address in the buyer's address book. */
    private Boolean saveAddress;
    /** The bot-challenge (Turnstile) token of the page; checked when the server has the check on. */
    private String challengeToken;
    /** A verified-phone token, when the shopper has passed an OTP. */
    private String phoneToken;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Customer {
        private String name;
        private String phone;
        private String email;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Address {
        private String label;
        private String name;
        private String phone;
        private String line1;
        private String line2;
        private String landmark;
        private String city;
        /** GST state code; the state of the pincode wins when the pincode names one. */
        private String stateCode;
        private String pincode;
        private Boolean isDefault;
    }
}
