package vacademy.io.admin_core_service.features.commerce.returns.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
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
 * The bodies and answers of {@code /commerce/v1/refunds}. The gateway payment id and the
 * gateway credentials are never answered.
 */
public final class RefundDtos {

    private RefundDtos() {
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class CreateRefundRequest {
        private String clientRequestId;
        private String orderId;
        private String returnId;
        private BigDecimal amount;
        /** GATEWAY, BANK_TRANSFER, UPI or CASH. */
        private String method;
        private String reference;
        private String paidOn;
        private String reason;
        /** GATEWAY only: a refund already made in the gateway dashboard, recorded here. */
        private String gatewayRefundId;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class PayoutRequest {
        private String clientRequestId;
        private String reference;
        private String paidOn;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class CancelRequest {
        private String clientRequestId;
        private String reason;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class CheckRequest {
        private String clientRequestId;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class RefundView {
        private String id;
        private String orderId;
        private String orderNumber;
        private String returnId;
        private String returnNumber;
        private String kind;
        private String source;
        private String method;
        private BigDecimal amount;
        private String currency;
        private String status;
        private String reference;
        private String gatewayRefundId;
        private String gatewayStatus;
        private String appliedOrderId;
        private String paidOn;
        private String reason;
        private String failureCode;
        private String failureReason;
        private String createdBy;
        private String createdAt;
        private String processedAt;
        private String failedAt;
        private Boolean replayed;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class RefundSummary {
        private String id;
        private String orderId;
        private String orderNumber;
        private String returnId;
        private String returnNumber;
        private String kind;
        private String source;
        private String method;
        private BigDecimal amount;
        private String currency;
        private String status;
        private String reference;
        private String gatewayRefundId;
        private String gatewayStatus;
        private String appliedOrderId;
        private String paidOn;
        private String failureCode;
        private String createdBy;
        private String createdAt;
        private String processedAt;
        private String failedAt;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class RefundPage {
        private List<RefundSummary> refunds;
        private int page;
        private int pageSize;
        private long total;
    }
}
