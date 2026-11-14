package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.entity.AiQuestionEvaluation;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.AiQuestionEvaluationRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.open_evaluation.policy.ResultLockGuard;
import vacademy.io.assessment_service.features.open_evaluation.policy.ResultLockedException;

import java.math.BigDecimal;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** AI review override refuses a released result on a partner-API exam (gate G8). */
class AiEvaluationReviewServiceLockTest {

    private AiEvaluationProcessRepository processes;
    private AiQuestionEvaluationRepository questions;
    private AiEvaluationReviewService service;

    @BeforeEach
    void setUp() {
        processes = mock(AiEvaluationProcessRepository.class);
        questions = mock(AiQuestionEvaluationRepository.class);
        service = new AiEvaluationReviewService(processes, questions, mock(QuestionWiseMarksRepository.class),
                mock(StudentAttemptRepository.class), mock(TypedAnswerEvaluation.class), new ResultLockGuard());
    }

    private void processOn(String source, String releaseStatus) {
        Assessment exam = new Assessment();
        exam.setId("a1");
        exam.setSource(source);
        AssessmentUserRegistration r = new AssessmentUserRegistration();
        r.setAssessment(exam);
        r.setStudentAttempts(new HashSet<>());
        StudentAttempt attempt = new StudentAttempt();
        attempt.setId("att-1");
        attempt.setRegistration(r);
        attempt.setReportReleaseStatus(releaseStatus);
        AiEvaluationProcess p = new AiEvaluationProcess();
        p.setId("p1");
        p.setStudentAttempt(attempt);
        when(processes.findByIdWithStudentAttempt("p1")).thenReturn(Optional.of(p));
        AiQuestionEvaluation row = new AiQuestionEvaluation();
        row.setMaxMarks(BigDecimal.valueOf(5));
        when(questions.findAllByEvaluationProcessIdAndQuestionIdOrderByCreatedAtDesc("p1", "q1")).thenReturn(List.of(row));
    }

    @Test
    void released_api_result_cannot_be_overridden() {
        processOn("API", "RELEASED");
        assertThatThrownBy(() -> service.overrideQuestion("p1", "q1", 2.0, "ok", "apikey:k1"))
                .isInstanceOf(ResultLockedException.class);
        verify(questions, never()).save(any());
    }

    @Test
    void unreleased_api_result_and_dashboard_results_can_still_be_overridden() {
        processOn("API", "PENDING");
        service.overrideQuestion("p1", "q1", 2.0, "ok", "apikey:k1");
        verify(questions).save(any());
    }

    @Test
    void released_dashboard_result_keeps_todays_behaviour() {
        processOn(null, "RELEASED");
        service.overrideQuestion("p1", "q1", 2.0, "ok", "teacher-1");
        verify(questions).save(any());
    }
}
