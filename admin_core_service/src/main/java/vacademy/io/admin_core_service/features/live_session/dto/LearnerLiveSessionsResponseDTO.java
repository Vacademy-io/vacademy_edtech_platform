package vacademy.io.admin_core_service.features.live_session.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Builder;
import lombok.Getter;

import java.util.List;

/** A learner's live classes in a date range (already-started ones only), newest first, plus totals. */
@Getter
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LearnerLiveSessionsResponseDTO {
    private String userId;
    private int totalClasses;
    private int presentCount;
    private int absentCount;
    // No attendance log yet — not synced from the provider and not marked by hand.
    private int unmarkedCount;
    private double attendancePercentage;
    // Mean of concentration_score over the classes that have one; null when none do.
    private Double avgConcentrationScore;
    private int scoredClasses;
    // Mean attended minutes over the classes with a provider duration; null when none have one.
    private Double avgDurationMinutes;
    private List<LearnerLiveClassDTO> classes;
}
