package vacademy.io.assessment_service.features.assessment.notification;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.notification.service.NotificationService;
import vacademy.io.common.notification.dto.AttachmentNotificationDTO;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/** Report emails never go to API candidates or blank addresses (spec 12 item 1). */
class AssessmentReportNotificationApiCandidateTest {

    private NotificationService notifications;
    private AssessmentReportNotificationService service;

    @BeforeEach
    void setUp() {
        notifications = mock(NotificationService.class);
        service = new AssessmentReportNotificationService();
        ReflectionTestUtils.setField(service, "notificationService", notifications);
    }

    private static StudentAttempt attempt(String userId, String sourceId, String email) {
        AssessmentUserRegistration r = new AssessmentUserRegistration();
        r.setUserId(userId);
        r.setSourceId(sourceId);
        r.setUserEmail(email);
        r.setParticipantName("Name " + userId);
        StudentAttempt a = new StudentAttempt();
        a.setId("att-" + userId);
        a.setRegistration(r);
        return a;
    }

    @Test
    void only_reachable_dashboard_learners_are_emailed() {
        Map<StudentAttempt, byte[]> reports = new LinkedHashMap<>();
        reports.put(attempt("u1", "batch-1", "learner@school.in"), new byte[]{1});
        reports.put(attempt("apic_9", "apikey:k1", ""), new byte[]{2});
        reports.put(attempt("u2", "batch-1", ""), new byte[]{3});

        service.sendAssessmentReportsToLearners(reports, "a1", "inst-1");

        ArgumentCaptor<AttachmentNotificationDTO> sent = ArgumentCaptor.forClass(AttachmentNotificationDTO.class);
        verify(notifications).sendAttachmentEmailToUsers(sent.capture(), any());
        assertThat(sent.getValue().getUsers()).hasSize(1);
        assertThat(sent.getValue().getUsers().get(0).getUserId()).isEqualTo("u1");
    }

    @Test
    void nothing_is_sent_when_nobody_is_reachable() {
        Map<StudentAttempt, byte[]> reports = new LinkedHashMap<>();
        reports.put(attempt("apic_9", "apikey:k1", ""), new byte[]{2});

        service.sendAssessmentReportsToLearners(reports, "a1", "inst-1");

        verify(notifications, never()).sendAttachmentEmailToUsers(any(), anyString());
    }
}
