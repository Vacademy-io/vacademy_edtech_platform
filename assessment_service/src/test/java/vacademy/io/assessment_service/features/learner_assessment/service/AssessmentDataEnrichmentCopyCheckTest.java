package vacademy.io.assessment_service.features.learner_assessment.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.SectionRepository;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.OptionRepository;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * A copy checked by AI reaches the AI analysis with what the check found: the questions
 * (a scanned copy has no typed responses), what the AI read, the checker's feedback and
 * where marks were cut. An attempt with no copy check is enriched exactly as before.
 */
class AssessmentDataEnrichmentCopyCheckTest {

    private QuestionRepository questions;
    private SectionRepository sections;
    private QuestionWiseMarksRepository marks;
    private AssessmentDataEnrichmentService service;

    @BeforeEach
    void setUp() {
        questions = mock(QuestionRepository.class);
        sections = mock(SectionRepository.class);
        marks = mock(QuestionWiseMarksRepository.class);
        OptionRepository options = mock(OptionRepository.class);
        when(options.findByQuestionId(anyString())).thenReturn(List.of());
        service = new AssessmentDataEnrichmentService(questions, options, sections, marks,
                mock(LearnerReportService.class), new ObjectMapper());
        ReflectionTestUtils.setField(service, "classContextEnabled", false);

        Question q1 = new Question();
        q1.setId("q1");
        Question q2 = new Question();
        q2.setId("q2");
        when(questions.findAllById(any())).thenReturn(List.of(q1, q2));
        Section section = new Section();
        section.setId("s1");
        section.setName("Section A");
        section.setSectionOrder(1);
        when(sections.findAllById(any())).thenReturn(List.of(section));
    }

    private static StudentAttempt attempt(String attemptData, double resultMarks) {
        AssessmentUserRegistration registration = new AssessmentUserRegistration();
        registration.setUserId("copy-check:item-1");
        StudentAttempt attempt = new StudentAttempt();
        attempt.setId("a1");
        attempt.setRegistration(registration);
        attempt.setAttemptData(attemptData);
        attempt.setResultMarks(resultMarks);
        return attempt;
    }

