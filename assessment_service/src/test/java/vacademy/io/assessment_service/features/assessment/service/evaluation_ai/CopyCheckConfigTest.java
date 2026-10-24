package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CopyCheckGradeRequestDto;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The AI checking settings of an assessment (subject, level, instructions, language
 * feedback): stored clean, merged with the institute default, and sent as
 * exam_context only when something is set.
 */
class CopyCheckConfigTest {

    private static CopyCheckConfig.Settings settings(String subject, String level, String instructions,
                                                     String language) {
        return CopyCheckConfig.Settings.builder().subject(subject).level(level)
                .instructions(instructions).languageFeedback(language).build();
    }

    @Test
    void normalize_trims_caps_and_keeps_known_modes_only() {
        CopyCheckConfig.Settings s = CopyCheckConfig.normalize(settings(
                "  English\tLanguage  ", "", " Letter: format 1,\r\ncontent 2. ", "highlight"));
        assertThat(s.getSubject()).isEqualTo("English Language");
        assertThat(s.getLevel()).isNull();
        assertThat(s.getInstructions()).isEqualTo("Letter: format 1,\ncontent 2.");
        assertThat(s.getLanguageFeedback()).isEqualTo("HIGHLIGHT");
        assertThat(CopyCheckConfig.normalize(settings(null, null, null, "loud")).getLanguageFeedback()).isNull();
        assertThat(CopyCheckConfig.normalize(settings(null, null, "x".repeat(5000), null)).getInstructions())
                .hasSize(CopyCheckConfig.INSTRUCTIONS_CAP);
    }

    @Test
    void stored_json_round_trips_and_empty_is_null() {
        String json = CopyCheckConfig.write(settings("English", "CBSE Class X", "Be fair.", "HIGHLIGHT"));
        assertThat(json).contains("\"language_feedback\":\"HIGHLIGHT\"").contains("\"subject\":\"English\"");
        assertThat(CopyCheckConfig.read(json)).isEqualTo(settings("English", "CBSE Class X", "Be fair.", "HIGHLIGHT"));
        assertThat(CopyCheckConfig.write(settings(" ", null, "", "nope"))).isNull();
        assertThat(CopyCheckConfig.read("not json")).isEqualTo(new CopyCheckConfig.Settings());
    }

    @Test
    void differs_only_when_a_batch_sends_something_new() {
        Assessment a = new Assessment();
        a.setCopyCheckConfig(CopyCheckConfig.write(settings("English", null, null, "HIGHLIGHT")));
        assertThat(CopyCheckConfig.differs(a, null)).isFalse();
        assertThat(CopyCheckConfig.differs(a, settings(" English ", null, "", "highlight"))).isFalse();
        assertThat(CopyCheckConfig.differs(a, settings("English", null, "Be fair.", "HIGHLIGHT"))).isTrue();
        assertThat(CopyCheckConfig.differs(a, new CopyCheckConfig.Settings())).isTrue();   // cleared
    }

    @Test
    void exam_context_merges_the_institute_default_where_the_assessment_has_none() {
        assertThat(CopyCheckConfig.examContext(null, null)).isNull();
        assertThat(CopyCheckConfig.examContext(new CopyCheckConfig.Settings(), Map::of)).isNull();

        Map<String, Object> ctx = CopyCheckConfig.examContext(settings("English", "CBSE Class X", null, null),
                () -> Map.of("instructions", "Institute rule.", "languageFeedback", "HIGHLIGHT",
                        "commentPlacement", "OUTSIDE"));
        assertThat(ctx).containsExactly(Map.entry("level", "CBSE Class X"), Map.entry("subject", "English"),
                Map.entry("instructions", "Institute rule."), Map.entry("language_feedback", "HIGHLIGHT"));

        // The assessment's own choices win, OFF included; OFF is never sent.
        ctx = CopyCheckConfig.examContext(settings(null, null, "Own rule.", "OFF"),
                () -> Map.of("instructions", "Institute rule.", "languageFeedback", "HIGHLIGHT"));
        assertThat(ctx).containsExactly(Map.entry("instructions", "Own rule."));

        // A failing institute lookup still sends the assessment's settings.
        ctx = CopyCheckConfig.examContext(settings(null, null, null, "HIGHLIGHT"), () -> {
            throw new IllegalStateException("down");
        });
        assertThat(ctx).containsExactly(Map.entry("language_feedback", "HIGHLIGHT"));
    }

