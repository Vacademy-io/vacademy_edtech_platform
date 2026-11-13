package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * What assessment_service sends about an open (public-link) assessment: the test, the
 * registrant, their answers to the test's registration form, and — on result release — their
 * marks. Feeds the test's own lead list (see OpenAssessmentLeadService).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class OpenAssessmentLeadEventDTO {
    private String instituteId;
    private String assessmentId;
    private String assessmentName;

    private String userId;
    private String fullName;
    private String email;
    private String mobileNumber;

    /** Registration form answers beyond name / email / phone, by the field's label. */
    private List<Answer> answers;

    /** Result release only. */
    private Double marks;
    private Double totalMarks;
    private Double percentage;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Answer {
        private String fieldName;
        private String value;
    }
}
