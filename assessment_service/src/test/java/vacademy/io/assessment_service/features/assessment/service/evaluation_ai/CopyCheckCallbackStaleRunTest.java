package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.CopyIntakeService;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CopyCheckCallbackDto;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.AiQuestionEvaluationRepository;
import vacademy.io.assessment_service.features.assessment.repository.CopyCheckLayoutRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * A re-dispatched copy can have two ai_service jobs: the one it was re-sent as (recorded
 * on the process) and an older one still running. The older one's terminal callback must
 * not settle the process.
 */
class CopyCheckCallbackStaleRunTest {

    private AiEvaluationProcessRepository processes;
    private CopyIntakeService intake;
    private CopyCheckCallbackService service;
    private AiEvaluationProcess process;

    @BeforeEach
    void setUp() {
        processes = mock(AiEvaluationProcessRepository.class);
        intake = mock(CopyIntakeService.class);
        service = new CopyCheckCallbackService(processes, intake, mock(AiQuestionEvaluationRepository.class),
                mock(CopyCheckLayoutRepository.class), mock(QuestionWiseMarksRepository.class),
                mock(StudentAttemptRepository.class), mock(AiEvaluationCancellationService.class),
                mock(TypedAnswerEvaluation.class), new ObjectMapper());
        process = new AiEvaluationProcess();
        process.setId("p1");
        process.setStatus("PROCESSING");
        process.setAiServiceJobId("job-new");
        when(processes.findById("p1")).thenReturn(Optional.of(process));
    }

    @Test
    void an_older_job_failing_does_not_fail_the_run_that_replaced_it() {
        service.onFailed(CopyCheckCallbackDto.Failed.builder()
                .processId("p1").jobId("job-old").errorMessage("boom").build());

        assertThat(process.getStatus()).isEqualTo("PROCESSING");
        verify(processes, never()).save(any());
        verify(intake, never()).onEvaluationFinished(any(), org.mockito.ArgumentMatchers.anyBoolean(), any());
    }

    @Test
    void an_older_job_completing_does_not_complete_the_run_that_replaced_it() {
        service.onComplete(CopyCheckCallbackDto.Complete.builder().processId("p1").jobId("job-old").build());

        assertThat(process.getStatus()).isEqualTo("PROCESSING");
        verify(processes, never()).save(any());
    }

    @Test
    void the_recorded_job_still_fails_the_process() {
        service.onFailed(CopyCheckCallbackDto.Failed.builder()
                .processId("p1").jobId("job-new").errorMessage("boom").build());

        assertThat(process.getStatus()).isEqualTo("FAILED");
        verify(processes).save(process);
    }

    @Test
    void an_unknown_job_on_either_side_is_accepted_as_before() {
        assertThat(CopyCheckCallbackService.fromAnotherRun(process, null)).isFalse();
        assertThat(CopyCheckCallbackService.fromAnotherRun(process, " ")).isFalse();
        assertThat(CopyCheckCallbackService.fromAnotherRun(process, "job-new")).isFalse();
        assertThat(CopyCheckCallbackService.fromAnotherRun(process, "job-old")).isTrue();
        process.setAiServiceJobId(null);
        assertThat(CopyCheckCallbackService.fromAnotherRun(process, "job-old")).isFalse();
    }
}
