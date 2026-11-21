package vacademy.io.admin_core_service.features.commerce.shipment.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.util.List;

/** Request bodies of the shipment routes ({@code /commerce/v1/shipments}). */
public final class ShipmentDtos {

    private ShipmentDtos() {
    }

    /** {@code POST /shipments}: pack every open line of a CONFIRMED order. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class PackRequest {
        private String clientRequestId;
        private String orderId;
        private String fromStatus;
        private List<PackLine> lines;
        private Integer weightGrams;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class PackLine {
        private String orderLineId;
        private Integer quantity;
        /** One-of-a-kind stock: the pieces, by id or by scan code. */
        private List<String> pieceIds;
        private List<String> pieceCodes;
    }

    /** {@code POST /shipments/{id}/ship}. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ShipRequest {
        private String clientRequestId;
        private String carrierName;
        private String trackingNumber;
        private String trackingUrl;
        private Integer weightGrams;
        /** Default true: the buyer is told (the message itself is WP-33). */
        private Boolean notifyCustomer;
    }

    /** {@code POST /shipments/{id}/status}: DELIVERED, RTO or RTO_RECEIVED. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class StatusRequest {
        private String clientRequestId;
        private String to;
        private LocalDate deliveredOn;
        private String rtoReason;
        private List<StatusLine> lines;
        private String note;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class StatusLine {
        private String orderLineId;
        /** RESALEABLE or DAMAGED. */
        private String condition;
        private Integer quantity;
        private List<String> pieceIds;
    }

    /** {@code PATCH /shipments/{id}}: a typo in the courier or the tracking number. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class PatchRequest {
        private String clientRequestId;
        private String carrierName;
        private String trackingNumber;
        private String trackingUrl;
    }
}