    // ---- dispatch

    private static CopyCheckOrchestratorService service(AdminCoreServiceClient adminCore) {
        CopyCheckOrchestratorService s = new CopyCheckOrchestratorService(
                null, null, null, null, null, null, null, null, null, null, null, null);
        ReflectionTestUtils.setField(s, "adminCoreServiceClient", adminCore);
        return s;
    }

    private static CopyCheckOrchestratorService.DispatchFacts facts(boolean api) {
        return new CopyCheckOrchestratorService.DispatchFacts(false, false, "inst-1", null, null, api, null);
    }

    private static CopyCheckGradeRequestDto request(CopyCheckConfig.Settings settings) {
        List<CopyCheckGradeRequestDto.QuestionInput> questions = new ArrayList<>();
        questions.add(CopyCheckGradeRequestDto.QuestionInput.builder().questionId("q1").subject("Science").build());
        return CopyCheckGradeRequestDto.builder().answerMode("COPY").questions(questions)
                .copyCheckSettings(settings).build();
    }

    @Test
    void nothing_set_leaves_the_request_unchanged() {
        AdminCoreServiceClient adminCore = mock(AdminCoreServiceClient.class);
        when(adminCore.getAiCopyCheckDefaults("inst-1")).thenReturn(Map.of());
        CopyCheckGradeRequestDto r = request(new CopyCheckConfig.Settings());
        service(adminCore).applyCopyCheckSettings(r, facts(false));
        assertThat(r.getExamContext()).isNull();
        assertThat(r.getQuestions().get(0).getSubject()).isEqualTo("Science");
    }

    @Test
    void dashboard_copy_gets_the_settings_and_their_subject() {
        AdminCoreServiceClient adminCore = mock(AdminCoreServiceClient.class);
        when(adminCore.getAiCopyCheckDefaults("inst-1")).thenReturn(Map.of("languageFeedback", "HIGHLIGHT"));
        CopyCheckGradeRequestDto r = request(settings("English", null, "Letter: format 1.", null));
        service(adminCore).applyCopyCheckSettings(r, facts(false));
        assertThat(r.getExamContext()).containsEntry("subject", "English")
                .containsEntry("instructions", "Letter: format 1.")
                .containsEntry("language_feedback", "HIGHLIGHT");
        assertThat(r.getQuestions().get(0).getSubject()).isEqualTo("English");
    }

    @Test
    void partner_api_keeps_its_own_exam_context_and_never_asks_admin_core() {
        AdminCoreServiceClient adminCore = mock(AdminCoreServiceClient.class);
        CopyCheckGradeRequestDto r = request(settings("English", null, null, "HIGHLIGHT"));
        service(adminCore).applyCopyCheckSettings(r, facts(true));
        assertThat(r.getExamContext()).isNull();

        CopyCheckGradeRequestDto own = request(settings("English", null, null, "HIGHLIGHT"));
        own.setExamContext(Map.of("subject", "Law"));
        service(adminCore).applyCopyCheckSettings(own, facts(false));
        assertThat(own.getExamContext()).isEqualTo(Map.of("subject", "Law"));
        verify(adminCore, never()).getAiCopyCheckDefaults(any());
    }

    @Test
    void settings_are_never_serialised_into_the_request() throws Exception {
        CopyCheckGradeRequestDto r = request(settings("English", null, "x", "HIGHLIGHT"));
        String json = new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(r);
        assertThat(json).doesNotContain("copy_check").doesNotContain("copyCheck").doesNotContain("exam_context");
    }
}
