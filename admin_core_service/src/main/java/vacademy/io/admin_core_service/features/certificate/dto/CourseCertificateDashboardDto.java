package vacademy.io.admin_core_service.features.certificate.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Counts behind the course Certificates dashboard cards. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CourseCertificateDashboardDto {

    private long totalEnrolled;

    private long certificatesGenerated;

    /** Enrolled learners with no certificate, at any completion level. */
    private long certificatesPending;

    /** Past the threshold but not yet issued — the actionable group. */
    private long completedAwaitingCertificate;

    /** Within 10 points below the threshold (70-79 when the threshold is 80). */
    private long nearThreshold;

    /** The threshold actually in force here, after course-override resolution. */
    private int thresholdPercent;

    /**
     * PROGRESS | SCORE | PROGRESS_AND_SCORE. Under a score rule "awaiting" means
     * "meets the whole rule", and "near" means one test short (or, for an average
     * rule, within 10 points of the bar).
     */
    private String criteriaMode;

    /** ALL | AT_LEAST | AVERAGE; null under a progress-only rule. */
    private String passRule;

    /** Live tests in this batch the rule counts; null under a progress-only rule. */
    private Integer testsInRule;

    /** Learners with at least one test whose marks are not final yet; null under a progress-only rule. */
    private Long learnersAwaitingResults;
}
