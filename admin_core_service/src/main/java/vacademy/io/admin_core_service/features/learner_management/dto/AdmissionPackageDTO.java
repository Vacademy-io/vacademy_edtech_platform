package vacademy.io.admin_core_service.features.learner_management.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.fee_management.dto.DiscountSpecDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.InstallmentScheduleDTO;
import vacademy.io.admin_core_service.features.offline_payment.dto.OfflinePaymentDetailsDTO;

import java.util.List;

/**
 * Enroll the request's courses as one admission package: one schedule and one discount for all
 * of them, one payment at admission and one admission receipt. The backend splits the schedule
 * and the discount across the courses in proportion to their fees and gives every course its
 * own installments (see AdmissionPackageSplitter). Courses must not carry their own
 * {@code cpo_config} or {@code admin_discount} alongside it.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AdmissionPackageDTO {

    /** For the record (type, value, reason); the amounts that count are the rows' discounts. */
    private DiscountSpecDTO discount;

    /** The package installments: due date, gross amount and discount off each. */
    private List<InstallmentScheduleDTO.RowDTO> rows;

    /** "SKIP" (default) or "OFFLINE". */
    private String paymentMode;

    /** Money recorded at admission, split across the courses installment by installment. */
    private Double paymentAmount;

    private String paymentReference;

    /** How it was paid (mode, option/account, reference, extras). */
    private OfflinePaymentDetailsDTO paymentDetails;
}
