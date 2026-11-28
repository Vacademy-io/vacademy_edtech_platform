package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.copy_intake.entity.AiCopyIntakeItem;
import vacademy.io.assessment_service.features.assessment.copy_intake.repository.AiCopyIntakeItemRepository;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CopyCheckGradeRequestDto;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;

/**
 * Only a Bulk AI check copy (whose panel offers "Check in <language>") asks
 * ai_service to stop a copy written in another language than its paper; every
 * other run is sent exactly as before.
 */
class CopyCheckLanguageConfirmationTest {

    private static CopyCheckOrchestratorService service(AiCopyIntakeItemRepository items) {
        CopyCheckOrchestratorService s = new CopyCheckOrchestratorService(
                null, null, null, null, null, null, null, null, null, null, null, null);
        ReflectionTestUtils.setField(s, "copyIntakeItemRepository", items);
        return s;
    }

    private static AiEvaluationProcess process(String id) {
        AiEvaluationProcess p = new AiEvaluationProcess();
        p.setId(id);
        return p;
    }

    @Test
    void a_bulk_copy_without_a_confirmed_language_asks() {
        AiCopyIntakeItemRepository items = mock(AiCopyIntakeItemRepository.class);
        when(items.findFirstByProcessId("p-1")).thenReturn(Optional.of(new AiCopyIntakeItem()));
        assertThat(service(items).asksLanguageConfirmation(process("p-1"))).isTrue();
    }

    @Test
    void single_copy_checks_confirmed_runs_and_partner_runs_never_ask() {
        AiCopyIntakeItemRepository items = mock(AiCopyIntakeItemRepository.class);
        when(items.findFirstByProcessId("single")).thenReturn(Optional.empty());
        assertThat(service(items).asksLanguageConfirmation(process("single"))).isFalse();

        AiEvaluationProcess confirmed = process("p-2");
        confirmed.setAnswerLanguage("hi");
        assertThat(service(items).asksLanguageConfirmation(confirmed)).isFalse();

        AiEvaluationProcess api = process("p-3");
        api.setApiKeyId("key-1");
        assertThat(service(items).asksLanguageConfirmation(api)).isFalse();
        verify(items, never()).findFirstByProcessId("p-2");
        verify(items, never()).findFirstByProcessId("p-3");

        assertThat(service(null).asksLanguageConfirmation(process("p-4"))).isFalse();
    }

    @Test
    void a_failed_lookup_means_no_question() {
        AiCopyIntakeItemRepository items = mock(AiCopyIntakeItemRepository.class);
        when(items.findFirstByProcessId(anyString())).thenThrow(new RuntimeException("db down"));
        assertThat(service(items).asksLanguageConfirmation(process("p-1"))).isFalse();
    }

    @Test
    void the_flag_is_left_out_of_the_request_unless_set() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        assertThat(mapper.writeValueAsString(CopyCheckGradeRequestDto.builder().answerMode("COPY").build()))
                .doesNotContain("confirm_other_language");
        assertThat(mapper.writeValueAsString(CopyCheckGradeRequestDto.builder().answerMode("COPY")
                .confirmOtherLanguage(Boolean.TRUE).build()))
                .contains("\"confirm_other_language\":true");
    }
}
