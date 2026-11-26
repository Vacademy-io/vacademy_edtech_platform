package vacademy.io.admin_core_service.features.certificate.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * Where one learner stands against their course's certificate rule: whether the
 * certificate is due, and - for a score rule - every test that counts with the
 * learner's result on it. The issue gate, the admin table and the learner's
 * course page all read this one shape, so they cannot disagree.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CertificateEligibilityDto {

    public static final String STATUS_PASSED = "PASSED";
    public static final String STATUS_FAILED = "FAILED";
    /** Attempted with final marks, under an AVERAGE rule where no single test passes or fails. */
    public static final String STATUS_COMPLETED = "COMPLETED";
    public static final String STATUS_NOT_ATTEMPTED = "NOT_ATTEMPTED";
    /** Submitted, but the marks are not final yet (teacher or AI checking, or not released). */
    public static final String STATUS_AWAITING_RESULT = "AWAITING_RESULT";

    /** No test in this learner's batch matches the rule, so a score rule can never be met. */
    public static final String BLOCKER_NO_TESTS = "NO_TESTS_FOUND";
    /** Assessment marks could not be fetched; the rule fails closed until they can. */
    public static final String BLOCKER_SCORES_UNAVAILABLE = "ASSESSMENT_SCORES_UNAVAILABLE";

    private boolean enabled;

    /** PROGRESS | SCORE | PROGRESS_AND_SCORE. */
    private String mode;

    /** True when every part of the rule is met. */
    private boolean eligible;

    private boolean progressRequired;
    private int thresholdPercent;
    private Double completionPercentage;
    private boolean progressMet;

    private boolean scoreRequired;
    private boolean scoreMet;
    private String passRule;
    private Integer passPercent;
    /** AT_LEAST: tests that must be passed, capped at the number of tests. */
    private Integer testsRequired;
    private int testsTotal;
    private int testsPassed;
    private int testsAwaitingResult;
    private int testsNotAttempted;
    /** Mean score across all the tests, not-attempted counting as 0. */
    private Double averageScorePercent;
    private String scoreBlocker;

    @Builder.Default
    private List<TestResult> tests = new ArrayList<>();

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class TestResult {
        private String slideId;
        private String title;
        /** QUIZ | ASSESSMENT. */
        private String type;
        private String moduleName;
        private String chapterName;
        /** Best final score; null when not attempted or still awaiting marks. */
        private Double scorePercent;
        /** The bar this test is judged by; null under an AVERAGE rule. */
        private Double passPercent;
        private String status;
        private int attempts;
    }
}
