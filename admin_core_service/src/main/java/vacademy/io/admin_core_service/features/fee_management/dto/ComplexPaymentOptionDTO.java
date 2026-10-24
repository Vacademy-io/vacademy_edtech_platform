package vacademy.io.admin_core_service.features.fee_management.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import lombok.*;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.ArrayList;

@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ComplexPaymentOptionDTO {

    private String id;
    private String name;
    private String instituteId;
    private String defaultPaymentOptionId;
    private String status;
    private String createdBy;
    private String approvedBy;
    /**
     * When true, learners who enroll via this CPO land in PENDING_FOR_APPROVAL and an
     * admin must approve them before they get course access. Mirrored onto the CPO's
     * PaymentOption row (payment_option.require_approval). Nullable so update calls that
     * omit it leave the existing value untouched.
     */
    private Boolean requireApproval;
    /**
     * FIXED (default): installments are part of the plan. FLEXIBLE: the plan holds fee
     * types and amounts only; the admin picks the number of installments and the gap for
     * each learner at enrollment. Set at creation.
     */
    private String scheduleMode;
    /** Defaults for a FLEXIBLE plan (prefill + schedule used when none is chosen). */
    private FlexibleScheduleDefaultsDTO flexibleDefaults;
    private List<FeeTypeDTO> feeTypes;

    @Builder.Default
    private List<PackageSessionLinkDTO> packageSessionLinks = new ArrayList<>();

    @Data
    @Builder
    @AllArgsConstructor
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class PackageSessionLinkDTO {
        private String enrollInviteId;
        private String packageSessionId;
    }

    @Data
    @Builder
    @AllArgsConstructor
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class FeeTypeDTO {
        private String id;
        private String name;
        private String code;
        private String description;
        private String status;
        private AssignedFeeValueDTO assignedFeeValue;
    }

    @Data
    @Builder
    @AllArgsConstructor
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class AssignedFeeValueDTO {
        private String id;
        private BigDecimal amount;
        private BigDecimal originalAmount;
        private String discountType;
        private BigDecimal discountValue;
        private Integer noOfInstallments;
        private Boolean hasInstallment;
        private Boolean isRefundable;
        private Boolean hasPenalty;
        private BigDecimal penaltyPercentage;
        private String status;
        private List<AftInstallmentDTO> installments;
    }

    @Data
    @Builder
    @AllArgsConstructor
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class AftInstallmentDTO {
        private String id;
        private Integer installmentNumber;
        private BigDecimal amount;
        private LocalDate startDate;
        private LocalDate endDate;
        private LocalDate dueDate;
        private String status;
    }
}
