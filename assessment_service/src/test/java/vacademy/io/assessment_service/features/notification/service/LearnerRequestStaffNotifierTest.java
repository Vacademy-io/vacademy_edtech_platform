package vacademy.io.assessment_service.features.notification.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentReattemptRequest;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentReattemptRequestRepository;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.auth_service.service.AuthService;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient.LearnerRequestNotificationSettings;
import vacademy.io.assessment_service.features.notification.dto.NotificationDTO;
import vacademy.io.common.auth.dto.UserWithRolesDTO;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Role-wise staff notices for learner requests: who gets them, on which channel, saying what. */
class LearnerRequestStaffNotifierTest {

    private static final String INST = "inst-1";

    private LearnerRequestStaffNotifier notifier;
    private AdminCoreServiceClient adminCore;
    private AuthService auth;
    private NotificationService notifications;
    private AssessmentReattemptRequestRepository requests;
    private QuestionAssessmentSectionMappingRepository questions;

    @BeforeEach
    void setUp() {
        notifier = new LearnerRequestStaffNotifier();
        adminCore = mock(AdminCoreServiceClient.class);
        auth = mock(AuthService.class);
        notifications = mock(NotificationService.class);
        ReflectionTestUtils.setField(notifier, "adminCoreServiceClient", adminCore);
        ReflectionTestUtils.setField(notifier, "authService", auth);
        ReflectionTestUtils.setField(notifier, "notificationService", notifications);
        requests = mock(AssessmentReattemptRequestRepository.class);
        questions = mock(QuestionAssessmentSectionMappingRepository.class);
        ReflectionTestUtils.setField(notifier, "requestRepository", requests);
        ReflectionTestUtils.setField(notifier, "questionMappingRepository", questions);
        when(adminCore.getInstituteName(INST)).thenReturn("Demo Institute");
        // This report is the earliest open one on its question.
        AssessmentReattemptRequest first = new AssessmentReattemptRequest();
        first.setId("req-1");
        when(requests.findFirstByAssessmentIdAndQuestionIdAndRequestTypeAndStatusAndCreatedAtAfterOrderByCreatedAtAscIdAsc(
                eq("asmt-1"), eq("q-2"), eq("PROBLEM_REPORT"), eq("PENDING"), any())).thenReturn(Optional.of(first));
        QuestionAssessmentSectionMappingRepository.ReportedQuestionRow row =
                mock(QuestionAssessmentSectionMappingRepository.ReportedQuestionRow.class);
        when(row.getSectionName()).thenReturn("Physics");
        when(row.getQuestionNumber()).thenReturn(2);
        when(row.getQuestionHtml()).thenReturn("<p>Which quantity is a vector?</p>");
        when(questions.findReportedQuestions(List.of("asmt-1"), List.of("q-2"))).thenReturn(List.of(row));
    }

    @Test
    void theConfiguredRolesGetTheBellAndAnEmail() {
        when(adminCore.getLearnerRequestNotificationSettings(INST))
                .thenReturn(new LearnerRequestNotificationSettings(List.of("ADMIN", "TEACHER"), true, true));
        when(auth.getUsersByRoles(List.of("ADMIN", "TEACHER"), INST)).thenReturn(List.of(
                user("a1", "admin@example.test", "Asha"),
                user("t1", "teacher@example.test", "Tarun"),
                user("a1", "admin@example.test", "Asha"))); // holds both roles: once only

        notifier.notifyStaff(report());

        verify(notifications).sendSystemAlertToUsers(eq(INST), eq(List.of("a1", "t1")),
                eq("Problem reported: Physics Mock Test"),
                eq("Riya Sharma · Physics · Question 2: “The diagram is not loading.”"));
        ArgumentCaptor<NotificationDTO> mail = ArgumentCaptor.forClass(NotificationDTO.class);
        verify(notifications).sendEmailToUsers(mail.capture(), eq(INST));
        assertThat(mail.getValue().getSubject()).isEqualTo("Problem reported: Physics Mock Test");
        assertThat(mail.getValue().getUsers()).extracting("channelId")
                .containsExactly("admin@example.test", "teacher@example.test");
        assertThat(mail.getValue().getBody())
                .contains("Riya Sharma reported a problem with a question in Physics Mock Test.")
                .contains("Physics · Question 2")
                .contains("Which quantity is a vector?")
                .contains("The diagram is not loading.")
                .contains("Learner Requests")
                .contains("Demo Institute")
                .doesNotContain("vacademy").doesNotContain("Vacademy").doesNotContain("href");
    }

    @Test
    void channelsSwitchedOffAreNotUsed() {
        when(adminCore.getLearnerRequestNotificationSettings(INST))
                .thenReturn(new LearnerRequestNotificationSettings(List.of("ADMIN"), true, false));
        when(auth.getUsersByRoles(anyList(), eq(INST))).thenReturn(List.of(user("a1", "admin@example.test", "Asha")));

        notifier.notifyStaff(report());

        verify(notifications).sendSystemAlertToUsers(eq(INST), anyList(), anyString(), anyString());
        verify(notifications, never()).sendEmailToUsers(any(), anyString());
    }

    @Test
    void bothChannelsOffMeansNoLookupAndNoSend() {
        when(adminCore.getLearnerRequestNotificationSettings(INST))
                .thenReturn(new LearnerRequestNotificationSettings(List.of("ADMIN"), false, false));

        notifier.notifyStaff(report());

        verify(auth, never()).getUsersByRoles(anyList(), anyString());
        verify(notifications, never()).sendSystemAlertToUsers(anyString(), anyList(), anyString(), anyString());
    }

