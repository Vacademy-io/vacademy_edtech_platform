package vacademy.io.admin_core_service.features.commerce.order.desk.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/** Request and answer bodies of the order desk routes ({@code /commerce/v1/orders/...}). */
public final class OrderDeskDtos {

    private OrderDeskDtos() {
    }

    /** {@code POST /orders/{id}/transition}. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class TransitionRequest {
        private String clientRequestId;
        private String fromStatus;
        private String toStatus;
        private String reason;
        private String note;
    }

    /** {@code POST /orders/{id}/lines/{lineId}/cancel}. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class LineCancelRequest {
        private String clientRequestId;
        private Integer quantity;
        private String reason;
        private String note;
        /** Required for one-of-a-kind stock once the order is PACKED: the pieces that go back. */
        private List<String> pieceIds;
    }

    /** {@code POST /orders/{id}/receipts}: money received on a staff order with a due. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ReceiptRequest {
        private String clientRequestId;
        private String mode;
        private BigDecimal amount;
        private String reference;
        private LocalDate receivedOn;
    }

    /** {@code POST /orders/{id}/stock-short/clear}. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class StockShortClearRequest {
        private String clientRequestId;
        private String note;
    }

    /** {@code POST /orders/bulk}: one action on many orders, each in its own transaction. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class BulkRequest {
        /** 8 to 27 characters: each item runs with the key {@code <this>:<order_id>}. */
        private String clientRequestId;
        /** CONFIRM, PACK, SHIP or DELIVER. */
        private String action;
        private List<BulkItem> items;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class BulkItem {
        private String orderId;
        private String fromStatus;
        private String carrierName;
        private String trackingNumber;
        private String trackingUrl;
        private LocalDate deliveredOn;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class BulkResult {
        private String orderId;
        private boolean ok;
        private String code;
        private String message;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class BulkResponse {
        private List<BulkResult> results;
    }
}
