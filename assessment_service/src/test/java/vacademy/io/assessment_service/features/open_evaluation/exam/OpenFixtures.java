package vacademy.io.assessment_service.features.open_evaluation.exam;

import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/** Shared test data for the exam facade tests. */
public final class OpenFixtures {

    public static final String INSTITUTE = "inst-1";
    public static final String KEY_ID = "key-1";

    private OpenFixtures() {
    }

    public static ApiKeyPrincipal key() {
        return ApiKeyPrincipal.builder()
                .keyId(KEY_ID).instituteId(INSTITUTE).name("ERP prod")
                .products(List.of("evaluation")).scopes(List.of("evaluation:read", "evaluation:write"))
                .status("ACTIVE").accessEnabled(true).build();
    }

    public static ApiExamStore.ApiExamRow exam(String id, String status, String mode, LocalDate conductedOn,
            Instant finalizedAt) {
        return new ApiExamStore.ApiExamRow(id, INSTITUTE, KEY_ID, null, mode, "school", null, null, null, "en", "en",
                "Use &lt;b&gt; marks", conductedOn, false, null, finalizedAt, Instant.parse("2026-10-01T09:00:00Z"),
                Instant.parse("2026-10-01T09:00:00Z"), "Class X Science", status, false);
    }

    public static ApiExamStore.ApiExamRow draft(String id) {
        return exam(id, "DRAFT", "handwritten", LocalDate.of(2026, 10, 1), null);
    }

    public static OpenQuestionService.ExamQuestion question(String id, String label, String type, String max,
            String sectionName, int order) {
        Question q = new Question();
        q.setId(id);
        q.setQuestionType(type);
        q.setSourceMeta("{\"source\":\"API\",\"question_number\":\"" + label + "\",\"section\":\"" + sectionName + "\"}");
        Section s = new Section();
        s.setId("sec-" + sectionName);
        s.setName(sectionName);
        s.setSectionOrder(1);
        QuestionAssessmentSectionMapping m = new QuestionAssessmentSectionMapping();
        m.setId("map-" + id);
        m.setQuestion(q);
        m.setSection(s);
        m.setQuestionOrder(order);
        m.setStatus("ACTIVE");
        m.setMarkingJson(max == null ? "{}" : QuestionMapper.markingJson(type, new BigDecimal(max), BigDecimal.ZERO));
        return new OpenQuestionService.ExamQuestion(m, q, s);
    }
}