    @Test
    void theLearnerIsNeverNotifiedAboutTheirOwnRequest() {
        when(adminCore.getLearnerRequestNotificationSettings(INST)).thenReturn(LearnerRequestNotificationSettings.defaults());
        when(auth.getUsersByRoles(anyList(), eq(INST))).thenReturn(List.of(user("learner-1", "riya@example.test", "Riya")));

        notifier.notifyStaff(report());

        verify(notifications, never()).sendSystemAlertToUsers(anyString(), anyList(), anyString(), anyString());
        verify(notifications, never()).sendEmailToUsers(any(), anyString());
    }

    @Test
    void aFailingLookupNeverEscapes() {
        when(adminCore.getLearnerRequestNotificationSettings(INST)).thenReturn(LearnerRequestNotificationSettings.defaults());
        when(auth.getUsersByRoles(anyList(), eq(INST))).thenThrow(new RuntimeException("auth down"));

        notifier.notifyStaff(report()); // no exception
    }

    @Test
    void laterReportsOnTheSameQuestionDoNotAlertAgain() {
        when(adminCore.getLearnerRequestNotificationSettings(INST)).thenReturn(LearnerRequestNotificationSettings.defaults());
        AssessmentReattemptRequest earlier = new AssessmentReattemptRequest();
        earlier.setId("req-earlier");
        when(requests.findFirstByAssessmentIdAndQuestionIdAndRequestTypeAndStatusAndCreatedAtAfterOrderByCreatedAtAscIdAsc(
                eq("asmt-1"), eq("q-2"), eq("PROBLEM_REPORT"), eq("PENDING"), any())).thenReturn(Optional.of(earlier));

        notifier.notifyStaff(report());

        verify(auth, never()).getUsersByRoles(anyList(), anyString());
        verify(notifications, never()).sendSystemAlertToUsers(anyString(), anyList(), anyString(), anyString());
    }

    @Test
    void aFailedGroupingLookupStillAlerts() {
        when(adminCore.getLearnerRequestNotificationSettings(INST)).thenReturn(LearnerRequestNotificationSettings.defaults());
        when(requests.findFirstByAssessmentIdAndQuestionIdAndRequestTypeAndStatusAndCreatedAtAfterOrderByCreatedAtAscIdAsc(
                any(), any(), any(), any(), any())).thenThrow(new RuntimeException("db busy"));
        when(auth.getUsersByRoles(anyList(), eq(INST))).thenReturn(List.of(user("a1", "admin@example.test", "Asha")));

        notifier.notifyStaff(report());

        verify(notifications).sendSystemAlertToUsers(eq(INST), eq(List.of("a1")), anyString(), anyString());
    }

    @Test
    void wordingPerRequestType() {
        LearnerRequestStaffNotifier.NewRequest time = new LearnerRequestStaffNotifier.NewRequest(INST, "a", "Mock",
                "TIME_INCREASE", "req-9", null, "learner-1", null, "x".repeat(400));
        assertThat(LearnerRequestStaffNotifier.title(time)).isEqualTo("More time requested: Mock");
        assertThat(LearnerRequestStaffNotifier.sentence(time)).isEqualTo("A learner asked for more time in Mock.");
        assertThat(LearnerRequestStaffNotifier.shortBody(time, null)).hasSizeLessThan(200).endsWith("…”");

        LearnerRequestStaffNotifier.NewRequest again = new LearnerRequestStaffNotifier.NewRequest(INST, "a", null,
                "REATTEMPT", "req-10", null, "learner-1", "Riya", "Crashed");
        assertThat(LearnerRequestStaffNotifier.title(again)).isEqualTo("Reattempt requested: a test");
    }

    // ------------------------------------------------------------------ settings parsing

    @Test
    void unsetSettingsMeanAdminsOnEveryChannel() {
        LearnerRequestNotificationSettings s = AdminCoreServiceClient.parseLearnerRequestNotificationSettings(null);
        assertThat(s.roles()).containsExactly("ADMIN");
        assertThat(s.inApp()).isTrue();
        assertThat(s.email()).isTrue();
    }

    @Test
    void savedRolesAndChannelsAreHonoured() {
        LearnerRequestNotificationSettings s = AdminCoreServiceClient.parseLearnerRequestNotificationSettings(java.util.Map.of(
                "roles", java.util.Map.of("ADMIN", false, "TEACHER", true, "Exam Cell", true, "STUDENT", true),
                "channels", java.util.Map.of("inApp", true, "email", false)));
        assertThat(s.roles()).containsExactlyInAnyOrder("TEACHER", "Exam Cell"); // ADMIN off, learners never
        assertThat(s.inApp()).isTrue();
        assertThat(s.email()).isFalse();
    }

    // ------------------------------------------------------------------ helpers

    private static LearnerRequestStaffNotifier.NewRequest report() {
        return new LearnerRequestStaffNotifier.NewRequest(INST, "asmt-1", "Physics Mock Test", "PROBLEM_REPORT",
                "req-1", "q-2", "learner-1", "Riya Sharma", "The diagram is not loading.");
    }

    private static UserWithRolesDTO user(String id, String email, String name) {
        UserWithRolesDTO u = new UserWithRolesDTO();
        u.setId(id);
        u.setEmail(email);
        u.setFullName(name);
        return u;
    }
}
