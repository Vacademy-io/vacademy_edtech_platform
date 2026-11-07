package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCopyCheckClient;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.rich_text.entity.AssessmentRichTextData;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The paper's criteria for the AI copy check, as the dashboard reads and saves them:
 * paper order, the stored rubric per question, only questions on the paper saved, and a
 * rubric store that cannot answer is an error, never "no criteria".
 */
class CopyCheckCriteriaServiceTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private QuestionAssessmentSectionMappingRepository mappings;
    private AiServiceCopyCheckClient client;
    private CopyCheckCriteriaService service;

    private static QuestionAssessmentSectionMapping mapping(String id, String type, String html, int sectionOrder,
                                                            int order, double marks, String criteria, String status) {
        Question q = new Question();
        q.setId(id);
        q.setQuestionType(type);
        AssessmentRichTextData text = new AssessmentRichTextData();
        text.setContent(html);
        q.setTextData(text);
        q.setEvaluationCriteriaJson(criteria);
        Section s = new Section();
        s.setSectionOrder(sectionOrder);
        QuestionAssessmentSectionMapping m = new QuestionAssessmentSectionMapping();
        m.setQuestion(q);
        m.setSection(s);
        m.setQuestionOrder(order);
        m.setStatus(status);
        m.setMarkingJson("{\"data\":{\"totalMark\":" + marks + "}}");
        return m;
    }

    @BeforeEach
    void setUp() {
        mappings = mock(QuestionAssessmentSectionMappingRepository.class);
        client = mock(AiServiceCopyCheckClient.class);
        DashboardChoiceGroups groups = new DashboardChoiceGroups(null, mappings, mapper);
        service = new CopyCheckCriteriaService(mappings, client, groups, mapper);
        when(mappings.getQuestionAssessmentSectionMappingByAssessmentId("a1")).thenReturn(List.of(
                mapping("q2", "LONG_ANSWER", "<p>Why did Anne&nbsp;confide?</p>", 1, 2, 3, null, "ACTIVE"),
                mapping("q1", "ONE_WORD", "<p>Fill in</p>", 1, 1, 1,
                        "{\"max_marks\":1,\"rubric\":[{\"criteria_name\":\"Point 1\",\"max_marks\":1}]}", "ACTIVE"),
                mapping("q9", "LONG_ANSWER", "<p>Gone</p>", 1, 3, 3, null, "DELETED")));
    }

    @Test
    void view_lists_the_paper_in_order_with_the_stored_rubric() throws Exception {
        JsonNode stored = mapper.readTree("{\"rubric_version\":4,\"rubric\":{\"q2\":{\"max_marks\":3,\"rubric\":[]}}}");
        when(client.fetchRubric("a1", "inst")).thenReturn(Optional.of(stored));

        Map<String, Object> view = service.view("inst", "a1");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rows = (List<Map<String, Object>>) view.get("questions");
        assertThat(rows).extracting(r -> r.get("question_id")).containsExactly("q1", "q2");
        assertThat(rows.get(0)).containsEntry("number", 1).containsEntry("max_marks", 1.0)
                .containsEntry("text", "Fill in").containsEntry("rubric", null);
        assertThat(rows.get(0).get("question_criteria")).isNotNull();
        assertThat(rows.get(1)).containsEntry("text", "Why did Anne confide?");
        assertThat(rows.get(1).get("rubric")).isEqualTo(stored.path("rubric").get("q2"));
        assertThat(view).containsEntry("rubric_version", 4);
    }

    @Test
    void no_stored_rubric_yet_is_every_question_unset() {
        when(client.fetchRubric("a1", "inst")).thenReturn(Optional.empty());
        Map<String, Object> view = service.view("inst", "a1");
        assertThat(view).containsEntry("rubric_version", null);
    }

    @Test
    void a_rubric_store_that_cannot_answer_is_an_error_not_no_criteria() {
        when(client.fetchRubric("a1", "inst"))
                .thenThrow(new AiServiceCopyCheckClient.RubricStoreUnavailableException("down", null));
        assertThatThrownBy(() -> service.view("inst", "a1"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("503");
    }

    @Test
    void save_cleans_the_rubric_and_pins_the_question_maximum() throws Exception {
        when(client.patchRubric(eq("a1"), eq("inst"), any(), eq(4)))
                .thenReturn(new AiServiceCopyCheckClient.RubricPatchResult(5, 200, null, false));
        JsonNode body = mapper.readTree("""
                {"q2": {"max_marks": 10, "evaluation_instructions": "CBSE scheme",
                        "rubric": [{"criteria_name": "Content", "max_marks": 2, "evaluation_guidelines": "points"},
                                   {"criteria_name": "  ", "max_marks": 1},
                                   {"criteria_name": "Expression", "max_marks": 1, "keywords": ["", "tone"]}]}}
                """);
        assertThat(service.save("inst", "a1", body, 4)).isEqualTo(5);

        ArgumentCaptor<JsonNode> sent = ArgumentCaptor.forClass(JsonNode.class);
        verify(client).patchRubric(eq("a1"), eq("inst"), sent.capture(), eq(4));
        JsonNode rubric = sent.getValue().path("q2").path("rubric");
        assertThat(rubric.path("max_marks").asDouble()).isEqualTo(3.0);
        assertThat(rubric.path("partial_marking_enabled").asBoolean()).isTrue();
        assertThat(rubric.path("evaluation_instructions").asText()).isEqualTo("CBSE scheme");
        assertThat(rubric.path("rubric")).hasSize(2);
        assertThat(rubric.path("rubric").get(1).path("keywords")).hasSize(1);
    }

    @Test
    void save_refuses_questions_off_the_paper_and_empty_rubrics() throws Exception {
        assertThatThrownBy(() -> service.save("inst", "a1",
                mapper.readTree("{\"q9\": {\"rubric\": [{\"criteria_name\": \"x\", \"max_marks\": 1}]}}"), null))
                .hasMessageContaining("not on this paper");
        assertThatThrownBy(() -> service.save("inst", "a1", mapper.readTree("{\"q2\": {\"rubric\": []}}"), null))
                .hasMessageContaining("at least one criterion");
        assertThatThrownBy(() -> service.save("inst", "a1", mapper.readTree("{}"), null))
                .hasMessageContaining("no rubrics");
        verify(client, never()).patchRubric(any(), any(), any(), any());
    }

    @Test
    void a_version_mismatch_is_a_conflict() throws Exception {
        when(client.patchRubric(any(), any(), any(), any()))
                .thenReturn(new AiServiceCopyCheckClient.RubricPatchResult(null, 412, "mismatch", false));
        assertThatThrownBy(() -> service.save("inst", "a1",
                mapper.readTree("{\"q2\": {\"rubric\": [{\"criteria_name\": \"Content\", \"max_marks\": 3}]}}"), 1))
                .hasMessageContaining("409");
    }
}
