package vacademy.io.admin_core_service.features.commerce.customer.dto;

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
 * What the staff customer routes ({@code /commerce/v1/customers}) answer. Read-only views for
 * shop staff; never sent to a shopper (they carry the full phone and e-mail).
 */
public final class CustomerDtos {

    private CustomerDtos() {
    }

    /** One customer with what their orders add up to. The profile adds notes and consent details. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class CustomerRow {
        private String id;
        private String name;
        private String phone;
        private String email;
        /** Orders placed and not abandoned: no order waiting for payment, no cancelled order that took no money. */
        private Long ordersCount;
        /** Paid less refunded, over those orders. */
        private BigDecimal totalSpent;
        /** Unpaid balance of staff orders on credit (the DUES queue); not cash a courier still owes. */
        private BigDecimal dues;
        private String lastOrderAt;
        private Integer codRefusals;
        private Boolean marketingConsent;
        private Boolean anonymised;
        private String createdAt;
        // Profile only
        private String notes;
        private String consentAt;
        private String consentSource;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class CustomerPage {
        private List<CustomerRow> customers;
        private int page;
        private int pageSize;
        private long total;
    }

    /** One address of the customer's book (ACTIVE only). */
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

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class CustomerProfile {
        private CustomerRow customer;
        private List<AddressView> addresses;
    }
}
