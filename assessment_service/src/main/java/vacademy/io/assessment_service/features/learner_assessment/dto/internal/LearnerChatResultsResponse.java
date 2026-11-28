package vacademy.io.assessment_service.features.learner_assessment.dto.internal;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.Date;
import java.util.List;

/**
 * The learner's own test results, gated exactly like the learner app's report list: only
 * RELEASED attempts carry marks. Attempts the institute has not released are listed by name
 * only, so the chatbot can say "awaiting result" without leaking a score.
 * Returned by {@code GET /assessment-service/internal/learner-chat/v1/results}.
 */
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LearnerChatResultsResponse {
    /** Released results, newest first, enriched with total, %, rank, percentile and sections. */
    private List<AssessmentHistoryItemDto> results;
    /** Submitted but not released yet — names and dates only, never marks. */
    private List<AwaitingResult> awaitingRelease;

    @Getter
    @Setter
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class AwaitingResult {
        private String assessmentId;
        private String assessmentName;
        private Date attemptDate;
    }
}
