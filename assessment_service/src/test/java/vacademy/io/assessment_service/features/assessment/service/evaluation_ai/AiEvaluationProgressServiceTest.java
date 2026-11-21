package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCopyCheckClient;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.EvaluationProgressDto;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationStatusEnum;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.AiQuestionEvaluationRepository;
import vacademy.io.assessment_service.features.assessment.repository.CopyCheckLayoutRepository;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The progress DTO's file_id drives which PDF the review page shows and whether
 * it draws its own annotation overlay. It must be THIS run's checked copy, not
 * the attempt's latest one: an attempt can be re-evaluated, every run mints a
 * new file, and an older run's page must not show a newer run's marks.
 */
class AiEvaluationProgressServiceTest {

        private AiEvaluationProcessRepository processRepository;
        private AiEvaluationProgressService service;

        @BeforeEach
        void setUp() {
                processRepository = mock(AiEvaluationProcessRepository.class);
                AiQuestionEvaluationRepository questionRepository = mock(AiQuestionEvaluationRepository.class);
                CopyCheckLayoutRepository layoutRepository = mock(CopyCheckLayoutRepository.class);
                when(questionRepository.findByEvaluationProcessIdOrderByQuestionNumberAsc(anyString()))
                                .thenReturn(List.of());
                when(layoutRepository.findByEvaluationProcessId(anyString())).thenReturn(Optional.empty());
                service = new AiEvaluationProgressService(processRepository, questionRepository, new ObjectMapper(),
                                mock(AiEvaluationCancellationService.class), mock(AiServiceCopyCheckClient.class),
                                layoutRepository);
        }

        private AiEvaluationProcess process(String status, String evaluationJson, String attemptEvaluatedFileId) {
                StudentAttempt attempt = new StudentAttempt();
                attempt.setId("attempt-1");
                attempt.setEvaluatedFileId(attemptEvaluatedFileId);
                AiEvaluationProcess process = AiEvaluationProcess.builder()
                                .id("proc-1")
                                .status(status)
                                .evaluationJson(evaluationJson)
                                .studentAttempt(attempt)
                                .build();
                when(processRepository.findByIdWithCompleteDetails("proc-1")).thenReturn(Optional.of(process));
                return process;
        }

        @Test
        void completedRunServesItsOwnCheckedCopy_notTheAttemptsLatest() {
                process(AiEvaluationStatusEnum.COMPLETED.name(),
                                "{\"process_id\":\"proc-1\",\"evaluated_file_id\":\"file-of-this-run\"}",
                                "file-of-a-later-run");

                EvaluationProgressDto dto = service.getEvaluationProgress("proc-1");

                assertThat(dto.getFileId()).isEqualTo("file-of-this-run");
        }

        @Test
        void completedRunWithoutARenderedCopyServesNothing_evenIfTheAttemptHasOne() {
                // Render/upload failed for this run (ai_service reports no evaluated_file_id)
                // or the run predates the field. The attempt column still holds an older
                // run's copy — serving it would draw another run's marks under this
                // run's verdicts.
                process(AiEvaluationStatusEnum.COMPLETED.name(),
                                "{\"process_id\":\"proc-1\",\"total_marks_awarded\":10.0}",
                                "file-of-an-older-run");

                assertThat(service.getEvaluationProgress("proc-1").getFileId()).isNull();
        }

        @Test
        void inFlightRunServesNothing() {
                process(AiEvaluationStatusEnum.EVALUATING.name(), null, "file-of-an-older-run");

                assertThat(service.getEvaluationProgress("proc-1").getFileId()).isNull();
        }

        @Test
        void unreadableEvaluationJsonIsTreatedAsNoCopy() {
                process(AiEvaluationStatusEnum.COMPLETED.name(), "{not json", "file-of-an-older-run");

                assertThat(service.getEvaluationProgress("proc-1").getFileId()).isNull();
        }
}
