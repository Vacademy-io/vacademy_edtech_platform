package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.HashMap;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.fasterxml.jackson.databind.ObjectMapper;

import vacademy.io.assessment_service.features.assessment.client.AiServiceCopyCheckClient;
import vacademy.io.assessment_service.features.assessment.client.EvalApiStorageClient;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.question_core.repository.OptionRepository;

/**
 * The answer sheet's URL follows the file, not the caller: a dashboard re-check of an
 * API-uploaded copy (no api_key_id on the run) must still reach the private eval-api file.
 */
class CopyCheckOrchestratorAnswerSheetUrlTest {

    private final Map<String, String> publicUrls = new HashMap<>();
    private EvalApiStorageClient storage;
    private CopyCheckOrchestratorService service;

    @BeforeEach
    void setUp() {
        storage = mock(EvalApiStorageClient.class);
        service = new CopyCheckOrchestratorService(mock(AiEvaluationProcessRepository.class),
                mock(QuestionWiseMarksRepository.class), mock(AiQuestionEvaluationService.class),
                mock(EvaluationUtilityService.class), mock(AiServiceCopyCheckClient.class), new ObjectMapper(),
                mock(OptionRepository.class), mock(QuestionAssessmentSectionMappingRepository.class),
                mock(TypedAnswerEvaluation.class), mock(org.springframework.transaction.PlatformTransactionManager.class),
                mock(AiEvaluationCreditGate.class), null) {
            @Override
            String getFileUrl(String fileId) {
                return publicUrls.get(fileId);
            }
        };
        ReflectionTestUtils.setField(service, "evalApiStorageClient", storage);
    }

    private static AiEvaluationProcess process(String apiKeyId) {
        AiEvaluationProcess p = new AiEvaluationProcess();
        p.setApiKeyId(apiKeyId);
        return p;
    }

    @Test
    void api_run_reads_the_sheet_through_the_signed_url() {
        when(storage.signedUrl("f1", CopyCheckOrchestratorService.EVAL_API_URL_SECONDS))
                .thenReturn(new EvalApiStorageClient.SignedUrl("https://signed/f1", null));
        publicUrls.put("f1", "https://public/f1");

        assertThat(service.answerSheetUrl(process("key-1"), "f1")).isEqualTo("https://signed/f1");
    }

    @Test
    void dashboard_run_on_an_ordinary_file_keeps_the_public_url() {
        publicUrls.put("f1", "https://public/f1");

        assertThat(service.answerSheetUrl(process(null), "f1")).isEqualTo("https://public/f1");
        verify(storage, never()).signedUrl(anyString(), anyInt());
    }

    @Test
    void dashboard_run_on_an_api_uploaded_file_falls_back_to_the_signed_url() {
        when(storage.signedUrl("f2", CopyCheckOrchestratorService.EVAL_API_URL_SECONDS))
                .thenReturn(new EvalApiStorageClient.SignedUrl("https://signed/f2", null));

        assertThat(service.answerSheetUrl(process(null), "f2")).isEqualTo("https://signed/f2");
    }

    @Test
    void neither_route_gives_a_url_is_null() {
        when(storage.signedUrl("f3", CopyCheckOrchestratorService.EVAL_API_URL_SECONDS))
                .thenThrow(new EvalApiStorageClient.NotFound("no"));

        assertThat(service.answerSheetUrl(process(null), "f3")).isNull();
    }
}