    private static QuestionWiseMarks row(String questionId, double got, String verdictJson, String source) {
        Question q = new Question();
        q.setId(questionId);
        return QuestionWiseMarks.builder().id("m-" + questionId).question(q).sectionId("s1")
                .marks(got).status("PENDING").aiEvaluationDetailsJson(verdictJson).marksSource(source).build();
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> questionsOf(Map<String, Object> data) {
        List<Map<String, Object>> secs = (List<Map<String, Object>>) data.get("sections");
        return (List<Map<String, Object>>) secs.get(0).get("questions");
    }

    @Test
    void scannedCopyGetsItsQuestionsReadAnswerFeedbackAndCuts() {
        when(marks.findByStudentAttemptId("a1")).thenReturn(List.of(
                row("q1", 3, """
                        {"max_marks":5,"extracted_answer":"Photosynthesis uses light","feedback":"Diagram missing.",
                         "criteria_breakdown":[
                           {"criteria_name":"Concept","marks":3,"max_marks":3,"reason":"Correct."},
                           {"criteria_name":"Diagram","marks":0,"max_marks":2,"reason":"No labelled diagram."}]}
                        """, "AI"),
                row("q2", 2, """
                        {"max_marks":2,"extracted_answer":"Mitochondria","feedback":"Good."}
                        """, "AI_REVIEWED")));

        Map<String, Object> data = service.buildEnrichedAssessmentData(
                attempt("{\"fileId\":\"f1\"}", 5), "as1", "Biology", "EXAM", 60, 0, "inst");

        List<Map<String, Object>> qs = questionsOf(data);
        assertThat(qs).hasSize(2);
        Map<String, Object> first = qs.stream().filter(q -> "Photosynthesis uses light".equals(q.get("student_answer")))
                .findFirst().orElseThrow();
        assertThat(first.get("marks")).isEqualTo(5.0);
        assertThat(first.get("marks_obtained")).isEqualTo(3.0);
        assertThat(first.get("status")).isEqualTo("PARTIAL_CORRECT");
        assertThat(first.get("checker_feedback")).isEqualTo("Diagram missing.");
        assertThat((List<Map<String, Object>>) first.get("marks_lost")).singleElement()
                .satisfies(m -> {
                    assertThat(m.get("criterion")).isEqualTo("Diagram");
                    assertThat(m.get("marks_lost")).isEqualTo(2.0);
                    assertThat(m.get("reason")).isEqualTo("No labelled diagram.");
                });
        Map<String, Object> second = qs.stream().filter(q -> "Mitochondria".equals(q.get("student_answer")))
                .findFirst().orElseThrow();
        assertThat(second.get("status")).isEqualTo("CORRECT");
        assertThat(second.get("checked_by")).isEqualTo("AI, reviewed by teacher");
        assertThat(second).doesNotContainKey("marks_lost");

        Map<String, Object> summary = (Map<String, Object>) data.get("summary");
        assertThat(summary.get("total_marks")).isEqualTo(7.0);
        assertThat(summary.get("percentage")).isEqualTo(71.4);
        assertThat(data).containsKey("evaluation_note");
    }

    @Test
    void teachersEditedFeedbackWinsOverTheAis() {
        QuestionWiseMarks edited = row("q1", 1, "{\"max_marks\":2,\"feedback\":\"AI said this.\"}", "AI_REVIEWED");
        edited.setEvaluatorFeedback("Teacher said this.");
        when(marks.findByStudentAttemptId("a1")).thenReturn(List.of(edited));

        Map<String, Object> data = service.buildEnrichedAssessmentData(
                attempt(null, 1), "as1", "Biology", "EXAM", 60, 0, "inst");

        assertThat(questionsOf(data).get(0).get("checker_feedback")).isEqualTo("Teacher said this.");
    }

    @Test
    void totalIsLeftAloneWhenSomeQuestionHasNoKnownMaximum() {
        // An online test: one objective question (no per-question maximum here) and one
        // written answer the AI marked.
        when(marks.findByStudentAttemptId("a1")).thenReturn(List.of(
                row("q1", 1, null, null),
                row("q2", 3, "{\"max_marks\":5}", "AI")));
        String submitted = """
                {"sections":[{"sectionId":"s1","questions":[
                  {"questionId":"q1","responseData":{"answer":"b"}},
                  {"questionId":"q2","responseData":{"answer":"typed essay"}}]}]}
                """;

        Map<String, Object> data = service.buildEnrichedAssessmentData(
                attempt(submitted, 4), "as1", "Biology", "EXAM", 60, 0, "inst");

        assertThat(((Map<String, Object>) data.get("summary")).get("total_marks")).isEqualTo(0.0);
        assertThat(questionsOf(data).get(1).get("student_answer")).isEqualTo("typed essay");
        assertThat(questionsOf(data).get(1).get("status")).isEqualTo("PARTIAL_CORRECT");
    }

    @Test
    void attemptWithoutACopyCheckIsEnrichedAsBefore() {
        when(marks.findByStudentAttemptId("a1")).thenReturn(List.of(row("q1", 1, null, null)));
        String submitted = """
                {"sections":[{"sectionId":"s1","questions":[
                  {"questionId":"q1","responseData":{"answer":"typed"}}]}]}
                """;

        Map<String, Object> data = service.buildEnrichedAssessmentData(
                attempt(submitted, 1), "as1", "Biology", "EXAM", 60, 0, "inst");

        Map<String, Object> q = questionsOf(data).get(0);
        assertThat(q.get("status")).isEqualTo("PENDING");
        assertThat(q.get("student_answer")).isEqualTo("typed");
        assertThat(q).doesNotContainKeys("checker_feedback", "marks_lost", "checked_by");
        assertThat(data).doesNotContainKey("evaluation_note");
        assertThat(((Map<String, Object>) data.get("summary")).get("total_marks")).isEqualTo(0.0);
    }
}
