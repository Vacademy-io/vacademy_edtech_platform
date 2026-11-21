package vacademy.io.assessment_service.features.notification.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentInstituteMapping;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentNotificationMetadata;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentInstituteMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentNotificationMetadataRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentUserRegistrationRepository;
import vacademy.io.assessment_service.features.assessment.service.AssessmentWorkflowEventPublisher;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;
import vacademy.io.assessment_service.features.notification.dto.NotificationDTO;

import java.util.Date;
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

class LearnerAssessmentNoticeServiceTest {

    private static final long MIN = 60_000L;

    private AssessmentNotificationMetadataRepository metadataRepository;
    private AssessmentUserRegistrationRepository registrationRepository;
    private AssessmentInstituteMappingRepository mappingRepository;
    private AssessmentRepository assessmentRepository;
    private NotificationService notificationService;
    private AdminCoreServiceClient adminCore;
    private AssessmentWorkflowEventPublisher workflows;
    private LearnerAssessmentNoticeService service;

    @BeforeEach
    void setUp() {
        metadataRepository = mock(AssessmentNotificationMetadataRepository.class);
        registrationRepository = mock(AssessmentUserRegistrationRepository.class);
        mappingRepository = mock(AssessmentInstituteMappingRepository.class);
        assessmentRepository = mock(AssessmentRepository.class);
        notificationService = mock(NotificationService.class);
        adminCore = mock(AdminCoreServiceClient.class);
        workflows = mock(AssessmentWorkflowEventPublisher.class);
        service = new LearnerAssessmentNoticeService(metadataRepository, registrationRepository, mappingRepository,
                assessmentRepository, notificationService, adminCore, workflows);
        ReflectionTestUtils.setField(service, "enabled", true);

        AssessmentInstituteMapping mapping = new AssessmentInstituteMapping();
        mapping.setInstituteId("inst-1");
        mapping.setAssessmentUrl("801545");
        when(mappingRepository.findTopByAssessmentId(anyString())).thenReturn(Optional.of(mapping));
        when(adminCore.getLearnerMailInstitute("inst-1")).thenReturn(
                new AdminCoreServiceClient.LearnerMailInstitute("OGI", "primary", null, "ogi.example.com"));
        when(registrationRepository.findByInstituteIdAndAssessmentIdAndStatusIn(anyString(), anyList()))
                .thenReturn(List.of(registration("a@example.com"), registration("")));
    }

    private static AssessmentUserRegistration registration(String email) {
        AssessmentUserRegistration r = new AssessmentUserRegistration();
        r.setUserId("u-" + email);
        r.setUserEmail(email);
        r.setParticipantName("Asha");
        r.setInstituteId("inst-1");
        return r;
    }

    private static AssessmentNotificationMetadata settings(Date start, int minutesBefore, boolean live) {
        Assessment assessment = new Assessment();
        assessment.setId("as-1");
        assessment.setName("Unit test");
        assessment.setPlayMode("EXAM");
        assessment.setBoundStartTime(start);
        assessment.setBoundEndTime(new Date(start.getTime() + 60 * MIN));
        AssessmentNotificationMetadata m = new AssessmentNotificationMetadata();
        m.setId("meta-1");
        m.setAssessment(assessment);
        m.setParticipantBeforeAssessmentGoesLive(minutesBefore);
        m.setParticipantWhenAssessmentLive(live);
        return m;
    }

    @Test
    void sendsTheReminderInsideTheAdminsWindow() {
        Date now = new Date();
        Date start = new Date(now.getTime() + 4 * MIN);
        when(metadataRepository.claimReminder("meta-1", start)).thenReturn(1);

        service.sendDue(settings(start, 5, false), now);

        ArgumentCaptor<NotificationDTO> sent = ArgumentCaptor.forClass(NotificationDTO.class);
        verify(notificationService).sendEmailToUsers(sent.capture(), eq("inst-1"));
        assertThat(sent.getValue().getSubject()).isEqualTo("Unit test starts in 5 minutes");
        // The registration without an email is skipped.
        assertThat(sent.getValue().getUsers()).hasSize(1);
        assertThat(sent.getValue().getBody()).contains("https://ogi.example.com/register?code=801545");
        verify(workflows).publishReminderBeforeStart(any(), anyList(), eq(5));
    }

    @Test
    void doesNotSendBeforeTheWindow() {
        Date now = new Date();
        Date start = new Date(now.getTime() + 20 * MIN);

        service.sendDue(settings(start, 5, false), now);

        verify(metadataRepository, never()).claimReminder(anyString(), any());
        verify(notificationService, never()).sendEmailToUsers(any(), any());
    }

