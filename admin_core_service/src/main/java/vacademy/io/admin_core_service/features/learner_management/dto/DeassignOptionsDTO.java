package vacademy.io.admin_core_service.features.learner_management.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class DeassignOptionsDTO {

    /**
     * SOFT — mark plan CANCELED, access continues until expiry
     * HARD — mark plan TERMINATED, immediate access revocation
     */
    @Builder.Default
    private String mode = "SOFT";

    @Builder.Default
    private boolean notifyLearners = true;

    @Builder.Default
    private boolean dryRun = false;

    /**
     * SOFT-mode only. The "last access date" the learner keeps access until.
     * When present, overrides the enrollment mapping's {@code expiry_date} with
     * this date; when null, SOFT leaves the existing plan/enrollment expiry
     * untouched (access continues to the plan's own expiry). Ignored for HARD.
     * Accepts a bare {@code yyyy-MM-dd} date or a full ISO-8601 instant.
     */
    private String accessTillDate;

    /**
     * HARD-mode only. Why the admin terminated the learner — kept in the
     * admin activity log. Optional unless the institute's
     * LEARNER_TERMINATION_REASON setting marks it required. Ignored for SOFT.
     */
    private String reason;

    /**
     * HARD-mode only. Also permanently delete the course's payment history — its payments,
     * installments, invoices, ledger rows and the plan — so it shows nowhere. Needs the
     * {@code allowDeletePayments} Display Settings permission. Off = today's behaviour: what was
     * paid stays on record, only the open installments are cancelled.
     */
    private boolean deletePaymentHistory;
}
