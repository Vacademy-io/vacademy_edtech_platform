package vacademy.io.admin_core_service.features.learner_management.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.fee_management.dto.DiscountSpecDTO;

import java.util.List;

/**
 * Structured per-learner CPO configuration on the bulk-assign v3 path.
 *
 * <p>Sits on {@link AssignmentItemDTO#getCpoConfig()}. When present, it
 * supersedes the legacy {@code cpoPaymentAmount} / {@code cpoPaymentMode}
 * fields. When absent, the assignment behaves exactly as before — the CPO
 * template is materialized as-is and the legacy fields apply.
 *
 * <p>Apply order at enrollment:
 * <ol>
 *   <li>SFP rows generated from the CPO template.</li>
 *   <li>{@code installmentOverrides} applied (per-installment dates/amount/discount).</li>
 *   <li>{@code cpoDiscount} applied across SFPs proportionally to their current
 *       (post-installment-override) amount.</li>
 *   <li>If {@code paymentMode = OFFLINE}, {@code paymentAmount} is FIFO-allocated
 *       across the resulting net dues.</li>
 * </ol>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CpoEnrollmentConfigDTO {

    private List<InstallmentOverrideDTO> installmentOverrides;

    /** Whole-CPO discount applied after per-installment overrides. */
    private DiscountSpecDTO cpoDiscount;

    /** "SKIP" (default) or "OFFLINE". Mirrors {@link AssignmentItemDTO#getCpoPaymentMode()}. */
    private String paymentMode;

    /** Offline amount to record + FIFO-allocate. Only used when paymentMode=OFFLINE. */
    private Double paymentAmount;

    /** Optional external reference (cheque #, UPI ref) — stored on PaymentLog.paymentSpecificData. */
    private String paymentReference;

    /**
     * How the offline payment was made (mode, sub-option, reference, date). Falls back to
     * {@code options.payment_details}. See OfflinePaymentDetailsService.
     */
    private vacademy.io.admin_core_service.features.offline_payment.dto.OfflinePaymentDetailsDTO paymentDetails;

    /**
     * Learner-specific installment schedule chosen by the admin (count, gap, first due
     * date, optionally edited rows). When set, the learner's bills are generated from it
     * instead of the plan's fixed template; it also lets a one-time course price be paid
     * in installments. Cannot be combined with {@link #installmentOverrides}, which target
     * template rows. See docs/CPO_FLEXIBLE_INSTALLMENTS.md.
     */
    private vacademy.io.admin_core_service.features.fee_management.dto.InstallmentScheduleDTO installmentSchedule;
}
