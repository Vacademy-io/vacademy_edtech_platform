package vacademy.io.admin_core_service.features.commerce.accounts.supplier;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.ToString;

import java.time.LocalDateTime;
import java.util.List;

/** Request and answer bodies of {@code /commerce/v1/suppliers}. No answer carries a PAN except the reveal. */
public final class SupplierDtos {

    private SupplierDtos() {
    }

    /** Body of POST (create) and PUT (edit) of a supplier. Text is trimmed; blank means "none". */
    @Data
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SupplierRequest {
        /** Required on create: a repeat with the same body answers the first supplier. */
        private String clientRequestId;
        /** Required on edit: the version the client read. */
        private Long version;
        private String code;
        private String name;
        private String legalName;
        private String nameAlt;
        private String groupCode;
        private String phone;
        private String email;
        private String addressLine1;
        private String addressLine2;
        private String city;
        private String countryCode;
        private String stateCode;
        private String pincode;
        private String registrationType;
        private String gstin;
        private Integer paymentTermsDays;
        private Boolean tdsApplicable;
        private String defaultTdsCode;
        private String upiId;
        private String paymentNote;
        private String defaultHeadId;
        private String customerId;
        private String externalRef;
        private String notes;
        /** Write-only. Absent = unchanged, "" = remove, otherwise the PAN to store encrypted. */
        @ToString.Exclude
        @JsonProperty(access = JsonProperty.Access.WRITE_ONLY)
        private String pan;
    }

    /** Body of POST /suppliers/{id}/status. */
    @Data
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class StatusRequest {
        private String status;
        private String reason;
    }

    /** Body of POST /suppliers/{id}/sensitive. */
    @Data
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SensitiveRequest {
        /** Only {@code pan}. */
        private String field;
    }

    /** Something the caller should know about a saved supplier; the save itself went through. */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Warning {
        private String code;
        private String supplierId;
        private String codeOfOther;
        private String nameOfOther;

        public static Warning of(String code) {
            return new Warning(code, null, null, null);
        }
    }

    /** One supplier with its masked PAN and balance. */
    @Data
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SupplierView {
        private String id;
        private String instituteId;
        private String code;
        private String name;
        private String legalName;
        private String nameAlt;
        private String groupCode;
        private String phone;
        private String email;
        private String addressLine1;
        private String addressLine2;
        private String city;
        private String countryCode;
        private String stateCode;
        private String pincode;
        private String registrationType;
        private String gstin;
        private int paymentTermsDays;
        private boolean tdsApplicable;
        private String defaultTdsCode;
        private String upiId;
        private String paymentNote;
        private String defaultHeadId;
        private String customerId;
        private String notes;
        private String status;
        private String externalRef;
        private Long version;
        private String createdBy;
        private String updatedBy;
        private LocalDateTime createdAt;
        private LocalDateTime updatedAt;
        /** {@code ******} and the last four characters, or null when no PAN is stored. */
        private String panMasked;
        private boolean hasPan;
        /** What the institute owes the supplier, two decimal places. */
        private String balance;
        /** Only in the answer of a create or an edit. */
        @JsonInclude(JsonInclude.Include.NON_NULL)
        private List<Warning> warnings;
    }

    /** One line of the supplier list. */
    @Data
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SupplierRow {
        private String id;
        private String code;
        private String name;
        private String nameAlt;
        private String groupCode;
        private String phone;
        private String gstin;
        private String stateCode;
        private String registrationType;
        private String status;
        private String balance;
    }

    /** One line of the supplier picker. */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class LookupRow {
        private String id;
        private String name;
        private String groupCode;
    }
}
