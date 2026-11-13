package vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response;


import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.*;

import java.util.List;
import java.util.Map;

@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@Builder
public class StudentReportOverallDetailDto {
    private String evaluatedFileId;
    // The learner's own submitted answer file (from the attempt's attemptData),
    // so the report can offer "view submitted" alongside "view evaluated".
    private String responseFileId;
    // An admin-uploaded result report (offline data entry). Distinct from the
    // system-generated report cached on student_attempt.report_pdf_file_id, which
    // is regenerated — and overwritten — on every result release.
    private String reportFileId;
    private ParticipantsQuestionOverallDetailDto questionOverallDetailDto;
    private Map<String, List<StudentReportAnswerReviewDto>> allSections;
    // What the assessment lets the student see per question (ReportOptions.toJson).
    // Set on the learner endpoint only, where hidden fields are also stripped;
    // null on admin responses, which always carry everything.
    private com.fasterxml.jackson.databind.JsonNode reportOptions;
}
