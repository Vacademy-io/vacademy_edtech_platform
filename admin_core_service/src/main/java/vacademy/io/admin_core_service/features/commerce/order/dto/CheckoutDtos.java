package vacademy.io.admin_core_service.features.commerce.order.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;

/**
 * Everything the public checkout and order routes answer to a shopper. No internal id other
 * than the order id, no location, no cost, no payment-log or plan id, no full address of an
 * order and no full phone. {@code CheckoutDtosTest} pins the field lists; what staff see is in
 * {@link StaffOrderDtos}.
 */
public final class CheckoutDtos {

    private CheckoutDtos() {
    }

    /** The answer to a placed order and to a payment retry. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Placed {
        private String orderId;
        private String orderNumber;
        private String status;
        private String paymentStatus;
        private String currency;
        private BigDecimal total;
        /** Null while the gateway order could not be created; ask again with retry-payment. */
        private Payment payment;
        /** True when {@link #payment} is null and the order can still be paid. */
        private boolean paymentRetryable;
        /**
         * True while a payment on the order was authorised and the gateway has not yet said
         * that it was captured: no payment step is offered, the order is read again shortly.
         */
        private boolean paymentProcessing;
        /** Only on the answer that created the order: the hold and the token that releases it. */
        private Hold hold;
        private String orderAccessToken;
        /** ISO-8601 instant. */
        private String orderAccessTokenExpiresAt;
        /** True when this answer repeats an order that an earlier request created. */
        private boolean replayed;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Payment {
        private String vendor;
        private String gatewayOrderId;
        /** The gateway's publishable key id. */
        private String keyId;
        private long amountMinor;
        private String currency;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Hold {
        /** The id the stock-hold release call takes. */
        private String paymentLogId;
        private String releaseToken;
        /** ISO-8601 instant; pay before this. */
        private String expiresAt;
    }

    /** One order as its buyer sees it. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class OrderView {
        private String orderId;
        private String orderNumber;
        private String status;
        private String paymentStatus;
        private String paymentMethod;
        private String cancelReason;
        private String placedAt;
        private String holdExpiresAt;
        /** True while unpaid and no payment on it is in progress: "Pay now" may be offered. */
        private boolean paymentRetryable;
        /**
         * True while a payment on the order is authorised and not yet captured: the page shows
         * "confirming your payment" and offers no payment step.
         */
        private boolean paymentProcessing;
        private String currency;
        private List<OrderLineView> lines;
        private Totals totals;
        private Recipient recipient;
        private List<TimelineEntry> timeline;
        /**
         * True on a track-order answer for an order whose phone was not proved when it was
         * placed: state and timeline only, no order id, items, totals or recipient.
         */
        private boolean masked;
        /** NONE, IN_PROGRESS, PART or FULL (WP-32). */
        private String returnState;
        /** NONE, PENDING, PART or FULL (WP-32). */
        private String refundState;
        /** What was given back to the buyer so far (WP-32). */
        private BigDecimal refundedAmount;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class OrderLineView {
        private String lineRef;
        private String name;
        private String variantLabel;
        private String sku;
        private int quantity;
        private int qtyScale;
        private String unit;
        private BigDecimal unitPrice;
        private BigDecimal compareAtPrice;
        private BigDecimal discount;
        private BigDecimal lineTotal;
        private int qtyCancelled;
        private int qtyShipped;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Totals {
        private BigDecimal subtotal;
        private BigDecimal discount;
        private BigDecimal shipping;
        private BigDecimal codCharge;
        private BigDecimal tax;
        private BigDecimal roundOff;
        private BigDecimal total;
        private BigDecimal amountPaid;
    }

    /** Where the parcel goes, without the street lines and with the phone masked. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Recipient {
        private String name;
        private String phoneMasked;
        private String city;
        private String stateCode;
        private String pincode;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class TimelineEntry {
        private String status;
        /** ISO-8601 instant. */
        private String at;
    }

    /**
     * A row of the buyer's order list. A {@code masked} row is an order someone placed with this
     * phone without proving it: only its number, status and date are shown.
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class OrderSummary {
        private String orderId;
        private String orderNumber;
        private String status;
        private String paymentStatus;
        private String placedAt;
        private String currency;
        private BigDecimal total;
        private Integer itemCount;
        private String firstItemName;
        /** Opens the order page of this order. */
        private String orderAccessToken;
        private boolean masked;
    }

    /** The buyer's account ({@code GET /me}). */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Account {
        private String name;
        /**
         * The phone the caller proved (session or phone token), in the stored spelling (91 and
         * ten digits), so checkout can fill it in without the device keeping it.
         */
        private String phone;
        private String phoneMasked;
        /** Null when the shop has no e-mail for this phone. */
        private String emailMasked;
        private boolean marketingConsent;
        /** ISO-8601 instant; null when the call was made with a phone token, not a session. */
        private String sessionExpiresAt;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class OrderPage {
        private List<OrderSummary> orders;
        private int page;
        private int pageSize;
        private long total;
    }

    /** One address of the buyer's own address book. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class AddressView {
        private String id;
        private String label;
        private String name;
        private String phone;
        private String line1;
        private String line2;
        private String landmark;
        private String city;
        private String stateCode;
        private String pincode;
        private Boolean isDefault;
    }
}
