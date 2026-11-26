package vacademy.io.assessment_service.features.assessment.copy;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.List;

/**
 * What the admin chose in the Duplicate Assessment dialog. Every field is optional:
 * an empty body copies the whole assessment (questions, marks, schedule, batches) as a draft.
 */
@Getter
@Setter
@NoArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AssessmentCopyRequest {

    /** Name of the copy; blank means "Copy of {original name}". */
    private String name;

    /** Copy the sections and questions (default true). False gives a copy with no sections. */
    private Boolean copyQuestions;

    /** Keep each question's marks and negative marking (default true); false resets every question to 1 mark. */
    private Boolean copyMarking;

    /** New live window, ISO date-times with zone (e.g. 2026-12-01T04:30:00.000Z); absent keeps the original's. */
    private String startDate;
    private String endDate;

    /** New registration window of an open (public) test; absent keeps the original's. */
    private String registrationOpenDate;
    private String registrationCloseDate;

    /** Batches (package session ids) of the copy. Null keeps the original's batches; empty means none. */
    private List<String> batchIds;

    /** Also add the learners the admin added one by one to the original (default false). */
    private Boolean copyIndividualParticipants;
}
