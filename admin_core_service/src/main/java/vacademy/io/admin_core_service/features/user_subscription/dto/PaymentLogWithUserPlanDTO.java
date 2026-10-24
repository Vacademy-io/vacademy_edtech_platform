package vacademy.io.admin_core_service.features.user_subscription.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.invoice.dto.PaymentLogInvoiceDTO;
import vacademy.io.common.auth.dto.UserDTO;

import java.time.LocalDate;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class PaymentLogWithUserPlanDTO {
    private PaymentLogDTO paymentLog;
    private UserPlanDTO userPlan;
    /**
     * PAID, FAILED, PAYMENT_PENDING, NOT_INITIATED — or CANCELLED for a row that stands for a
     * voided invoice, which must be visible but never counted toward collected/due.
     */
    private String currentPaymentStatus;
    private UserDTO user;
    /**
     * Set only on rows that ARE an invoice rather than a payment (an invoice raised but never paid
     * against). Rows backed by a real payment leave this null and have their invoice resolved by
     * the separate bulk lookup, which the optional Invoice column drives.
     */
    private PaymentLogInvoiceDTO invoice;
    /**
     * When the learner joined the batch this payment's plan is for (the stored enrolled_date),
     * shown on renewal attempts too. Null for invoice rows and for someone never enrolled there. See
     * UserPlanRepository.findPlanDates.
     */
    private LocalDate enrolledDate;
    /**
     * When the plan's next payment falls due, as an ISO string. A plain date (2026-10-15) for an
     * instalment or an unpaid invoice's due day, or a UTC instant (2026-10-18T18:30:00Z) for a
     * subscription renewal, which the client shows in its own zone. Null when nothing is due: the
     * plan is not ACTIVE, is one-time or free, or is fully paid.
     */
    private String nextDueOn;
}
