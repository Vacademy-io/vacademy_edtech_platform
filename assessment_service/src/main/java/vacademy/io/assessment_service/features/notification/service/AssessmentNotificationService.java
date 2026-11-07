package vacademy.io.assessment_service.features.notification.service;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.enums.AssessmentStatus;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentUserRegistrationRepository;
import vacademy.io.assessment_service.features.auth_service.service.AuthService;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;
import vacademy.io.assessment_service.features.notification.dto.NotificationDTO;
import vacademy.io.assessment_service.features.notification.dto.NotificationToUserDTO;
import vacademy.io.assessment_service.features.notification.enums.NotificationSourceEnum;
import vacademy.io.assessment_service.features.notification.enums.NotificationType;
import vacademy.io.assessment_service.features.open_evaluation.policy.ApiCandidatePolicy;
import vacademy.io.common.auth.dto.UserWithRolesDTO;
import vacademy.io.common.auth.enums.CompanyStatus;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class AssessmentNotificationService {

    private final AssessmentUserRegistrationRepository assessmentUserRegistrationRepository;
    private final AssessmentRepository assessmentRepository;
    private final NotificationService notificationService;
    private final AuthService authService;
    private final AdminCoreServiceClient adminCoreServiceClient;
    private final vacademy.io.assessment_service.features.assessment.service.AssessmentWorkflowEventPublisher assessmentWorkflowEventPublisher;

    @Value("${scheduling.time.frame}")
    private Integer timeFrameInMinutes;

    public void sendAssessmentNotificationWhenCreated(Assessment assessment, String instituteId) {
        sendNotificationToUsers(
                "New Assessment Created",
                AssessmentNotificaionEmailBody.EMAIL_BODY_WHEN_ASSESSMENT_CREATED,
                assessment
        );
    }

    public void sendNotificationsWhenAssessmentsAboutToStart() {
        getUpcomingAssessments().forEach(assessment -> {
                    // Resolved once and shared with the trigger below — the email and the
                    // workflow go to the same people, so this should not be two queries.
                    List<AssessmentUserRegistration> userRegistrations =
                            getActiveUsersForAssessment(assessment.getId());
                    sendNotificationToUsers(
                            "Upcoming Assessment Reminder",
                            AssessmentNotificaionEmailBody.EMAIL_BODY_WHEN_ASSESSMENT_ABOUT_TO_START,
                            assessment,
                            userRegistrations
                    );
                    // Trigger ASSESSMENT_REMINDER_BEFORE_START workflow. The built-in email
                    // above is fixed-template and always-on; the trigger is what lets an
                    // institute send their own reminder (WhatsApp, different copy, an extra
                    // nudge to a parent) off the same sweep.
                    assessmentWorkflowEventPublisher.publishReminderBeforeStart(
                            assessment, userRegistrations, timeFrameInMinutes);
                }
        );
    }

    public void sendNotificationsForStartedAssessments() {
        assessmentRepository.findRecentlyStartedAssessments(timeFrameInMinutes, List.of(AssessmentStatus.PUBLISHED.name()))
                .forEach(assessment ->
                        sendNotificationToUsers(
                                "Assessment Started Notification",
                                AssessmentNotificaionEmailBody.EMAIL_BODY_WHEN_ASSESSMENT_STARTED,
                                assessment
                        )
                );
    }

    public void sendNotificationsToAdminsAfterReleasingTheResult(Assessment assessment, String instituteId) {
        NotificationDTO notificationDTO = buildAdminNotificationDTO(assessment, instituteId);
        // null => no staff role is enabled to receive result emails (ADMIN is OFF
        // by default; institutes opt roles in via Assessment Settings). Skip send.
        if (notificationDTO == null) {
            return;
        }
        notificationService.sendEmailToUsers(notificationDTO, instituteId);
    }

    private void sendNotificationToUsers(String subject, String body, Assessment assessment) {
        sendNotificationToUsers(subject, body, assessment, getActiveUsersForAssessment(assessment.getId()));
    }

    /** Overload for callers that already hold the recipient list and should not re-query it. */
    private void sendNotificationToUsers(String subject, String body, Assessment assessment,
                                         List<AssessmentUserRegistration> userRegistrations) {
        NotificationDTO notificationDTO = buildNotificationDTO(subject, body, assessment, userRegistrations);
        notificationService.sendEmailToUsers(notificationDTO, null);
    }

    private List<AssessmentUserRegistration> getActiveUsersForAssessment(String assessmentId) {
        return assessmentUserRegistrationRepository.findByInstituteIdAndAssessmentIdAndStatusIn(
                assessmentId,
                List.of(CompanyStatus.ACTIVE.name())
        );
    }

    private List<Assessment> getUpcomingAssessments() {
        return assessmentRepository.findAssessmentsStartingWithinTimeFrame(
                timeFrameInMinutes,
                List.of(AssessmentStatus.PUBLISHED.name())
        );
    }

    private NotificationDTO buildNotificationDTO(String subject, String body, Assessment assessment,
                                                 List<AssessmentUserRegistration> userRegistrations) {
        return NotificationDTO.builder()
                .subject(subject)
                .body(body)
                .source(NotificationSourceEnum.ASSESSMENT.name())
                .sourceId(assessment.getId())
                .notificationType(NotificationType.EMAIL.name())
                .users(mapToNotificationUsers(userRegistrations, assessment))
                .build();
    }

    private List<NotificationToUserDTO> mapToNotificationUsers(List<AssessmentUserRegistration> userRegistrations,
                                                               Assessment assessment) {
        return userRegistrations.stream()
                // API candidates (partner API) have no login and no email (spec 12 item 3).
                .filter(user -> !ApiCandidatePolicy.isApi(user))
                .map(user -> NotificationToUserDTO.builder()
                        .userId(user.getUserId())
                        .channelId(user.getUserEmail())
                        .placeholders(buildPlaceholders(user, assessment))
                        .build())
                .collect(Collectors.toList());
    }

    private Map<String, String> buildPlaceholders(AssessmentUserRegistration user, Assessment assessment) {
        Map<String, String> placeholders = new HashMap<>();
        placeholders.put("learner_name", user.getParticipantName());
        placeholders.put("assessment_name", assessment.getName());
        placeholders.put("start_time", assessment.getBoundStartTime().toString());
        placeholders.put("end_time", assessment.getBoundEndTime().toString());
        placeholders.put("duration", String.valueOf(assessment.getDuration()));
        return placeholders;
    }

    private NotificationDTO buildAdminNotificationDTO(Assessment assessment, String instituteId) {
        List<String> staffRoles = adminCoreServiceClient.enabledStaffResultRoles(instituteId);
        if (staffRoles.isEmpty()) {
            return null; // nobody opted in (ADMIN is OFF by default)
        }
        List<UserWithRolesDTO> users = authService.getUsersByRoles(staffRoles, instituteId);
        if (users == null || users.isEmpty()) {
            return null;
        }
        return NotificationDTO.builder()
                .subject("Assessment result released")
                .body(AssessmentNotificaionEmailBody.getEmailBodyForAdminsForResultRelease(
                        assessment.getName(), assessment.getBoundStartTime().toString()
                ))
                .source(NotificationSourceEnum.ASSESSMENT.name())
                .sourceId(assessment.getId())
                .notificationType(NotificationType.EMAIL.name())
                .users(mapToAdminNotificationUsers(users))
                .build();
    }

    private List<NotificationToUserDTO> mapToAdminNotificationUsers(List<UserWithRolesDTO> users) {
        return users.stream()
                .map(user -> NotificationToUserDTO.builder()
                        .userId(user.getId())
                        .channelId(user.getEmail())
                        .placeholders(Map.of("user_name", user.getFullName()))
                        .build())
                .collect(Collectors.toList());
    }

    public void sendNotificationsToAdminsAfterReevaluating(Assessment assessment, String instituteId) {
        NotificationDTO notificationDTO = buildAdminNotificationDTO(assessment, instituteId);
        if (notificationDTO == null) {
            return; // no staff role enabled to receive result emails
        }
        notificationService.sendEmailToUsers(notificationDTO, instituteId);
    }

    private NotificationDTO buildAdminNotificationDTOAfterReevaluating(Assessment assessment, String instituteId) {
        List<String> staffRoles = adminCoreServiceClient.enabledStaffResultRoles(instituteId);
        if (staffRoles.isEmpty()) {
            return null;
        }
        List<UserWithRolesDTO> users = authService.getUsersByRoles(staffRoles, instituteId);
        if (users == null || users.isEmpty()) {
            return null;
        }
        return NotificationDTO.builder()
                .subject("Assessment reevaluated!!!")
                .body(AssessmentNotificaionEmailBody.getEmailBodyForAdminsForReevaluation(
                        assessment.getName(), assessment.getBoundStartTime().toString()
                ))
                .source(NotificationSourceEnum.ASSESSMENT.name())
                .sourceId(assessment.getId())
                .notificationType(NotificationType.EMAIL.name())
                .users(mapToAdminNotificationUsers(users))
                .build();
    }
}
