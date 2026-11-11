package vacademy.io.admin_core_service.features.learner_tracking.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogRepository;
import vacademy.io.admin_core_service.features.learner_tracking.util.AutoEvaluationScorer;
import vacademy.io.admin_core_service.features.slide.repository.AssignmentSlideRepository;
import vacademy.io.admin_core_service.features.slide.repository.QuestionSlideRepository;
import vacademy.io.admin_core_service.features.slide.repository.QuizSlideQuestionOptionRepository;
import vacademy.io.admin_core_service.features.slide.repository.QuizSlideQuestionRepository;
import vacademy.io.admin_core_service.features.slide.repository.QuizSlideRepository;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * An assessment analysis row from a copy check: analysed on demand unless the learner
 * submitted the test themselves, and it retires the rows made from the replaced marks.
 * A row from the learner's own submit is saved exactly as before.
 */
class LLMAssessmentCopyCheckSaveTest {

    private ActivityLogRepository logs;
    private LLMActivityAnalyticsService service;

    @BeforeEach
    void setUp() {
        logs = mock(ActivityLogRepository.class);
        service = new LLMActivityAnalyticsService(logs, mock(QuizSlideQuestionRepository.class),
                mock(QuizSlideQuestionOptionRepository.class), mock(QuestionSlideRepository.class),
                mock(QuizSlideRepository.class), mock(AssignmentSlideRepository.class), mock(SlideRepository.class),
                new ObjectMapper(), mock(AutoEvaluationScorer.class));
        when(logs.save(any(ActivityLog.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    private static Map<String, Object> payload(String trigger) {
        Map<String, Object> data = new HashMap<>();
        data.put("assessment", Map.of("id", "as1"));
        data.put("attempt", Map.of("id", "a1", "user_id", "u1"));
        if (trigger != null) {
            data.put("analysis_trigger", trigger);
        }
        return data;
    }

    private ActivityLog saved() {
        ArgumentCaptor<ActivityLog> row = ArgumentCaptor.forClass(ActivityLog.class);
        verify(logs).save(row.capture());
        return row.getValue();
    }

    @Test
    void teacherUploadedCopyWaitsForAReportAndRetiresOlderRows() {
        when(logs.countSubmissionAssessmentLogs("u1", "as1")).thenReturn(0L);

        service.saveAssessmentRawData(payload("copy_check"));

        ActivityLog row = saved();
        assertThat(row.getStatus()).isEqualTo("on_demand");
        assertThat(row.getSourceType()).isEqualTo("llm_assessment");
        verify(logs).supersedeOlderAssessmentLogs("u1", "as1", row.getId());
    }

    @Test
    void learnerWhoSubmittedThemselvesStaysAutomatic() {
        when(logs.countSubmissionAssessmentLogs("u1", "as1")).thenReturn(1L);
        when(logs.countProcessedAssessmentLogs("u1", "as1")).thenReturn(0L);

        service.saveAssessmentRawData(payload("copy_check"));

        ActivityLog row = saved();
        assertThat(row.getStatus()).isEqualTo("raw");
        verify(logs).supersedeOlderAssessmentLogs("u1", "as1", row.getId());
    }

    @Test
    void learnerAlreadyAnalysedIsNotChargedAgainOnItsOwn() {
        when(logs.countSubmissionAssessmentLogs("u1", "as1")).thenReturn(1L);
        when(logs.countProcessedAssessmentLogs("u1", "as1")).thenReturn(1L);

        service.saveAssessmentRawData(payload("copy_check"));

        ActivityLog row = saved();
        assertThat(row.getStatus()).isEqualTo("on_demand");
        verify(logs).supersedeOlderAssessmentLogs("u1", "as1", row.getId());
    }

    @Test
    void submitRowIsSavedAsBefore() {
        service.saveAssessmentRawData(payload(null));

        assertThat(saved().getStatus()).isEqualTo("raw");
        verify(logs, never()).countSubmissionAssessmentLogs(anyString(), anyString());
        verify(logs, never()).countProcessedAssessmentLogs(anyString(), anyString());
        verify(logs, never()).supersedeOlderAssessmentLogs(anyString(), anyString(), anyString());
    }

    @Test
    void reportDownloadRowIsSavedAsBefore() {
        service.saveAssessmentRawData(payload("report_download"));

        assertThat(saved().getStatus()).isEqualTo("raw");
        verify(logs, never()).supersedeOlderAssessmentLogs(anyString(), anyString(), anyString());
    }
}
