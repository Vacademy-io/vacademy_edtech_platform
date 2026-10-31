package vacademy.io.admin_core_service.features.user_subscription.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;

/**
 * A learner with an outstanding balance: who they are, what they were billed, what they have paid,
 * and how the fee is structured. This is the drill-down behind the "Due payment" card — the card
 * answers how much is owed, this answers by whom, and (for CPO) which instalment is next.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class OutstandingLearnerDTO {

    private String userId;
    private String fullName;
    private String email;
    private String mobileNumber;

    private String courseName;
    private String paymentType;
    private String planStatus;

    private Double billed;
    private Double paid;
    /** Overdue right now — what puts the learner on this list. */
    private Double due;
    /** Falling due within the upcoming horizon. */
    private Double upcoming;

    private Long planCount;
    private Long pendingInstallments;
    private LocalDate nextDueDate;

    /** Outstanding list only: everything still to collect, whatever its due date. */
    private Double outstanding;
    /** Outstanding list only: what falls due on {@link #nextDueDate}. */
    private Double nextDueAmount;
    /** Month-filtered Upcoming list only: what falls due inside the selected month. */
    private Double monthAmount;

    private String currency;
}