    @Test
    void anotherPodThatAlreadyClaimedItWins() {
        Date now = new Date();
        Date start = new Date(now.getTime() + 2 * MIN);
        when(metadataRepository.claimReminder("meta-1", start)).thenReturn(0);

        service.sendDue(settings(start, 5, false), now);

        verify(notificationService, never()).sendEmailToUsers(any(), any());
    }

    @Test
    void reminderOffMeansNoReminder() {
        Date now = new Date();
        Date start = new Date(now.getTime() + 2 * MIN);

        service.sendDue(settings(start, 0, false), now);

        verify(metadataRepository, never()).claimReminder(anyString(), any());
    }

    @Test
    void sendsTheLiveEmailOnceTheTestHasStarted() {
        Date now = new Date();
        Date start = new Date(now.getTime() - 1 * MIN);
        when(metadataRepository.claimLive("meta-1", start)).thenReturn(1);

        service.sendDue(settings(start, 5, true), now);

        ArgumentCaptor<NotificationDTO> sent = ArgumentCaptor.forClass(NotificationDTO.class);
        verify(notificationService).sendEmailToUsers(sent.capture(), eq("inst-1"));
        assertThat(sent.getValue().getSubject()).isEqualTo("Unit test has started");
        verify(metadataRepository, never()).claimReminder(anyString(), any());
    }

    @Test
    void liveEmailIsNotSentLongAfterTheStart() {
        Date now = new Date();
        Date start = new Date(now.getTime() - 45 * MIN);

        service.sendDue(settings(start, 5, true), now);

        verify(metadataRepository, never()).claimLive(anyString(), any());
    }

    @Test
    void offlinePaperExamsGetNoEmails() {
        Date now = new Date();
        Date start = new Date(now.getTime() + 2 * MIN);
        AssessmentNotificationMetadata m = settings(start, 5, true);
        m.getAssessment().setPlayMode("MANUAL_UPLOAD");

        service.sendDue(m, now);

        verify(metadataRepository, never()).claimReminder(anyString(), any());
        verify(notificationService, never()).sendEmailToUsers(any(), any());
    }

    @Test
    void offlinePapersAsStoredInProductionGetNoEmails() {
        Date now = new Date();
        Date start = new Date(now.getTime() + 2 * MIN);
        AssessmentNotificationMetadata m = settings(start, 5, true);
        m.getAssessment().setPlayMode("MANUAL_UPLOAD_EXAM");

        service.sendDue(m, now);

        verify(metadataRepository, never()).claimReminder(anyString(), any());
    }

    @Test
    void homeworkGetsNoEmails() {
        Date now = new Date();
        Date start = new Date(now.getTime() + 2 * MIN);
        AssessmentNotificationMetadata m = settings(start, 5, true);
        m.getAssessment().setAssessmentType("HOMEWORK");

        service.sendDue(m, now);

        verify(metadataRepository, never()).claimReminder(anyString(), any());
    }

    @Test
    void anytimeTestsGetNoReminderOrLiveEmail() {
        Date now = new Date();
        for (String mode : new String[]{"MOCK", "PRACTICE", "SURVEY"}) {
            AssessmentNotificationMetadata reminder = settings(new Date(now.getTime() + 2 * MIN), 5, true);
            reminder.getAssessment().setPlayMode(mode);
            service.sendDue(reminder, now);
            AssessmentNotificationMetadata live = settings(new Date(now.getTime() - MIN), 5, true);
            live.getAssessment().setPlayMode(mode);
            service.sendDue(live, now);
        }

        verify(metadataRepository, never()).claimReminder(anyString(), any());
        verify(metadataRepository, never()).claimLive(anyString(), any());
    }

    @Test
    void joinLinkUsesTheInstitutesOwnDomainOrNothing() {
        assertThat(LearnerAssessmentNoticeService.joinLink(
                new AdminCoreServiceClient.LearnerMailInstitute(null, null, null, "https://ogi.example.com/"), "12"))
                .isEqualTo("https://ogi.example.com/register?code=12");
        assertThat(LearnerAssessmentNoticeService.joinLink(
                new AdminCoreServiceClient.LearnerMailInstitute(null, null, null, null), "12")).isNull();
        assertThat(LearnerAssessmentNoticeService.joinLink(null, "12")).isNull();
    }
}
