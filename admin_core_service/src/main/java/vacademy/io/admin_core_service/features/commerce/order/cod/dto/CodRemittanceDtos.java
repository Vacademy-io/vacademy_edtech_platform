package vacademy.io.admin_core_service.features.commerce.order.cod.dto;

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

/** Bodies of the courier remittance routes ({@code /commerce/v1/cod/remittances}). */
public final class CodRemittanceDtos {

    private CodRemittanceDtos() {
    }

    /** {@code POST /cod/remittances}: the money a courier paid over for delivered COD orders. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class RemittanceRequest {
        private String clientRequestId;
        /** The courier's statement or transfer reference: one remittance per reference. */
        private String reference;
        private String courierName;
        private LocalDate receivedOn;
        /** What the courier collected: the sum of the orders' COD amounts, unless a reason is given. */
        private BigDecimal grossAmount;
        /** The courier's fees kept back. */
        private BigDecimal deductions;
        /** What reached the bank: gross minus deductions. */
        private BigDecimal netAmount;
        /** Required when the gross amount is not the sum of the orders. */
        private String differenceReason;
        private String note;
        private List<String> orderIds;
    }

    /** One order of a remittance. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class RemittedOrder {
        private String orderId;
        private String orderNumber;
        private BigDecimal codAmount;
    }

    /** A recorded remittance; {@code orders} is left out of the list route. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class RemittanceView {
        private String id;
        private String reference;
        private String courierName;
        private LocalDate receivedOn;
        private BigDecimal grossAmount;
        private BigDecimal deductions;
        private BigDecimal netAmount;
        private BigDecimal ordersTotal;
        private Integer orderCount;
        private String differenceReason;
        private String note;
        private String recordedBy;
        private String createdAt;
        private List<RemittedOrder> orders;
        /** True when this answers a repeat of an earlier request with the same key. */
        private Boolean replayed;
    }

    /** A page of remittances. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class RemittancePage {
        private List<RemittanceView> items;
        private int page;
        private int pageSize;
        private long total;
    }
}
