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
import java.util.Map;

/**
 * The bodies and answers of {@code /commerce/v1/returns}. No cost field is ever answered: a
 * warehouse user reads these.
 */
public final class ReturnDtos {

    private ReturnDtos() {
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class CreateReturnRequest {
        private String clientRequestId;
        private String orderId;
        private String locationId;
        private String reason;
        private String reasonNote;
        private String requestedVia;
        private List<LineRequest> lines;
        private List<String> photoMediaIds;
        private String overrideReason;
        private Boolean approveNow;
        private String note;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class LineRequest {
        private String orderLineId;
        private Integer quantity;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ApproveRequest {
        private String clientRequestId;
        private String fromStatus;
        private String note;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class RejectRequest {
        private String clientRequestId;
        private String fromStatus;
        private String reason;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ReceiveRequest {
        private String clientRequestId;
        private String fromStatus;
        private String locationId;
        private List<ReceiveLine> lines;
        private String note;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ReceiveLine {
        private String orderLineId;
        /** RESALEABLE or DAMAGED; a line may appear once per condition. */
        private String condition;
        private Integer quantity;
        private List<String> pieceIds;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ReturnPreview {
        private Policy policy;
        private List<String> warnings;
        private List<ReturnableLine> lines;
        /** What the units are worth by the placement tax; the credit note at receive decides. */
        private BigDecimal creditEstimate;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Policy {
        private Integer windowDays;
        private String deliveredOn;
        private Long daysSinceDelivery;
        private List<String> allowedReasons;
        private Boolean photoRequired;
        private String returnShippingPaidBy;
        private Map<String, String> policyText;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ReturnableLine {
        private String orderLineId;
        private Integer returnableQuantity;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ReturnView {
        private String id;
        private String returnNumber;
        private String orderId;
        private String orderNumber;
        private String status;
        private String reason;
        private String reasonNote;
        private String requestedVia;
        private String locationId;
        private List<ReturnLineView> lines;
        private List<String> policyWarnings;
        private String overrideReason;
        private List<String> photoMediaIds;
        private CreditNoteRef creditNote;
        private BigDecimal creditTotal;
        private BigDecimal dueRaised;
        private BigDecimal refunded;
        private List<RefundDtos.RefundSummary> refunds;
        private String requestedBy;
        private String createdAt;
        private String approvedAt;
        private String approvedBy;
        private String rejectedAt;
        private String rejectedBy;
        private String rejectReason;
        private String receivedAt;
        private String receivedBy;
        private String closedAt;
        private List<String> nextActions;
        private Boolean replayed;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ReturnLineView {
        private String id;
        private String orderLineId;
        private Integer lineNo;
        private String name;
        private String sku;
        private Integer quantity;
        private Integer qtyResaleable;
        private Integer qtyDamaged;
        private List<String> pieceCodes;
        private BigDecimal creditedValue;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class CreditNoteRef {
        private String id;
        private String number;
        private BigDecimal total;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ReturnSummary {
        private String id;
        private String returnNumber;
        private String orderId;
        private String orderNumber;
        private String status;
        private String reason;
        private String locationId;
        private Integer units;
        private BigDecimal creditTotal;
        private BigDecimal refunded;
        private String createdAt;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ReturnPage {
        private List<ReturnSummary> returns;
        private int page;
        private int pageSize;
        private long total;
    }
}
