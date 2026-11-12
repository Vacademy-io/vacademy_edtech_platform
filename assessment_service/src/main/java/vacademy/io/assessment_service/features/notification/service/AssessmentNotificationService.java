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

    private final NotificationService notificationService;
    private final AuthService authService;
    private final AdminCoreServiceClient adminCoreServiceClient;

    public void sendNotificationsToAdminsAfterReleasingTheResult(Assessment assessment, String instituteId) {
        NotificationDTO notificationDTO = buildAdminNotificationDTO(assessment, instituteId);
        // null => no staff role is enabled to receive result emails (ADMIN is OFF
        // by default; institutes opt roles in via Assessment Settings). Skip send.
        if (notificationDTO == null) {
            return;
        }
        notificationService.sendEmailToUsers(notificationDTO, instituteId);
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
