package vacademy.io.admin_core_service.features.admission_package.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/**
 * One admission package as the learner side view shows it: the courses with what each was
 * charged and has paid, and the package installments (every course's bills on a due date added
 * together). Totals are live from the fee bills; {@code feeTotal} and {@code discountTotal} are
 * what was agreed at admission.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AdmissionPackageSummaryDTO {

    private String id;
    private LocalDateTime createdAt;
    private String discountReason;
    private String currency;

    private BigDecimal feeTotal;
    private BigDecimal discountTotal;
    /** What the learner is billed now (after any later changes to a course's bills). */
    private BigDecimal netTotal;
    private BigDecimal paidTotal;
    private BigDecimal outstandingTotal;

    /** Earliest due date still owed, and what is owed on it across the courses. */
    private LocalDate nextDueDate;
    private BigDecimal nextDueAmount;

    private List<Course> courses;
    private List<Installment> installments;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Course {
        private String userPlanId;
        private String packageSessionId;
        private String courseName;
        private String planStatus;
        private BigDecimal fee;
        private BigDecimal discount;
        private BigDecimal net;
        private BigDecimal paid;
        private BigDecimal outstanding;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Installment {
        private LocalDate dueDate;
        private BigDecimal amount;
        private BigDecimal paid;
        private BigDecimal outstanding;
        /** While its dues are stopped (Stop dues): what was taken off, and why. */
        private BigDecimal stopped;
        private String stoppedReason;
        /** PAID, PARTIAL_PAID, OVERDUE, DUE, or STOPPED when nothing on it is owed because its dues were stopped. */
        private String status;
    }
}
