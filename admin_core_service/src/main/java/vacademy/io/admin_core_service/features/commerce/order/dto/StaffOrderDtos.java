package vacademy.io.admin_core_service.features.commerce.order.dto;

import vacademy.io.admin_core_service.features.commerce.returns.dto.RefundDtos;
import vacademy.io.admin_core_service.features.commerce.returns.dto.ReturnDtos;
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
        // Order desk (WP-30)
        private Boolean stockShort;
        private BigDecimal refundDue;
        /** Of the live (not cancelled) shipment. */
        private String shipmentStatus;
        private String trackingNumber;
        /** When the order entered its current status. */
        private String statusSince;
        // Returns and refunds (WP-32)
        /** refund_due less refund_committed: what is owed back and not yet refunded. */
        private BigDecimal refundOpen;
        /** NONE, PENDING, PART or FULL. */
        private String refundState;
        /** NONE, IN_PROGRESS, PART or FULL. */
        private String returnState;
        // Order desk screens (WP-34)
        /** What the courier collects on a cash-on-delivery order; null for other orders. */
        private BigDecimal codAmount;
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
        /** The statuses the order status table allows next. */
        private List<String> nextStatuses;
        private List<StaffOrderLine> lines;
        private List<StaffTender> tenders;
        private List<StaffTimelineEntry> timeline;
        // Order desk (WP-30)
        private List<StaffShipment> shipments;
        private BigDecimal refundDue;
        private Boolean stockShort;
        private BigDecimal codAmount;
        private String codRemittanceId;
        /** The live (not fully credited) invoice of the order. */
        private String invoiceId;
        private List<String> creditNoteIds;
        /** Action codes the caller's roles may run on the order now. */
        private List<String> nextActions;
        /** True when this answers a repeat of an earlier request with the same client_request_id. */
        private Boolean replayed;
        // Returns and refunds (WP-32)
        private BigDecimal refundCommitted;
        private BigDecimal amountRefunded;
        private BigDecimal refundOpen;
        private String refundState;
        private String returnState;
        private List<ReturnDtos.ReturnSummary> returns;
        private List<RefundDtos.RefundSummary> refunds;
        private String exchangeOfOrderId;
        // Buyer messages (WP-33): newest first, at most 100; addresses masked.
        private List<vacademy.io.admin_core_service.features.commerce.notify.dto.NotificationSettingsDtos.DeliveryView>
                notifications;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class StaffShipment {
        private String id;
        private String status;
        private String locationId;
        private String carrierCode;
        private String carrierName;
        private String trackingNumber;
        private String trackingUrl;
        private Integer shipCount;
        private Integer weightGrams;
        private String invoiceId;
        private String rtoReason;
        private String packedAt;
        private String shippedAt;
        private String deliveredOn;
        private String rtoAt;
        private String rtoReceivedAt;
        private String cancelledAt;
        private List<StaffShipmentLine> lines;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class StaffShipmentLine {
        private String id;
        private String orderLineId;
        private int quantity;
        private List<String> pieceCodes;
        /** The ids of the same pieces, in the order of {@code pieceCodes} (WP-34); null when the codes are. */
        private List<String> pieceIds;
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
        // Order desk (WP-30)
        private Integer stockShortQty;
        private BigDecimal listUnitPrice;
        private String priceOverrideBy;
        private BigDecimal cancelledValue;
        private BigDecimal costTotal;
        // Order desk screens (WP-34): the variant's stock facts, so the pack station knows which
        // lines need a piece scan. Null for a shipping or COD line, or a variant no longer in the shop.
        /** PIECE or QUANTITY. */
        private String stockMode;
        /** TRACKED or UNTRACKED. */
        private String stockPolicy;
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
