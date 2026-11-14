package vacademy.io.assessment_service.features.assessment.dto.export;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * Whether the AI diagnostic report for one attempt can be downloaded right now.
 *
 * <p>Drives the admin menu's copy: an attempt whose insights already exist is a
 * plain download, one without them costs the institute AI credits, and one that
 * never sent submission data to the analytics pipeline can never have a report —
 * three very different things to put in front of a teacher.
 */
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AiStudentReportStatusDto {

    /** Insights already exist: downloading spends nothing. */
    public static final String STATUS_AVAILABLE = "AVAILABLE";
    /** Submission data exists but has not been analysed: downloading spends AI credits. */
    public static final String STATUS_NOT_GENERATED = "NOT_GENERATED";
    /** No analysable submission was ever captured for this attempt. */
    public static final String STATUS_UNSUPPORTED = "UNSUPPORTED";

    private String status;
    /** True only for {@link #STATUS_AVAILABLE} — the report downloads without an LLM call. */
    private boolean available;
    /** True when a download would trigger generation, i.e. spend credits. */
    private boolean requiresGeneration;
    private String message;
}
