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
 * What the guarded staff routes ({@code /commerce/v1/orders}) answer. Never sent to a shopper:
 * these classes carry the full address, the phone and internal ids.
 */
public final class StaffOrderDtos {

    private StaffOrderDtos() {
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class StaffOrderRow {
        private String id;
        private String orderNumber;
        private String channel;
        private String status;
        private String paymentStatus;
        private String paymentMethod;
        private String cancelReason;
        private String customerName;
        private String customerPhone;
        private String currency;
        private BigDecimal total;
        private BigDecimal amountPaid;
        private String createdAt;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class StaffOrderPage {
        private List<StaffOrderRow> orders;
        private int page;
        private int pageSize;
        private long total;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class StaffOrderDetail {
        private StaffOrderRow order;
        private String userId;
        private String customerId;
        private String customerEmail;
        private Object shippingAddress;
        private Object billingAddress;
        private String buyerGstin;
        private String placeOfSupplyState;
        private CheckoutDtos.Totals totals;
        private String couponCode;
        private String customerNote;
        private String giftNote;
        private String locale;
        private String fulfilmentLocationId;
        private String paymentGroupId;
        private String gatewayVendor;
        private String gatewayOrderId;
        private String holdExpiresAt;
        private String confirmedAt;
        private String cancelledAt;
        /** The statuses the order status table allows next. The moves themselves come later. */
        private List<String> nextStatuses;
        private List<StaffOrderLine> lines;
        private List<StaffTender> tenders;
        private List<StaffTimelineEntry> timeline;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class StaffOrderLine {
        private String id;
        private int lineNo;
        private String lineType;
        private String packageSessionId;
        private String packageId;
        private String userPlanId;
        private String paymentLogId;
        private String name;
        private String variantLabel;
        private String sku;
        private String unit;
        private int qtyScale;
        private int quantity;
        private BigDecimal unitPrice;
        private BigDecimal mrp;
        private BigDecimal gross;
        private BigDecimal discount;
        private String hsnCode;
        private BigDecimal taxRate;
        private BigDecimal taxableValue;
        private BigDecimal taxAmount;
        private BigDecimal lineTotal;
        private int qtyCancelled;
        private int qtyShipped;
        private int qtyReturned;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class StaffTender {
        private String id;
        private String mode;
        private BigDecimal amount;
        private String status;
        private String reference;
        private String receivedAt;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class StaffTimelineEntry {
        private String fromStatus;
        private String status;
        private String at;
        private String note;
        private String actorUserId;
    }
}
